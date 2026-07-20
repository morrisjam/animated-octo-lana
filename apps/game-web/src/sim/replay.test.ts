import { describe, expect, test } from 'vitest';
import {
  AI_DECISION_CANDIDATES,
  AI_DECISION_TRACE_SCHEMA_VERSION,
  createDefaultAiBehaviorTuning,
  type AiDecisionTrace,
} from './ai';
import { computeStateChecksum } from './checksum';
import type { ReplayLocalAiProvenance, ReplayPayload } from './replay';
import {
  estimateReplayPayloadBytes,
  findFirstChecksumMismatch,
  LOCAL_AI_REPLAY_SCHEMA_VERSION,
  REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
  runReplay,
  traceReplayActionStarts,
  validateReplayPayload,
} from './replay';
import { createInitialState, step } from './sim';
import { createDefaultTuning, fingerprintGameTuning } from './tuning';

const ZERO_NEUTRAL_TUNING_KEY = 'postControlCounterLaunchClashGraceSeconds' as const;
const COMBAT_BOOST_TUNING_KEY = 'combatBoostReacquireDelaySeconds' as const;
const COMMITTED_LOCOMOTION_TUNING_KEY = 'committedLocomotionInputAuthority' as const;
const BOOST_ACCELERATION_TUNING_KEY = 'ordinaryBoostAccelerationSeconds' as const;
type ZeroDefaultTuningKey = typeof ZERO_NEUTRAL_TUNING_KEY
  | typeof COMBAT_BOOST_TUNING_KEY
  | typeof COMMITTED_LOCOMOTION_TUNING_KEY
  | typeof BOOST_ACCELERATION_TUNING_KEY;

function createDecision(overrides: Partial<AiDecisionTrace> = {}): AiDecisionTrace {
  const candidates = Object.fromEntries(AI_DECISION_CANDIDATES.map((action) => [action, {
    eligible: action === 'launch',
    weight: action === 'launch' ? 1 : 0,
    reason: action === 'launch' ? 'weighted_pressure_choice' : 'cooldown',
  }])) as AiDecisionTrace['candidates'];
  return {
    schemaVersion: AI_DECISION_TRACE_SCHEMA_VERSION,
    playerId: 'P1',
    profileId: 'veteran',
    controllerRoleId: 'adaptive',
    gameTimeSeconds: 0,
    movementIntent: 'long_range_approach',
    selectedAction: 'launch',
    selectedReason: 'weighted_pressure_choice',
    selectionRoll: 0.25,
    mistakeRoll: 0.75,
    context: {
      distance: 80,
      fuelRatio: 1,
      opponentFuelRatio: 1,
      incomingProjectileDistance: null,
      finishOpportunity: false,
    },
    gates: {
      hasControl: true,
      canChooseTacticalAction: true,
      decisionLockFrames: 0,
      reactionFramesRemaining: 0,
      neutralHoldActive: false,
      postEventSpacingActive: false,
      deliberateError: false,
    },
    candidates,
    ...overrides,
  };
}

function createReplayPayload(): ReplayPayload {
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
      seed: 2026,
      fixedDt: 1 / 60,
      advanceRngPerFrame: true,
    },
    inputTimeline: [
      { p1: { moveX: 1 }, p2: { moveX: -1 } },
      { p1: { moveY: 1, boost: true }, p2: { moveY: -1 } },
      { p1: { special: true }, p2: { parry: true } },
      { p1: { launch: true }, p2: { breakLaunch: true } },
      { p1: { moveX: -1, moveY: 1 }, p2: { moveX: 1, moveY: -1 } },
    ],
  };
}

function createLocalAiProvenance(): ReplayLocalAiProvenance {
  return {
    schemaVersion: LOCAL_AI_REPLAY_SCHEMA_VERSION,
    profileId: 'veteran',
    matchSeed: 2026,
    roundSeed: 2028,
    roundIndex: 2,
    controllerSeeds: { P1: 101, P2: 202 },
    controllerRoles: { P1: 'adaptive', P2: 'evasive' },
    behaviorTuning: {
      ...createDefaultAiBehaviorTuning(),
      neutralHoldFrames: 18,
      postClashSpacingFrames: 12,
    },
    recoveryPolicyId: 'evasive',
    clashPolicyId: 'spacing',
    pursuitPolicyId: 'neutral_hold',
  };
}

