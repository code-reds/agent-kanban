import crypto from 'crypto';
import { getDb } from './database.js';
import { createColumn } from './queries/kanban.js';
import { createTransition, addTransitionAllowedRole, createAccessRules } from './queries/tickets.js';
import { insertRoleColumnMappings } from './queries/projects.js';
import { getRoleById } from './queries/projects.js';
import {
  createGlobalColumn,
  createGlobalWorkflow,
  replaceGlobalAccessRules,
  type GlobalColumn,
  type GlobalWorkflowTransition,
  type GlobalAccessRule,
} from './queries/global-settings.js';
import { upsertGlobalRolesColumn } from './queries/global-settings.js';

const HUMAN_USER_ROLE_NAME = 'Human User';

export function seedDefaultRoles(): void {
  const db = getDb();
  const roles = [
    { name: 'Human User', description: 'Full permissions for human users' },
    { name: 'AI teamleader', description: 'AI agent acting as team lead' },
    { name: 'AI architect', description: 'AI agent responsible for architecture' },
    { name: 'AI code developer', description: 'AI agent that writes code' },
    { name: 'AI code reviewer', description: 'AI agent that reviews code' },
    { name: 'AI integration tester', description: 'AI agent that tests integrations' },
    { name: 'AI feature reviewer', description: 'AI agent that reviews features' },
  ];

  for (const role of roles) {
    const existing = db.prepare('SELECT id FROM roles WHERE name = ?').get(role.name);
    if (!existing) {
      db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)').run(role.name, role.description);
    }
  }
}

