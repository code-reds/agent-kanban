import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';

process.env.DB_PATH = ':memory:';

function initFreshDb() {
  resetDb();
}

describe('Migration System', () => {
  beforeEach(() => {
    initFreshDb();
  });

  describe('runMigrations', () => {
    it('should create schema_migrations table', () => {
      runMigrations();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      expect(tables.some(t => t.name === 'schema_migrations')).toBe(true);
    });

    it('should create all expected tables', () => {
      resetDb();
      runMigrations();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      const tableNames = tables.map(t => t.name).sort();
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('roles');
      expect(tableNames).toContain('kanban_columns');
      expect(tableNames).toContain('workflow_transitions');
      expect(tableNames).toContain('tickets');
      expect(tableNames).toContain('conversations');
      expect(tableNames).toContain('messages');
    });

    it('should create all indexes', () => {
      runMigrations();
      const db = getDb();
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
      expect(indexes.some(i => i.name === 'idx_tickets_project')).toBe(true);
      expect(indexes.some(i => i.name === 'idx_messages_conversation')).toBe(true);
    });

    it('should enable WAL mode', () => {
       runMigrations();
       const db = getDb();
       const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
       expect(['wal', 'memory'].includes(journal.journal_mode.toLowerCase())).toBe(true);
     });

     it('should be idempotent - running twice should not error', () => {
       runMigrations();
       expect(() => runMigrations()).not.toThrow();
     });

     it('should track applied migrations in schema_migrations', () => {
       runMigrations();
       const db = getDb();
       const migrations = db.prepare("SELECT * FROM schema_migrations").all() as { migration_name: string }[];
       expect(migrations.some(m => m.migration_name === '000_initial_schema.sql')).toBe(true);
     });

    it('should not re-apply already applied migrations', () => {
      runMigrations();
      const db = getDb();
      const firstCount = db.prepare("SELECT COUNT(*) as total FROM schema_migrations").get() as { total: number };
      runMigrations();
      const secondCount = db.prepare("SELECT COUNT(*) as total FROM schema_migrations").get() as { total: number };
      expect(secondCount.total).toBe(firstCount.total);
    });
  });
});
