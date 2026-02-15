import { describe, expect, test } from 'vitest';
import type { ReplayPayload } from './replay';
import { normaliseExpectedChecksums, runReplayWithChecksums } from './replayRunner';

function createReplayPayload(): ReplayPayload {
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'test-ruleset',
      simBuildHash: 'test-build',
      seed: 2026,
      advanceRngPerFrame: true,
    },
    inputTimeline: [
      {
        p1: { moveX: 1, moveY: 0, boost: false },
        p2: { moveX: -1, moveY: 0, boost: false },
      },
      {
        p1: { moveX: 0, moveY: 1, special: true },
        p2: { moveX: 0, moveY: -1, parry: true },
      },
      {
        p1: { moveX: 0, moveY: 0, launch: true },
        p2: { moveX: 0, moveY: 0, breakLaunch: true },
      },
    ],
  };
}

describe('normaliseExpectedChecksums', () => {
  test('accepts array and object formats', () => {
    expect(normaliseExpectedChecksums([1, '2', 3])).toEqual([1, 2, 3]);
    expect(normaliseExpectedChecksums({ checksums: [4, '5'] })).toEqual([4, 5]);
  });
});

describe('runReplayWithChecksums', () => {
  test('returns success report when no expected checksums are provided', () => {
    const payload = createReplayPayload();
    const result = runReplayWithChecksums(payload);
    expect(result.checksums.length).toBe(payload.inputTimeline.length);
    expect(result.report.ok).toBe(true);
    expect(result.report.frameCount).toBe(payload.inputTimeline.length);
    expect(result.report.finalChecksum).toBeTypeOf('number');
    expect(result.report.firstDivergentFrame).toBeNull();
  });

  test('returns first divergent frame when checksum mismatch occurs', () => {
    const payload = createReplayPayload();
    const baseline = runReplayWithChecksums(payload);
    const expected = [...baseline.checksums];
    expected[1] = expected[1] + 1;

    const result = runReplayWithChecksums(payload, expected);
    expect(result.report.ok).toBe(false);
    expect(result.report.firstDivergentFrame).toBe(1);
    expect(result.report.expectedChecksumAtDivergence).toBe(expected[1]);
    expect(result.report.actualChecksumAtDivergence).toBe(baseline.checksums[1]);
  });
});
