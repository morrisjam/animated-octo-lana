export const RENDERER_CAPABILITY_SCHEMA_VERSION = 'gw.renderer-capabilities.v1' as const;

export type RendererApi = 'webgl1' | 'webgl2' | 'unavailable' | 'unknown';
export type DevicePixelRatioBucket = '1x' | '1.5x' | '2x' | 'over_2x' | 'unknown';
export type LogicalProcessorBucket = '1-2' | '3-4' | '5-8' | '9-16' | '17+' | 'unknown';
export type DeviceMemoryBucket = '2_gib_or_less' | '3-4_gib' | '5-8_gib' | '9-16_gib' | 'over_16_gib' | 'unknown';

export interface RendererCapabilityProbe {
  api?: unknown;
  maxTextureSize?: unknown;
  maxRenderbufferSize?: unknown;
  maxTextureUnits?: unknown;
  maxSamples?: unknown;
  anisotropicFiltering?: unknown;
  floatTextures?: unknown;
  halfFloatTextures?: unknown;
  depthTextures?: unknown;
  compressedAstc?: unknown;
  compressedEtc?: unknown;
  compressedS3tc?: unknown;
  devicePixelRatio?: unknown;
  logicalProcessors?: unknown;
  deviceMemoryGiB?: unknown;
  reducedMotionPreferred?: unknown;
}

export interface RendererCapabilitySummary {
  schemaVersion: typeof RENDERER_CAPABILITY_SCHEMA_VERSION;
  renderer: {
    api: RendererApi;
    limits: {
      maxTextureSize: number | null;
      maxRenderbufferSize: number | null;
      maxTextureUnits: number | null;
      maxSamples: number | null;
    };
    features: {
      anisotropicFiltering: boolean;
      floatTextures: boolean;
      halfFloatTextures: boolean;
      depthTextures: boolean;
      compressedAstc: boolean;
      compressedEtc: boolean;
      compressedS3tc: boolean;
    };
  };
  device: {
    pixelRatioBucket: DevicePixelRatioBucket;
    logicalProcessorBucket: LogicalProcessorBucket;
    memoryBucket: DeviceMemoryBucket;
    reducedMotionPreferred: boolean;
  };
}

const RENDERER_APIS = new Set<RendererApi>(['webgl1', 'webgl2', 'unavailable', 'unknown']);

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = asFiniteNumber(value);
  if (parsed === null) {
    return null;
  }
  return Math.round(Math.max(minimum, Math.min(maximum, parsed)));
}

function rendererApi(value: unknown): RendererApi {
  return typeof value === 'string' && RENDERER_APIS.has(value as RendererApi)
    ? value as RendererApi
    : 'unknown';
}

function pixelRatioBucket(value: unknown): DevicePixelRatioBucket {
  const ratio = asFiniteNumber(value);
  if (ratio === null || ratio <= 0) {
    return 'unknown';
  }
  if (ratio <= 1) {
    return '1x';
  }
  if (ratio <= 1.5) {
    return '1.5x';
  }
  if (ratio <= 2) {
    return '2x';
  }
  return 'over_2x';
}

function logicalProcessorBucket(value: unknown): LogicalProcessorBucket {
  const count = boundedInteger(value, 1, 1024);
  if (count === null) {
    return 'unknown';
  }
  if (count <= 2) {
    return '1-2';
  }
  if (count <= 4) {
    return '3-4';
  }
  if (count <= 8) {
    return '5-8';
  }
  if (count <= 16) {
    return '9-16';
  }
  return '17+';
}

function deviceMemoryBucket(value: unknown): DeviceMemoryBucket {
  const memoryGiB = asFiniteNumber(value);
  if (memoryGiB === null || memoryGiB <= 0) {
    return 'unknown';
  }
  if (memoryGiB <= 2) {
    return '2_gib_or_less';
  }
  if (memoryGiB <= 4) {
    return '3-4_gib';
  }
  if (memoryGiB <= 8) {
    return '5-8_gib';
  }
  if (memoryGiB <= 16) {
    return '9-16_gib';
  }
  return 'over_16_gib';
}

export function buildRendererCapabilitySummary(
  probe: RendererCapabilityProbe = {},
): RendererCapabilitySummary {
  return {
    schemaVersion: RENDERER_CAPABILITY_SCHEMA_VERSION,
    renderer: {
      api: rendererApi(probe.api),
      limits: {
        maxTextureSize: boundedInteger(probe.maxTextureSize, 0, 131_072),
        maxRenderbufferSize: boundedInteger(probe.maxRenderbufferSize, 0, 131_072),
        maxTextureUnits: boundedInteger(probe.maxTextureUnits, 0, 1_024),
        maxSamples: boundedInteger(probe.maxSamples, 0, 256),
      },
      features: {
        anisotropicFiltering: probe.anisotropicFiltering === true,
        floatTextures: probe.floatTextures === true,
        halfFloatTextures: probe.halfFloatTextures === true,
        depthTextures: probe.depthTextures === true,
        compressedAstc: probe.compressedAstc === true,
        compressedEtc: probe.compressedEtc === true,
        compressedS3tc: probe.compressedS3tc === true,
      },
    },
    device: {
      pixelRatioBucket: pixelRatioBucket(probe.devicePixelRatio),
      logicalProcessorBucket: logicalProcessorBucket(probe.logicalProcessors),
      memoryBucket: deviceMemoryBucket(probe.deviceMemoryGiB),
      reducedMotionPreferred: probe.reducedMotionPreferred === true,
    },
  };
}

export function cloneRendererCapabilitySummary(
  summary: RendererCapabilitySummary,
): RendererCapabilitySummary {
  return buildRendererCapabilitySummary({
    api: summary.renderer.api,
    maxTextureSize: summary.renderer.limits.maxTextureSize,
    maxRenderbufferSize: summary.renderer.limits.maxRenderbufferSize,
    maxTextureUnits: summary.renderer.limits.maxTextureUnits,
    maxSamples: summary.renderer.limits.maxSamples,
    anisotropicFiltering: summary.renderer.features.anisotropicFiltering,
    floatTextures: summary.renderer.features.floatTextures,
    halfFloatTextures: summary.renderer.features.halfFloatTextures,
    depthTextures: summary.renderer.features.depthTextures,
    compressedAstc: summary.renderer.features.compressedAstc,
    compressedEtc: summary.renderer.features.compressedEtc,
    compressedS3tc: summary.renderer.features.compressedS3tc,
    devicePixelRatio: {
      '1x': 1,
      '1.5x': 1.5,
      '2x': 2,
      'over_2x': 3,
      unknown: undefined,
    }[summary.device.pixelRatioBucket],
    logicalProcessors: {
      '1-2': 2,
      '3-4': 4,
      '5-8': 8,
      '9-16': 16,
      '17+': 17,
      unknown: undefined,
    }[summary.device.logicalProcessorBucket],
    deviceMemoryGiB: {
      '2_gib_or_less': 2,
      '3-4_gib': 4,
      '5-8_gib': 8,
      '9-16_gib': 16,
      'over_16_gib': 32,
      unknown: undefined,
    }[summary.device.memoryBucket],
    reducedMotionPreferred: summary.device.reducedMotionPreferred,
  });
}
