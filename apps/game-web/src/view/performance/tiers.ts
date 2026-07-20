export const PERFORMANCE_TIER_SCHEMA_VERSION = 'gw.performance-tier.v1' as const;
export const PERFORMANCE_TIER_IDS = ['performance', 'balanced', 'quality'] as const;
export type PerformanceTierId = (typeof PERFORMANCE_TIER_IDS)[number];
export type BackgroundDetail = 'reduced' | 'standard' | 'enhanced';

export interface PerformanceTier {
  schemaVersion: typeof PERFORMANCE_TIER_SCHEMA_VERSION;
  id: PerformanceTierId;
  targetFramesPerSecond: number;
  adaptiveResolutionEnabled: boolean;
  pixelRatio: {
    minimum: number;
    initial: number;
    maximum: number;
    downshiftStep: number;
    upshiftStep: number;
  };
  adaptation: {
    evaluationWindowFrames: number;
    downshiftAverageFrameTimeMs: number;
    upshiftAverageFrameTimeMs: number;
    downshiftWindows: number;
    upshiftWindows: number;
    cooldownMs: number;
  };
  visuals: {
    particleDensityScale: number;
    backgroundDetail: BackgroundDetail;
    bloomEnabled: boolean;
    distortionEnabled: boolean;
    maxDynamicLights: number;
  };
}

export interface PerformanceTierOverride {
  targetFramesPerSecond?: number;
  adaptiveResolutionEnabled?: boolean;
  pixelRatio?: Partial<PerformanceTier['pixelRatio']>;
  adaptation?: Partial<PerformanceTier['adaptation']>;
  visuals?: Partial<PerformanceTier['visuals']>;
}

export type PerformanceTierOverrides = Partial<Record<PerformanceTierId, PerformanceTierOverride>>;
export type PerformanceTierCatalog = Readonly<Record<PerformanceTierId, PerformanceTier>>;

const MIN_PIXEL_RATIO = 0.25;
const MAX_PIXEL_RATIO = 2;

const BASE_TIERS: Record<PerformanceTierId, Omit<PerformanceTier, 'schemaVersion' | 'id'>> = {
  performance: {
    targetFramesPerSecond: 60,
    adaptiveResolutionEnabled: true,
    pixelRatio: {
      minimum: 0.5,
      initial: 0.75,
      maximum: 1,
      downshiftStep: 0.125,
      upshiftStep: 0.0625,
    },
    adaptation: {
      evaluationWindowFrames: 45,
      downshiftAverageFrameTimeMs: 20,
      upshiftAverageFrameTimeMs: 14,
      downshiftWindows: 2,
      upshiftWindows: 5,
      cooldownMs: 2_500,
    },
    visuals: {
      particleDensityScale: 0.5,
      backgroundDetail: 'reduced',
      bloomEnabled: false,
      distortionEnabled: false,
      maxDynamicLights: 1,
    },
  },
  balanced: {
    targetFramesPerSecond: 60,
    adaptiveResolutionEnabled: true,
    pixelRatio: {
      minimum: 0.625,
      initial: 1,
      maximum: 1.25,
      downshiftStep: 0.125,
      upshiftStep: 0.0625,
    },
    adaptation: {
      evaluationWindowFrames: 60,
      downshiftAverageFrameTimeMs: 20,
      upshiftAverageFrameTimeMs: 14.5,
      downshiftWindows: 2,
      upshiftWindows: 4,
      cooldownMs: 3_000,
    },
    visuals: {
      particleDensityScale: 0.75,
      backgroundDetail: 'standard',
      bloomEnabled: true,
      distortionEnabled: true,
      maxDynamicLights: 2,
    },
  },
  quality: {
    targetFramesPerSecond: 60,
    adaptiveResolutionEnabled: true,
    pixelRatio: {
      minimum: 0.75,
      initial: 1.25,
      maximum: 1.5,
      downshiftStep: 0.125,
      upshiftStep: 0.0625,
    },
    adaptation: {
      evaluationWindowFrames: 60,
      downshiftAverageFrameTimeMs: 21,
      upshiftAverageFrameTimeMs: 14,
      downshiftWindows: 2,
      upshiftWindows: 5,
      cooldownMs: 3_500,
    },
    visuals: {
      particleDensityScale: 1,
      backgroundDetail: 'enhanced',
      bloomEnabled: true,
      distortionEnabled: true,
      maxDynamicLights: 3,
    },
  },
};

function finiteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return value;
}

function integerInRange(value: unknown, minimum: number, maximum: number, fieldName: string): number {
  const parsed = finiteNumber(value, fieldName);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function numberInRange(value: unknown, minimum: number, maximum: number, fieldName: string): number {
  const parsed = finiteNumber(value, fieldName);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${fieldName} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }
  return value;
}

