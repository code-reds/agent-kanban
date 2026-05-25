import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseArgs } from '../deploy-opencode.mjs';

// ── parseArgs: default values ────────────────────────────────────────────────

describe('parseArgs — defaults', () => {
  it('defaults server to undefined (not a string URL)', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.server, undefined, 'server should be undefined by default');
    assert.strictEqual(result.serverExplicit, false, 'serverExplicit should be false by default');
  });

  it('defaults slug to test-project', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.slug, 'test-project');
  });

  it('defaults port to null', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.port, null);
  });

  it('defaults host to null', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.host, null);
  });

  it('defaults templateDir to ./opencode-template', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.templateDir, './opencode-template');
  });

  it('defaults force to false', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.force, false);
  });

  it('defaults help to false', () => {
    const result = parseArgs(['--dir', '/tmp/test']);
    assert.strictEqual(result.help, false);
  });
});

// ── parseArgs: --server flag ─────────────────────────────────────────────────

describe('parseArgs — --server flag', () => {
  it('sets server to the provided URL', () => {
    const result = parseArgs(['--dir', '/tmp/test', '--server', 'http://custom:4000']);
    assert.strictEqual(result.server, 'http://custom:4000');
    assert.strictEqual(result.serverExplicit, true);
  });

  it('sets serverExplicit to true when --server is provided', () => {
    const result = parseArgs(['--dir', '/tmp/test', '--server', 'http://myhost:9999']);
    assert.strictEqual(result.serverExplicit, true);
  });
});

// ── parseArgs: --port flag ───────────────────────────────────────────────────

describe('parseArgs — --port flag', () => {
  it('sets port to the provided integer', () => {
    const result = parseArgs(['--dir', '/tmp/test', '--port', '8080']);
    assert.strictEqual(result.port, '8080');
  });
});

// ── parseArgs: --host flag ───────────────────────────────────────────────────

describe('parseArgs — --host flag', () => {
  it('sets host to the provided string', () => {
    const result = parseArgs(['--dir', '/tmp/test', '--host', 'myhost']);
    assert.strictEqual(result.host, 'myhost');
  });
});

// ── parseArgs: --dir flag ────────────────────────────────────────────────────

describe('parseArgs — --dir flag', () => {
  it('sets dir to the provided path', () => {
    const result = parseArgs(['--dir', '/tmp/my-project']);
    assert.strictEqual(result.dir, '/tmp/my-project');
  });
});

// ── parseArgs: --project / --slug alias ──────────────────────────────────────

describe('parseArgs — --project / --slug', () => {
  it('sets slug via --project', () => {
    const result = parseArgs(['--dir', '/tmp/test', '--project', 'my-app']);
    assert.strictEqual(result.slug, 'my-app');
  });

  it('sets slug via --slug alias', () => {
    const result = parseArgs(['--dir', '/tmp/test', '--slug', 'other-app']);
    assert.strictEqual(result.slug, 'other-app');
  });
});

// ── parseArgs: --force flags ─────────────────────────────────────────────────

describe('parseArgs — --force / --yes / -y', () => {
  it('sets force to true for --force', () => {
    assert.strictEqual(parseArgs(['--dir', '/tmp/test', '--force']).force, true);
  });

  it('sets force to true for --yes', () => {
    assert.strictEqual(parseArgs(['--dir', '/tmp/test', '--yes']).force, true);
  });

  it('sets force to true for -y', () => {
    assert.strictEqual(parseArgs(['--dir', '/tmp/test', '-y']).force, true);
  });
});

// ── parseArgs: --help flags ──────────────────────────────────────────────────

describe('parseArgs — --help / -h', () => {
  it('sets help to true for --help', () => {
    assert.strictEqual(parseArgs(['--dir', '/tmp/test', '--help']).help, true);
  });

  it('sets help to true for -h', () => {
    assert.strictEqual(parseArgs(['--dir', '/tmp/test', '-h']).help, true);
  });
});

// ── parseArgs: multiple flags together ───────────────────────────────────────

describe('parseArgs — multiple flags', () => {
  it('parses --server, --port, --host together (serverExplicit = true)', () => {
    const result = parseArgs([
      '--dir', '/tmp/test',
      '--server', 'http://override:5000',
      '--port', '8080',
      '--host', 'myhost',
    ]);
    assert.strictEqual(result.server, 'http://override:5000');
    assert.strictEqual(result.serverExplicit, true);
    assert.strictEqual(result.port, '8080');
    assert.strictEqual(result.host, 'myhost');
  });

  it('parses --port and --host together (serverExplicit = false)', () => {
    const result = parseArgs([
      '--dir', '/tmp/test',
      '--port', '9090',
      '--host', 'otherhost',
    ]);
    assert.strictEqual(result.server, undefined);
    assert.strictEqual(result.serverExplicit, false);
    assert.strictEqual(result.port, '9090');
    assert.strictEqual(result.host, 'otherhost');
  });
});
