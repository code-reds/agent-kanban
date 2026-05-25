import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

describe('runMigrations empty directory', () => {
  let readdirSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock fs.readdirSync to return empty array
    readdirSpy = vi.spyOn(fs, 'readdirSync').mockReturnValue([]);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    readdirSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should log "No migration files found." when no migration files exist', async () => {
    // Import runMigrations after mocking fs.readdirSync
    // The module-level MIGRATIONS_DIR is already set, but readdirSync is called inside runMigrations
    const { runMigrations } = await import('../db/migrations.js');
    
    runMigrations();
    
    expect(logSpy).toHaveBeenCalledWith('No migration files found.');
  });
});
