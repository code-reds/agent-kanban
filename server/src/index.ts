// Agent Kanban - A Kanban-based issue management system for AI agent teams.
// Copyright (c) 2026
// Licensed under the GNU General Public License v3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//     https://www.gnu.org/licenses/gpl-3.0.html
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { getDb, closeDb } from './db/database.js';
import { runMigrations } from './db/migrations.js';
import { seedDefaultRoles, seedGlobalDefaults } from './db/seed.js';
import { startServer, startMcpServer } from './server.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8')
);

const DEFAULT_PORT = '3000';
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_DB = './agent-kanban.db';
const DEFAULT_MCP_PORT = '3001';
const DEFAULT_MCP_HOST = '0.0.0.0';

export function printHelp() {
  console.log(`
${pkg.name} v${pkg.version}

Usage:
  agent-kanban [options]

Options:
  --help, -h            Show this help message
  --version, -v         Show version number
  --port, -p <port>     Port to listen on (default: 3000)
  --host, -b <host>     Host to bind to (default: 0.0.0.0, use :: for IPv6)
  --db <path>           SQLite database path (default: ${DEFAULT_DB})
  --mcp-port, -m <port> MCP server port (default: 3001)
  --mcp-host <host>     MCP server host (default: 0.0.0.0)

Environment variables:
  AGENT_KANBAN_PORT     Port to listen on
  AGENT_KANBAN_HOST     Host to bind to
  AGENT_KANBAN_DB       SQLite database path
  MCP_PORT              MCP server port
  MCP_HOST              MCP server host

Description:
  Agent Kanban is a Kanban-based issue management system for AI agent teams.

Examples:
  agent-kanban
  AGENT_KANBAN_PORT=8080 agent-kanban
  agent-kanban --port 8080
  agent-kanban --host 127.0.0.1
  agent-kanban --host :: --port 8080
  agent-kanban --db /var/data/agent-kanban.db
  agent-kanban --mcp-port 3002
  agent-kanban --help
`);
  process.exit(0);
}

export function printVersion() {
  console.log(pkg.version);
  process.exit(0);
}

export function parseArgs() {
  const args = process.argv.slice(2);
  const cli: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
    }
    if (arg === '--version' || arg === '-v') {
      printVersion();
    }
    if (arg.startsWith('--port=') || arg.startsWith('-p=')) {
      cli.port = arg.split('=')[1];
    }
    if (arg === '--port' || arg === '-p') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) cli.port = next;
    }
    if (arg.startsWith('--host=') || arg.startsWith('-b=')) {
      cli.host = arg.split('=')[1];
    }
    if (arg === '--host' || arg === '-b') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) cli.host = next;
    }
    if (arg.startsWith('--db=')) {
      cli.db = arg.split('=')[1];
    }
    if (arg === '--db') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) cli.db = next;
    }
    if (arg.startsWith('--mcp-port=') || arg.startsWith('-m=')) {
      cli.mcpPort = arg.split('=')[1];
    }
    if (arg === '--mcp-port' || arg === '-m') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) cli.mcpPort = next;
    }
    if (arg.startsWith('--mcp-host=')) {
      cli.mcpHost = arg.split('=')[1];
    }
    if (arg === '--mcp-host') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) cli.mcpHost = next;
    }
  }

  // Priority: CLI args > environment variables > defaults
  process.env.PORT = cli.port ?? process.env.AGENT_KANBAN_PORT ?? process.env.PORT ?? DEFAULT_PORT;
  process.env.HOST = cli.host ?? process.env.AGENT_KANBAN_HOST ?? process.env.HOST ?? DEFAULT_HOST;
  process.env.DB_PATH = cli.db ?? process.env.AGENT_KANBAN_DB ?? process.env.DB_PATH ?? DEFAULT_DB;
  process.env.MCP_PORT = cli.mcpPort ?? process.env.MCP_PORT ?? DEFAULT_MCP_PORT;
  process.env.MCP_HOST = cli.mcpHost ?? process.env.MCP_HOST ?? DEFAULT_MCP_HOST;
}

parseArgs();

export async function main() {
  try {
    // Initialize database and run migrations
    console.log('Initializing database...');
    const db = getDb();
    runMigrations();

    // Seed default roles (idempotent)
    seedDefaultRoles();

    // Seed global defaults (idempotent) — columns, workflows, access rules with transition_allowed_roles
    seedGlobalDefaults();

    console.log('Database ready.');

    // Start the HTTP server
    await startServer();

    // Start the MCP server
    await startMcpServer();
  } catch (err) {
    console.error('Failed to start server:', err);
    closeDb();
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    closeDb();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    closeDb();
    process.exit(0);
  });
}

main();
