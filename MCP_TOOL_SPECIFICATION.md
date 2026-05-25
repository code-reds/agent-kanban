# MCP Tool Specification

## Overview

This document provides a detailed specification of all MCP tools exposed by the Agent Kanban MCP server. Each tool is described with its purpose, parameters, return value, behavior, and permission requirements.

## Authentication

Each MCP client connects with an access token in the `initialize` request's `initializationOptions.projectAccessToken`.
The server validates the token, resolves the project and role, and applies permission checks to all tool calls at execution time.

- Tokens are **project-scoped** — one project per client
- Tokens are **role-bound** — each token maps to one role
- Tokens are **hashed at rest** — stored as SHA-256 hashes in the `api_tokens` table
- Tokens are validated once at session initialization; the resolved role is cached in the session for the connection lifetime

---

## General Behavior

All MCP tools follow this convention:

- **Input**: JSON object with tool-specific parameters (Zod schema validation)
- **Output**: MCP text content with JSON stringified structure:
  ```json
  {
    "success": true,
    "data": { ... }
  }
  ```
  or on failure:
  ```json
  {
    "success": false,
    "error": "Error message",
    "code": "ERROR_CODE"
  }
  ```
- **Permission Enforcement**: Every tool call is validated against the role resolved from the access token at the permission layer
- **Error Handling**: Invalid parameters return immediate errors without REST API calls
- **Response Format**: Each tool returns `{ type: 'text', text: JSON.stringify(result) }` (MCP standard format)

---

## Ticket Tools

### `list_tickets`

List tickets with optional filters and modes.

**Parameters:**
```json
{
  "mode": "string (optional, default: 'todo-list') — one of: 'todo-list', 'all', 'not-blocked', 'top-level-tickets'. todo-list: role-specific active work. all: every ticket. not-blocked: unblocked only. top-level-tickets: parent tickets.",
  "column": "string (optional) — column slug, e.g. 'todo'. Only used with 'all', 'not-blocked', or 'top-level-tickets' modes. Valid: todo, implementation, unit_review, integration_testing, final_review, done, human_feedback.",
  "priority": "integer (optional) — Filter by priority. 1=urgent, 2=high, 3=medium, 4=low, 5=trivial.",
  "labels": "string (optional) — Filter by labels. Pass a comma-separated list of label names to find tickets with any of those labels.",
  "parent_id": "integer (optional) — Filter by parent ticket ID. If provided, returns only sub-tickets of this parent. In todo-list mode, sub-tickets of matching parent tickets are also included.",
  "page": "integer (optional) — Page number for pagination. Default: 1. Each page returns up to per_page results.",
  "per_page": "integer (optional) — Number of results per page. Default: 20. Maximum: 100.",
  "sort_by": "string (optional) — Field to sort results by. Common values: priority, created_at, updated_at, title.",
  "sort_order": "string (optional) — Sort direction: 'asc' (ascending) or 'desc' (descending). Default: 'desc' for priority, 'asc' for dates.",
  "include_closed": "boolean (optional) — Include closed tickets in the results. Default: false (excludes closed tickets)."
}
```

**Behavior:**
- **todo-list mode (default)**: Returns role-specific active work. Unrestricted roles see all non-done/non-feedback columns. Restricted roles see only their assigned column. Automatically filters out blocked tickets. When `include_closed=true`, also includes the `done` column.
- **all mode**: Returns every ticket in the project with optional column/priority/labels filters.
- **not-blocked mode**: Returns only unblocked tickets.
- **top-level-tickets mode**: Returns only parent tickets (no sub-tasks).
- Enriched response includes `is_blocked` and `blocking_ticket_ids` fields.
- Results use `project_slug` and `column_slug` instead of numeric IDs.
- Description is suppressed in list responses to avoid context pollution.

