// ---------------------------------------------------------------------------
//  Base de donnees — double moteur :
//    - "sqlite" : node:sqlite natif (Node >= 22.5), zero configuration, pour le local
//    - "mysql"  : MySQL / MariaDB (VPS avec phpMyAdmin)
//  Interface identique et asynchrone : db.prepare(sql).get/all/run(...params)
//  Toutes les dates sont generees cote JS en UTC (sqlDateTime) : aucune
//  dependance au fuseau horaire du serveur MySQL.
// ---------------------------------------------------------------------------
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const DRIVER = config.db.driver === 'mariadb' ? 'mysql' : config.db.driver;
export const isMysql = DRIVER === 'mysql';

// "YYYY-MM-DD HH:MM:SS" en UTC — compatible SQLite TEXT et MySQL DATETIME
export function sqlDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
export const now = () => sqlDateTime();

let backend = null;

export const db = {
  prepare(sql) {
    return {
      get: (...p) => backend.get(sql, p),
      all: (...p) => backend.all(sql, p),
      run: (...p) => backend.run(sql, p),
    };
  },
  exec: (sql) => backend.exec(sql),
  get raw() {
    return backend?.raw;
  },
};

// Genere "?, ?, ?" pour une clause IN
export const placeholders = (n) => new Array(n).fill('?').join(', ');

// ---------------------------------------------------------------------------
//  Initialisation
// ---------------------------------------------------------------------------
export async function initDb() {
  if (isMysql) await initMysql();
  else await initSqlite();

  try {
    await ensureTables();
    await migrate();
  } catch (e) {
    console.error('[db] ECHEC de preparation du schema :', e.code || '', e.message);
    if (e.code === 'ER_TABLEACCESS_DENIED_ERROR' || e.code === 'ER_DBACCESS_DENIED_ERROR')
      console.error("     -> L'utilisateur MySQL n'a pas le droit CREATE : importez schema.sql dans phpMyAdmin.");
    process.exit(1);
  }

  console.log(
    isMysql
      ? `[db] ✓ MySQL/MariaDB : ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`
      : '[db] ✓ SQLite : data/orbit.db (mode local — phpMyAdmin ne voit pas cette base)'
  );
}

// Cree uniquement les tables manquantes (aucun privilege CREATE requis si tout
// a deja ete importe via schema.sql dans phpMyAdmin).
const TABLES = ['users', 'sessions', 'maps', 'map_members', 'invitations', 'folders', 'tasks', 'nodes', 'node_links'];

async function ensureTables() {
  const schema = isMysql
    ? readFileSync(join(config.ROOT, 'schema.sql'), 'utf8').replace(/^\s*--.*$/gm, '')
    : SCHEMA_SQLITE;
  const statements = schema.split(';').map((x) => x.trim()).filter(Boolean);
  for (const table of TABLES) {
    if (await backend.tableExists(table)) continue;
    console.log(`[db] Creation de la table ${table}...`);
    const re = new RegExp(`(CREATE TABLE IF NOT EXISTS ${table} \\(|ON ${table}\\()`);
    for (const stmt of statements) if (re.test(stmt)) await backend.exec(stmt);
  }
}

// Migrations des bases creees par une version precedente
async function migrate() {
  // v1.1 : les comptes n'ont plus d'email (connexion par pseudo)
  if (await backend.columnExists('users', 'email')) {
    console.log('[db] Migration : suppression de la colonne email des comptes...');
    if (isMysql) {
      await backend.exec('ALTER TABLE users DROP COLUMN email');
    } else {
      // SQLite ne sait pas supprimer une colonne UNIQUE : on reconstruit la table
      const sq = backend.raw;
      sq.exec('PRAGMA foreign_keys = OFF');
      try {
        sq.exec('BEGIN');
        sq.exec(SQLITE_USERS.replace('CREATE TABLE IF NOT EXISTS users', 'CREATE TABLE users_new'));
        sq.exec(
          `INSERT INTO users_new (id, pseudo, pseudo_key, color, password_hash, password_salt, created_at, last_login_at)
           SELECT id, pseudo, pseudo_key, color, password_hash, password_salt, created_at, last_login_at FROM users`
        );
        sq.exec('DROP TABLE users');
        sq.exec('ALTER TABLE users_new RENAME TO users');
        sq.exec('COMMIT');
      } catch (e) {
        sq.exec('ROLLBACK');
        throw e;
      } finally {
        sq.exec('PRAGMA foreign_keys = ON');
      }
    }
  }
}

