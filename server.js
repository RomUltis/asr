// ===========================================================================
//  Orbit — serveur unique (API + front sur un seul port)
//  Zero framework : modules natifs Node.js (+ mysql2 en mode MySQL).
//  Lancement : node server.js
// ===========================================================================
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './lib/config.js';
import { db, initDb, now } from './lib/db.js';
import { Router } from './lib/router.js';
import { sendJson, sendError, readJsonBody, getClientIp, assertSameOrigin, HttpError } from './lib/http.js';
import { getUserFromRequest, securityHeaders } from './lib/security.js';

import * as authRoutes from './lib/routes/auth.js';
import * as mapRoutes from './lib/routes/maps.js';
import * as invitationRoutes from './lib/routes/invitations.js';
import * as boardRoutes from './lib/routes/board.js';
import * as eventRoutes from './lib/routes/events.js';
import * as needRoutes from './lib/routes/needs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const router = new Router();
for (const r of [authRoutes, mapRoutes, invitationRoutes, boardRoutes, needRoutes, eventRoutes]) r.register(router);

// ---------------------------------------------------------------------------
//  Fichiers statiques
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) return false;
  try {
    let target = filePath;
    let s = await stat(target);
    if (s.isDirectory()) {
      target = join(target, 'index.html');
      s = await stat(target);
    }
    const ext = extname(target).toLowerCase();
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ['.svg', '.png', '.webp', '.ico', '.woff2'].includes(ext) ? 'public, max-age=86400' : 'no-cache',
      ...securityHeaders(),
    });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Serveur HTTP
// ---------------------------------------------------------------------------
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendError(res, 400, 'URL invalide');
    }

    // --- API ---
    if (pathname.startsWith('/api/')) {
      const matched = router.match(req.method, pathname);
      if (!matched) return sendError(res, 404, 'Endpoint introuvable');

      let body = {};
      if (MUTATING.has(req.method)) {
        assertSameOrigin(req);
        body = await readJsonBody(req);
      }
      const { user, sessionId } = await getUserFromRequest(req);
      const ctx = {
        req,
        res,
        params: matched.params,
        query: url.searchParams,
        body,
        user,
        sessionId,
        ip: getClientIp(req),
        clientId: String(req.headers['x-client-id'] || '').replace(/[^a-z0-9]/gi, '').slice(0, 40),
      };
      const result = await matched.handler(ctx);
      if (result === undefined) return; // reponse geree par le handler (SSE)
      return sendJson(res, result.status || 200, result.data ?? {}, result.headers || {});
    }

    // --- Front : fichiers statiques + fallback SPA ---
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await serveStatic(req, res, pathname)) return;
      if (extname(pathname)) return sendError(res, 404, 'Fichier introuvable');
      const index = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...securityHeaders() });
      return res.end(index);
    }
    return sendError(res, 405, 'Méthode non autorisée');
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message);
    console.error('[server] Erreur non geree :', err);
    if (!res.headersSent) return sendError(res, 500, 'Erreur interne du serveur');
    res.end();
  }
});

// Les flux SSE restent ouverts : pas de timeout de requete global
server.requestTimeout = 0;
server.headersTimeout = 30e3;

// ---------------------------------------------------------------------------
//  Nettoyage periodique : sessions expirees, vieilles invitations traitees
// ---------------------------------------------------------------------------
async function cleanup() {
  try {
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    const old = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
    await db.prepare("DELETE FROM invitations WHERE status <> 'pending' AND responded_at < ?").run(old);
  } catch (e) {
    console.error('[cleanup]', e.message);
  }
}

async function main() {
  await initDb();
  await cleanup();
  setInterval(cleanup, 60 * 60e3).unref();
  server.listen(config.PORT, config.HOST, () => {
    console.log('===========================================================');
    console.log(`  Orbit pret : http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
    console.log('===========================================================');
  });
}

main().catch((err) => {
  console.error('[server] Echec du demarrage :', err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[server] Arret...');
    try {
      const raw = db.raw;
      if (raw?.close) raw.close();
      else if (raw?.end) raw.end();
    } catch {}
    process.exit(0);
  });
}
