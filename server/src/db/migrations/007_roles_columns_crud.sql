-- ============================================================================
-- Migration 007: roles_columns CRUD
--
-- The initial schema (000_initial_schema.sql) already has the new structure:
--   column_id INTEGER REFERENCES kanban_columns(id),
--   project_id nullable, is_default INTEGER NOT NULL DEFAULT 0
--
-- This migration is a no-op for new databases. For existing databases
-- with the old schema (column_slug), this migration will be applied
-- manually/once to migrate to the new structure.
-- ============================================================================

-- For new databases, the roles_columns table already has the correct structure.
-- We only need to ensure indexes exist.

CREATE INDEX IF NOT EXISTS idx_roles_columns_role_project
    ON roles_columns(role_id, project_id);
CREATE INDEX IF NOT EXISTS idx_roles_columns_project
    ON roles_columns(project_id);
