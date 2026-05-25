#!/usr/bin/env node
/**
 * Build script for creating a Single Executable Application (SEA)
 * using Node.js built-in SEA feature (available since Node.js 20.3.0).
 *
 * Process:
 *   1. Compile TypeScript to JavaScript
 *   2. Bundle with esbuild (better-sqlite3 marked as external since
 *      it contains a native .node addon that doesn't work in SEA snapshots)
 *   3. Generate the SEA blob with `node --experimental-sea-config`
 *   4. Inject the blob into a copy of the Node.js binary using postject
 *   5. Copy native addon and supporting files alongside the executable
 *
 * Requirements:
 *   - Node.js >= 20.3.0 (SEA support)
 *   - postject (npm install -g postject)
 */

import { build } from 'esbuild';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import {
  existsSync, rmSync, mkdirSync, readFileSync, writeFileSync, statSync,
  readdirSync, copyFileSync, cpSync,
} from 'fs';

const ROOT = process.cwd();

const args = process.argv.slice(2);
const output = args.find((a) => a.startsWith('--output='))?.split('=')[1] ?? 'dist/agent-kanban';

const SEA_CONFIG = join(ROOT, 'sea-config.json');
const ENTRY = join(ROOT, 'server', 'dist', 'index.js');
const BUNDLE_DIR = join(ROOT, 'server', 'dist-bundle');
const BUNDLE = join(BUNDLE_DIR, 'index.bundle.js');
const NODE_BINARY = process.execPath;
const DIST_DIR = join(ROOT, 'dist');

function log(msg) {
  console.log(`\x1b[36m[SEA]\x1b[0m ${msg}`);
}

/**
 * Copy a directory recursively, skipping node_modules and other large dirs.
 */
function copyDirRecursive(src, dest, ignore = ['node_modules']) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (ignore.includes(entry)) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (existsSync(srcPath)) {
      if (statSync(srcPath).isDirectory()) {
        copyDirRecursive(srcPath, destPath, ignore);
      } else {
        writeFileSync(destPath, readFileSync(srcPath));
      }
    }
  }
}

