import { describe, expect, test } from 'vitest';
import { summarisePresentationFrameTiming } from './presentationFrameTiming';

describe('presentation frame timing summary', () => {
  test('reports distribution and missed-frame evidence without assigning a pass score', () => {
    const summary = summarisePresentationFrameTiming([16, 17, 18, 21, 34]);
    expect(summary).toEqual({
      intervalCount: 5,
      sampleDurationMs: 106,
      averageFrameMs: 21.2,
      averageFps: 47.17,
      p50FrameMs: 18,
      p95FrameMs: 34,
      p99FrameMs: 34,
      maxFrameMs: 34,
      intervalsOver20Ms: 2,
      intervalsOver33Ms: 1,
    });
  });

  test('ignores invalid intervals and rejects an empty usable sample', () => {
    expect(summarisePresentationFrameTiming([16.666, Number.NaN, -1]).intervalCount).toBe(1);
    expect(() => summarisePresentationFrameTiming([0, Number.POSITIVE_INFINITY])).toThrow(
      'at least one positive finite interval',
    );
  });
});