function createCanonicalPlayerInput(moveX: number) {
  return {
    moveX,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function createCanonicalOnlineReplay(
  omittedTuningKeys: readonly ZeroDefaultTuningKey[] = [],
) {
  const seed = 20260716;
  const fixedDt = 1 / 60;
  const loadout = { P1: 'vanguard', P2: 'duelist' } as const;
  const rules = { allowDunkWin: true } as const;
  const tuning = createDefaultTuning();
  const balanceTuning: Record<string, number> = { ...tuning };
  for (const key of omittedTuningKeys) {
    delete balanceTuning[key];
  }
  const frame = {
    p1: createCanonicalPlayerInput(0.25),
    p2: createCanonicalPlayerInput(-0.25),
  };
  const state = createInitialState({
    seed,
    loadout,
    rules,
    characterBalanceOverrides: {},
  });
  state.tuning = { ...tuning };
  const initialChecksum = computeStateChecksum(state);
  step(state, frame, fixedDt);
  const finalChecksum = computeStateChecksum(state);

  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'compatibility-test',
      seed,
      loadout,
      fixedDt,
      advanceRngPerFrame: false,
      rules,
      balanceTuning,
      characterBalanceOverrides: {},
      onlineMatch: {
        schemaVersion: 'gw.online-match-replay.v1',
        sessionId: '11111111-1111-4111-8111-111111111111',
        matchId: '22222222-2222-4222-8222-222222222222',
        balanceProfileId: 'default',
        tuningFingerprint: fingerprintGameTuning(tuning),
        characterRegistryFingerprint: 'gw.character-registry.v1:test',
        characterPackageVersions: { P1: '1.0.0', P2: '1.0.0' },
        stage: { id: 'wormhole_depths_v2', version: '2' },
      },
    },
    inputTimeline: [frame],
    rounds: [{
      round: 1,
      label: 'Round 1',
      epoch: 0,
      seed,
      startFrame: 0,
      endFrame: 0,
      initialChecksum,
      finalChecksum,
    }],
    expectedChecksums: [finalChecksum],
    integrity: {
      schemaVersion: 'gw.replay-integrity.v1',
      algorithm: 'SHA-256',
      digest: '0'.repeat(64),
    },
  };
}