**Return:**
```json
{
  "success": true,
  "data": {
    "tickets": [
      {
        "id": "integer",
        "title": "string",
        "column_slug": "string",
        "project_slug": "string",
        "priority": "integer",
        "labels": ["string"],
        "parent_id": "integer|null",
        "estimate": "number|null",
        "created_at": "ISO 8601",
        "updated_at": "ISO 8601",
        "is_blocked": "boolean",
        "blocking_ticket_ids": ["integer"]
      }
    ],
    "total": "integer",
    "mode": "string — the mode used for this query"
  }
}
```

**Permission:** Read access to the project; column-level access checks for `todo-list` mode.

---

### `get_ticket`

Get full details for a single ticket.

**Parameters:**
```json
{
  "id": "integer (required) — Ticket ID (integer). Use the id field from list_tickets results."
}
```

**Behavior:**
- Returns complete ticket information including status, description, labels, priority, comments, dependencies, and status history.
- Validates that the ticket exists and belongs to the project.
- Returns error if ticket not found.
- Response uses `project_slug` and `column_slug` instead of numeric IDs.
- Includes `is_blocked` and `blocking_ticket_ids` fields.
- **Comments** returned via `status_history` query include `ticket_id`, `author_role_id` (number), `author_role_name` (string|null), `content`, `action_type` (string|null), `action_details` (string|null), and `created_at`.

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "title": "string",
    "description": "string",
    "column_slug": "string",
    "project_slug": "string",
    "priority": "integer",
    "labels": ["string"],
    "parent_id": "integer|null",
    "estimate": "number|null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "closed_at": "ISO 8601|null",
    "comments": [
      {
        "id": "integer",
        "ticket_id": "integer",
        "author_role_id": "integer",
        "author_role_name": "string|null",
        "content": "string",
        "action_type": "string|null",
        "action_details": "string|null",
        "created_at": "ISO 8601"
      }
    ],
    "dependencies": [
      {
        "id": "integer",
        "ticket_id": "integer",
        "depends_on_id": "integer",
        "relation_type": "blocked_by|depends_on|related"
      }
    ],
    "status_history": [
      {
        "id": "integer",
        "ticket_id": "integer",
        "from_column_id": "integer",
        "to_column_id": "integer",
        "actor_role_id": "integer",
        "comment_id": "integer|null",
        "created_at": "ISO 8601"
      }
    ],
    "is_blocked": "boolean",
    "blocking_ticket_ids": ["integer"]
  }
}
```

**Permission:** Read access to the project (all roles have read access to their project).

---

### `create_ticket`

Create a new ticket in the Kanban board.

**Parameters:**
```json
{
  "title": "string (required) — Ticket title. Keep it concise but descriptive — aim for 5-50 words.",
  "description": "string (optional, default: '') — Ticket description. Use markdown for formatting.",
  "column": "string (required) — Target column slug. Valid: todo, implementation, unit_review, integration_testing, final_review, done, human_feedback.",
  "priority": "integer (optional) — Priority. 1=urgent, 2=high, 3=medium, 4=low, 5=trivial. If omitted for a child ticket (parent_id set), inherits from parent.",
  "labels": "string (optional, default: '[]') — Ticket labels as a JSON array of strings, e.g. '[\"bug\", \"frontend\", \"api\"]'. Default: empty array.",
  "estimate": "number (optional) — Time estimate for completion. Can be hours or story points.",
  "parent_id": "integer|null (optional) — Parent ticket ID. If set to a valid ticket ID, creates a sub-task under that parent. If set to null or omitted, creates a top-level ticket. Sub-tasks inherit the parent's column."
}
```

**Behavior:**
- Creates ticket in specified column (agents typically restricted to `todo` column per access rules).
- If `parent_id` provided, creates a sub-task.
- Validates column slug exists and role has create permission.
- Returns newly created ticket with assigned ID.

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "title": "string",
    "column_slug": "string",
    "project_slug": "string",
    "priority": "integer",
    "labels": ["string"],
    "parent_id": "integer|null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
}
```

**Permission:** Role must have `create_ticket` permission for the target column.

---

### `update_ticket`

Update ticket fields without changing its column.

