import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TokenService } from '../services/token-service.js';
import { HUMAN_USER_ROLE_NAME } from '../services/domain-validation.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

// Lazy-loaded archiver module (handles ESM/CJS interop)
let _archiverPromise: Promise<any> | null = null;

function getArchiver(): Promise<any> | null {
  if (!_archiverPromise) {
    _archiverPromise = import('archiver').then((mod) => (mod as any).default || mod);
  }
  return _archiverPromise;
}

const router = Router();

// Get the caller's role from query param or header
function getCallerRole(req: Request): string | null {
  return (req.query.role as string) || (req.headers['x-role'] as string) || null;
}

// Check if caller is Human User
function isHumanUser(req: Request): boolean {
  const role = getCallerRole(req);
  return role === HUMAN_USER_ROLE_NAME;
}

// GET /api/v1/projects/:slug/tokens - List all tokens for a project
router.get('/projects/:slug/tokens', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const project = getProjectBySlug(slug);

    if (!project) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    // Only allow Human User to list tokens with any access level
    if (!isHumanUser(req)) {
      return toJsonError(res, 'Only Human User can list tokens', 'PERMISSION_DENIED', 403);
    }

    const tokens = TokenService.list(project.id);
    toJsonSuccess(res, tokens);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/tokens - Create a new access token
router.post('/projects/:slug/tokens', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { role_id, description, expires_in } = req.body;

    // Only Human User can create tokens
    if (!isHumanUser(req)) {
      return toJsonError(res, 'Only Human User can create tokens', 'PERMISSION_DENIED', 403);
    }

    const project = getProjectBySlug(slug);
    if (!project) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    if (!role_id) {
      return toJsonError(res, 'role_id is required', 'VALIDATION_ERROR', 400);
    }

    const result = TokenService.create(project.id, role_id, description, expires_in);
    toJsonSuccess(res, result, 201);
  } catch (err) {
    const error = errorMessage(err);
    const status = error.includes('not found') ? 404 : 500;
    toJsonError(res, error, 'VALIDATION_ERROR', status);
  }
});

// DELETE /api/v1/projects/:slug/tokens/:id - Revoke a token
router.delete('/projects/:slug/tokens/:id', (req: Request, res: Response) => {
  try {
    // Only Human User can revoke tokens
    if (!isHumanUser(req)) {
      return toJsonError(res, 'Only Human User can revoke tokens', 'PERMISSION_DENIED', 403);
    }

    const { slug } = req.params as { slug: string };
    const tokenId = Number(req.params.id);

    const project = getProjectBySlug(slug);
    if (!project) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const result = TokenService.revoke(tokenId, project.id);
    toJsonSuccess(res, result);
  } catch (err) {
    const error = errorMessage(err);
    const code = error.includes('does not belong') ? 'CONFLICT' : 'NOT_FOUND';
    const status = code === 'CONFLICT' ? 409 : 404;
    toJsonError(res, error, code, status);
  }
});

// GET /api/v1/projects/:slug/tokens/:id/secret
router.get('/projects/:slug/tokens/:id/secret', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const tokenId = Number(req.params.id);

    // Only Human User can get plaintext tokens
    if (!isHumanUser(req)) {
      return toJsonError(res, 'Only Human User can retrieve plaintext tokens', 'PERMISSION_DENIED', 403);
    }

    const project = getProjectBySlug(slug);
    if (!project) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const result = TokenService.getSecret(tokenId, project.id);
    toJsonSuccess(res, result);
  } catch (err) {
    const error = errorMessage(err);
    const code = error.includes('does not belong') ? 'CONFLICT' : error.includes('not found') ? 'NOT_FOUND' : 'INTERNAL_ERROR';
    const status = code === 'CONFLICT' ? 409 : code === 'INTERNAL_ERROR' ? 500 : 404;
    toJsonError(res, error, code, status);
  }
});

