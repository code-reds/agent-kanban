-- ============================================================================
-- Migration 008: Role Management Cleanup and Schema Updates
--
-- This migration ensures schema consistency for role management operations.
-- Since SQLite does not support adding FK constraints to existing tables,
-- we handle cleanup at the application level.
--
-- Changes:
--   1. No schema changes for api_tokens — already has REFERENCES roles(id)
--      but lacks ON DELETE CASCADE. Application-level cleanup handles deletion.
--   2. No schema changes for ticket_access_rules — logical reference only.
--      Application-level cleanup handles deletion.
--   3. No schema changes for tickets.created_by_role_id — FK exists without
--      ON DELETE behavior. Application-level cleanup migrates ownership.
--   4. Adds indexes for orphaned role reference verification queries.
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- Ensure indexes for efficient orphaned reference checks

-- Index on api_tokens for orphaned role_id lookups
CREATE INDEX IF NOT EXISTS idx_api_tokens_role_id
    ON api_tokens(role_id);

-- Index on ticket_access_rules for orphaned role_id lookups
CREATE INDEX IF NOT EXISTS idx_ticket_access_rules_role_id
    ON ticket_access_rules(role_id);

-- Index on tickets for orphaned created_by_role_id lookups
-- Only create if not already present (idempotent)
CREATE INDEX IF NOT EXISTS idx_tickets_created_by_role_id
    ON tickets(created_by_role_id);

-- ============================================================================
-- Verification Queries (for integration tests and admin diagnostics)
-- ============================================================================
-- These are SELECT statements, not DDL, so they are naturally idempotent.
-- They are provided as comments for use in integration tests.
--
-- Check for api_tokens referencing non-existent roles:
--   SELECT COUNT(*) FROM api_tokens WHERE role_id NOT IN (SELECT id FROM roles);
--
-- Check for ticket_access_rules referencing non-existent roles:
--   SELECT COUNT(*) FROM ticket_access_rules WHERE role_id NOT IN (SELECT id FROM roles);
--
-- Check for tickets with non-existent created_by_role_id:
--   SELECT COUNT(*) FROM tickets WHERE created_by_role_id NOT IN (SELECT id FROM roles);
-- ============================================================================
