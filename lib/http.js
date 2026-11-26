// ---------------------------------------------------------------------------
//  Utilitaires HTTP : reponses JSON, lecture du corps, erreurs
// ---------------------------------------------------------------------------
import { securityHeaders } from './security.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...extraHeaders,
  });
  res.end(body);
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

const MAX_BODY = 256 * 1024; // 256 Ko : largement suffisant pour cette API

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Requête trop volumineuse'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

// Derriere le reverse proxy, la vraie IP arrive dans X-Forwarded-For / X-Real-IP
export function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    ''
  );
}

// Protection CSRF : en-tete personnalise obligatoire sur les requetes mutatives
// (impossible a poser depuis un autre site sans CORS), combine au cookie SameSite.
export function assertSameOrigin(req) {
  if (req.headers['x-requested-with'] !== 'orbit') {
    throw new HttpError(403, 'Requête refusée');
  }
}
