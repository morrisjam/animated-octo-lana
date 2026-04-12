import { describe, expect, test } from 'vitest';
import { createInitialState } from './sim';
import { createMatchTelemetryTracker } from './matchTelemetry';
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

describe('match telemetry tracker', () => {
  test('tracks both player inputs and combat outcomes for live analysis', () => {
    const state = createInitialState({ seed: 11 });
    const tracker = createMatchTelemetryTracker(state);
    state.players.P1.pos = { x: -4, y: 0 };
    state.players.P2.pos = { x: 4, y: 0 };

    const firstFrame = neutralInput();
    firstFrame.p1.launch = true;
    firstFrame.p2.parry = true;
    state.players.P1.launchActive = 0;
    state.players.P2.launchActive = 0;
    state.players.P1.launchFlash = 0.18;
    state.players.P2.launchFlash = 0.18;
    tracker.recordFrame(firstFrame, state, 1 / 60);

    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    state.players.P1.launchActive = 0;
    state.players.P2.launchActive = 0;
    state.players.P1.launchFlash = 0;
    state.players.P2.launchFlash = 0;
    const secondFrame = neutralInput();
    secondFrame.p1.special = true;
    secondFrame.p2.breakLaunch = true;
    tracker.recordFrame(secondFrame, state, 1 / 60);

    state.players.P1.specialDidResolve = true;
    state.projectiles.push({
      id: 1,
      ownerId: 'P1',
      pos: { x: 0, y: 0 },
      vel: { x: 1, y: 0 },
      life: 1,
      hitRadius: 1,
      stunSeconds: 0.5,
      fuelDamage: 2,
      visualId: 'test',
    });
    const thirdFrame = neutralInput();
    thirdFrame.p1.dunk = true;
    thirdFrame.p2.boost = true;
    tracker.recordFrame(thirdFrame, state, 1 / 60);

    state.players.P1.dunkDidConnect = true;
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    const summary = tracker.toSummary();
    expect(summary.framesSimulated).toBe(4);
    expect(summary.players.P1.launchPresses).toBe(1);
    expect(summary.players.P1.specialPresses).toBe(1);
    expect(summary.players.P1.dunkPresses).toBe(1);
    expect(summary.players.P1.launchHits).toBe(1);
    expect(summary.players.P1.specialResolves).toBe(1);
    expect(summary.players.P1.projectilesSpawned).toBe(1);
    expect(summary.players.P1.dunkHits).toBe(1);
    expect(summary.players.P1.clashCount).toBe(1);
    expect(summary.players.P1.launchAccuracy).toBe(1);
    expect(summary.players.P1.dunkConversionRate).toBe(1);
    expect(summary.players.P2.parryPresses).toBe(1);
    expect(summary.players.P2.breakPresses).toBe(1);
    expect(summary.players.P2.breakEscapes).toBe(1);
    expect(summary.players.P2.averageBreakReactionSeconds).toBeGreaterThan(0);
    expect(summary.players.P2.boostFrames).toBe(1);
    expect(summary.spacing.averageDistance).toBeGreaterThan(0);
    expect(summary.spacing.closestDistance).toBeLessThanOrEqual(summary.spacing.farthestDistance);
    expect(summary.spacing.pointBlankFrames).toBeGreaterThan(0);
    expect(summary.spacing.pressureBandFrames).toBe(summary.framesSimulated);
  });
});
