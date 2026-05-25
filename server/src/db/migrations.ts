import { getDb } from './database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Resolve migrations directory.
// In pkg snapshot environment, process.resourcesPath points to the resources directory
// where asset files are placed. Otherwise, resolve relative to __dirname.
function resolveMigrationsDir(): string {
  // pkg sets process.resourcesPath when running from a packaged executable
  // resourcesPath is a runtime-only property in pkg, not in Node types
  const pkgResources = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (pkgResources) {
    // In pkg, assets are extracted to process.resourcesPath preserving path relative to pkg.json
    // pkg.json is at monorepo root, so asset path server/dist/db/migrations/ → process.resourcesPath/server/dist/db/migrations/
    const pkgPath = path.join(pkgResources, 'server', 'dist', 'db', 'migrations');
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
  }

  // Fallback: resolve relative to this file's directory (development / compiled)
  const devPath = path.resolve(__dirname, 'migrations');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Last resort: search upward for the migrations directory
  for (let depth = 0; depth < 10; depth++) {
    const searchPath = path.resolve(__dirname, '../'.repeat(depth) + 'migrations');
    if (fs.existsSync(searchPath)) {
      return searchPath;
    }
  }

  // Return devPath even if it doesn't exist — let the caller decide
  return devPath;
}

const MIGRATIONS_DIR = resolveMigrationsDir();

function ensureSchemaMigrationsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function runMigrations() {
  const db = getDb();

  // Ensure schema_migrations table exists
  ensureSchemaMigrationsTable();

  // Get already applied migrations
  const applied = db.prepare(
    'SELECT migration_name FROM schema_migrations ORDER BY migration_name'
  ).all() as { migration_name: string }[];
  const appliedNames = new Set(applied.map((r) => r.migration_name));

  // Read and sort migration files
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Apply pending migrations
  for (const file of files) {
    if (!appliedNames.has(file)) {
      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (migration_name) VALUES (?)'
      ).run(file);
      console.log(`  ✓ Migration applied: ${file}`);
    }
  }

  if (files.length === 0) {
    console.log('No migration files found.');
  } else {
    console.log(`Migrations complete: ${files.length} total, ${files.length - appliedNames.size} new.`);
  }
}
