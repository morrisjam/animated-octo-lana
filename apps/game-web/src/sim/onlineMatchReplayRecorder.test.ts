import { describe, expect, test } from 'vitest';
import { resolveBalanceProfile } from './balanceProfiles';
import {
  CHARACTER_PACKAGE_VERSION_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
} from './characters';
import { computeStateChecksum } from './checksum';
import {
  OnlineMatchReplayRecorder,
  resolveSynchronizedReplayFrameLimit,
  verifyOnlineMatchReplayDigest,
  type AuthoritativeReplayInputSource,
} from './onlineMatchReplayRecorder';
import { findFirstChecksumMismatch, runReplay, validateReplayPayload } from './replay';
import { createInitialState, step } from './sim';
import type { FrameInput, PlayerId } from './types';

const SEED = 20260714;
const FIXED_DT = 1 / 60;
const LOADOUT = { P1: 'vanguard', P2: 'duelist' } as const;
const RULES = { allowDunkWin: true } as const;
const TUNING = resolveBalanceProfile('default').tuning;

const ROUND_INPUTS: FrameInput[][] = [
  [
    frameInput(1, -1),
    frameInput(0.5, -0.5, { boost: true }),
  ],
  [
    frameInput(-1, 1, { special: true }),
    frameInput(0, 0, { parry: true }),
    frameInput(0.25, -0.25, { launch: true }),
  ],
];

function playerInput(
  moveX: number,
  actions: Partial<Record<'boost' | 'special' | 'launch' | 'parry', boolean>> = {},
) {
  return {
    moveX,
    moveY: 0,
    boost: actions.boost ?? false,
    superBoost: false,
    special: actions.special ?? false,
    launch: actions.launch ?? false,
    dunk: false,
    parry: actions.parry ?? false,
    breakLaunch: false,
  };
}

function frameInput(
  p1MoveX: number,
  p2MoveX: number,
  actions: Partial<Record<'boost' | 'special' | 'launch' | 'parry', boolean>> = {},
): FrameInput {
  return {
    p1: playerInput(p1MoveX, actions),
    p2: playerInput(p2MoveX),
  };
}

function createRecorder(localPlayerId: PlayerId): OnlineMatchReplayRecorder {
  return new OnlineMatchReplayRecorder({
    sessionId: '11111111-1111-4111-8111-111111111111',
    matchId: '22222222-2222-4222-8222-222222222222',
    localPlayerId,
    rulesetVersion: 'prototype-2026.02',
    simBuildHash: 'alpha-test-build',
    balanceProfileId: 'default',
    seed: SEED,
    loadout: LOADOUT,
    fixedDt: FIXED_DT,
    rules: RULES,
    tuning: TUNING,
    characterBalanceOverrides: {},
    stage: {
      id: 'wormhole_depths_v2',
      version: '2',
      fingerprint: 'stage:wormhole_depths_v2:test',
    },
  });
}

function recordRound(
  recorder: OnlineMatchReplayRecorder,
  localPlayerId: PlayerId,
  epoch: number,
  inputs: FrameInput[],
): void {
  const state = createInitialState({ seed: SEED, loadout: LOADOUT, rules: RULES });
  state.tuning = { ...TUNING };
  recorder.startRound(epoch);
  for (let frame = 0; frame < inputs.length; frame += 1) {
    const input = inputs[frame];
    step(state, input, FIXED_DT);
    recorder.recordSynchronizedFrame({
      epoch,
      frame,
      confirmedThrough: inputs.length - 1,
      checksum: computeStateChecksum(state),
      players: {
        P1: {
          input: input.p1,
          source: localPlayerId === 'P1' ? 'local' : 'remote_authoritative',
        },
        P2: {
          input: input.p2,
          source: localPlayerId === 'P2' ? 'local' : 'remote_authoritative',
        },
      },
    });
  }
  recorder.finalizeRound(epoch, inputs.length - 1);
}

async function buildReplay(localPlayerId: PlayerId) {
  const recorder = createRecorder(localPlayerId);
  for (let epoch = 0; epoch < ROUND_INPUTS.length; epoch += 1) {
    recordRound(recorder, localPlayerId, epoch, ROUND_INPUTS[epoch]);
  }
  return await recorder.buildPayload();
}