async function main() {

  // Pre-flight: Clean dist/ directory to prevent stale artifacts from previous builds
  log('Pre-flight: Cleaning dist directory...');
  if (existsSync(DIST_DIR)) {
    // Remove known stale entries that shouldn't be in the SEA output
    const staleEntries = ['playwright.config.js', 'playwright.config.js.map',
      'playwright.config.d.ts', 'playwright.config.d.ts.map',
      'server', 'vscode-extension', 'web'];
    for (const entry of readdirSync(DIST_DIR)) {
      if (staleEntries.includes(entry)) {
        rmSync(join(DIST_DIR, entry), { recursive: true });
        log(`   Removed stale: ${entry}`);
      }
    }
  }

  // Step 1: Compile TypeScript (skip if dist already exists and is recent)
  log('Step 1/5: Compiling TypeScript...');
  const serverDist = join(ROOT, 'server', 'dist');
  const shouldRecompile = !existsSync(serverDist) ||
    statSync(join(ROOT, 'server', 'src', 'server.ts')).mtime > statSync(join(serverDist, 'index.js')).mtime;

 if (shouldRecompile) {
    try {
      // Use --skipLibCheck first to check for errors, then compile ignoring TS2347 (untyped calls)
      const tscResult = execSync('npx tsc --skipLibCheck 2>&1 || true', {
        cwd: join(ROOT, 'server'),
        encoding: 'utf-8',
      });
      // Try to compile again - some errors might be non-fatal for output
      try {
        execSync('npx tsc', {
          cwd: join(ROOT, 'server'),
          stdio: 'pipe',
        });
      } catch {
        // If tsc fails due to pre-existing type errors, check if output was still produced
        if (!existsSync(join(serverDist, 'index.js'))) {
          console.error('\u274c TypeScript compilation failed and produced no output');
          console.error(tscResult);
          process.exit(1);
        }
        log('   Compilation has pre-existing type errors, using existing output.');
      }
      // Copy migration SQL files (required for inlining into bundle)
      try {
        execSync('node scripts/copy-migrations.mjs', {
          cwd: join(ROOT, 'server'),
          stdio: 'pipe',
        });
      } catch {
        log('   Warning: copy-migrations.mjs failed, migration files may not be inlined.');
      }
    } catch {
      console.error('\u274c TypeScript compilation failed');
      console.error(err.stdout?.toString());
      console.error(err.stderr?.toString());
      process.exit(1);
    }
  } else {
    log('   Source not changed, using existing compiled output.');
  }
  log('TypeScript compilation complete.');

  // Step 2: Bundle with esbuild
  log('Step 2/5: Bundling with esbuild...');

  // Clean previous bundle
  if (existsSync(BUNDLE_DIR)) rmSync(BUNDLE_DIR, { recursive: true });
  mkdirSync(BUNDLE_DIR, { recursive: true });

  // Bundle the bindings module separately (transitive deps: file-uri-to-path, debug, etc.)
  log('   Bundling bindings module...');
  const BINDINGS_ENTRY = join(ROOT, 'node_modules/bindings/bindings.js');
  if (existsSync(BINDINGS_ENTRY)) {
    try {
      await build({
        entryPoints: [BINDINGS_ENTRY],
        bundle: true,
        outfile: join(BUNDLE_DIR, 'bindings.bundle.js'),
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        write: true,
        logLevel: 'silent',
      });
      log('   bindings bundled to dist-bundle/bindings.bundle.js');
    } catch (err) {
      console.error('\u274c Failed to bundle bindings:', err.message);
      process.exit(1);
    }
  }

  // Read package.json to inline into the bundle (minified)
  const pkgJsonStr = JSON.stringify(
    JSON.parse(readFileSync(join(ROOT, 'server', 'package.json'), 'utf-8'))
  );

  // Read migration SQL files to inline them
  const migrationsDir = join(ROOT, 'server', 'dist', 'db', 'migrations');
  let migrationSqls = {};
  if (existsSync(migrationsDir)) {
    const migrationFiles = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    for (const file of migrationFiles) {
      migrationSqls[file] = readFileSync(join(migrationsDir, file), 'utf-8');
    }
  }

try {
    await build({
      entryPoints: [ENTRY],
      bundle: true,
      outfile: BUNDLE,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      write: true,
      logLevel: 'silent',
      // better-sqlite3 contains native .node addon that doesn't work in SEA snapshot.
      // Keep it as a require() call; the .node file will be shipped alongside the executable.
      external: ['better-sqlite3'],
    });
  } catch (err) {
    console.error('\u274c esbuild bundling failed:', err.message);
    process.exit(1);
  }
  let bundle = readFileSync(BUNDLE, 'utf-8');

  // The bundled bindings module will be copied to dist/node_modules/bindings/
  // so that createRequire can resolve it from the filesystem.
  log('   Preparing bindings module for filesystem availability...');
  const bindingsBundlePath = join(BUNDLE_DIR, 'bindings.bundle.js');
  if (!existsSync(bindingsBundlePath)) {
    log('   Warning: bindings.bundle.js not found.');
  }

  // Handle esbuild's __filename / __dirname declarations
  let lines = bundle.split('\n');
  let result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const metaMatch = line.match(/^var (import_meta\d*) = \{\};?\s*$/);
    if (metaMatch) {
      const metaName = metaMatch[1];
      if (i + 1 < lines.length && lines[i + 1].includes('fileURLToPath') &&
          lines[i + 1].includes(`${metaName}.url`) &&
          lines[i + 1].includes('__dirname')) {
        i += 2;
        continue;
      }
      if (i + 1 < lines.length && i + 2 < lines.length) {
        if (lines[i + 1].includes('fileURLToPath') && lines[i + 1].includes(`${metaName}.url`) &&
            lines[i + 2].includes('dirname') && lines[i + 2].includes('__filename')) {
          i += 3;
          continue;
        }
      }
    }
    result.push(line);
    i++;
  }
  lines = result;

  let processedBundle = lines.join('\n');
  processedBundle = processedBundle.replace(/__filename\d+/g, '__filename');
  processedBundle = processedBundle.replace(/__dirname\d+/g, '__dirname');

  processedBundle = processedBundle.replace(
    /const __filename = fileURLToPath\(import\.meta\.url\);\s*\n/g, ''
  );
  processedBundle = processedBundle.replace(
    /const __dirname = path\.dirname\(__filename\);\s*\n/g, ''
  );
  processedBundle = processedBundle.replace(
    /const __dirname = dirname\(__filename\);\s*\n/g, ''
  );

  // Inline package.json content
  processedBundle = processedBundle.replace(
    /\(0,\s*import_\w+\.readFileSync\)\s*\(\s*\(0,\s*import_\w+\.resolve\)\s*\(__dirname,\s*["']\.\.\/package\.json["']\)\s*,\s*["']utf-8["']\s*\)/g,
    `'${pkgJsonStr.replace(/'/g, "\\'")}'`
  );
  processedBundle = processedBundle.replace(
    /readFileSync\(resolve\(__dirname,\s*['"]\.\.\/package\.json['"]\),\s*['"]utf-8['"]\)/g,
    `'${pkgJsonStr.replace(/'/g, "\\'")}'`
  );

  // Inline migration SQL files
  if (Object.keys(migrationSqls).length > 0) {
    const sqlMapStr = JSON.stringify(migrationSqls);
    processedBundle = processedBundle.replace(
      /const files = import_fs\d+\.default\.readdirSync\(MIGRATIONS_DIR\)\.filter\(\(f\) => f\.endsWith\(["']\.sql["']\)\)\.sort\(\);/,
      `const files = Object.keys(${sqlMapStr});`
    );
    processedBundle = processedBundle.replace(
      /const sql = import_fs\d+\.default\.readFileSync\(import_path\d+\.default\.join\(MIGRATIONS_DIR,\s*file\),\s*["']utf-8["']\);/g,
      `const sql = ${sqlMapStr}[file] || '';`
    );
    log(`   Inlined ${Object.keys(migrationSqls).length} migration file(s).`);
  }

  // CRITICAL: In SEA mode, embedderRequire only supports built-in modules.
  // We patch better-sqlite3 require() calls to use createRequire() with a
  // file-system path so the native .node addon can be loaded from dist/node_modules/.
  log('   Patching better-sqlite3 for SEA mode...');

  // Inject a helper function at the top of the bundle (after the 'use strict')
  const seaHelper = `
// SEA helper: load better-sqlite3 from file system via createRequire
var __sea_better_sqlite3_cache = null;
function __sea_load_better_sqlite3() {
  if (__sea_better_sqlite3_cache) return __sea_better_sqlite3_cache;
  var Module = require('module');
  var createRequire = Module.createRequire;
  var path = require('path');
  // Use path.resolve() to get absolute path (createRequire requires absolute path)
  var exePath = process.argv && process.argv[1] ? process.argv[1] : process.execPath;
  var exeDir = path.dirname(path.resolve(exePath));
  var dbRequire = createRequire(path.join(exeDir, 'node_modules', 'better-sqlite3', 'package.json'));
  __sea_better_sqlite3_cache = dbRequire('better-sqlite3');
  return __sea_better_sqlite3_cache;
}
`;

  // Inject the helper after 'use strict'
  processedBundle = processedBundle.replace(
    /^"use strict";\s*\n/,
    '"use strict";\n' + seaHelper
  );

  // Replace require("better-sqlite3") with __sea_load_better_sqlite3()
  processedBundle = processedBundle.replace(
    /require\(["']better-sqlite3["']\)/g,
    '__sea_load_better_sqlite3()'
  );

  log('   better-sqlite3 patch applied.');

  writeFileSync(BUNDLE, processedBundle, 'utf-8');
  log('Bundle created and patched.');

  // Step 2b: Build the WebUI (Vue.js + Vite)
  log('Step 2b/5: Building WebUI...');
  try {
    execSync('npm run build', {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('\u274c WebUI build failed');
    process.exit(1);
  }
  log('WebUI build complete.');

  // Step 3: Create dist/ directory first (needed for SEA blob output)
  log('Step 3/5: Preparing dist directory...');
  mkdirSync(DIST_DIR, { recursive: true });

  // Step 4: Generate SEA preparation blob
  log('Step 4/5: Generating SEA preparation blob...');
  try {
    execSync(`node --experimental-sea-config ${SEA_CONFIG}`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('\u274c SEA blob generation failed');
    process.exit(1);
  }
  log('SEA blob created.');

  // Step 5: Inject blob into Node.js binary
  log('Step 5/5: Creating executable...');
  mkdirSync(DIST_DIR, { recursive: true });

  const blobPath = join(DIST_DIR, 'sea-prep.blob');
  const executablePath = join(ROOT, output);

  // Copy the node binary as the base
  if (existsSync(executablePath)) rmSync(executablePath);
  execSync(`cp "${NODE_BINARY}" "${executablePath}"`);

  // Use postject to inject the blob
  const platform = process.platform;

  if (platform === 'linux') {
    execSync(
      `npx postject "${executablePath}" NODE_SEA_BLOB "${blobPath}" ` +
      `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
      { stdio: 'inherit' }
    );
  } else if (platform === 'darwin') {
    execSync(
      `codesign --remove-signature "${executablePath}" && ` +
      `npx postject "${executablePath}" NODE_SEA_BLOB "${blobPath}" ` +
      `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ` +
      `--macho-segment-name NODE_SEA`,
      { stdio: 'inherit' }
    );
  } else if (platform === 'win32') {
    execSync(
      `npx postject "${executablePath}" NODE_SEA_BLOB "${blobPath}" ` +
      `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
      { stdio: 'inherit' }
    );
  } else {
    console.error(`\u274c Unsupported platform: ${platform}`);
    process.exit(1);
  }

  // Clean up the blob file (postject may have already consumed it)
  try { rmSync(blobPath); } catch { /* already consumed by postject */ }
  log('Blob injected.');

  // Step 6: Copy supporting files
  log('Step 6/6: Copying supporting files...');

  // Copy better-sqlite3 native addon and package to dist/node_modules/
  // so require('better-sqlite3') resolves at runtime.
  const distNodeModules = join(DIST_DIR, 'node_modules');
  const betterSqlite3Src = join(ROOT, 'node_modules', 'better-sqlite3');

  if (existsSync(betterSqlite3Src)) {
    // Copy the entire better-sqlite3 package (minimal overhead, ~1MB)
    if (!existsSync(distNodeModules)) mkdirSync(distNodeModules, { recursive: true });
    copyDirRecursive(
      betterSqlite3Src,
      join(distNodeModules, 'better-sqlite3'),
      ['build', 'prebuilds'] // We'll copy just the .node file below
    );

    // Copy the native addon specifically
    const addonSrc = join(betterSqlite3Src, 'build', 'Release', 'better_sqlite3.node');
    const addonDest = join(distNodeModules, 'better-sqlite3', 'build', 'Release');
    if (existsSync(addonSrc)) {
      mkdirSync(addonDest, { recursive: true });
      copyFileSync(addonSrc, join(addonDest, 'better_sqlite3.node'));
      log('   Copied better_sqlite3 native addon.');
    }
  }

  // Copy bundled bindings module to dist/node_modules/bindings/
  // This lets createRequire resolve require('bindings') from the filesystem.
  const bindingsBundleSrc = join(BUNDLE_DIR, 'bindings.bundle.js');
  if (existsSync(bindingsBundleSrc)) {
    if (!existsSync(distNodeModules)) mkdirSync(distNodeModules, { recursive: true });
    const bindingsDestDir = join(distNodeModules, 'bindings');
    if (!existsSync(bindingsDestDir)) mkdirSync(bindingsDestDir, { recursive: true });
    copyFileSync(bindingsBundleSrc, join(bindingsDestDir, 'index.js'));
    // Write a minimal package.json so Node can identify this as the bindings package
    writeFileSync(
      join(bindingsDestDir, 'package.json'),
      JSON.stringify({ name: 'bindings', version: '2.0.0', main: 'index.js' })
    );
    log('   Copied bundled bindings module to dist/node_modules/bindings/');
  }

  // Copy the WebUI build output into dist/web/dist/
  // The server expects WebUI at process.resourcesPath/web/dist/index.html
  const webDistSrc = join(ROOT, 'web', 'dist');
  const webDistDest = join(DIST_DIR, 'web', 'dist');
  if (existsSync(webDistSrc)) {
    if (!existsSync(webDistDest)) mkdirSync(webDistDest, { recursive: true });
    for (const entry of readdirSync(webDistSrc)) {
      const srcPath = join(webDistSrc, entry);
      const destPath = join(webDistDest, entry);
      if (statSync(srcPath).isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
    log('   Copied WebUI build output to dist/web/dist/.');
  } else {
    console.error('\u274c WebUI build output not found at', webDistSrc);
    process.exit(1);
  }

  // Copy the data directory if it exists (for persistence across restarts)
  const srcDataDir = join(ROOT, 'data');
  const destDataDir = join(DIST_DIR, 'data');
  if (existsSync(srcDataDir)) {
    copyDirRecursive(srcDataDir, destDataDir);
    log('   Copied data directory.');
  }

  // Copy the OpenCode template directory (needed for opencode-config-zip endpoint)
  const srcTemplateDir = join(ROOT, 'opencode-template');
  const destTemplateDir = join(DIST_DIR, 'opencode-template');
  if (existsSync(srcTemplateDir)) {
    if (!existsSync(destTemplateDir)) mkdirSync(destTemplateDir, { recursive: true });
    copyDirRecursive(srcTemplateDir, destTemplateDir);
    log('   Copied opencode-template directory.');
  }

  // Get the executable size
  const stats = statSync(executablePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

  log('');
  log(`\u2705 Executable ready: ${executablePath} (${sizeMB} MB)`);
  log('');
  log('Run the executable (SEA mode):');
  log(`  ${executablePath}`);
  log('');
  log('For development (no SEA):');
  log(`  npm run build && node server/dist/index.js`);
}

main().catch((err) => {
  console.error('\u274c Build failed:', err);
  process.exit(1);
});
