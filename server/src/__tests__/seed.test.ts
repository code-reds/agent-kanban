import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
}

describe('Seed Functions', () => {
  beforeEach(() => {
    initDb();
  });

  describe('seedDefaultRoles', () => {
    it('should seed 7 default roles', () => {
      seedDefaultRoles();
      const db = getDb();
      const roles = db.prepare('SELECT COUNT(*) as total FROM roles').get() as { total: number };
      expect(roles.total).toBe(7);
    });

    it('should seed specific roles', () => {
      seedDefaultRoles();
      const db = getDb();
      const humanUser = db.prepare("SELECT * FROM roles WHERE name = 'Human User'").get();
      expect(humanUser).toBeDefined();
      const aiDeveloper = db.prepare("SELECT * FROM roles WHERE name = 'AI code developer'").get();
      expect(aiDeveloper).toBeDefined();
    });

    it('should be idempotent', () => {
      seedDefaultRoles();
      seedDefaultRoles();
      const db = getDb();
      const roles = db.prepare('SELECT COUNT(*) as total FROM roles').get() as { total: number };
      expect(roles.total).toBe(7);
    });
  });

  describe('seedProjectColumns', () => {
    it('should seed 7 default columns', () => {
      seedDefaultRoles();
      const db = getDb();
      const slug = `test-cols-${Date.now()}`;
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', slug);
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map(r => r.id));
      const columns = db.prepare('SELECT COUNT(*) as total FROM kanban_columns WHERE project_id = ?').get(project.id) as { total: number };
      expect(columns.total).toBe(7);
    });

    it('should create columns with correct slugs', () => {
      seedDefaultRoles();
      const db = getDb();
      const slug = `test-slugs-${Date.now()}`;
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', slug);
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map(r => r.id));
      const slugs = db.prepare('SELECT slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { slug: string }[];
      expect(slugs.map(s => s.slug)).toEqual(['todo', 'implementation', 'unit_review', 'integration_testing', 'final_review', 'done', 'human_feedback']);
    });

    it('should seed workflow transitions', () => {
      seedDefaultRoles();
      const db = getDb();
      const slug = `test-wf-${Date.now()}`;
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', slug);
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map(r => r.id));
      const transitions = db.prepare('SELECT COUNT(*) as total FROM workflow_transitions WHERE project_id = ?').get(project.id) as { total: number };
      expect(transitions.total).toBe(19);
    });

    it('should create access rules', () => {
      seedDefaultRoles();
      const db = getDb();
      const slug = `test-ar-${Date.now()}`;
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', slug);
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map(r => r.id));
      const rules = db.prepare('SELECT COUNT(*) as total FROM ticket_access_rules WHERE project_id = ?').get(project.id) as { total: number };
      expect(rules.total).toBeGreaterThan(0);
    });

    it('should be idempotent', () => {
      seedDefaultRoles();
      const db = getDb();
      const slug = `test-idem-${Date.now()}`;
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', slug);
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map(r => r.id));
      const firstCount = db.prepare('SELECT COUNT(*) as total FROM workflow_transitions WHERE project_id = ?').get(project.id) as { total: number };
      seedProjectColumns(project.id, roleIds.map(r => r.id));
      const secondCount = db.prepare('SELECT COUNT(*) as total FROM workflow_transitions WHERE project_id = ?').get(project.id) as { total: number };
      expect(secondCount.total).toBe(firstCount.total);
    });
  });
});
