import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '@/stores/projects';
import * as api from '@/api';

vi.mock('@/api', () => ({
  getProjects: vi.fn(),
  getProjectBySlug: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  createColumn: vi.fn(),
}));

describe('useProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('fetchProjects sets projects from API response', async () => {
    const projects = [
      { id: 1, name: 'Project A', slug: 'project-a', description: '', created_at: '2024-01-01' },
      { id: 2, name: 'Project B', slug: 'project-b', description: '', created_at: '2024-01-02' },
    ];
    vi.mocked(api.getProjects).mockResolvedValue({ success: true, data: projects });

    const store = useProjectStore();
    await store.fetchProjects();

    expect(store.projects).toEqual(projects);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(api.getProjects).toHaveBeenCalled();
  });

  it('fetchProjects sets error on API failure', async () => {
    vi.mocked(api.getProjects).mockResolvedValue({ success: false, error: 'API error' });

    const store = useProjectStore();
    await store.fetchProjects();

    expect(store.error).toBe('API error');
    expect(store.projects).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('fetchProjects handles network error', async () => {
    vi.mocked(api.getProjects).mockRejectedValue(new Error('Network failure'));

    const store = useProjectStore();
    await store.fetchProjects();

    expect(store.error).toBe('Network failure');
    expect(store.loading).toBe(false);
  });

  it('setCurrentProject loads project details', async () => {
    const project = {
      id: 1,
      name: 'Test Project',
      slug: 'test',
      description: 'A test project',
      created_at: '2024-01-01',
      columns: [{ id: 1, project_id: 1, slug: 'todo', name: 'ToDo', position: 1, order: 1, is_default: 1 }],
      roles: [{ id: 1, name: 'Human User', access_level: 'admin' }],
      workflows: [],
      access_rules: [],
    };
    vi.mocked(api.getProjectBySlug).mockResolvedValue({ success: true, data: project });

    const store = useProjectStore();
    await store.setCurrentProject('test');

    expect(store.currentProject).toEqual(project);
    expect(store.loading).toBe(false);
    expect(api.getProjectBySlug).toHaveBeenCalledWith('test');
  });

  it('setCurrentProject sets error on failure', async () => {
    vi.mocked(api.getProjectBySlug).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useProjectStore();
    await store.setCurrentProject('nonexistent');

    expect(store.error).toBe('Not found');
    expect(store.currentProject).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('createProject adds project to list', async () => {
    const newProject = { id: 3, name: 'New Project', slug: 'new-project', description: '', created_at: '2024-01-03' };
    vi.mocked(api.createProject).mockResolvedValue({ success: true, data: newProject });

    const store = useProjectStore();
    store.projects = [{ id: 1, name: 'Existing', slug: 'existing', description: '', created_at: '2024-01-01' }];

    const result = await store.createProject('New Project', 'new-project');

    expect(result).toBe(true);
    expect(store.projects).toHaveLength(2);
    expect(store.projects[1]).toEqual(newProject);
    expect(store.loading).toBe(false);
    expect(api.createProject).toHaveBeenCalledWith({ name: 'New Project', slug: 'new-project' });
  });

  it('createProject returns false on failure', async () => {
    vi.mocked(api.createProject).mockResolvedValue({ success: false, error: 'Conflict' });

    const store = useProjectStore();
    const result = await store.createProject('Failed', 'failed');

    expect(result).toBe(false);
    expect(store.error).toBe('Conflict');
    expect(store.loading).toBe(false);
  });

  it('deleteProject removes project from list', async () => {
    vi.mocked(api.deleteProject).mockResolvedValue({ success: true });

    const store = useProjectStore();
    store.projects = [
      { id: 1, name: 'Keep', slug: 'keep', description: '', created_at: '2024-01-01' },
      { id: 2, name: 'Delete', slug: 'delete', description: '', created_at: '2024-01-02' },
    ];

    const result = await store.deleteProject('delete');

    expect(result).toBe(true);
    expect(store.projects).toHaveLength(1);
    expect(store.projects[0].slug).toBe('keep');
  });

  it('deleteProject clears currentProject when deleted', async () => {
    vi.mocked(api.deleteProject).mockResolvedValue({ success: true });

    const store = useProjectStore();
    store.projects = [{ id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01' }];
    store.currentProject = { id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [] };

    await store.deleteProject('test');

    expect(store.currentProject).toBeNull();
    expect(store.projects).toHaveLength(0);
  });

  it('deleteProject returns false on failure', async () => {
    vi.mocked(api.deleteProject).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useProjectStore();
    const result = await store.deleteProject('nonexistent');

    expect(result).toBe(false);
    expect(store.error).toBe('Not found');
  });

  it('currentProjectById returns project when id matches', async () => {
    const project = { id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [] };
    const store = useProjectStore();
    store.currentProject = project;

    const result = store.currentProjectById(1);
    expect(result).toEqual(project);
  });

  it('currentProjectById returns null when id does not match', async () => {
    const project = { id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [] };
    const store = useProjectStore();
    store.currentProject = project;

    const result = store.currentProjectById(99);
    expect(result).toBeNull();
  });

  it('currentProjectById returns null when no current project', async () => {
    const store = useProjectStore();

    const result = store.currentProjectById(1);
    expect(result).toBeNull();
  });

  it('addColumnAction adds column to currentProject', async () => {
    vi.mocked(api.getProjectBySlug).mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01', columns: [{ id: 1, project_id: 1, slug: 'todo', name: 'ToDo', position: 1, order: 1, is_default: 1 }], roles: [], workflows: [], access_rules: [] },
    });
    const store = useProjectStore();
    await store.setCurrentProject('test');

    const newColumn = { id: 2, project_id: 1, slug: 'in-progress', name: 'In Progress', position: 2, order: 2, is_default: 0 };
    vi.mocked(api.createColumn).mockResolvedValue({ success: true, data: newColumn });

    const result = await store.addColumn('test', { slug: 'in-progress', name: 'In Progress', position: 2 });

    expect(result).toBe(true);
    expect(store.currentProject?.columns).toHaveLength(2);
    expect(store.currentProject?.columns[1]).toEqual(newColumn);
  });

  it('addColumnAction returns false on failure', async () => {
    vi.mocked(api.getProjectBySlug).mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [] },
    });
    const store = useProjectStore();
    await store.setCurrentProject('test');

    vi.mocked(api.createColumn).mockResolvedValue({ success: false, error: 'Conflict' });

    const result = await store.addColumn('test', { slug: 'bad', name: 'Bad', position: 1 });

    expect(result).toBe(false);
    expect(store.error).toBe('Conflict');
  });

  it('addColumnAction sets error on network failure', async () => {
    vi.mocked(api.getProjectBySlug).mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [] },
    });
    const store = useProjectStore();
    await store.setCurrentProject('test');

    vi.mocked(api.createColumn).mockRejectedValue(new Error('Network failure'));

    const result = await store.addColumn('test', { slug: 'bad', name: 'Bad', position: 1 });

    expect(result).toBe(false);
    expect(store.error).toBe('Network failure');
  });

  it('setting loading to true during async operations', async () => {
    let resolveFn: () => void;
    vi.mocked(api.getProjects).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));

    const store = useProjectStore();
    const fetchPromise = store.fetchProjects();

    expect(store.loading).toBe(true);

    resolveFn!();
    await fetchPromise;

    expect(store.loading).toBe(false);
  });
});
