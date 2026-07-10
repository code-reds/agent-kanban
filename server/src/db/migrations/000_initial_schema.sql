-- ============================================================================
-- Agent Kanban — Full Database Schema
-- ============================================================================
-- This file represents the initial database schema. It serves as the initial 
-- state for
-- new database instances.
-- ============================================================================

-- Enable WAL mode for better read concurrency (idempotent)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- Section 1: Core Project & Workflow Tables
-- ============================================================================

-- Projects: top-level container for all Kanban boards
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Roles: instance-wide role definitions (e.g., Human User, AI code developer)
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

-- Kanban columns: configurable workflow stages per project (or global)
-- project_id can be NULL for global (shared) column definitions
-- is_global: when true, this column applies across all projects
CREATE TABLE IF NOT EXISTS kanban_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    is_global BOOLEAN NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(project_id, slug)
);

-- Workflow transitions: state machine for column movement
-- project_id can be NULL for global (shared) transition definitions
-- is_global: when true, this transition applies across all projects
-- entire_ticket_group: when true, moving a parent also moves all children
CREATE TABLE IF NOT EXISTS workflow_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    column_from INTEGER NOT NULL REFERENCES kanban_columns(id),
    column_to INTEGER NOT NULL REFERENCES kanban_columns(id),
    requires_comment BOOLEAN NOT NULL DEFAULT 0,
    is_global BOOLEAN NOT NULL DEFAULT 0,
    entire_ticket_group BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(project_id, column_from, column_to)
);

-- Association table: which roles may trigger each workflow transition
CREATE TABLE IF NOT EXISTS transition_allowed_roles (
    transition_id INTEGER NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    PRIMARY KEY (transition_id, role_id)
);

-- Unified access rules: per-column role permissions for tickets
-- project_id can be NULL for global (shared) access rules
-- is_global: when true, this rule applies across all projects
CREATE TABLE IF NOT EXISTS ticket_access_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES kanban_columns(id),
    role_id INTEGER NOT NULL REFERENCES roles(id),
    action_type TEXT NOT NULL,
    is_global BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(project_id, column_id, role_id, action_type)
);

-- ============================================================================
-- Section 2: Ticket Management Tables
-- ============================================================================

-- Tickets: Kanban cards belonging to a project
-- parent_id: enables hierarchical ticket groups (sub-tasks)
CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id INTEGER NULL REFERENCES tickets(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES kanban_columns(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    labels TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 2,
    estimate TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    created_by_role_id INTEGER NOT NULL REFERENCES roles(id)
);

-- Ticket dependencies: blocked_by, depends_on, related
-- (ticket_id, depends_on_id, relation_type) must be unique
CREATE TABLE IF NOT EXISTS ticket_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    UNIQUE(ticket_id, depends_on_id, relation_type)
);

-- Ticket comments: markdown-formatted discussion and audit trail
CREATE TABLE IF NOT EXISTS ticket_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_role_id INTEGER NOT NULL REFERENCES roles(id),
    content TEXT NOT NULL,
    action_type TEXT,
    action_details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ticket status history: audit trail for every column change
CREATE TABLE IF NOT EXISTS ticket_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_column_id INTEGER NOT NULL REFERENCES kanban_columns(id),
    to_column_id INTEGER NOT NULL REFERENCES kanban_columns(id),
    actor_role_id INTEGER NOT NULL REFERENCES roles(id),
    comment_id INTEGER NULL REFERENCES ticket_comments(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Section 3: Communication (Conversations & Messages)
-- ============================================================================

-- Conversations: one per role pair per project
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_role_id INTEGER NOT NULL REFERENCES roles(id),
    to_role_id INTEGER NOT NULL REFERENCES roles(id),
    UNIQUE(project_id, from_role_id, to_role_id)
);

-- Messages: chat messages within a conversation
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_role_id INTEGER NOT NULL REFERENCES roles(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Section 4: Role & Authentication Tables
-- ============================================================================

-- Roles columns: maps roles to their default Kanban column in a project.
-- project_id can be NULL for global (project-agnostic) role-column mappings.
-- A NULL column_id means the role has unrestricted access to all columns.
CREATE TABLE IF NOT EXISTS roles_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    column_id INTEGER REFERENCES kanban_columns(id),
    is_default INTEGER NOT NULL DEFAULT 0,
    UNIQUE(role_id, project_id)
);

-- API tokens: machine-to-machine authentication for agents
CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    token_value TEXT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- ============================================================================
-- Section 5: Global Settings Metadata
-- ============================================================================

-- Global settings metadata: project-agnostic configuration storage
CREATE TABLE IF NOT EXISTS global_settings_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Section 6: Indexes for Performance
-- ============================================================================

