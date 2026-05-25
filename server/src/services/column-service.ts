import {
  getColumnsByProject,
  createColumn as createColumnQuery,
  updateColumn as updateColumnQuery,
  deleteColumn as deleteColumnQuery,
  getColumnById as getColumnByIdQuery,
  type KanbanColumn,
} from '../db/queries/kanban.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { getDb } from '../db/database.js';
import { COLUMNS } from '../types/columns.js';

/**
 * Shared kanban column service that orchestrates column operations.
 * Used by both REST API and MCP tools.
 */
export class ColumnService {
  /**
   * List all columns for a project, ordered.
   */
  static list(projectSlug: string) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { columns: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const columns = getColumnsByProject(project.id);
    return { columns };
  }

  /**
   * Create a new column with validation.
   */
  static create(
    projectSlug: string,
    params: { slug: string; name: string; order: number; is_default?: boolean }
  ) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { column: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!params.slug || typeof params.slug !== 'string') {
      return { column: undefined, error: 'Column slug is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    if (!params.name || typeof params.name !== 'string') {
      return { column: undefined, error: 'Column name is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    if (params.order === undefined || typeof params.order !== 'number') {
      return { column: undefined, error: 'Column order is required and must be a number', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Check for duplicate column slug in this project
    const existing = getDb().prepare(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(project.id, params.slug);

    if (existing) {
      return { column: undefined, error: `Column slug '${params.slug}' already exists`, errorCode: 'CONFLICT', statusCode: 409 };
    }

    const column = createColumnQuery(project.id, params.slug, params.name, params.order, params.is_default || false);

    if (!column) {
      return { column: undefined, error: 'Failed to create column', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    return { column };
  }

  /**
   * Update a column.
   */
  static update(
    projectSlug: string,
    columnId: number,
    params: { slug?: string; name?: string; order?: number }
  ) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { column: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const column = updateColumnQuery(columnId, params.slug, params.name, params.order);

    if (!column) {
      return { column: undefined, error: `Column '${columnId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { column };
  }

  /**
   * Delete a column.
   * - Protected columns ('todo' and 'done') cannot be deleted under any circumstances.
   * - If the column has tickets, they are first moved to the 'todo' column.
   * - Non-default, non-protected columns can be deleted.
   */
  static remove(projectSlug: string, columnId: number) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, id: columnId, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const column = getColumnByIdQuery(columnId);
    if (!column) {
      return { success: false, id: columnId, error: `Column '${columnId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Reserved column slugs that cannot be deleted under any circumstances
    if (column.slug === COLUMNS.TODO || column.slug === COLUMNS.DONE) {
      return { success: false, id: columnId, error: `Cannot delete reserved column '${column.slug}'`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    const db = getDb();

    // Step 1: Move tickets to 'todo' column before cleaning dependencies
    const ticketCount = db.prepare(
      'SELECT COUNT(*) as total FROM tickets WHERE column_id = ?'
    ).get(columnId) as { total: number };

    if (ticketCount.total > 0) {
      // Find the 'todo' column ID in this project
      const todoColumn = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
      ).get(project.id, COLUMNS.TODO) as { id: number } | undefined;

      if (todoColumn) {
        db.prepare(
          'UPDATE tickets SET column_id = ? WHERE column_id = ?'
        ).run(todoColumn.id, columnId);
      }
    }

    // Step 2: Clean up dependent records in the correct FK dependency order
    // Delete roles_columns references to this column (FK: column_id -> kanban_columns.id)
    db.prepare(
      'DELETE FROM roles_columns WHERE column_id = ? AND project_id = ?'
    ).run(columnId, project.id);

    // Delete ticket_access_rules references to this column (FK: column_id -> kanban_columns.id)
    db.prepare(
      'DELETE FROM ticket_access_rules WHERE column_id = ? AND project_id = ?'
    ).run(columnId, project.id);

    // Delete workflow_transitions referencing this column (FK: column_from and column_to -> kanban_columns.id)
    // This also cascades to transition_allowed_roles via ON DELETE CASCADE
    db.prepare(
      'DELETE FROM workflow_transitions WHERE (column_from = ? OR column_to = ?) AND project_id = ?'
    ).run(columnId, columnId, project.id);

    // Delete ticket_status_history records referencing this column (both from and to FK refs)
    db.prepare(
      'DELETE FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?'
    ).run(columnId, columnId);

    // Now delete the column (should succeed since tickets have been moved and deps cleaned up)
    const deleted = deleteColumnQuery(columnId);
    if (!deleted) {
      return { success: false, id: columnId, error: 'Failed to delete column', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    return { success: true, id: columnId };
  }
}
