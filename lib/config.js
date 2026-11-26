// ---------------------------------------------------------------------------
//  Chargement de la configuration depuis le fichier .env (parseur maison)
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function parseEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envPath = join(ROOT, '.env');
let fileEnv = {};
if (existsSync(envPath)) {
  fileEnv = parseEnv(readFileSync(envPath, 'utf8'));
} else {
  console.warn('[config] Aucun fichier .env trouve : valeurs par defaut (NON securisees).');
}

// Les variables d'environnement du systeme priment sur le fichier .env
function get(key, fallback) {
  return process.env[key] ?? fileEnv[key] ?? fallback;
}

export const config = {
  ROOT,
  PORT: parseInt(get('PORT', '56200'), 10),
  HOST: get('HOST', '127.0.0.1'),
  SESSION_SECRET: get('SESSION_SECRET', 'INSECURE-DEV-SECRET-CHANGE-ME'),
  SESSION_TTL_DAYS: parseInt(get('SESSION_TTL_DAYS', '14'), 10),
  SECURE_COOKIES: get('SECURE_COOKIES', 'false').toLowerCase() === 'true',
  db: {
    driver: get('DB_DRIVER', 'sqlite').toLowerCase(),
    host: get('DB_HOST', '127.0.0.1'),
    port: parseInt(get('DB_PORT', '3306'), 10),
    user: get('DB_USER', 'root'),
    password: get('DB_PASSWORD', ''),
    database: get('DB_NAME', 'orbit'),
  },
};

if (config.SESSION_SECRET === 'INSECURE-DEV-SECRET-CHANGE-ME' || config.SESSION_SECRET.startsWith('changez-moi')) {
  console.warn('[config] ATTENTION : SESSION_SECRET par defaut. Definissez un vrai secret dans .env.');
}
