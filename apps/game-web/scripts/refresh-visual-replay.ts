import { readFile, writeFile } from 'node:fs/promises';
import { runReplay, validateReplayPayload } from '../src/sim/replay';

// Keep the historical fixture intact. This explicitly re-authors the same
// visual input choreography for the September simulation, not the old engine.
const source = new URL('../replays/alpha-visual.replay.json', import.meta.url);
const destination = new URL('../replays/alpha-visual-2026.09.replay.json', import.meta.url);
const raw = JSON.parse(await readFile(source, 'utf8'));
raw.header.rulesetVersion = 'prototype-2026.09';
raw.header.simBuildHash = 'visual-alpha-local-2026.09';
delete raw.expectedChecksums;
const validation = validateReplayPayload(raw);
if (validation.ok === false) throw new Error(validation.error.message);
const payload = validation.payload;
payload.expectedChecksums = runReplay(payload).checksums;
await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Wrote ${destination.pathname} (${payload.expectedChecksums.length} current-ruleset frames).`);
