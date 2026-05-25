import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const srcMigrationsDir = path.join(projectRoot, 'src', 'db', 'migrations');
const distMigrationsDir = path.join(projectRoot, 'dist', 'db', 'migrations');

// Ensure dist migrations dir exists
fs.mkdirSync(distMigrationsDir, { recursive: true });

// Copy all .sql files
const files = fs.readdirSync(srcMigrationsDir).filter(f => f.endsWith('.sql'));

for (const file of files) {
  const src = path.join(srcMigrationsDir, file);
  const dest = path.join(distMigrationsDir, file);
  fs.copyFileSync(src, dest);
  console.log(`Copied migration: ${file}`);
}

console.log(`Copied ${files.length} migration file(s) to dist/db/migrations/`);
