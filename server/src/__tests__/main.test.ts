import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
  runMigrations: vi.fn(),
  seedDefaultRoles: vi.fn(),
  startServer: vi.fn().mockResolvedValue(undefined),
}));

// Module-level mocks - use paths relative to server/src/ to match index.ts imports
vi.mock('../db/database.js', () => spies);
vi.mock('../db/migrations.js', () => ({ runMigrations: spies.runMigrations }));
vi.mock('../db/seed.js', () => ({
  seedDefaultRoles: spies.seedDefaultRoles,
  seedGlobalDefaults: vi.fn(),
}));
vi.mock('../server.js', () => ({
  startServer: spies.startServer,
  startMcpServer: vi.fn(),
}));
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ name: 'agent-kanban', version: '1.0.0' })),
}));
vi.mock('path', () => {
  const p = require('path') as typeof import('path');
  return Object.assign({}, p, {
    default: p,
    resolve: (...a: string[]) => '/mocked/path/' + a.join('/'),
    dirname: () => '/mocked/dir',
    join: (...a: string[]) => a.join('/'),
  });
});

let originalArgv: string[];

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
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  delete process.env.PORT;
  delete process.env.HOST;
  delete process.env.DB_PATH;
  delete process.env.AGENT_KANBAN_PORT;
  delete process.env.AGENT_KANBAN_HOST;
  delete process.env.AGENT_KANBAN_DB;
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

// ─── main() ──────────────────────────────────────────────────────────────────

describe('main()', () => {
  it('happy path: calls getDb, migrations, seed, startServer', async () => {
    await import('../index.js');

    expect(spies.getDb).toHaveBeenCalled();
    expect(spies.runMigrations).toHaveBeenCalled();
    expect(spies.seedDefaultRoles).toHaveBeenCalled();
    expect(spies.startServer).toHaveBeenCalled();
    expect(spies.closeDb).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('error path: logs error, closes DB, exits with code 1', async () => {
    const err = new Error('connection refused');
    spies.runMigrations.mockImplementation(() => { throw err; });

    await import('../index.js');

    const { error } = console as any;
    expect(error).toHaveBeenCalledWith('Failed to start server:', err);
    expect(spies.closeDb).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('SIGINT handler closes DB and exits 0', async () => {
    await import('../index.js');

    process.emit('SIGINT');
    expect(spies.closeDb).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('SIGTERM handler closes DB and exits 0', async () => {
    await import('../index.js');

    process.emit('SIGTERM');
    expect(spies.closeDb).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
