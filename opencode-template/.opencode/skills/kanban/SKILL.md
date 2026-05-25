---
name: kanban
description: Collaborate in an agent team using Kanban-style ticket cards — list tickets, move them between columns, add comments, dependencies, and send role-to-role messages via MCP tools
license: MIT
compatibility: opencode
metadata:
  audience: all agents
  workflow: project-management
---

# Agent Kanban Skill

## What I do

This skill provides instructions for interacting with an **Agent Kanban** project board using MCP tools. Agent Kanban is a Kanban-based issue management system for AI agent teams, with role-based permissions and workflow transitions.
All interactions go through MCP tools — never direct HTTP calls. MCP enforces role-based permissions automatically.

## Column Flow

`todo → implementation → unit_review → integration_testing → final_review → done` with any column branching to `human_feedback` for human interaction.

For simple tickets that have no children and do not require integration testing, the *AI code reviewer* might choose the shorter path `todo → implementation → unit_review → done`. 

## Team structure and roles

### Roles

| Role | Associated Column | Description |
|------|-------------------|-------------|
| **Human User** | - | Full permissions for human users — can act across all columns |
| **AI teamleader** | - | Oversees the project, coordinates between roles, keeps progress moving |
| **AI architect** | `todo` | Designs architecture, breaks features into technical tasks |
| **AI code developer** | `implementation` | Implements code for assigned tickets |
| **AI code reviewer** | `unit_review` | Reviews code quality, security, and standards |
| **AI integration tester** | `integration_testing` | Tests end-to-end workflows across components |
| **AI feature reviewer** | `final_review` | Performs final acceptance review |

## Stage Descriptions

1. **todo** — Architecture and task design. AI architect breaks features into detailed tickets.
2. **implementation** — Code development. AI code developer implements the work.
3. **unit_review** — AI code tester writes/verifies unit tests; AI code reviewer checks quality and standards. Both must pass.
4. **integration_testing** — AI integration tester validates components work together. Processes a ticket group with top-level ticket and all children at once. This phase can only be started when all parent/child/sibling tickets arrived in that stage. 
5. **final_review** — AI feature reviewer verifies feature meets all requirements. Processes a ticket group with top-level ticket and all children at once. 
6. **done** — Ticket closed (`closed_at` set automatically).
7. **human_feedback** — Escalation to Human User or AI teamleader.

### Sub-tickets

Parent tickets can have child sub-tickets. Sub-tickets inherit the parent's column. Use the `parent_id` parameter when creating sub-tickets.


### Blocking and dependencies

Tickets are flagged as blocked if:
* There is a `blocked_by` or `depends_on` dependency where
  * the blocking ticket is still open and does not belong to the same top-level ticket, or
  * the blocking belong to the same top-level ticket and is not at least one column ahead of the dependent ticket.
* The transition is an entire-group transition and
  * there is another ticket of the ticket group (i.e., a ticket with the same top-level) that has not reached the current column, or
  * one of the tickets in the group is blocked by a `blocked_by` or `depends_on` dependency.
* The transition is NOT an entire-group transition and the ticket has children that were not yet moved to the next column. 

Tickets with `blocked_by` dependencies that have unresolved dependencies are excluded from `list_tickets` results in `todo-list` mode and `not-blocked` mode. This prevents agents from working on tickets they cannot start.

## AI Architect Sub-ticket Workflow

1. Create parent feature ticket in `todo`
2. Create sub-tickets for implementation tasks
3. Move parent to `implementation` when all sub-tickets are ready
4. Sub-tickets advance independently until `integration_testing`, where the entire ticket hierarchy must be move to before being able to proceed. 

## Best Practices

1. **Check role-specific tickets first** — `list_tickets()` shows only your role's tickets.
2. **Read full details** — always call `get_ticket` before acting.
3. **Add comments** — explain reasoning when moving tickets (audit trail).
4. **Respect role boundaries** — each role only acts on its columns. Use `send_message` for cross-role actions.
5. **Move with context** — always include a `comment`, especially backwards.
6. **Handling blocked tickets** — Blocked tickets should not be started until blocking tickets where resolved. Use `list_tickets({ mode: 'not-blocked' })` to find tickets that are not blocked and ready to start.
7. **Re-check blocking state after ticket moves** - when tickets they might get blocked themselves and/or unblock other tickets that were waiting for it. 