// POST /api/v1/projects/:slug/opencode-config
router.post('/projects/:slug/opencode-config', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { serverPort, serverHost } = req.body || {};

    // Only Human User can generate opencode config
    if (!isHumanUser(req)) {
      return toJsonError(res, 'Only Human User can generate opencode config', 'PERMISSION_DENIED', 403);
    }

    const project = getProjectBySlug(slug);
    if (!project) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const tokens = TokenService.getAgentTokens(project.id, HUMAN_USER_ROLE_NAME);

    const serverHostVal = serverHost || 'localhost';
    const serverPortVal = serverPort !== undefined ? Number(serverPort) : (Number(process.env.MCP_PORT) || 3001);

    // Generate MCP connections and permission deny rules for each agent role
    const mcpServers: Record<string, Record<string, unknown>> = {};
    const permissions: Record<string, string> = {};

    for (const t of tokens) {
      const roleName = t.role_name.toLowerCase().replace(/\s+/g, '-');
      const serverName = `ak-${roleName}`;

      mcpServers[serverName] = {
        type: 'remote',
        url: `http://${serverHostVal}:${serverPortVal}/mcp`,
        enabled: true,
        oauth: false,
        headers: {
          Authorization: `Bearer ${t.token}`,
        },
        timeout: 30000,
      };

      // Deny MCP tools for agent roles (except teamleader, whose tools should remain available)
      if (t.role_name !== 'AI teamleader') {
        permissions[`${serverName}_*`] = 'deny';
      }
    }

    const config = {
      $schema: 'https://opencode.ai/config.json',
      mcp: mcpServers,
      permission: permissions,
    };

    toJsonSuccess(res, config, 200);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/opencode-config-zip
router.post('/projects/:slug/opencode-config-zip', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { serverPort, serverHost } = req.body || {};

    // Only Human User can generate opencode config ZIP
    if (!isHumanUser(req)) {
      return toJsonError(res, 'Only Human User can generate opencode config', 'PERMISSION_DENIED', 403);
    }

    const project = getProjectBySlug(slug);
    if (!project) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const tokens = TokenService.getAgentTokens(project.id, HUMAN_USER_ROLE_NAME);

    const serverHostVal = serverHost || 'localhost';
    const serverPortVal = serverPort !== undefined ? Number(serverPort) : (Number(process.env.MCP_PORT) || 3001);

    // Generate MCP connections and permission deny rules for each agent role
    const mcpServers: Record<string, Record<string, unknown>> = {};
    const permissions: Record<string, string> = {};

    for (const t of tokens) {
      const roleName = t.role_name.toLowerCase().replace(/\s+/g, '-');
      const serverName = `ak-${roleName}`;

      mcpServers[serverName] = {
        type: 'remote',
        url: `http://${serverHostVal}:${serverPortVal}/mcp`,
        enabled: true,
        oauth: false,
        headers: {
          Authorization: `Bearer ${t.token}`,
        },
        timeout: 30000,
      };

      // Deny MCP tools for agent roles (except teamleader, whose tools should remain available)
      if (t.role_name !== 'AI teamleader') {
        permissions[`${serverName}_*`] = 'deny';
      }
    }

    const config = {
      $schema: 'https://opencode.ai/config.json',
      mcp: mcpServers,
      permission: permissions,
    };

    const configJson = JSON.stringify(config, null, 2);

    // Load archiver module (lazily loaded for ESM/CJS compatibility)
    const archiverModule = await getArchiver();
    if (!archiverModule) {
      return toJsonError(res, 'ZIP library not available', 'INTERNAL_ERROR', 500);
    }

    const archive = new archiverModule.ZipArchive({ zlib: { level: 9 } });

    // Set headers for file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="opencode-config-${slug}.zip"`
    );

    // Pipe archive to response
    archive.pipe(res);

    // Recursively add all files from opencode-template/.opencode/
    // Resolve path relative to the monorepo root.
    // Handles pkg, SEA (Single Executable Application), and development environments.
    function resolveTemplateDir(): string {
      // pkg sets process.resourcesPath when running from a packaged executable
      // resourcesPath is a runtime-only property in pkg, not in Node types
      const rp = (process as unknown as { resourcesPath?: string }).resourcesPath;
      if (rp) {
        // In pkg, assets are extracted to process.resourcesPath preserving path relative to pkg.json
        // pkg.json is at monorepo root, so asset path opencode-template/.opencode/ → process.resourcesPath/opencode-template/.opencode/
        const pkgPath = path.join(rp, 'opencode-template', '.opencode');
        if (fs.existsSync(pkgPath)) {
          return pkgPath;
        }
      }

      // SEA (Single Executable Application): process.execPath points to the executable
      // In SEA, supporting files are placed alongside the executable (e.g., in dist/)
      // Go up 1 level from server/dist/ to dist/, then to opencode-template/.opencode/
      const execPath = process.execPath;
      if (execPath) {
        const exeDir = path.dirname(execPath);
        const seaPath = path.join(exeDir, 'opencode-template', '.opencode');
        if (fs.existsSync(seaPath)) {
          return seaPath;
        }
      }

      // Fallback: resolve relative to this file's directory (development / compiled)
      // In compiled output: __filename = server/dist/api/tokens.js
      // Go up 3 levels: api/ → dist/ → server/ → monorepo root
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const monorepoRoot = path.resolve(__dirname, '..', '..', '..');
      return path.resolve(monorepoRoot, 'opencode-template', '.opencode');
    }

    const templateDir = resolveTemplateDir();

    if (!fs.existsSync(templateDir)) {
      archive.destroy();
      return toJsonError(res, 'OpenCode template directory not found', 'INTERNAL_ERROR', 500);
    }

    // Register error handler BEFORE adding files so we catch errors during directory scan
    archive.on('error', (err: Error) => {
      if (!res.headersSent) {
        archive.destroy();
        toJsonError(res, `ZIP creation failed: ${errorMessage(err)}`, 'INTERNAL_ERROR', 500);
      }
    });

    archive.directory(templateDir, ".opencode");
    archive.append(configJson, { name: 'opencode.json' });

    try {
      await new Promise<void>((resolve, reject) => {
        archive.on('end', resolve);
        archive.on('error', reject);
        archive.finalize();
      });
    } catch (err) {
      if (!res.headersSent) {
        toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
      }
    }
  } catch (err) {
    if (!res.headersSent) {
      toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
    }
  }
});

export default router;
