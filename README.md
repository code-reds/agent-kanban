# Agent Kanban

A Kanban ticket board with MCP tool interface for autonomous AI coding agents. It helps organize tasks for AI agents into tickets and enforces quality assurance steps in a Kanban-style workflow, with a web-based UI for full editing and progress tracking.

**Designed to solve problems when AI agents work autonomously for longer periods:**
- Persistent tickets prevent forgotten tasks
- Explicit review and testing steps ensure code quality
- Backlog can be updated without interrupting current work

## Features

- **Kanban boards** with configurable workflows, ticket dependencies, and cascade moves
- **Embedded MCP server** — each agent gets its own session with role-specific permissions, no separate server processes
- **WebUI** for monitoring, project management, and settings
- **Global settings** — instance-wide defaults for columns, workflows, and access rules
- **Role-to-role messaging** between agents and humans


> [!WARNING]
> This tool is designed for machine-local development and **not** for hosting on network accessible servers. There is no authentication on WebUI or API. Do not host on network-accessible servers without adding network access restrictions.

> [!NOTE] 
> Disclaimer: This code base is 98% AI generated, still in an early testing stage, and not fully reviewed and tested manually. There might be undetected bugs and database backwards-compatibility might not be guaranteed in future versions.  

## Quick Start

```bash
npm install && npm run build && npm start
```

The server starts two endpoints:
- **HTTP + WebUI:** `http://localhost:3000` (REST API at `/api/v1/`, WebUI at `/`)
- **MCP Server:** `http://localhost:3001` (SSE-based MCP endpoint at `/api/v1/mcp`)


## Getting Started

1. **Create a project** — Open the WebUI and use "Create Project". The project is seeded with 7 Kanban columns, default workflow, access rules, and API tokens per role.

2. **Download OpenCode config** — When you use [OpenCode](https://opencode.ai/) as coding agent, the tool can generate a project-level configuration automatically: In a project's **Settings** page, click "Download ZIP". It contains agent definitions, the Kanban skill, and `opencode.json` with MCP connections.

3. **Extract the ZIP** into your project root (OpenCode's working directory). On restart, OpenCode registers 6 agent definitions with role-specific MCP connections and permission rules.
  - Creating a configuration for other coding agents based on the OpenCode configuration should be straight forward.  

4. **Use the board** — Either use the **Kanban Teamleader** agent (recommended for autonomous workflow: it manages tickets, spawns subagents, escalates blockers) or use OpenCode's built-in agents.

### Configuration 

Settings like the bind address, ports or the database path can be changed using the CLI or environment variables:

- **CLI:** `agent-kanban --port <port> --host <host> --db <path> --mcp-port <port> --mcp-host <host>`

- **Environment variables:** `AGENT_KANBAN_PORT`, `AGENT_KANBAN_HOST`, `AGENT_KANBAN_DB`, `MCP_PORT`, `MCP_HOST`

Defaults for newly created projects can be changed in the **Global settings menu** in the WebUI: columns, workflows, access rules, and role-column mappings.

## Workflow

### Default Column Setup

| Slug | Name |
|------|------|
| `human_feedback` | Human Feedback |
| `todo` | To Do |
| `implementation` | Implementation |
| `unit_review` | Unit Review |
| `integration_testing` | Integration Testing |
| `final_review` | Final Review |
| `done` | Done |

Moving a ticket to `done` closes it (sets `closed_at`).

### Default Roles

| Role | Columns |
|------|---------|
| Human User | All |
| AI teamleader | All (coordination) |
| AI architect | `todo` |
| AI code developer | `implementation` |
| AI code reviewer | `unit_review` |
| AI integration tester | `integration_testing` |
| AI feature reviewer | `final_review` |

### Column Transitions

The default ticket flow in the 7-stage Kanban workflow is: `todo → implementation → unit_review → integration_testing → final_review → done`.
The steps `integration_testing` and `final_review` are optional. The code reviewer decides if a ticket feature is complex enough to require integration testing. 

#### Cascade Moves

Transitions can have the `entire_ticket_group` flag enabled, which enforces a ticket to be moved together with all sub-tickets. In the default setup, this is e.g. used for transitions from `integration_testing` to make ensure that all sub-tickets of complex features are implemented and reviewed before integration testing. 

## Deployment

```bash
npm run build && npm run build:sea:linux   # SEA binary
docker build -t agent-kanban . && docker run -p 3000:3000 -p 3001:3001 -v ./data:/app/data:rw agent-kanban  # Containerized version
```

## Development

### Tech Stack

TypeScript / Node.js · Express.js · better-sqlite3 (WAL) · Vue 3 (Composition API, Pinia, Vue Router, Vite) · Embedded MCP via SSE · Vitest / Supertest / Playwright · esbuild

### Building, Testing, Linting

```bash
npm run build        # Build all packages
npm test             # All tests
npm run test:unit    # Unit tests only
npm run test:integration  # Integration tests only
npm run test:e2e     # E2E tests (requires running server)
npm run test:coverage # With coverage report
npm run lint         # Lint code
npm run format       # Format code
```

**Per-package:** `cd server && npm run build && npm test` / `cd web && npm run dev && npm run build && npm test`

**Coverage thresholds:** server ≥80%, web ≥70%. Each test suite uses a separate in-memory SQLite database.


## License

This code is licensed under a GPL-3.0 license. 