async function initSqlite() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(
      `[db] SQLite natif indisponible sur Node ${process.version}.\n` +
        '     -> Utilisez Node >= 22.5, ou passez en MySQL : DB_DRIVER=mysql dans .env'
    );
    process.exit(1);
  }
  mkdirSync(join(config.ROOT, 'data'), { recursive: true });
  const sq = new DatabaseSync(join(config.ROOT, 'data', 'orbit.db'));
  sq.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const guard = (fn, sql) => {
    try {
      return fn();
    } catch (e) {
      console.error(`[db] ERREUR SQL : ${e.message}\n     ${sql.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
      throw e;
    }
  };

  backend = {
    raw: sq,
    async get(sql, p) {
      return guard(() => sq.prepare(sql).get(...p), sql);
    },
    async all(sql, p) {
      return guard(() => sq.prepare(sql).all(...p), sql);
    },
    async run(sql, p) {
      return guard(() => {
        const r = sq.prepare(sql).run(...p);
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
      }, sql);
    },
    async exec(sql) {
      sq.exec(sql);
    },
    async tableExists(name) {
      return !!sq.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    },
    async columnExists(table, column) {
      return sq.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    },
  };
}

async function initMysql() {
  let mysql;
  try {
    mysql = await import('mysql2/promise');
  } catch {
    console.error('[db] Le module "mysql2" est requis pour DB_DRIVER=mysql : lancez "npm install".');
    process.exit(1);
  }
  const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    dateStrings: true,
  });

  const target = `${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`;
  try {
    const c = await pool.getConnection();
    await c.ping();
    c.release();
  } catch (e) {
    console.error(`[db] ✗ CONNEXION MYSQL IMPOSSIBLE (${target})`);
    console.error(`     ${e.code || ''} ${e.message}`);
    console.error('     Verifiez DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME dans .env');
    process.exit(1);
  }

  const q = async (sql, p) => {
    try {
      return await pool.query(sql, p);
    } catch (e) {
      console.error(`[db] ERREUR SQL (${e.code || '?'}) : ${e.message}\n     ${sql.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
      throw e;
    }
  };

  backend = {
    raw: pool,
    async get(sql, p) {
      const [rows] = await q(sql, p);
      return rows[0];
    },
    async all(sql, p) {
      const [rows] = await q(sql, p);
      return rows;
    },
    async run(sql, p) {
      const [res] = await q(sql, p);
      return { lastInsertRowid: res.insertId, changes: res.affectedRows };
    },
    async exec(sql) {
      for (const stmt of sql.split(';')) {
        const s = stmt.trim();
        if (s) await q(s, []);
      }
    },
    async tableExists(name) {
      const [rows] = await pool.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1',
        [config.db.database, name]
      );
      return rows.length > 0;
    },
    async columnExists(table, column) {
      const [rows] = await pool.query(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1',
        [config.db.database, table, column]
      );
      return rows.length > 0;
    },
  };
}

// ---------------------------------------------------------------------------
//  Schema SQLite (equivalent de schema.sql pour MySQL)
// ---------------------------------------------------------------------------
const SQLITE_USERS = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo TEXT NOT NULL,
  pseudo_key TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6366f1',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
)`;

const SCHEMA_SQLITE = `
${SQLITE_USERS};
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS map_members (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (map_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON map_members(user_id);
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_invitee ON invitations(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_map ON invitations(map_id, status);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_map ON folders(map_id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_folder ON tasks(folder_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'besoin',
  title TEXT NOT NULL,
  description TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_map ON nodes(map_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE TABLE IF NOT EXISTS node_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_links_map ON node_links(map_id);
`;
