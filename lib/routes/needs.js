// ---------------------------------------------------------------------------
//  Toile des besoins : besoins, elements a mettre en place, contraintes
//  Chaque noeud a un parent (arborescence) et peut etre relie a d'autres noeuds
//  (liens transverses : un meme element peut servir plusieurs besoins).
//  Chaque mutation renvoie l'etat complet de la carte et notifie les membres.
// ---------------------------------------------------------------------------
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { requireAuth, requireMember, text, longText, id, isMember, touchMap } from '../helpers.js';
import { notifyMap } from '../realtime.js';
import { mapState } from './maps.js';

const KINDS = new Set(['besoin', 'solution', 'contrainte']);
const MAX_NODES = 400;

const kind = (v, fallback = 'besoin') => (KINDS.has(v) ? v : fallback);

async function changed(ctx, mapId) {
  await touchMap(mapId);
  await notifyMap(mapId, { kind: 'needs', origin: ctx.clientId });
  return { data: { state: await mapState(mapId) } };
}

async function requireNode(user, nodeId) {
  requireAuth(user);
  const n = await db.prepare('SELECT * FROM nodes WHERE id = ?').get(id(nodeId));
  if (!n) throw new HttpError(404, 'Élément introuvable');
  await requireMember(user, n.map_id);
  return n;
}

// Parent valide : meme carte, et pas de boucle (un noeud ne peut pas etre sous son propre descendant)
async function cleanParent(mapId, v, selfId = null) {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  const pid = Number(v);
  const p = Number.isInteger(pid) ? await db.prepare('SELECT id, map_id, parent_id FROM nodes WHERE id = ?').get(pid) : null;
  if (!p || p.map_id !== mapId) throw new HttpError(400, 'Parent invalide');
  if (selfId) {
    let cur = p;
    for (let guard = 0; cur && guard < 1000; guard++) {
      if (cur.id === selfId) throw new HttpError(400, 'Impossible : cela créerait une boucle');
      cur = cur.parent_id ? await db.prepare('SELECT id, parent_id FROM nodes WHERE id = ?').get(cur.parent_id) : null;
    }
  }
  return pid;
}

async function cleanAssignee(mapId, v) {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  const uid = Number(v);
  if (!Number.isInteger(uid) || !(await isMember(mapId, uid))) throw new HttpError(400, 'Cette personne ne fait pas partie de la carte');
  return uid;
}

export function register(router) {
  // ---- Creer un noeud ----
  router.post('/api/maps/:id/nodes', async (ctx) => {
    const { map } = await requireMember(ctx.user, ctx.params.id);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE map_id = ?').get(map.id);
    if (Number(count.n) >= MAX_NODES) throw new HttpError(400, `Maximum ${MAX_NODES} éléments par carte`);

    const parentId = await cleanParent(map.id, ctx.body.parent_id);
    const t = now();
    const r = await db
      .prepare(
        `INSERT INTO nodes (map_id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        map.id,
        parentId,
        kind(ctx.body.kind, parentId ? 'solution' : 'besoin'),
        text(ctx.body.title, { max: 120, label: 'Titre' }),
        longText(ctx.body.description),
        await cleanAssignee(map.id, ctx.body.assignee_id),
        ctx.user.id,
        t,
        t
      );
    const newId = Number(r.lastInsertRowid);

    // Liens transverses demandes des la creation (elements d'autres branches)
    const wanted = Array.isArray(ctx.body.link_ids) ? [...new Set(ctx.body.link_ids.map(Number))].slice(0, 50) : [];
    for (const other of wanted) {
      if (!Number.isInteger(other) || other === newId || other === parentId) continue;
      const o = await db.prepare('SELECT map_id FROM nodes WHERE id = ?').get(other);
      if (!o || o.map_id !== map.id) continue;
      const [a, b] = newId < other ? [newId, other] : [other, newId];
      await db.prepare('INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?)').run(map.id, a, b, t);
    }

    const res = await changed(ctx, map.id);
    res.status = 201;
    res.data.nodeId = newId;
    return res;
  });

  // ---- Modifier un noeud ----
  router.patch('/api/nodes/:id', async (ctx) => {
    const n = await requireNode(ctx.user, ctx.params.id);
    const b = ctx.body;
    await db
      .prepare(
        `UPDATE nodes SET title = ?, kind = ?, description = ?, parent_id = ?, assignee_id = ?, done = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        b.title !== undefined ? text(b.title, { max: 120, label: 'Titre' }) : n.title,
        b.kind !== undefined ? kind(b.kind, n.kind) : n.kind,
        b.description !== undefined ? longText(b.description) : n.description,
        b.parent_id !== undefined ? await cleanParent(n.map_id, b.parent_id, n.id) : n.parent_id,
        b.assignee_id !== undefined ? await cleanAssignee(n.map_id, b.assignee_id) : n.assignee_id,
        b.done !== undefined ? (b.done ? 1 : 0) : Number(n.done),
        now(),
        n.id
      );
    return changed(ctx, n.map_id);
  });

  // ---- Supprimer un noeud (et toute sa branche) ----
  router.delete('/api/nodes/:id', async (ctx) => {
    const n = await requireNode(ctx.user, ctx.params.id);
    await db.prepare('DELETE FROM nodes WHERE id = ?').run(n.id);
    return changed(ctx, n.map_id);
  });

  // ---- Relier deux noeuds ----
  router.post('/api/maps/:id/links', async (ctx) => {
    const { map } = await requireMember(ctx.user, ctx.params.id);
    let a = Number(ctx.body.source_id);
    let b = Number(ctx.body.target_id);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) throw new HttpError(400, 'Lien invalide');
    if (a > b) [a, b] = [b, a]; // un seul lien par paire, quel que soit le sens
    const both = await db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE map_id = ? AND id IN (?, ?)').get(map.id, a, b);
    if (Number(both.n) !== 2) throw new HttpError(400, 'Lien invalide');
    if (await db.prepare('SELECT 1 FROM node_links WHERE source_id = ? AND target_id = ?').get(a, b))
      throw new HttpError(409, 'Ces deux éléments sont déjà reliés');
    await db.prepare('INSERT INTO node_links (map_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?)').run(map.id, a, b, now());
    return changed(ctx, map.id);
  });

  router.delete('/api/links/:id', async (ctx) => {
    requireAuth(ctx.user);
    const l = await db.prepare('SELECT * FROM node_links WHERE id = ?').get(id(ctx.params.id));
    if (!l) throw new HttpError(404, 'Lien introuvable');
    await requireMember(ctx.user, l.map_id);
    await db.prepare('DELETE FROM node_links WHERE id = ?').run(l.id);
    return changed(ctx, l.map_id);
  });
}
