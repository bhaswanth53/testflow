/**
 * db.js — Synchronous-style SQLite wrapper using sql.js (pure JavaScript).
 * Loads the DB from disk on first call, writes back after every mutation.
 * No native addons, no Python, no build tools required.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/testflow.db');
const DATA_DIR = path.dirname(DB_PATH);

let _SQL = null;   // sql.js module (loaded once)
let _db  = null;   // open Database instance

// ── Bootstrap: load sql.js module synchronously via child_process trick ──
// sql.js init is async, so we initialise it once at startup and cache.
function getSqlJs() {
  if (_SQL) return _SQL;
  // Run a tiny synchronous loader via execFileSync (Node built-in)
  // Actually: we initialise sql.js on first getDb() call via a top-level await workaround.
  // Since Express routes are all async-safe, we use the preloaded singleton.
  throw new Error('sql.js not yet initialised — call await initSqlJs() first');
}

async function initSqlJs() {
  if (_SQL) return;
  _SQL = await require('sql.js')();
}

// ── Helpers to load/save DB file ──
function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    return new _SQL.Database(buf);
  }
  return new _SQL.Database(); // new empty db
}

function saveDb(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Public API ──

/**
 * Returns a wrapped db object that mirrors better-sqlite3's synchronous API:
 *   db.prepare(sql).get(...params)
 *   db.prepare(sql).all(...params)
 *   db.prepare(sql).run(...params)
 *   db.exec(sql)
 *   db.pragma(...)  — no-op stub (sql.js handles pragmas via exec)
 *   db.close()
 */
function getDb() {
  if (!_SQL) throw new Error('Database not initialised. Ensure initDb() is awaited at startup.');
  const rawDb = loadDb();

  // Execute pragmas
  rawDb.run('PRAGMA journal_mode = WAL;');
  rawDb.run('PRAGMA foreign_keys = ON;');

  let dirty = false;

  function prepare(sql) {
    // Determine if this is a mutating statement
    const isMutation = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql);
    const wantsId = /RETURNING\s+id/i.test(sql);

    return {
      run(...args) {
        const params = flatten(args);
        rawDb.run(sql, params);
        dirty = true;
      },
      get(...args) {
        const params = flatten(args);
        if (wantsId) {
          // Execute and then fetch last_insert_rowid
          rawDb.run(sql.replace(/\s*RETURNING\s+id\s*$/i, ''), params);
          dirty = true;
          const idRow = rawDb.exec('SELECT last_insert_rowid() as id');
          if (idRow.length && idRow[0].values.length) {
            return { id: idRow[0].values[0][0] };
          }
          return null;
        }
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          return zipObject(cols, vals);
        }
        stmt.free();
        return null;
      },
      all(...args) {
        const params = flatten(args);
        const results = rawDb.exec(sql, params);
        if (!results.length) return [];
        const { columns, values } = results[0];
        return values.map(row => zipObject(columns, row));
      }
    };
  }

  function exec(sql) {
    rawDb.exec(sql);
    dirty = true;
  }

  function pragma() {
    // Pragmas are handled via exec above; this is a no-op stub
  }

  function close() {
    if (dirty) saveDb(rawDb);
    rawDb.close();
    dirty = false;
  }

  return { prepare, exec, pragma, close, _raw: rawDb };
}

// ── Schema ──
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#4f7ef8',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES test_groups(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    priority TEXT DEFAULT 'medium',
    type TEXT DEFAULT 'functional',
    status TEXT DEFAULT 'active',
    preconditions TEXT,
    steps TEXT,
    expected_result TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_plan_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_plan_id INTEGER NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
    test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(test_plan_id, test_case_id)
  );
  CREATE TABLE IF NOT EXISTS test_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    test_plan_id INTEGER REFERENCES test_plans(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    test_url TEXT,
    environment TEXT,
    browser TEXT,
    status TEXT DEFAULT 'in_progress',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS test_run_run_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_run_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    assigned_to TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(test_run_id, test_case_id)
  );
  CREATE TABLE IF NOT EXISTS test_run_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_result_id INTEGER NOT NULL REFERENCES test_run_results(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

async function initDb() {
  await initSqlJs();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = getDb();
  // Run each statement individually (sql.js exec doesn't like multi-statement well with IF NOT EXISTS)
  SCHEMA.split(';').map(s => s.trim()).filter(Boolean).forEach(stmt => {
    try { db._raw.run(stmt + ';'); } catch(e) { /* table exists */ }
  });
  saveDb(db._raw);
  db._raw.close();
  console.log('✅ Database initialised at', DB_PATH);
}

// ── Utilities ──
function flatten(args) {
  // args may be (param1, param2) or ([param1, param2])
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function zipObject(keys, vals) {
  const obj = {};
  keys.forEach((k, i) => { obj[k] = vals[i]; });
  return obj;
}

module.exports = { initDb, getDb };
