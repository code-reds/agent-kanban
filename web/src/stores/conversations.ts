import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  Conversation,
  ConversationWithMessages,
  Message,
  ApiResponse,
  SendMessagePayload,
  UnreadResponse,
} from '../api';
import {
  getConversations,
  getConversation,
  sendMessage,
  fetchUnread,
  createConversation,
  type CreateConversationPayload,
} from '../api';

export const useConversationStore = defineStore('conversations', () => {
  const conversations = ref<Conversation[]>([]);
  const activeConversation = ref<ConversationWithMessages | null>(null);
  const messageInput = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  const fetchedUntilId = ref(0);
  const unreadCount = ref(0);

  const activeConversationId = computed(() => activeConversation.value?.id ?? null);

  async function fetchConversations(projectSlug: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<Conversation[]> = await getConversations(projectSlug);
      if (res.success && res.data) {
        conversations.value = res.data;
      } else {
        error.value = res.error ?? 'Failed to fetch conversations';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  async function selectConversation(
    projectSlug: string,
    conversationId: number
  ): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res: ApiResponse<ConversationWithMessages> = await getConversation(projectSlug, conversationId);
      if (res.success && res.data) {
        activeConversation.value = res.data;
        fetchedUntilId.value = res.data.messages.length > 0
          ? res.data.messages[res.data.messages.length - 1].id
          : 0;
      } else {
        error.value = res.error ?? 'Failed to fetch conversation';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  async function sendMessageAction(
    projectSlug: string,
    conversationId: number,
    roleId?: number
  ): Promise<boolean> {
    if (!messageInput.value.trim()) return false;

    loading.value = true;
    error.value = null;
    const content = messageInput.value;
    messageInput.value = '';

    try {
      const res: ApiResponse<Message> = await sendMessage(projectSlug, conversationId, {
        content,
        sender_role_id: roleId,
      });
      if (res.success && res.data) {
        if (activeConversation.value?.id === conversationId) {
          const messageId = res.data.id;
          const messageExists = activeConversation.value.messages.some((m: Message) => m.id === messageId);
          if (!messageExists) {
            activeConversation.value = {
              ...activeConversation.value,
              messages: [...activeConversation.value.messages, res.data],
            };
          }
        }
        return true;
      } else {
        error.value = res.error ?? 'Failed to send message';
        messageInput.value = content;
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;
      messageInput.value = content;
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function fetchUnreadAction(projectSlug: string): Promise<void> {
    try {
      const res: ApiResponse<UnreadResponse> = await fetchUnread(projectSlug, {
        limit: 50,
        fetched_until: fetchedUntilId.value,
      });
      if (res.success && res.data) {
        if (activeConversation.value && res.data.messages.length > 0) {
          const updatedMessages = [...activeConversation.value.messages, ...res.data.messages];
          activeConversation.value = {
            ...activeConversation.value,
            messages: updatedMessages,
          };
          fetchedUntilId.value = res.data.fetched_until_id;
        }
        if (res.data.messages.length > 0) {
          unreadCount.value += res.data.messages.length;
        }
      }
    } catch {
      // Silently fail for unread polling
    }
  }

  function clearActive(): void {
    activeConversation.value = null;
    fetchedUntilId.value = 0;
  }

  function setUnreadCount(count: number): void {
    unreadCount.value = count;
  }

  /**
   * Check if a conversation already exists between the human user and the target role.
   */
  function conversationExistsWithRole(targetRoleId: number): boolean {
    return conversations.value.some((conv: Conversation) =>
      conv.from_role_id === 1 && conv.to_role_id === targetRoleId ||
      conv.from_role_id === targetRoleId && conv.to_role_id === 1
    );
  }

  /**
   * Find an existing conversation with the given target role, or return null.
   */
  function findExistingConversation(targetRoleId: number): Conversation | undefined {
    return conversations.value.find((conv: Conversation) =>
      (conv.from_role_id === 1 && conv.to_role_id === targetRoleId) ||
      (conv.from_role_id === targetRoleId && conv.to_role_id === 1)
    );
  }

  /**
   * Create a new conversation with a target role, or open an existing one.
   * Returns the conversation ID, or null on failure.
   */
  async function createConversationAction(
    projectSlug: string,
    targetRoleId: number
  ): Promise<number | null> {
    loading.value = true;
    error.value = null;

    try {
      const res: ApiResponse<Conversation> = await createConversation(projectSlug, { role_id: targetRoleId });

      if (res.success && res.data) {
        // Add to the conversation list if not already present
        const existingIndex = conversations.value.findIndex((conv: Conversation) => conv.id === res.data!.id);
        if (existingIndex === -1) {
          conversations.value.push(res.data);
        }
        return res.data.id;
      } else {
        error.value = res.error ?? 'Failed to create conversation';
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

  return {
    conversations,
    activeConversation,
    messageInput,
    loading,
    error,
    fetchedUntilId,
    unreadCount,
    activeConversationId,
    fetchConversations,
    selectConversation,
    sendMessage: sendMessageAction,
    fetchUnread: fetchUnreadAction,
    clearActive,
    setUnreadCount,
    createConversation: createConversationAction,
    conversationExistsWithRole,
    findExistingConversation,
  };
});
