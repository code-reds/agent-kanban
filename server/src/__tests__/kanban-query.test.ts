import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as kanban from '../db/queries/kanban.js';
import * as tickets from '../db/queries/tickets.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
  try { db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''"); } catch {}
}

describe('Kanban Query Functions', () => {
  beforeEach(() => {
    initDb();
  });

  function createProject() {
    const db = getDb();
    const slug = `test-kanban-${Date.now()}`;
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Kanban', slug);
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map(r => r.id));
    return project;
  }

  describe('getColumnsByProject', () => {
    it('should return default columns', () => {
      const project = createProject();
      const columns = kanban.getColumnsByProject(project.id);
      expect(columns.length).toBeGreaterThan(0);
      const slugs = columns.map(c => c.slug);
      expect(slugs).toContain('todo');
      expect(slugs).toContain('implementation');
      expect(slugs).toContain('done');
    });

    it('should return columns ordered by order field', () => {
      const project = createProject();
      const columns = kanban.getColumnsByProject(project.id);
      for (let i = 1; i < columns.length; i++) {
        expect(columns[i].order).toBeGreaterThan(columns[i - 1].order);
      }
    });

    it('should return empty array for non-existent project', () => {
      const columns = kanban.getColumnsByProject(9999);
      expect(columns).toHaveLength(0);
    });
  });

  describe('getColumnsByProject', () => {
    it('should return columns for a project', () => {
      const project = createProject();
      const columns = kanban.getColumnsByProject(project.id);
      expect(columns.length).toBeGreaterThan(0);
    });
  });

  describe('createColumn', () => {
    it('should create a custom column', () => {
      const project = createProject();
      const col = kanban.createColumn(project.id, 'custom-col', 'Custom Column', 10, false);
      expect(col).toBeDefined();
      expect(col!.slug).toBe('custom-col');
      expect(col!.name).toBe('Custom Column');
      expect(col!.order).toBe(10);
    });

    it('should create a default column', () => {
      const project = createProject();
      const col = kanban.createColumn(project.id, 'new-default', 'New Default', 10, true);
      expect(col!.is_default).toBe(1);
    });
  });

  describe('updateColumn', () => {
    it('should update column name', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      const updated = kanban.updateColumn(col!.id, undefined, 'Updated Name');
      expect(updated!.name).toBe('Updated Name');
    });

    it('should update column order', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      const updated = kanban.updateColumn(col!.id, undefined, undefined, 99);
      expect(updated!.order).toBe(99);
    });

    it('should update column slug', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      const updated = kanban.updateColumn(col!.id, 'new-slug');
      expect(updated!.slug).toBe('new-slug');
    });

    it('should update multiple fields', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      const updated = kanban.updateColumn(col!.id, 'new-slug', 'New Name', 50);
      expect(updated!.slug).toBe('new-slug');
      expect(updated!.name).toBe('New Name');
      expect(updated!.order).toBe(50);
    });

    it('should return undefined for non-existent column', () => {
      const result = kanban.updateColumn(9999, 'new-slug');
      expect(result).toBeUndefined();
    });

    it('should return column unchanged when no updates provided', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      const original = { ...col! };
      const updated = kanban.updateColumn(col!.id);
      expect(updated).toEqual(original);
    });
  });

  describe('deleteColumn', () => {
    it('should delete an empty custom column', () => {
      const project = createProject();
      const col = kanban.createColumn(project.id, 'deletable', 'Deletable', 10, false);
      const result = kanban.deleteColumn(col!.id);
      expect(result).toBe(true);
      const remaining = kanban.getColumnsByProject(project.id);
      expect(remaining.find(c => c.id === col!.id)).toBeUndefined();
    });

    it('should not delete column with tickets', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      tickets.createTicket(project.id, col!.id, 'Ticket', '', '[]', 2, null, null, 1);
      const result = kanban.deleteColumn(col!.id);
      expect(result).toBe(false);
    });

    it('should return false for non-existent column', () => {
      const result = kanban.deleteColumn(9999);
      expect(result).toBe(false);
    });
  });

  describe('getColumnById', () => {
    it('should find column by id', () => {
      const project = createProject();
      const col = kanban.getColumnsByProject(project.id)[0];
      const found = kanban.getColumnById(col!.id);
      expect(found).toBeDefined();
      expect(found!.slug).toBe(col!.slug);
    });

    it('should return undefined for non-existent id', () => {
      const result = kanban.getColumnById(9999);
      expect(result).toBeUndefined();
    });
  });

  describe('getColumnBySlug', () => {
    it('should find column by slug and project id', () => {
      const project = createProject();
      const found = kanban.getColumnBySlug('todo', project.id);
      expect(found).toBeDefined();
      expect(found!.slug).toBe('todo');
    });

    it('should return undefined for non-existent slug', () => {
      const project = createProject();
      const result = kanban.getColumnBySlug('nonexistent', project.id);
      expect(result).toBeUndefined();
    });

    it('should return undefined for column in different project', () => {
      const project = createProject();
      const result = kanban.getColumnBySlug('todo', 9999);
      expect(result).toBeUndefined();
    });
  });
});
