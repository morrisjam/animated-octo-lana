import { describe, expect, test, vi } from 'vitest';
import { buildRendererCapabilitySummary } from './capabilities';
import {
  CRASH_BUNDLE_SCHEMA_VERSION,
  MAX_CRASH_BUNDLE_ACCEPTED_INPUTS,
  MAX_CRASH_BUNDLE_EVENTS,
  MAX_CRASH_BUNDLE_PERFORMANCE_SAMPLES,
  assertCrashBundlePrivacySafe,
  buildCrashBundle,
  type BuildCrashBundleInput,
} from './crashBundle';
import {
  createCrashBundleExportFile,
  exportCrashBundle,
} from './crashBundleExport';

function createInput(overrides: Partial<BuildCrashBundleInput> = {}): BuildCrashBundleInput {
  return {
    capturedAt: '2026-07-20T12:34:56.789Z',
    identity: {
      buildId: '0123456789abcdef0123456789abcdef01234567',
      rulesetVersion: 'prototype-2026.02+default',
      balanceProfileId: 'default',
      tuningFingerprint: 'fnv1a32:11223344',
      characterBalanceFingerprint: 'fnv1a32:55667788',
      characterRegistryFingerprint: 'fnv1a32:99aabbcc',
    },
    failure: {
      category: 'renderer',
      phase: 'playing',
      code: 'webgl_context_lost',
      recoverable: true,
      message: 'must not be copied',
    },
    settings: {
      mode: 'cpu_vs_cpu',
      menuThemeId: 'rift',
      stageAtmosphereId: 'wormhole',
      loadout: { P1: 'vanguard', P2: 'duelist' },
      aiDifficulty: 'veteran',
      arcade: { continues: 2, retryEnabled: true },
      audio: {
        masterVolume: 2,
        musicVolume: 0.7,
        sfxVolume: 0.8,
        voiceVolume: -1,
        voiceDuckingEnabled: true,
        dynamicRangeMode: 'reduced',
        subtitlesEnabled: true,
      },
      graphics: { performanceTier: 'balanced', adaptiveResolutionEnabled: true },
      accessibility: {
        reducedMotion: true,
        screenShakeStrength: 0.25,
        photosensitivityMode: true,
        colorVisionMode: 'deuteranopia',
      },
      accountId: 'private-account',
      email: 'pilot@example.com',
      authToken: 'secret-token',
      networkAddress: '203.0.113.42',
      logs: ['private log text'],
    },
    recentAcceptedInputs: [
      { frame: 41, player: 'P1', action: 'boost', source: 'human', accountId: 'private-account' },
      { frame: 42, player: 'P2', action: 'launch', source: 'ai', note: 'free-form note' },
    ],
    recentEvents: [
      { type: 'action_accepted', frame: 42, player: 'P2', count: 1, message: 'private log text' },
      { type: 'checksum_mismatch', frame: 43, checksum: 0xffff_ffff },
    ],
    replay: {
      payloadVersion: 1,
      integrityAlgorithm: 'SHA-256',
      integrityDigest: 'abcdef0123456789',
      frameCount: 44,
      lastRecordedFrame: 43,
      sessionId: 'private-session',
    },
    checksum: { frame: 43, actual: 123, expected: 456 },
    capabilities: buildRendererCapabilitySummary({
      api: 'webgl2',
      maxTextureSize: 16_384,
      logicalProcessors: 8,
    }),
    performance: {
      tierId: 'balanced',
      adaptiveResolutionEnabled: true,
      reducedMotion: true,
      pixelRatio: 1.25,
      samples: [{
        elapsedMs: 1_000,
        frameTimeMs: 16.667,
        p95FrameTimeMs: 18,
        pixelRatio: 1.25,
        drawCalls: 80,
        triangles: 20_000,
      }],
    },
    ...overrides,
  };
}

