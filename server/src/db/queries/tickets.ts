import { getDb } from '../database.js';
import { COLUMNS } from '../../types/columns.js';
export { getDb };

export interface TicketRow {
  id: number;
  project_id: number;
  parent_id: number | null;
  column_id: number;
  column_slug?: string;
  title: string;
  description: string;
  labels: string;
  priority: number;
  estimate: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  created_by_role_id: number;
}

export interface TicketWithRelations extends TicketRow {
  column_slug?: string;
  column_name?: string;
  parent_title?: string;
  comments?: CommentRow[];
  dependencies?: DependencyRow[];
  status_history?: StatusHistoryRow[];
}

export interface CommentRow {
  id: number;
  ticket_id: number;
  author_role_id: number;
  author_role_name?: string;
  content: string;
  action_type: string | null;
  action_details: string | null;
  created_at: string;
}

export interface DependencyRow {
  id: number;
  ticket_id: number;
  depends_on_id: number;
  relation_type: string;
}

export interface StatusHistoryRow {
  id: number;
  ticket_id: number;
  from_column_id: number;
  to_column_id: number;
  actor_role_id: number;
  comment_id: number | null;
  created_at: string;
}

export interface WorkflowTransition {
  id: number;
  project_id: number;
  column_from: number;
  column_to: number;
  requires_comment: number;
  entire_ticket_group: number;
}

export interface AccessRule {
  id: number;
  project_id: number;
  column_id: number;
  role_id: number;
  action_type: string;
}

