import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  Project,
  ProjectWithRelations,
  Column,
  ApiResponse,
  CreateColumnPayload,
} from '../api';
import { getProjects, getProjectBySlug, createProject, deleteProject, createColumn } from '../api';

export const useProjectStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const currentProject = ref<ProjectWithRelations | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchProjects(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Project[]> = await getProjects();
      if (res.success && res.data) {
        projects.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch projects';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  async function setCurrentProject(slug: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<ProjectWithRelations> = await getProjectBySlug(slug);
      if (res.success && res.data) {
        currentProject.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch project';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  async function createProjectAction(name: string, slug: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Project> = await createProject({ name, slug });
      if (res.success && res.data) {
        const existingIdx = projects.value.findIndex((p: Project) => p.id === res.data!.id);
        if (existingIdx === -1) {
          projects.value.push(res.data);
        } else {
          projects.value[existingIdx] = res.data;
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to create project';
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

  async function addColumnAction(slug: string, payload: CreateColumnPayload): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Column> = await createColumn(slug, payload);
      if (res.success && res.data) {
        const columnData = res.data;
        if (currentProject.value) {
          const colExists = currentProject.value.columns.some((c: Column) => c.id === columnData.id);
          if (!colExists) {
            currentProject.value.columns.push(columnData);
          }
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to create column';
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

  async function deleteProjectAction(slug: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<void> = await deleteProject(slug);
      if (res.success) {
        projects.value = projects.value.filter((p: Project) => p.slug !== slug);
        if (currentProject.value?.slug === slug) {
          currentProject.value = null;
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to delete project';
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

  const currentProjectById = computed(() => (id: number): ProjectWithRelations | null => {
    if (currentProject.value && currentProject.value.id === id) {
      return currentProject.value;
    }
    return null;
  });

  return {
    projects,
    currentProject,
    loading,
    error,
    fetchProjects,
    setCurrentProject,
    createProject: createProjectAction,
    deleteProject: deleteProjectAction,
    addColumn: addColumnAction,
    currentProjectById,
  };
});
