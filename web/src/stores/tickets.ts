import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  Ticket,
  Column,
  ApiResponse,
  PaginatedTickets,
  CreateTicketPayload,
  UpdateTicketPayload,
  MoveTicketPayload,
  AddCommentPayload,
  Comment as ApiComment,
  Dependency,
  Transition,
} from '../api';
import {
  getTickets,
  getTicketById,
  getTicketTransitions,
  createTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  addComment,
  updateComment,
  deleteComment,
  getColumns,
  getDependencies,
  getTicketBlockers,
  addDependency,
  removeDependency,
} from '../api';
import type { BlockingInfo } from '../api';
import type { Comment } from '../api';

export const useTicketStore = defineStore('tickets', () => {
  const tickets = ref<Ticket[]>([]);
  const selectedTicket = ref<Ticket | null>(null);
  const columns = ref<Column[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const dependencies = ref<Dependency[]>([]);
  const loadingDependencies = ref(false);
  const transitions = ref<Transition[]>([]);

  const blockingStatus = ref<Record<number, BlockingInfo>>({});

  const doneTicketsLoaded = ref(10);
  const doneTicketsTotal = ref(0);
  const showAllDone = ref(false);

  const doneColId = computed(() => {
    return columns.value.find((c) => c.slug === 'done')?.id;
  });

  function transformTicket(ticket: Ticket): Ticket {
    const estimateStr = ticket.estimate as unknown as string;
    const estimateNum = estimateStr !== null && estimateStr !== undefined && estimateStr !== ''
      ? parseFloat(estimateStr)
      : null;

    return {
      ...ticket,
      estimate: estimateNum,
      column: (ticket.column_slug || ticket.column_name)
        ? {
            id: ticket.column_id,
            name: ticket.column_name || '',
            slug: ticket.column_slug || '',
            order: 0,
            is_default: 0,
            project_id: ticket.project_id,
          }
        : null,
    };
  }

  async function fetchTickets(
    projectSlug: string,
    column?: string,
    options?: { all_tickets?: boolean; done_limit?: number }
  ): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const apiParams: Record<string, unknown> = {};

      if (column) {
        apiParams.column = column;
      }

      if (options?.all_tickets) {
        apiParams.all_tickets = true;
        if (options.done_limit) {
          apiParams.done_limit = options.done_limit;
        }
      }

      const res: ApiResponse<PaginatedTickets> = await getTickets(projectSlug, apiParams);
      if (res.success && res.data) {
        let allTickets = res.data.tickets.map(transformTicket);
        // Extract and cache is_blocked status for each ticket
        for (const ticket of res.data.tickets) {
          if (ticket.is_blocked !== undefined) {
            blockingStatus.value = {
              ...blockingStatus.value,
              [ticket.id]: {
                ticket_id: ticket.id,
                is_blocked: ticket.is_blocked,
                blocking_tickets: ticket.blocking_ticket_ids?.map((id) => ({ id, relation_type: '' })) || [],
              },
            };
          }
        }
        // Track done column pagination state
        if (options?.all_tickets) {
          // Count done tickets from the response (not res.data.total which is ALL tickets)
          const doneTickets = res.data.tickets.filter((t: Ticket) => t.column_id === doneColId.value);
          const doneCount = doneTickets.length;
          // Use done_total from API if available (total count of done tickets), otherwise fall back to response count
          doneTicketsTotal.value = res.data.done_total ?? doneCount;
          const doneLimit = options?.done_limit || 8;
          const limitedDone = doneTickets.slice(0, doneLimit);
          // Limit the number of done tickets in the main tickets array
          // so the UI shows only the initial batch behind the "Show all" button
          const nonDoneTickets = allTickets.filter((t: Ticket) => t.column_id !== doneColId.value);
          tickets.value = [...nonDoneTickets, ...limitedDone.map(transformTicket)];
          doneTicketsLoaded.value = limitedDone.length;  // Number of done tickets actually shown
          showAllDone.value = doneTicketsTotal.value <= doneLimit;  // All loaded if total done tickets <= limit
        } else {
          // Reset done pagination state for non-all_tickets fetches
          doneTicketsLoaded.value = 10;
          doneTicketsTotal.value = 0;
          showAllDone.value = false;
          tickets.value = allTickets;
        }
      } else {
        error.value = res.error ?? 'Failed to fetch tickets';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchColumns(projectSlug: string): Promise<void> {
    try {
      const res: ApiResponse<Column[]> = await getColumns(projectSlug);
      if (res.success && res.data) {
        columns.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch columns';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    }
  }

  function selectTicket(ticket: Ticket): void {
    selectedTicket.value = ticket;
  }

  function deselectTicket(): void {
    selectedTicket.value = null;
  }

  async function createTicketAction(projectSlug: string, payload: CreateTicketPayload): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Ticket> = await createTicket(projectSlug, payload);
      if (res.success && res.data) {
        const existingIdx = tickets.value.findIndex((t: Ticket) => t.id === res.data!.id);
        if (existingIdx === -1) {
          tickets.value.push(transformTicket(res.data));
        } else {
          // If it already exists, replace it (handles race conditions)
          tickets.value[existingIdx] = res.data;
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to create ticket';
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

  async function updateTicketAction(slug: string, id: number, payload: UpdateTicketPayload): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Ticket> = await updateTicket(slug, id, payload);
      if (res.success && res.data) {
        const idx = tickets.value.findIndex((t: Ticket) => t.id === id);
        // If parent_id changed, parent/child relationships are affected so
        // refresh the full ticket list to keep board views consistent.
        if (payload.parent_id !== undefined) {
          await refreshProject(slug);
        } else if (idx !== -1) {
          tickets.value[idx] = transformTicket(res.data);
        }
        if (selectedTicket.value?.id === id) {
          selectedTicket.value = idx !== -1 ? transformTicket(res.data) : selectedTicket.value;
          await refreshSelectedTicketComments(slug, id);
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to update ticket';
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

  async function moveTicketAction(
    slug: string,
    ticketId: number,
    payload: MoveTicketPayload
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await moveTicket(slug, ticketId, payload);
      if (res.success) {
        await fetchTickets(slug);
        if (selectedTicket.value?.id === ticketId) {
          await refreshSelectedTicketComments(slug, ticketId);
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to move ticket';
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

  async function refreshSelectedTicketComments(slug: string, ticketId: number): Promise<void> {
    try {
      const res: ApiResponse<Ticket & { comments?: ApiComment[] }> = await getTicketById(slug, ticketId);
      if (res.success && res.data) {
        const transformed = transformTicket(res.data as Ticket);
        const idx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
        if (idx !== -1) {
          tickets.value[idx] = transformed;
        }
        if (selectedTicket.value?.id === ticketId) {
          selectedTicket.value = transformed;
        }
      }
    } catch {
      // Silent fail — ticket list will eventually update
    }
  }

  async function addCommentAction(
    slug: string,
    ticketId: number,
    payload: AddCommentPayload
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<ApiComment> = await addComment(slug, ticketId, payload);
      if (res.success && res.data) {
        const commentId = res.data.id;
        const idx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
        if (idx !== -1) {
          const ticket = tickets.value[idx];
          const commentExists = (ticket.comments || []).some((c: Comment) => c.id === commentId);
          if (!commentExists) {
            tickets.value[idx] = {
              ...ticket,
              comments: [...(ticket.comments || []), res.data],
            };
          }
        }
        if (selectedTicket.value?.id === ticketId) {
          const commentExists = (selectedTicket.value.comments || []).some((c: Comment) => c.id === commentId);
          if (!commentExists) {
            selectedTicket.value = {
              ...selectedTicket.value,
              comments: [...(selectedTicket.value.comments || []), res.data],
            };
          }
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to add comment';
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

  async function updateCommentAction(
    slug: string,
    ticketId: number,
    commentId: number,
    payload: { content: string }
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;

    // Snapshot original comment content for rollback
    const originalContent = (() => {
      const ticket = tickets.value.find((t: Ticket) => t.id === ticketId);
      if (!ticket) return undefined;
      const comment = ticket.comments.find((c: Comment) => c.id === commentId);
      return comment?.content;
    })();

    // Optimistically update tickets list
    const ticketIdx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
    if (ticketIdx !== -1) {
      const commentIdx = tickets.value[ticketIdx].comments.findIndex((c: Comment) => c.id === commentId);
      if (commentIdx !== -1) {
        const updatedComments = [...tickets.value[ticketIdx].comments];
        updatedComments[commentIdx] = { ...updatedComments[commentIdx], content: payload.content };
        tickets.value[ticketIdx] = { ...tickets.value[ticketIdx], comments: updatedComments };
      }
    }

    // Optimistically update selectedTicket if it matches
    if (selectedTicket.value?.id === ticketId) {
      const commentIdx = selectedTicket.value.comments.findIndex((c: Comment) => c.id === commentId);
      if (commentIdx !== -1) {
        const updatedComments = [...selectedTicket.value.comments];
        updatedComments[commentIdx] = { ...updatedComments[commentIdx], content: payload.content };
        selectedTicket.value = { ...selectedTicket.value, comments: updatedComments };
      }
    }

    try {
      // Call API
      const res: ApiResponse<ApiComment> = await updateComment(slug, ticketId, commentId, payload);
      if (res.success && res.data) {
        // Sync with server response to ensure consistency
        const syncedTicketIdx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
        if (syncedTicketIdx !== -1) {
          tickets.value[syncedTicketIdx] = {
            ...tickets.value[syncedTicketIdx],
            comments: tickets.value[syncedTicketIdx].comments.map((c: Comment) =>
              c.id === commentId ? { ...c, content: res.data!.content } : c
            ),
          };
        }
        if (selectedTicket.value?.id === ticketId) {
          selectedTicket.value = {
            ...selectedTicket.value,
            comments: selectedTicket.value.comments.map((c: Comment) =>
              c.id === commentId ? { ...c, content: res.data!.content } : c
            ),
          };
        }
        return true;
      } else {
        // Revert optimistic update
        if (originalContent !== undefined) {
          const revTicketIdx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
          if (revTicketIdx !== -1) {
            const revCommentIdx = tickets.value[revTicketIdx].comments.findIndex((c: Comment) => c.id === commentId);
            if (revCommentIdx !== -1) {
              const updatedComments = [...tickets.value[revTicketIdx].comments];
              updatedComments[revCommentIdx] = { ...updatedComments[revCommentIdx], content: originalContent };
              tickets.value[revTicketIdx] = { ...tickets.value[revTicketIdx], comments: updatedComments };
            }
          }
          if (selectedTicket.value?.id === ticketId) {
            const selCommentIdx = selectedTicket.value.comments.findIndex((c: Comment) => c.id === commentId);
            if (selCommentIdx !== -1) {
              const updatedComments = [...selectedTicket.value.comments];
              updatedComments[selCommentIdx] = { ...updatedComments[selCommentIdx], content: originalContent };
              selectedTicket.value = { ...selectedTicket.value, comments: updatedComments };
            }
          }
        }
        error.value = res.error ?? 'Failed to update comment';
        return false;
      }
    } catch (err: unknown) {
      // Revert optimistic update on error
      if (originalContent !== undefined) {
        const revTicketIdx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
        if (revTicketIdx !== -1) {
          const revCommentIdx = tickets.value[revTicketIdx].comments.findIndex((c: Comment) => c.id === commentId);
          if (revCommentIdx !== -1) {
            const updatedComments = [...tickets.value[revTicketIdx].comments];
            updatedComments[revCommentIdx] = { ...updatedComments[revCommentIdx], content: originalContent };
            tickets.value[revTicketIdx] = { ...tickets.value[revTicketIdx], comments: updatedComments };
          }
        }
        if (selectedTicket.value?.id === ticketId) {
          const selCommentIdx = selectedTicket.value.comments.findIndex((c: Comment) => c.id === commentId);
          if (selCommentIdx !== -1) {
            const updatedComments = [...selectedTicket.value.comments];
            updatedComments[selCommentIdx] = { ...updatedComments[selCommentIdx], content: originalContent };
            selectedTicket.value = { ...selectedTicket.value, comments: updatedComments };
          }
        }
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function deleteCommentAction(
    slug: string,
    ticketId: number,
    commentId: number
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;

    // Snapshot deleted comment for rollback
    const deletedComment: Comment | undefined = (() => {
      const ticket = tickets.value.find((t: Ticket) => t.id === ticketId);
      if (!ticket) return undefined;
      return ticket.comments.find((c: Comment) => c.id === commentId);
    })();

    // Snapshot selectedTicket before removal for rollback
    const selectedTicketSnapshot = selectedTicket.value?.id === ticketId ? { ...selectedTicket.value } : null;

    // Remove from tickets list immediately
    tickets.value = tickets.value.map((ticket: Ticket) => {
      if (ticket.id !== ticketId) return ticket;
      return { ...ticket, comments: ticket.comments.filter((c: Comment) => c.id !== commentId) };
    });

    // Remove from selectedTicket immediately
    if (selectedTicket.value?.id === ticketId) {
      selectedTicket.value = {
        ...selectedTicket.value,
        comments: selectedTicket.value.comments.filter((c: Comment) => c.id !== commentId),
      };
    }

    try {
      // Call API
      const res: ApiResponse<{ deleted: boolean; comment_id: number }> = await deleteComment(slug, ticketId, commentId);
      if (res.success && res.data) {
        return true;
      } else {
        // Restore: re-add the comment
        if (deletedComment) {
          const restTicketIdx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
          if (restTicketIdx !== -1) {
            tickets.value[restTicketIdx] = {
              ...tickets.value[restTicketIdx],
              comments: [...tickets.value[restTicketIdx].comments, deletedComment],
            };
          }
        }
        // Restore selectedTicket
        if (selectedTicketSnapshot) {
          selectedTicket.value = {
            ...selectedTicketSnapshot,
            comments: [...selectedTicketSnapshot.comments, deletedComment!],
          };
        }
        error.value = res.error ?? 'Failed to delete comment';
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      // Try to restore by re-fetching the ticket
      try {
        const fetchRes: ApiResponse<Ticket> = await getTicketById(slug, ticketId);
        if (fetchRes.success && fetchRes.data) {
          const transformed = transformTicket(fetchRes.data);
          const fetchTicketIdx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
          if (fetchTicketIdx !== -1) {
            tickets.value[fetchTicketIdx] = transformed;
          }
          if (selectedTicket.value?.id === ticketId) {
            selectedTicket.value = transformed;
          }
        }
      } catch {
        // Could not restore — user may need to refresh
      }
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function refreshProject(slug: string): Promise<void> {
    await Promise.all([
      fetchTickets(slug, undefined, { all_tickets: true, done_limit: 8 }),
      fetchColumns(slug),
    ]);
    if (selectedTicket.value) {
      await refreshSelectedTicketComments(slug, selectedTicket.value.id);
    }
  }

  async function fetchTransitions(projectSlug: string, ticketId: number): Promise<void> {
    try {
      const res: ApiResponse<Transition[]> = await getTicketTransitions(projectSlug, ticketId);
      if (res.success && res.data) {
        transitions.value = res.data;
      } else {
        transitions.value = [];
      }
    } catch {
      transitions.value = [];
    }
  }

  async function fetchDependencies(projectSlug: string, ticketId: number): Promise<void> {
    loadingDependencies.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Dependency[]> = await getDependencies(projectSlug, ticketId);
      if (res.success && res.data) {
        dependencies.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch dependencies';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loadingDependencies.value = false;
    }
  }

  async function fetchTicketBlockers(projectSlug: string, ticketId: number): Promise<void> {
    try {
      const res: ApiResponse<BlockingInfo> = await getTicketBlockers(projectSlug, ticketId);
      if (res.success && res.data) {
        blockingStatus.value = {
          ...blockingStatus.value,
          [ticketId]: res.data,
        };
      }
    } catch {
      // Silent fail — blocking status will be null
    }
  }

  async function addDependencyAction(
    projectSlug: string,
    ticketId: number,
    depTicketId: number,
    relationType: string
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ added: boolean; ticket_id: number; depends_on_id: number; relation_type: string }> =
        await addDependency(projectSlug, ticketId, depTicketId, relationType);
      if (res.success && res.data) {
        await fetchDependencies(projectSlug, ticketId);
        // Refresh blocking info for both the ticket and its dependency
        // so that blocking indicators on kanban cards update in real-time.
        await fetchTicketBlockers(projectSlug, ticketId);
        await fetchTicketBlockers(projectSlug, depTicketId);
        return true;
      } else {
        error.value = res.error ?? 'Failed to add dependency';
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

  async function removeDependencyAction(
    projectSlug: string,
    ticketId: number,
    depTicketId: number,
    relationType: string
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ removed: boolean; ticket_id: number; depends_on_id: number }> =
        await removeDependency(projectSlug, ticketId, depTicketId, relationType);
      if (res.success && res.data) {
        await fetchDependencies(projectSlug, ticketId);
        // Refresh blocking info for both the ticket and its dependency
        // so that blocking indicators on kanban cards update in real-time.
        await fetchTicketBlockers(projectSlug, ticketId);
        await fetchTicketBlockers(projectSlug, depTicketId);
        return true;
      } else {
        error.value = res.error ?? 'Failed to remove dependency';
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

  async function deleteTicketAction(slug: string, id: number): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<{ deleted: boolean; ticket_id: number }> = await deleteTicket(slug, id);
      if (res.success && res.data) {
        tickets.value = tickets.value.filter((t: Ticket) => t.id !== id);
        if (selectedTicket.value?.id === id) {
          selectedTicket.value = null;
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to delete ticket';
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

  // --- SSE inline update methods ---

  function insertTicket(ticket: Ticket): void {
    const transformed = transformTicket(ticket);
    // Avoid duplicates — don't insert if ticket with same ID already exists
    const existingIdx = tickets.value.findIndex((t: Ticket) => t.id === transformed.id);
    if (existingIdx === -1) {
      tickets.value.push(transformed);
    } else {
      // If it already exists, replace it (handles race conditions)
      tickets.value[existingIdx] = transformed;
    }
  }

  function removeTicket(ticketId: number): void {
    tickets.value = tickets.value.filter((t: Ticket) => t.id !== ticketId);
    if (selectedTicket.value?.id === ticketId) {
      selectedTicket.value = null;
    }
  }

  function repositionTicket(ticketId: number, toColumnSlug: string): void {
    // For moves, the server sends the ticket_id + target column.
    // Emit a custom event so the component can refetch the full project state.
    // In a production app, the server would send the full ticket in the moved event payload.
    window.dispatchEvent(new CustomEvent('ticket-moved', { detail: { ticketId, toColumn: toColumnSlug } }));
  }

  function updateTicketInline(ticket: Ticket): void {
    const transformed = transformTicket(ticket);
    const idx = tickets.value.findIndex((t: Ticket) => t.id === transformed.id);
    if (idx !== -1) {
      tickets.value[idx] = transformed;
    }
    if (selectedTicket.value?.id === transformed.id) {
      selectedTicket.value = transformed;
    }
  }

  function addCommentInline(ticketId: number, comment: ApiComment): void {
    const idx = tickets.value.findIndex((t: Ticket) => t.id === ticketId);
    if (idx !== -1) {
      const ticket = tickets.value[idx];
      // Deduplicate: only add if comment with same ID isn't already present
      const commentExists = (ticket.comments || []).some((c: Comment) => c.id === comment.id);
      if (!commentExists) {
        tickets.value[idx] = {
          ...ticket,
          comments: [...(ticket.comments || []), comment],
        };
      }
    }
    if (selectedTicket.value?.id === ticketId) {
      // Same deduplication for selectedTicket
      const commentExists = (selectedTicket.value.comments || []).some((c: Comment) => c.id === comment.id);
      if (!commentExists) {
        selectedTicket.value = {
          ...selectedTicket.value,
          comments: [...(selectedTicket.value.comments || []), comment],
        };
      }
    }
  }

  async function refreshDependencies(ticketId: number, dependsOnId?: number, projectSlug?: string): Promise<void> {
    // Refresh blocking status when dependencies change (SSE dep_added/dep_removed events)
    // If projectSlug is provided, fetch blocking info to update the UI in real-time.
    if (projectSlug) {
      await fetchTicketBlockers(projectSlug, ticketId);
      if (dependsOnId) {
        await fetchTicketBlockers(projectSlug, dependsOnId);
      }
    }
    // Without projectSlug, this is a no-op (kept for backward compatibility).
    // The actual blocking info refresh is handled by addDependencyAction and
    // removeDependencyAction which call fetchTicketBlockers directly.
  }

  const ticketsByColumn = computed<Record<number, Ticket[]>>(() => {
    const grouped: Record<number, Ticket[]> = {};
    for (const ticket of tickets.value) {
      const colId = ticket.column_id;
      if (!grouped[colId]) {
        grouped[colId] = [];
      }
      grouped[colId].push(ticket);
    }
    return grouped;
  });

  const columnTicketsCount = computed<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const ticket of tickets.value) {
      const colId = ticket.column_id;
      counts[colId] = (counts[colId] || 0) + 1;
    }
    return counts;
  });

  const parentTickets = computed<Ticket[]>(() => {
    const parentIdSet = new Set<number>();
    for (const ticket of tickets.value) {
      if (ticket.parent_id != null) {
        parentIdSet.add(ticket.parent_id);
      }
    }
    return tickets.value.filter((t) => parentIdSet.has(t.id));
  });

  const childTicketsByParentId = computed<Record<number, Ticket[]>>(() => {
    const grouped: Record<number, Ticket[]> = {};
    for (const ticket of tickets.value) {
      if (ticket.parent_id != null) {
        if (!grouped[ticket.parent_id]) {
          grouped[ticket.parent_id] = [];
        }
        grouped[ticket.parent_id].push(ticket);
      }
    }
    return grouped;
  });

  const isParentTicket = computed(() => {
    return (ticketId: number): boolean => {
      return ticketId in childTicketsByParentId.value;
    };
  });

  const getChildTickets = (parentId: number): Ticket[] => {
    return childTicketsByParentId.value[parentId] || [];
  };

  const getParentTicket = (ticketId: number): Ticket | null => {
    const ticket = tickets.value.find((t) => t.id === ticketId);
    if (!ticket || ticket.parent_id == null) return null;
    return tickets.value.find((t) => t.id === ticket.parent_id) || null;
  };

  const getChildTicketsForColumn = (columnId: number): { parent: Ticket; children: Ticket[] }[] => {
    const parents = parentTickets.value.filter((t) => t.column_id === columnId);
    return parents
      .map((parent) => ({ parent, children: childTicketsByParentId.value[parent.id] || [] }))
      .filter((group) => group.children.length > 0)
      .sort((a, b) => a.parent.priority - b.parent.priority);
  };

  const orphanChildTickets = computed<Record<number, Ticket[]>>(() => {
    const grouped: Record<number, Ticket[]> = {};
    for (const ticket of tickets.value) {
      if (ticket.parent_id != null) {
        const parent = tickets.value.find((t) => t.id === ticket.parent_id);
        if (!parent || parent.column_id !== ticket.column_id) {
          const parentId = ticket.parent_id;
          if (!grouped[parentId]) {
            grouped[parentId] = [];
          }
          grouped[parentId].push(ticket);
        }
      }
    }
    return grouped;
  });

  const isTicketBlocked = computed(() => {
    return (ticketId: number): boolean => {
      const status = blockingStatus.value[ticketId];
      return status?.is_blocked ?? false;
    };
  });

  async function loadMoreDone(projectSlug: string): Promise<void> {
    loading.value = true;
    try {
      // Fetch ALL done tickets at once
      const res: ApiResponse<PaginatedTickets> = await getTickets(projectSlug, {
        column: 'done',
        per_page: 1000,
        done_limit: 1000,
        sort_by: 'updated_at',
        sort_order: 'desc',
      });
      if (res.success && res.data) {
        // Get existing non-done tickets and merge new done tickets
        const newDone = res.data.tickets
          .filter((t: Ticket) => t.column_id === doneColId.value)
          .map(transformTicket);
        const existingNonDone = tickets.value.filter((t: Ticket) => t.column_id !== doneColId.value);
        tickets.value = [...existingNonDone, ...newDone];
        doneTicketsLoaded.value = newDone.length;
        // Use done_total from API if available, otherwise fall back to response count
        doneTicketsTotal.value = res.data.done_total ?? newDone.length;
        showAllDone.value = true;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  function collapseDone(): void {
    // Collapse done tickets back to the first 10
    // Re-slice done tickets from the full list back to the default limit
    const doneLimit = 8;
    const nonDoneTickets = tickets.value.filter((t: Ticket) => t.column_id !== doneColId.value);
    const doneTickets = tickets.value.filter((t: Ticket) => t.column_id === doneColId.value);
    tickets.value = [...nonDoneTickets, ...doneTickets.slice(0, doneLimit)];
    doneTicketsLoaded.value = doneTicketsTotal.value > doneLimit ? doneLimit : doneTicketsTotal.value;
    showAllDone.value = false;
  }

  const hasMoreDoneTickets = computed(() => {
    return !showAllDone.value && doneTicketsTotal.value > doneTicketsLoaded.value;
  });

  const doneColumnHasMore = computed(() => {
    const doneCount = tickets.value.filter((t: Ticket) => t.column_id === doneColId.value).length;
    return doneCount < doneTicketsTotal.value && !showAllDone.value;
  });

  return {
    tickets,
    selectedTicket,
    columns,
    loading,
    error,
    ticketsByColumn,
    columnTicketsCount,
    parentTickets,
    childTicketsByParentId,
    isParentTicket,
    getChildTickets,
    getParentTicket,
    getChildTicketsForColumn,
    orphanChildTickets,
    blockingStatus,
    dependencies,
    loadingDependencies,
    transitions,
    doneTicketsLoaded,
    doneTicketsTotal,
    showAllDone,
    hasMoreDoneTickets,
    doneColumnHasMore,
    isTicketBlocked,
    loadMoreDone,
    collapseDone,
    fetchTickets,
    fetchColumns,
    selectTicket,
    deselectTicket,
    createTicket: createTicketAction,
    updateTicket: updateTicketAction,
    moveTicket: moveTicketAction,
    addComment: addCommentAction,
    updateComment: updateCommentAction,
    deleteComment: deleteCommentAction,
    refreshProject,
    refreshSelectedTicketComments,
    fetchDependencies,
    fetchTicketBlockers,
    fetchTransitions,
    addDependency: addDependencyAction,
    removeDependency: removeDependencyAction,
    deleteTicket: deleteTicketAction,
    // SSE inline update methods
    insertTicket,
    removeTicket,
    repositionTicket,
    updateTicketInline,
    addCommentInline,
    refreshDependencies,
  };
});
