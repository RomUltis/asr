// ---------------------------------------------------------------------------
//  Cartes mentales : liste, creation, etat complet, membres, invitations
// ---------------------------------------------------------------------------
import { db, now, placeholders } from '../db.js';
import { HttpError } from '../http.js';
import { requireAuth, requireMember, requireOwner, text, id, touchMap, memberIds, isMember } from '../helpers.js';
import { notifyMap, onlineUsers, sendToUsers, kickFromMap } from '../realtime.js';
import { rateLimited } from '../security.js';

// Etat complet d'une carte : tout ce dont le client a besoin pour l'afficher
export async function mapState(mapId) {
  const map = await db.prepare('SELECT id, name, owner_id, created_at, updated_at FROM maps WHERE id = ?').get(mapId);
  const members = await db
    .prepare(
      `SELECT u.id, u.pseudo, u.color, mm.role, mm.joined_at
       FROM map_members mm JOIN users u ON u.id = mm.user_id
       WHERE mm.map_id = ? ORDER BY mm.joined_at, u.id`
    )
    .all(mapId);
  const folders = await db
    .prepare('SELECT id, title, color, x, y, created_by, created_at, updated_at FROM folders WHERE map_id = ? ORDER BY id')
    .all(mapId);
  const tasks = await db
    .prepare(
      `SELECT t.id, t.folder_id, t.title, t.description, t.assignee_id, t.done, t.position, t.due_date,
              t.created_by, t.created_at, t.updated_at, t.done_at
       FROM tasks t JOIN folders f ON f.id = t.folder_id
       WHERE f.map_id = ? ORDER BY t.position, t.id`
    )
    .all(mapId);
  const nodes = await db
    .prepare(
      `SELECT id, parent_id, kind, title, description, assignee_id, done, created_by, created_at, updated_at
       FROM nodes WHERE map_id = ? ORDER BY id`
    )
    .all(mapId);
  const links = await db.prepare('SELECT id, source_id, target_id FROM node_links WHERE map_id = ? ORDER BY id').all(mapId);
  return {
    map,
    members,
    folders: folders.map((f) => ({ ...f, x: Number(f.x), y: Number(f.y) })),
    tasks: tasks.map((t) => ({ ...t, done: !!Number(t.done), position: Number(t.position) })),
    nodes: nodes.map((n) => ({ ...n, done: !!Number(n.done) })),
    links,
    online: onlineUsers(mapId),
  };
}

// Echappe les jokers LIKE (portable SQLite / MySQL avec ESCAPE '!')
const likePrefix = (s) => s.replace(/[!%_]/g, (c) => '!' + c) + '%';

