export interface PresentationFrameTimingStatistics {
  intervalCount: number;
  sampleDurationMs: number;
  averageFrameMs: number;
  averageFps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  intervalsOver20Ms: number;
  intervalsOver33Ms: number;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[Math.min(index, sortedValues.length - 1)] ?? 0;
}

export function summarisePresentationFrameTiming(
  rawIntervals: readonly number[],
): PresentationFrameTimingStatistics {
  const intervals = rawIntervals.filter((value) => Number.isFinite(value) && value > 0);
  if (intervals.length === 0) {
    throw new Error('Presentation frame timing requires at least one positive finite interval.');
  }
  const sorted = [...intervals].sort((left, right) => left - right);
  const sampleDurationMs = intervals.reduce((total, value) => total + value, 0);
  const averageFrameMs = sampleDurationMs / intervals.length;
  return {
    intervalCount: intervals.length,
    sampleDurationMs: roundMetric(sampleDurationMs),
    averageFrameMs: roundMetric(averageFrameMs),
    averageFps: roundMetric(1_000 / averageFrameMs),
    p50FrameMs: roundMetric(percentile(sorted, 0.5)),
    p95FrameMs: roundMetric(percentile(sorted, 0.95)),
    p99FrameMs: roundMetric(percentile(sorted, 0.99)),
    maxFrameMs: roundMetric(sorted[sorted.length - 1] ?? 0),
    intervalsOver20Ms: intervals.filter((value) => value > 20).length,
    intervalsOver33Ms: intervals.filter((value) => value > 33).length,
  };
}