function buildTier(id: PerformanceTierId, override: PerformanceTierOverride = {}): PerformanceTier {
  const base = BASE_TIERS[id];
  const candidate: PerformanceTier = {
    schemaVersion: PERFORMANCE_TIER_SCHEMA_VERSION,
    id,
    targetFramesPerSecond: override.targetFramesPerSecond ?? base.targetFramesPerSecond,
    adaptiveResolutionEnabled: override.adaptiveResolutionEnabled ?? base.adaptiveResolutionEnabled,
    pixelRatio: { ...base.pixelRatio, ...override.pixelRatio },
    adaptation: { ...base.adaptation, ...override.adaptation },
    visuals: { ...base.visuals, ...override.visuals },
  };

  candidate.targetFramesPerSecond = integerInRange(
    candidate.targetFramesPerSecond,
    30,
    240,
    `${id}.targetFramesPerSecond`,
  );
  candidate.adaptiveResolutionEnabled = requireBoolean(
    candidate.adaptiveResolutionEnabled,
    `${id}.adaptiveResolutionEnabled`,
  );
  candidate.pixelRatio.minimum = numberInRange(
    candidate.pixelRatio.minimum,
    MIN_PIXEL_RATIO,
    MAX_PIXEL_RATIO,
    `${id}.pixelRatio.minimum`,
  );
  candidate.pixelRatio.initial = numberInRange(
    candidate.pixelRatio.initial,
    candidate.pixelRatio.minimum,
    MAX_PIXEL_RATIO,
    `${id}.pixelRatio.initial`,
  );
  candidate.pixelRatio.maximum = numberInRange(
    candidate.pixelRatio.maximum,
    candidate.pixelRatio.initial,
    MAX_PIXEL_RATIO,
    `${id}.pixelRatio.maximum`,
  );
  candidate.pixelRatio.downshiftStep = numberInRange(
    candidate.pixelRatio.downshiftStep,
    0.025,
    0.5,
    `${id}.pixelRatio.downshiftStep`,
  );
  candidate.pixelRatio.upshiftStep = numberInRange(
    candidate.pixelRatio.upshiftStep,
    0.025,
    0.5,
    `${id}.pixelRatio.upshiftStep`,
  );
  candidate.adaptation.evaluationWindowFrames = integerInRange(
    candidate.adaptation.evaluationWindowFrames,
    10,
    600,
    `${id}.adaptation.evaluationWindowFrames`,
  );
  candidate.adaptation.downshiftAverageFrameTimeMs = numberInRange(
    candidate.adaptation.downshiftAverageFrameTimeMs,
    5,
    250,
    `${id}.adaptation.downshiftAverageFrameTimeMs`,
  );
  candidate.adaptation.upshiftAverageFrameTimeMs = numberInRange(
    candidate.adaptation.upshiftAverageFrameTimeMs,
    1,
    100,
    `${id}.adaptation.upshiftAverageFrameTimeMs`,
  );
  if (
    candidate.adaptation.upshiftAverageFrameTimeMs
    >= candidate.adaptation.downshiftAverageFrameTimeMs
  ) {
    throw new Error(`${id} adaptive-resolution thresholds must leave a hysteresis gap.`);
  }
  candidate.adaptation.downshiftWindows = integerInRange(
    candidate.adaptation.downshiftWindows,
    1,
    20,
    `${id}.adaptation.downshiftWindows`,
  );
  candidate.adaptation.upshiftWindows = integerInRange(
    candidate.adaptation.upshiftWindows,
    1,
    20,
    `${id}.adaptation.upshiftWindows`,
  );
  candidate.adaptation.cooldownMs = integerInRange(
    candidate.adaptation.cooldownMs,
    0,
    60_000,
    `${id}.adaptation.cooldownMs`,
  );
  candidate.visuals.particleDensityScale = numberInRange(
    candidate.visuals.particleDensityScale,
    0,
    2,
    `${id}.visuals.particleDensityScale`,
  );
  candidate.visuals.maxDynamicLights = integerInRange(
    candidate.visuals.maxDynamicLights,
    0,
    16,
    `${id}.visuals.maxDynamicLights`,
  );
  candidate.visuals.bloomEnabled = requireBoolean(
    candidate.visuals.bloomEnabled,
    `${id}.visuals.bloomEnabled`,
  );
  candidate.visuals.distortionEnabled = requireBoolean(
    candidate.visuals.distortionEnabled,
    `${id}.visuals.distortionEnabled`,
  );
  if (!['reduced', 'standard', 'enhanced'].includes(candidate.visuals.backgroundDetail)) {
    throw new Error(`${id}.visuals.backgroundDetail is unsupported.`);
  }
  return candidate;
}

export function createPerformanceTierCatalog(
  overrides: PerformanceTierOverrides = {},
): PerformanceTierCatalog {
  return {
    performance: buildTier('performance', overrides.performance),
    balanced: buildTier('balanced', overrides.balanced),
    quality: buildTier('quality', overrides.quality),
  };
}

export const DEFAULT_PERFORMANCE_TIERS = createPerformanceTierCatalog();

export function resolvePerformanceTier(
  id: unknown,
  catalog: PerformanceTierCatalog = DEFAULT_PERFORMANCE_TIERS,
): PerformanceTier {
  const resolvedId = typeof id === 'string' && PERFORMANCE_TIER_IDS.includes(id as PerformanceTierId)
    ? id as PerformanceTierId
    : 'balanced';
  const tier = catalog[resolvedId];
  return {
    ...tier,
    pixelRatio: { ...tier.pixelRatio },
    adaptation: { ...tier.adaptation },
    visuals: { ...tier.visuals },
  };
}
