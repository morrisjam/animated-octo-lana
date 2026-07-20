import { describe, expect, test } from 'vitest';
import {
  RENDERER_CAPABILITY_SCHEMA_VERSION,
  buildRendererCapabilitySummary,
  cloneRendererCapabilitySummary,
} from './capabilities';

describe('renderer capability summary', () => {
  test('keeps useful renderer limits while bucketing device characteristics', () => {
    const summary = buildRendererCapabilitySummary({
      api: 'webgl2',
      maxTextureSize: 16_384,
      maxRenderbufferSize: 16_384,
      maxTextureUnits: 32,
      maxSamples: 4,
      anisotropicFiltering: true,
      floatTextures: true,
      compressedAstc: true,
      devicePixelRatio: 1.75,
      logicalProcessors: 12,
      deviceMemoryGiB: 8,
      reducedMotionPreferred: true,
    });

    expect(summary).toEqual({
      schemaVersion: RENDERER_CAPABILITY_SCHEMA_VERSION,
      renderer: {
        api: 'webgl2',
        limits: {
          maxTextureSize: 16_384,
          maxRenderbufferSize: 16_384,
          maxTextureUnits: 32,
          maxSamples: 4,
        },
        features: {
          anisotropicFiltering: true,
          floatTextures: true,
          halfFloatTextures: false,
          depthTextures: false,
          compressedAstc: true,
          compressedEtc: false,
          compressedS3tc: false,
        },
      },
      device: {
        pixelRatioBucket: '2x',
        logicalProcessorBucket: '9-16',
        memoryBucket: '5-8_gib',
        reducedMotionPreferred: true,
      },
    });
  });

  test('does not expose renderer names, user agents, or exact hardware counts', () => {
    const raw = {
      api: 'webgl2',
      logicalProcessors: 24,
      deviceMemoryGiB: 32,
      vendor: 'Sensitive GPU vendor',
      rendererName: 'Specific renderer model',
      userAgent: 'Specific browser build',
    };
    const serialized = JSON.stringify(buildRendererCapabilitySummary(raw));

    expect(serialized).toContain('17+');
    expect(serialized).toContain('over_16_gib');
    expect(serialized).not.toContain('Sensitive GPU vendor');
    expect(serialized).not.toContain('Specific renderer model');
    expect(serialized).not.toContain('Specific browser build');
  });

  test('clones through the same allowlist and does not retain additional properties', () => {
    const summary = buildRendererCapabilitySummary({ api: 'webgl1' }) as ReturnType<typeof buildRendererCapabilitySummary> & {
      accountId?: string;
    };
    summary.accountId = 'private-account';

    expect(cloneRendererCapabilitySummary(summary)).not.toHaveProperty('accountId');
  });
});
