#!/usr/bin/env node
/**
 * Wrapper for the SEA executable that loads the preload script via --require.
 * The preload script patches require() to intercept 'bindings' and returns
 * the better_sqlite3 native addon from the SEA asset bundle.
 *
 * The preload script path is resolved relative to the location of this wrapper.
 */

'use strict';

const { spawn } = require('child_process');
const { resolve, dirname } = require('path');

// Resolve the directory of this wrapper script
const wrapperDir = dirname(require.main?.filename || process.argv[1]);

// Find the SEA executable and preload script
let seaExe;
let preloadScript;

// Check if we're in the dist directory (SEA build output)
const distDir = resolve(wrapperDir);
const candidates = [
  resolve(distDir, 'agent-kanban'),
  resolve(distDir, 'agent-kanban.exe'),
];

// Find the executable
for (const candidate of candidates) {
  if (require('fs').existsSync(candidate)) {
    seaExe = candidate;
    break;
  }
}

if (!seaExe) {
  console.error('Error: Could not find the agent-kanban SEA executable.');
  console.error('Expected at:', candidates.join('\n  or '));
  process.exit(1);
}

// Find the preload script
const preloadPath = resolve(dirname(seaExe), 'sea-preload.js');
if (!require('fs').existsSync(preloadPath)) {
  console.error('Error: sea-preload.js not found at:', preloadPath);
  process.exit(1);
}

// Spawn the SEA executable with --require preload
const node = process.execPath;
const child = spawn(node, [
  '--require', preloadPath,
  '--enable-source-maps',
  seaExe,
  ...process.argv.slice(2),
], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
