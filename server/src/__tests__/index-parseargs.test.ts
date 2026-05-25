import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the side effects of importing index.js before importing it
vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));
vi.mock('../db/migrations.js', () => ({
  runMigrations: vi.fn(),
}));
vi.mock('../db/seed.js', () => ({
  seedDefaultRoles: vi.fn(),
  seedGlobalDefaults: vi.fn(),
}));
vi.mock('../server.js', () => ({
  startServer: vi.fn(() => Promise.resolve()),
  startMcpServer: vi.fn(() => Promise.resolve()),
}));

import { parseArgs } from '../index.js';

describe('parseArgs', () => {
  const originalEnv = { ...process.env };
  const originalArgv = process.argv;

  beforeEach(() => {
    // Clear all relevant env vars before each test
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.DB_PATH;
    delete process.env.MCP_PORT;
    delete process.env.MCP_HOST;
    delete process.env.AGENT_KANBAN_PORT;
    delete process.env.AGENT_KANBAN_HOST;
    delete process.env.AGENT_KANBAN_DB;
  });

  afterEach(() => {
    // Restore original env and argv
    Object.keys(process.env).forEach((key) => {
      if (['PORT', 'HOST', 'DB_PATH', 'MCP_PORT', 'MCP_HOST', 'AGENT_KANBAN_PORT', 'AGENT_KANBAN_HOST', 'AGENT_KANBAN_DB'].includes(key)) {
        delete process.env[key];
      }
    });
    // Restore env from backup
    Object.assign(process.env, originalEnv);
    process.argv = originalArgv;
  });

  describe('CLI argument parsing', () => {
    it('should parse --port argument', () => {
      process.argv = ['node', 'server', '--port', '8080'];
      parseArgs();
      expect(process.env.PORT).toBe('8080');
    });

    it('should parse --port= syntax', () => {
      process.argv = ['node', 'server', '--port=9090'];
      parseArgs();
      expect(process.env.PORT).toBe('9090');
    });

    it('should parse -p short flag', () => {
      process.argv = ['node', 'server', '-p', '7070'];
      parseArgs();
      expect(process.env.PORT).toBe('7070');
    });

    it('should parse --host argument', () => {
      process.argv = ['node', 'server', '--host', '127.0.0.1'];
      parseArgs();
      expect(process.env.HOST).toBe('127.0.0.1');
    });

    it('should parse --host= syntax', () => {
      process.argv = ['node', 'server', '--host=0.0.0.0'];
      parseArgs();
      expect(process.env.HOST).toBe('0.0.0.0');
    });

    it('should parse -b short flag', () => {
      process.argv = ['node', 'server', '-b', '0.0.0.0'];
      parseArgs();
      expect(process.env.HOST).toBe('0.0.0.0');
    });

    it('should parse --db argument', () => {
      process.argv = ['node', 'server', '--db', '/var/data/test.db'];
      parseArgs();
      expect(process.env.DB_PATH).toBe('/var/data/test.db');
    });

    it('should parse --db= syntax', () => {
      process.argv = ['node', 'server', '--db=/tmp/test.db'];
      parseArgs();
      expect(process.env.DB_PATH).toBe('/tmp/test.db');
    });

    it('should parse --mcp-port argument', () => {
      process.argv = ['node', 'server', '--mcp-port', '3002'];
      parseArgs();
      expect(process.env.MCP_PORT).toBe('3002');
    });

    it('should parse --mcp-port= syntax', () => {
      process.argv = ['node', 'server', '--mcp-port=4000'];
      parseArgs();
      expect(process.env.MCP_PORT).toBe('4000');
    });

    it('should parse -m short flag', () => {
      process.argv = ['node', 'server', '-m', '4000'];
      parseArgs();
      expect(process.env.MCP_PORT).toBe('4000');
    });

    it('should parse --mcp-host argument', () => {
      process.argv = ['node', 'server', '--mcp-host', '192.168.1.1'];
      parseArgs();
      expect(process.env.MCP_HOST).toBe('192.168.1.1');
    });

    it('should parse --mcp-host= syntax', () => {
      process.argv = ['node', 'server', '--mcp-host=0.0.0.0'];
      parseArgs();
      expect(process.env.MCP_HOST).toBe('0.0.0.0');
    });

    it('should handle multiple arguments at once', () => {
      process.argv = ['node', 'server', '--port', '8080', '--host', '0.0.0.0', '--db', '/tmp/test.db', '--mcp-port', '3002'];
      parseArgs();
      expect(process.env.PORT).toBe('8080');
      expect(process.env.HOST).toBe('0.0.0.0');
      expect(process.env.DB_PATH).toBe('/tmp/test.db');
      expect(process.env.MCP_PORT).toBe('3002');
    });
  });

  describe('environment variable fallback', () => {
    it('should use AGENT_KANBAN_PORT when PORT not set and CLI arg missing', () => {
      process.env.AGENT_KANBAN_PORT = '5000';
      parseArgs();
      expect(process.env.PORT).toBe('5000');
    });

    it('should use AGENT_KANBAN_HOST when HOST not set and CLI arg missing', () => {
      process.env.AGENT_KANBAN_HOST = '127.0.0.1';
      parseArgs();
      expect(process.env.HOST).toBe('127.0.0.1');
    });

    it('should use AGENT_KANBAN_DB when DB_PATH not set and CLI arg missing', () => {
      process.env.AGENT_KANBAN_DB = '/var/data/fallback.db';
      parseArgs();
      expect(process.env.DB_PATH).toBe('/var/data/fallback.db');
    });

    it('should use MCP_PORT env var for MCP_PORT', () => {
      process.env.MCP_PORT = '6000';
      parseArgs();
      expect(process.env.MCP_PORT).toBe('6000');
    });

    it('should use MCP_HOST env var for MCP_HOST', () => {
      process.env.MCP_HOST = '10.0.0.1';
      parseArgs();
      expect(process.env.MCP_HOST).toBe('10.0.0.1');
    });

    it('should prioritize CLI args over environment variables', () => {
      process.env.PORT = '5000';
      process.argv = ['node', 'server', '--port', '8080'];
      parseArgs();
      expect(process.env.PORT).toBe('8080');
    });

    it('should prioritize environment over defaults', () => {
      process.env.PORT = '6000';
      parseArgs();
      expect(process.env.PORT).toBe('6000');
    });
  });

  describe('defaults', () => {
    it('should default to PORT 3000', () => {
      parseArgs();
      expect(process.env.PORT).toBe('3000');
    });

    it('should default to HOST 0.0.0.0', () => {
      parseArgs();
      expect(process.env.HOST).toBe('0.0.0.0');
    });

    it('should default to DB_PATH ./agent-kanban.db', () => {
      parseArgs();
      expect(process.env.DB_PATH).toBe('./agent-kanban.db');
    });

    it('should default to MCP_PORT 3001', () => {
      parseArgs();
      expect(process.env.MCP_PORT).toBe('3001');
    });

    it('should default to MCP_HOST 0.0.0.0', () => {
      parseArgs();
      expect(process.env.MCP_HOST).toBe('0.0.0.0');
    });
  });

  describe('edge cases', () => {
    it('should handle empty argv', () => {
      process.argv = ['node', 'server'];
      parseArgs();
      expect(process.env.PORT).toBe('3000');
    });

    it('should handle unknown CLI flags gracefully', () => {
      process.argv = ['node', 'server', '--unknown-flag', 'value', '--port', '8080'];
      parseArgs();
      expect(process.env.PORT).toBe('8080');
    });

    it('should handle -p without value', () => {
      process.argv = ['node', 'server', '-p'];
      parseArgs();
      expect(process.env.PORT).toBe('3000');
    });

    it('should handle --port without value', () => {
      process.argv = ['node', 'server', '--port'];
      parseArgs();
      expect(process.env.PORT).toBe('3000');
    });

    it('should handle -b without value', () => {
      process.argv = ['node', 'server', '-b'];
      parseArgs();
      expect(process.env.HOST).toBe('0.0.0.0');
    });

    it('should call printHelp and exit when -h flag is passed', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      process.argv = ['node', 'server', '-h'];
      expect(() => parseArgs()).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    it('should call printHelp and exit when --help flag is passed', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      process.argv = ['node', 'server', '--help'];
      expect(() => parseArgs()).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    it('should call printVersion and exit when -v flag is passed', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      process.argv = ['node', 'server', '-v'];
      expect(() => parseArgs()).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    it('should call printVersion and exit when --version flag is passed', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      process.argv = ['node', 'server', '--version'];
      expect(() => parseArgs()).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });
  });
});
