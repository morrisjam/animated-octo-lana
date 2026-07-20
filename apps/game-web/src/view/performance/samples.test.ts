import { describe, expect, test } from 'vitest';
import {
  MAX_PERFORMANCE_SAMPLE_LIMIT,
  PERFORMANCE_SAMPLE_SCHEMA_VERSION,
  PerformanceSampleBuffer,
  sanitisePerformanceSample,
} from './samples';

describe('performance sample buffer', () => {
  test('normalises safe numeric samples without collecting absolute timestamps or device identity', () => {
    const sample = sanitisePerformanceSample({
      elapsedMs: 1_234.4,
      frameTimeMs: 16.66666,
      p95FrameTimeMs: 21.12345,
      pixelRatio: 1.25,
      drawCalls: 91.4,
      triangles: 12_345.6,
      accountId: 'ignored by the allowlist',
    } as never);

    expect(sample).toEqual({
      schemaVersion: PERFORMANCE_SAMPLE_SCHEMA_VERSION,
      elapsedMs: 1_234,
      frameTimeMs: 16.667,
      p95FrameTimeMs: 21.123,
      framesPerSecond: 60,
      pixelRatio: 1.25,
      renderer: {
        drawCalls: 91,
        triangles: 12_346,
        geometries: null,
        textures: null,
      },
    });
  });

  test('keeps only the latest configured number of samples and returns defensive snapshots', () => {
    const buffer = new PerformanceSampleBuffer(2);
    for (let index = 0; index < 3; index += 1) {
      buffer.record({ elapsedMs: index * 1_000, frameTimeMs: 16, pixelRatio: 1 });
    }

    const snapshot = buffer.snapshot();
    expect(snapshot.map((sample) => sample.elapsedMs)).toEqual([1_000, 2_000]);
    snapshot[0].renderer.drawCalls = 999;
    expect(buffer.snapshot()[0].renderer.drawCalls).toBeNull();
  });

  test('rejects invalid samples and invalid buffer limits', () => {
    expect(sanitisePerformanceSample({ elapsedMs: 0, frameTimeMs: 0, pixelRatio: 1 })).toBeNull();
    expect(sanitisePerformanceSample({ elapsedMs: -1, frameTimeMs: 16, pixelRatio: 1 })).toBeNull();
    expect(() => new PerformanceSampleBuffer(0)).toThrow(/between 1/);
    expect(() => new PerformanceSampleBuffer(MAX_PERFORMANCE_SAMPLE_LIMIT + 1)).toThrow(/between 1/);
  });
});
