import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDbHolder = { db: null as ReturnType<typeof createMockDb> | null };

vi.mock('../db/database.js', () => ({
  getDb: () => mockDbHolder.db,
}));

function createMockDb() {
  const columns: Record<string, { id: number; slug: string; project_id: number }[]> = {};
  const transitions: { id: number; project_id: number; column_from: number; column_to: number; requires_comment: number; from_slug: string; to_slug: string }[] = [];
  const allowedRoles: { id: number; transition_id: number; role_id: number }[] = [];
  const unrestrictedRoles: { role_id: number; project_id: number }[] = [];
  let nextTransitionId = 1;

  function setColumns(projectId: number, colDefs: { slug: string }[]) {
    columns[projectId] = colDefs.map((c, i) => ({ id: i + 1, slug: c.slug, project_id: projectId }));
  }

  function setTransitions(projectId: number, defs: { from_slug: string; to_slug: string; requires_comment: number; allowed_role_ids: number[] }[]) {
    const colIds = columns[projectId] || [];
    for (const def of defs) {
      const fromCol = colIds.find(c => c.slug === def.from_slug);
      const toCol = colIds.find(c => c.slug === def.to_slug);
      if (!fromCol || !toCol) continue;
      const tid = nextTransitionId++;
      transitions.push({ id: tid, project_id: projectId, column_from: fromCol.id, column_to: toCol.id, requires_comment: def.requires_comment, from_slug: def.from_slug, to_slug: def.to_slug });
      for (const rid of def.allowed_role_ids) {
        allowedRoles.push({ id: tid, transition_id: tid, role_id: rid });
      }
    }
  }

  function setUnrestrictedRoles(projectId: number, roleIds: number[]) {
    for (const rid of roleIds) {
      unrestrictedRoles.push({ role_id: rid, project_id: projectId });
    }
  }

  function reset() {
    for (const key of Object.keys(columns)) delete columns[key];
    transitions.length = 0;
    allowedRoles.length = 0;
    unrestrictedRoles.length = 0;
    nextTransitionId = 1;
  }

  return {
    columns: columns as unknown as Record<string, { id: number; slug: string; project_id: number }[]>,
    transitions,
    allowedRoles,
    unrestrictedRoles,
    setColumns,
    setTransitions,
    setUnrestrictedRoles,
    reset,
    prepare: vi.fn((sql: string) => {
      const stmt = {
        get: vi.fn((...params: unknown[]) => {
          const sqlStr = sql.toLowerCase();
          // Handle roles_columns queries for unrestricted role check
          if (sqlStr.includes('roles_columns') && sqlStr.includes('column_id is null')) {
            const roleId = params[0] as number;
            const projectId = params[1] as number;
            return unrestrictedRoles.find(r => r.role_id === roleId && r.project_id === projectId)
              ? { column_id: null }
              : undefined;
          }
          const projectId = params[0] as number;
          const slug = params[1] as string;
          const cols = columns[projectId];
          if (!cols) return undefined;
          return cols.find(c => c.slug === slug);
        }),
        all: vi.fn((...params: unknown[]) => {
          const sqlStr = sql.toLowerCase();
          // Check workflow_transitions queries FIRST (before kanban_columns handlers)
          if (sqlStr.includes('workflow_transitions') && sqlStr.includes('transition_allowed_roles') && sqlStr.includes('wt.column_to') && sqlStr.includes('wt.column_from') && !sqlStr.includes('kc.slug')) {
            // canTransition query - LEFT JOIN returns one row per allowed role
            const projectId = params[0] as number;
            const colFrom = params[1] as number;
            const colTo = params[2] as number;
            const matchingTransitions = transitions
              .filter(t => t.project_id === projectId && t.column_from === colFrom && t.column_to === colTo);
            const result: typeof transitions & { role_id: number | null }[] = [];
            for (const t of matchingTransitions) {
              const matchingRoles = allowedRoles.filter(ar => ar.transition_id === t.id);
              if (matchingRoles.length === 0) {
                result.push({ ...t, from_slug: t.from_slug, to_slug: t.to_slug, role_id: null } as any);
              } else {
                for (const ar of matchingRoles) {
                  result.push({ ...t, from_slug: t.from_slug, to_slug: t.to_slug, role_id: ar.role_id } as any);
                }
              }
            }
            return result;
          }
          if (sqlStr.includes('workflow_transitions') && sqlStr.includes('kc.slug')) {
            // getAllowedTransitions query with role filtering
            const projectId = params[0] as number;
            const roleId = params[2] as number;
            const colFrom = params[1] as number;
            // Check if role is unrestricted (new SQL pattern)
            const isUnrestricted = params.length >= 5 && unrestrictedRoles.some(r => r.role_id === roleId && r.project_id === projectId);
            const matchingTransitions = transitions
              .filter(t => t.project_id === projectId && t.column_from === colFrom);
            const result: { to_column_slug: string; requires_comment: number }[] = [];
            for (const t of matchingTransitions) {
              const matchingCols = columns[t.project_id]?.filter(c => c.id === t.column_to) || [];
              const toSlug = matchingCols.length > 0 ? matchingCols[0].slug : 'unknown';
              if (isUnrestricted) {
                result.push({ to_column_slug: toSlug, requires_comment: t.requires_comment });
              } else {
                const matchingRoles = allowedRoles.filter(ar => ar.transition_id === t.id && ar.role_id === roleId);
                if (matchingRoles.length > 0) {
                  result.push({ to_column_slug: toSlug, requires_comment: t.requires_comment });
                }
              }
            }
            return result;
          }
          // Then check kanban_columns queries with != (e.g., get all columns except human_feedback)
          if (sqlStr.includes('kanban_columns') && sqlStr.includes('slug !=') && !sqlStr.includes('workflow_transitions')) {
            const projectId = params[0] as number;
            const excludeSlug = params[1] as string;
            const cols = columns[projectId];
            if (!cols) return [];
            return cols.filter(c => c.slug !== excludeSlug);
          }
          if (sqlStr.includes('kanban_columns') && sqlStr.includes('slug') && !sqlStr.includes('workflow_transitions')) {
            const projectId = params[0] as number;
            const slug = params[1] as string;
            const cols = columns[projectId];
            if (!cols) return [];
            return cols.filter(c => c.slug === slug);
          }
           // Fallback: log unrecognized queries for debugging
           if (sqlStr.includes('workflow_transitions')) {
             console.log('UNMATCHED workflow_transitions query:', sqlStr.substring(0, 200));
           }
           return [];
        }),
        run: vi.fn(() => ({ lastInsertRowid: 0, changes: 0 })),
        bind: vi.fn(function (this: any, ...bparams: unknown[]) {
          const self: any = this;
          return {
            get: vi.fn((...rest: unknown[]) => self.get(...bparams, ...rest)),
            all: vi.fn((...rest: unknown[]) => self.all(...bparams, ...rest)),
          };
        }),
      };
      return stmt;
    }),
    exec: vi.fn(),
    pragma: vi.fn(() => undefined),
    close: vi.fn(),
  };
}

