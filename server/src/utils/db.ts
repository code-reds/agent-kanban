import type { Database } from 'better-sqlite3';

/**
 * Execute a function within a database transaction.
 *
 * Automatically handles BEGIN TRANSACTION, COMMIT, and ROLLBACK.
 * If the function throws, the transaction is rolled back and the error
 * is re-thrown.
 *
 * Usage:
 *   withTransaction(db, (db) => {
 *     db.prepare('UPDATE ...').run();
 *     db.prepare('INSERT ...').run();
 *     return result;
 *   });
 */
export function withTransaction<T>(db: Database, fn: (db: Database) => T): T {
  db.exec('BEGIN TRANSACTION');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}
