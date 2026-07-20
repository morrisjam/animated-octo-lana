import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PERFORMANCE_TIERS,
  PERFORMANCE_TIER_SCHEMA_VERSION,
  createPerformanceTierCatalog,
  resolvePerformanceTier,
} from './tiers';

describe('performance tiers', () => {
  test('provide increasingly expensive bounded visual budgets', () => {
    const performance = DEFAULT_PERFORMANCE_TIERS.performance;
    const balanced = DEFAULT_PERFORMANCE_TIERS.balanced;
    const quality = DEFAULT_PERFORMANCE_TIERS.quality;

    expect(performance.schemaVersion).toBe(PERFORMANCE_TIER_SCHEMA_VERSION);
    expect(performance.pixelRatio.minimum).toBeGreaterThanOrEqual(0.25);
    expect(quality.pixelRatio.maximum).toBeLessThanOrEqual(2);
    expect(performance.pixelRatio.maximum).toBeLessThan(balanced.pixelRatio.maximum);
    expect(balanced.pixelRatio.maximum).toBeLessThan(quality.pixelRatio.maximum);
    expect(performance.visuals.particleDensityScale).toBeLessThan(quality.visuals.particleDensityScale);
  });

  test('supports validated project-specific overrides', () => {
    const catalog = createPerformanceTierCatalog({
      balanced: {
        pixelRatio: { initial: 0.9, maximum: 1.1 },
        adaptation: { cooldownMs: 5_000 },
        visuals: { particleDensityScale: 0.6, distortionEnabled: false },
      },
    });

    expect(catalog.balanced.pixelRatio).toMatchObject({ initial: 0.9, maximum: 1.1 });
    expect(catalog.balanced.adaptation.cooldownMs).toBe(5_000);
    expect(catalog.balanced.visuals).toMatchObject({
      particleDensityScale: 0.6,
      distortionEnabled: false,
    });
    expect(catalog.performance).toEqual(DEFAULT_PERFORMANCE_TIERS.performance);
  });

  test('rejects invalid bounds and thresholds without silently producing unstable policies', () => {
    expect(() => createPerformanceTierCatalog({
      balanced: { pixelRatio: { minimum: 1.2, initial: 1 } },
    })).toThrow(/pixelRatio.initial/);
    expect(() => createPerformanceTierCatalog({
      balanced: {
        adaptation: {
          upshiftAverageFrameTimeMs: 21,
          downshiftAverageFrameTimeMs: 20,
        },
      },
    })).toThrow(/hysteresis gap/);
    expect(() => createPerformanceTierCatalog({
      quality: { visuals: { bloomEnabled: 'yes' as never } },
    })).toThrow(/bloomEnabled must be a boolean/);
  });

  test('falls back to a cloned balanced tier for unknown persisted values', () => {
    const resolved = resolvePerformanceTier('future-tier');
    resolved.pixelRatio.initial = 0.75;

    expect(resolved.id).toBe('balanced');
    expect(DEFAULT_PERFORMANCE_TIERS.balanced.pixelRatio.initial).toBe(1);
  });
});