export function seedProjectColumns(projectId: number, roleIds: number[]): void {
  const db = getDb();

  const columns = [
    { slug: 'todo', name: 'To Do', order: 0 },
    { slug: 'implementation', name: 'Implementation', order: 1 },
    { slug: 'unit_review', name: 'Unit Review', order: 2 },
    { slug: 'integration_testing', name: 'Integration Testing', order: 3 },
    { slug: 'final_review', name: 'Final Review', order: 4 },
    { slug: 'done', name: 'Done', order: 5 },
    { slug: 'human_feedback', name: 'Human Feedback', order: 6 }
  ];

  for (const col of columns) {
    const existing = db.prepare(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(projectId, col.slug);

    if (!existing) {
      createColumn(projectId, col.slug, col.name, col.order, true);
    }
  }

  // Get column IDs after insertion
  const allColumns = db.prepare(
    'SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
  ).all(projectId) as { id: number; slug: string }[];

  const columnMap = new Map<string, number>();
  for (const col of allColumns) {
    columnMap.set(col.slug, col.id);
  }

  // Seed workflow transitions
  // Role IDs after removing 'AI code tester': 1=Human User, 2=teamleader, 3=architect,
  // 4=code developer, 5=code reviewer, 6=integration tester, 7=feature reviewer
  const transitions: { from: string; to: string; requiresComment: boolean; entireTicketGroup: boolean; roles: number[] }[] = [
    { from: 'human_feedback', to: 'todo', requiresComment: false, entireTicketGroup: false, roles: [1] },
    { from: 'human_feedback', to: 'unit_review', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3] },
    { from: 'human_feedback', to: 'integration_testing', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3] },
    { from: 'human_feedback', to: 'final_review', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3] },
    { from: 'todo', to: 'implementation', requiresComment: false, entireTicketGroup: false, roles: [1, 2, 3] },
    { from: 'todo', to: 'human_feedback', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3, 4, 5, 6, 7] },
    { from: 'todo', to: 'done', requiresComment: false, entireTicketGroup: false, roles: [1] },
    { from: 'implementation', to: 'unit_review', requiresComment: false, entireTicketGroup: false, roles: [1, 4] },
    { from: 'unit_review', to: 'implementation', requiresComment: true, entireTicketGroup: false, roles: [1, 5, 6] },
    { from: 'unit_review', to: 'human_feedback', requiresComment: true, entireTicketGroup: false, roles: [1, 5, 6] },
    { from: 'unit_review', to: 'integration_testing', requiresComment: true, entireTicketGroup: false, roles: [1, 5, 6] },
    { from: 'unit_review', to: 'done', requiresComment: true, entireTicketGroup: false, roles: [1, 5] },
    { from: 'integration_testing', to: 'implementation', requiresComment: true, entireTicketGroup: false, roles: [1, 6] },
    { from: 'integration_testing', to: 'human_feedback', requiresComment: true, entireTicketGroup: false, roles: [1, 6] },
    { from: 'integration_testing', to: 'final_review', requiresComment: true, entireTicketGroup: true, roles: [1, 6] },
    { from: 'final_review', to: 'implementation', requiresComment: true, entireTicketGroup: false, roles: [1, 7] },
    { from: 'final_review', to: 'human_feedback', requiresComment: true, entireTicketGroup: false, roles: [1, 7] },
    { from: 'final_review', to: 'done', requiresComment: true, entireTicketGroup: true, roles: [1, 7] },
    { from: 'done', to: 'implementation', requiresComment: true, entireTicketGroup: false, roles: [1] },
  ];

  for (const trans of transitions) {
    const fromColId = columnMap.get(trans.from);
    const toColId = columnMap.get(trans.to);

    if (fromColId === undefined || toColId === undefined) continue;

    const existing = db.prepare(
      'SELECT id FROM workflow_transitions WHERE project_id = ? AND column_from = ? AND column_to = ?'
    ).get(projectId, fromColId, toColId);

    if (!existing) {
      const result = createTransition(projectId, fromColId, toColId, trans.requiresComment, trans.entireTicketGroup);
      if (result) {
        for (const roleId of trans.roles) {
          addTransitionAllowedRole(result.id, roleId);
        }
      }
    }
  }

  // Seed access rules per CONCEPT.md Default Ticket Access Rules table
  // Role IDs after removing 'AI code tester': 1=Human User, 2=teamleader,
  // 3=architect, 4=code developer, 5=code reviewer, 6=integration tester, 7=feature reviewer
  const accessRulesByColumn: Record<string, Record<string, number[]>> = {
    human_feedback: {
      create: [1],
      edit: [1, 2],
      delete: [1],
    },
    todo: {
      create: [1, 2, 3],
      edit: [1, 2, 3],
      delete: [1, 2, 3],
    },
    implementation: {
      create: [1, 2, 3],
      edit: [1, 2, 3, 4],
      delete: [1],
    },
    unit_review: {
      create: [1],
      edit: [1, 2, 5, 6],
      delete: [],
    },
    integration_testing: {
      create: [1],
      edit: [1, 2, 6],
      delete: [],
    },
    final_review: {
      create: [1],
      edit: [1, 2, 7],
      delete: [],
    },
  };

  for (const col of allColumns) {
    const rules = accessRulesByColumn[col.slug];
    if (!rules) continue;

    for (const [action, allowedRoleIds] of Object.entries(rules)) {
      for (const roleId of allowedRoleIds) {
        const existing = db.prepare(
          'SELECT id FROM ticket_access_rules WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = ?'
        ).get(projectId, col.id, roleId, action);

        if (!existing) {
          db.prepare(
            'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
          ).run(projectId, col.id, roleId, action);
        }
      }
    }
  }

  // Seed role-to-column mappings for todo-list mode in MCP tools
  // NULL = unrestricted (Human User, teamleader)
  // Other roles get their designated working column
  const roleColumnMappings: { roleId: number; columnId: number | null }[] = [
    { roleId: 1, columnId: null }, // Human User — unrestricted
    { roleId: 2, columnId: null }, // AI teamleader — unrestricted
    { roleId: 3, columnId: columnMap.get('todo') ?? null }, // AI architect
    { roleId: 4, columnId: columnMap.get('implementation') ?? null }, // AI code developer
    { roleId: 5, columnId: columnMap.get('unit_review') ?? null }, // AI code reviewer
    { roleId: 6, columnId: columnMap.get('integration_testing') ?? null }, // AI integration tester
    { roleId: 7, columnId: columnMap.get('final_review') ?? null }, // AI feature reviewer
  ];
  insertRoleColumnMappings(projectId, roleColumnMappings);
}

