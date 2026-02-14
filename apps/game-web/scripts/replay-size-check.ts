import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { estimateReplayPayloadBytes, validateReplayPayload } from '../src/sim/replay';

interface CliOptions {
  replaysDir: string;
  maxMedianBytes: number;
}

const DEFAULT_REPLAYS_DIR = 'replays';
const DEFAULT_MAX_MEDIAN_BYTES = 4096;
const MIN_FIXTURES_FOR_MEDIAN = 3;

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  let replaysDir = DEFAULT_REPLAYS_DIR;
  let maxMedianBytes = DEFAULT_MAX_MEDIAN_BYTES;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      replaysDir = argv[i + 1] ?? replaysDir;
      i += 1;
      continue;
    }
    if (arg === '--max-median-bytes') {
      const parsed = parsePositiveNumber(argv[i + 1]);
      if (parsed !== null) {
        maxMedianBytes = parsed;
      }
      i += 1;
    }
  }

  return {
    replaysDir,
    maxMedianBytes,
  };
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const resolvedDir = resolve(options.replaysDir);
  const entries = await readdir(resolvedDir);
  const replayFiles = entries.filter((entry) => entry.endsWith('.replay.json')).sort();

  if (replayFiles.length < MIN_FIXTURES_FOR_MEDIAN) {
    console.error(
      `Replay size check requires at least ${MIN_FIXTURES_FOR_MEDIAN} fixtures, found ${replayFiles.length}.`,
    );
    process.exitCode = 1;
    return;
  }

  const fixtureSizes: Array<{ file: string; bytes: number }> = [];
  for (const file of replayFiles) {
    const fullPath = join(resolvedDir, file);
    const rawJson = await readFile(fullPath, 'utf8');
    const parsed = JSON.parse(rawJson) as unknown;
    const validation = validateReplayPayload(parsed);
    if (!validation.ok) {
      console.error(`Fixture ${file} is invalid [${validation.error.code}]: ${validation.error.message}`);
      process.exitCode = 1;
      return;
    }
    fixtureSizes.push({
      file,
      bytes: estimateReplayPayloadBytes(validation.payload),
    });
  }

  const medianBytes = calculateMedian(fixtureSizes.map((entry) => entry.bytes));
  console.log(`Replay payload size budget: median <= ${options.maxMedianBytes} bytes`);
  for (const fixture of fixtureSizes) {
    console.log(`- ${fixture.file}: ${fixture.bytes} bytes`);
  }
  console.log(`Computed median payload bytes: ${medianBytes}`);

  if (medianBytes > options.maxMedianBytes) {
    console.error(`Replay payload median ${medianBytes} exceeds budget ${options.maxMedianBytes}.`);
    process.exitCode = 1;
    return;
  }

  console.log('Replay payload size check passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