**Parameters:**
```json
{
  "id": "integer (required) — Ticket ID. The integer ID of the ticket to update.",
  "title": "string (optional) — New title.",
  "description": "string (optional) — New description. Use markdown for formatting.",
  "priority": "integer (optional) — New priority. 1=urgent, 2=high, 3=medium, 4=low, 5=trivial.",
  "labels": "string (optional) — New labels as a JSON array of strings, e.g. '[\"bug\", \"urgent\"]'. Replaces all existing labels.",
  "estimate": "number (optional) — New estimate. Hours or story points for the ticket.",
  "parent_id": "integer|null (optional) — Parent ticket ID. Set to a valid ticket ID to make this a sub-task. Set to null to make it a top-level ticket."
}
```

**Behavior:**
- Updates only provided fields (partial update).
- Does NOT change column (use `move_ticket` for that).
- Validates ticket exists and role has edit permission for the ticket's current column.
- Can change a ticket's parent by setting `parent_id` to another ticket's ID (creates sub-task) or null (top-level ticket).

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "title": "string",
    "description": "string",
    "column_slug": "string",
    "project_slug": "string",
    "priority": "integer",
    "labels": ["string"],
    "parent_id": "integer|null",
    "estimate": "number|null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
}
```

**Permission:** Role must have `update_ticket` permission for the ticket's current column.

---

### `move_ticket`

Move a ticket to a different column.

**Parameters:**
```json
{
  "id": "integer (required) — Ticket ID. The integer ID of the ticket to move.",
  "to_column": "string (required) — Target column slug. Valid: todo, implementation, unit_review, integration_testing, final_review, done, human_feedback. Moving to 'done' closes the ticket.",
  "comment": "string (optional) — Move comment (optional but required for some transitions). Explain what changed and why."
}
```

**Behavior:**
- Validates the from→to transition (by column slug) is allowed for the role.
- If moving to `done` column, automatically sets `closed_at` timestamp (closes the ticket).
- If workflow requires a comment for the transition, returns error if not provided.
- Updates status history with the transition.
- Returns information about any tickets that were unblocked by this move.

**Return:**
```json
{
  "success": true,
  "data": {
    "moved": true,
    "ticket_id": "integer",
    "to_column": "string",
    "new_status": {
      "column_slug": "string",
      "is_blocked": "boolean",
      "blocking_ticket_ids": ["integer"],
      "tickets_unblocked_by_this_move": ["integer"]
    }
  }
}
```

**Permission:** Role must have `edit` permission for the source column, and the workflow transition must be allowed.

---

### `add_comment`

Add a markdown-formatted comment to a ticket.

**Parameters:**
```json
{
  "ticket_id": "integer (required) — Ticket ID. The integer ID of the ticket to comment on.",
  "content": "string (required) — Comment content. Use markdown for formatting. Part of the ticket's permanent history."
}
```

**Behavior:**
- Adds comment to ticket.
- Records comment author as the current MCP role.
- Updates ticket's `updated_at` timestamp.
- Comments are visible to all roles and create an audit trail.

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "ticket_id": "integer",
    "author_role_id": "integer",
    "author_role_name": "string|null",
    "content": "string",
    "action_type": "string|null",
    "action_details": "string|null",
    "created_at": "ISO 8601"
  }
}
```

**Permission:** Role must have `add_comment` permission for the ticket's current column.

---

### `add_dependency`

Create a dependency between two tickets in the same project.

**Parameters:**
```json
{
  "ticket_id": "integer (required) — The ticket that has the dependency. This is the 'child' ticket.",
  "depends_on_id": "integer (required) — Dependency ticket ID. The ticket this one depends on. This must be a valid ticket ID from the same project.",
  "relation_type": "string (required) — 'blocked_by' (this ticket must wait for the dependency), 'depends_on' (the dependency must finish first), or 'related' (informational link only)."
}
```

**Behavior:**
- Creates dependency relationship.
- Validates both tickets exist and belong to the same project.
- Prevents circular dependencies.
- Returns error if relationship already exists.