export function seedProjectTokens(projectId: number, roleIds: number[]): void {
  const db = getDb();

  // Ensure api_tokens table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_tokens_project ON api_tokens(project_id)`);

  // Get all roles for this project's context
  const roles = db.prepare<[number]>(
    'SELECT id, name FROM roles WHERE id IN (SELECT DISTINCT role_id FROM ticket_access_rules WHERE project_id = ?) ORDER BY id'
  ).all(projectId) as { id: number; name: string }[];

  // Fallback: use all roles if none found in access rules
  const allRoles = roles.length > 0 ? roles :
    db.prepare('SELECT id, name FROM roles ORDER BY id').all() as { id: number; name: string }[];

  for (const role of allRoles) {
    // Skip Human User role - only seed tokens for AI agent roles
    if (role.name === HUMAN_USER_ROLE_NAME) continue;

    // Check if token already exists for this role/project
    const existing = db.prepare(
      'SELECT id FROM api_tokens WHERE project_id = ? AND role_id = ?'
    ).get(projectId, role.id);

    if (!existing) {
      const plaintextToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(plaintextToken).digest('hex');
      const description = `Auto-generated token for ${role.name}`;

      db.prepare(
        'INSERT INTO api_tokens (token_hash, token_value, project_id, role_id, description) VALUES (?, ?, ?, ?, ?)'
      ).run(tokenHash, plaintextToken, projectId, role.id, description);
    }
  }
}

// ============================================================================
// Global Roles_Columns Seeding
// ============================================================================

/**
 * Seed global roles_columns entries (project_id IS NULL) using the standard
 * role-to-column mappings. These act as instance-wide defaults that new
 * projects copy from.
 *
 * This function is idempotent — it will not create duplicates if global
 * roles_columns entries already exist.
 */
export function seedRolesColumns(): void {
  const db = getDb();

  // Check if global roles_columns already exist (idempotency)
  const existingGlobalRolesColumns = db.prepare(
    'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
  ).get() as { total: number };

  if (existingGlobalRolesColumns.total > 0) {
    return; // Global roles_columns already seeded
  }

  // Build column slug → ID mapping from the global kanban_columns
  const allColumns = db.prepare<[], { id: number; slug: string }>(
    'SELECT id, slug FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
  ).all() as { id: number; slug: string }[];

  const columnMap = new Map<string, number>();
  for (const col of allColumns) {
    columnMap.set(col.slug, col.id);
  }

  // Get all roles (roles are shared across projects)
  const roles = db.prepare<[], { id: number; name: string }>(
    'SELECT id, name FROM roles ORDER BY id'
  ).all();

  // Standard role-to-column mappings (based on current hardcoded values)
  interface RoleColumnDef {
    roleName: string;
    columnSlug: string | null;
    isDefault: number;
  }

  const roleColumnDefs: RoleColumnDef[] = [
    { roleName: 'Human User', columnSlug: null, isDefault: 0 },
    { roleName: 'AI teamleader', columnSlug: null, isDefault: 0 },
    { roleName: 'AI architect', columnSlug: 'todo', isDefault: 1 },
    { roleName: 'AI code developer', columnSlug: 'implementation', isDefault: 0 },
    { roleName: 'AI code reviewer', columnSlug: 'unit_review', isDefault: 0 },
    { roleName: 'AI integration tester', columnSlug: 'integration_testing', isDefault: 0 },
    { roleName: 'AI feature reviewer', columnSlug: 'final_review', isDefault: 0 },
  ];

  for (const def of roleColumnDefs) {
    const role = roles.find((r) => r.name === def.roleName);
    if (!role) continue;

    const columnId = def.columnSlug !== null ? columnMap.get(def.columnSlug) ?? null : null;
    const isDefault = def.isDefault ? 1 : 0;

    upsertGlobalRolesColumn(role.id, columnId, isDefault);
  }
}

/**
 * Seed project-level roles_columns from global defaults.
 *
 * Queries all global (project_id IS NULL) roles_columns entries and copies
 * them into the new project, remapping column IDs from global → project.
 *
 * @param projectId - The target project ID.
 * @param colIdMapping - Map of global column ID → project column ID.
 * @returns The number of rows inserted.
 */
