process.env.DB_PATH = ':memory:';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb, closeDb } from '../db/database.js';

describe('Database Module', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('getDb', () => {
    it('should return a database instance', () => {
      const db = getDb();
      expect(db).toBeDefined();
    });

    it('should return the same instance (singleton)', () => {
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
    });

    it('should be able to execute queries', () => {
      const db = getDb();
      const result = db.prepare('SELECT 1 as value').get() as { value: number };
      expect(result.value).toBe(1);
    });
  });

  describe('resetDb', () => {
    it('should close the database, producing a fresh instance on next getDb', () => {
      const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tableName = `test_reset_${uniqueId}`;
      const db = getDb();
      db.prepare(`CREATE TABLE ${tableName} (id INTEGER)`).run();
      const existsBefore = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName) as { name: string } | undefined;
      expect(existsBefore).toBeDefined();
      resetDb();
      const db2 = getDb();
      expect(db2).toBeDefined();
      expect(db).not.toBe(db2);
      const existsAfter = db2.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName) as { name: string } | undefined;
      expect(existsAfter).toBeUndefined();
    });
  });

  describe('closeDb', () => {
    it('should close the database connection', () => {
      const db = getDb();
      closeDb();
      expect(() => db.prepare('SELECT 1').get()).toThrow();
    });
  });
});
