import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { findFirstChecksumMismatch, runReplay, validateReplayPayload } from '../src/sim/replay';

interface CliOptions {
  inputPath: string;
  expectedPath?: string;
  outputPath?: string;
  expectInline: boolean;
}

function printUsage(): void {
  const usage = [
    'Usage:',
    '  tsx scripts/replay-runner.ts --input <replay.json> [--expected <checksums.json>] [--output <checksums.json>] [--expect-inline]',
    '',
    'Examples:',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --output replays/smoke.expected.json',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --expected replays/smoke.expected.json',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --expect-inline',
  ];
  console.log(usage.join('\n'));
}

function parseArgs(argv: string[]): CliOptions | null {
  let inputPath: string | undefined;
  let expectedPath: string | undefined;
  let outputPath: string | undefined;
  let expectInline = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      inputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--expected') {
      expectedPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output') {
      outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--expect-inline') {
      expectInline = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return null;
    }
  }

  if (!inputPath) {
    return null;
  }

  return {
    inputPath,
    expectedPath,
    outputPath,
    expectInline,
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const data = await readFile(resolve(path), 'utf8');
  return JSON.parse(data) as T;
}

function normaliseExpected(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => Number(value));
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { checksums?: unknown[] }).checksums)) {
    return ((raw as { checksums: unknown[] }).checksums).map((value) => Number(value));
  }
  throw new Error('Expected checksum file must be an array or an object with a "checksums" array.');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const replayRaw = await readJsonFile<unknown>(options.inputPath);
  const validation = validateReplayPayload(replayRaw);
  if (!validation.ok) {
    console.error(`Replay payload validation failed [${validation.error.code}]: ${validation.error.message}`);
    process.exitCode = 1;
    return;
  }

  const replay = validation.payload;
  const result = runReplay(replay);

  console.log(`Replay processed: ${result.checksums.length} frames (payload v${replay.header.payloadVersion}).`);
  if (result.checksums.length > 0) {
    console.log(`Final checksum: ${result.checksums[result.checksums.length - 1]}`);
  }

  if (options.outputPath) {
    await writeFile(resolve(options.outputPath), `${JSON.stringify(result.checksums, null, 2)}\n`, 'utf8');
    console.log(`Wrote checksums to ${options.outputPath}`);
  }

  let expectedChecksums: number[] | undefined;
  if (options.expectedPath) {
    const expectedRaw = await readJsonFile<unknown>(options.expectedPath);
    expectedChecksums = normaliseExpected(expectedRaw);
  } else if (options.expectInline) {
    if (!Array.isArray(replay.expectedChecksums)) {
      throw new Error('Replay file is missing expectedChecksums while using --expect-inline.');
    }
    expectedChecksums = replay.expectedChecksums.map((value) => Number(value));
  }

  if (!expectedChecksums) {
    return;
  }

  const mismatch = findFirstChecksumMismatch(result.checksums, expectedChecksums);
  if (mismatch) {
    console.error(
      `Checksum mismatch at frame ${mismatch.frame}: expected ${mismatch.expected}, got ${mismatch.actual}.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Checksum validation passed for ${expectedChecksums.length} frames.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
