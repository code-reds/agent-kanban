import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  GlobalColumn,
  GlobalWorkflowTransition,
  GlobalAccessRule,
  ApiResponse,
  CreateGlobalColumnPayload,
  UpdateGlobalColumnPayload,
  CreateGlobalWorkflowPayload,
  UpdateGlobalWorkflowPayload,
  BulkUpdateAccessRulesPayload,
  SeedData,
  RolesColumn,
  RolesColumnPayload,
} from '../api';
import {
  getGlobalColumns,
  createGlobalColumn,
  updateGlobalColumn,
  deleteGlobalColumn,
  getGlobalWorkflows,
  createGlobalWorkflow,
  updateGlobalWorkflow,
  deleteGlobalWorkflow,
  getGlobalAccessRules,
  updateGlobalAccessRules,
  getProjectSeedData,
  resetGlobalSettings,
  getGlobalRolesColumns,
  createGlobalRolesColumn,
  updateGlobalRolesColumn,
  deleteGlobalRolesColumn,
  getProjectRolesColumns,
  createProjectRolesColumn,
  updateProjectRolesColumn,
  deleteProjectRolesColumn,
} from '../api';

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  const columns = ref<GlobalColumn[]>([]);
  const workflows = ref<GlobalWorkflowTransition[]>([]);
  const accessRules = ref<GlobalAccessRule[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Roles columns state
  const rolesColumns = ref<RolesColumn[]>([]);
  const projectRolesColumns = ref<RolesColumn[]>([]);
  const rolesColumnsLoading = ref(false);
  const projectRolesColumnsLoading = ref(false);

  // =========================================================================
  // Getters
  // =========================================================================

  /**
   * Check if any global settings have been loaded.
   */
  const hasGlobalSettings = computed(() => {
    return columns.value.length > 0 || workflows.value.length > 0 || accessRules.value.length > 0;
  });

  /**
   * Lookup a global column by its ID.
   */
  const globalColumnsById = computed(() => {
    return (id: number): GlobalColumn | undefined => {
      return columns.value.find((c) => c.id === id);
    };
  });

  /**
   * Lookup global workflows grouped by column_to.
   */
  const globalWorkflowsByColumnTo = computed(() => {
    const grouped: Record<number, GlobalWorkflowTransition[]> = {};
    for (const workflow of workflows.value) {
      if (!grouped[workflow.column_to]) {
        grouped[workflow.column_to] = [];
      }
      grouped[workflow.column_to].push(workflow);
    }
    return grouped;
  });

  // =========================================================================
  // Actions — Fetch
  // =========================================================================

  /**
   * Fetch all global settings (columns, workflows, access rules).
   */
  async function fetchGlobalSettings(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await Promise.all([
        fetchGlobalColumns(),
        fetchGlobalWorkflows(),
        fetchGlobalAccessRules(),
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetch all global columns.
   */
  async function fetchGlobalColumns(): Promise<void> {
    try {
      const res: ApiResponse<GlobalColumn[]> = await getGlobalColumns();
      if (res.success && res.data) {
        columns.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch global columns';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    }
  }

  /**
   * Fetch all global workflows/transitions.
   */
  async function fetchGlobalWorkflows(): Promise<void> {
    try {
      const res: ApiResponse<GlobalWorkflowTransition[]> = await getGlobalWorkflows();
      if (res.success && res.data) {
        workflows.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch global workflows';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    }
  }

  /**
   * Fetch all global access rules.
   */
  async function fetchGlobalAccessRules(): Promise<void> {
    try {
      const res: ApiResponse<GlobalAccessRule[]> = await getGlobalAccessRules();
      if (res.success && res.data) {
        accessRules.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch global access rules';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    }
  }

  /**
   * Fetch seed data for new project creation.
   */
  async function fetchSeedData(): Promise<SeedData | null> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<SeedData> = await getProjectSeedData();
      if (res.success && res.data) {
        return res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch seed data';
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  // =========================================================================
  // Actions — Columns CRUD
  // =========================================================================

  /**
   * Create a new global column.
   */
  async function createGlobalColumnAction(payload: CreateGlobalColumnPayload): Promise<GlobalColumn | null> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<GlobalColumn> = await createGlobalColumn(payload);
      if (res.success && res.data) {
        columns.value.push(res.data);
        return res.data;
      } else {
        error.value = res.error ?? 'Failed to create global column';
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Update an existing global column.
   */
  async function updateGlobalColumnAction(
    columnId: number,
    payload: UpdateGlobalColumnPayload
  ): Promise<GlobalColumn | null> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<GlobalColumn> = await updateGlobalColumn(columnId, payload);
      if (res.success && res.data) {
        const idx = columns.value.findIndex((c) => c.id === columnId);
        if (idx !== -1) {
          columns.value[idx] = res.data;
        }
        return res.data;
      } else {
        error.value = res.error ?? 'Failed to update global column';
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Delete a global column.
   */
  async function deleteGlobalColumnAction(columnId: number): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ success: boolean; id: number }> = await deleteGlobalColumn(columnId);
      if (res.success && res.data) {
        columns.value = columns.value.filter((c) => c.id !== columnId);
        return true;
      } else {
        error.value = res.error ?? 'Failed to delete global column';
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return false;
    } finally {
      loading.value = false;
    }
  }

  // =========================================================================
  // Actions — Workflows CRUD
  // =========================================================================

  /**
   * Create a new global workflow transition.
   */
  async function createGlobalWorkflowAction(
    payload: CreateGlobalWorkflowPayload
  ): Promise<GlobalWorkflowTransition | null> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<GlobalWorkflowTransition> = await createGlobalWorkflow(payload);
      if (res.success && res.data) {
        workflows.value.push(res.data);
        return res.data;
      } else {
        error.value = res.error ?? 'Failed to create global workflow';
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Update an existing global workflow transition.
   */
  async function updateGlobalWorkflowAction(
    transitionId: number,
    payload: UpdateGlobalWorkflowPayload
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ success: boolean }> = await updateGlobalWorkflow(transitionId, payload);
      if (res.success && res.data) {
        // Update the local workflow data if we have the full record
        const existing = workflows.value.find((w) => w.id === transitionId);
        if (existing) {
          const idx = workflows.value.findIndex((w) => w.id === transitionId);
          workflows.value[idx] = {
            ...existing,
            ...payload,
            requires_comment: payload.requires_comment !== undefined ? (payload.requires_comment ? 1 : 0) : existing.requires_comment,
            entire_ticket_group: payload.entire_ticket_group !== undefined ? (payload.entire_ticket_group ? 1 : 0) : existing.entire_ticket_group,
          };
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to update global workflow';
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Delete a global workflow transition.
   */
  async function deleteGlobalWorkflowAction(transitionId: number): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ success: boolean; id: number }> = await deleteGlobalWorkflow(transitionId);
      if (res.success && res.data) {
        workflows.value = workflows.value.filter((w) => w.id !== transitionId);
        return true;
      } else {
        error.value = res.error ?? 'Failed to delete global workflow';
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return false;
    } finally {
      loading.value = false;
    }
  }

  // =========================================================================
  // Actions — Access Rules
  // =========================================================================

   /**
     * Bulk update (replace) global access rules.
     */
    async function updateGlobalAccessRulesAction(payload: BulkUpdateAccessRulesPayload): Promise<GlobalAccessRule[] | null> {
      loading.value = true;
      error.value = null;
      try {
        const res: ApiResponse<GlobalAccessRule[]> = await updateGlobalAccessRules(payload);
        if (res.success && res.data) {
          accessRules.value = res.data;
          return res.data;
        } else {
          error.value = res.error ?? 'Failed to update global access rules';
          return null;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        error.value = message;
        return null;
      } finally {
        loading.value = false;
      }
    }

 // =========================================================================
  // Actions — Roles Columns
  // =========================================================================

  /**
   * Fetch all global roles_columns entries.
   */
  async function loadRolesColumns(): Promise<void> {
    rolesColumnsLoading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<RolesColumn[]> = await getGlobalRolesColumns();
      if (res.success && res.data) {
        rolesColumns.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch global roles columns';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      rolesColumnsLoading.value = false;
    }
  }

  /**
   * Create or update a global roles_columns entry.
   */
  async function upsertGlobalRolesColumn(
    data: { role_id: number; column_id: number | null; is_default?: number }
  ): Promise<RolesColumn | null> {
    rolesColumnsLoading.value = true;
    error.value = null;
    try {
      const payload: RolesColumnPayload = {
        role_id: data.role_id,
        column_id: data.column_id ?? null,
        is_default: data.is_default ?? 0,
      };
      const res: ApiResponse<RolesColumn> = await createGlobalRolesColumn(payload);
      if (res.success && res.data) {
        // Replace existing entry for this role_id or push new one
        const idx = rolesColumns.value.findIndex((r) => r.role_id === data.role_id);
        if (idx !== -1) {
          rolesColumns.value[idx] = res.data;
        } else {
          rolesColumns.value.push(res.data);
        }
        return res.data;
      } else {
        error.value = res.error ?? 'Failed to upsert global roles column';
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return null;
    } finally {
      rolesColumnsLoading.value = false;
    }
  }

  /**
   * Delete a global roles_columns entry by role_id.
   */
  async function deleteGlobalRolesColumnAction(roleId: number): Promise<boolean> {
    rolesColumnsLoading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ deleted: boolean; role_id: number }> = await deleteGlobalRolesColumn(roleId);
      if (res.success && res.data) {
        rolesColumns.value = rolesColumns.value.filter((r) => r.role_id !== roleId);
        return true;
      } else {
        error.value = res.error ?? 'Failed to delete global roles column';
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return false;
    } finally {
      rolesColumnsLoading.value = false;
    }
  }

  /**
   * Fetch project-specific roles_columns entries.
   */
  async function loadProjectRolesColumns(slug: string): Promise<void> {
    projectRolesColumnsLoading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<RolesColumn[]> = await getProjectRolesColumns(slug);
      if (res.success && res.data) {
        projectRolesColumns.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch project roles columns';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      projectRolesColumnsLoading.value = false;
    }
  }

  /**
   * Create or update a project-specific roles_columns entry.
   */
  async function upsertProjectRolesColumn(
    slug: string,
    data: { role_id: number; column_id: number | null; is_default?: number }
  ): Promise<RolesColumn | null> {
    projectRolesColumnsLoading.value = true;
    error.value = null;
    try {
      const payload: RolesColumnPayload = {
        role_id: data.role_id,
        column_id: data.column_id ?? null,
        is_default: data.is_default ?? 0,
      };
      const res: ApiResponse<RolesColumn> = await createProjectRolesColumn(slug, payload);
      if (res.success && res.data) {
        const idx = projectRolesColumns.value.findIndex((r) => r.role_id === data.role_id);
        if (idx !== -1) {
          projectRolesColumns.value[idx] = res.data;
        } else {
          projectRolesColumns.value.push(res.data);
        }
        return res.data;
      } else {
        error.value = res.error ?? 'Failed to upsert project roles column';
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return null;
    } finally {
      projectRolesColumnsLoading.value = false;
    }
  }

  /**
   * Delete a project-specific roles_columns entry by role_id.
   */
  async function deleteProjectRolesColumnAction(slug: string, roleId: number): Promise<boolean> {
    projectRolesColumnsLoading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ deleted: boolean; role_id: number }> = await deleteProjectRolesColumn(slug, roleId);
      if (res.success && res.data) {
        projectRolesColumns.value = projectRolesColumns.value.filter((r) => r.role_id !== roleId);
        return true;
      } else {
        error.value = res.error ?? 'Failed to delete project roles column';
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return false;
    } finally {
      projectRolesColumnsLoading.value = false;
    }
  }

    // =========================================================================
    // Actions — Reset to Defaults
    // =========================================================================

    /**
     * Reset all global settings to the standard defaults.
     * Drops existing global columns, workflows, and access rules,
     * then reseeds with defaults and reloads.
     */
    async function resetGlobalDefaults(): Promise<boolean> {
      loading.value = true;
      error.value = null;
      try {
        const res: ApiResponse<{ success: boolean; deleted: boolean }> = await resetGlobalSettings();
        if (res.success && res.data) {
          // Reload all settings after reset
          await fetchGlobalSettings();
          return true;
        } else {
          error.value = res.error ?? 'Failed to reset global settings';
          return false;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        error.value = message;
        return false;
      } finally {
        loading.value = false;
      }
    }

  return {
    columns,
    workflows,
    accessRules,
    loading,
    error,
    hasGlobalSettings,
    globalColumnsById,
    globalWorkflowsByColumnTo,
    fetchGlobalSettings,
    fetchGlobalColumns,
    fetchGlobalWorkflows,
    fetchGlobalAccessRules,
    fetchSeedData,
    createGlobalColumn: createGlobalColumnAction,
    updateGlobalColumn: updateGlobalColumnAction,
    deleteGlobalColumn: deleteGlobalColumnAction,
    createGlobalWorkflow: createGlobalWorkflowAction,
    updateGlobalWorkflow: updateGlobalWorkflowAction,
    deleteGlobalWorkflow: deleteGlobalWorkflowAction,
    updateGlobalAccessRules: updateGlobalAccessRulesAction,
    resetGlobalDefaults,
    // Roles columns
    rolesColumns,
    projectRolesColumns,
    rolesColumnsLoading,
    projectRolesColumnsLoading,
    loadRolesColumns,
    upsertGlobalRolesColumn,
    deleteGlobalRolesColumn: deleteGlobalRolesColumnAction,
    loadProjectRolesColumns,
    upsertProjectRolesColumn,
    deleteProjectRolesColumn: deleteProjectRolesColumnAction,
  };
});
