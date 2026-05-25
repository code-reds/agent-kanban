import path from 'path';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

let originalArgv: string[];

// ─── Module-level mocks for printHelp/printVersion/parseArgs tests ──────────
// These use vi.mock() factories which run at module graph construction

vi.mock('../db/database.js', () => {
  return {
    getDb: vi.fn(),
    closeDb: vi.fn(),
  };
});

vi.mock('../db/migrations.js', () => ({
  runMigrations: vi.fn(),
}));

vi.mock('../db/seed.js', () => ({
  seedDefaultRoles: vi.fn(),
}));

vi.mock('../server.js', () => ({
  startServer: vi.fn().mockResolvedValue(undefined),
  stopServer: vi.fn().mockResolvedValue(undefined),
  getApp: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), use: vi.fn() })),
  startMcpServer: vi.fn().mockResolvedValue(undefined),
  stopMcp: vi.fn().mockResolvedValue(undefined),
  getServer: vi.fn(() => null),
  getMcpServer: vi.fn(() => null),
}));

vi.mock('fs', () => {
  const f = require('fs');
  return Object.assign({}, f, {
    default: f,
    readFileSync: vi.fn(() => JSON.stringify({ name: 'agent-kanban', version: '1.0.0' })),
  });
});

vi.mock('path', () => {
  const p = require('path') as typeof import('path');
  return Object.assign({}, p, {
    default: p,
    resolve: (...a: string[]) => '/mocked/path/' + a.join('/'),
    dirname: () => '/mocked/dir',
    join: (...a: string[]) => a.join('/'),
  });
});

beforeAll(() => {
  originalArgv = process.argv.slice();
  vi.spyOn(process, 'exit').mockImplementation(
    (() => { /* no-op */ }) as never,
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = ['node', '/server/src/index.js'];
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  delete process.env.PORT;
  delete process.env.HOST;
  delete process.env.DB_PATH;
});

afterEach(() => {
  process.argv = originalArgv;
  [
    'AGENT_KANBAN_PORT',
    'AGENT_KANBAN_HOST',
    'AGENT_KANBAN_DB',
    'PORT',
    'HOST',
    'DB_PATH',
  ].forEach((k) => delete process.env[k]);
});

// ─── printHelp ───────────────────────────────────────────────────────────────

describe('printHelp()', () => {
  beforeEach(() => {
    process.argv = ['node', 'agent-kanban'];
  });

  it('outputs help text with version and calls process.exit(0)', async () => {
    await import('../index.js');
    vi.clearAllMocks();
    const mod = (await import('../index.js')) as any;
    mod.printHelp();
    expect(process.exit).toHaveBeenCalledWith(0);
    const { log } = console as any;
    const output = log.mock.calls[0][0] as string;
    expect(output).toContain('agent-kanban v1.0.0');
    expect(output).toContain('Usage:');
    expect(output).toContain('Options:');
    expect(output).toContain('Environment variables:');
    expect(output).toContain('Examples:');
  });
});

// ─── printVersion ────────────────────────────────────────────────────────────

describe('printVersion()', () => {
  beforeEach(() => {
    process.argv = ['node', 'agent-kanban'];
  });

  it('outputs version string and calls process.exit(0)', async () => {
    await import('../index.js');
    vi.clearAllMocks();
    const mod = (await import('../index.js')) as any;
    mod.printVersion();
    expect(process.exit).toHaveBeenCalledWith(0);
    const { log } = console as any;
    expect(log).toHaveBeenCalledWith('1.0.0');
  });
});

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe('parseArgs()', () => {
  beforeEach(() => {
    delete process.env.AGENT_KANBAN_PORT;
    delete process.env.AGENT_KANBAN_HOST;
    delete process.env.AGENT_KANBAN_DB;
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.DB_PATH;
  });

  it('no args uses defaults (PORT=3000, HOST=0.0.0.0)', async () => {
    await import('../index.js');
    expect(process.env.PORT).toBe('3000');
    expect(process.env.HOST).toBe('0.0.0.0');
  });

  it('--port 8080 sets PORT to 8080', async () => {
    process.argv = ['node', 'agent-kanban', '--port', '8080'];
    await import('../index.js');
    expect(process.env.PORT).toBe('8080');
  });

  it('-p 8080 sets PORT', async () => {
    process.argv = ['node', 'agent-kanban', '-p', '8080'];
    await import('../index.js');
    expect(process.env.PORT).toBe('8080');
  });

  it('--port=8080 (equals form) sets PORT', async () => {
    process.argv = ['node', 'agent-kanban', '--port=8080'];
    await import('../index.js');
    expect(process.env.PORT).toBe('8080');
  });

  it('--host 127.0.0.1 sets HOST', async () => {
    process.argv = ['node', 'agent-kanban', '--host', '127.0.0.1'];
    await import('../index.js');
    expect(process.env.HOST).toBe('127.0.0.1');
  });

  it('-b :: sets HOST', async () => {
    process.argv = ['node', 'agent-kanban', '-b', '::'];
    await import('../index.js');
    expect(process.env.HOST).toBe('::');
  });

  it('--db /tmp/test.db sets DB_PATH', async () => {
    process.argv = ['node', 'agent-kanban', '--db', '/tmp/test.db'];
    await import('../index.js');
    expect(process.env.DB_PATH).toBe('/tmp/test.db');
  });

  it('env var AGENT_KANBAN_PORT overrides default', async () => {
    process.env.AGENT_KANBAN_PORT = '9000';
    await import('../index.js');
    expect(process.env.PORT).toBe('9000');
  });

  it('CLI --port overrides env var AGENT_KANBAN_PORT', async () => {
    process.env.AGENT_KANBAN_PORT = '9000';
    process.argv = ['node', 'agent-kanban', '--port', '8080'];
    await import('../index.js');
    expect(process.env.PORT).toBe('8080');
  });

  it('env var AGENT_KANBAN_HOST overrides default', async () => {
    process.env.AGENT_KANBAN_HOST = '10.0.0.1';
    await import('../index.js');
    expect(process.env.HOST).toBe('10.0.0.1');
  });

  it('env var AGENT_KANBAN_DB overrides default', async () => {
    process.env.AGENT_KANBAN_DB = '/var/data/db.sqlite';
    await import('../index.js');
    expect(process.env.DB_PATH).toBe('/var/data/db.sqlite');
  });
});
