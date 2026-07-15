import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { validateReplayPayload } from '../src/sim/replay';
import { normaliseExpectedChecksums, runReplayWithChecksums } from '../src/sim/replayRunner';

interface CliOptions {
  inputPath: string;
  expectedPath?: string;
  outputPath?: string;
  reportPath?: string;
  expectInline: boolean;
}

function printUsage(): void {
  const usage = [
    'Usage:',
    '  tsx scripts/replay-runner.ts --input <replay.json> [--expected <checksums.json>] [--output <checksums.json>] [--report <report.json>] [--expect-inline]',
    '',
    'Examples:',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --output replays/smoke.expected.json',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --expected replays/smoke.expected.json',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --expect-inline',
    '  tsx scripts/replay-runner.ts --input replays/smoke.replay.json --expected replays/smoke.expected.json --report replays/smoke.report.json',
  ];
  console.log(usage.join('\n'));
}

function parseArgs(argv: string[]): CliOptions | null {
  let inputPath: string | undefined;
  let expectedPath: string | undefined;
  let outputPath: string | undefined;
  let reportPath: string | undefined;
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
    if (arg === '--report') {
      reportPath = argv[i + 1];
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
    reportPath,
    expectInline,
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const data = await readFile(resolve(path), 'utf8');
  return JSON.parse(data) as T;
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
  if (validation.ok === false) {
    console.error(`Replay payload validation failed [${validation.error.code}]: ${validation.error.message}`);
    process.exitCode = 1;
    return;
  }

  const replay = validation.payload;
  let expectedChecksums: number[] | undefined;
  if (options.expectedPath) {
    const expectedRaw = await readJsonFile<unknown>(options.expectedPath);
    expectedChecksums = normaliseExpectedChecksums(expectedRaw);
  } else if (options.expectInline) {
    if (!Array.isArray(replay.expectedChecksums)) {
      throw new Error('Replay file is missing expectedChecksums while using --expect-inline.');
    }
    expectedChecksums = replay.expectedChecksums.map((value) => Number(value));
  }

  const result = runReplayWithChecksums(replay, expectedChecksums);
  console.log(`Replay processed: ${result.report.frameCount} frames (payload v${replay.header.payloadVersion}).`);
  if (result.report.finalChecksum !== null) {
    console.log(`Final checksum: ${result.report.finalChecksum}`);
  }

  if (options.outputPath) {
    await writeFile(resolve(options.outputPath), `${JSON.stringify(result.checksums, null, 2)}\n`, 'utf8');
    console.log(`Wrote checksums to ${options.outputPath}`);
  }

  if (options.reportPath) {
    await writeFile(
      resolve(options.reportPath),
      `${JSON.stringify({
        inputPath: options.inputPath,
        expectedPath: options.expectedPath ?? (options.expectInline ? 'inline' : null),
        report: result.report,
      }, null, 2)}\n`,
      'utf8',
    );
    console.log(`Wrote replay report to ${options.reportPath}`);
  }

  if (!expectedChecksums) {
    return;
  }

  if (!result.report.ok) {
    console.error(
      `Checksum mismatch at frame ${result.report.firstDivergentFrame}: expected ${result.report.expectedChecksumAtDivergence}, got ${result.report.actualChecksumAtDivergence}.`,
    );
    console.error(
      `Divergence report: firstDivergentFrame=${result.report.firstDivergentFrame}, expectedFrames=${result.report.expectedFrameCount}, actualFrames=${result.report.frameCount}.`,
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
