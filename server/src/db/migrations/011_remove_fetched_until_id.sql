-- ============================================================================
-- Migration 011: Remove fetched_until_id column from messages table
--
-- The fetched_until_id field on the messages table was used for tracking
-- read cursors, but it has been replaced by last_read_message_id on the
-- conversations table (added in migration 010). This column is redundant
-- and should be removed.
--
-- For SQLite, we use a create-copy-drop-rename pattern since it doesn't
-- support ALTER TABLE DROP COLUMN in all versions.
--
-- Idempotent: safe to run multiple times. The schema_migrations table
-- in the migration runner prevents re-application.
-- ============================================================================

-- Disable foreign keys for the duration of this migration
-- so that DROP TABLE messages does not fail on active FK references
PRAGMA foreign_keys = OFF;

-- Create new table without fetched_until_id column
CREATE TABLE IF NOT EXISTS messages_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_role_id INTEGER NOT NULL REFERENCES roles(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing data (ignoring fetched_until_id if it exists)
INSERT OR IGNORE INTO messages_new (id, conversation_id, sender_role_id, content, created_at)
    SELECT id, conversation_id, sender_role_id, content, created_at FROM messages;

-- Drop the old table
DROP TABLE messages;

-- Rename the new table
ALTER TABLE messages_new RENAME TO messages;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;
