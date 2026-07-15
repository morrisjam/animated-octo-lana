import { describe, expect, test } from 'vitest';
import { createInitialState } from './sim';
import {
  createTrainingTelemetryTracker,
  parseTrainingTelemetrySummary,
  TRAINING_TELEMETRY_SCHEMA_VERSION,
  TrainingTelemetryIdentityChangedError,
  type TrainingTelemetryScenarioIdentity,
} from './trainingTelemetry';
import type { FrameInput } from './types';

function neutralInput(): FrameInput {
  return {
    p1: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
    p2: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
  };
}

function scenario(sampleId: string): TrainingTelemetryScenarioIdentity {
  return {
    fingerprint: 'fnv1a32:controlled-scenario',
    label: 'Training | seed 7 | Vanguard vs Duelist',
    sampleId,
    descriptor: {
      mode: 'training',
      seed: 7,
    },
  };
}

describe('training telemetry tracker', () => {
  test('tracks training inputs, outcomes, and round end reasons', () => {
    const tracker = createTrainingTelemetryTracker({
      balanceProfileId: 'default',
      rulesetVersion: 'prototype-2026.02',
      playerCharacterId: 'vanguard',
      opponentCharacterId: 'duelist',
    });
    const state = createInitialState({ seed: 7 });
    tracker.startRound(state);

    const launchInput = neutralInput();
    launchInput.p1.launch = true;
    tracker.recordFrame(launchInput, state, 1 / 60);

    const launchHitInput = neutralInput();
    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    state.players.P1.chain = 1;
    state.players.P1.fuel -= 2;
    tracker.recordFrame(launchHitInput, state, 1 / 60);

    const specialInput = neutralInput();
    specialInput.p1.special = true;
    tracker.recordFrame(specialInput, state, 1 / 60);
    state.players.P1.specialDidResolve = true;
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    const dunkInput = neutralInput();
    dunkInput.p1.dunk = true;
    tracker.recordFrame(dunkInput, state, 1 / 60);
    state.players.P1.dunkDidConnect = true;
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    tracker.endRound('round_win');

    const summary = tracker.toSummary('2026-02-15T12:00:00.000Z');
    expect(summary.roundsStarted).toBe(1);
    expect(summary.roundsCompleted).toBe(1);
    expect(summary.roundsWon).toBe(1);
    expect(summary.input.launchPresses).toBe(1);
    expect(summary.input.specialPresses).toBe(1);
    expect(summary.input.dunkPresses).toBe(1);
    expect(summary.outcomes.launchHits).toBe(1);
    expect(summary.outcomes.specialResolves).toBe(1);
    expect(summary.outcomes.dunkHits).toBe(1);
    expect(summary.resources.fuelLost).toBeGreaterThan(1.9);
    expect(summary.resources.fuelRestored).toBe(0);
    expect(summary.averageRoundSeconds).toBeGreaterThan(0);
    expect(summary.runs).toHaveLength(1);
    expect(summary.runIdentity?.characters.player.packageVersion).not.toBe('unknown');
    expect(summary.runIdentity?.characterRegistryFingerprint).toMatch(/^gw\.character-registry\.v1:/);
  });

  test('keeps prior measurements under the tuning and run identity that produced them', () => {
    const tracker = createTrainingTelemetryTracker({
      balanceProfileId: 'baseline',
      rulesetVersion: 'prototype-2026.02',
      playerCharacterId: 'vanguard',
      opponentCharacterId: 'duelist',
      scenarioIdentity: scenario('sample-1'),
    });
    const baselineState = createInitialState({ seed: 7 });
    tracker.startRound(baselineState);
    const launchInput = neutralInput();
    launchInput.p1.launch = true;
    tracker.recordFrame(launchInput, baselineState, 1 / 60);
    tracker.endRound('manual_restart');

    tracker.updateMetadata({
      balanceProfileId: 'candidate',
      scenarioIdentity: scenario('sample-2'),
    });
    const candidateState = createInitialState({ seed: 7 });
    candidateState.tuning.playerMoveAccel += 1;
    tracker.startRound(candidateState);
    const specialInput = neutralInput();
    specialInput.p1.special = true;
    tracker.recordFrame(specialInput, candidateState, 1 / 60);
    tracker.endRound('mode_exit');

    const summary = tracker.toSummary('2026-02-15T12:00:00.000Z');
    expect(summary.runs).toHaveLength(2);
    expect(summary.runs[0].identity.balanceProfileId).toBe('baseline');
    expect(summary.runs[0].identity.scenario?.sampleId).toBe('sample-1');
    expect(summary.runs[0].input.launchPresses).toBe(1);
    expect(summary.runs[0].input.specialPresses).toBe(0);
    expect(summary.runs[1].identity.balanceProfileId).toBe('candidate');
    expect(summary.runs[1].identity.scenario?.sampleId).toBe('sample-2');
    expect(summary.runs[1].input.launchPresses).toBe(0);
    expect(summary.runs[1].input.specialPresses).toBe(1);
    expect(summary.runs[0].identity.tuningFingerprint).not.toBe(
      summary.runs[1].identity.tuningFingerprint,
    );

    // Compatibility fields expose only the latest run, never a mixed aggregate.
    expect(summary.balanceProfileId).toBe('candidate');
    expect(summary.roundsStarted).toBe(1);
    expect(summary.input.launchPresses).toBe(0);
    expect(summary.input.specialPresses).toBe(1);
  });

  test('starts a distinct run when only the scenario sample changes', () => {
    const tracker = createTrainingTelemetryTracker({
      balanceProfileId: 'default',
      rulesetVersion: 'prototype-2026.02',
      playerCharacterId: 'vanguard',
      opponentCharacterId: 'duelist',
      scenarioIdentity: scenario('sample-1'),
    });
    const state = createInitialState({ seed: 7 });
    tracker.startRound(state);
    tracker.recordFrame(neutralInput(), state, 1 / 60);
    tracker.endRound('manual_restart');

    tracker.updateMetadata({ scenarioIdentity: scenario('sample-2') });
    tracker.startRound(state);
    tracker.recordFrame(neutralInput(), state, 1 / 60);
    tracker.endRound('mode_exit');

    const summary = tracker.toSummary();
    expect(summary.runs).toHaveLength(2);
    expect(summary.runs[0].identity.tuningFingerprint).toBe(
      summary.runs[1].identity.tuningFingerprint,
    );
    expect(summary.runs.map((run) => run.identity.scenario?.sampleId)).toEqual([
      'sample-1',
      'sample-2',
    ]);
    expect(new Set(summary.runs.map((run) => run.runId)).size).toBe(2);
  });

  test('rejects mid-round tuning drift before recording mixed measurements', () => {
    const tracker = createTrainingTelemetryTracker({
      balanceProfileId: 'default',
      rulesetVersion: 'prototype-2026.02',
      playerCharacterId: 'vanguard',
      opponentCharacterId: 'duelist',
    });
    const state = createInitialState({ seed: 7 });
    tracker.startRound(state);
    tracker.recordFrame(neutralInput(), state, 1 / 60);
    state.tuning.playerMoveAccel += 1;

    expect(() => tracker.recordFrame(neutralInput(), state, 1 / 60)).toThrow(
      TrainingTelemetryIdentityChangedError,
    );
    expect(tracker.toSummary().framesSimulated).toBe(1);
  });

  test.each([
    {
      schemaVersion: undefined,
      resources: { fuelSpent: 4 },
      expectedFuelLost: 4,
      expectedFuelRestored: 0,
    },
    {
      schemaVersion: 'gw.training-telemetry.v2',
      resources: { fuelLost: 5, fuelRestored: 2 },
      expectedFuelLost: 5,
      expectedFuelRestored: 2,
    },
  ])('parses legacy $schemaVersion persisted exports without assigning current packages', ({
    schemaVersion,
    resources,
    expectedFuelLost,
    expectedFuelRestored,
  }) => {
    const parsed = parseTrainingTelemetrySummary({
      tuningFingerprint: 'fnv1a32:legacy-tuning',
      characterBalanceFingerprint: 'fnv1a32:legacy-characters',
      summary: {
        ...(schemaVersion ? { schemaVersion } : {}),
        sessionId: 'legacy-session',
        startedAt: '2026-01-01T00:00:00.000Z',
        exportedAt: '2026-01-01T00:01:00.000Z',
        balanceProfileId: 'legacy-profile',
        rulesetVersion: 'prototype-2026.01',
        playerCharacterId: 'vanguard',
        opponentCharacterId: 'duelist',
        roundsStarted: 2,
        roundsCompleted: 2,
        framesSimulated: 120,
        input: { launchPresses: 3 },
        outcomes: { launchHits: 1 },
        resources,
      },
    });

    expect(parsed.schemaVersion).toBe(TRAINING_TELEMETRY_SCHEMA_VERSION);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].identity.tuningFingerprint).toBe('fnv1a32:legacy-tuning');
    expect(parsed.runs[0].identity.characterRulesFingerprint).toBe(
      'legacy:fnv1a32:legacy-characters',
    );
    expect(parsed.runs[0].identity.characters.player.packageVersion).toBe('unknown');
    expect(parsed.resources.fuelLost).toBe(expectedFuelLost);
    expect(parsed.resources.fuelRestored).toBe(expectedFuelRestored);
    expect(parsed.input.launchPresses).toBe(3);
    expect(parsed.outcomes.launchHitRate).toBeCloseTo(1 / 3, 4);
  });
});