describe('replay runner', () => {
  test('same replay payload produces identical checksums', () => {
    const replay = createReplayPayload();
    const resultA = runReplay(replay);
    const resultB = runReplay(replay);
    expect(resultA.checksums).toEqual(resultB.checksums);
  });

  test('traces accepted action starts rather than raw button presses', () => {
    const replay = createReplayPayload();
    replay.inputTimeline[0] = {
      p1: { moveX: 1 },
      p2: { special: true },
    };
    replay.inputTimeline[3] = {
      p1: { special: true, launch: true },
      p2: { special: true },
    };

    const actionStarts = traceReplayActionStarts(replay);

    expect(actionStarts).toContainEqual({ frame: 0, playerId: 'P2', action: 'special' });
    expect(actionStarts).toContainEqual({ frame: 2, playerId: 'P1', action: 'special' });
    expect(actionStarts).not.toContainEqual({ frame: 3, playerId: 'P1', action: 'launch' });
    expect(actionStarts).not.toContainEqual({ frame: 3, playerId: 'P1', action: 'special' });
    expect(actionStarts).not.toContainEqual({ frame: 3, playerId: 'P2', action: 'special' });
  });

  test('reports first checksum mismatch frame', () => {
    const mismatch = findFirstChecksumMismatch([10, 20, 30], [10, 21, 30]);
    expect(mismatch).toEqual({
      frame: 1,
      actual: 20,
      expected: 21,
    });
  });

  test('rejects unsupported payload version with explicit error', () => {
    const parsed = validateReplayPayload({
      header: {
        payloadVersion: 99,
        rulesetVersion: 'prototype-2026.02',
        simBuildHash: 'dev-local',
      },
      inputTimeline: [],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok !== false) {
      throw new Error('Expected payload validation failure');
    }
    expect(parsed.error.code).toBe('unsupported_payload_version');
  });

  test('rejects malformed deterministic checksum evidence', () => {
    const replay = createReplayPayload();
    const parsed = validateReplayPayload({
      ...replay,
      expectedChecksums: [123, Number.NaN],
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok !== false) {
      throw new Error('Expected payload validation failure');
    }
    expect(parsed.error.code).toBe('invalid_expected_checksums');
  });

  test('accepts every historical zero-default canonical tuning shape', () => {
    const keys = [
      ZERO_NEUTRAL_TUNING_KEY,
      COMBAT_BOOST_TUNING_KEY,
      COMMITTED_LOCOMOTION_TUNING_KEY,
      BOOST_ACCELERATION_TUNING_KEY,
    ] as const;
    const shapes = Array.from({ length: 1 << keys.length }, (_, mask) => (
      keys.filter((_, index) => (mask & (1 << index)) !== 0)
    ));
    const parsed = shapes.map((shape) => validateReplayPayload(createCanonicalOnlineReplay(shape)));

    for (const result of parsed) {
      expect(result.ok).toBe(true);
      if (result.ok === false) {
        throw new Error(result.error.message);
      }
      expect(result.payload.header.balanceTuning?.[ZERO_NEUTRAL_TUNING_KEY]).toBe(0);
      expect(result.payload.header.balanceTuning?.[COMBAT_BOOST_TUNING_KEY]).toBe(0);
      expect(result.payload.header.balanceTuning?.[BOOST_ACCELERATION_TUNING_KEY]).toBe(0);
    }
    const fingerprints = parsed.map((result) => (
      result.ok ? result.payload.header.onlineMatch?.tuningFingerprint : null
    ));
    expect(new Set(fingerprints).size).toBe(1);
  });

  test('rejects canonical tuning shapes with any other missing or additional key', () => {
    const missingKey = createCanonicalOnlineReplay();
    delete missingKey.header.balanceTuning.launchBasePower;
    const additionalKey = createCanonicalOnlineReplay();
    additionalKey.header.balanceTuning.unexpectedTuningKey = 0;

    for (const replay of [missingKey, additionalKey]) {
      const parsed = validateReplayPayload(replay);
      expect(parsed.ok).toBe(false);
      if (parsed.ok !== false) {
        throw new Error('Expected canonical tuning shape validation failure');
      }
      expect(parsed.error.code).toBe('invalid_online_identity');
    }
  });

  test('rejects an unknown starting situation', () => {
    const replay = createReplayPayload();
    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        startingSituation: {
          schemaVersion: 'gw.balance-scenario.v1',
          id: 'unknown_scenario',
        },
      },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok !== false) {
      throw new Error('Expected payload validation failure');
    }
    expect(parsed.error.code).toBe('invalid_header');
  });

  test('round-trips normalised local AI replay provenance', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    provenance.behaviorTuning.postControlChaseLockFrames = 18;
    provenance.behaviorTuning.postControlRepeatDashWeightScale = 0.35;
    provenance.behaviorTuning.exchangeRepositionWeightScale = 0.6;
    replay.header.localAi = provenance;

    const parsed = validateReplayPayload(replay);

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi).toEqual(provenance);
    expect(parsed.payload.header.localAi).not.toBe(provenance);
    expect(parsed.payload.header.localAi?.controllerSeeds).not.toBe(provenance.controllerSeeds);
    expect(parsed.payload.header.localAi?.controllerRoles).not.toBe(provenance.controllerRoles);
    expect(parsed.payload.header.localAi?.behaviorTuning).not.toBe(provenance.behaviorTuning);
    expect(parsed.payload.header.localAi?.behaviorTuning.postControlChaseLockFrames).toBe(18);
    expect(parsed.payload.header.localAi?.behaviorTuning.postControlRepeatDashWeightScale).toBe(0.35);
    expect(parsed.payload.header.localAi?.behaviorTuning.exchangeRepositionWeightScale).toBe(0.6);
  });

  test('migrates v5 local AI behavior tuning without commitment controls', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      commitmentObserveFrames: _commitmentObserveFrames,
      commitmentPressFrames: _commitmentPressFrames,
      commitmentResetFrames: _commitmentResetFrames,
      finishPursuitReachScale: _finishPursuitReachScale,
      postControlSteeringFrames: _postControlSteeringFrames,
      opponentControlReturnObserveFrames: _opponentControlReturnObserveFrames,
      postCommitmentDecisionScale: _postCommitmentDecisionScale,
      repositionWeightScale: _repositionWeightScale,
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...legacyBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...legacyBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v5',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      commitmentObserveFrames: 0,
      commitmentPressFrames: 0,
      commitmentResetFrames: 0,
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
      postCommitmentDecisionScale: 0,
      repositionWeightScale: 0,
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
      neutralHoldFrames: 18,
    });
  });

  test('migrates v6 local AI behavior tuning without finish pursuit reach', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      finishPursuitReachScale: _finishPursuitReachScale,
      postControlSteeringFrames: _postControlSteeringFrames,
      opponentControlReturnObserveFrames: _opponentControlReturnObserveFrames,
      postCommitmentDecisionScale: _postCommitmentDecisionScale,
      repositionWeightScale: _repositionWeightScale,
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v6',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
      postCommitmentDecisionScale: 0,
      repositionWeightScale: 0,
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v7 local AI behavior tuning without post-control steering', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      postControlSteeringFrames: _postControlSteeringFrames,
      opponentControlReturnObserveFrames: _opponentControlReturnObserveFrames,
      postCommitmentDecisionScale: _postCommitmentDecisionScale,
      repositionWeightScale: _repositionWeightScale,
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v7',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
      postCommitmentDecisionScale: 0,
      repositionWeightScale: 0,
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v8 local AI behavior tuning without opponent recovery respect', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      opponentControlReturnObserveFrames: _opponentControlReturnObserveFrames,
      postCommitmentDecisionScale: _postCommitmentDecisionScale,
      repositionWeightScale: _repositionWeightScale,
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v8',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
      postCommitmentDecisionScale: 0,
      repositionWeightScale: 0,
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v9 local AI behavior tuning without post-commitment decision pacing', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      postCommitmentDecisionScale: _postCommitmentDecisionScale,
      repositionWeightScale: _repositionWeightScale,
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v9',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      postCommitmentDecisionScale: 0,
      repositionWeightScale: 0,
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v10 local AI behavior tuning without tactical repositioning', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      repositionWeightScale: _repositionWeightScale,
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v10',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      repositionWeightScale: 0,
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v11 local AI behavior tuning without counterstep control', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      postControlCounterstepScale: _postControlCounterstepScale,
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v11',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      postControlCounterstepScale: 0,
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v12 local AI behavior tuning without post-control chase lock', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v12',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      postControlChaseLockFrames: 0,
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v13 local AI behavior tuning with a neutral repeat-dash weight', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v13',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      postControlRepeatDashWeightScale: 1,
      exchangeRepositionWeightScale: 0,
    });
  });

  test('migrates v14 local AI behavior tuning with neutral between-exchange repositioning', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...previousBehaviorTuning
    } = provenance.behaviorTuning;

    const parsed = validateReplayPayload({
      ...replay,
      header: {
        ...replay.header,
        localAi: {
          ...provenance,
          behaviorTuning: {
            ...previousBehaviorTuning,
            schemaVersion: 'gw.ai-behavior-tuning.v14',
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi?.behaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v15',
      exchangeRepositionWeightScale: 0,
    });
  });

  test('rejects malformed provided local AI replay provenance', () => {
    const valid = createLocalAiProvenance();
    const {
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      ...currentBehaviorTuningWithoutRepeatDashWeight
    } = valid.behaviorTuning;
    const {
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...currentBehaviorTuningWithoutExchangeRepositionWeight
    } = valid.behaviorTuning;
    const malformedValues: unknown[] = [
      { ...valid, schemaVersion: 'gw.local-ai-replay.v999' },
      { ...valid, profileId: 'unknown' },
      { ...valid, matchSeed: 1.5 },
      { ...valid, roundSeed: 0x1_0000_0000 },
      { ...valid, roundIndex: -1 },
      { ...valid, controllerSeeds: { P1: 101, P2: -1 } },
      { ...valid, controllerRoles: { P1: 'adaptive', P2: 'unknown' } },
      {
        ...valid,
        behaviorTuning: { ...valid.behaviorTuning, neutralHoldFrames: 1.5 },
      },
      {
        ...valid,
        behaviorTuning: { ...valid.behaviorTuning, postControlChaseLockFrames: 1.5 },
      },
      {
        ...valid,
        behaviorTuning: { ...valid.behaviorTuning, postControlChaseLockFrames: 121 },
      },
      {
        ...valid,
        behaviorTuning: { ...valid.behaviorTuning, postControlChaseLockFrames: -1 },
      },
      {
        ...valid,
        behaviorTuning: currentBehaviorTuningWithoutRepeatDashWeight,
      },
      {
        ...valid,
        behaviorTuning: currentBehaviorTuningWithoutExchangeRepositionWeight,
      },
      {
        ...valid,
        behaviorTuning: {
          ...valid.behaviorTuning,
          schemaVersion: 'gw.ai-behavior-tuning.v13',
        },
      },
      {
        ...valid,
        behaviorTuning: {
          ...valid.behaviorTuning,
          postControlRepeatDashWeightScale: -0.05,
        },
      },
      {
        ...valid,
        behaviorTuning: {
          ...valid.behaviorTuning,
          postControlRepeatDashWeightScale: 1.05,
        },
      },
      {
        ...valid,
        behaviorTuning: {
          ...valid.behaviorTuning,
          exchangeRepositionWeightScale: -0.05,
        },
      },
      {
        ...valid,
        behaviorTuning: {
          ...valid.behaviorTuning,
          exchangeRepositionWeightScale: 4.05,
        },
      },
      { ...valid, recoveryPolicyId: 'unknown' },
      { ...valid, clashPolicyId: 'unknown' },
      { ...valid, pursuitPolicyId: 'unknown' },
    ];

    for (const localAi of malformedValues) {
      const replay = createReplayPayload();
      const parsed = validateReplayPayload({
        ...replay,
        header: { ...replay.header, localAi },
      });

      expect(parsed.ok).toBe(false);
      if (parsed.ok !== false) {
        throw new Error('Expected payload validation failure');
      }
      expect(parsed.error.code).toBe('invalid_header');
    }
  });

  test('accepts legacy replay headers without local AI provenance', () => {
    const parsed = validateReplayPayload(createReplayPayload());

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.header.localAi).toBeUndefined();
  });

  test('isolates validated local AI provenance from source mutations', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    replay.header.localAi = provenance;
    const parsed = validateReplayPayload(replay);

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }

    provenance.controllerSeeds.P1 = 999;
    provenance.controllerRoles.P2 = 'passive';
    provenance.behaviorTuning.neutralHoldFrames = 99;

    expect(parsed.payload.header.localAi?.controllerSeeds.P1).toBe(101);
    expect(parsed.payload.header.localAi?.controllerRoles.P2).toBe('evasive');
    expect(parsed.payload.header.localAi?.behaviorTuning.neutralHoldFrames).toBe(18);
  });

  test('round-trips detached AI decision provenance without affecting checksums', () => {
    const replay = createReplayPayload();
    replay.aiDecisionTrace = {
      schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
      events: [{
        sequence: 7,
        frame: 0,
        playerId: 'P1',
        decision: createDecision(),
      }],
    };
    const checksumsBeforeMutation = runReplay(replay).checksums;
    const parsed = validateReplayPayload(replay);

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.aiDecisionTrace).toEqual(replay.aiDecisionTrace);

    replay.aiDecisionTrace.events[0].decision.context.distance = 999;
    replay.aiDecisionTrace.events[0].decision.candidates.launch.reason = 'mutated';
    replay.inputTimeline[0].p1!.moveX = -1;

    expect(parsed.payload.aiDecisionTrace?.events[0].decision.context.distance).toBe(80);
    expect(parsed.payload.aiDecisionTrace?.events[0].decision.candidates.launch.reason)
      .toBe('weighted_pressure_choice');
    expect(parsed.payload.inputTimeline[0].p1?.moveX).toBe(1);
    expect(runReplay(parsed.payload).checksums).toEqual(checksumsBeforeMutation);
  });

  test('round-trips current commitment intents in detached AI decision provenance', () => {
    const replay = createReplayPayload();
    replay.aiDecisionTrace = {
      schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
      events: [{
        sequence: 0,
        frame: 0,
        playerId: 'P1',
        decision: createDecision({ movementIntent: 'commitment_observe' }),
      }],
    };

    const parsed = validateReplayPayload(replay);

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.aiDecisionTrace?.events[0].decision.movementIntent)
      .toBe('commitment_observe');
  });

  test('migrates a v1 replay AI trace with v2 decisions', () => {
    const replay = createReplayPayload();
    const parsed = validateReplayPayload({
      ...replay,
      aiDecisionTrace: {
        schemaVersion: 'gw.replay-ai-decision-trace.v1',
        events: [{
          sequence: 0,
          frame: 0,
          playerId: 'P1',
          decision: {
            ...createDecision(),
            schemaVersion: 'gw.ai-decision-trace.v2',
          },
        }],
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.payload.aiDecisionTrace?.schemaVersion)
      .toBe(REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION);
    expect(parsed.payload.aiDecisionTrace?.events[0].decision.schemaVersion)
      .toBe(AI_DECISION_TRACE_SCHEMA_VERSION);
  });

  test('rejects new commitment intents inside legacy AI trace schemas', () => {
    const replay = createReplayPayload();
    const parsed = validateReplayPayload({
      ...replay,
      aiDecisionTrace: {
        schemaVersion: 'gw.replay-ai-decision-trace.v1',
        events: [{
          sequence: 0,
          frame: 0,
          playerId: 'P1',
          decision: {
            ...createDecision({ movementIntent: 'commitment_reset' }),
            schemaVersion: 'gw.ai-decision-trace.v2',
          },
        }],
      },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok !== false) {
      throw new Error('Expected legacy decision trace validation failure');
    }
    expect(parsed.error.code).toBe('invalid_ai_decision_trace');
  });

  test('keeps legacy payloads valid and rejects uncorrelated AI decision events', () => {
    const legacy = validateReplayPayload(createReplayPayload());
    expect(legacy.ok).toBe(true);
    if (legacy.ok === false) {
      throw new Error(legacy.error.message);
    }
    expect(legacy.payload.aiDecisionTrace).toBeUndefined();

    const replay = createReplayPayload();
    replay.aiDecisionTrace = {
      schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
      events: [{
        sequence: 0,
        frame: replay.inputTimeline.length,
        playerId: 'P1',
        decision: createDecision(),
      }],
    };
    const invalid = validateReplayPayload(replay);
    expect(invalid.ok).toBe(false);
    if (invalid.ok !== false) {
      throw new Error('Expected payload validation failure');
    }
    expect(invalid.error.code).toBe('invalid_ai_decision_trace');
  });

  test('estimates compact payload byte size', () => {
    const replay = createReplayPayload();
    const bytes = estimateReplayPayloadBytes(replay);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(4096);
  });
});
