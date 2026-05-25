import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTicketStore } from '@/stores/tickets';
import * as api from '@/api';

vi.mock('@/api', () => ({
  getTickets: vi.fn(),
  getTicketById: vi.fn(),
  createTicket: vi.fn(),
  updateTicket: vi.fn(),
  moveTicket: vi.fn(),
  addComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  getColumns: vi.fn(),
  getDependencies: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  deleteTicket: vi.fn(),
  getTicketBlockers: vi.fn(),
}));

describe('useTicketStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('fetchTickets sets tickets from API response', async () => {
    const tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Ticket 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' },
    ];
    vi.mocked(api.getTickets).mockResolvedValue({ success: true, data: { tickets, total: 1, page: 1 } });

    const store = useTicketStore();
    await store.fetchTickets('test-project');

    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].title).toBe('Ticket 1');
    expect(store.tickets[0].column).toEqual({
      id: 1,
      name: 'ToDo',
      slug: 'todo',
      order: 0,
      is_default: 0,
      project_id: 1,
    });
    expect(store.loading).toBe(false);
  });

  it('fetchTickets sets error on failure', async () => {
    vi.mocked(api.getTickets).mockResolvedValue({ success: false, error: 'API error' });

    const store = useTicketStore();
    await store.fetchTickets('test-project');

    expect(store.error).toBe('API error');
    expect(store.tickets).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('fetchColumns sets columns from API response', async () => {
    const columns = [
      { id: 1, name: 'ToDo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
      { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 1, project_id: 1 },
    ];
    vi.mocked(api.getColumns).mockResolvedValue({ success: true, data: columns });

    const store = useTicketStore();
    await store.fetchColumns('test-project');

    expect(store.columns).toEqual(columns);
  });

  it('fetchColumns sets error on failure', async () => {
    vi.mocked(api.getColumns).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useTicketStore();
    await store.fetchColumns('test-project');

    expect(store.error).toBe('Not found');
  });

  it('selectTicket sets selected ticket', () => {
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'Ticket 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    const store = useTicketStore();
    store.selectTicket(ticket);

    expect(store.selectedTicket).toEqual(ticket);
  });

  it('deselectTicket clears selected ticket', () => {
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'Ticket 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    const store = useTicketStore();
    store.selectedTicket = ticket;
    store.deselectTicket();

    expect(store.selectedTicket).toBeNull();
  });

  it('ticketsByColumn groups tickets by column_id', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      { id: 2, project_id: 1, column_id: 2, title: 'T2', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      { id: 3, project_id: 1, column_id: 1, title: 'T3', description: '', labels: '[]', priority: 4, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
    ];

    const byColumn = store.ticketsByColumn;
    expect(byColumn[1]).toHaveLength(2);
    expect(byColumn[2]).toHaveLength(1);
    expect(byColumn[1][0].id).toBe(1);
    expect(byColumn[1][1].id).toBe(3);
  });

  it('columnTicketsCount counts tickets per column', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      { id: 2, project_id: 1, column_id: 2, title: 'T2', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      { id: 3, project_id: 1, column_id: 1, title: 'T3', description: '', labels: '[]', priority: 4, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
    ];

    const counts = store.columnTicketsCount;
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(1);
  });

  it('createTicketAction adds ticket to list', async () => {
    const newTicket = { id: 10, project_id: 1, column_id: 1, title: 'New', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    vi.mocked(api.createTicket).mockResolvedValue({ success: true, data: newTicket });

    const store = useTicketStore();
    store.tickets = [];

    const result = await store.createTicket('test-project', { column: 'todo', title: 'New' });

    expect(result).toBe(true);
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].title).toBe('New');
  });

  it('createTicketAction returns false on failure', async () => {
    vi.mocked(api.createTicket).mockResolvedValue({ success: false, error: 'Validation error' });

    const store = useTicketStore();
    const result = await store.createTicket('test-project', { column: 'todo', title: 'New' });

    expect(result).toBe(false);
    expect(store.error).toBe('Validation error');
  });

  it('updateTicketAction updates ticket in list', async () => {
    const updatedTicket = { id: 1, project_id: 1, column_id: 1, title: 'Updated', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-02', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    vi.mocked(api.updateTicket).mockResolvedValue({ success: true, data: updatedTicket });

    const store = useTicketStore();
    store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'Original', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' }];

    const result = await store.updateTicket('test-project', 1, { title: 'Updated' });

    expect(result).toBe(true);
    expect(store.tickets[0].title).toBe('Updated');
  });

  it('updateTicketAction updates selectedTicket if it matches', async () => {
    const updatedTicket = { id: 1, project_id: 1, column_id: 1, title: 'Updated', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-02', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    vi.mocked(api.updateTicket).mockResolvedValue({ success: true, data: updatedTicket });

    const store = useTicketStore();
    store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'Original', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' }];
    store.selectedTicket = store.tickets[0];

    await store.updateTicket('test-project', 1, { title: 'Updated' });

    expect(store.selectedTicket?.title).toBe('Updated');
  });

  it('addCommentAction appends comment to ticket', async () => {
    const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Nice work!', action_type: 'comment', created_at: '2024-01-02' };
    vi.mocked(api.addComment).mockResolvedValue({ success: true, data: comment });

    const store = useTicketStore();
    store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] }];

    const result = await store.addComment('test-project', 1, { content: 'Nice work!' });

    expect(result).toBe(true);
    expect(store.tickets[0].comments).toHaveLength(1);
    expect(store.tickets[0].comments[0].content).toBe('Nice work!');
  });

  it('addCommentAction appends comment to selectedTicket if matching', async () => {
    const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Nice work!', action_type: 'comment', created_at: '2024-01-02' };
    vi.mocked(api.addComment).mockResolvedValue({ success: true, data: comment });

    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];
    store.selectedTicket = ticket;

    await store.addComment('test-project', 1, { content: 'Nice work!' });

    expect(store.selectedTicket?.comments).toHaveLength(1);
    expect(store.selectedTicket?.comments[0].content).toBe('Nice work!');
  });

  it('fetchDependencies sets dependencies', async () => {
    const deps = [{ ticket_id: 1, depends_on_id: 2, relation_type: 'blocks' }];
    vi.mocked(api.getDependencies).mockResolvedValue({ success: true, data: deps });

    const store = useTicketStore();
    await store.fetchDependencies('test-project', 1);

    expect(store.dependencies).toEqual(deps);
  });

  it('fetchDependencies sets error on failure', async () => {
    vi.mocked(api.getDependencies).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useTicketStore();
    await store.fetchDependencies('test-project', 1);

    expect(store.error).toBe('Not found');
  });

  it('refreshProject calls both fetchTickets and fetchColumns', async () => {
    vi.mocked(api.getTickets).mockResolvedValue({ success: true, data: { tickets: [], total: 0, page: 1 } });
    vi.mocked(api.getColumns).mockResolvedValue({ success: true, data: [] });

    const store = useTicketStore();
    await store.refreshProject('test-project');

    expect(api.getTickets).toHaveBeenCalledWith('test-project', { all_tickets: true, done_limit: 8 });
    expect(api.getColumns).toHaveBeenCalledWith('test-project');
  });

  describe('fetchTickets with all_tickets option', () => {
     it('sets doneTicketsTotal and doneTicketsLoaded when all_tickets=true', async () => {
       const columns = [
         { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
         { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
       ];
       const tickets = [
         { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' },
         { id: 2, project_id: 1, column_id: 2, title: 'Done 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
         { id: 3, project_id: 1, column_id: 2, title: 'Done 2', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
       ];
       vi.mocked(api.getTickets).mockResolvedValue({ success: true, data: { tickets, total: 5, page: 1 } });

       const store = useTicketStore();
       store.columns = columns;
       await store.fetchTickets('test-project', undefined, { all_tickets: true });

       expect(store.doneTicketsTotal).toBe(2);
       expect(store.doneTicketsLoaded).toBe(2);
       // All 2 done tickets fit within the default limit of 8, so showAllDone is true
       expect(store.showAllDone).toBe(true);
     });

     it('sets showAllDone when all done tickets are loaded', async () => {
       const columns = [
         { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
         { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
       ];
       const tickets = [
         { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' },
       ];
       vi.mocked(api.getTickets).mockResolvedValue({ success: true, data: { tickets, total: 1, page: 1 } });

       const store = useTicketStore();
       store.columns = columns;
       await store.fetchTickets('test-project', undefined, { all_tickets: true });

       expect(store.doneTicketsTotal).toBe(0);
       expect(store.doneTicketsLoaded).toBe(0);
       expect(store.showAllDone).toBe(true);
     });

     it('sets doneTicketsTotal from done_total in API response (not from response array)', async () => {
       const columns = [
         { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
         { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
       ];
       // Only 8 done tickets in the response (capped by done_limit) but done_total reports 15
       const doneTicketIds = Array.from({ length: 8 }, (_, i) => ({
         id: i + 100, project_id: 1, column_id: 2, title: `Done ${i + 1}`, description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done',
       }));
       const tickets = [
         { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' },
         ...doneTicketIds,
       ];
       vi.mocked(api.getTickets).mockResolvedValue({
         success: true,
         data: { tickets, total: 20, page: 1, done_total: 15 },
       });

       const store = useTicketStore();
       store.columns = columns;
       await store.fetchTickets('test-project', undefined, { all_tickets: true, done_limit: 8 });

       // doneTicketsTotal should be 15 (from done_total), not 8 (from response array length)
       expect(store.doneTicketsTotal).toBe(15);
       expect(store.doneTicketsLoaded).toBe(8);
       // 15 > 8, so showAllDone should be false
       expect(store.showAllDone).toBe(false);
     });

     it('sets showAllDone to false when doneTicketsTotal exceeds doneLimit', async () => {
       const columns = [
         { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
         { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
       ];
       // 3 done tickets in response with done_total=15
       const doneTicketIds = Array.from({ length: 3 }, (_, i) => ({
         id: i + 100, project_id: 1, column_id: 2, title: `Done ${i + 1}`, description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done',
       }));
       const tickets = [
         { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' },
         ...doneTicketIds,
       ];
       vi.mocked(api.getTickets).mockResolvedValue({
         success: true,
         data: { tickets, total: 18, page: 1, done_total: 15 },
       });

       const store = useTicketStore();
       store.columns = columns;
       await store.fetchTickets('test-project', undefined, { all_tickets: true, done_limit: 8 });

       // 15 > 8, so showAllDone should be false (the "show all" button should appear)
       expect(store.showAllDone).toBe(false);
       expect(store.hasMoreDoneTickets).toBe(true);
     });
   });

  describe('loadMoreDone', () => {
    it('appends all done tickets and sets showAllDone=true', async () => {
      const columns = [
        { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
        { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
      ];
      const existingTicket = {
        id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3,
        estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1,
        comments: [], column_slug: 'todo', column_name: 'ToDo',
      };
      const doneTickets = [
        { id: 2, project_id: 1, column_id: 2, title: 'Done 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
        { id: 3, project_id: 1, column_id: 2, title: 'Done 2', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
        { id: 4, project_id: 1, column_id: 1, title: 'Not done', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' },
      ];
      vi.mocked(api.getTickets).mockResolvedValue({ success: true, data: { tickets: doneTickets, total: 1, page: 1 } });

      const store = useTicketStore();
      store.columns = columns;
      store.tickets = [existingTicket];
      await store.loadMoreDone('test-project');

      expect(store.tickets).toHaveLength(3);
      expect(store.tickets.filter(t => t.column_id === 1)).toHaveLength(1);
      expect(store.tickets.filter(t => t.column_id === 2)).toHaveLength(2);
      expect(store.doneTicketsTotal).toBe(2);
      expect(store.showAllDone).toBe(true);
      expect(api.getTickets).toHaveBeenCalledWith('test-project', {
        column: 'done',
        per_page: 1000,
        done_limit: 1000,
        sort_by: 'updated_at',
        sort_order: 'desc',
      });
    });

    it('handles error gracefully', async () => {
      vi.mocked(api.getTickets).mockRejectedValue(new Error('Network error'));

      const store = useTicketStore();
      await store.loadMoreDone('test-project');

      expect(store.error).toBe('Network error');
      expect(store.loading).toBe(false);
    });

    it('correctly identifies done tickets by column_id when column_slug is absent (API strips it)', async () => {
      // This test simulates the real API behavior where column_slug is stripped
      const columns = [
        { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
        { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
      ];
      const existingTicket = {
        id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3,
        estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1,
        comments: [], column_slug: 'todo', column_name: 'ToDo',
      };
      // API returns tickets with column_id but without column_slug (as it strips it)
      const doneTickets = [
        { id: 2, project_id: 1, column_id: 2, title: 'Done 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
        { id: 3, project_id: 1, column_id: 2, title: 'Done 2', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
        { id: 4, project_id: 1, column_id: 1, title: 'In Todo', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      ];
      vi.mocked(api.getTickets).mockResolvedValue({ success: true, data: { tickets: doneTickets, total: 3, page: 1 } });

      const store = useTicketStore();
      store.columns = columns;
      store.tickets = [existingTicket];
      await store.loadMoreDone('test-project');

      // All done tickets (column_id === 2) should be in the list
      expect(store.tickets).toHaveLength(3);
      expect(store.tickets.filter(t => t.column_id === 2)).toHaveLength(2);
      expect(store.tickets.filter(t => t.column_id === 1)).toHaveLength(1);
      expect(store.doneTicketsTotal).toBe(2);
      expect(store.showAllDone).toBe(true);
    });
  });

  describe('collapseDone', () => {
    it('collapses done tickets to first 8 and sets showAllDone=false', () => {
      const store = useTicketStore();
      const nonDoneTicket = {
        id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3,
        estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1,
        comments: [], column_slug: 'todo', column_name: 'ToDo',
      };
      const doneTickets = [
        { id: 2, project_id: 1, column_id: 2, title: 'Done 1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
        { id: 3, project_id: 1, column_id: 2, title: 'Done 2', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
        { id: 4, project_id: 1, column_id: 2, title: 'Done 3', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
        { id: 5, project_id: 1, column_id: 2, title: 'Done 4', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
        { id: 6, project_id: 1, column_id: 2, title: 'Done 5', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done' },
      ];
      store.tickets = [nonDoneTicket, ...doneTickets];
      store.doneTicketsLoaded = 5;
      store.doneTicketsTotal = 50;
      store.showAllDone = true;

      store.collapseDone();

      expect(store.showAllDone).toBe(false);
      // After fix: doneTicketsLoaded is based on doneTicketsTotal (50), not array length (5)
      // Since 50 > limit(8), it should be capped at 8
      expect(store.doneTicketsLoaded).toBe(8);
      expect(store.tickets.filter(t => t.column_id === 2)).toHaveLength(5);
      expect(store.tickets.filter(t => t.column_id === 1)).toHaveLength(1);
    });

    it('limits to 8 done tickets when more than 8 exist', () => {
      const store = useTicketStore();
      store.columns = [
        { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
        { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
      ];
      const nonDoneTicket = {
        id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3,
        estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1,
        comments: [], column_slug: 'todo', column_name: 'ToDo',
      };
      const doneTickets = Array.from({ length: 15 }, (_, i) => ({
        id: i + 2, project_id: 1, column_id: 2, title: `Done ${i + 1}`, description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done',
      }));
      store.tickets = [nonDoneTicket, ...doneTickets];
      store.doneTicketsLoaded = 15;
      store.doneTicketsTotal = 15;
      store.showAllDone = true;

      store.collapseDone();

      expect(store.showAllDone).toBe(false);
      expect(store.doneTicketsLoaded).toBe(8);
      expect(store.tickets.filter(t => t.column_id === 2)).toHaveLength(8);
      expect(store.tickets.filter(t => t.column_id === 1)).toHaveLength(1);
    });

    it('slices to 8 even when showAllDone was false', () => {
      const store = useTicketStore();
      store.columns = [
        { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
      ];
      const doneTickets = Array.from({ length: 12 }, (_, i) => ({
        id: i + 1, project_id: 1, column_id: 2, title: `Done ${i + 1}`, description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done',
      }));
      store.tickets = doneTickets;
      store.doneTicketsLoaded = 12;
      store.doneTicketsTotal = 12;
      store.showAllDone = false;

      store.collapseDone();

      expect(store.showAllDone).toBe(false);
      expect(store.doneTicketsLoaded).toBe(8);
      expect(store.tickets).toHaveLength(8);
    });

    it('properly resets button state after showAllDone was used (Bug 3 fix)', () => {
      const store = useTicketStore();
      store.columns = [
        { id: 1, name: 'ToDo', slug: 'todo', order: 1, is_default: 0, project_id: 1 },
        { id: 2, name: 'Done', slug: 'done', order: 2, is_default: 0, project_id: 1 },
      ];
      // Simulate state after user clicked "show all" - all 15 done tickets are visible
      const nonDoneTicket = {
        id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3,
        estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1,
        comments: [], column_slug: 'todo', column_name: 'ToDo',
      };
      const doneTickets = Array.from({ length: 15 }, (_, i) => ({
        id: i + 2, project_id: 1, column_id: 2, title: `Done ${i + 1}`, description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done',
      }));
      store.tickets = [nonDoneTicket, ...doneTickets];
      store.doneTicketsTotal = 15;
      // After show all, doneTicketsLoaded was set to 15 (showing all)
      store.doneTicketsLoaded = 15;
      store.showAllDone = true;

      store.collapseDone();

      // After collapse: should show only 8, showAllDone should be false,
      // and hasMoreDoneTickets should be true (so the "show all" button reappears)
      expect(store.showAllDone).toBe(false);
      expect(store.doneTicketsLoaded).toBe(8);
      expect(store.tickets.filter(t => t.column_id === 2)).toHaveLength(8);
      expect(store.hasMoreDoneTickets).toBe(true);
    });

    it('works when doneTicketsTotal is much larger than what is currently in tickets array', () => {
      const store = useTicketStore();
      // Simulate: total done = 50, but only 15 are currently in the tickets array
      // (e.g., after a partial loadMoreDone)
      const nonDoneTicket = {
        id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3,
        estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1,
        comments: [], column_slug: 'todo', column_name: 'ToDo',
      };
      const doneTickets = Array.from({ length: 15 }, (_, i) => ({
        id: i + 2, project_id: 1, column_id: 2, title: `Done ${i + 1}`, description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done', column_name: 'Done',
      }));
      store.tickets = [nonDoneTicket, ...doneTickets];
      store.doneTicketsTotal = 50; // Total is 50, but only 15 are in the array
      store.doneTicketsLoaded = 15;
      store.showAllDone = true;

      store.collapseDone();

      // doneTicketsLoaded should be based on doneTicketsTotal (8), not doneTickets.length (15)
      expect(store.doneTicketsLoaded).toBe(8);
      expect(store.showAllDone).toBe(false);
      expect(store.hasMoreDoneTickets).toBe(true);
    });
  });

  describe('hasMoreDoneTickets computed', () => {
    it('returns true when done tickets are partially loaded', () => {
      const store = useTicketStore();
      store.doneTicketsTotal = 100;
      store.doneTicketsLoaded = 10;
      store.showAllDone = false;

      expect(store.hasMoreDoneTickets).toBe(true);
    });

    it('returns false when showAllDone is true', () => {
      const store = useTicketStore();
      store.doneTicketsTotal = 100;
      store.doneTicketsLoaded = 10;
      store.showAllDone = true;

      expect(store.hasMoreDoneTickets).toBe(false);
    });

    it('returns false when no done tickets total', () => {
      const store = useTicketStore();
      store.doneTicketsTotal = 0;
      store.doneTicketsLoaded = 0;
      store.showAllDone = false;

      expect(store.hasMoreDoneTickets).toBe(false);
    });
  });

  describe('doneColumnHasMore computed', () => {
    it('returns true when done column has more tickets than loaded', () => {
      // doneColumnHasMore now uses column_slug directly on tickets (no columns dependency)
      const store = useTicketStore();
      store.tickets = [
        { id: 1, project_id: 1, column_id: 1, title: 'D1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done' },
        { id: 2, project_id: 1, column_id: 1, title: 'D2', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done' },
      ];
      store.doneTicketsTotal = 10;
      store.showAllDone = false;

      expect(store.doneColumnHasMore).toBe(true);
    });

    it('returns false when showAllDone is true', () => {
      const store = useTicketStore();
      store.tickets = [
        { id: 1, project_id: 1, column_id: 1, title: 'D1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'done' },
      ];
      store.doneTicketsTotal = 10;
      store.showAllDone = true;

      expect(store.doneColumnHasMore).toBe(false);
    });

    it('returns false when no done tickets to load', () => {
      // doneColumnHasMore now uses column_slug directly on tickets (no columns dependency)
      const store = useTicketStore();
      store.tickets = [
        { id: 1, project_id: 1, column_id: 1, title: 'D1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      ];
      store.doneTicketsTotal = 0;
      store.showAllDone = false;

      expect(store.doneColumnHasMore).toBe(false);
    });
  });

  it('deleteTicket removes ticket from list', async () => {
    vi.mocked(api.deleteTicket).mockResolvedValue({ success: true, data: { deleted: true, ticket_id: 1 } });

    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
      { id: 2, project_id: 1, column_id: 1, title: 'T2', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] },
    ];
    store.selectedTicket = store.tickets[0];

    const result = await store.deleteTicket('test-project', 1);

    expect(result).toBe(true);
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].id).toBe(2);
    expect(store.selectedTicket).toBeNull();
  });

  it('deleteTicket returns false on failure', async () => {
    vi.mocked(api.deleteTicket).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useTicketStore();
    const result = await store.deleteTicket('test-project', 1);

    expect(result).toBe(false);
    expect(store.error).toBe('Not found');
  });

  it('deleteTicket handles network error', async () => {
    vi.mocked(api.deleteTicket).mockRejectedValue(new Error('Network failure'));

    const store = useTicketStore();
    const result = await store.deleteTicket('test-project', 1);

    expect(result).toBe(false);
    expect(store.error).toBe('Network failure');
  });

  it('moveTicketAction moves ticket and fetches dependencies', async () => {
    vi.mocked(api.moveTicket).mockResolvedValue({ success: true, data: { moved: true, ticket_id: 1, to_column: 'done' } });

    const store = useTicketStore();
    store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] }];

    const result = await store.moveTicket('test-project', 1, { to_column: 'done' });

    expect(result).toBe(true);
    expect(api.moveTicket).toHaveBeenCalledWith('test-project', 1, { to_column: 'done' });
  });

  it('moveTicketAction returns false on failure', async () => {
    vi.mocked(api.moveTicket).mockResolvedValue({ success: false, error: 'Invalid move' });

    const store = useTicketStore();
    const result = await store.moveTicket('test-project', 1, { to_column: 'done' });

    expect(result).toBe(false);
    expect(store.error).toBe('Invalid move');
  });

  it('addDependencyAction adds dependency and fetches deps and blocking info', async () => {
    vi.mocked(api.addDependency).mockResolvedValue({ success: true, data: { added: true, ticket_id: 1, depends_on_id: 2, relation_type: 'blocks' } });
    vi.mocked(api.getDependencies).mockResolvedValue({ success: true, data: [] });
    vi.mocked(api.getTicketBlockers).mockResolvedValue({ success: true, data: { ticket_id: 1, is_blocked: true, blocking_tickets: [{ id: 2, relation_type: 'blocks' }] } });

    const store = useTicketStore();
    const result = await store.addDependency('test-project', 1, 2, 'blocks');

    expect(result).toBe(true);
    expect(api.getDependencies).toHaveBeenCalledWith('test-project', 1);
    // Should fetch blocking info for both the ticket and its dependency
    expect(api.getTicketBlockers).toHaveBeenCalledWith('test-project', 1);
    expect(api.getTicketBlockers).toHaveBeenCalledWith('test-project', 2);
  });

  it('addDependencyAction returns false on failure', async () => {
    vi.mocked(api.addDependency).mockResolvedValue({ success: false, error: 'Invalid dependency' });

    const store = useTicketStore();
    const result = await store.addDependency('test-project', 1, 2, 'blocks');

    expect(result).toBe(false);
    expect(store.error).toBe('Invalid dependency');
  });

  it('removeDependencyAction removes dependency and fetches deps and blocking info', async () => {
    vi.mocked(api.removeDependency).mockResolvedValue({ success: true, data: { removed: true, ticket_id: 1, depends_on_id: 2 } });
    vi.mocked(api.getDependencies).mockResolvedValue({ success: true, data: [] });
    vi.mocked(api.getTicketBlockers).mockResolvedValue({ success: true, data: { ticket_id: 1, is_blocked: false, blocking_tickets: [] } });

    const store = useTicketStore();
    const result = await store.removeDependency('test-project', 1, 2, 'blocks');

    expect(result).toBe(true);
    expect(api.getDependencies).toHaveBeenCalledWith('test-project', 1);
    // Should fetch blocking info for both the ticket and its dependency
    expect(api.getTicketBlockers).toHaveBeenCalledWith('test-project', 1);
    expect(api.getTicketBlockers).toHaveBeenCalledWith('test-project', 2);
  });

  it('removeDependencyAction returns false on failure', async () => {
    vi.mocked(api.removeDependency).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useTicketStore();
    const result = await store.removeDependency('test-project', 1, 2, 'blocks');

    expect(result).toBe(false);
    expect(store.error).toBe('Not found');
  });

  it('removeDependencyAction handles network error', async () => {
    vi.mocked(api.removeDependency).mockRejectedValue(new Error('Network failure'));

    const store = useTicketStore();
    const result = await store.removeDependency('test-project', 1, 2, 'blocks');

    expect(result).toBe(false);
    expect(store.error).toBe('Network failure');
  });

  it('parentTickets filters tickets that have children', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
      { id: 3, project_id: 1, column_id: 1, title: 'Orphan', description: '', labels: '[]', priority: 2, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
    ];

    expect(store.parentTickets).toHaveLength(1);
    expect(store.parentTickets[0].id).toBe(1);
  });

  it('childTicketsByParentId groups children by parent id', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child A', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
      { id: 3, project_id: 1, column_id: 1, title: 'Child B', description: '', labels: '[]', priority: 2, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
      { id: 4, project_id: 1, column_id: 1, title: 'Child C', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 5 },
    ];

    expect(store.childTicketsByParentId[1]).toHaveLength(2);
    expect(store.childTicketsByParentId[1][0].id).toBe(2);
    expect(store.childTicketsByParentId[1][1].id).toBe(3);
    expect(store.childTicketsByParentId[5]).toHaveLength(1);
    expect(store.childTicketsByParentId[5][0].id).toBe(4);
  });

  it('isParentTicket returns true for parent with children', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
    ];

    expect(store.isParentTicket(1)).toBe(true);
    expect(store.isParentTicket(2)).toBe(false);
  });

  it('getChildTickets returns children for a parent id', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child A', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
      { id: 3, project_id: 1, column_id: 1, title: 'Child B', description: '', labels: '[]', priority: 2, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
    ];

    expect(store.getChildTickets(1)).toHaveLength(2);
    expect(store.getChildTickets(1)[0].id).toBe(2);
    expect(store.getChildTickets(1)[1].id).toBe(3);
    expect(store.getChildTickets(999)).toEqual([]);
  });

  it('getParentTicket returns parent for a child ticket', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
    ];

    const parent = store.getParentTicket(2);
    expect(parent).not.toBeNull();
    expect(parent!.id).toBe(1);
    expect(store.getParentTicket(1)).toBeNull();
  });

  it('getChildTicketsForColumn groups parents with children in a column', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent A', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child A1', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
      { id: 3, project_id: 1, column_id: 2, title: 'Parent B', description: '', labels: '[]', priority: 2, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 4, project_id: 1, column_id: 2, title: 'Child B1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 3 },
    ];

    const column1Groups = store.getChildTicketsForColumn(1);
    expect(column1Groups).toHaveLength(1);
    expect(column1Groups[0].parent.id).toBe(1);
    expect(column1Groups[0].children).toHaveLength(1);

    const column2Groups = store.getChildTicketsForColumn(2);
    expect(column2Groups).toHaveLength(1);
    expect(column2Groups[0].parent.id).toBe(3);
  });

  it('orphanChildTickets finds children whose parent is in a different column', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 2, title: 'Orphan Child', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
    ];

    const orphans = store.orphanChildTickets;
    expect(orphans[1]).toHaveLength(1);
    expect(orphans[1][0].id).toBe(2);
  });

  it('fetchDependencies sets loadingDependencies during call', async () => {
    let resolveFn: () => void;
    vi.mocked(api.getDependencies).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));

    const store = useTicketStore();
    const fetchPromise = store.fetchDependencies('test-project', 1);

    expect(store.loadingDependencies).toBe(true);

    resolveFn!();
    await fetchPromise;

    expect(store.loadingDependencies).toBe(false);
  });

  it('addDependencyAction sets loading during call', async () => {
    let resolveFn: () => void;
    vi.mocked(api.addDependency).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));
    vi.mocked(api.getDependencies).mockResolvedValue({ success: true, data: [] });

    const store = useTicketStore();
    const addPromise = store.addDependency('test-project', 1, 2, 'blocks');

    expect(store.loading).toBe(true);

    resolveFn!();
    await addPromise;

    expect(store.loading).toBe(false);
  });

  it('removeDependencyAction sets loading during call', async () => {
    let resolveFn: () => void;
    vi.mocked(api.removeDependency).mockImplementation(() => new Promise(resolve => { resolveFn = resolve as () => void; }));
    vi.mocked(api.getDependencies).mockResolvedValue({ success: true, data: [] });

    const store = useTicketStore();
    const removePromise = store.removeDependency('test-project', 1, 2, 'blocks');

    expect(store.loading).toBe(true);

    resolveFn!();
    await removePromise;

    expect(store.loading).toBe(false);
  });

  it('orphanChildTickets excludes children whose parent is in the same column', () => {
    const store = useTicketStore();
    store.tickets = [
      { id: 1, project_id: 1, column_id: 1, title: 'Parent', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: null },
      { id: 2, project_id: 1, column_id: 1, title: 'Child', description: '', labels: '[]', priority: 1, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], parent_id: 1 },
    ];

    expect(store.orphanChildTickets).toEqual({});
  });

  describe('updateCommentAction', () => {
    it('optimistically updates comment in local state', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Original', action_type: 'comment', created_at: '2024-01-01' };
      const updatedComment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Updated', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.updateComment).mockResolvedValue({ success: true, data: updatedComment });

      const store = useTicketStore();
      store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] }];

      const result = await store.updateComment('test-project', 1, 1, { content: 'Updated' });

      expect(result).toBe(true);
      expect(store.tickets[0].comments[0].content).toBe('Updated');
    });

    it('optimistically updates comment in selectedTicket if matching', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Original', action_type: 'comment', created_at: '2024-01-01' };
      const updatedComment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Updated', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.updateComment).mockResolvedValue({ success: true, data: updatedComment });

      const store = useTicketStore();
      const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] };
      store.tickets = [ticket];
      store.selectedTicket = ticket;

      await store.updateComment('test-project', 1, 1, { content: 'Updated' });

      expect(store.selectedTicket?.comments[0].content).toBe('Updated');
    });

    it('reverts optimistic update on API failure', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Original', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.updateComment).mockResolvedValue({ success: false, error: 'Validation error' });

      const store = useTicketStore();
      store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] }];

      const result = await store.updateComment('test-project', 1, 1, { content: 'Updated' });

      expect(result).toBe(false);
      // Should revert to original content
      expect(store.tickets[0].comments[0].content).toBe('Original');
      expect(store.error).toBe('Validation error');
    });

    it('reverts optimistic update on network error', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Original', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.updateComment).mockRejectedValue(new Error('Network failure'));

      const store = useTicketStore();
      store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] }];

      const result = await store.updateComment('test-project', 1, 1, { content: 'Updated' });

      expect(result).toBe(false);
      expect(store.tickets[0].comments[0].content).toBe('Original');
      expect(store.error).toBe('Network failure');
    });
  });

  describe('deleteCommentAction', () => {
    it('removes comment from local state immediately', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Delete me', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.deleteComment).mockResolvedValue({ success: true, data: { deleted: true, comment_id: 1 } });

      const store = useTicketStore();
      store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] }];

      const result = await store.deleteComment('test-project', 1, 1);

      expect(result).toBe(true);
      expect(store.tickets[0].comments).toHaveLength(0);
    });

    it('removes comment from selectedTicket if matching', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Delete me', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.deleteComment).mockResolvedValue({ success: true, data: { deleted: true, comment_id: 1 } });

      const store = useTicketStore();
      const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] };
      store.tickets = [ticket];
      store.selectedTicket = ticket;

      await store.deleteComment('test-project', 1, 1);

      expect(store.selectedTicket?.comments).toHaveLength(0);
    });

    it('restores comment on API failure', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Restore me', action_type: 'comment', created_at: '2024-01-01' };
      vi.mocked(api.deleteComment).mockResolvedValue({ success: false, error: 'Not found' });

      const store = useTicketStore();
      store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment] }];

      const result = await store.deleteComment('test-project', 1, 1);

      expect(result).toBe(false);
      // Should restore the comment
      expect(store.tickets[0].comments).toHaveLength(1);
      expect(store.tickets[0].comments[0].content).toBe('Restore me');
      expect(store.error).toBe('Not found');
    });

    it('restores comment on network error by re-fetching', async () => {
      const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Original', action_type: 'comment', created_at: '2024-01-01' };
      const fetchResponse = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment], column_slug: 'todo', column_name: 'ToDo' };
      vi.mocked(api.deleteComment).mockRejectedValue(new Error('Network failure'));
      vi.mocked(api.getTicketById).mockResolvedValue({ success: true, data: fetchResponse });

      const store = useTicketStore();
      store.tickets = [{ id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [comment], column_slug: 'todo', column_name: 'ToDo' }];

      const result = await store.deleteComment('test-project', 1, 1);

      expect(result).toBe(false);
      // Should have restored via re-fetch
      expect(store.tickets[0].comments).toHaveLength(1);
      expect(store.error).toBe('Network failure');
    });
  });
});
