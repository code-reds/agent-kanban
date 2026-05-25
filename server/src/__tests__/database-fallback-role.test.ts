import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb, getFallbackRoleId, closeDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';

describe('Database fallback role ID', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    runMigrations();
  });

  it('should return Human User role ID when roles are seeded', () => {
    seedDefaultRoles();
    const roleId = getFallbackRoleId();
    expect(roleId).toBeDefined();
    expect(typeof roleId).toBe('number');
    expect(roleId).toBeGreaterThan(0);

    // Verify it's the Human User role
    const db = getDb();
    const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
    expect(role?.name).toBe('Human User');
  });

  it('should return the first role when Human User is not found', () => {
    // Delete Human User role and create a different one
    const db = getDb();
    db.prepare('DELETE FROM roles WHERE name = ?').run('Human User');
    db.prepare('INSERT INTO roles (name) VALUES (?)').run('Test Role');

    const roleId = getFallbackRoleId();
    expect(roleId).toBeDefined();
    expect(typeof roleId).toBe('number');

    const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
    expect(role?.name).toBe('Test Role');
  });

  it('should return null when no roles exist', () => {
    // Clear all roles
    const db = getDb();
    db.prepare('DELETE FROM roles').run();

    const roleId = getFallbackRoleId();
    expect(roleId).toBeNull();
  });

  it('should return the first role when Human User does not exist but other roles do', () => {
    // Clear and create non-Human User roles
    const db = getDb();
    db.prepare('DELETE FROM roles').run();
    db.prepare('INSERT INTO roles (name) VALUES (?)').run('Role A');
    db.prepare('INSERT INTO roles (name) VALUES (?)').run('Role B');

    const roleId = getFallbackRoleId();
    expect(roleId).toBeDefined();
    expect(typeof roleId).toBe('number');

    const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
    expect(role?.name).toBe('Role A');
  });
});
