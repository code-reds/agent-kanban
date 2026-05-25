import { getDb, resetDb } from './src/db/database.js';

process.env.DB_PATH = ':memory:';

const db = getDb();
db.prepare('CREATE TABLE test_12345 (id INTEGER)').run();
const t1 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_12345'").get();
console.log('Table in db (before reset):', t1);

resetDb();

const db2 = getDb();
const t2 = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_12345'").get();
console.log('Table in db2 (after reset):', t2);
console.log('Same instance:', db === db2);