export function seedProjectRolesColumns(
  projectId: number,
  colIdMapping: Map<number, number>
): number {
  const db = getDb();

  // Get all global roles_columns entries
  const globalMappings = db.prepare<[], { role_id: number; column_id: number | null; is_default: number }>(
    'SELECT role_id, column_id, is_default FROM roles_columns WHERE project_id IS NULL'
  ).all();

  // Get all roles (shared across projects)
  const allRoles = db.prepare<[], { id: number; name: string }>(
    'SELECT id, name FROM roles ORDER BY id'
  ).all();

  // Insert project-specific role-column mappings from global defaults
  let count = 0;
  for (const global of globalMappings) {
    // Remap column_id if not null
    const projectColumnId = global.column_id !== null
      ? colIdMapping.get(global.column_id) ?? global.column_id
      : null;

    // Upsert (skip if already exists for this role in this project)
    const existing = db.prepare<[number, number]>(
      'SELECT id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(global.role_id, projectId);

    if (!existing) {
      db.prepare(
        `INSERT INTO roles_columns (project_id, role_id, column_id, is_default)
         VALUES (?, ?, ?, ?)`
      ).run(projectId, global.role_id, projectColumnId, global.is_default);
      count++;
    }
  }

  return count;
}

// ============================================================================
// Role Column Mapping Seed Function
// ============================================================================

/**
 * Seed a roles_columns entry for a newly added role in a specific project.
 * Called from RoleService.create() for each existing project when a new
 * global role is added.
 *
 * This function is idempotent — it will not create duplicate entries if
 * the role already has a mapping in the project.
 *
 * @param roleId - The role ID to add a column mapping for.
 * @param projectId - The project ID to create the mapping in.
 * @param defaultColumnId - The column ID to assign, or null for unrestricted access.
 */
export function seedRoleColumnMappings(
  roleId: number,
  projectId: number,
  defaultColumnId: number | null = null
): void {
  const db = getDb();

  // Check if a mapping already exists for this role in this project (idempotency)
  const existing = db.prepare<[number, number]>(
    'SELECT id FROM roles_columns WHERE role_id = ? AND project_id = ?'
  ).get(roleId, projectId);

  if (existing) {
    // Update existing mapping if different column assigned
    const current = db.prepare<[number, number], { column_id: number | null }>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(roleId, projectId);
    if (current && current.column_id !== defaultColumnId) {
      db.prepare<[number | null, number, number]>(
        'UPDATE roles_columns SET column_id = ? WHERE role_id = ? AND project_id = ?'
      ).run(defaultColumnId, roleId, projectId);
    }
    return;
  }

  // Insert new mapping
  db.prepare<[number, number, number | null]>(
    'INSERT INTO roles_columns (role_id, project_id, column_id) VALUES (?, ?, ?)'
  ).run(roleId, projectId, defaultColumnId);
}

/**
 * Seed roles_columns entries for a newly added role across all existing projects.
 * Calls seedRoleColumnMappings for each project.
 *
 * @param roleId - The role ID to add mappings for.
 * @param defaultColumnId - The default column ID to assign, or null for unrestricted.
 */
export function seedRoleColumnMappingsForAllProjects(
  roleId: number,
  defaultColumnId: number | null = null
): void {
  const db = getDb();
  const projects = db.prepare<[], { id: number }>(
    'SELECT id FROM projects'
  ).all();

  for (const project of projects) {
    seedRoleColumnMappings(roleId, project.id, defaultColumnId);
  }
}

/**
 * Seed roles_columns entries for a newly added role at the global level.
 * Creates a project_id IS NULL entry for the role.
 *
 * @param roleId - The role ID to add a global mapping for.
 * @param defaultColumnId - The default column ID or null.
 */
export function seedGlobalRoleColumnMapping(
  roleId: number,
  defaultColumnId: number | null = null
): void {
  const db = getDb();

  // Check if global mapping already exists
  const existing = db.prepare<[number]>(
    'SELECT id FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
  ).get(roleId);

  if (existing) {
    const current = db.prepare<[number], { column_id: number | null }>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
    ).get(roleId);
    if (current && current.column_id !== defaultColumnId) {
      db.prepare<[number | null, number]>(
        'UPDATE roles_columns SET column_id = ? WHERE role_id = ? AND project_id IS NULL'
      ).run(defaultColumnId, roleId);
    }
    return;
  }

  db.prepare<[number, number | null]>(
    'INSERT INTO roles_columns (role_id, project_id, column_id) VALUES (?, NULL, ?)'
  ).run(roleId, defaultColumnId);
}

