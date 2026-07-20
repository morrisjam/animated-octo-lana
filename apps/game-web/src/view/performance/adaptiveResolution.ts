import type { PerformanceTier } from './tiers';

export const ADAPTIVE_RESOLUTION_SCHEMA_VERSION = 'gw.adaptive-resolution.v1' as const;
export const ADAPTIVE_RESOLUTION_MIN_PIXEL_RATIO = 0.25;
export const ADAPTIVE_RESOLUTION_MAX_PIXEL_RATIO = 2;

export interface AdaptiveResolutionConfig {
  schemaVersion: typeof ADAPTIVE_RESOLUTION_SCHEMA_VERSION;
  enabled: boolean;
  minimumPixelRatio: number;
  initialPixelRatio: number;
  maximumPixelRatio: number;
  downshiftStep: number;
  upshiftStep: number;
  evaluationWindowFrames: number;
  downshiftAverageFrameTimeMs: number;
  upshiftAverageFrameTimeMs: number;
  downshiftWindows: number;
  upshiftWindows: number;
  cooldownMs: number;
}

export interface AdaptiveResolutionChange {
  direction: 'down' | 'up';
  previousPixelRatio: number;
  pixelRatio: number;
  averageFrameTimeMs: number;
  observedAtMs: number;
  cooldownUntilMs: number;
}

export interface ReducedMotionChange {
  reducedMotion: boolean;
}

export interface AdaptiveResolutionHooks {
  onPixelRatioChange?(change: AdaptiveResolutionChange): void;
  onReducedMotionChange?(change: ReducedMotionChange): void;
}