describe('OnlineMatchReplayRecorder', () => {
  test('caps synchronized archival at the decisive frame while peers converge', () => {
    expect(resolveSynchronizedReplayFrameLimit({
      contiguousRemoteFrame: 14,
      peerConfirmedThrough: 13,
      currentFrame: 15,
      winningFrame: 10,
    })).toBe(10);
    expect(resolveSynchronizedReplayFrameLimit({
      contiguousRemoteFrame: 8,
      peerConfirmedThrough: 13,
      currentFrame: 15,
      winningFrame: 10,
    })).toBe(8);
    expect(resolveSynchronizedReplayFrameLimit({
      contiguousRemoteFrame: 14,
      peerConfirmedThrough: 13,
      currentFrame: 12,
      winningFrame: null,
    })).toBe(11);
  });

  test('builds one canonical identity for both peers across complete round resets', async () => {
    const p1Payload = await buildReplay('P1');
    const p2Payload = await buildReplay('P2');

    expect(p1Payload).toEqual(p2Payload);
    expect(p1Payload.integrity?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyOnlineMatchReplayDigest(p1Payload)).toBe(true);
    expect(p1Payload.header.onlineMatch).toEqual({
      schemaVersion: 'gw.online-match-replay.v1',
      sessionId: '11111111-1111-4111-8111-111111111111',
      matchId: '22222222-2222-4222-8222-222222222222',
      balanceProfileId: 'default',
      tuningFingerprint: expect.stringMatching(/^fnv1a32:[a-f0-9]{8}$/),
      characterRegistryFingerprint: CHARACTER_REGISTRY_FINGERPRINT,
      characterPackageVersions: {
        P1: CHARACTER_PACKAGE_VERSION_BY_ID.vanguard,
        P2: CHARACTER_PACKAGE_VERSION_BY_ID.duelist,
      },
      stage: {
        id: 'wormhole_depths_v2',
        version: '2',
        fingerprint: 'stage:wormhole_depths_v2:test',
      },
    });
    expect(p1Payload.rounds).toEqual([
      expect.objectContaining({
        round: 1,
        epoch: 0,
        seed: SEED,
        startFrame: 0,
        endFrame: 1,
        initialChecksum: expect.any(Number),
        finalChecksum: p1Payload.expectedChecksums?.[1],
      }),
      expect.objectContaining({
        round: 2,
        epoch: 1,
        seed: SEED,
        startFrame: 2,
        endFrame: 4,
        initialChecksum: p1Payload.rounds?.[0]
          && (p1Payload.rounds[0] as { initialChecksum: number }).initialChecksum,
        finalChecksum: p1Payload.expectedChecksums?.[4],
      }),
    ]);

    const validation = validateReplayPayload(p1Payload);
    expect(validation.ok).toBe(true);
    expect(findFirstChecksumMismatch(
      runReplay(p1Payload).checksums,
      p1Payload.expectedChecksums ?? [],
    )).toBeNull();
  });

  test('rejects predicted, unconfirmed, out-of-order, and checksum-inconsistent frames', async () => {
    const recorder = createRecorder('P1');
    const input = frameInput(1, -1);
    const state = createInitialState({ seed: SEED, loadout: LOADOUT, rules: RULES });
    state.tuning = { ...TUNING };
    step(state, input, FIXED_DT);
    const checksum = computeStateChecksum(state);
    const validFrame = {
      epoch: 0,
      frame: 0,
      confirmedThrough: 0,
      checksum,
      players: {
        P1: { input: input.p1, source: 'local' as const },
        P2: { input: input.p2, source: 'remote_authoritative' as const },
      },
    };
    recorder.startRound(0);

    expect(() => recorder.recordSynchronizedFrame({
      ...validFrame,
      confirmedThrough: -1,
    })).toThrow('not peer-confirmed');
    expect(() => recorder.recordSynchronizedFrame({
      ...validFrame,
      players: {
        ...validFrame.players,
        P2: {
          ...validFrame.players.P2,
          source: 'remote_predicted' as AuthoritativeReplayInputSource,
        },
      },
    })).toThrow('predicted inputs cannot be persisted');
    expect(() => recorder.recordSynchronizedFrame({
      ...validFrame,
      frame: 1,
      confirmedThrough: 1,
    })).toThrow('expected frame 0');
    expect(() => recorder.recordSynchronizedFrame({
      ...validFrame,
      checksum: checksum ^ 1,
    })).toThrow('checksum mismatch');
    expect(recorder.frameCount).toBe(0);

    recorder.recordSynchronizedFrame(validFrame);
    input.p1.moveX = -1;
    recorder.finalizeRound(0, 0);
    const payload = await recorder.buildPayload();
    expect(payload.inputTimeline[0].p1?.moveX).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('remote_predicted');
  });

  test('fails closed when canonical round or checksum evidence is tampered', async () => {
    const payload = await buildReplay('P1');
    const brokenBoundary = structuredClone(payload);
    if (brokenBoundary.rounds?.[1]) {
      brokenBoundary.rounds[1].startFrame = 1;
    }
    const boundaryValidation = validateReplayPayload(brokenBoundary);
    expect(boundaryValidation).toMatchObject({
      ok: false,
      error: { code: 'invalid_rounds' },
    });

    const brokenChecksum = structuredClone(payload);
    brokenChecksum.expectedChecksums![2] ^= 1;
    const checksumValidation = validateReplayPayload(brokenChecksum);
    expect(checksumValidation).toMatchObject({
      ok: false,
      error: { code: 'invalid_expected_checksums' },
    });

    const brokenStage = structuredClone(payload);
    brokenStage.header.onlineMatch!.stage.id = 'different-stage';
    expect(await verifyOnlineMatchReplayDigest(brokenStage)).toBe(false);
  });

  test('rejects a named balance profile paired with different tuning', () => {
    expect(() => new OnlineMatchReplayRecorder({
      sessionId: 'session',
      matchId: 'match',
      localPlayerId: 'P1',
      rulesetVersion: 'rules',
      simBuildHash: 'build',
      balanceProfileId: 'default',
      seed: 1,
      loadout: LOADOUT,
      fixedDt: FIXED_DT,
      rules: RULES,
      tuning: { ...TUNING, playerMoveAccel: TUNING.playerMoveAccel + 1 },
      stage: { id: 'wormhole_depths_v2' },
    })).toThrow('does not match balance profile');
  });
});
