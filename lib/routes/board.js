// ---------------------------------------------------------------------------
//  Dossiers (noeuds de la carte) et taches (tableau facon Trello)
//  Chaque mutation renvoie l'etat complet de la carte et notifie les membres.
// ---------------------------------------------------------------------------
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import {
  requireMember,
  requireFolder,
  requireTask,
  text,
  longText,
  color,
  coord,
  dateOnly,
  isMember,
  touchMap,
} from '../helpers.js';
import { notifyMap } from '../realtime.js';
import { mapState } from './maps.js';

const MAX_FOLDERS = 60;
const MAX_TASKS_PER_FOLDER = 300;

async function changed(ctx, mapId, kind) {
  await touchMap(mapId);
  await notifyMap(mapId, { kind, origin: ctx.clientId });
  return { data: { state: await mapState(mapId) } };
}

async function cleanAssignee(mapId, v) {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  const uid = Number(v);
  if (!Number.isInteger(uid) || !(await isMember(mapId, uid)))
    throw new HttpError(400, "Cette personne ne fait pas partie de la carte");
  return uid;
}

export function register(router) {
  // ------------------------------ Dossiers ---------------------------------
  router.post('/api/maps/:id/folders', async (ctx) => {
    const { map } = await requireMember(ctx.user, ctx.params.id);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM folders WHERE map_id = ?').get(map.id);
    if (Number(count.n) >= MAX_FOLDERS) throw new HttpError(400, `Maximum ${MAX_FOLDERS} dossiers par carte`);

    const t = now();
    const r = await db
      .prepare('INSERT INTO folders (map_id, title, color, x, y, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        map.id,
        text(ctx.body.title, { max: 60, label: 'Nom du dossier' }),
        color(ctx.body.color),
        coord(ctx.body.x),
        coord(ctx.body.y),
        ctx.user.id,
        t,
        t
      );
    const res = await changed(ctx, map.id, 'folder');
    res.status = 201;
    res.data.folderId = r.lastInsertRowid;
    return res;
  });

  router.patch('/api/folders/:id', async (ctx) => {
    const f = await requireFolder(ctx.user, ctx.params.id);
    const b = ctx.body;
    const title = b.title !== undefined ? text(b.title, { max: 60, label: 'Nom du dossier' }) : f.title;
    const col = b.color !== undefined ? color(b.color, f.color) : f.color;
    const x = b.x !== undefined ? coord(b.x) : Number(f.x);
    const y = b.y !== undefined ? coord(b.y) : Number(f.y);
    await db
      .prepare('UPDATE folders SET title = ?, color = ?, x = ?, y = ?, updated_at = ? WHERE id = ?')
      .run(title, col, x, y, now(), f.id);

    // Simple deplacement : evenement leger, pas de rechargement complet chez les autres
    const onlyMove = b.title === undefined && b.color === undefined;
    if (onlyMove) {
      await notifyMap(f.map_id, { id: f.id, x, y, origin: ctx.clientId }, 'moved');
      return { data: { ok: true } };
    }
    return changed(ctx, f.map_id, 'folder');
  });

  router.delete('/api/folders/:id', async (ctx) => {
    const f = await requireFolder(ctx.user, ctx.params.id);
    await db.prepare('DELETE FROM folders WHERE id = ?').run(f.id);
    return changed(ctx, f.map_id, 'folder');
  });

  // ------------------------------- Taches ----------------------------------
  router.post('/api/folders/:id/tasks', async (ctx) => {
    const f = await requireFolder(ctx.user, ctx.params.id);
    const stats = await db.prepare('SELECT COUNT(*) AS n, MAX(position) AS maxpos FROM tasks WHERE folder_id = ?').get(f.id);
    if (Number(stats.n) >= MAX_TASKS_PER_FOLDER) throw new HttpError(400, 'Ce dossier contient trop de tâches');

    const t = now();
    await db
      .prepare(
        `INSERT INTO tasks (folder_id, title, description, assignee_id, done, position, due_date, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
      )
      .run(
        f.id,
        text(ctx.body.title, { max: 140, label: 'Titre de la tâche' }),
        longText(ctx.body.description),
        await cleanAssignee(f.map_id, ctx.body.assignee_id),
        Number(stats.maxpos || 0) + 1,
        dateOnly(ctx.body.due_date),
        ctx.user.id,
        t,
        t
      );
    const res = await changed(ctx, f.map_id, 'task');
    res.status = 201;
    return res;
  });

  router.patch('/api/tasks/:id', async (ctx) => {
    const task = await requireTask(ctx.user, ctx.params.id);
    const b = ctx.body;
    const done = b.done !== undefined ? (b.done ? 1 : 0) : Number(task.done);
    let doneAt = task.done_at;
    if (done && !Number(task.done)) doneAt = now();
    if (!done) doneAt = null;

    let position = Number(task.position);
    if (b.position !== undefined) {
      position = Number(b.position);
      if (!Number.isFinite(position)) throw new HttpError(400, 'Position invalide');
    }

    await db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, assignee_id = ?, done = ?, position = ?, due_date = ?,
                          done_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        b.title !== undefined ? text(b.title, { max: 140, label: 'Titre de la tâche' }) : task.title,
        b.description !== undefined ? longText(b.description) : task.description,
        b.assignee_id !== undefined ? await cleanAssignee(task.map_id, b.assignee_id) : task.assignee_id,
        done,
        position,
        b.due_date !== undefined ? dateOnly(b.due_date) : task.due_date,
        doneAt,
        now(),
        task.id
      );
    return changed(ctx, task.map_id, 'task');
  });

  router.delete('/api/tasks/:id', async (ctx) => {
    const task = await requireTask(ctx.user, ctx.params.id);
    await db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    return changed(ctx, task.map_id, 'task');
  });
}