**Return:**
```json
{
  "success": true,
  "data": {
    "added": true,
    "ticket_id": "integer",
    "depends_on_id": "integer",
    "relation_type": "string"
  }
}
```

**Permission:** Role must have `add_dependency` permission for the ticket's current column.

---

### `remove_dependency`

Remove an existing dependency between two tickets.

**Parameters:**
```json
{
  "ticket_id": "integer (required) — The ticket whose dependency should be removed.",
  "depends_on_id": "integer (required) — Dependency ticket ID. The ticket that was the dependency. Must match the original dependency exactly.",
  "relation_type": "string (required) — Must match the original dependency type exactly: 'blocked_by', 'depends_on', or 'related'."
}
```

**Behavior:**
- Removes specified dependency relationship.
- Requires that the dependency exists.
- Returns error if relationship doesn't exist.

**Return:**
```json
{
  "success": true,
  "data": {
    "removed": true,
    "ticket_id": "integer",
    "depends_on_id": "integer"
  }
}
```

**Permission:** Role must have `remove_dependency` permission for the ticket's current column.

---

### `list_dependencies`

List all dependency relationships for a ticket, grouped by type.

**Parameters:**
```json
{
  "ticket_id": "integer (required) — The integer ID of the ticket to list dependencies for."
}
```

**Behavior:**
- Returns all dependency relationships for the ticket.
- Each dependency entry includes `is_blocking` flag indicating whether the dependency is blocking the ticket.

**Return:**
```json
{
  "success": true,
  "data": [
    {
      "ticket_id": "integer",
      "depends_on_id": "integer",
      "relation_type": "blocked_by|depends_on|related",
      "is_blocking": "boolean"
    }
  ]
}
```

**Permission:** Role must have `list_dependencies` permission for the ticket's current column (all roles have read access to their project).

---

## Conversation Tools

### `list_conversations`

List all conversations (role-to-role messaging pairs) for this project.

**Parameters:**
```json
{} (no parameters)
```

**Behavior:**
- Returns all conversations (role pairs) for the project.
- Each conversation represents a unique pair of roles communicating with each other.
- Returns role IDs (`from_role_id`, `to_role_id`) and role names (`from_role_name`, `to_role_name`) directly from the database query.

**Return:**
```json
{
  "success": true,
  "data": [
    {
      "id": "integer",
      "project_id": "integer",
      "from_role_id": "integer",
      "to_role_id": "integer",
      "from_role_name": "string",
      "to_role_name": "string"
    }
  ]
}
```

**Permission:** All roles (all roles have read access to their project).

---

### `get_conversation`

Get messages from a specific conversation.

**Parameters:**
```json
{
  "conversation_id": "integer (required) — Conversation ID. The integer ID of the conversation to retrieve. Get this from list_conversations results.",
  "limit": "integer (optional) — Maximum number of messages to return. Default: 50. Use to retrieve older messages by calling multiple times with increasing offsets. Maximum: 200."
}
```

**Behavior:**
- Returns messages in the conversation.
- Messages are returned in chronological order (oldest first).
- Supports pagination with the `limit` parameter.
- To get older messages, call multiple times with increasing offsets.
- The conversation object includes `project_id`, `from_role_id`, `to_role_id`, `from_role_name`, and `to_role_name`.
- Each message includes `sender_role_id` (number), `sender_role_name` (string), `conversation_id`, `content`, and `created_at`.

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "project_id": "integer",
    "from_role_id": "integer",
    "to_role_id": "integer",
    "from_role_name": "string",
    "to_role_name": "string",
    "messages": [
      {
        "id": "integer",
        "conversation_id": "integer",
        "sender_role_id": "integer",
        "sender_role_name": "string",
        "content": "string",
        "created_at": "ISO 8601"
      }
    ]
  }
}
```

**Permission:** All roles (all roles have read access to their project).

---

### `send_message`

Send a message to a role. Creates a conversation between roles if one does not already exist.

**Parameters:**
```json
{
  "to_role": "string (required) — Target role name. The name of the role to send the message to. Use role names like 'AI code developer', 'AI teamleader', 'Human User', etc. Get the exact role names from get_project_info.",
  "content": "string (required) — Message text. Supports markdown formatting. Be clear and specific about what you need or what you found."
}
```

**Behavior:**
- Creates conversation if one doesn't exist between roles.
- Returns the sent message with assigned ID.
- Validates `to_role` exists for the project.
- Messages support markdown formatting.
- The message object includes `sender_role_id` (number) and `sender_role_name` (string) instead of `author_role`.

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "conversation_id": "integer",
    "sender_role_id": "integer",
    "sender_role_name": "string",
    "content": "string",
    "created_at": "ISO 8601"
  }
}
```

