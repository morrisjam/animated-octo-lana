import { describe, expect, test } from 'vitest';
import { createInitialState } from './sim';
import { createTrainingTelemetryTracker } from './trainingTelemetry';
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
    expect(summary.resources.fuelSpent).toBeGreaterThan(1.9);
    expect(summary.averageRoundSeconds).toBeGreaterThan(0);
  });
});
