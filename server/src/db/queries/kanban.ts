import { getDb } from '../database.js';

export interface KanbanColumn {
  id: number;
  project_id: number;
  slug: string;
  name: string;
  order: number;
  is_default: number;
}

export function getColumnsByProject(projectId: number): KanbanColumn[] {
  const db = getDb();
  return db.prepare<[number], KanbanColumn>(
    'SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
  ).all(projectId);
}

export function createColumn(
  projectId: number,
  slug: string,
  name: string,
  order: number,
  isDefault: boolean = false
): KanbanColumn | undefined {
  const db = getDb();
  db.prepare(
    `INSERT INTO kanban_columns (project_id, slug, name, "order", is_default)
     VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, slug, name, order, isDefault ? 1 : 0);

  return db.prepare<[number, string], KanbanColumn>(
    'SELECT * FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, slug)!;
}

export function updateColumn(
  columnId: number,
  slug?: string,
  name?: string,
  order?: number
): KanbanColumn | undefined {
  const db = getDb();
  const column = db.prepare<[number], KanbanColumn>('SELECT * FROM kanban_columns WHERE id = ?').get(columnId);
  if (!column) return undefined;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (slug !== undefined) {
    updates.push('slug = ?');
    params.push(slug);
  }

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }

  if (order !== undefined) {
    updates.push('"order" = ?');
    params.push(order);
  }

  if (updates.length === 0) return column;

  const sql = `UPDATE kanban_columns SET ${updates.join(', ')} WHERE id = ?`;
  params.push(columnId);
  db.prepare(sql).run(...(params as any[]));

  return db.prepare<[number], KanbanColumn>('SELECT * FROM kanban_columns WHERE id = ?').get(columnId)!;
}

export function deleteColumn(columnId: number): boolean {
  const db = getDb();
  const column = db.prepare<[number], KanbanColumn>('SELECT * FROM kanban_columns WHERE id = ?').get(columnId);
  if (!column) return false;

  // Check if column has tickets
  const ticketCount = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) as total FROM tickets WHERE column_id = ?'
  ).get(columnId)!;

  if (ticketCount.total > 0) {
    return false;
  }

  // Clean up dependent records to avoid foreign key constraint violations
  // Delete roles_columns references (FK: column_id -> kanban_columns.id)
  db.prepare(
    'DELETE FROM roles_columns WHERE column_id = ?'
  ).run(columnId);

  // Delete ticket_access_rules references (FK: column_id -> kanban_columns.id)
  db.prepare(
    'DELETE FROM ticket_access_rules WHERE column_id = ?'
  ).run(columnId);

  // Delete workflow_transitions referencing this column (FK: column_from and column_to -> kanban_columns.id)
  // This also cascades to transition_allowed_roles via ON DELETE CASCADE
  db.prepare(
    'DELETE FROM workflow_transitions WHERE column_from = ? OR column_to = ?'
  ).run(columnId, columnId);

  // Delete ticket_status_history records referencing this column (both from and to FK refs)
  db.prepare(
    'DELETE FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?'
  ).run(columnId, columnId);

  db.prepare(
    'DELETE FROM kanban_columns WHERE id = ?'
  ).run(columnId);
  return true;
}

export function getColumnById(columnId: number): KanbanColumn | undefined {
  const db = getDb();
  return db.prepare<[number], KanbanColumn>(
    'SELECT * FROM kanban_columns WHERE id = ?'
  ).get(columnId)!;
}

export function getColumnBySlug(columnSlug: string, projectId: number): KanbanColumn | undefined {
  const db = getDb();
  return db.prepare<[string, number], KanbanColumn>(
    `SELECT * FROM kanban_columns WHERE slug = ? AND project_id = ?`
  ).get(columnSlug, projectId)!;
}
