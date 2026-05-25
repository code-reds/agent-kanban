#!/usr/bin/env node
/**
 * Preload script for SEA (Single Executable Application) mode.
 *
 * Runs before the bundled main entry point. Extracts the better_sqlite3.node
 * native addon from the SEA asset bundle and patches the require function
 * so that better-sqlite3's internal require('bindings') call succeeds.
 *
 * This is necessary because better-sqlite3 uses the 'bindings' package to
 * locate the native .node file, which doesn't work from the SEA snapshot
 * filesystem.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Extract the native addon from the SEA asset bundle
const { getRawAsset } = require('node:sea');
const addonPath = path.join(__dirname, 'better_sqlite3.node');

try {
  // Check if we already extracted it in a previous run
  if (!fs.existsSync(addonPath)) {
    const raw = getRawAsset('better_sqlite3.node');
    const buffer = Buffer.from(raw);
    fs.writeFileSync(addonPath, buffer);
    console.log('SEA: Extracted better_sqlite3.node to:', addonPath);
  }
} catch (err) {
  console.error('SEA: Failed to extract native addon:', err.message);
  console.error('This application must be run as a SEA executable.');
  process.exit(1);
}

// Load the native addon using process.dlopen
const exportsObj = {};
try {
  process.dlopen(exportsObj, addonPath);
  console.log('SEA: Loaded better_sqlite3 native addon');
} catch (err) {
  console.error('SEA: Failed to load native addon:', err.message);
  process.exit(1);
}

// Create a bindings module that returns the pre-loaded native addon.
// This patches the require function so better-sqlite3's internal
// require('bindings')('better_sqlite3.node') call returns our addon.
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === 'bindings') {
    return exportsObj;
  }
  return originalRequire.apply(this, arguments);
};

console.log('SEA: Patched require for bindings module');