**Permission:** All roles (all roles have read access to their project).

---

### `fetch_unread`

Get unread messages from all conversations. Messages are automatically marked as read when returned.

**Parameters:**
```json
{
  "limit": "integer (optional, default: 1) — Max messages to return. Default: 1 (recommended for agents processing messages one at a time). Set to 0 to return all remaining unread messages at once. Set to N to return up to N messages."
}
```

**Behavior:**
- Returns unread messages from all conversations.
- Messages are automatically marked as read when returned (no separate mark-read needed).
- `limit=1` (default): Returns one message at a time (recommended pattern for agents).
- `limit=0`: Returns all remaining unread messages at once.
- `limit=n`: Returns up to `n` unread messages.
- Messages are sorted by creation time (ascending).
- Each message includes `sender_role_id` (number), `sender_role_name` (string), and `conversation_id`.

**Return:**
```json
{
  "success": true,
  "data": [
    {
      "id": "integer",
      "conversation_id": "integer",
      "sender_role_id": "integer",
      "sender_role_name": "string",
      "content": "string",
      "created_at": "ISO 8601"
    }
  ],
  "fetched_until_id": "integer|null — The highest message ID returned (for tracking progress)"
}
```

**Permission:** All roles.

---

## Project Tools

### `get_project_info`

Get project details including columns, roles, workflow transitions, and access rules.

**Parameters:**
```json
{} (no parameters)
```

**Behavior:**
- Returns comprehensive project information with all relations loaded.
- **Columns**: Each column includes `id`, `project_id`, `slug`, `name`, `order`, and `is_default`.
- **Roles**: Each role includes `id`, `name`, `description`, and `access_level`.
- **Workflows (transitions)**: Each transition is a full object with `id`, `project_id`, `column_from` (column ID), `column_to` (column ID), `requires_comment`, `entire_ticket_group`, `from_slug`, `to_slug`, and `allowed_role_ids` (comma-separated string of role IDs).
- **Access rules**: Each rule includes `id`, `project_id`, `column_id`, `role_id`, `action_type`, and `column_slug`.

**Return:**
```json
{
  "success": true,
  "data": {
    "id": "integer",
    "slug": "string",
    "name": "string",
    "description": "string|null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "columns": [
      {
        "id": "integer",
        "project_id": "integer",
        "slug": "string — column slug (e.g. 'todo')",
        "name": "string",
        "order": "integer",
        "is_default": "integer"
      }
    ],
    "roles": [
      {
        "id": "integer",
        "name": "string",
        "description": "string|null",
        "access_level": "string|null"
      }
    ],
    "workflows": [
      {
        "id": "integer",
        "project_id": "integer",
        "column_from": "integer — source column ID",
        "column_to": "integer — target column ID",
        "requires_comment": "integer (0 or 1)",
        "entire_ticket_group": "integer (0 or 1)",
        "from_slug": "string — source column slug",
        "to_slug": "string — target column slug",
        "allowed_role_ids": "string — comma-separated list of role IDs"
      }
    ],
    "access_rules": [
      {
        "id": "integer",
        "project_id": "integer",
        "column_id": "integer",
        "role_id": "integer",
        "action_type": "string — create|edit|delete",
        "column_slug": "string — column slug"
      }
    ]
  }
}
```

