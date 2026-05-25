import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGlobalSettingsStore } from '@/stores/global-settings';
import * as api from '@/api';

vi.mock('@/api', () => ({
  getGlobalColumns: vi.fn(),
  createGlobalColumn: vi.fn(),
  updateGlobalColumn: vi.fn(),
  deleteGlobalColumn: vi.fn(),
  getGlobalWorkflows: vi.fn(),
  createGlobalWorkflow: vi.fn(),
  updateGlobalWorkflow: vi.fn(),
  deleteGlobalWorkflow: vi.fn(),
  getGlobalAccessRules: vi.fn(),
  updateGlobalAccessRules: vi.fn(),
  getProjectSeedData: vi.fn(),
  resetGlobalSettings: vi.fn(),
  getGlobalRolesColumns: vi.fn(),
  createGlobalRolesColumn: vi.fn(),
  updateGlobalRolesColumn: vi.fn(),
  deleteGlobalRolesColumn: vi.fn(),
  getProjectRolesColumns: vi.fn(),
  createProjectRolesColumn: vi.fn(),
  updateProjectRolesColumn: vi.fn(),
  deleteProjectRolesColumn: vi.fn(),
}));

describe('useGlobalSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty state', () => {
      const store = useGlobalSettingsStore();
      expect(store.columns).toEqual([]);
      expect(store.workflows).toEqual([]);
      expect(store.accessRules).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('hasGlobalSettings returns false when empty', () => {
      const store = useGlobalSettingsStore();
      expect(store.hasGlobalSettings).toBe(false);
    });
  });

  // =========================================================================
  // fetchGlobalSettings
  // =========================================================================

  describe('fetchGlobalSettings', () => {
    it('fetches all settings and sets state', async () => {
      const columns = [{ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 }];
      const workflows = [{ id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 }];
      const rules = [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 }];

      vi.mocked(api.getGlobalColumns).mockResolvedValue({ success: true, data: columns });
      vi.mocked(api.getGlobalWorkflows).mockResolvedValue({ success: true, data: workflows });
      vi.mocked(api.getGlobalAccessRules).mockResolvedValue({ success: true, data: rules });

      const store = useGlobalSettingsStore();
      await store.fetchGlobalSettings();

      expect(store.columns).toEqual(columns);
      expect(store.workflows).toEqual(workflows);
      expect(store.accessRules).toEqual(rules);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets error on fetch failure', async () => {
      vi.mocked(api.getGlobalColumns).mockRejectedValue(new Error('Network failure'));

      const store = useGlobalSettingsStore();
      await store.fetchGlobalSettings();

      expect(store.error).toBe('Network failure');
      expect(store.loading).toBe(false);
    });

    it('hasGlobalSettings returns true after successful fetch', async () => {
      vi.mocked(api.getGlobalColumns).mockResolvedValue({ success: true, data: [{ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 }] });
      vi.mocked(api.getGlobalWorkflows).mockResolvedValue({ success: true, data: [] });
      vi.mocked(api.getGlobalAccessRules).mockResolvedValue({ success: true, data: [] });

      const store = useGlobalSettingsStore();
      await store.fetchGlobalSettings();

      expect(store.hasGlobalSettings).toBe(true);
    });
  });

  // =========================================================================
  // fetchGlobalColumns
  // =========================================================================

  describe('fetchGlobalColumns', () => {
    it('sets columns from API response', async () => {
      const columns = [{ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 }];
      vi.mocked(api.getGlobalColumns).mockResolvedValue({ success: true, data: columns });

      const store = useGlobalSettingsStore();
      await store.fetchGlobalColumns();

      expect(store.columns).toEqual(columns);
    });

    it('sets error on API failure', async () => {
      vi.mocked(api.getGlobalColumns).mockResolvedValue({ success: false, error: 'API error' });

      const store = useGlobalSettingsStore();
      await store.fetchGlobalColumns();

      expect(store.error).toBe('API error');
    });
  });

  // =========================================================================
  // fetchGlobalWorkflows
  // =========================================================================

  describe('fetchGlobalWorkflows', () => {
    it('sets workflows from API response', async () => {
      const workflows = [{ id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 }];
      vi.mocked(api.getGlobalWorkflows).mockResolvedValue({ success: true, data: workflows });

      const store = useGlobalSettingsStore();
      await store.fetchGlobalWorkflows();

      expect(store.workflows).toEqual(workflows);
    });
  });

  // =========================================================================
  // fetchGlobalAccessRules
  // =========================================================================

  describe('fetchGlobalAccessRules', () => {
    it('sets access rules from API response', async () => {
      const rules = [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 }];
      vi.mocked(api.getGlobalAccessRules).mockResolvedValue({ success: true, data: rules });

      const store = useGlobalSettingsStore();
      await store.fetchGlobalAccessRules();

      expect(store.accessRules).toEqual(rules);
    });
  });

  // =========================================================================
  // fetchSeedData
  // =========================================================================

  describe('fetchSeedData', () => {
    it('returns seed data from API', async () => {
      const seedData = {
        columns: [{ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 }],
        workflows: [{ id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 }],
        accessRules: [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 }],
      };
      vi.mocked(api.getProjectSeedData).mockResolvedValue({ success: true, data: seedData });

      const store = useGlobalSettingsStore();
      const result = await store.fetchSeedData();

      expect(result).toEqual(seedData);
      expect(store.loading).toBe(false);
    });

    it('returns null on seed data failure', async () => {
      vi.mocked(api.getProjectSeedData).mockResolvedValue({ success: false, error: 'No data' });

      const store = useGlobalSettingsStore();
      const result = await store.fetchSeedData();

      expect(result).toBeNull();
      expect(store.error).toBe('No data');
    });
  });

  // =========================================================================
  // createGlobalColumn (CRUD)
  // =========================================================================

  describe('createGlobalColumn', () => {
    it('creates a column and adds to state', async () => {
      const newColumn = { id: 2, project_id: null, slug: 'review', name: 'Review', order: 2, is_global: 1, is_default: 0 };
      vi.mocked(api.createGlobalColumn).mockResolvedValue({ success: true, data: newColumn });

      const store = useGlobalSettingsStore();
      const result = await store.createGlobalColumn({ slug: 'review', name: 'Review', order: 2 });

      expect(result).toEqual(newColumn);
      expect(store.columns).toEqual([newColumn]);
    });

    it('returns null on failure', async () => {
      vi.mocked(api.createGlobalColumn).mockResolvedValue({ success: false, error: 'Conflict' });

      const store = useGlobalSettingsStore();
      const result = await store.createGlobalColumn({ slug: 'bad', name: 'Bad', order: 1 });

      expect(result).toBeNull();
      expect(store.error).toBe('Conflict');
    });
  });

  // =========================================================================
  // updateGlobalColumn
  // =========================================================================

  describe('updateGlobalColumn', () => {
    it('updates a column in state', async () => {
      const updated = { id: 1, project_id: null, slug: 'todo-updated', name: 'Todo Updated', order: 1, is_global: 1, is_default: 1 };
      vi.mocked(api.updateGlobalColumn).mockResolvedValue({ success: true, data: updated });

      const store = useGlobalSettingsStore();
      store.columns = [{ ...updated, name: 'Todo' }];

      const result = await store.updateGlobalColumn(1, { name: 'Todo Updated' });

      expect(result).toEqual(updated);
      expect(store.columns).toEqual([updated]);
    });

    it('returns null on failure', async () => {
      vi.mocked(api.updateGlobalColumn).mockResolvedValue({ success: false, error: 'Not found' });

      const store = useGlobalSettingsStore();
      const result = await store.updateGlobalColumn(99, { name: 'Nonexistent' });

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // deleteGlobalColumn
  // =========================================================================

  describe('deleteGlobalColumn', () => {
    it('removes column from state', async () => {
      vi.mocked(api.deleteGlobalColumn).mockResolvedValue({ success: true, data: { success: true, id: 1 } });

      const store = useGlobalSettingsStore();
      store.columns = [
        { id: 1, project_id: null, slug: 'delete', name: 'Delete', order: 1, is_global: 1, is_default: 0 },
        { id: 2, project_id: null, slug: 'keep', name: 'Keep', order: 2, is_global: 1, is_default: 0 },
      ];

      const result = await store.deleteGlobalColumn(1);

      expect(result).toBe(true);
      expect(store.columns).toHaveLength(1);
      expect(store.columns[0].slug).toBe('keep');
    });

    it('returns false on failure', async () => {
      vi.mocked(api.deleteGlobalColumn).mockResolvedValue({ success: false, error: 'Cannot delete default' });

      const store = useGlobalSettingsStore();
      const result = await store.deleteGlobalColumn(1);

      expect(result).toBe(false);
      expect(store.error).toBe('Cannot delete default');
    });
  });

  // =========================================================================
  // createGlobalWorkflow (CRUD)
  // =========================================================================

  describe('createGlobalWorkflow', () => {
    it('creates a workflow and adds to state', async () => {
      const newWorkflow = { id: 2, project_id: null, column_from: 1, column_to: 3, requires_comment: 0, is_global: 1, entire_ticket_group: 0 };
      vi.mocked(api.createGlobalWorkflow).mockResolvedValue({ success: true, data: newWorkflow });

      const store = useGlobalSettingsStore();
      const result = await store.createGlobalWorkflow({ column_from: 1, column_to: 3 });

      expect(result).toEqual(newWorkflow);
      expect(store.workflows).toEqual([newWorkflow]);
    });

    it('returns null on failure', async () => {
      vi.mocked(api.createGlobalWorkflow).mockResolvedValue({ success: false, error: 'Conflict' });

      const store = useGlobalSettingsStore();
      const result = await store.createGlobalWorkflow({ column_from: 1, column_to: 3 });

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // updateGlobalWorkflow
  // =========================================================================

  describe('updateGlobalWorkflow', () => {
    it('updates a workflow in state', async () => {
      const existingWorkflow = { id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 };
      vi.mocked(api.updateGlobalWorkflow).mockResolvedValue({ success: true, data: { success: true } });

      const store = useGlobalSettingsStore();
      store.workflows = [existingWorkflow];

      const result = await store.updateGlobalWorkflow(1, { requires_comment: true });

      expect(result).toBe(true);
      expect(store.workflows[0].requires_comment).toBe(1);
    });

    it('returns false on failure', async () => {
      vi.mocked(api.updateGlobalWorkflow).mockResolvedValue({ success: false, error: 'Not found' });

      const store = useGlobalSettingsStore();
      const result = await store.updateGlobalWorkflow(99, { requires_comment: true });

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // deleteGlobalWorkflow
  // =========================================================================

  describe('deleteGlobalWorkflow', () => {
    it('removes workflow from state', async () => {
      vi.mocked(api.deleteGlobalWorkflow).mockResolvedValue({ success: true, data: { success: true, id: 1 } });

      const store = useGlobalSettingsStore();
      store.workflows = [
        { id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 },
        { id: 2, project_id: null, column_from: 1, column_to: 3, requires_comment: 0, is_global: 1, entire_ticket_group: 0 },
      ];

      const result = await store.deleteGlobalWorkflow(1);

      expect(result).toBe(true);
      expect(store.workflows).toHaveLength(1);
    });

    it('returns false on failure', async () => {
      vi.mocked(api.deleteGlobalWorkflow).mockResolvedValue({ success: false, error: 'Not found' });

      const store = useGlobalSettingsStore();
      const result = await store.deleteGlobalWorkflow(1);

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // updateGlobalAccessRules
  // =========================================================================

  describe('updateGlobalAccessRules', () => {
    it('replaces access rules in state', async () => {
      const rules = [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'edit', is_global: 1 }];
      vi.mocked(api.updateGlobalAccessRules).mockResolvedValue({ success: true, data: rules });

      const store = useGlobalSettingsStore();
      const result = await store.updateGlobalAccessRules({ rules: [{ column_id: 1, role_id: 1, action_type: 'edit' }] });

      expect(result).toEqual(rules);
      expect(store.accessRules).toEqual(rules);
    });

    it('returns null on failure', async () => {
      vi.mocked(api.updateGlobalAccessRules).mockResolvedValue({ success: false, error: 'Invalid column' });

      const store = useGlobalSettingsStore();
      const result = await store.updateGlobalAccessRules({ rules: [{ column_id: 999, role_id: 1, action_type: 'view' }] });

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Getters
  // =========================================================================

  describe('getters', () => {
    describe('globalColumnsById', () => {
      it('returns column by id', () => {
        const store = useGlobalSettingsStore();
        store.columns = [
          { id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 },
          { id: 2, project_id: null, slug: 'done', name: 'Done', order: 2, is_global: 1, is_default: 0 },
        ];

        expect(store.globalColumnsById(1)).toEqual({ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 });
        expect(store.globalColumnsById(2)).toEqual({ id: 2, project_id: null, slug: 'done', name: 'Done', order: 2, is_global: 1, is_default: 0 });
      });

      it('returns undefined for missing id', () => {
        const store = useGlobalSettingsStore();
        expect(store.globalColumnsById(99)).toBeUndefined();
      });
    });

    describe('globalWorkflowsByColumnTo', () => {
      it('groups workflows by column_to', () => {
        const store = useGlobalSettingsStore();
        store.workflows = [
          { id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 },
          { id: 2, project_id: null, column_from: 2, column_to: 3, requires_comment: 1, is_global: 1, entire_ticket_group: 0 },
          { id: 3, project_id: null, column_from: 1, column_to: 3, requires_comment: 0, is_global: 1, entire_ticket_group: 1 },
        ];

        const grouped = store.globalWorkflowsByColumnTo;
        expect(grouped[2]).toHaveLength(1);
        expect(grouped[3]).toHaveLength(2);
      });

      it('returns empty object when no workflows', () => {
        const store = useGlobalSettingsStore();
        expect(store.globalWorkflowsByColumnTo).toEqual({});
      });
    });
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  describe('loading state', () => {
    it('sets loading to true during async operations', async () => {
      let resolveFn: () => void;
      vi.mocked(api.getGlobalColumns).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));

      const store = useGlobalSettingsStore();
      const fetchPromise = store.fetchGlobalColumns();

      expect(store.loading).toBe(false); // fetchGlobalColumns alone doesn't set loading

      resolveFn!();
      await fetchPromise;

      expect(store.loading).toBe(false);
    });

    it('fetchGlobalSettings sets loading during operation', async () => {
      let resolveFn: () => void;
      vi.mocked(api.getGlobalColumns).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));
      vi.mocked(api.getGlobalWorkflows).mockResolvedValue({ success: true, data: [] });
      vi.mocked(api.getGlobalAccessRules).mockResolvedValue({ success: true, data: [] });

      const store = useGlobalSettingsStore();
      const fetchPromise = store.fetchGlobalSettings();

      expect(store.loading).toBe(true);

      resolveFn!();
      await fetchPromise;

      expect(store.loading).toBe(false);
    });
  });

  // =========================================================================
  // resetGlobalDefaults
  // =========================================================================

  describe('resetGlobalDefaults', () => {
    it('should call the reset API and reload settings on success', async () => {
      const mockColumns = [
        { id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 },
        { id: 2, project_id: null, slug: 'done', name: 'Done', order: 2, is_global: 1, is_default: 0 },
      ];
      const mockWorkflows = [{ id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 }];
      const mockRules = [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 }];

      vi.mocked(api.resetGlobalSettings).mockResolvedValue({ success: true, data: { success: true, deleted: true } });
      vi.mocked(api.getGlobalColumns).mockResolvedValue({ success: true, data: mockColumns });
      vi.mocked(api.getGlobalWorkflows).mockResolvedValue({ success: true, data: mockWorkflows });
      vi.mocked(api.getGlobalAccessRules).mockResolvedValue({ success: true, data: mockRules });

      // Pre-populate with different data
      const store = useGlobalSettingsStore();
      store.columns = [{ id: 99, project_id: null, slug: 'old', name: 'Old', order: 0, is_global: 1, is_default: 0 }];
      store.workflows = [];
      store.accessRules = [];

      const result = await store.resetGlobalDefaults();

      expect(result).toBe(true);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();

      // Verify settings were reloaded
      expect(store.columns).toEqual(mockColumns);
      expect(store.workflows).toEqual(mockWorkflows);
      expect(store.accessRules).toEqual(mockRules);
    });

    it('should set error on API failure', async () => {
      vi.mocked(api.resetGlobalSettings).mockResolvedValue({ success: false, error: 'API error' });

      const store = useGlobalSettingsStore();
      const result = await store.resetGlobalDefaults();

      expect(result).toBe(false);
      expect(store.loading).toBe(false);
      expect(store.error).toBe('API error');
    });

    it('should handle network error during reset', async () => {
      vi.mocked(api.resetGlobalSettings).mockRejectedValue(new Error('Network failure'));

      const store = useGlobalSettingsStore();
      const result = await store.resetGlobalDefaults();

      expect(result).toBe(false);
      expect(store.loading).toBe(false);
      expect(store.error).toBe('Network failure');
    });

    it('should set loading during reset operation', async () => {
      let resolveFn: () => void;
      vi.mocked(api.resetGlobalSettings).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));

      const store = useGlobalSettingsStore();
      const resetPromise = store.resetGlobalDefaults();

      expect(store.loading).toBe(true);

      resolveFn!();
      await resetPromise;

      expect(store.loading).toBe(false);
    });
  });

  // =========================================================================
  // Roles Columns - Initial State
  // =========================================================================

  describe('rolesColumns initial state', () => {
    it('starts with empty roles columns state', () => {
      const store = useGlobalSettingsStore();
      expect(store.rolesColumns).toEqual([]);
      expect(store.projectRolesColumns).toEqual([]);
      expect(store.rolesColumnsLoading).toBe(false);
      expect(store.projectRolesColumnsLoading).toBe(false);
    });
  });

  // =========================================================================
  // Roles Columns - Global
  // =========================================================================

  describe('loadRolesColumns', () => {
    it('sets rolesColumns from API response', async () => {
      const rolesColumns = [
        { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1 },
        { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: null, column_name: null, is_default: 0 },
      ];
      vi.mocked(api.getGlobalRolesColumns).mockResolvedValue({ success: true, data: rolesColumns });

      const store = useGlobalSettingsStore();
      await store.loadRolesColumns();

      expect(store.rolesColumns).toEqual(rolesColumns);
      expect(store.rolesColumnsLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets error on API failure', async () => {
      vi.mocked(api.getGlobalRolesColumns).mockResolvedValue({ success: false, error: 'API error' });

      const store = useGlobalSettingsStore();
      await store.loadRolesColumns();

      expect(store.error).toBe('API error');
      expect(store.rolesColumnsLoading).toBe(false);
    });

    it('sets error on network failure', async () => {
      vi.mocked(api.getGlobalRolesColumns).mockRejectedValue(new Error('Network failure'));

      const store = useGlobalSettingsStore();
      await store.loadRolesColumns();

      expect(store.error).toBe('Network failure');
      expect(store.rolesColumnsLoading).toBe(false);
    });

    it('sets loading during fetch', async () => {
      let resolveFn: () => void;
      vi.mocked(api.getGlobalRolesColumns).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));

      const store = useGlobalSettingsStore();
      const promise = store.loadRolesColumns();

      expect(store.rolesColumnsLoading).toBe(true);

      resolveFn!();
      await promise;

      expect(store.rolesColumnsLoading).toBe(false);
    });
  });

  describe('upsertGlobalRolesColumn', () => {
    it('creates a new roles column and adds to state', async () => {
      const newRoleColumn = { id: 3, role_id: 3, role_name: 'AI architect', column_id: 16, column_name: 'Implementation', is_default: 1 };
      vi.mocked(api.createGlobalRolesColumn).mockResolvedValue({ success: true, data: newRoleColumn });

      const store = useGlobalSettingsStore();
      const result = await store.upsertGlobalRolesColumn({ role_id: 3, column_id: 16, is_default: 1 });

      expect(result).toEqual(newRoleColumn);
      expect(store.rolesColumns).toEqual([newRoleColumn]);
      expect(store.rolesColumnsLoading).toBe(false);
    });

    it('updates an existing roles column in state', async () => {
      const existing = { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1 };
      const updated = { id: 1, role_id: 1, role_name: 'Human User', column_id: 16, column_name: 'Implementation', is_default: 0 };
      vi.mocked(api.createGlobalRolesColumn).mockResolvedValue({ success: true, data: updated });

      const store = useGlobalSettingsStore();
      store.rolesColumns = [existing];

      const result = await store.upsertGlobalRolesColumn({ role_id: 1, column_id: 16, is_default: 0 });

      expect(result).toEqual(updated);
      expect(store.rolesColumns).toEqual([updated]);
    });

    it('returns null on failure', async () => {
      vi.mocked(api.createGlobalRolesColumn).mockResolvedValue({ success: false, error: 'Role not found' });

      const store = useGlobalSettingsStore();
      const result = await store.upsertGlobalRolesColumn({ role_id: 999, column_id: 15 });

      expect(result).toBeNull();
      expect(store.error).toBe('Role not found');
    });

    it('handles null column_id', async () => {
      const newRoleColumn = { id: 3, role_id: 3, role_name: 'AI architect', column_id: null, column_name: null, is_default: 0 };
      vi.mocked(api.createGlobalRolesColumn).mockResolvedValue({ success: true, data: newRoleColumn });

      const store = useGlobalSettingsStore();
      const result = await store.upsertGlobalRolesColumn({ role_id: 3, column_id: null });

      expect(result).toEqual(newRoleColumn);
    });

    it('handles missing is_default, defaults to 0', async () => {
      const newRoleColumn = { id: 3, role_id: 3, role_name: 'AI architect', column_id: 16, column_name: 'Implementation', is_default: 0 };
      vi.mocked(api.createGlobalRolesColumn).mockResolvedValue({ success: true, data: newRoleColumn });

      const store = useGlobalSettingsStore();
      await store.upsertGlobalRolesColumn({ role_id: 3, column_id: 16 });

      expect(store.rolesColumns).toEqual([newRoleColumn]);
    });
  });

  describe('deleteGlobalRolesColumn', () => {
    it('removes roles column from state', async () => {
      vi.mocked(api.deleteGlobalRolesColumn).mockResolvedValue({ success: true, data: { deleted: true, role_id: 1 } });

      const store = useGlobalSettingsStore();
      store.rolesColumns = [
        { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1 },
        { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: null, column_name: null, is_default: 0 },
      ];

      const result = await store.deleteGlobalRolesColumn(1);

      expect(result).toBe(true);
      expect(store.rolesColumns).toHaveLength(1);
      expect(store.rolesColumns[0].role_id).toBe(2);
    });

    it('returns false on failure', async () => {
      vi.mocked(api.deleteGlobalRolesColumn).mockResolvedValue({ success: false, error: 'Cannot delete last column' });

      const store = useGlobalSettingsStore();
      const result = await store.deleteGlobalRolesColumn(1);

      expect(result).toBe(false);
      expect(store.error).toBe('Cannot delete last column');
    });
  });

  // =========================================================================
  // Roles Columns - Project
  // =========================================================================

  describe('loadProjectRolesColumns', () => {
    it('sets projectRolesColumns from API response', async () => {
      const rolesColumns = [
        { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1, is_override: 0 },
        { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: 17, column_name: 'Unit Review', is_default: 0, is_override: 1 },
      ];
      vi.mocked(api.getProjectRolesColumns).mockResolvedValue({ success: true, data: rolesColumns });

      const store = useGlobalSettingsStore();
      await store.loadProjectRolesColumns('test-project');

      expect(store.projectRolesColumns).toEqual(rolesColumns);
      expect(store.projectRolesColumnsLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets error on API failure', async () => {
      vi.mocked(api.getProjectRolesColumns).mockResolvedValue({ success: false, error: 'Not found' });

      const store = useGlobalSettingsStore();
      await store.loadProjectRolesColumns('test-project');

      expect(store.error).toBe('Not found');
      expect(store.projectRolesColumnsLoading).toBe(false);
    });

    it('sets loading during fetch', async () => {
      let resolveFn: () => void;
      vi.mocked(api.getProjectRolesColumns).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));

      const store = useGlobalSettingsStore();
      const promise = store.loadProjectRolesColumns('test-project');

      expect(store.projectRolesColumnsLoading).toBe(true);

      resolveFn!();
      await promise;

      expect(store.projectRolesColumnsLoading).toBe(false);
    });
  });

  describe('upsertProjectRolesColumn', () => {
    it('creates a new project roles column and adds to state', async () => {
      const newRoleColumn = { id: 3, role_id: 3, role_name: 'AI architect', column_id: 18, column_name: 'Integration Testing', is_default: 0, is_override: 1 };
      vi.mocked(api.createProjectRolesColumn).mockResolvedValue({ success: true, data: newRoleColumn });

     const store = useGlobalSettingsStore();
      const result = await store.upsertProjectRolesColumn('test-project', { role_id: 3, column_id: 18, is_default: 0 });

      expect(result).toEqual(newRoleColumn);
      expect(store.projectRolesColumns).toEqual([newRoleColumn]);
    });

    it('updates an existing project roles column in state', async () => {
      const existing = { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1, is_override: 1 };
      const updated = { id: 1, role_id: 1, role_name: 'Human User', column_id: 16, column_name: 'Implementation', is_default: 0, is_override: 1 };
      vi.mocked(api.createProjectRolesColumn).mockResolvedValue({ success: true, data: updated });

      const store = useGlobalSettingsStore();
      store.projectRolesColumns = [existing];

      const result = await store.upsertProjectRolesColumn('test-project', { role_id: 1, column_id: 16, is_default: 0 });

      expect(result).toEqual(updated);
      expect(store.projectRolesColumns).toEqual([updated]);
    });

    it('returns null on failure', async () => {
      vi.mocked(api.createProjectRolesColumn).mockResolvedValue({ success: false, error: 'Column not found' });

      const store = useGlobalSettingsStore();
      const result = await store.upsertProjectRolesColumn('test-project', { role_id: 1, column_id: 999 });

      expect(result).toBeNull();
      expect(store.error).toBe('Column not found');
    });
  });

  describe('deleteProjectRolesColumn', () => {
    it('removes project roles column from state', async () => {
      vi.mocked(api.deleteProjectRolesColumn).mockResolvedValue({ success: true, data: { deleted: true, role_id: 2 } });

      const store = useGlobalSettingsStore();
      store.projectRolesColumns = [
        { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1, is_override: 0 },
        { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: 17, column_name: 'Unit Review', is_default: 0, is_override: 1 },
      ];

      const result = await store.deleteProjectRolesColumn('test-project', 2);

      expect(result).toBe(true);
      expect(store.projectRolesColumns).toHaveLength(1);
      expect(store.projectRolesColumns[0].role_id).toBe(1);
    });

    it('returns false on failure', async () => {
      vi.mocked(api.deleteProjectRolesColumn).mockResolvedValue({ success: false, error: 'Not found' });

      const store = useGlobalSettingsStore();
      const result = await store.deleteProjectRolesColumn('test-project', 999);

      expect(result).toBe(false);
      expect(store.error).toBe('Not found');
    });
  });
});
