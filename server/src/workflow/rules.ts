import { getDb } from '../db/database.js';

export function canCreate(
  projectId: number,
  columnId: number,
  roleId: number
): boolean {
  const db = getDb();
  const rule = db.prepare(`
    SELECT id FROM ticket_access_rules
    WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = 'create'
  `).get(projectId, columnId, roleId);
  return !!rule;
}

export function canEdit(
  projectId: number,
  columnId: number,
  roleId: number
): boolean {
  const db = getDb();
  const rule = db.prepare(`
    SELECT id FROM ticket_access_rules
    WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = 'edit'
  `).get(projectId, columnId, roleId);
  return !!rule;
}

export function canDelete(
  projectId: number,
  columnId: number,
  roleId: number
): boolean {
  const db = getDb();
  const rule = db.prepare(`
    SELECT id FROM ticket_access_rules
    WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = 'delete'
  `).get(projectId, columnId, roleId);
  return !!rule;
}

export function hasAnyAccess(
  projectId: number,
  columnId: number,
  roleId: number
): boolean {
  const db = getDb();
  const rule = db.prepare(`
    SELECT id FROM ticket_access_rules
    WHERE project_id = ? AND column_id = ? AND role_id = ?
  `).get(projectId, columnId, roleId);
  return !!rule;
}
