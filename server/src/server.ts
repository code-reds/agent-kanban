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

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Request, Response } from 'express';
import type http from 'http';
import projectsRouter from './api/projects.js';
import kanbanRouter from './api/kanban.js';
import ticketsRouter from './api/tickets.js';
import workflowRouter from './api/workflow.js';
import conversationsRouter from './api/conversations.js';
import rolesRouter from './api/roles.js';
import accessRulesRouter from './api/access-rules.js';
import tokensRouter from './api/tokens.js';
import sseRouter from './api/sse.js';
import globalSettingsRouter from './api/global-settings.js';
import { startMcpServer as _startMcpServer, stopMcpServer } from './mcp/server.js';
import { errorMessage } from './utils/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve web dist path, using process.resourcesPath in pkg environment
// @ts-ignore - resourcesPath is a runtime-only property in pkg
const pkgResources = (process as unknown as { resourcesPath?: string }).resourcesPath;
function getWebDistPath(): string {
  // In pkg/SEA, bundled assets are at process.resourcesPath/web/dist
  if (pkgResources) {
    const pkgPath = path.join(pkgResources, 'web', 'dist');
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
  }
  // In SEA (postject-injected), process.resourcesPath may be undefined.
  // Derive the resources directory from process.execPath (the executable itself).
  // The executable is at e.g. dist/agent-kanban, resources dir is dist/
  // WebUI is at dist/web/dist/
  if (process.execPath) {
    const exeDir = path.dirname(process.execPath);
    const seaPath = path.join(exeDir, 'web', 'dist');
    if (fs.existsSync(seaPath)) {
      return seaPath;
    }
  }
  // Fallback: resolve relative to source (development / compiled)
  return path.resolve(__dirname, '..', '..', 'web', 'dist');
}
const webDistPath = getWebDistPath();

const app = express();
const PORT = () => Number(process.env.PORT) || 3000;
const MCP_PORT = () => Number(process.env.MCP_PORT) || 3001;
const MCP_HOST = () => process.env.MCP_HOST || 'localhost';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/v1/server-info', (_req: Request, res: Response) => {
  res.json({
    restPort: PORT(),
    mcpPort: MCP_PORT(),
    mcpHost: MCP_HOST(),
  });
});

// Register API routes
app.use('/api/v1', projectsRouter);
app.use('/api/v1', kanbanRouter);
app.use('/api/v1', ticketsRouter);
app.use('/api/v1', workflowRouter);
app.use('/api/v1', conversationsRouter);
app.use('/api/v1', rolesRouter);
app.use('/api/v1', accessRulesRouter);
app.use('/api/v1', tokensRouter);
app.use('/api/v1', sseRouter);
app.use('/api/v1', globalSettingsRouter);

// Serve web frontend for non-API routes
app.use(express.static(webDistPath));
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(webDistPath, 'index.html'));
});

let server: ReturnType<typeof app.listen> | null = null;
let mcpServer: http.Server | null = null;

export function startServer(host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = PORT();
    const address = host ?? process.env.HOST ?? '0.0.0.0';
    // If the server is already running (shared singleton across test files), resolve immediately
    if (server && server.listening) {
      resolve();
      return;
    }
    server = app.listen(port, address, () => {
      const info = server?.address();
      const addr = typeof info === 'object' && info ? info.address : address;
      console.log(`Server running on http://${addr}:${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

export async function startMcpServer(): Promise<void> {
  const port = MCP_PORT();
  const host = MCP_HOST();
  
  try {
    mcpServer = await _startMcpServer(host, port);
  } catch (err) {
    console.error('Failed to start MCP server:', err);
  }
}

export function getServer(): ReturnType<typeof app.listen> | null {
  return server;
}

export function getMcpServer(): http.Server | null {
  return mcpServer;
}

import type { Application } from 'express';

export function getApp(): Application {
  return app;
}

export function stopServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      // Clear the server reference to prevent duplicate close attempts
      const currentServer = server;
      server = null;
      currentServer.close((err?: Error) => {
        if (err) {
          reject(new Error(errorMessage(err)));
        } else {
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

export async function stopMcp(): Promise<void> {
  await stopMcpServer();
  mcpServer = null;
}
