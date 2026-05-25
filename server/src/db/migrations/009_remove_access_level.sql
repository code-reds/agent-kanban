-- ============================================================================
-- Migration 009: Remove access_level column from roles table
--
-- The access_level field on the roles table is redundant. The actual permission
-- system uses ticket_access_rules exclusively and never reads roles.access_level.
--
-- For SQLite, we use a create-copy-drop-rename pattern since it doesn't
-- support ALTER TABLE DROP COLUMN in all versions.
--
-- Idempotent: safe to run multiple times. The schema_migrations table
-- in the migration runner prevents re-application.
-- ============================================================================

-- Disable foreign keys for the duration of this migration
-- so that DROP TABLE roles does not fail on active FK references
PRAGMA foreign_keys = OFF;

-- Create new table without access_level column
CREATE TABLE IF NOT EXISTS roles_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

-- Copy existing data (ignoring access_level if it exists)
INSERT OR IGNORE INTO roles_new (id, name, description)
    SELECT id, name, description FROM roles;

-- Drop the old table
DROP TABLE roles;

-- Rename the new table
ALTER TABLE roles_new RENAME TO roles;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;