function setupMockDb() {
  const mockDb = createMockDb();
  mockDb.setColumns(1, [
    { slug: 'todo' },
    { slug: 'implementation' },
    { slug: 'done' },
    { slug: 'human_feedback' },
  ]);
  mockDb.setTransitions(1, [
    { from_slug: 'todo', to_slug: 'implementation', requires_comment: 0, allowed_role_ids: [1, 4] },
    { from_slug: 'implementation', to_slug: 'done', requires_comment: 1, allowed_role_ids: [1, 4] },
    { from_slug: 'todo', to_slug: 'done', requires_comment: 1, allowed_role_ids: [1] },
  ]);
  mockDb.setUnrestrictedRoles(1, [1]);
  return mockDb;
}

describe('canTransition', () => {
  beforeEach(() => {
    mockDbHolder.db = setupMockDb();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows valid transition todo -> implementation', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'implementation', 4);
    expect(result.allowed).toBe(true);
    expect(result.requiresComment).toBe(false);
  });

  it('allows valid transition todo -> done', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'done', 1);
    expect(result.allowed).toBe(true);
    expect(result.requiresComment).toBe(true);
  });

  it('disallows invalid transition todo -> done for non-allowed role', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'done', 4);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('disallows non-existent transition', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'qa', 4);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when from column not found', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'nonexistent', 'implementation', 4);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when to column not found', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'nonexistent', 4);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('allows human feedback bypass for unrestricted role', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'human_feedback', 'implementation', 1);
    expect(result.allowed).toBe(true);
    expect(result.requiresComment).toBe(false);
  });

  it('allows human feedback bypass to any valid column for unrestricted role', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'human_feedback', 'done', 1);
    expect(result.allowed).toBe(true);
    expect(result.requiresComment).toBe(false);
  });

  it('disallows human feedback for non-unrestricted role', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'human_feedback', 'implementation', 4);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('No transition defined');
  });

  it('requires comment for implementation -> done transition', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'implementation', 'done', 4);
    expect(result.allowed).toBe(true);
    expect(result.requiresComment).toBe(true);
  });

  it('does not require comment for todo -> implementation', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'implementation', 4);
    expect(result.allowed).toBe(true);
    expect(result.requiresComment).toBe(false);
  });

  it('returns allowed=false when transition exists but role not in allowed_roles', async () => {
    const { canTransition: ct } = await import('../workflow/engine.js');
    const result = ct(1, 'todo', 'implementation', 99);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('not allowed');
  });
});

