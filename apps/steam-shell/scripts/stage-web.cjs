'use strict';

const { cpSync, existsSync, mkdirSync, rmSync, unlinkSync } = require('node:fs');
const path = require('node:path');

const shellRoot = path.resolve(__dirname, '..');
const source = path.resolve(shellRoot, '..', 'game-web', 'dist');
const target = path.join(shellRoot, 'web');

if (!existsSync(path.join(source, 'index.html'))) {
  throw new Error(`Steam shell staging failed: production web build not found at ${source}.`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
for (const developmentEntry of ['webrtc-smoke.html', 'webrtc-peer-smoke.html']) {
  const entryPath = path.join(target, developmentEntry);
  if (existsSync(entryPath)) {
    unlinkSync(entryPath);
  }
}

console.log(`Staged Gravity Well web client at ${target}`);