export function getTicketsByProject(
  projectId: number,
  columnSlug?: string,
  priority?: number,
  labels?: string,
  parentId?: number,
  page: number = 1,
  perPage: number = 20,
  sortBy: string = 'created_at',
  sortOrder: 'asc' | 'desc' = 'desc'
): { tickets: TicketRow[]; total: number } {
  const db = getDb();
  const conditions: string[] = ['t.project_id = ?'];
  const params: unknown[] = [projectId];

  if (columnSlug) {
    conditions.push('t.column_id IN (SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?)');
    params.push(projectId, columnSlug);
  }

  if (priority !== undefined) {
    conditions.push('t.priority = ?');
    params.push(priority);
  }

  if (labels) {
    conditions.push('t.labels LIKE ?');
    params.push(`%"${labels}"%`);
  }

  if (parentId !== undefined) {
    conditions.push('t.parent_id = ?');
    params.push(parentId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const validSortFields = ['created_at', 'updated_at', 'priority', 'title', 'closed_at'];
  const safeSort = validSortFields.includes(sortBy) ? sortBy : 'created_at';
  const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const offset = (page - 1) * perPage;

  const tickets = db.prepare<unknown[], TicketRow>(`
    SELECT t.*, kc.slug AS column_slug FROM tickets t
    LEFT JOIN kanban_columns kc ON t.column_id = kc.id
    ${whereClause}
    ORDER BY t."${safeSort}" ${safeOrder}
    LIMIT ? OFFSET ?
  `).all(...(params as any[]), perPage, offset);

  const countResult = db.prepare<unknown[], { total: number }>(`
    SELECT COUNT(*) as total FROM tickets t ${whereClause}
  `).get(...(params as any[]))!;

  return { tickets, total: countResult.total };
}

export function getTicketById(id: number): TicketWithRelations | undefined {
  const db = getDb();
  const ticket = db.prepare<number, TicketWithRelations>(`
    SELECT t.*, kc.slug AS column_slug, kc.name AS column_name
    FROM tickets t
    LEFT JOIN kanban_columns kc ON t.column_id = kc.id
    WHERE t.id = ?
  `).get(id);

  if (!ticket) return undefined;

  ticket.comments = db.prepare<[number], CommentRow>(`
    SELECT tc.*, r.name AS author_role_name FROM ticket_comments tc
    LEFT JOIN roles r ON tc.author_role_id = r.id
    WHERE tc.ticket_id = ? ORDER BY tc.created_at
  `).all(id);

  ticket.dependencies = db.prepare<[number], DependencyRow>(`
    SELECT * FROM ticket_dependencies WHERE ticket_id = ?
  `).all(id);

  ticket.status_history = db.prepare<[number], StatusHistoryRow>(`
    SELECT * FROM ticket_status_history WHERE ticket_id = ? ORDER BY created_at
  `).all(id);

  return ticket;
}

export function createTicket(
  projectId: number,
  columnId: number,
  title: string,
  description: string = '',
  labels: string = '[]',
  priority: number = 2,
  estimate: string | null = null,
  parentId: number | null = null,
  createdByRoleId: number
): TicketRow | undefined {
  const db = getDb();
  db.prepare(
    `INSERT INTO tickets (project_id, parent_id, column_id, title, description, labels, priority, estimate, created_by_role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(projectId, parentId, columnId, title, description, labels, priority, estimate, createdByRoleId);

  const row = db.prepare<[], { id: number }>('SELECT last_insert_rowid() as id').get()!;
  const id = Number(row.id ?? 0);
  return db.prepare<[number], TicketRow>(`
    SELECT t.*, kc.slug AS column_slug FROM tickets t
    LEFT JOIN kanban_columns kc ON t.column_id = kc.id
    WHERE t.id = ?
  `).get(id)!;
}

export function updateTicket(
  id: number,
  title?: string,
  description?: string,
  labels?: string,
  priority?: number,
  estimate?: string | null,
  parentId?: number | null
): TicketRow | undefined {
  const db = getDb();
  const ticket = db.prepare<[number], TicketRow>(`
    SELECT t.*, kc.slug AS column_slug FROM tickets t
    LEFT JOIN kanban_columns kc ON t.column_id = kc.id
    WHERE t.id = ?
  `).get(id);
  if (!ticket) return undefined;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (title !== undefined) {
    updates.push('title = ?');
    params.push(title);
  }

  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }

  if (labels !== undefined) {
    updates.push('labels = ?');
    params.push(labels);
  }

  if (priority !== undefined) {
    updates.push('priority = ?');
    params.push(priority);
  }

  if (estimate !== undefined) {
    updates.push('estimate = ?');
    params.push(estimate);
  }

  if (parentId !== undefined) {
    updates.push('parent_id = ?');
    params.push(parentId);
  }

  updates.push('updated_at = datetime(\'now\')');
  params.push(id);

  db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...(params as any[]));

  return db.prepare<[number], TicketRow>(`
    SELECT t.*, kc.slug AS column_slug FROM tickets t
    LEFT JOIN kanban_columns kc ON t.column_id = kc.id
    WHERE t.id = ?
  `).get(id)!;
}

export function addComment(
  ticketId: number,
  authorRoleId: number,
  content: string,
  actionType: string | null = null,
  actionDetails: string | null = null
): CommentRow | undefined {
  const db = getDb();
  db.prepare(
    `INSERT INTO ticket_comments (ticket_id, author_role_id, content, action_type, action_details)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId, authorRoleId, content, actionType, actionDetails);

  const row = db.prepare<[], { id: number }>('SELECT last_insert_rowid() as id').get()!;
  const id = Number(row.id ?? 0);
  return db.prepare<[number], CommentRow>('SELECT * FROM ticket_comments WHERE id = ?').get(id)!;
}

export function getCommentsByTicket(ticketId: number): CommentRow[] {
  const db = getDb();
  return db.prepare<[number], CommentRow>(
    'SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at'
  ).all(ticketId);
}

/**
 * Get a single comment by ID along with its ticket_id and author_role_id.
 * Returns undefined if not found.
 */
export function getCommentById(commentId: number): { id: number; ticket_id: number; author_role_id: number; content: string } | undefined {
  const db = getDb();
  return db.prepare<[number], { id: number; ticket_id: number; author_role_id: number; content: string }>(
    'SELECT id, ticket_id, author_role_id, content FROM ticket_comments WHERE id = ?'
  ).get(commentId);
}

/**
 * Update a comment's content by ID.
 * Returns the updated CommentRow, or undefined if not found.
 */
export function updateComment(
  commentId: number,
  content: string
): CommentRow | undefined {
  const db = getDb();

  // Check if the comment exists
  const existing = db.prepare<[number], { id: number; ticket_id: number; author_role_id: number; content: string }>(
    'SELECT id, ticket_id, author_role_id, content FROM ticket_comments WHERE id = ?'
  ).get(commentId);

  if (!existing) return undefined;

  // Update the comment
  db.prepare(
    'UPDATE ticket_comments SET content = ? WHERE id = ?'
  ).run(content, commentId);

  // Return the updated comment
  return db.prepare<[number], CommentRow>(
    'SELECT * FROM ticket_comments WHERE id = ?'
  ).get(commentId)!;
}

/**
 * Delete a comment by ID.
 * Returns true if a row was deleted, false if not found.
 */
export function deleteComment(commentId: number): boolean {
  const db = getDb();
  const result = db.prepare<[number]>(
    'DELETE FROM ticket_comments WHERE id = ?'
  ).run(commentId);
  return result.changes > 0;
}

export function addDependency(
  ticketId: number,
  dependsOnId: number,
  relationType: string
): boolean {
  const db = getDb();
  try {
    db.prepare(
      'INSERT INTO ticket_dependencies (ticket_id, depends_on_id, relation_type) VALUES (?, ?, ?)'
    ).run(ticketId, dependsOnId, relationType);
    return true;
  } catch {
    return false;
  }
}

export function removeDependency(ticketId: number, dependsOnId: number, relationType: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM ticket_dependencies WHERE ticket_id = ? AND depends_on_id = ? AND relation_type = ?'
  ).run(ticketId, dependsOnId, relationType);
  return result.changes > 0;
}

export function getDependencies(ticketId: number): DependencyRow[] {
  const db = getDb();
  return db.prepare<[number], DependencyRow>(
    'SELECT * FROM ticket_dependencies WHERE ticket_id = ?'
  ).all(ticketId);
}

export function addStatusHistory(
  ticketId: number,
  fromColumnId: number,
  toColumnId: number,
  actorRoleId: number,
  commentId: number | null = null
): StatusHistoryRow | undefined {
  const db = getDb();
  db.prepare(
    `INSERT INTO ticket_status_history (ticket_id, from_column_id, to_column_id, actor_role_id, comment_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId, fromColumnId, toColumnId, actorRoleId, commentId);

  const row = db.prepare<[], { id: number }>('SELECT last_insert_rowid() as id').get()!;
  const id = Number(row.id ?? 0);
  return db.prepare<[number], StatusHistoryRow>(
    'SELECT * FROM ticket_status_history WHERE id = ?'
  ).get(id)!;
}

export function getWorkflowForProject(projectId: number): WorkflowTransition[] {
  const db = getDb();
  return db.prepare<[number], WorkflowTransition>(
    'SELECT * FROM workflow_transitions WHERE project_id = ?'
  ).all(projectId);
}

export function createTransition(
  projectId: number,
  columnFrom: number,
  columnTo: number,
  requiresComment: boolean = false,
  entireTicketGroup: boolean = false
): { id: number } | undefined {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment, entire_ticket_group)
     VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, columnFrom, columnTo, requiresComment ? 1 : 0, entireTicketGroup ? 1 : 0);

  return db.prepare<[], { id: number }>('SELECT last_insert_rowid() as id').get()!;
}

export function deleteTransition(transitionId: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow_transitions WHERE id = ?').run(transitionId);
  return result.changes > 0;
}

/**
 * Update transition boolean properties.
 * Returns true if a row was updated, false if transition not found.
 */
export function updateTransition(
  transitionId: number,
  requiresComment: boolean,
  entireTicketGroup: boolean
): boolean {
  const db = getDb();
  // Check if transition exists first
  const existing = db.prepare<[number], { id: number }>(
    'SELECT id FROM workflow_transitions WHERE id = ?'
  ).get(transitionId);
  if (!existing) return false;

  const result = db.prepare(
    'UPDATE workflow_transitions SET requires_comment = ?, entire_ticket_group = ? WHERE id = ?'
  ).run(requiresComment ? 1 : 0, entireTicketGroup ? 1 : 0, transitionId);
  return result.changes > 0;
}

/**
 * Reconcile transition_allowed_roles using diff-based sync.
 * Wraps in a transaction for atomicity.
 * - DELETEs roles no longer in the new set
 * - INSERTs new roles not in the existing set
 */
export function syncTransitionAllowedRoles(
  transitionId: number,
  newRoleIds: number[]
): void {
  const db = getDb();

  // Get current role IDs for this transition
  const existing = db.prepare<[number], { role_id: number }>(
    'SELECT role_id FROM transition_allowed_roles WHERE transition_id = ?'
  ).all(transitionId);

  const existingSet = new Set(existing.map((r) => r.role_id));
  const newSet = new Set(newRoleIds);

  // Delete roles no longer in the new set
  for (const roleId of existingSet) {
    if (!newSet.has(roleId)) {
      db.prepare(
        'DELETE FROM transition_allowed_roles WHERE transition_id = ? AND role_id = ?'
      ).run(transitionId, roleId);
    }
  }

  // Insert new roles not in the existing set
  for (const roleId of newSet) {
    if (!existingSet.has(roleId)) {
      db.prepare(
        'INSERT INTO transition_allowed_roles (transition_id, role_id) VALUES (?, ?)'
      ).run(transitionId, roleId);
    }
  }
}

/**
 * Get a single workflow transition by ID (without enrichment).
 * Returns undefined if not found.
 */
export function getTransitionById(transitionId: number): {
  id: number;
  project_id: number;
  column_from: number;
  column_to: number;
  requires_comment: number;
  entire_ticket_group: number;
} | undefined {
  const db = getDb();
  return db.prepare<[number], typeof undefined>(`
    SELECT id, project_id, column_from, column_to, requires_comment, entire_ticket_group
    FROM workflow_transitions WHERE id = ?
  `).get(transitionId);
}

export function addTransitionAllowedRole(transitionId: number, roleId: number): boolean {
  const db = getDb();
  try {
    db.prepare(
      'INSERT INTO transition_allowed_roles (transition_id, role_id) VALUES (?, ?)'
    ).run(transitionId, roleId);
    return true;
  } catch {
    return false;
  }
}

export function removeTransitionAllowedRole(transitionId: number, roleId: number): boolean {
  const db = getDb();
  db.prepare(
    'DELETE FROM transition_allowed_roles WHERE transition_id = ? AND role_id = ?'
  ).run(transitionId, roleId);
  return true;
}

export function getAccessRulesByProject(projectId: number): AccessRule[] {
  const db = getDb();
  return db.prepare<[number], AccessRule>(
    'SELECT * FROM ticket_access_rules WHERE project_id = ?'
  ).all(projectId);
}

export function deleteTicket(id: number): boolean {
  const db = getDb();
  const ticket = db.prepare<[number], TicketRow>('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) return false;

  db.prepare('DELETE FROM ticket_comments WHERE ticket_id = ?').run(id);
  db.prepare('DELETE FROM ticket_dependencies WHERE ticket_id = ?').run(id);
  db.prepare('DELETE FROM ticket_dependencies WHERE depends_on_id = ?').run(id);
  db.prepare('DELETE FROM ticket_status_history WHERE ticket_id = ?').run(id);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(id);

  return true;
}

export function createAccessRules(rules: { columnId: number; roleId: number; actionType: string }[], projectId: number): void {
  const db = getDb();
  for (const rule of rules) {
    db.prepare(
      'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
    ).run(projectId, rule.columnId, rule.roleId, rule.actionType);
  }
}

export function deleteAccessRulesByProject(projectId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM ticket_access_rules WHERE project_id = ?').run(projectId);
}

export interface AccessRuleUpdate {
  columnId: number;
  roleId: number;
  actionType: string;
}

// Upsert = update + insert. Reconciles existing rules against the new set:
// deletes rules that exist but are no longer in newRules, inserts rules that are
// in newRules but not yet in the DB. Achieves upsert semantics without individual
// ON CONFLICT clauses by doing a diff-based sync.
export function upsertAccessRules(
  projectId: number,
  newRules: { columnId: number; roleId: number; actionType: string }[],
  existingRules: { column_id: number; role_id: number; action_type: string }[]
): void {
  const db = getDb();

  // Build a set of existing rules keyed by column_id, role_id, action_type
  const existingSet = new Set<string>();
  for (const rule of existingRules) {
    existingSet.add(`${rule.column_id}:${rule.role_id}:${rule.action_type}`);
  }

  // Build a set of new rules
  const newSet = new Set<string>();
  for (const rule of newRules) {
    newSet.add(`${rule.columnId}:${rule.roleId}:${rule.actionType}`);
  }

  // Delete rules that exist but are no longer in the new set
  for (const key of existingSet) {
    if (!newSet.has(key)) {
      const [columnId, roleId, actionType] = key.split(':');
      db.prepare(
        'DELETE FROM ticket_access_rules WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = ?'
      ).run(projectId, Number(columnId), Number(roleId), actionType);
    }
  }

 // Insert new rules that aren't already in the existing set
  for (const rule of newRules) {
    const key = `${rule.columnId}:${rule.roleId}:${rule.actionType}`;
    if (!existingSet.has(key)) {
      db.prepare(
        'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
      ).run(projectId, rule.columnId, rule.roleId, rule.actionType);
    }
  }
}

export function getChildTickets(parentId: number): TicketRow[] {
  const db = getDb();
  return db.prepare<[number], TicketRow>(
    'SELECT * FROM tickets WHERE parent_id = ?'
  ).all(parentId);
}

/**
 * Get a parent ticket by ID. Returns only the fields needed for priority inheritance.
 * Used during child ticket creation when no priority is specified.
 */
export function getParentTicketById(id: number): Pick<TicketRow, 'id' | 'priority' | 'project_id'> | undefined {
  const db = getDb();
  return db.prepare<[number], { id: number; priority: number; project_id: number }>(
    'SELECT id, priority, project_id FROM tickets WHERE id = ?'
  ).get(id);
}

/**
 * Get ALL descendant ticket IDs for a given ticket using a recursive CTE.
 * Returns the complete ticket tree rooted at ticketId, excluding ticketId itself.
 */
export function getAllDescendantTicketIds(ticketId: number): number[] {
  const db = getDb();
  const rows = db.prepare<[number, number], { id: number }>(
    `WITH RECURSIVE ticket_tree(id) AS (
      SELECT id FROM tickets WHERE id = ?
      UNION ALL
      SELECT t.id FROM tickets t
      JOIN ticket_tree tt ON t.parent_id = tt.id
    )
    SELECT id FROM ticket_tree WHERE id != ?`
  ).all(ticketId, ticketId);
  return rows.map((r) => r.id);
}

/**
 * Get blocked ticket IDs for a project using the ticket_blockers view.
 * Returns all distinct ticket_ids that are blocked (have unresolved dependencies
 * or entire-ticket-group violations).
 */
export function getBlockedTicketIds(projectId: number): number[] {
  const db = getDb();
  const rows = db.prepare<[number], { ticket_id: number }>(
    'SELECT DISTINCT ticket_id FROM ticket_blockers WHERE project_id = ?'
  ).all(projectId);
  return rows.map((r) => r.ticket_id);
}

/**
 * Check if a specific ticket is blocked (appears in the ticket_blockers view).
 * Returns true if the ticket is blocked, false otherwise.
 */
export function isTicketBlocked(ticketId: number, projectId: number): boolean {
  const db = getDb();
  const row = db.prepare<[number, number], { count: number }>(
    'SELECT COUNT(*) as count FROM ticket_blockers WHERE project_id = ? AND ticket_id = ? LIMIT 1'
  ).get(projectId, ticketId);
  return (row?.count ?? 0) > 0;
}

/**
 * Validation query for entire-ticket-group moves.
 * Checks whether all descendants in the SAME column as the parent can participate
 * in a group move to the target column.
 * Descendants in different columns are NOT part of the group — they stay put.
 *
 * Returns null if all conditions are met.
 * Returns an error object with ticket IDs if any condition fails.
 */
export function getDescendantsBlockedByGroup(
  ticketId: number,
  targetColumnId: number,
  projectId: number
): { reason: string; ticket_ids: number[] } | null {
  const db = getDb();

  // Get the parent's current column
  const parent = db.prepare<[number], { column_id: number; parent_id: number | null }>(
    'SELECT column_id, parent_id FROM tickets WHERE id = ?'
  ).get(ticketId);

  if (!parent) {
    return { reason: 'Ticket not found', ticket_ids: [ticketId] };
  }

  const parentColumnId = parent.column_id;

  // Check if target column is 'done'
  const targetCol = db.prepare<[number], { slug: string }>(
    'SELECT slug FROM kanban_columns WHERE id = ?'
  ).get(targetColumnId);
  const isDone = targetCol?.slug === COLUMNS.DONE;

  // Check 1: For non-done targets, only top-level tickets can use entire-ticket-group moves
  // For done target, allow non-top-level to cascade (cascade closes children)
  if (!isDone && parent.parent_id !== null) {
    // Non-top-level ticket — check if it has any descendants
    const hasDescendants = db.prepare<[number, number], number>(
      `WITH RECURSIVE ticket_tree(id) AS (
        SELECT id FROM tickets WHERE id = ?
        UNION ALL
        SELECT t.id FROM tickets t
        JOIN ticket_tree tt ON t.parent_id = tt.id
      )
      SELECT COUNT(*) FROM ticket_tree WHERE id != ?`
    ).get(ticketId, ticketId) as number;

    if (hasDescendants > 0) {
      return { reason: 'Only top-level tickets can use entire-ticket-group moves', ticket_ids: [ticketId] };
    }
  }

  // Check 2: Get all descendants in the SAME column as the parent
  const sameColumnDescendants = db.prepare<[number, number, number], { id: number }>(
    `WITH RECURSIVE ticket_tree(id, col_id) AS (
      SELECT id, column_id FROM tickets WHERE id = ?
      UNION ALL
      SELECT t.id, t.column_id FROM tickets t
      JOIN ticket_tree tt ON t.parent_id = tt.id
    )
    SELECT id FROM ticket_tree
    WHERE id != ? AND col_id = ?`
  ).all(ticketId, ticketId, parentColumnId) as { id: number }[];

  // If no descendants in same column, no blocking
  if (sameColumnDescendants.length === 0) {
    return null;
  }

  // For done transitions: all same-column descendants will be cascade-closed together.
  // Dependency checks and same-column blocking are handled by the cascade closure.
  // For non-done transitions: deps don't block, and there's no cascade closure.
  // Either way, no blocking for this transition.
  return null;
}