export interface AdaptiveResolutionSnapshot {
  enabled: boolean;
  pixelRatio: number;
  reducedMotion: boolean;
  cooldownUntilMs: number;
  slowWindowStreak: number;
  fastWindowStreak: number;
  pendingFrameSamples: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function requireFinite(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return value;
}

function requireRange(value: unknown, minimum: number, maximum: number, fieldName: string): number {
  const parsed = requireFinite(value, fieldName);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${fieldName} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function requireInteger(value: unknown, minimum: number, maximum: number, fieldName: string): number {
  const parsed = requireFinite(value, fieldName);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function validateAdaptiveResolutionConfig(
  config: AdaptiveResolutionConfig,
): AdaptiveResolutionConfig {
  const minimumPixelRatio = requireRange(
    config.minimumPixelRatio,
    ADAPTIVE_RESOLUTION_MIN_PIXEL_RATIO,
    ADAPTIVE_RESOLUTION_MAX_PIXEL_RATIO,
    'minimumPixelRatio',
  );
  const initialPixelRatio = requireRange(
    config.initialPixelRatio,
    minimumPixelRatio,
    ADAPTIVE_RESOLUTION_MAX_PIXEL_RATIO,
    'initialPixelRatio',
  );
  const maximumPixelRatio = requireRange(
    config.maximumPixelRatio,
    initialPixelRatio,
    ADAPTIVE_RESOLUTION_MAX_PIXEL_RATIO,
    'maximumPixelRatio',
  );
  const downshiftAverageFrameTimeMs = requireRange(
    config.downshiftAverageFrameTimeMs,
    1,
    250,
    'downshiftAverageFrameTimeMs',
  );
  const upshiftAverageFrameTimeMs = requireRange(
    config.upshiftAverageFrameTimeMs,
    1,
    250,
    'upshiftAverageFrameTimeMs',
  );
  if (upshiftAverageFrameTimeMs >= downshiftAverageFrameTimeMs) {
    throw new Error('Adaptive-resolution thresholds must leave a hysteresis gap.');
  }
  return {
    schemaVersion: ADAPTIVE_RESOLUTION_SCHEMA_VERSION,
    enabled: config.enabled === true,
    minimumPixelRatio,
    initialPixelRatio,
    maximumPixelRatio,
    downshiftStep: requireRange(config.downshiftStep, 0.025, 0.5, 'downshiftStep'),
    upshiftStep: requireRange(config.upshiftStep, 0.025, 0.5, 'upshiftStep'),
    evaluationWindowFrames: requireInteger(
      config.evaluationWindowFrames,
      10,
      600,
      'evaluationWindowFrames',
    ),
    downshiftAverageFrameTimeMs,
    upshiftAverageFrameTimeMs,
    downshiftWindows: requireInteger(config.downshiftWindows, 1, 20, 'downshiftWindows'),
    upshiftWindows: requireInteger(config.upshiftWindows, 1, 20, 'upshiftWindows'),
    cooldownMs: requireInteger(config.cooldownMs, 0, 60_000, 'cooldownMs'),
  };
}

export function createAdaptiveResolutionConfig(
  tier: PerformanceTier,
  devicePixelRatio: number,
): AdaptiveResolutionConfig {
  const boundedDevicePixelRatio = clamp(
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
    ADAPTIVE_RESOLUTION_MIN_PIXEL_RATIO,
    ADAPTIVE_RESOLUTION_MAX_PIXEL_RATIO,
  );
  const maximumPixelRatio = Math.min(tier.pixelRatio.maximum, boundedDevicePixelRatio);
  const minimumPixelRatio = Math.min(tier.pixelRatio.minimum, maximumPixelRatio);
  return validateAdaptiveResolutionConfig({
    schemaVersion: ADAPTIVE_RESOLUTION_SCHEMA_VERSION,
    enabled: tier.adaptiveResolutionEnabled,
    minimumPixelRatio,
    initialPixelRatio: clamp(tier.pixelRatio.initial, minimumPixelRatio, maximumPixelRatio),
    maximumPixelRatio,
    downshiftStep: tier.pixelRatio.downshiftStep,
    upshiftStep: tier.pixelRatio.upshiftStep,
    evaluationWindowFrames: tier.adaptation.evaluationWindowFrames,
    downshiftAverageFrameTimeMs: tier.adaptation.downshiftAverageFrameTimeMs,
    upshiftAverageFrameTimeMs: tier.adaptation.upshiftAverageFrameTimeMs,
    downshiftWindows: tier.adaptation.downshiftWindows,
    upshiftWindows: tier.adaptation.upshiftWindows,
    cooldownMs: tier.adaptation.cooldownMs,
  });
}

export class AdaptiveResolutionController {
  private readonly config: AdaptiveResolutionConfig;
  private readonly hooks: AdaptiveResolutionHooks;
  private readonly frameTimesMs: number[] = [];
  private pixelRatio: number;
  private enabled: boolean;
  private reducedMotion: boolean;
  private cooldownUntilMs = 0;
  private slowWindowStreak = 0;
  private fastWindowStreak = 0;

  public constructor(
    config: AdaptiveResolutionConfig,
    options: {
      hooks?: AdaptiveResolutionHooks;
      reducedMotion?: boolean;
    } = {},
  ) {
    this.config = validateAdaptiveResolutionConfig(config);
    this.hooks = options.hooks ?? {};
    this.pixelRatio = this.boundedPixelRatio(this.config.initialPixelRatio);
    this.enabled = this.config.enabled;
    this.reducedMotion = options.reducedMotion === true;
  }

  public recordFrame(frameTimeMs: number, nowMs: number): AdaptiveResolutionChange | null {
    if (
      !this.enabled
      || !Number.isFinite(frameTimeMs)
      || frameTimeMs <= 0
      || !Number.isFinite(nowMs)
      || nowMs < 0
    ) {
      return null;
    }
    this.frameTimesMs.push(clamp(frameTimeMs, 0.01, 10_000));
    if (this.frameTimesMs.length < this.config.evaluationWindowFrames) {
      return null;
    }

    const averageFrameTimeMs = this.frameTimesMs.reduce((total, value) => total + value, 0)
      / this.frameTimesMs.length;
    this.frameTimesMs.length = 0;
    if (nowMs < this.cooldownUntilMs) {
      this.resetWindowStreaks();
      return null;
    }

    if (averageFrameTimeMs >= this.config.downshiftAverageFrameTimeMs) {
      this.slowWindowStreak += 1;
      this.fastWindowStreak = 0;
      if (this.slowWindowStreak >= this.config.downshiftWindows) {
        return this.changePixelRatio('down', averageFrameTimeMs, nowMs);
      }
      return null;
    }
    if (averageFrameTimeMs <= this.config.upshiftAverageFrameTimeMs) {
      this.fastWindowStreak += 1;
      this.slowWindowStreak = 0;
      if (this.fastWindowStreak >= this.config.upshiftWindows) {
        return this.changePixelRatio('up', averageFrameTimeMs, nowMs);
      }
      return null;
    }
    this.resetWindowStreaks();
    return null;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.frameTimesMs.length = 0;
    this.resetWindowStreaks();
  }

  public setReducedMotion(reducedMotion: boolean): void {
    if (this.reducedMotion === reducedMotion) {
      return;
    }
    this.reducedMotion = reducedMotion;
    this.hooks.onReducedMotionChange?.({ reducedMotion });
  }

  public snapshot(): AdaptiveResolutionSnapshot {
    return {
      enabled: this.enabled,
      pixelRatio: this.pixelRatio,
      reducedMotion: this.reducedMotion,
      cooldownUntilMs: this.cooldownUntilMs,
      slowWindowStreak: this.slowWindowStreak,
      fastWindowStreak: this.fastWindowStreak,
      pendingFrameSamples: this.frameTimesMs.length,
    };
  }

  private changePixelRatio(
    direction: AdaptiveResolutionChange['direction'],
    averageFrameTimeMs: number,
    nowMs: number,
  ): AdaptiveResolutionChange | null {
    const previousPixelRatio = this.pixelRatio;
    const requestedPixelRatio = direction === 'down'
      ? previousPixelRatio - this.config.downshiftStep
      : previousPixelRatio + this.config.upshiftStep;
    const pixelRatio = this.boundedPixelRatio(requestedPixelRatio);
    this.resetWindowStreaks();
    if (pixelRatio === previousPixelRatio) {
      return null;
    }

    this.pixelRatio = pixelRatio;
    this.cooldownUntilMs = nowMs + this.config.cooldownMs;
    const change: AdaptiveResolutionChange = {
      direction,
      previousPixelRatio,
      pixelRatio,
      averageFrameTimeMs: Number(averageFrameTimeMs.toFixed(3)),
      observedAtMs: nowMs,
      cooldownUntilMs: this.cooldownUntilMs,
    };
    this.hooks.onPixelRatioChange?.(change);
    return change;
  }

  private resetWindowStreaks(): void {
    this.slowWindowStreak = 0;
    this.fastWindowStreak = 0;
  }

  private boundedPixelRatio(value: number): number {
    return clamp(
      rounded(clamp(value, this.config.minimumPixelRatio, this.config.maximumPixelRatio)),
      this.config.minimumPixelRatio,
      this.config.maximumPixelRatio,
    );
  }
}
