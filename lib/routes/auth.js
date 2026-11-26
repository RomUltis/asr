// ---------------------------------------------------------------------------
//  Authentification : inscription, connexion, deconnexion, profil
// ---------------------------------------------------------------------------
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  validatePassword,
  createSession,
  destroySession,
  buildSessionCookie,
  clearSessionCookie,
  rateLimited,
  resetRate,
} from '../security.js';
import { requireAuth, publicUser, color, PALETTE } from '../helpers.js';
import { notifyMap } from '../realtime.js';

const PSEUDO_RE = /^[A-Za-z0-9_.-]{3,24}$/;

function cleanPseudo(v) {
  const pseudo = String(v ?? '').trim();
  if (!PSEUDO_RE.test(pseudo))
    throw new HttpError(400, 'Pseudo : 3 à 24 caractères (lettres, chiffres, . _ -)');
  return pseudo;
}

const pseudoTaken = async (key, exceptId = 0) =>
  !!(await db.prepare('SELECT 1 FROM users WHERE pseudo_key = ? AND id <> ?').get(key, exceptId));

async function notifyMyMaps(userId) {
  const maps = await db.prepare('SELECT map_id FROM map_members WHERE user_id = ?').all(userId);
  for (const m of maps) await notifyMap(m.map_id, { kind: 'member' });
}

export function register(router) {
  // ---- Inscription ----
  router.post('/api/auth/register', async (ctx) => {
    if (rateLimited('register', ctx.ip, 8, 60 * 60e3))
      throw new HttpError(429, 'Trop de comptes créés depuis cette adresse. Réessayez plus tard.');

    const pseudo = cleanPseudo(ctx.body.pseudo);
    const password = String(ctx.body.password ?? '');
    const pwError = validatePassword(password);
    if (pwError) throw new HttpError(400, pwError);

    if (await pseudoTaken(pseudo.toLowerCase())) throw new HttpError(409, 'Ce pseudo est déjà pris');

    const { hash, salt } = hashPassword(password);
    const t = now();
    let res;
    try {
      res = await db
        .prepare(
          `INSERT INTO users (pseudo, pseudo_key, color, password_hash, password_salt, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(pseudo, pseudo.toLowerCase(), PALETTE[Math.floor(Math.random() * PALETTE.length)], hash, salt, t, t);
    } catch {
      throw new HttpError(409, 'Ce pseudo est déjà pris');
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid);
    const sid = await createSession(user.id, ctx.ip, ctx.req.headers['user-agent']);
    return {
      status: 201,
      data: { user: publicUser(user) },
      headers: { 'Set-Cookie': buildSessionCookie(sid) },
    };
  });

  // ---- Disponibilite d'un pseudo (verification en direct du formulaire) ----
  router.get('/api/auth/pseudo-available', async (ctx) => {
    const pseudo = String(ctx.query.get('pseudo') || '').trim();
    if (!PSEUDO_RE.test(pseudo)) return { data: { available: false, valid: false } };
    return { data: { available: !(await pseudoTaken(pseudo.toLowerCase(), ctx.user?.id || 0)), valid: true } };
  });

  // ---- Connexion ----
  router.post('/api/auth/login', async (ctx) => {
    if (rateLimited('login', ctx.ip, 10)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');

    const pseudo = String(ctx.body.pseudo ?? '').trim().toLowerCase();
    const password = String(ctx.body.password ?? '');
    if (!pseudo || !password) throw new HttpError(400, 'Pseudo et mot de passe requis');

    const user = await db.prepare('SELECT * FROM users WHERE pseudo_key = ?').get(pseudo);
    if (!user) {
      burnPasswordCheck(password);
      throw new HttpError(401, 'Pseudo ou mot de passe incorrect');
    }
    if (!verifyPassword(password, user.password_hash, user.password_salt))
      throw new HttpError(401, 'Pseudo ou mot de passe incorrect');

    resetRate('login', ctx.ip);
    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
    const sid = await createSession(user.id, ctx.ip, ctx.req.headers['user-agent']);
    return { data: { user: publicUser(user) }, headers: { 'Set-Cookie': buildSessionCookie(sid) } };
  });

  // ---- Deconnexion ----
  router.post('/api/auth/logout', async (ctx) => {
    await destroySession(ctx.sessionId);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } };
  });

  // ---- Utilisateur courant ----
  router.get('/api/auth/me', async (ctx) => ({ data: { user: publicUser(ctx.user) } }));

  // ---- Modifier son profil (pseudo, couleur) ----
  router.patch('/api/auth/me', async (ctx) => {
    requireAuth(ctx.user);
    const pseudo = ctx.body.pseudo !== undefined ? cleanPseudo(ctx.body.pseudo) : ctx.user.pseudo;
    const col = ctx.body.color !== undefined ? color(ctx.body.color, ctx.user.color) : ctx.user.color;
    if (pseudo.toLowerCase() !== ctx.user.pseudo.toLowerCase() && (await pseudoTaken(pseudo.toLowerCase(), ctx.user.id)))
      throw new HttpError(409, 'Ce pseudo est déjà pris');

    await db
      .prepare('UPDATE users SET pseudo = ?, pseudo_key = ?, color = ? WHERE id = ?')
      .run(pseudo, pseudo.toLowerCase(), col, ctx.user.id);
    await notifyMyMaps(ctx.user.id);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
    return { data: { user: publicUser(user) } };
  });

  // ---- Changer son mot de passe (deconnecte les autres appareils) ----
  router.post('/api/auth/password', async (ctx) => {
    requireAuth(ctx.user);
    if (rateLimited('password', ctx.ip, 10)) throw new HttpError(429, 'Trop de tentatives. Réessayez plus tard.');
    const current = String(ctx.body.current ?? '');
    const next = String(ctx.body.next ?? '');
    if (!verifyPassword(current, ctx.user.password_hash, ctx.user.password_salt))
      throw new HttpError(400, 'Mot de passe actuel incorrect');
    const pwError = validatePassword(next);
    if (pwError) throw new HttpError(400, pwError);

    const { hash, salt } = hashPassword(next);
    await db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, ctx.user.id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(ctx.user.id, ctx.sessionId);
    return { data: { ok: true } };
  });
}
