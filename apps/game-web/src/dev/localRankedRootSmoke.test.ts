import { describe, expect, it } from 'vitest';
import { createInitialState, step } from '../sim/sim';
import {
  installLocalRankedRootSmokeBridge,
  LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
  resolveLocalRankedRootSmokeConfig,
  type LocalRankedRootSmokeBridge,
} from './localRankedRootSmoke';
import { LocalRankedSmokeInputDriver } from './localRankedSmokeInputDriver';

describe('local ranked root smoke gating', () => {
  it('stays unavailable unless both the build flag and root query opt in', () => {
    expect(resolveLocalRankedRootSmokeConfig({
      buildEnabled: true,
      url: 'http://127.0.0.1:5190/',
    })).toEqual({
      enabled: false,
      forceRelay: false,
      simulationRate: 1,
      inboundDelayPolls: 0,
    });
    expect(() => resolveLocalRankedRootSmokeConfig({
      buildEnabled: false,
      url: 'http://127.0.0.1:5190/?rankedRootSmoke=1',
    })).toThrow(/does not include/);
  });

  it('rejects non-loopback, non-root, and unscoped relay requests', () => {
    expect(() => resolveLocalRankedRootSmokeConfig({
      buildEnabled: true,
      url: 'https://game.example.com/?rankedRootSmoke=1',
    })).toThrow(/loopback/);
    expect(() => resolveLocalRankedRootSmokeConfig({
      buildEnabled: true,
      url: 'http://localhost:5190/webrtc-peer-smoke.html?rankedRootSmoke=1',
    })).toThrow(/application root/);
    expect(() => resolveLocalRankedRootSmokeConfig({
      buildEnabled: true,
      url: 'http://localhost:5190/?forceRelay=1',
    })).toThrow(/only accepted/);
  });

  it('installs and disposes the bridge only for an enabled local root config', () => {
    const target: { __gravityWellLocalRankedRootSmoke?: LocalRankedRootSmokeBridge } = {};
    const bridge = {
      schemaVersion: LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
      getSnapshot: () => ({}) as ReturnType<LocalRankedRootSmokeBridge['getSnapshot']>,
      joinRankedQueue: async () => undefined,
      refreshRankedQueue: async () => undefined,
      armMidRoundRecovery: async () => undefined,
      triggerMidRoundRecovery: async () => undefined,
      refreshPersistedState: async () => undefined,
    };
    const config = resolveLocalRankedRootSmokeConfig({
      buildEnabled: true,
      url: 'http://127.0.0.1:5190/?rankedRootSmoke=1&forceRelay=1',
    });
    const dispose = installLocalRankedRootSmokeBridge(config, bridge, target);
    expect(config.forceRelay).toBe(true);
    expect(config.inboundDelayPolls).toBe(1);
    expect(target.__gravityWellLocalRankedRootSmoke).toBe(bridge);
    dispose();
    expect(target.__gravityWellLocalRankedRootSmoke).toBeUndefined();
  });
});

describe('LocalRankedSmokeInputDriver', () => {
  it('gives isolated peers deterministic local inputs that replay to a real winner', () => {
    const options = {
      seed: 42,
      loadout: { P1: 'vanguard', P2: 'vanguard' } as const,
      rules: { allowDunkWin: true },
      tuning: createInitialState().tuning,
      characterBalanceOverrides: {},
    };
    const p1Driver = new LocalRankedSmokeInputDriver(options);
    const p2Driver = new LocalRankedSmokeInputDriver(options);
    const replay = createInitialState(options);
    replay.tuning = { ...options.tuning };

    for (let frame = 0; frame < 60 * 120 && !replay.winner; frame += 1) {
      const p1 = p1Driver.nextLocalInput(frame, 'P1');
      const p2 = p2Driver.nextLocalInput(frame, 'P2');
      if (frame === 0) {
        expect(p1).toMatchObject({ moveX: -0.25, moveY: 0.5 });
        expect(p2).toMatchObject({ moveX: 0.25, moveY: -0.5 });
      }
      step(replay, { p1, p2 }, 1 / 60);
    }

    const p1Diagnostics = p1Driver.getDiagnostics();
    const p2Diagnostics = p2Driver.getDiagnostics();
    expect(replay.winner).not.toBeNull();
    expect(p1Diagnostics.shadowWinner).toBe(replay.winner);
    expect(p2Diagnostics).toEqual(p1Diagnostics);
    expect(p1Diagnostics.shadowWinnerFrame).toBe(p1Diagnostics.generatedFrames - 1);
    expect(p1Diagnostics.rollbackProbeFramesGenerated).toBe(1);
  });
});
