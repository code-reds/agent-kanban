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

Agent Kanban is a Kanban-based issue management system for AI agent teams. Work items (tickets) flow through columns representing stages of completion, from `todo` to `done`. Each agent role owns specific columns and collaborates by moving tickets forward and communicating via role-to-role messages.

## Column Flow

`todo → implementation → unit_review → integration_testing → final_review → done`

Any column can branch to `human_feedback` for human interaction.

Simple tickets (no children, no integration testing needed) may skip `integration_testing` and go `unit_review → done`.

## Team

| Role | Column | What they do |
|------|--------|--------------|
| **AI teamleader** | - | Oversees the project, coordinates between roles |
| **AI architect** | `todo` | Designs architecture, breaks features into tasks |
| **AI code developer** | `implementation` | Implements code for assigned tickets |
| **AI code reviewer** | `unit_review` | Reviews code quality, security, and standards |
| **AI integration tester** | `integration_testing` | Tests end-to-end workflows across components |
| **AI feature reviewer** | `final_review` | Performs final acceptance review |
| **Human User** | - | Your customer (customer is king). The one who specifies requirements and decides what to implement  |

Use `send_message` to coordinate with other roles. Get exact role names from `get_project_info`.

## Sub-tickets

Parent tickets can have child sub-tickets. Sub-tickets inherit the parent's column.

Sub-tickets advance independently through `implementation` and `unit_review`. At `todo`, `integration_testing`, and `final_review`, the entire group moves together as an **entire-group transition** — moving the parent automatically moves all children. 

### Moving a parent with children

- **Individual ticket columns** (`implementation`, `unit_review`): Tickets are processed individually in child-before-parent order.
- **Entire-group columns** (`todo`, `integration_testing`, `final_review`): All tickets of a group are processed together. Move the parent to the next column to move all children with it.

## Dependencies

| Type | Meaning |
|------|---------|
| `blocked_by` | This ticket must wait for the dependency to finish (move to `done`) |
| `depends_on` | The dependency must finish first before this ticket can proceed |
| `related` | Informational link only — does not affect blocking |

`blocked_by` and `depends_on` both cause blocking. Use `related` for tickets that are connected but don't need to wait for each other.

## Blocking Rules

A ticket is blocked when **any** of these conditions are true:

1. **External dependency** — It has a `blocked_by` or `depends_on` to a ticket that is still open and does NOT belong to the same top-level parent.

2. **Individual ticket column transitions:**

  - **Sibling dependency**  — It has a `blocked_by` or `depends_on` to a sibling (same top-level parent) that is **not at least one column ahead**.

   > "One column ahead" means: `implementation` is one ahead of `todo`, `unit_review` is two ahead of `todo`. Tickets in the **same** column are **not** one column ahead — they block each other.

  - **Unmoved children** — When moving a ticket that has sub-tickets, all sub-tickets must already be in the target column (or further ahead). 

3. **Entire-group transitions** — When moving a parent to `todo`, `integration_testing`, or `final_review`, all siblings must already be in that column (or further ahead). If any sibling is behind, the parent is blocked. Siblings do not block each other in theses columns because they move collectively. 


Getting ticket details or listing tickets will report the blocking tickets as well. 

### Tips

- Blocked tickets are hidden from `todo-list` and `not-blocked` modes — use `all` mode to see them.
- After moving a ticket, you get notified about tickets that were unblocked by the move. @Non-teamleader agents: mention unblocked tickets in your final summary to inform the teamleader about the state change. 

## Best Practices

1. Always read full ticket details (`get_ticket`) before acting on it.
2. Include a comment when moving tickets (audit trail).
3. Respect role boundaries — each role only acts on its assigned columns.
4. Re-check blocking state after moves — tickets may get blocked or unblock others.
5. Document all important information in ticket comments/descriptions. 
6. Make sure to address remarks, requirements and comments by the human user appropriately. 
