export const PERFORMANCE_SAMPLE_SCHEMA_VERSION = 'gw.performance-sample.v1' as const;
export const DEFAULT_PERFORMANCE_SAMPLE_LIMIT = 120;
export const MAX_PERFORMANCE_SAMPLE_LIMIT = 600;

export interface PerformanceSampleInput {
  elapsedMs?: unknown;
  frameTimeMs?: unknown;
  p95FrameTimeMs?: unknown;
  framesPerSecond?: unknown;
  pixelRatio?: unknown;
  drawCalls?: unknown;
  triangles?: unknown;
  geometries?: unknown;
  textures?: unknown;
}

export interface PerformanceSample {
  schemaVersion: typeof PERFORMANCE_SAMPLE_SCHEMA_VERSION;
  elapsedMs: number;
  frameTimeMs: number;
  p95FrameTimeMs: number;
  framesPerSecond: number;
  pixelRatio: number;
  renderer: {
    drawCalls: number | null;
    triangles: number | null;
    geometries: number | null;
    textures: number | null;
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function count(value: unknown, maximum: number): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.round(clamp(parsed, 0, maximum));
}

export function sanitisePerformanceSample(input: PerformanceSampleInput): PerformanceSample | null {
  const elapsedMs = finiteNumber(input.elapsedMs);
  const frameTimeMs = finiteNumber(input.frameTimeMs);
  const pixelRatio = finiteNumber(input.pixelRatio);
  if (
    elapsedMs === null
    || elapsedMs < 0
    || frameTimeMs === null
    || frameTimeMs <= 0
    || pixelRatio === null
    || pixelRatio <= 0
  ) {
    return null;
  }

  const boundedFrameTimeMs = clamp(frameTimeMs, 0.01, 10_000);
  const requestedP95 = finiteNumber(input.p95FrameTimeMs);
  const requestedFramesPerSecond = finiteNumber(input.framesPerSecond);
  return {
    schemaVersion: PERFORMANCE_SAMPLE_SCHEMA_VERSION,
    elapsedMs: Math.round(clamp(elapsedMs, 0, 7 * 24 * 60 * 60 * 1_000)),
    frameTimeMs: rounded(boundedFrameTimeMs),
    p95FrameTimeMs: rounded(clamp(requestedP95 ?? boundedFrameTimeMs, 0.01, 10_000)),
    framesPerSecond: rounded(clamp(
      requestedFramesPerSecond ?? (1_000 / boundedFrameTimeMs),
      0,
      1_000,
    )),
    pixelRatio: rounded(clamp(pixelRatio, 0.25, 4)),
    renderer: {
      drawCalls: count(input.drawCalls, 1_000_000),
      triangles: count(input.triangles, 1_000_000_000),
      geometries: count(input.geometries, 1_000_000),
      textures: count(input.textures, 1_000_000),
    },
  };
}

export class PerformanceSampleBuffer {
  private readonly limit: number;
  private readonly samples: PerformanceSample[] = [];

  public constructor(limit = DEFAULT_PERFORMANCE_SAMPLE_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PERFORMANCE_SAMPLE_LIMIT) {
      throw new Error(`Performance sample limit must be an integer between 1 and ${MAX_PERFORMANCE_SAMPLE_LIMIT}.`);
    }
    this.limit = limit;
  }

  public record(input: PerformanceSampleInput): PerformanceSample | null {
    const sample = sanitisePerformanceSample(input);
    if (!sample) {
      return null;
    }
    this.samples.push(sample);
    if (this.samples.length > this.limit) {
      this.samples.splice(0, this.samples.length - this.limit);
    }
    return sample;
  }

  public snapshot(): PerformanceSample[] {
    return this.samples.map((sample) => ({
      ...sample,
      renderer: { ...sample.renderer },
    }));
  }

  public clear(): void {
    this.samples.length = 0;
  }
}