describe('privacy-safe crash bundle', () => {
  test('constructs a versioned bundle with exact release and deterministic replay identity', () => {
    const bundle = buildCrashBundle(createInput());

    expect(bundle.schemaVersion).toBe(CRASH_BUNDLE_SCHEMA_VERSION);
    expect(bundle.capturedAt).toBe('2026-07-20T12:34:56.789Z');
    expect(bundle.identity).toEqual(createInput().identity);
    expect(bundle.failure).toEqual({
      category: 'renderer',
      phase: 'playing',
      code: 'webgl_context_lost',
      recoverable: true,
    });
    expect(bundle.replay).toEqual({
      payloadVersion: 1,
      integrityAlgorithm: 'SHA-256',
      integrityDigest: 'abcdef0123456789',
      frameCount: 44,
      lastRecordedFrame: 43,
    });
    expect(bundle.checksum).toEqual({ frame: 43, actual: 123, expected: 456 });
    expect(bundle.performance.samples[0]).toMatchObject({
      elapsedMs: 1_000,
      pixelRatio: 1.25,
      renderer: { drawCalls: 80, triangles: 20_000 },
    });
  });

  test('allowlists settings and event fields instead of redacting arbitrary data afterward', () => {
    const bundle = buildCrashBundle(createInput());
    const serialized = JSON.stringify(bundle);

    expect(bundle.settings.audio.masterVolume).toBe(1);
    expect(bundle.settings.audio.voiceVolume).toBe(0);
    expect(bundle.recentAcceptedInputs).toEqual([
      { frame: 41, player: 'P1', action: 'boost', source: 'human' },
      { frame: 42, player: 'P2', action: 'launch', source: 'ai' },
    ]);
    expect(serialized).not.toContain('private-account');
    expect(serialized).not.toContain('pilot@example.com');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('203.0.113.42');
    expect(serialized).not.toContain('private log text');
    expect(serialized).not.toContain('private-session');
    expect(serialized).not.toContain('free-form note');
  });

  test('retains only the latest bounded valid inputs, events, and performance samples', () => {
    const acceptedInputs = Array.from({ length: MAX_CRASH_BUNDLE_ACCEPTED_INPUTS + 10 }, (_, frame) => ({
      frame,
      player: 'P1',
      action: 'boost',
      source: 'ai',
    }));
    const events = Array.from({ length: MAX_CRASH_BUNDLE_EVENTS + 10 }, (_, frame) => ({
      type: 'action_accepted',
      frame,
    }));
    const samples = Array.from({ length: MAX_CRASH_BUNDLE_PERFORMANCE_SAMPLES + 10 }, (_, index) => ({
      elapsedMs: index * 1_000,
      frameTimeMs: 16,
      pixelRatio: 1,
    }));
    const bundle = buildCrashBundle(createInput({
      recentAcceptedInputs: [{ frame: -1 }, ...acceptedInputs],
      recentEvents: [{ type: 'unknown_event' }, ...events],
      performance: { pixelRatio: 1, samples },
    }));

    expect(bundle.recentAcceptedInputs).toHaveLength(MAX_CRASH_BUNDLE_ACCEPTED_INPUTS);
    expect(bundle.recentAcceptedInputs[0]?.frame).toBe(10);
    expect(bundle.recentEvents).toHaveLength(MAX_CRASH_BUNDLE_EVENTS);
    expect(bundle.recentEvents[0]?.frame).toBe(10);
    expect(bundle.performance.samples).toHaveLength(MAX_CRASH_BUNDLE_PERFORMANCE_SAMPLES);
    expect(bundle.performance.samples[0]?.elapsedMs).toBe(10_000);
  });

  test('rejects sensitive identity values and fails closed if a bundle is later mutated', () => {
    const unsafeIdentity = createInput();
    unsafeIdentity.identity = { ...unsafeIdentity.identity, buildId: 'pilot@example.com' };
    expect(() => buildCrashBundle(unsafeIdentity)).toThrow(/privacy-safe identifier/);

    const bundle = buildCrashBundle(createInput()) as unknown as Record<string, unknown>;
    bundle.accountId = 'private-account';
    expect(() => assertCrashBundlePrivacySafe(bundle)).toThrow(/forbidden field/);
    expect(() => createCrashBundleExportFile(bundle as never)).toThrow(/forbidden field/);
  });

  test('creates and exports deterministic JSON through an injected save port', async () => {
    const bundle = buildCrashBundle(createInput());
    const save = vi.fn();

    const file = await exportCrashBundle(bundle, { save });

    expect(file.fileName).toBe('gravity-well-crash-2026-07-20T12-34-56-789Z.json');
    expect(file.mimeType).toBe('application/json');
    expect(file.byteLength).toBe(new TextEncoder().encode(file.contents).byteLength);
    expect(JSON.parse(file.contents)).toEqual(bundle);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(file);
  });
});
