import type * as THREE from 'three';
import type { ReplayPayload } from '../sim/replay';
import type { BrowserPerformanceRuntimeSnapshot } from '../view/performance/browserRuntime';
import { buildRendererCapabilitySummary } from './capabilities';
import { buildCrashBundle, type BuildCrashBundleInput } from './crashBundle';
import { createBrowserCrashBundleExporter, exportCrashBundle } from './crashBundleExport';

export interface BrowserSupportBundleOptions {
  renderer: THREE.WebGLRenderer;
  identity: BuildCrashBundleInput['identity'];
  failure: BuildCrashBundleInput['failure'];
  settings: unknown;
  recentAcceptedInputs: readonly unknown[];
  recentEvents: readonly unknown[];
  replay: ReplayPayload | null;
  performance: BrowserPerformanceRuntimeSnapshot | null;
}

function rendererCapabilities(renderer: THREE.WebGLRenderer) {
  const context = renderer.getContext();
  const extension = (name: string): boolean => Boolean(context.getExtension(name));
  const device = navigator as Navigator & { deviceMemory?: number };
  return buildRendererCapabilitySummary({
    api: renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1',
    maxTextureSize: renderer.capabilities.maxTextureSize,
    maxRenderbufferSize: context.getParameter(context.MAX_RENDERBUFFER_SIZE),
    maxTextureUnits: renderer.capabilities.maxTextures,
    maxSamples: renderer.capabilities.maxSamples,
    anisotropicFiltering: renderer.capabilities.getMaxAnisotropy() > 1,
    floatTextures: renderer.capabilities.isWebGL2 || extension('OES_texture_float'),
    halfFloatTextures: renderer.capabilities.isWebGL2 || extension('OES_texture_half_float'),
    depthTextures: renderer.capabilities.isWebGL2 || extension('WEBGL_depth_texture'),
    compressedAstc: extension('WEBGL_compressed_texture_astc'),
    compressedEtc: extension('WEBGL_compressed_texture_etc'),
    compressedS3tc: extension('WEBGL_compressed_texture_s3tc'),
    devicePixelRatio: window.devicePixelRatio,
    logicalProcessors: navigator.hardwareConcurrency,
    deviceMemoryGiB: device.deviceMemory,
    reducedMotionPreferred: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  });
}

function replayReference(replay: ReplayPayload | null): unknown {
  if (!replay) {
    return null;
  }
  return {
    payloadVersion: replay.header.payloadVersion,
    integrityAlgorithm: replay.integrity?.algorithm ?? 'none',
    integrityDigest: replay.integrity?.digest ?? null,
    frameCount: replay.inputTimeline.length,
    lastRecordedFrame: replay.inputTimeline.length > 0 ? replay.inputTimeline.length - 1 : null,
  };
}

export async function exportBrowserSupportBundle(
  options: BrowserSupportBundleOptions,
): Promise<string> {
  const performance = options.performance ?? {
    tierId: 'unknown',
    adaptiveResolutionEnabled: false,
    reducedMotion: false,
    pixelRatio: options.renderer.getPixelRatio(),
    samples: [],
  };
  const bundle = buildCrashBundle({
    identity: options.identity,
    failure: options.failure,
    settings: options.settings,
    recentAcceptedInputs: options.recentAcceptedInputs,
    recentEvents: options.recentEvents,
    replay: replayReference(options.replay),
    capabilities: rendererCapabilities(options.renderer),
    performance,
  });
  const file = await exportCrashBundle(bundle, createBrowserCrashBundleExporter());
  return `Exported ${file.fileName} (${Math.max(1, Math.ceil(file.byteLength / 1_024))} KiB).`;
}
