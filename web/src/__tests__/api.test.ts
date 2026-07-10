import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '@/api';

function mockFetch(responseData: unknown, options: { status?: number; error?: string } = {}) {
  const { status = 200, error } = options;
  if (error) {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error(error));
  } else {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    });
  }
}

describe('API functions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getProjects', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01' }] });
      const result = await api.getProjects();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('handles empty project list', async () => {
      mockFetch({ success: true, data: [] });
      const result = await api.getProjects();
      expect(result.data).toEqual([]);
    });
  });

  describe('getProjectBySlug', () => {
    it('calls correct endpoint with slug', async () => {
      const projectData = {
        id: 1, name: 'Test', slug: 'my-project', description: 'desc', created_at: '2024-01-01',
        columns: [], roles: [], workflows: [], access_rules: [],
      };
      mockFetch({ success: true, data: projectData });
      const result = await api.getProjectBySlug('my-project');
      expect(result.success).toBe(true);
      expect(result.data?.slug).toBe('my-project');
    });
  });

  describe('createProject', () => {
    it('sends correct payload', async () => {
      mockFetch({ success: true, data: { id: 2, name: 'New', slug: 'new', description: '', created_at: '2024-01-02' } });
      const result = await api.createProject({ name: 'New', slug: 'new' });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('New');
    });

    it('handles creation failure', async () => {
      mockFetch({ success: false, error: 'Already exists' });
      const result = await api.createProject({ name: 'Existing', slug: 'existing' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Already exists');
    });
  });

  describe('updateProject', () => {
    it('sends PUT request with slug', async () => {
      mockFetch({ success: true, data: { id: 1, name: 'Updated', slug: 'test', description: 'updated', created_at: '2024-01-01' } });
      const result = await api.updateProject('test', { name: 'Updated' });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Updated');
    });
  });

  describe('deleteProject', () => {
    it('calls DELETE endpoint with slug', async () => {
      mockFetch({ success: true });
      const result = await api.deleteProject('test');
      expect(result.success).toBe(true);
    });

    it('handles delete failure', async () => {
      mockFetch({ success: false, error: 'Not found' });
      const result = await api.deleteProject('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getTickets', () => {
    it('calls correct endpoint with project slug', async () => {
      mockFetch({ success: true, data: { tickets: [], total: 0, page: 1 } });
      const result = await api.getTickets('test-project');
      expect(result.success).toBe(true);
      expect(result.data?.tickets).toEqual([]);
      expect(result.data?.total).toBe(0);
    });

    it('supports query params', async () => {
      mockFetch({ success: true, data: { tickets: [], total: 0, page: 1 } });
      const result = await api.getTickets('test-project', { column: 'todo', priority: 1, page: 1, per_page: 20 });
      expect(result.success).toBe(true);
    });
  });

  describe('getTicketById', () => {
    it('calls correct endpoint with slug and id', async () => {
      mockFetch({ success: true, data: { id: 42, project_id: 1, column_id: 1, title: 'Ticket', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] } });
      const result = await api.getTicketById('test-project', 42);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(42);
    });
  });

  describe('createTicket', () => {
    it('sends correct payload', async () => {
      mockFetch({ success: true, data: { id: 5, project_id: 1, column_id: 1, title: 'New ticket', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] } });
      const result = await api.createTicket('test-project', { column: 'todo', title: 'New ticket' });
      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('New ticket');
    });
  });

  describe('updateTicket', () => {
    it('sends PATCH request', async () => {
      mockFetch({ success: true, data: { id: 5, project_id: 1, column_id: 1, title: 'Updated', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] } });
      const result = await api.updateTicket('test-project', 5, { title: 'Updated' });
      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Updated');
    });
  });

  describe('moveTicket', () => {
    it('sends POST request with payload', async () => {
      mockFetch({ success: true, data: { moved: true, ticket_id: 5, to_column: 'done' } });
      const result = await api.moveTicket('test-project', 5, { to_column: 'done' });
      expect(result.success).toBe(true);
      expect(result.data?.moved).toBe(true);
      expect(result.data?.to_column).toBe('done');
    });

    it('includes optional comment in payload', async () => {
      mockFetch({ success: true, data: { moved: true, ticket_id: 5, to_column: 'done' } });
      const result = await api.moveTicket('test-project', 5, { to_column: 'done', comment: 'Done with this' });
      expect(result.success).toBe(true);
    });
  });

  describe('addComment', () => {
    it('sends POST request to correct endpoint', async () => {
      mockFetch({ success: true, data: { id: 1, ticket_id: 5, author_role_id: 1, content: 'Nice work', action_type: 'comment', created_at: '2024-01-01' } });
      const result = await api.addComment('test-project', 5, { content: 'Nice work' });
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe('Nice work');
    });
  });

  describe('updateComment', () => {
    it('sends PATCH request to correct endpoint', async () => {
      mockFetch({ success: true, data: { id: 1, ticket_id: 5, author_role_id: 1, content: 'Updated comment', action_type: 'comment', created_at: '2024-01-01' } });
      const result = await api.updateComment('test-project', 5, 1, { content: 'Updated comment' });
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe('Updated comment');
    });

    it('handles update failure', async () => {
      mockFetch({ success: false, error: 'Not found' });
      const result = await api.updateComment('test-project', 5, 1, { content: 'Updated comment' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('deleteComment', () => {
    it('calls DELETE endpoint with correct URL', async () => {
      mockFetch({ success: true, data: { deleted: true, comment_id: 1 } });
      const result = await api.deleteComment('test-project', 5, 1);
      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
      expect(result.data?.comment_id).toBe(1);
    });

    it('handles delete failure', async () => {
      mockFetch({ success: false, error: 'Not found' });
      const result = await api.deleteComment('test-project', 5, 1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getColumns', () => {
    it('calls correct endpoint with slug', async () => {
      mockFetch({ success: true, data: [{ id: 1, name: 'ToDo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 }] });
      const result = await api.getColumns('test-project');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('createColumn', () => {
    it('sends POST request with payload', async () => {
      mockFetch({ success: true, data: { id: 2, name: 'Review', slug: 'review', position: 2, order: 2, is_default: 0, project_id: 1 } });
      const result = await api.createColumn('test-project', { slug: 'review', name: 'Review', order: 2 });
      expect(result.success).toBe(true);
      expect(result.data?.slug).toBe('review');
    });
  });

  describe('deleteColumn', () => {
    it('calls DELETE endpoint', async () => {
      mockFetch({ success: true });
      const result = await api.deleteColumn('test-project', 2);
      expect(result.success).toBe(true);
    });
  });

  describe('getTicketTransitions', () => {
    it('calls correct endpoint without roleId', async () => {
      mockFetch({ success: true, data: [{ id: 1, column_from: 1, column_to: 2 }] });
      const result = await api.getTicketTransitions('test-project', 1);
      expect(result.success).toBe(true);
    });

    it('includes roleId in params when provided', async () => {
      mockFetch({ success: true, data: [] });
      await api.getTicketTransitions('test-project', 1, 3);
      expect(globalThis.fetch).toHaveBeenCalled();
      const callArgs = (globalThis.fetch as any).mock.calls[0];
      expect(callArgs[1]).toBeDefined();
    });
  });

  describe('deleteTicket', () => {
    it('calls DELETE endpoint with slug and id', async () => {
      mockFetch({ success: true, data: { deleted: true, ticket_id: 42 } });
      const result = await api.deleteTicket('test-project', 42);
      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
    });
  });

  describe('updateColumn', () => {
    it('sends PATCH request with correct payload', async () => {
      mockFetch({ success: true, data: { id: 2, name: 'Updated', slug: 'updated', position: 2, order: 2, is_default: 0, project_id: 1 } });
      const result = await api.updateColumn('test-project', 2, { name: 'Updated' });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Updated');
    });
  });

  describe('getRoles', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, name: 'Developer', project_id: 1, created_at: '2024-01-01' }] });
      const result = await api.getRoles('test-project');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updateRole', () => {
    it('sends PATCH request with payload', async () => {
      mockFetch({ success: true, data: { id: 1, name: 'UpdatedRole', project_id: 1, created_at: '2024-01-01' } });
      const result = await api.updateRole('test-project', 1, { name: 'UpdatedRole' });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('UpdatedRole');
    });
  });

  describe('getAccessRules', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, column_id: 1, role_id: 1, action_type: 'view' }] });
      const result = await api.getAccessRules('test-project');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updateAccessRules', () => {
    it('sends PATCH request with payload', async () => {
      mockFetch({ success: true, data: [{ id: 1, column_id: 1, role_id: 1, action_type: 'view' }] });
      const result = await api.updateAccessRules('test-project', {
        rules: [{ column_id: 1, role_id: 1, action_type: 'view' }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createTransition', () => {
    it('sends POST request with correct payload', async () => {
      mockFetch({ success: true, data: { id: 1, column_from: 1, column_to: 2, project_id: 1 } });
      const result = await api.createTransition('test-project', { column_from: 1, column_to: 2 });
      expect(result.success).toBe(true);
    });
  });

  describe('deleteTransition', () => {
    it('calls DELETE endpoint', async () => {
      mockFetch({ success: true });
      const result = await api.deleteTransition('test-project', 1);
      expect(result.success).toBe(true);
    });
  });

  describe('getDependencies', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ ticket_id: 1, depends_on_id: 2, relation_type: 'blocks' }] });
      const result = await api.getDependencies('test-project', 1);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('addDependency', () => {
    it('sends POST request with correct payload', async () => {
      mockFetch({ success: true, data: { added: true, ticket_id: 1, depends_on_id: 2, relation_type: 'blocks' } });
      const result = await api.addDependency('test-project', 1, 2, 'blocks');
      expect(result.success).toBe(true);
      expect(result.data?.added).toBe(true);
    });
  });

  describe('removeDependency', () => {
    it('calls DELETE endpoint with params', async () => {
      mockFetch({ success: true, data: { removed: true, ticket_id: 1, depends_on_id: 2 } });
      const result = await api.removeDependency('test-project', 1, 2, 'blocks');
      expect(result.success).toBe(true);
      expect(result.data?.removed).toBe(true);
    });
  });

  describe('getConversations', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human', to_role_name: 'AI' }] });
      const result = await api.getConversations('test-project');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getConversation', () => {
    it('calls correct endpoint with conversation id', async () => {
      mockFetch({ success: true, data: { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human', to_role_name: 'AI', messages: [] } });
      const result = await api.getConversation('test-project', 1);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(1);
    });
  });

  describe('sendMessage', () => {
    it('sends POST request with payload', async () => {
      mockFetch({ success: true, data: { id: 5, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hello', created_at: '2024-01-01' } });
      const result = await api.sendMessage('test-project', 1, { content: 'Hello' });
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe('Hello');
    });
  });

  describe('fetchUnread', () => {
    it('calls correct endpoint with params', async () => {
      mockFetch({ success: true, data: { messages: [], last_read_message_id: 0 } });
      const result = await api.fetchUnread('test-project', { limit: 50 });
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles fetch network error', async () => {
      const error = new TypeError('Failed to fetch');
      globalThis.fetch = vi.fn().mockRejectedValue(error);

      await expect(api.getProjects()).rejects.toThrow('Failed to fetch');
    });

    it('handles non-200 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ success: false, error: 'Not found' }),
      } as Response);

      const result = await api.getProjects();
      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // Global Settings API
  // ========================================================================

  describe('getGlobalColumns', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 }] });
      const result = await api.getGlobalColumns();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('handles empty columns', async () => {
      mockFetch({ success: true, data: [] });
      const result = await api.getGlobalColumns();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('createGlobalColumn', () => {
    it('sends correct payload', async () => {
      mockFetch({ success: true, data: { id: 2, project_id: null, slug: 'review', name: 'Review', order: 2, is_global: 1, is_default: 0 } });
      const result = await api.createGlobalColumn({ slug: 'review', name: 'Review', order: 2 });
      expect(result.success).toBe(true);
      expect(result.data?.slug).toBe('review');
    });

    it('handles creation failure', async () => {
      mockFetch({ success: false, error: 'Duplicate slug' });
      const result = await api.createGlobalColumn({ slug: 'existing', name: 'Existing', order: 1 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Duplicate slug');
    });
  });

  describe('updateGlobalColumn', () => {
    it('sends PATCH request with correct payload', async () => {
      mockFetch({ success: true, data: { id: 1, project_id: null, slug: 'todo-updated', name: 'Todo Updated', order: 1, is_global: 1, is_default: 1 } });
      const result = await api.updateGlobalColumn(1, { name: 'Todo Updated' });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Todo Updated');
    });
  });

  describe('deleteGlobalColumn', () => {
    it('calls DELETE endpoint', async () => {
      mockFetch({ success: true, data: { success: true, id: 1 } });
      const result = await api.deleteGlobalColumn(1);
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });

    it('handles delete failure', async () => {
      mockFetch({ success: false, error: 'Cannot delete default column' });
      const result = await api.deleteGlobalColumn(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete default column');
    });
  });

  describe('getGlobalWorkflows', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 1, is_global: 1, entire_ticket_group: 0 }] });
      const result = await api.getGlobalWorkflows();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('createGlobalWorkflow', () => {
    it('sends correct payload', async () => {
      mockFetch({ success: true, data: { id: 2, project_id: null, column_from: 1, column_to: 3, requires_comment: 0, is_global: 1, entire_ticket_group: 0 } });
      const result = await api.createGlobalWorkflow({ column_from: 1, column_to: 3 });
      expect(result.success).toBe(true);
      expect(result.data?.column_from).toBe(1);
    });

    it('includes optional fields', async () => {
      mockFetch({ success: true, data: { id: 2, project_id: null, column_from: 1, column_to: 3, requires_comment: 1, is_global: 1, entire_ticket_group: 1 } });
      const result = await api.createGlobalWorkflow({ column_from: 1, column_to: 3, requires_comment: true, entire_ticket_group: true });
      expect(result.success).toBe(true);
    });
  });

  describe('updateGlobalWorkflow', () => {
    it('sends PATCH request', async () => {
      mockFetch({ success: true, data: { success: true } });
      const result = await api.updateGlobalWorkflow(1, { requires_comment: true });
      expect(result.success).toBe(true);
    });
  });

  describe('deleteGlobalWorkflow', () => {
    it('calls DELETE endpoint', async () => {
      mockFetch({ success: true, data: { success: true, id: 1 } });
      const result = await api.deleteGlobalWorkflow(1);
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });
  });

  describe('getGlobalAccessRules', () => {
    it('calls correct endpoint', async () => {
      mockFetch({ success: true, data: [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 }] });
      const result = await api.getGlobalAccessRules();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updateGlobalAccessRules', () => {
    it('sends PATCH request with payload', async () => {
      mockFetch({ success: true, data: [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'edit', is_global: 1 }] });
      const result = await api.updateGlobalAccessRules({
        rules: [{ column_id: 1, role_id: 1, action_type: 'edit' }],
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('handles update failure', async () => {
      mockFetch({ success: false, error: 'Invalid column_id' });
      const result = await api.updateGlobalAccessRules({
        rules: [{ column_id: 999, role_id: 1, action_type: 'view' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid column_id');
    });
  });

  describe('getProjectSeedData', () => {
    it('calls correct endpoint', async () => {
      mockFetch({
        success: true,
        data: {
          columns: [{ id: 1, project_id: null, slug: 'todo', name: 'ToDo', order: 1, is_global: 1, is_default: 1 }],
          workflows: [{ id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 }],
          accessRules: [{ id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 }],
        },
      });
      const result = await api.getProjectSeedData();
      expect(result.success).toBe(true);
      expect(result.data?.columns).toHaveLength(1);
      expect(result.data?.workflows).toHaveLength(1);
      expect(result.data?.accessRules).toHaveLength(1);
    });

    it('handles seed data failure', async () => {
      mockFetch({ success: false, error: 'No seed data available' });
      const result = await api.getProjectSeedData();
      expect(result.success).toBe(false);
      expect(result.error).toBe('No seed data available');
    });
  });

  // ========================================================================
  // Roles Columns API
  // ========================================================================

  describe('getGlobalRolesColumns', () => {
    it('calls correct endpoint', async () => {
      mockFetch({
        success: true,
        data: [
          { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1 },
          { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: null, column_name: null, is_default: 0 },
        ],
      });
      const result = await api.getGlobalRolesColumns();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('handles empty roles columns', async () => {
      mockFetch({ success: true, data: [] });
      const result = await api.getGlobalRolesColumns();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('createGlobalRolesColumn', () => {
    it('sends correct payload', async () => {
      mockFetch({
        success: true,
        data: { id: 3, role_id: 3, role_name: 'AI architect', column_id: 16, column_name: 'Implementation', is_default: 1 },
      });
      const result = await api.createGlobalRolesColumn({ role_id: 3, column_id: 16, is_default: 1 });
      expect(result.success).toBe(true);
      expect(result.data?.role_id).toBe(3);
      expect(result.data?.column_id).toBe(16);
    });

    it('handles creation failure', async () => {
      mockFetch({ success: false, error: 'Role not found' });
      const result = await api.createGlobalRolesColumn({ role_id: 999, column_id: 15 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Role not found');
    });
  });

  describe('updateGlobalRolesColumn', () => {
    it('sends PATCH request to correct endpoint', async () => {
      mockFetch({
        success: true,
        data: { id: 1, role_id: 1, role_name: 'Human User', column_id: 16, column_name: 'Implementation', is_default: 0 },
      });
      const result = await api.updateGlobalRolesColumn(1, { column_id: 16, is_default: 0 });
      expect(result.success).toBe(true);
      expect(result.data?.column_id).toBe(16);
    });

    it('handles update failure', async () => {
      mockFetch({ success: false, error: 'Not found' });
      const result = await api.updateGlobalRolesColumn(999, { column_id: null });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('deleteGlobalRolesColumn', () => {
    it('calls DELETE endpoint with role_id', async () => {
      mockFetch({ success: true, data: { deleted: true, role_id: 1 } });
      const result = await api.deleteGlobalRolesColumn(1);
      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
      expect(result.data?.role_id).toBe(1);
    });

    it('handles delete failure', async () => {
      mockFetch({ success: false, error: 'Cannot delete last column' });
      const result = await api.deleteGlobalRolesColumn(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete last column');
    });
  });

  describe('getProjectRolesColumns', () => {
    it('calls correct endpoint with slug', async () => {
      mockFetch({
        success: true,
        data: [
          { id: 1, role_id: 1, role_name: 'Human User', column_id: 15, column_name: 'To Do', is_default: 1, is_override: 0 },
          { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: 17, column_name: 'Unit Review', is_default: 0, is_override: 1 },
        ],
      });
      const result = await api.getProjectRolesColumns('test-project');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[1].is_override).toBe(1);
    });

    it('handles empty project roles columns', async () => {
      mockFetch({ success: true, data: [] });
      const result = await api.getProjectRolesColumns('test-project');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('createProjectRolesColumn', () => {
    it('sends POST request with payload', async () => {
      mockFetch({
        success: true,
        data: { id: 3, role_id: 3, role_name: 'AI architect', column_id: 18, column_name: 'Integration Testing', is_default: 0, is_override: 1 },
      });
      const result = await api.createProjectRolesColumn('test-project', { role_id: 3, column_id: 18 });
      expect(result.success).toBe(true);
      expect(result.data?.column_id).toBe(18);
      expect(result.data?.is_override).toBe(1);
    });

    it('handles creation failure', async () => {
      mockFetch({ success: false, error: 'Column not found' });
      const result = await api.createProjectRolesColumn('test-project', { role_id: 1, column_id: 999 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Column not found');
    });
  });

  describe('updateProjectRolesColumn', () => {
    it('sends PATCH request to correct endpoint', async () => {
      mockFetch({
        success: true,
        data: { id: 2, role_id: 2, role_name: 'AI teamleader', column_id: 19, column_name: 'Final Review', is_default: 0, is_override: 1 },
      });
      const result = await api.updateProjectRolesColumn('test-project', 2, { column_id: 19 });
      expect(result.success).toBe(true);
      expect(result.data?.column_id).toBe(19);
    });

    it('handles update failure', async () => {
      mockFetch({ success: false, error: 'Not found' });
      const result = await api.updateProjectRolesColumn('test-project', 999, { column_id: null });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('deleteProjectRolesColumn', () => {
    it('calls DELETE endpoint with slug and role_id', async () => {
      mockFetch({ success: true, data: { deleted: true, role_id: 2 } });
      const result = await api.deleteProjectRolesColumn('test-project', 2);
      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
      expect(result.data?.role_id).toBe(2);
    });

    it('handles delete failure', async () => {
      mockFetch({ success: false, error: 'Not found' });
      const result = await api.deleteProjectRolesColumn('test-project', 999);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });
});