**Permission:** All roles (all roles have read access to their project).

---

### `get_my_role`

Get the current role identity and project context.

**Parameters:**
```json
{} (no parameters)
```

**Behavior:**
- Returns the role baked into this MCP server process.
- Includes both role identity and project context.
- Useful for debugging and self-awareness.

**Return:**
```json
{
  "success": true,
  "data": {
    "role": {
      "id": "integer",
      "name": "string"
    },
    "project": {
      "id": "integer",
      "slug": "string"
    }
  }
}
```

**Permission:** All roles.

---

## Error Handling

All tools return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Error Code | Meaning |
|------------|---------|
| `AUTH_FAILED` | Access token is missing, invalid, expired, or revoked |
| `PERMISSION_DENIED` | Role lacks permission for the requested action |
| `INVALID_PARAMETER` | Required parameter missing or invalid |
| `NOT_FOUND` | Referenced ticket/conversation/role not found |
| `VALIDATION_ERROR` | Business logic validation failed (e.g., circular dependency, missing comment) |
| `WORKFLOW_ERROR` | Workflow rules prevent the action |
| `INTERNAL_ERROR` | Internal server error (e.g., invalid column reference) |

---

## Unread Messages Flow

The recommended pattern for agents:

```
Agent MCP starts
  → fetch_unread(limit=1) → returns one unread message
  → process message
  → fetch_unread(limit=1) → returns next unread message
  → continue until no more unread messages

For batch processing:
  → fetch_unread(limit=0) → returns all remaining unread messages
  → process all messages
```

This gives agents fine-grained control over message processing speed. Default `limit=1` ensures agents don't get overwhelmed with large message batches.

---

## Permission Model

The MCP server organizes tools into three functional groups, all registered at startup for every connected client:

| Tool Group | Tools |
|------------|-------|
| `tickets` | `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `move_ticket`, `add_comment`, `add_dependency`, `remove_dependency`, `list_dependencies` |
| `conversations` | `list_conversations`, `get_conversation`, `send_message`, `fetch_unread` |
| `project` | `get_project_info`, `get_my_role` |

Permission enforcement happens at the **permission layer** using the role resolved from the access token at session initialization. The three-level validation model:

1. **MCP layer** — Tool group membership (all tools are available to all clients; group membership is for organization only)
2. **Permission layer** — Role-based column access checks via `ticket_access_rules` and workflow transition checks via `workflow_transitions`
3. **Workflow layer** — Transition validation (comment requirements, allowed from→to column pairs)

Permission checks occur before any service layer calls. Invalid tool calls are rejected immediately by the MCP server.

---

## Column Reference

Valid column slugs used across all tools:

| Column Slug | Description |
|-------------|-------------|
| `todo` | Backlog / To Do |
| `implementation` | In Progress / Implementation |
| `unit_review` | Awaiting Unit Review |
| `integration_testing` | Integration Testing |
| `final_review` | Final Review |
| `done` | Done / Closed |
| `human_feedback` | Awaiting Human Feedback |

### Workflow Transitions

| From | To | Comment Required |
|------|-----|-----------------|
| `todo` | `implementation` | No |
| `implementation` | `unit_review` | No |
| `unit_review` | `implementation` | No |
| `unit_review` | `integration_testing` | No |
| `integration_testing` | `implementation` | No |
| `integration_testing` | `final_review` | No |
| `final_review` | `implementation` | No |
| `final_review` | `done` | No |
| Any column | `done` | No (closes ticket) |
| `done` | `implementation` | Yes (re-opens ticket, Human User only) |
| Any column | `human_feedback` | No |
| `human_feedback` | `implementation` | No |

---

## Priority Reference

| Priority | Level |
|----------|-------|
| 1 | Urgent |
| 2 | High |
| 3 | Medium |
| 4 | Low |
| 5 | Trivial |

(End of file - total 562 lines)
