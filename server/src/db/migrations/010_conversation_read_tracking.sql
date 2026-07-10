-- ============================================================================
-- Migration 010: Conversation read tracking
-- ============================================================================
-- Add last_read_message_id column to conversations table for per-conversation
-- read cursor tracking. This fixes the broken fetched_until_id approach on
-- the messages table and enables reliable unread message counting.
-- ============================================================================

-- Add last_read_message_id to conversations table
ALTER TABLE conversations ADD COLUMN last_read_message_id INTEGER NOT NULL DEFAULT 0;

-- Index for efficient unread message queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages(conversation_id);
