// ---------------------------------------------------------------------------
//  Securite : hachage des mots de passe, sessions, cookies signes, en-tetes
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, sqlDateTime } from './db.js';

// ------------------------- Mots de passe (scrypt) --------------------------
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// Hash factice : on fait le meme travail scrypt meme si le pseudo n'existe pas,
// pour ne pas reveler par le temps de reponse quels comptes existent.
const DUMMY = hashPassword('orbit-dummy-password');
export function burnPasswordCheck(password) {
  verifyPassword(password, DUMMY.hash, DUMMY.salt);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Le mot de passe doit faire au moins 8 caractères';
  if (pw.length > 200) return 'Mot de passe trop long';
  if (/^(.)\1+$/.test(pw)) return 'Mot de passe trop simple';
  return null;
}

// ------------------------- Sessions & cookies ------------------------------
const COOKIE_NAME = 'orbit_sid';

function sign(value) {
  const sig = crypto.createHmac('sha256', config.SESSION_SECRET).update(value).digest('base64url');
  return `${value}.${sig}`;
}

function unsign(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const expected = Buffer.from(
    crypto.createHmac('sha256', config.SESSION_SECRET).update(value).digest('base64url')
  );
  const given = Buffer.from(signed.slice(idx + 1));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return value;
}

export async function createSession(userId, ip, userAgent) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = sqlDateTime(new Date(Date.now() + config.SESSION_TTL_DAYS * 86400e3));
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, expires, String(ip || '').slice(0, 64), String(userAgent || '').slice(0, 255), sqlDateTime());
  return id;
}

export async function destroySession(sessionId) {
  if (sessionId) await db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function cookie(value, maxAge) {
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (config.SECURE_COOKIES) parts.push('Secure');
  return parts.join('; ');
}
export const buildSessionCookie = (sid) => cookie(sign(sid), config.SESSION_TTL_DAYS * 86400);
export const clearSessionCookie = () => cookie('', 0);

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      /* cookie malforme ignore */
    }
  }
  return out;
}

// Utilisateur connecte d'apres le cookie de session (ou null)
export async function getUserFromRequest(req) {
  const sessionId = unsign(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (!sessionId) return { user: null, sessionId: null };

  const row = await db
    .prepare(
      `SELECT s.expires_at, u.id, u.pseudo, u.color, u.password_hash, u.password_salt, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(sessionId);
  if (!row) return { user: null, sessionId: null };

  if (new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    await destroySession(sessionId);
    return { user: null, sessionId: null };
  }
  delete row.expires_at;
  return { user: row, sessionId };
}

// ------------------------- En-tetes de securite ----------------------------
export function securityHeaders() {
  return {
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

// ------------------------- Limitation de debit -----------------------------
const buckets = new Map(); // "scope:ip" -> { count, first }

export function rateLimited(scope, ip, max = 10, windowMs = 15 * 60e3) {
  const key = `${scope}:${ip}`;
  const t = Date.now();
  const rec = buckets.get(key);
  if (!rec || t - rec.first > windowMs) {
    buckets.set(key, { count: 1, first: t });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}
export function resetRate(scope, ip) {
  buckets.delete(`${scope}:${ip}`);
}
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of buckets) if (t - v.first > 60 * 60e3) buckets.delete(k);
}, 30 * 60e3).unref();
