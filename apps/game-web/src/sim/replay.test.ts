import { describe, expect, test } from 'vitest';
import type { ReplayPayload } from './replay';
import {
  estimateReplayPayloadBytes,
  findFirstChecksumMismatch,
  runReplay,
  validateReplayPayload,
} from './replay';

function createReplayPayload(): ReplayPayload {
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
      seed: 2026,
      fixedDt: 1 / 60,
      advanceRngPerFrame: true,
    },
    inputTimeline: [
      { p1: { moveX: 1 }, p2: { moveX: -1 } },
      { p1: { moveY: 1, boost: true }, p2: { moveY: -1 } },
      { p1: { special: true }, p2: { parry: true } },
      { p1: { launch: true }, p2: { breakLaunch: true } },
      { p1: { moveX: -1, moveY: 1 }, p2: { moveX: 1, moveY: -1 } },
    ],
  };
}

describe('replay runner', () => {
  test('same replay payload produces identical checksums', () => {
    const replay = createReplayPayload();
    const resultA = runReplay(replay);
    const resultB = runReplay(replay);
    expect(resultA.checksums).toEqual(resultB.checksums);
  });

  test('reports first checksum mismatch frame', () => {
    const mismatch = findFirstChecksumMismatch([10, 20, 30], [10, 21, 30]);
    expect(mismatch).toEqual({
      frame: 1,
      actual: 20,
      expected: 21,
    });
  });

  test('rejects unsupported payload version with explicit error', () => {
    const parsed = validateReplayPayload({
      header: {
        payloadVersion: 99,
        rulesetVersion: 'prototype-2026.02',
        simBuildHash: 'dev-local',
      },
      inputTimeline: [],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error('Expected payload validation failure');
    }
    expect(parsed.error.code).toBe('unsupported_payload_version');
  });

  test('estimates compact payload byte size', () => {
    const replay = createReplayPayload();
    const bytes = estimateReplayPayloadBytes(replay);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(4096);
  });
});