export function register(router) {
  // ---- Mes cartes ----
  router.get('/api/maps', async (ctx) => {
    requireAuth(ctx.user);
    const maps = await db
      .prepare(
        `SELECT m.id, m.name, m.owner_id, m.created_at, m.updated_at, mm.role
         FROM maps m JOIN map_members mm ON mm.map_id = m.id
         WHERE mm.user_id = ? ORDER BY m.updated_at DESC, m.id DESC`
      )
      .all(ctx.user.id);
    if (!maps.length) return { data: { maps: [] } };

    const ids = maps.map((m) => m.id);
    const ph = placeholders(ids.length);
    const members = await db
      .prepare(
        `SELECT mm.map_id, u.id, u.pseudo, u.color, mm.role
         FROM map_members mm JOIN users u ON u.id = mm.user_id
         WHERE mm.map_id IN (${ph}) ORDER BY mm.joined_at, u.id`
      )
      .all(...ids);
    const folders = await db
      .prepare(`SELECT map_id, COUNT(*) AS n FROM folders WHERE map_id IN (${ph}) GROUP BY map_id`)
      .all(...ids);
    const stats = await db
      .prepare(
        `SELECT f.map_id, COUNT(t.id) AS total,
                SUM(CASE WHEN t.done = 1 THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN t.done = 0 AND t.assignee_id = ? THEN 1 ELSE 0 END) AS mine
         FROM tasks t JOIN folders f ON f.id = t.folder_id
         WHERE f.map_id IN (${ph}) GROUP BY f.map_id`
      )
      .all(ctx.user.id, ...ids);

    const out = maps.map((m) => {
      const s = stats.find((x) => x.map_id === m.id);
      return {
        ...m,
        members: members.filter((x) => x.map_id === m.id).map(({ map_id, ...u }) => u),
        folders: Number(folders.find((x) => x.map_id === m.id)?.n || 0),
        tasks: { total: Number(s?.total || 0), done: Number(s?.done || 0), mine: Number(s?.mine || 0) },
      };
    });
    return { data: { maps: out } };
  });

  // ---- Creer une carte ----
  router.post('/api/maps', async (ctx) => {
    requireAuth(ctx.user);
    if (rateLimited('newmap', String(ctx.user.id), 30, 60 * 60e3)) throw new HttpError(429, 'Doucement ! Réessayez plus tard.');
    const name = text(ctx.body.name, { max: 60, label: 'Nom de la carte' });
    const t = now();
    const r = await db.prepare('INSERT INTO maps (name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, ctx.user.id, t, t);
    await db.prepare("INSERT INTO map_members (map_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(r.lastInsertRowid, ctx.user.id, t);
    return { status: 201, data: { map: { id: r.lastInsertRowid, name } } };
  });

  // ---- Etat complet ----
  router.get('/api/maps/:id', async (ctx) => {
    const { map, role } = await requireMember(ctx.user, ctx.params.id);
    return { data: { state: await mapState(map.id), role } };
  });

  // ---- Renommer (tout membre) ----
  router.patch('/api/maps/:id', async (ctx) => {
    const { map } = await requireMember(ctx.user, ctx.params.id);
    const name = text(ctx.body.name, { max: 60, label: 'Nom de la carte' });
    await db.prepare('UPDATE maps SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), map.id);
    await notifyMap(map.id, { kind: 'map', origin: ctx.clientId });
    return { data: { state: await mapState(map.id) } };
  });

  // ---- Supprimer (créateur uniquement) ----
  router.delete('/api/maps/:id', async (ctx) => {
    const { map } = await requireOwner(ctx.user, ctx.params.id);
    const ids = await memberIds(map.id);
    await db.prepare('DELETE FROM maps WHERE id = ?').run(map.id);
    kickFromMap(map.id);
    sendToUsers(ids, 'maps', { mapId: map.id, deleted: true, name: map.name });
    return { data: { ok: true } };
  });

  // ---- Retirer un membre / quitter la carte ----
  router.delete('/api/maps/:id/members/:userId', async (ctx) => {
    const { map, role } = await requireMember(ctx.user, ctx.params.id);
    const target = id(ctx.params.userId);
    const self = target === ctx.user.id;
    if (self && role === 'owner') throw new HttpError(400, 'Le créateur ne peut pas quitter sa carte (il peut la supprimer).');
    if (!self && role !== 'owner') throw new HttpError(403, 'Seul le créateur peut retirer un membre');
    if (!(await isMember(map.id, target))) throw new HttpError(404, 'Membre introuvable');

    await db.prepare('DELETE FROM map_members WHERE map_id = ? AND user_id = ?').run(map.id, target);
    await db
      .prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ? AND folder_id IN (SELECT id FROM folders WHERE map_id = ?)')
      .run(target, map.id);
    await db.prepare('UPDATE nodes SET assignee_id = NULL WHERE assignee_id = ? AND map_id = ?').run(target, map.id);
    await touchMap(map.id);
    kickFromMap(map.id, [target]);
    sendToUsers([target], 'maps', { mapId: map.id, removed: !self, name: map.name });
    await notifyMap(map.id, { kind: 'member', origin: ctx.clientId });
    return { data: self ? { ok: true } : { state: await mapState(map.id) } };
  });

  // ---- Rechercher un utilisateur par pseudo (pour inviter) ----
  router.get('/api/users/search', async (ctx) => {
    requireAuth(ctx.user);
    const q = String(ctx.query.get('q') || '').trim().toLowerCase().slice(0, 24);
    if (q.length < 1) return { data: { users: [] } };
    const mapId = ctx.query.get('map');
    if (mapId) await requireMember(ctx.user, mapId);

    const users = await db
      .prepare(
        `SELECT id, pseudo, color FROM users
         WHERE pseudo_key LIKE ? ESCAPE '!' AND id <> ?
         ORDER BY LENGTH(pseudo_key), pseudo_key LIMIT 8`
      )
      .all(likePrefix(q), ctx.user.id);

    if (mapId && users.length) {
      const ph = placeholders(users.length);
      const uids = users.map((u) => u.id);
      const mem = await db.prepare(`SELECT user_id FROM map_members WHERE map_id = ? AND user_id IN (${ph})`).all(Number(mapId), ...uids);
      const inv = await db
        .prepare(`SELECT invitee_id FROM invitations WHERE map_id = ? AND status = 'pending' AND invitee_id IN (${ph})`)
        .all(Number(mapId), ...uids);
      for (const u of users) {
        u.status = mem.some((m) => m.user_id === u.id) ? 'member' : inv.some((i) => i.invitee_id === u.id) ? 'invited' : null;
      }
    }
    return { data: { users } };
  });

  // ---- Inviter quelqu'un par son pseudo (tout membre) ----
  router.post('/api/maps/:id/invitations', async (ctx) => {
    const { map } = await requireMember(ctx.user, ctx.params.id);
    if (rateLimited('invite', String(ctx.user.id), 60, 60 * 60e3)) throw new HttpError(429, "Trop d'invitations. Réessayez plus tard.");

    const pseudo = String(ctx.body.pseudo ?? '').trim().toLowerCase();
    if (!pseudo) throw new HttpError(400, 'Pseudo requis');
    const invitee = await db.prepare('SELECT id, pseudo FROM users WHERE pseudo_key = ?').get(pseudo);
    if (!invitee) throw new HttpError(404, `Aucun utilisateur avec le pseudo "${pseudo}"`);
    if (invitee.id === ctx.user.id) throw new HttpError(400, 'Tu fais déjà partie de cette carte 😉');
    if (await isMember(map.id, invitee.id)) throw new HttpError(409, `${invitee.pseudo} fait déjà partie de la carte`);
    if (await db.prepare("SELECT 1 FROM invitations WHERE map_id = ? AND invitee_id = ? AND status = 'pending'").get(map.id, invitee.id))
      throw new HttpError(409, `${invitee.pseudo} a déjà une invitation en attente`);

    await db
      .prepare("INSERT INTO invitations (map_id, inviter_id, invitee_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(map.id, ctx.user.id, invitee.id, now());
    sendToUsers([invitee.id], 'invite', { from: ctx.user.pseudo, mapName: map.name });
    await notifyMap(map.id, { kind: 'invite', origin: ctx.clientId });
    return { status: 201, data: { ok: true, pseudo: invitee.pseudo } };
  });

  // ---- Invitations en attente pour une carte ----
  router.get('/api/maps/:id/invitations', async (ctx) => {
    const { map } = await requireMember(ctx.user, ctx.params.id);
    const invitations = await db
      .prepare(
        `SELECT i.id, i.created_at, u.id AS user_id, u.pseudo, u.color, inv.pseudo AS inviter
         FROM invitations i
         JOIN users u ON u.id = i.invitee_id
         JOIN users inv ON inv.id = i.inviter_id
         WHERE i.map_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC`
      )
      .all(map.id);
    return { data: { invitations } };
  });
}
