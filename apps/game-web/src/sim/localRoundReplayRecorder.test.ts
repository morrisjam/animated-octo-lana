import { describe, expect, it } from 'vitest';
import { createAiController, createDefaultAiBehaviorTuning, tickAiController } from './ai';
import { applyBalanceScenario } from './balanceScenarios';
import { LocalRoundReplayRecorder } from './localRoundReplayRecorder';
import {
  findFirstChecksumMismatch,
  LOCAL_AI_REPLAY_SCHEMA_VERSION,
  REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
  runReplay,
  type ReplayLocalAiProvenance,
  validateReplayPayload,
} from './replay';
import { buildReplayReviewData } from './replayReview';
import { createInitialState, step } from './sim';
import type { FrameInput } from './types';

function createLocalAiProvenance(): ReplayLocalAiProvenance {
  return {
    schemaVersion: LOCAL_AI_REPLAY_SCHEMA_VERSION,
    profileId: 'veteran',
    matchSeed: 90210,
    roundSeed: 90212,
    roundIndex: 2,
    controllerSeeds: { P1: 101, P2: 202 },
    controllerRoles: { P1: 'adaptive', P2: 'defensive' },
    behaviorTuning: {
      ...createDefaultAiBehaviorTuning(),
      neutralHoldFrames: 24,
    },
    recoveryPolicyId: 'spacing',
    clashPolicyId: 'spacing',
    pursuitPolicyId: 'neutral_hold',
  };
}