describe('getAllowedTransitions', () => {
  beforeEach(() => {
    mockDbHolder.db = setupMockDb();
    vi.resetModules();
  });

  it('returns allowed transitions from todo for role 4', async () => {
    const { getAllowedTransitions: gat } = await import('../workflow/engine.js');
    const result = gat(1, 'todo', 4);
    expect(result.length).toBeGreaterThan(0);
    const toImpl = result.find(r => r.toColumnSlug === 'implementation');
    expect(toImpl).toBeDefined();
    expect(toImpl?.requiresComment).toBe(false);
  });

  it('returns allowed transitions from todo for role 1', async () => {
    const { getAllowedTransitions: gat } = await import('../workflow/engine.js');
    const result = gat(1, 'todo', 1);
    expect(result.some(r => r.toColumnSlug === 'implementation')).toBe(true);
    expect(result.some(r => r.toColumnSlug === 'done')).toBe(true);
  });

  it('returns allowed transitions from implementation', async () => {
    const { getAllowedTransitions: gat } = await import('../workflow/engine.js');
    const result = gat(1, 'implementation', 4);
    expect(result.length).toBe(1);
    expect(result[0].toColumnSlug).toBe('done');
    expect(result[0].requiresComment).toBe(true);
  });

  it('returns empty array for non-existent column', async () => {
    const { getAllowedTransitions: gat } = await import('../workflow/engine.js');
    const result = gat(1, 'nonexistent', 4);
    expect(result).toEqual([]);
  });

  it('returns all non-human_feedback columns for human_feedback with role 1', async () => {
    const { getAllowedTransitions: gat } = await import('../workflow/engine.js');
    const result = gat(1, 'human_feedback', 1);
    const slugs = result.map(r => r.toColumnSlug);
    expect(slugs).toContain('todo');
    expect(slugs).toContain('implementation');
    expect(slugs).toContain('done');
  });

  it('returns empty for human_feedback with non-role-1', async () => {
    const { getAllowedTransitions: gat } = await import('../workflow/engine.js');
    const result = gat(1, 'human_feedback', 4);
    expect(result).toEqual([]);
  });
});
