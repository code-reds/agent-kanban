import { getDb, closeDb, resetDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedGlobalDefaults } from '../db/seed.js';
import fs from 'fs';
import path from 'path';

// Set dynamic ports for REST and MCP servers at setup time.
// Each test file gets its own unique ports to avoid conflicts.
// Uses an atomic file-based counter to ensure uniqueness across test files.
const COUNTER_FILE = path.resolve(__dirname, '.port-counter');
const BASE_PORT = 30000;
const MAX_OFFSET = 20000; // ensures port stays within valid range (30000-50000)

function getNextPortSync(): number {
  try {
    let count = 0;
    if (fs.existsSync(COUNTER_FILE)) {
      count = parseInt(fs.readFileSync(COUNTER_FILE, 'utf-8').trim(), 10) || 0;
    }
    count++;
    fs.writeFileSync(COUNTER_FILE, String(count));
    return BASE_PORT + (count % MAX_OFFSET);
  } catch {
    // Fallback: random port in valid range
    return BASE_PORT + Math.floor(Math.random() * MAX_OFFSET);
  }
}

const restPort = getNextPortSync();
const mcpPort = getNextPortSync();

process.env.PORT = String(restPort);
process.env.MCP_PORT = String(mcpPort);
process.env.MCP_HOST = '127.0.0.1';
process.env.DB_PATH = ':memory:';

// Run DB setup at module level - runs once before each test file
resetDb();
const db = getDb();
db.exec("PRAGMA foreign_keys = OFF");
try { db.exec("DROP TABLE IF EXISTS schema_migrations"); } catch {}
try { db.exec("DROP TABLE IF EXISTS projects"); } catch {}
try { db.exec("DROP TABLE IF EXISTS roles"); } catch {}
try { db.exec("DROP TABLE IF EXISTS kanban_columns"); } catch {}
try { db.exec("DROP TABLE IF EXISTS workflow_transitions"); } catch {}
try { db.exec("DROP TABLE IF EXISTS transition_allowed_roles"); } catch {}
try { db.exec("DROP TABLE IF EXISTS ticket_access_rules"); } catch {}
try { db.exec("DROP TABLE IF EXISTS tickets"); } catch {}
try { db.exec("DROP TABLE IF EXISTS ticket_dependencies"); } catch {}
try { db.exec("DROP TABLE IF EXISTS ticket_comments"); } catch {}
try { db.exec("DROP TABLE IF EXISTS ticket_status_history"); } catch {}
try { db.exec("DROP TABLE IF EXISTS conversations"); } catch {}
try { db.exec("DROP TABLE IF EXISTS messages"); } catch {}
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
for (const t of tables) {
  try { db.exec(`DROP TABLE IF EXISTS "${t.name}"`); } catch {}
}
db.exec("PRAGMA foreign_keys = ON");
runMigrations();
seedDefaultRoles();
seedGlobalDefaults();
try { db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''"); } catch {}