describe('LocalRoundReplayRecorder', () => {
  it('replays the exact observed input and checksum sequence', () => {
    const state = createInitialState({
      seed: 90210,
      loadout: { P1: 'vanguard', P2: 'duelist' },
      rules: { allowDunkWin: true },
    });
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'test-rules',
      simBuildHash: 'test-build',
      roundNumber: 2,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt: 1 / 60,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      sourceLabel: 'AI vs AI round 2 seed 90210',
    });
    const inputs: FrameInput[] = [
      {
        p1: { moveX: 1, moveY: 0, boost: true, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
        p2: { moveX: -1, moveY: 0, boost: true, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
      },
      {
        p1: { moveX: 0, moveY: 1, boost: false, superBoost: true, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
        p2: { moveX: 0, moveY: -1, boost: false, superBoost: false, special: true, launch: false, dunk: false, parry: false, breakLaunch: false },
      },
      {
        p1: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: true, dunk: false, parry: false, breakLaunch: false },
        p2: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: true, breakLaunch: false },
      },
    ];

    for (const input of inputs) {
      step(state, input, 1 / 60);
      recorder.recordFrame(input, state);
    }

    const payload = recorder.buildPayload();
    expect(payload).not.toBeNull();
    expect(validateReplayPayload(payload).ok).toBe(true);
    expect(payload?.aiDecisionTrace).toBeUndefined();
    expect(payload?.rounds?.[0]).toMatchObject({ round: 2, startFrame: 0, endFrame: 2 });
    expect(findFirstChecksumMismatch(
      runReplay(payload as NonNullable<typeof payload>).checksums,
      payload?.expectedChecksums ?? [],
    )).toBeNull();
  });

  it('does not emit an empty replay', () => {
    const state = createInitialState({ seed: 7 });
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'test-rules',
      simBuildHash: 'test-build',
      roundNumber: 1,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt: 1 / 60,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      sourceLabel: 'empty',
    });

    expect(recorder.buildPayload()).toBeNull();
  });

  it('snapshots and clones local AI provenance into each payload', () => {
    const expectedProvenance = createLocalAiProvenance();
    const providedProvenance: ReplayLocalAiProvenance = {
      ...expectedProvenance,
      controllerSeeds: { ...expectedProvenance.controllerSeeds },
      controllerRoles: { ...expectedProvenance.controllerRoles },
      behaviorTuning: { ...expectedProvenance.behaviorTuning },
    };
    const state = createInitialState({ seed: expectedProvenance.roundSeed });
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'test-rules',
      simBuildHash: 'test-build',
      roundNumber: 3,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt: 1 / 60,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      sourceLabel: 'provenance clone isolation',
      localAiProvenance: providedProvenance,
    });

    providedProvenance.controllerSeeds.P1 = 999;
    providedProvenance.controllerRoles.P2 = 'passive';
    providedProvenance.behaviorTuning.neutralHoldFrames = 99;

    const input: FrameInput = {
      p1: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
      p2: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
    };
    step(state, input, 1 / 60);
    recorder.recordFrame(input, state);

    const firstPayload = recorder.buildPayload();
    expect(firstPayload?.header.localAi).toEqual(expectedProvenance);
    expect(validateReplayPayload(firstPayload).ok).toBe(true);

    if (!firstPayload?.header.localAi) {
      throw new Error('Expected local AI provenance');
    }
    firstPayload.header.localAi.controllerSeeds.P1 = 777;
    firstPayload.header.localAi.controllerRoles.P2 = 'evasive';
    firstPayload.header.localAi.behaviorTuning.neutralHoldFrames = 88;

    const secondPayload = recorder.buildPayload();
    expect(secondPayload?.header.localAi).toEqual(expectedProvenance);
    expect(secondPayload?.header.localAi).not.toBe(firstPayload.header.localAi);
    expect(secondPayload?.header.localAi?.controllerSeeds)
      .not.toBe(firstPayload.header.localAi.controllerSeeds);
    expect(secondPayload?.header.localAi?.controllerRoles)
      .not.toBe(firstPayload.header.localAi.controllerRoles);
    expect(secondPayload?.header.localAi?.behaviorTuning)
      .not.toBe(firstPayload.header.localAi.behaviorTuning);
  });

  it('retains detached live AI decisions on their recorded frame', () => {
    const state = createInitialState({
      seed: 90211,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'test-rules',
      simBuildHash: 'test-build',
      roundNumber: 1,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt: 1 / 60,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      sourceLabel: 'AI provenance',
    });
    const p1Tick = tickAiController(state, 'P1', createAiController({
      seed: 101,
      profileId: 'veteran',
    }));
    const p2Tick = tickAiController(state, 'P2', createAiController({
      seed: 202,
      profileId: 'veteran',
    }));
    const input: FrameInput = {
      p1: p1Tick.input,
      p2: p2Tick.input,
    };
    const recordedDistance = p1Tick.decision.context.distance;

    step(state, input, 1 / 60);
    recorder.recordFrame(input, state, {
      P1: p1Tick.decision,
      P2: p2Tick.decision,
    });
    p1Tick.decision.context.distance = 999;

    const payload = recorder.buildPayload();
    expect(payload?.aiDecisionTrace?.schemaVersion)
      .toBe(REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION);
    expect(payload?.aiDecisionTrace?.events.map((event) => [event.frame, event.playerId]))
      .toEqual([[0, 'P1'], [0, 'P2']]);
    expect(payload?.aiDecisionTrace?.events[0].decision.context.distance).toBe(recordedDistance);

    const validation = validateReplayPayload(payload);
    expect(validation.ok).toBe(true);
    expect(findFirstChecksumMismatch(
      runReplay(payload as NonNullable<typeof payload>).checksums,
      payload?.expectedChecksums ?? [],
    )).toBeNull();
  });

  it('retains a one-sided AI trace for human sparring without two-controller provenance', () => {
    const state = createInitialState({
      seed: 90213,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'test-rules',
      simBuildHash: 'test-build',
      roundNumber: 1,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt: 1 / 60,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      sourceLabel: 'human sparring',
    });
    const p2Tick = tickAiController(state, 'P2', createAiController({
      seed: 202,
      profileId: 'veteran',
    }));
    const manualP1Input: FrameInput['p1'] = {
      moveX: 0.75,
      moveY: -0.25,
      boost: false,
      superBoost: true,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    };
    const input: FrameInput = {
      p1: manualP1Input,
      p2: p2Tick.input,
    };

    step(state, input, 1 / 60);
    recorder.recordFrame(input, state, { P2: p2Tick.decision });

    const payload = recorder.buildPayload();
    expect(payload?.header.localAi).toBeUndefined();
    expect(payload?.inputTimeline[0]?.p1).toEqual(manualP1Input);
    expect(payload?.aiDecisionTrace?.events.map((event) => [event.frame, event.playerId]))
      .toEqual([[0, 'P2']]);
    expect(validateReplayPayload(payload).ok).toBe(true);
    expect(findFirstChecksumMismatch(
      runReplay(payload as NonNullable<typeof payload>).checksums,
      payload?.expectedChecksums ?? [],
    )).toBeNull();
  });

  it('reconstructs a non-standard balance scenario for verification and review', () => {
    const state = createInitialState({
      seed: 77,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    applyBalanceScenario(state, 'zero_fuel_chase');
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'test-rules',
      simBuildHash: 'test-build',
      roundNumber: 1,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt: 1 / 60,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      startingSituationId: 'zero_fuel_chase',
      sourceLabel: 'zero-fuel chase',
    });
    const input: FrameInput = {
      p1: { moveX: 1, moveY: 0, boost: false, superBoost: true, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
      p2: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
    };

    step(state, input, 1 / 60);
    recorder.recordFrame(input, state);

    const payload = recorder.buildPayload();
    expect(payload?.header.startingSituation).toEqual({
      schemaVersion: 'gw.balance-scenario.v1',
      id: 'zero_fuel_chase',
    });
    expect(validateReplayPayload(payload).ok).toBe(true);
    expect(findFirstChecksumMismatch(
      runReplay(payload as NonNullable<typeof payload>).checksums,
      payload?.expectedChecksums ?? [],
    )).toBeNull();
    expect(buildReplayReviewData(payload as NonNullable<typeof payload>)
      .frames[0]?.snapshot.players.P2.fuel).toBe(0);
  });
});
