import {
  AdaptiveResolutionController,
  createAdaptiveResolutionConfig,
} from './adaptiveResolution';
import { PerformanceSampleBuffer, type PerformanceSample } from './samples';
import { resolvePerformanceTier, type PerformanceTierId } from './tiers';

export interface RendererPerformanceCounts {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface BrowserPerformanceRuntimeOptions {
  tierId?: PerformanceTierId;
  devicePixelRatio?: number;
  getRendererCounts(): RendererPerformanceCounts;
  onPixelRatioChange(pixelRatio: number): void;
  onReducedMotionChange?(reducedMotion: boolean): void;
}

export interface BrowserPerformanceRuntimeSnapshot {
  tierId: PerformanceTierId;
  adaptiveResolutionEnabled: boolean;
  reducedMotion: boolean;
  pixelRatio: number;
  samples: PerformanceSample[];
}

export interface BrowserPerformanceRuntime {
  recordFrame(frameTimeMs: number, nowMs: number): void;
  snapshot(): BrowserPerformanceRuntimeSnapshot;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

function percentile95(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

export function createBrowserPerformanceRuntime(
  options: BrowserPerformanceRuntimeOptions,
): BrowserPerformanceRuntime {
  const tier = resolvePerformanceTier(options.tierId);
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  const samples = new PerformanceSampleBuffer();
  const frameWindow: number[] = [];
  const startedAtMs = performance.now();
  let sampleWindowStartedAtMs = startedAtMs;
  let suspended = false;
  const controller = new AdaptiveResolutionController(
    createAdaptiveResolutionConfig(tier, options.devicePixelRatio ?? window.devicePixelRatio),
    {
      reducedMotion: media?.matches ?? false,
      hooks: {
        onPixelRatioChange: ({ pixelRatio }) => options.onPixelRatioChange(pixelRatio),
        onReducedMotionChange: ({ reducedMotion }) => options.onReducedMotionChange?.(reducedMotion),
      },
    },
  );

  const onMediaChange = (event: MediaQueryListEvent): void => {
    controller.setReducedMotion(event.matches);
  };
  media?.addEventListener('change', onMediaChange);
  options.onPixelRatioChange(controller.snapshot().pixelRatio);
  options.onReducedMotionChange?.(controller.snapshot().reducedMotion);

  return {
    recordFrame(frameTimeMs: number, nowMs: number): void {
      if (suspended || !Number.isFinite(frameTimeMs) || frameTimeMs <= 0 || frameTimeMs > 250) {
        frameWindow.length = 0;
        sampleWindowStartedAtMs = nowMs;
        return;
      }
      controller.recordFrame(frameTimeMs, nowMs);
      frameWindow.push(frameTimeMs);
      if (nowMs - sampleWindowStartedAtMs < 1_000 || frameWindow.length === 0) {
        return;
      }
      const meanFrameTimeMs = frameWindow.reduce((total, value) => total + value, 0) / frameWindow.length;
      const renderer = options.getRendererCounts();
      samples.record({
        elapsedMs: nowMs - startedAtMs,
        frameTimeMs: meanFrameTimeMs,
        p95FrameTimeMs: percentile95(frameWindow),
        framesPerSecond: 1_000 / meanFrameTimeMs,
        pixelRatio: controller.snapshot().pixelRatio,
        ...renderer,
      });
      frameWindow.length = 0;
      sampleWindowStartedAtMs = nowMs;
    },
    snapshot(): BrowserPerformanceRuntimeSnapshot {
      const adaptive = controller.snapshot();
      return {
        tierId: tier.id,
        adaptiveResolutionEnabled: adaptive.enabled,
        reducedMotion: adaptive.reducedMotion,
        pixelRatio: adaptive.pixelRatio,
        samples: samples.snapshot(),
      };
    },
    suspend(): void {
      suspended = true;
      frameWindow.length = 0;
      controller.setEnabled(false);
    },
    resume(): void {
      suspended = false;
      sampleWindowStartedAtMs = performance.now();
      controller.setEnabled(tier.adaptiveResolutionEnabled);
    },
    dispose(): void {
      media?.removeEventListener('change', onMediaChange);
    },
  };
}
