import { describe, expect, test, vi } from 'vitest';
import {
  ADAPTIVE_RESOLUTION_SCHEMA_VERSION,
  AdaptiveResolutionController,
  createAdaptiveResolutionConfig,
  type AdaptiveResolutionConfig,
} from './adaptiveResolution';
import { createPerformanceTierCatalog } from './tiers';

function createConfig(overrides: Partial<AdaptiveResolutionConfig> = {}): AdaptiveResolutionConfig {
  return {
    schemaVersion: ADAPTIVE_RESOLUTION_SCHEMA_VERSION,
    enabled: true,
    minimumPixelRatio: 0.5,
    initialPixelRatio: 1,
    maximumPixelRatio: 1.25,
    downshiftStep: 0.125,
    upshiftStep: 0.0625,
    evaluationWindowFrames: 10,
    downshiftAverageFrameTimeMs: 20,
    upshiftAverageFrameTimeMs: 14,
    downshiftWindows: 2,
    upshiftWindows: 2,
    cooldownMs: 1_000,
    ...overrides,
  };
}

function recordWindow(
  controller: AdaptiveResolutionController,
  frameTimeMs: number,
  completedAtMs: number,
) {
  let change = null;
  for (let frame = 0; frame < 10; frame += 1) {
    change = controller.recordFrame(frameTimeMs, completedAtMs - 9 + frame) ?? change;
  }
  return change;
}

describe('adaptive resolution controller', () => {
  test('downshifts only after sustained slow windows', () => {
    const onPixelRatioChange = vi.fn();
    const controller = new AdaptiveResolutionController(createConfig(), {
      hooks: { onPixelRatioChange },
    });

    expect(recordWindow(controller, 24, 100)).toBeNull();
    expect(controller.snapshot().pixelRatio).toBe(1);
    const change = recordWindow(controller, 24, 200);

    expect(change).toMatchObject({
      direction: 'down',
      previousPixelRatio: 1,
      pixelRatio: 0.875,
      averageFrameTimeMs: 24,
      observedAtMs: 200,
      cooldownUntilMs: 1_200,
    });
    expect(onPixelRatioChange).toHaveBeenCalledWith(change);
  });

  test('uses a hysteresis band and resets a slow streak when performance stabilises', () => {
    const controller = new AdaptiveResolutionController(createConfig());

    recordWindow(controller, 24, 100);
    expect(controller.snapshot().slowWindowStreak).toBe(1);
    recordWindow(controller, 17, 200);
    expect(controller.snapshot()).toMatchObject({ slowWindowStreak: 0, fastWindowStreak: 0 });
    expect(recordWindow(controller, 24, 300)).toBeNull();
    expect(controller.snapshot().pixelRatio).toBe(1);
  });

  test('does not cascade changes during cooldown and remains within configured bounds', () => {
    const controller = new AdaptiveResolutionController(createConfig({
      minimumPixelRatio: 0.875,
      maximumPixelRatio: 1,
    }));
    recordWindow(controller, 24, 100);
    expect(recordWindow(controller, 24, 200)?.pixelRatio).toBe(0.875);

    recordWindow(controller, 24, 400);
    recordWindow(controller, 24, 600);
    expect(controller.snapshot().pixelRatio).toBe(0.875);
    expect(recordWindow(controller, 24, 1_300)).toBeNull();
    expect(recordWindow(controller, 24, 1_400)).toBeNull();
    expect(controller.snapshot().pixelRatio).toBe(0.875);
  });

  test('upshifts conservatively after cooldown and sustained fast windows', () => {
    const controller = new AdaptiveResolutionController(createConfig());
    recordWindow(controller, 24, 100);
    recordWindow(controller, 24, 200);

    expect(recordWindow(controller, 10, 1_300)).toBeNull();
    const change = recordWindow(controller, 10, 1_400);
    expect(change).toMatchObject({ direction: 'up', pixelRatio: 0.9375 });
  });

  test('ignores malformed samples and exposes reduced-motion changes through a hook', () => {
    const onReducedMotionChange = vi.fn();
    const controller = new AdaptiveResolutionController(createConfig(), {
      hooks: { onReducedMotionChange },
    });

    controller.recordFrame(Number.NaN, 1);
    controller.recordFrame(-1, 2);
    controller.recordFrame(16, Number.NaN);
    controller.setReducedMotion(true);
    controller.setReducedMotion(true);

    expect(controller.snapshot()).toMatchObject({
      pendingFrameSamples: 0,
      reducedMotion: true,
    });
    expect(onReducedMotionChange).toHaveBeenCalledOnce();
    expect(onReducedMotionChange).toHaveBeenCalledWith({ reducedMotion: true });
  });

  test('derives a device-bounded policy from a configurable tier', () => {
    const tier = createPerformanceTierCatalog({
      quality: { pixelRatio: { minimum: 0.75, initial: 1.25, maximum: 1.5 } },
    }).quality;

    expect(createAdaptiveResolutionConfig(tier, 1)).toMatchObject({
      minimumPixelRatio: 0.75,
      initialPixelRatio: 1,
      maximumPixelRatio: 1,
    });
  });

  test('rejects policies without a valid hysteresis gap', () => {
    expect(() => new AdaptiveResolutionController(createConfig({
      upshiftAverageFrameTimeMs: 20,
      downshiftAverageFrameTimeMs: 20,
    }))).toThrow(/hysteresis gap/);
  });
});