-- Ticket lookups
CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_column ON tickets(column_id);

-- Ticket comments and history
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket ON ticket_status_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_comment ON ticket_status_history(comment_id);

-- Messages and conversations
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- API tokens
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_project ON api_tokens(project_id);

-- Role-column mappings
CREATE INDEX IF NOT EXISTS idx_roles_columns_role_project
    ON roles_columns(role_id, project_id);
CREATE INDEX IF NOT EXISTS idx_roles_columns_project
    ON roles_columns(project_id);

-- ============================================================================
-- Section 7: Views
-- ============================================================================

-- ticket_roots: Maps every ticket to its root (top-level ancestor).
-- Uses a recursive CTE to walk up the parent_id chain to find the
-- original parentless ticket. Each ticket belongs to exactly one root.
CREATE VIEW IF NOT EXISTS ticket_roots AS
    WITH RECURSIVE childRelations(parent_id, child_id) AS (
        SELECT tickets.parent_id, tickets.id AS child_id FROM tickets WHERE tickets.parent_id IS NOT NULL
        UNION
        SELECT childRelations.parent_id, tickets.id AS child_id FROM childRelations JOIN tickets ON childRelations.child_id = tickets.parent_id
    )
    SELECT childRelations.child_id AS ticket_id, childRelations.parent_id AS root_id FROM childRelations
    JOIN tickets AS Parents ON childRelations.parent_id = Parents.id
    WHERE Parents.parent_id IS NULL
    UNION
    SELECT tickets.id AS ticket_id, tickets.id AS root_id FROM tickets WHERE tickets.parent_id IS NULL;

-- forward_transitions: Filters workflow_transitions to only those that
-- move tickets "forward" (to a column with a higher order value).
-- Used to determine when entire_ticket_group cascading should apply.
CREATE VIEW IF NOT EXISTS forward_transitions AS
    SELECT workflow_transitions.*
    FROM workflow_transitions
    JOIN kanban_columns AS DestinationCol ON DestinationCol.id = workflow_transitions.column_to
    JOIN kanban_columns AS SourceCol ON SourceCol.id = workflow_transitions.column_from
    WHERE SourceCol."order" < DestinationCol."order";

