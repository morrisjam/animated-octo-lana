import { describe, expect, test } from 'vitest';
import {
  AI_DECISION_TRACE_SCHEMA_VERSION,
  AI_TACTICAL_ACTIONS,
  createDefaultAiBehaviorTuning,
  type AiDecisionTrace,
} from './ai';
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

function createDecision(overrides: Partial<AiDecisionTrace> = {}): AiDecisionTrace {
  const candidates = Object.fromEntries(AI_TACTICAL_ACTIONS.map((action) => [action, {
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
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      commitmentObserveFrames: 0,
      commitmentPressFrames: 0,
      commitmentResetFrames: 0,
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
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
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
    });
  });

  test('migrates v7 local AI behavior tuning without post-control steering', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      postControlSteeringFrames: _postControlSteeringFrames,
      opponentControlReturnObserveFrames: _opponentControlReturnObserveFrames,
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
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
    });
  });

  test('migrates v8 local AI behavior tuning without opponent recovery respect', () => {
    const replay = createReplayPayload();
    const provenance = createLocalAiProvenance();
    const {
      opponentControlReturnObserveFrames: _opponentControlReturnObserveFrames,
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
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
    });
  });

  test('rejects malformed provided local AI replay provenance', () => {
    const valid = createLocalAiProvenance();
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
