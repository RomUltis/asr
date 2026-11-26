// ---------------------------------------------------------------------------
//  Helpers metier partages : validation, droits d'acces aux cartes
// ---------------------------------------------------------------------------
import { db, now } from './db.js';
import { HttpError } from './http.js';

export const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#f59e0b', '#10b981', '#14b8a6', '#0ea5e9', '#64748b',
];

export function requireAuth(user) {
  if (!user) throw new HttpError(401, 'Connexion requise');
}

// Texte obligatoire, nettoye et borne
export function text(v, { max = 200, min = 1, label = 'Champ' } = {}) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min) throw new HttpError(400, `${label} requis`);
  if (s.length > max) throw new HttpError(400, `${label} trop long (${max} caractères max)`);
  return s;
}

// Texte libre multi-lignes (description), facultatif
export function longText(v, max = 4000) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(400, `Texte trop long (${max} caractères max)`);
  return s;
}

export function color(v, fallback = PALETTE[0]) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}

export function coord(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-20000, Math.min(20000, Math.round(n * 10) / 10));
}

export function dateOnly(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'Date invalide');
  return v;
}

export function id(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Introuvable');
  return n;
}

// Verifie que l'utilisateur est membre de la carte ; renvoie { map, role }
export async function requireMember(user, mapId) {
  requireAuth(user);
  const row = await db
    .prepare(
      `SELECT m.id, m.name, m.owner_id, m.created_at, m.updated_at, mm.role
       FROM maps m JOIN map_members mm ON mm.map_id = m.id AND mm.user_id = ?
       WHERE m.id = ?`
    )
    .get(user.id, id(mapId));
  if (!row) throw new HttpError(404, 'Carte introuvable');
  const { role, ...map } = row;
  return { map, role };
}

export async function requireOwner(user, mapId) {
  const r = await requireMember(user, mapId);
  if (r.role !== 'owner') throw new HttpError(403, 'Réservé au créateur de la carte');
  return r;
}

// Dossier + verification d'appartenance a une carte dont l'utilisateur est membre
export async function requireFolder(user, folderId) {
  requireAuth(user);
  const f = await db.prepare('SELECT * FROM folders WHERE id = ?').get(id(folderId));
  if (!f) throw new HttpError(404, 'Dossier introuvable');
  await requireMember(user, f.map_id);
  return f;
}

export async function requireTask(user, taskId) {
  requireAuth(user);
  const t = await db
    .prepare('SELECT t.*, f.map_id FROM tasks t JOIN folders f ON f.id = t.folder_id WHERE t.id = ?')
    .get(id(taskId));
  if (!t) throw new HttpError(404, 'Tâche introuvable');
  await requireMember(user, t.map_id);
  return t;
}

export async function isMember(mapId, userId) {
  return !!(await db.prepare('SELECT 1 FROM map_members WHERE map_id = ? AND user_id = ?').get(mapId, userId));
}

export async function memberIds(mapId) {
  const rows = await db.prepare('SELECT user_id FROM map_members WHERE map_id = ?').all(mapId);
  return rows.map((r) => r.user_id);
}

export async function touchMap(mapId) {
  await db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').run(now(), mapId);
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, pseudo: u.pseudo, color: u.color, created_at: u.created_at };
}
