```sh
node -e "
const { getDb, initDb } = require('./src/utils/db');
initDb().then(() => {
  const db = getDb();
  try { db._raw.run('ALTER TABLE test_runs ADD COLUMN test_url TEXT'); console.log('added test_url'); } catch(e) { console.log('test_url exists'); }
  try { db._raw.run('ALTER TABLE test_runs ADD COLUMN environment TEXT'); console.log('added environment'); } catch(e) { console.log('environment exists'); }
  try { db._raw.run('ALTER TABLE test_runs ADD COLUMN browser TEXT'); console.log('added browser'); } catch(e) { console.log('browser exists'); }
  try { db._raw.run(\`CREATE TABLE IF NOT EXISTS test_run_run_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )\`); console.log('created test_run_run_notes'); } catch(e) { console.log('already exists'); }
  db.close();
  console.log('Migration done');
}).catch(e => console.error(e));
"
```

```sh
node -e "
const { getDb, initDb } = require('./src/utils/db');
initDb().then(() => {
  const db = getDb();
  try { db._raw.run('ALTER TABLE test_runs ADD COLUMN test_url TEXT'); console.log('added test_url'); } catch(e) { console.log('test_url already exists'); }
  try { db._raw.run('ALTER TABLE test_runs ADD COLUMN environment TEXT'); console.log('added environment'); } catch(e) { console.log('environment already exists'); }
  try { db._raw.run('ALTER TABLE test_runs ADD COLUMN browser TEXT'); console.log('added browser'); } catch(e) { console.log('browser already exists'); }
  try { db._raw.run(\`CREATE TABLE IF NOT EXISTS test_run_run_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )\`); console.log('created test_run_run_notes'); } catch(e) { console.log('table already exists'); }
  db.close();
  console.log('Migration done');
}).catch(e => console.error(e));
"
```