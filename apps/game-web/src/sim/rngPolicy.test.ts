import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { computeStateChecksum } from './checksum';
import type { FrameInput } from './types';
import { createInitialState, nextDeterministicRandom, step } from './sim';

const FIXED_DT = 1 / 60;
const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

function listSimSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...listSimSourceFiles(join(dir, entry.name)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      continue;
    }
    files.push(join(dir, entry.name));
  }
  return files;
}

function scriptedInputForFrame(frame: number): FrameInput {
  const input: FrameInput = {
    p1: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
    p2: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
  };

  if (frame % 6 < 3) {
    input.p1.moveX = 1;
  } else {
    input.p1.moveX = -1;
  }
  if (frame % 8 < 4) {
    input.p2.moveY = 1;
  } else {
    input.p2.moveY = -1;
  }
  input.p1.boost = frame % 30 === 0;
  input.p2.parry = frame % 45 === 0;
  input.p1.special = frame % 50 === 0;

  return input;
}

describe('deterministic RNG policy', () => {
  test('simulation sources do not use nondeterministic Math.random', () => {
    const files = listSimSourceFiles(SIM_DIR);
    const offenders = files.filter((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return /\bMath\.random\s*\(/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  test('seed is applied at match start and drives deterministic checksum sequence', () => {
    const seed = 20260215;
    const stateA = createInitialState({ seed });
    const stateB = createInitialState({ seed });
    expect(stateA.seed).toBe(seed);
    expect(stateB.seed).toBe(seed);
    expect(stateA.rngState).toBe(seed);
    expect(stateB.rngState).toBe(seed);

    const checksumsA: number[] = [];
    const checksumsB: number[] = [];

    for (let frame = 0; frame < 180; frame += 1) {
      const input = scriptedInputForFrame(frame);
      step(stateA, input, FIXED_DT);
      step(stateB, input, FIXED_DT);
      nextDeterministicRandom(stateA);
      nextDeterministicRandom(stateB);
      checksumsA.push(computeStateChecksum(stateA));
      checksumsB.push(computeStateChecksum(stateB));
    }

    expect(checksumsA).toEqual(checksumsB);
  });
});