// ============================================================================
// Global Defaults Seeding
// ============================================================================

/**
 * Seed global defaults with standard columns, workflows, access rules, and
 * role-column mappings.
 * These are project_id = NULL entries that new projects copy from.
 *
 * This function is idempotent — it will not create duplicates if global defaults already exist.
 */
export function seedGlobalDefaults(): void {
  const db = getDb();

  // Check if global columns already exist (idempotency)
  const existingGlobalColumns = db.prepare(
    'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL AND is_global = 1'
  ).get() as { total: number };

  if (existingGlobalColumns.total > 0) {
    // Global defaults already seeded — just ensure roles_columns are available
    seedRolesColumns();
    return;
  }

  // 1. Seed global columns
  interface GlobalColumnDef {
    slug: string;
    name: string;
    order: number;
    is_default: boolean;
  }

  const globalColumns: GlobalColumnDef[] = [
    { slug: 'todo', name: 'To Do', order: 0, is_default: true },
    { slug: 'implementation', name: 'Implementation', order: 1, is_default: false },
    { slug: 'unit_review', name: 'Unit Review', order: 2, is_default: false },
    { slug: 'integration_testing', name: 'Integration Testing', order: 3, is_default: false },
    { slug: 'final_review', name: 'Final Review', order: 4, is_default: false },
    { slug: 'done', name: 'Done', order: 5, is_default: false },
    { slug: 'human_feedback', name: 'Human Feedback', order: 6, is_default: false },
  ];

  const createdColumns: { slug: string; id: number }[] = [];

  for (const col of globalColumns) {
    const existing = db.prepare<[string]>(
      'SELECT id FROM kanban_columns WHERE project_id IS NULL AND slug = ?'
    ).get(col.slug) as { id: number } | undefined;

    if (!existing) {
      const result = createGlobalColumn(col.slug, col.name, col.order, col.is_default);
      if (result) {
        createdColumns.push({ slug: col.slug, id: result.id });
      }
    } else {
      createdColumns.push({ slug: col.slug, id: existing.id });
    }
  }

  // Build column slug → ID mapping
  const columnMap = new Map(createdColumns.map((c) => [c.slug, c.id]));

  // 2. Seed global workflow transitions
  interface GlobalTransitionDef {
    column_from: string;
    column_to: string;
    requiresComment: boolean;
    entireTicketGroup: boolean;
    roles: number[];
  }

  const globalTransitions: GlobalTransitionDef[] = [
    { column_from: 'human_feedback', column_to: 'todo', requiresComment: false, entireTicketGroup: false, roles: [1] },
    { column_from: 'human_feedback', column_to: 'unit_review', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3] },
    { column_from: 'human_feedback', column_to: 'integration_testing', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3] },
    { column_from: 'human_feedback', column_to: 'final_review', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3] },
    { column_from: 'todo', column_to: 'implementation', requiresComment: false, entireTicketGroup: false, roles: [1, 2, 3] },
    { column_from: 'todo', column_to: 'done', requiresComment: false, entireTicketGroup: false, roles: [1] },
    { column_from: 'todo', column_to: 'human_feedback', requiresComment: true, entireTicketGroup: false, roles: [1, 2, 3, 4, 5, 6, 7] },
    { column_from: 'implementation', column_to: 'unit_review', requiresComment: false, entireTicketGroup: false, roles: [1, 4] },
    { column_from: 'unit_review', column_to: 'implementation', requiresComment: true, entireTicketGroup: false, roles: [1, 5, 6] },
    { column_from: 'unit_review', column_to: 'human_feedback', requiresComment: true, entireTicketGroup: false, roles: [1, 5, 6] },
    { column_from: 'unit_review', column_to: 'integration_testing', requiresComment: true, entireTicketGroup: false, roles: [1, 5, 6] },
    { column_from: 'unit_review', column_to: 'done', requiresComment: true, entireTicketGroup: false, roles: [1, 5] },
    { column_from: 'integration_testing', column_to: 'implementation', requiresComment: true, entireTicketGroup: true, roles: [1, 6] },
    { column_from: 'integration_testing', column_to: 'human_feedback', requiresComment: true, entireTicketGroup: true, roles: [1, 6] },
    { column_from: 'integration_testing', column_to: 'final_review', requiresComment: true, entireTicketGroup: true, roles: [1, 6] },
    { column_from: 'final_review', column_to: 'implementation', requiresComment: true, entireTicketGroup: true, roles: [1, 7] },
    { column_from: 'final_review', column_to: 'human_feedback', requiresComment: true, entireTicketGroup: true, roles: [1, 7] },
    { column_from: 'final_review', column_to: 'done', requiresComment: true, entireTicketGroup: true, roles: [1, 7] },
    { column_from: 'done', column_to: 'implementation', requiresComment: true, entireTicketGroup: false, roles: [1] },
  ];

  for (const trans of globalTransitions) {
    const fromColId = columnMap.get(trans.column_from);
    const toColId = columnMap.get(trans.column_to);

    if (fromColId === undefined || toColId === undefined) continue;

    // Check if already exists
    const existing = db.prepare<[number, number]>(
      'SELECT id FROM workflow_transitions WHERE project_id IS NULL AND column_from = ? AND column_to = ?'
    ).get(fromColId, toColId);

    if (!existing) {
      const result = createGlobalWorkflow(fromColId, toColId, trans.requiresComment, trans.entireTicketGroup);
      if (result) {
        for (const roleId of trans.roles) {
          addTransitionAllowedRole(result.id, roleId);
        }
      }
    }
  }

  // 3. Seed global access rules (project_id = NULL)
  const globalAccessRules: GlobalAccessRule[] = [
    // human_feedback
    { id: 0, project_id: null, column_id: columnMap.get('human_feedback')!, role_id: 1, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('human_feedback')!, role_id: 1, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('human_feedback')!, role_id: 2, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('human_feedback')!, role_id: 1, action_type: 'delete', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('human_feedback')!, role_id: 2, action_type: 'delete', is_global: 1 },
    // todo
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 1, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 2, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 3, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 1, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 2, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 3, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 1, action_type: 'delete', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 2, action_type: 'delete', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('todo')!, role_id: 3, action_type: 'delete', is_global: 1 },
    // implementation
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 1, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 2, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 3, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 1, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 2, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 3, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 4, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 1, action_type: 'delete', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('implementation')!, role_id: 2, action_type: 'delete', is_global: 1 },
    // unit_review
    { id: 0, project_id: null, column_id: columnMap.get('unit_review')!, role_id: 1, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('unit_review')!, role_id: 1, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('unit_review')!, role_id: 2, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('unit_review')!, role_id: 5, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('unit_review')!, role_id: 6, action_type: 'edit', is_global: 1 },
    // integration_testing
    { id: 0, project_id: null, column_id: columnMap.get('integration_testing')!, role_id: 1, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('integration_testing')!, role_id: 1, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('integration_testing')!, role_id: 2, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('integration_testing')!, role_id: 6, action_type: 'edit', is_global: 1 },
    // final_review
    { id: 0, project_id: null, column_id: columnMap.get('final_review')!, role_id: 1, action_type: 'create', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('final_review')!, role_id: 1, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('final_review')!, role_id: 2, action_type: 'edit', is_global: 1 },
    { id: 0, project_id: null, column_id: columnMap.get('final_review')!, role_id: 7, action_type: 'edit', is_global: 1 },
  ];

  // Convert to the format expected by replaceGlobalAccessRules
  const rulesForReplace = globalAccessRules.map((r) => ({
    column_id: r.column_id,
    role_id: r.role_id,
    action_type: r.action_type,
  }));

  replaceGlobalAccessRules(rulesForReplace);

  // 4. Seed global roles_columns entries
  seedRolesColumns();
}