-- ticket_blockers: Complex view that identifies which tickets are
-- currently blocking others. A ticket is blocked when:
--   1. A direct dependency (blocked_by/depends_on) is not yet closed
--   2. For entire_ticket_group: siblings in the same ticket tree are blocked
--      when any sibling is behind in the workflow
--   3. For single-ticket transitions: parent tickets are blocked by children
--      that have not progressed ahead
--
-- This view excludes tickets in 'human_feedback' column since those are
-- awaiting external input, not blocked by dependencies.
CREATE VIEW IF NOT EXISTS ticket_blockers AS
    -- 1. Direct dependency blockers within and across ticket groups
    SELECT DISTINCT tickets.id AS ticket_id, Dependency.id AS depends_on_id, tickets.project_id FROM tickets
    JOIN kanban_columns AS TicketCol ON tickets.column_id = TicketCol.id
    JOIN ticket_roots AS ThisRoot ON ThisRoot.ticket_id = tickets.id
    JOIN ticket_dependencies AS BlockedByRelations ON (BlockedByRelations.relation_type = 'blocked_by' OR BlockedByRelations.relation_type = 'depends_on') AND BlockedByRelations.ticket_id = tickets.id
    JOIN tickets AS Dependency ON BlockedByRelations.depends_on_id = Dependency.id
    JOIN ticket_roots AS DependencyRoot ON DependencyRoot.ticket_id = Dependency.id
    JOIN kanban_columns AS DependencyCol ON Dependency.column_id = DependencyCol.id
    WHERE Dependency.closed_at IS NULL
        AND tickets.closed_at IS NULL
        AND TicketCol.slug != 'human_feedback'
        AND (
            DependencyRoot.root_id != ThisRoot.root_id
            OR (DependencyCol."order" <= TicketCol."order" AND NOT EXISTS (
                    SELECT 1
                    FROM forward_transitions
                    WHERE forward_transitions.entire_ticket_group
                        AND forward_transitions.column_from = TicketCol.id
                ))
            OR DependencyCol.slug = 'human_feedback'
        )
    UNION
    -- 2. Same-group blockers for entire_ticket_group transitions
    SELECT DISTINCT tickets.id AS ticket_id, Dependency.id AS depends_on_id, tickets.project_id FROM tickets
    JOIN kanban_columns AS TicketCol ON tickets.column_id = TicketCol.id
    JOIN ticket_roots AS ThisRoot ON ThisRoot.ticket_id = tickets.id
    JOIN ticket_roots AS DependencyRoot ON DependencyRoot.root_id = ThisRoot.root_id AND DependencyRoot.ticket_id != tickets.id
    JOIN tickets AS Dependency ON DependencyRoot.ticket_id = Dependency.id
    JOIN kanban_columns AS DependencyCol ON Dependency.column_id = DependencyCol.id
    WHERE
        Dependency.closed_at IS NULL
        AND TicketCol.slug != 'human_feedback'
        AND tickets.closed_at IS NULL
        AND (DependencyCol."order" < TicketCol."order" OR DependencyCol.slug = 'human_feedback')
        AND EXISTS (
            SELECT 1
            FROM forward_transitions
            WHERE forward_transitions.entire_ticket_group
                AND forward_transitions.column_from = TicketCol.id
        )
    UNION
    -- 3. External dependencies for same-group tickets (entire_ticket_group)
    SELECT DISTINCT tickets.id AS ticket_id, Dependency.id AS depends_on_id, tickets.project_id FROM tickets
    JOIN ticket_roots AS ThisRoot ON ThisRoot.ticket_id = tickets.id
    JOIN ticket_roots AS GroupMemberRoot ON GroupMemberRoot.root_id = ThisRoot.root_id AND GroupMemberRoot.ticket_id != tickets.id
    JOIN tickets AS GroupMember ON GroupMemberRoot.ticket_id = GroupMember.id
    JOIN ticket_dependencies AS BlockedByRelations ON (BlockedByRelations.relation_type = 'blocked_by' OR BlockedByRelations.relation_type = 'depends_on')
                    AND BlockedByRelations.ticket_id = GroupMember.id
    JOIN tickets AS Dependency ON BlockedByRelations.depends_on_id = Dependency.id
    JOIN ticket_roots AS DependencyRoot ON DependencyRoot.root_id != ThisRoot.root_id AND DependencyRoot.ticket_id = Dependency.id
    WHERE
        GroupMember.closed_at IS NULL
        AND  Dependency.closed_at IS NULL
        AND tickets.closed_at IS NULL
         AND EXISTS (
            SELECT 1
            FROM forward_transitions
            WHERE forward_transitions.entire_ticket_group
                AND forward_transitions.column_from = tickets.column_id
        )
    UNION
    -- 4. Additional group-level blocking for entire_ticket_group transitions
    SELECT DISTINCT tickets.id, Dependency.id AS depends_on_id, tickets.project_id FROM tickets
    JOIN ticket_roots AS ThisRoot ON ThisRoot.ticket_id = tickets.id
    JOIN ticket_roots AS GroupMemberRoot ON GroupMemberRoot.root_id = ThisRoot.root_id
    JOIN tickets AS GroupMember ON GroupMemberRoot.ticket_id = GroupMember.id
    JOIN ticket_dependencies AS BlockedByRelations ON (BlockedByRelations.relation_type = 'blocked_by' OR BlockedByRelations.relation_type = 'depends_on')
                    AND BlockedByRelations.ticket_id = GroupMember.id
    JOIN tickets AS Dependency ON BlockedByRelations.depends_on_id = Dependency.id
    JOIN ticket_roots AS DependencyRoot ON DependencyRoot.root_id != ThisRoot.root_id AND DependencyRoot.ticket_id = Dependency.id
    WHERE
        GroupMember.closed_at IS NULL
        AND  Dependency.closed_at IS NULL
        AND tickets.closed_at IS NULL
         AND EXISTS (
            SELECT 1
            FROM forward_transitions
            WHERE forward_transitions.entire_ticket_group
                AND forward_transitions.column_from = tickets.column_id
        )
    UNION
    -- 5. Parent blockers for single-ticket transitions (non-group)
    SELECT DISTINCT tickets.id AS ticket_id, Dependency.id AS depends_on_id, tickets.project_id FROM tickets
    JOIN kanban_columns AS TicketCol ON tickets.column_id = TicketCol.id
    JOIN tickets AS Dependency ON tickets.id = Dependency.parent_id
    JOIN kanban_columns AS DependencyCol ON Dependency.column_id = DependencyCol.id
    WHERE TicketCol.slug != 'human_feedback'
        AND Dependency.closed_at IS NULL
        AND tickets.closed_at IS NULL
        AND (DependencyCol."order" <= TicketCol."order" OR DependencyCol.slug = 'human_feedback')
        AND NOT EXISTS (
            SELECT 1
            FROM forward_transitions
            WHERE forward_transitions.entire_ticket_group
                AND forward_transitions.column_from = TicketCol.id
        );
