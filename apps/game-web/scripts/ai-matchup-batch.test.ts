import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const GAME_WEB_DIR = fileURLToPath(new URL('../', import.meta.url));
const BATCH_SCRIPT = fileURLToPath(new URL('./ai-matchup-batch.ts', import.meta.url));
const THRESHOLDS_PATH = fileURLToPath(
  new URL('../content/balance/ai-regression-thresholds.json', import.meta.url),
);

function runInvalidBatch(args: string[]) {
  const outputDir = mkdtempSync(join(tmpdir(), 'gw-ai-batch-validation-'));
  try {
    return spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        BATCH_SCRIPT,
        ...args,
        '--thresholds',
        THRESHOLDS_PATH,
        '--output-dir',
        outputDir,
      ],
      {
        cwd: GAME_WEB_DIR,
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

describe('ai-matchup-batch selection validation', () => {
  test.each([
    {
      name: 'a one-character roster',
      args: ['--characters', 'vanguard'],
      expectedError: 'AI batch selection generated zero directed pairings',
    },
    {
      name: 'an empty character roster',
      args: ['--characters', ','],
      expectedError: '--characters must select at least one registered character id',
    },
    {
      name: 'an unknown character in the roster',
      args: ['--characters', 'vanguard,unknown-character'],
      expectedError: 'Unknown --characters id(s): "unknown-character"',
    },
    {
      name: 'an unknown difficulty in the matrix',
      args: ['--difficulty', 'veteran,nightmare', '--characters', 'vanguard'],
      expectedError: 'Unknown --difficulty id(s): "nightmare"',
    },
    {
      name: 'an unknown direct character selection',
      args: ['--p1', 'vanguard', '--p2', 'unknown-character'],
      expectedError: 'Unknown --p2 character id "unknown-character"',
    },
  ])('rejects $name before simulation', ({ args, expectedError }) => {
    const result = runInvalidBatch(args);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain(expectedError);
    expect(output).not.toContain('[ai-batch] balance gate passed');
  });
});
