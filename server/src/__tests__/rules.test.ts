import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbHolder = { db: null as ReturnType<typeof createMockDb> | null };

vi.mock('../db/database.js', () => ({
  getDb: () => mockDbHolder.db,
}));

function createMockDb() {
  const accessRules: { id: number; project_id: number; column_id: number; role_id: number; action_type: string }[] = [];
  let nextId = 1;

  function addRule(projectId: number, columnId: number, roleId: number, actionType: string) {
    accessRules.push({ id: nextId++, project_id: projectId, column_id: columnId, role_id: roleId, action_type: actionType });
  }

  function reset() {
    accessRules.length = 0;
    nextId = 1;
  }

  return {
    accessRules,
    addRule,
    reset,
    prepare: vi.fn((sql: string) => {
      const stmt = {
        get: vi.fn((...params: unknown[]) => {
          const projectId = params[0] as number;
          const columnId = params[1] as number;
          const roleId = params[2] as number;
          const sqlStr = sql.toLowerCase();
          let actionType: string | null = null;
          if (sqlStr.includes("'create'")) actionType = 'create';
          else if (sqlStr.includes("'edit'")) actionType = 'edit';
          else if (sqlStr.includes("'delete'")) actionType = 'delete';

          return accessRules.find(r =>
            r.project_id === projectId &&
            r.column_id === columnId &&
            r.role_id === roleId &&
            (!actionType || r.action_type === actionType)
          );
        }),
        run: vi.fn(() => ({ lastInsertRowid: 0, changes: 0 })),
        all: vi.fn(() => []),
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

describe('canCreate', () => {
  beforeEach(() => {
    mockDbHolder.db = createMockDb();
    mockDbHolder.db.addRule(1, 1, 1, 'create');
    mockDbHolder.db.addRule(1, 1, 4, 'create');
    mockDbHolder.db.addRule(1, 2, 4, 'create');
    vi.resetModules();
  });

  it('returns true when role has create permission', async () => {
    const { canCreate: cc } = await import('../workflow/rules.js');
    expect(cc(1, 1, 1)).toBe(true);
    expect(cc(1, 1, 4)).toBe(true);
  });

  it('returns false when role lacks create permission', async () => {
    const { canCreate: cc } = await import('../workflow/rules.js');
    expect(cc(1, 2, 1)).toBe(false);
    expect(cc(1, 1, 99)).toBe(false);
  });

  it('returns false for nonexistent project', async () => {
    const { canCreate: cc } = await import('../workflow/rules.js');
    expect(cc(999, 1, 1)).toBe(false);
  });
});

describe('canEdit', () => {
  beforeEach(() => {
    mockDbHolder.db = createMockDb();
    mockDbHolder.db.addRule(1, 1, 1, 'edit');
    mockDbHolder.db.addRule(1, 1, 4, 'edit');
    vi.resetModules();
  });

  it('returns true when role has edit permission', async () => {
    const { canEdit: ce } = await import('../workflow/rules.js');
    expect(ce(1, 1, 1)).toBe(true);
    expect(ce(1, 1, 4)).toBe(true);
  });

  it('returns false when role lacks edit permission', async () => {
    const { canEdit: ce } = await import('../workflow/rules.js');
    expect(ce(1, 1, 99)).toBe(false);
    expect(ce(1, 2, 1)).toBe(false);
  });
});

describe('canDelete', () => {
  beforeEach(() => {
    mockDbHolder.db = createMockDb();
    mockDbHolder.db.addRule(1, 1, 1, 'delete');
    mockDbHolder.db.addRule(1, 1, 4, 'delete');
    vi.resetModules();
  });

  it('returns true when role has delete permission', async () => {
    const { canDelete: cd } = await import('../workflow/rules.js');
    expect(cd(1, 1, 1)).toBe(true);
    expect(cd(1, 1, 4)).toBe(true);
  });

  it('returns false when role lacks delete permission', async () => {
    const { canDelete: cd } = await import('../workflow/rules.js');
    expect(cd(1, 1, 99)).toBe(false);
    expect(cd(1, 2, 1)).toBe(false);
  });
});

describe('hasAnyAccess', () => {
  beforeEach(() => {
    mockDbHolder.db = createMockDb();
    mockDbHolder.db.addRule(1, 1, 1, 'create');
    mockDbHolder.db.addRule(1, 1, 4, 'edit');
    mockDbHolder.db.addRule(1, 2, 4, 'delete');
    vi.resetModules();
  });

  it('returns true when role has any access', async () => {
    const { hasAnyAccess: haa } = await import('../workflow/rules.js');
    expect(haa(1, 1, 1)).toBe(true);
    expect(haa(1, 1, 4)).toBe(true);
  });

  it('returns true when role has create but not edit', async () => {
    const { hasAnyAccess: haa } = await import('../workflow/rules.js');
    expect(haa(1, 1, 1)).toBe(true);
  });

  it('returns false when role has no access at all', async () => {
    const { hasAnyAccess: haa } = await import('../workflow/rules.js');
    expect(haa(1, 1, 99)).toBe(false);
    expect(haa(1, 999, 1)).toBe(false);
  });

  it('checks across multiple columns', async () => {
    const { hasAnyAccess: haa } = await import('../workflow/rules.js');
    expect(haa(1, 1, 4)).toBe(true);
    expect(haa(1, 2, 4)).toBe(true);
    expect(haa(1, 3, 4)).toBe(false);
  });
});

describe('default role (role 1) behavior', () => {
  beforeEach(() => {
    mockDbHolder.db = createMockDb();
    mockDbHolder.db.addRule(1, 1, 1, 'create');
    mockDbHolder.db.addRule(1, 1, 1, 'edit');
    mockDbHolder.db.addRule(1, 1, 1, 'delete');
    vi.resetModules();
  });

  it('role 1 can create for columns it has rules for', async () => {
    const { canCreate: cc } = await import('../workflow/rules.js');
    expect(cc(1, 1, 1)).toBe(true);
  });

  it('role 1 can edit for columns it has rules for', async () => {
    const { canEdit: ce } = await import('../workflow/rules.js');
    expect(ce(1, 1, 1)).toBe(true);
  });

  it('role 1 can delete for columns it has rules for', async () => {
    const { canDelete: cd } = await import('../workflow/rules.js');
    expect(cd(1, 1, 1)).toBe(true);
  });
});
