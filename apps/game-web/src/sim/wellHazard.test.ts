import { describe, expect, test } from 'vitest';
import { CHARACTER_BY_ID } from './characters';
import { computeStateChecksum } from './checksum';
import type { FrameInput, GameState } from './types';
import { createDefaultTuning, createGameTuningFingerprintInput, sanitiseTuning } from './tuning';
import {
  createInitialState,
  deserialiseState,
  serialiseState,
  step,
} from './sim';

const FIXED_DT = 1 / 60;
const VANGUARD_LAUNCH = CHARACTER_BY_ID.vanguard.moves.launch;
const LAUNCH_RESOLVE_STEPS = VANGUARD_LAUNCH.startupFrames + VANGUARD_LAUNCH.activeFrames + 3;

const WELL_KNOB_KEYS = [
  'wellCoreRadius',
  'wellCoronaRadius',
  'wellCoronaDrainPerSecond',
  'wellHelplessPull',
  'launchMissingFuelPowerScale',
] as const;

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

function runSteps(state: GameState, input: FrameInput, stepCount: number): void {
  for (let i = 0; i < stepCount; i += 1) {
    step(state, input, FIXED_DT);
  }
}

function applyWellTuning(state: GameState, overrides: Partial<Record<(typeof WELL_KNOB_KEYS)[number], number>>): void {
  state.tuning = sanitiseTuning({ ...state.tuning, ...overrides });
}

function placeHelplessOverCore(state: GameState): void {
  const target = state.players.P2;
  target.pos.x = 5;
  target.pos.y = 0;
  target.vel.x = 0;
  target.vel.y = 150;
  target.helpless = 5;
  target.lastLaunchedBy = 'P1';
}

describe('well hazard tuning surface', () => {
  test('all well knobs default to zero and stay out of the tuning fingerprint', () => {
    const defaults = createDefaultTuning();
    for (const key of WELL_KNOB_KEYS) {
      expect(defaults[key]).toBe(0);
    }
    const fingerprintInput = createGameTuningFingerprintInput(defaults);
    for (const key of WELL_KNOB_KEYS) {
      expect(fingerprintInput).not.toHaveProperty(key);
    }
  });

  test('non-zero well knobs survive sanitising and appear in the fingerprint', () => {
    const tuning = sanitiseTuning({
      ...createDefaultTuning(),
      wellCoreRadius: 12,
      wellCoronaRadius: 34,
      wellCoronaDrainPerSecond: 6,
      wellHelplessPull: 30,
      launchMissingFuelPowerScale: 0.5,
    });
    expect(tuning.wellCoreRadius).toBe(12);
    expect(tuning.wellCoronaRadius).toBe(34);
    expect(tuning.wellCoronaDrainPerSecond).toBe(6);
    expect(tuning.wellHelplessPull).toBe(30);
    expect(tuning.launchMissingFuelPowerScale).toBe(0.5);
    const fingerprintInput = createGameTuningFingerprintInput(tuning);
    for (const key of WELL_KNOB_KEYS) {
      expect(fingerprintInput).toHaveProperty(key);
    }
  });
});

describe('well core capture', () => {
  test('helpless fighter over the core is swallowed into dunk recovery and charged fuel', () => {
    const state = createInitialState({ seed: 11 });
    applyWellTuning(state, { wellCoreRadius: 12 });
    placeHelplessOverCore(state);
    const fuelBefore = state.players.P2.fuel;

    step(state, neutralInput(), FIXED_DT);

    expect(state.winner).toBeNull();
    expect(state.players.P2.recovering).toBeGreaterThan(0);
    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P2.fuel).toBeLessThan(fuelBefore);
    expect(state.players.P2.fuel).toBeGreaterThan(0);
    expect(state.players.P2.lastLaunchedBy).toBeNull();
  });

  test('helpless fighter captured at zero fuel loses the round to the launcher', () => {
    const state = createInitialState({ seed: 11 });
    applyWellTuning(state, { wellCoreRadius: 12 });
    placeHelplessOverCore(state);
    state.players.P2.fuel = 0;

    step(state, neutralInput(), FIXED_DT);

    expect(state.winner).toBe('P1');
  });

  test('a fighter in control hovers over the core safely', () => {
    const state = createInitialState({ seed: 11 });
    applyWellTuning(state, { wellCoreRadius: 12 });
    state.players.P2.pos.x = 5;
    state.players.P2.pos.y = 0;
    state.players.P2.vel.x = 0;
    state.players.P2.vel.y = 0;

    runSteps(state, neutralInput(), 30);

    expect(state.winner).toBeNull();
    expect(state.players.P2.recovering).toBe(0);
  });

  test('a recovering fighter passing the core is not re-captured', () => {
    const state = createInitialState({ seed: 11 });
    applyWellTuning(state, { wellCoreRadius: 12 });
    placeHelplessOverCore(state);
    step(state, neutralInput(), FIXED_DT);
    expect(state.players.P2.recovering).toBeGreaterThan(0);
    const fuelAfterCapture = state.players.P2.fuel;

    runSteps(state, neutralInput(), 10);

    expect(state.winner).toBeNull();
    expect(state.players.P2.fuel).toBe(fuelAfterCapture);
  });

  test('with knobs at default zero, a helpless fighter over the centre is untouched', () => {
    const state = createInitialState({ seed: 11 });
    placeHelplessOverCore(state);

    step(state, neutralInput(), FIXED_DT);

    expect(state.winner).toBeNull();
    expect(state.players.P2.recovering).toBe(0);
    expect(state.players.P2.helpless).toBeGreaterThan(0);
  });
});

describe('well corona drain', () => {
  test('drains controlled fighters inside the ring and nobody else', () => {
    const state = createInitialState({ seed: 7 });
    applyWellTuning(state, { wellCoronaRadius: 34, wellCoronaDrainPerSecond: 6 });
    state.players.P1.pos.x = 20;
    state.players.P1.pos.y = 0;
    state.players.P1.vel.x = 0;
    state.players.P1.vel.y = 0;
    state.players.P2.pos.x = 60;
    state.players.P2.pos.y = 0;
    state.players.P2.vel.x = 0;
    state.players.P2.vel.y = 0;
    const p1FuelBefore = state.players.P1.fuel;
    const p2FuelBefore = state.players.P2.fuel;

    runSteps(state, neutralInput(), 60);

    expect(state.players.P1.fuel).toBeCloseTo(p1FuelBefore - 6, 3);
    expect(state.players.P2.fuel).toBeCloseTo(p2FuelBefore, 3);
  });

  test('does not drain a helpless fighter falling through the ring', () => {
    const state = createInitialState({ seed: 7 });
    applyWellTuning(state, { wellCoronaRadius: 34, wellCoronaDrainPerSecond: 6 });
    state.players.P2.pos.x = 20;
    state.players.P2.pos.y = 0;
    state.players.P2.vel.x = 0;
    state.players.P2.vel.y = 150;
    state.players.P2.helpless = 5;
    state.players.P2.lastLaunchedBy = 'P1';
    const fuelBefore = state.players.P2.fuel;

    runSteps(state, neutralInput(), 10);

    expect(state.players.P2.fuel).toBeCloseTo(fuelBefore, 3);
  });
});

describe('well pull on helpless fighters', () => {
  test('bends a helpless trajectory toward the centre', () => {
    const makeRun = (pull: number): number => {
      const state = createInitialState({ seed: 21 });
      applyWellTuning(state, { wellHelplessPull: pull });
      state.players.P2.pos.x = 0;
      state.players.P2.pos.y = -40;
      state.players.P2.vel.x = 120;
      state.players.P2.vel.y = 0;
      state.players.P2.helpless = 5;
      state.players.P2.lastLaunchedBy = 'P1';
      runSteps(state, neutralInput(), 25);
      return Math.hypot(state.players.P2.pos.x, state.players.P2.pos.y);
    };

    const withoutPull = makeRun(0);
    const withPull = makeRun(30);
    expect(withPull).toBeLessThan(withoutPull);
  });

  test('never touches a fighter in control', () => {
    const makeRun = (pull: number): number => {
      const state = createInitialState({ seed: 21 });
      applyWellTuning(state, { wellHelplessPull: pull });
      state.players.P1.pos.x = 0;
      state.players.P1.pos.y = -40;
      state.players.P1.vel.x = 0;
      state.players.P1.vel.y = 0;
      runSteps(state, neutralInput(), 40);
      return Math.hypot(state.players.P1.pos.x, state.players.P1.pos.y);
    };

    expect(makeRun(30)).toBeCloseTo(makeRun(0), 6);
  });
});

describe('launch power scaling with missing fuel', () => {
  test('an empty tank is launched substantially harder than a full one', () => {
    const runLaunch = (targetFuel: number): number => {
      const state = createInitialState({ seed: 33 });
      applyWellTuning(state, { launchMissingFuelPowerScale: 0.5 });
      state.players.P1.pos.x = 0;
      state.players.P1.pos.y = -20;
      state.players.P1.vel.x = 0;
      state.players.P1.vel.y = 0;
      state.players.P2.pos.x = 0;
      state.players.P2.pos.y = -14;
      state.players.P2.vel.x = 0;
      state.players.P2.vel.y = 0;
      state.players.P2.fuel = targetFuel;

      const launchInput = neutralInput();
      launchInput.p1.launch = true;
      step(state, launchInput, FIXED_DT);

      let peakSpeed = 0;
      for (let i = 0; i < LAUNCH_RESOLVE_STEPS; i += 1) {
        step(state, neutralInput(), FIXED_DT);
        peakSpeed = Math.max(
          peakSpeed,
          Math.hypot(state.players.P2.vel.x, state.players.P2.vel.y),
        );
      }
      expect(state.players.P2.helpless).toBeGreaterThan(0);
      return peakSpeed;
    };

    const fullTankSpeed = runLaunch(createInitialState({ seed: 33 }).players.P2.maxFuel);
    const emptyTankSpeed = runLaunch(1);
    expect(emptyTankSpeed).toBeGreaterThan(fullTankSpeed * 1.3);
  });
});

describe('well hazard determinism', () => {
  test('identical runs with the hazard active produce identical checksums, and snapshots round-trip', () => {
    const scripted = (frame: number): FrameInput => {
      const input = neutralInput();
      if (frame === 5) {
        input.p1.launch = true;
      }
      if (frame % 25 < 8) {
        input.p1.moveX = 1;
      }
      if (frame % 40 < 12) {
        input.p2.moveY = -1;
      }
      return input;
    };
    const makeState = (): GameState => {
      const state = createInitialState({ seed: 99 });
      applyWellTuning(state, {
        wellCoreRadius: 12,
        wellCoronaRadius: 34,
        wellCoronaDrainPerSecond: 6,
        wellHelplessPull: 30,
        launchMissingFuelPowerScale: 0.5,
      });
      state.players.P1.pos.x = 0;
      state.players.P1.pos.y = -26;
      state.players.P2.pos.x = 0;
      state.players.P2.pos.y = -20;
      return state;
    };

    const first = makeState();
    const second = makeState();
    for (let frame = 0; frame < 240; frame += 1) {
      step(first, scripted(frame), FIXED_DT);
      step(second, scripted(frame), FIXED_DT);
    }
    expect(computeStateChecksum(first)).toBe(computeStateChecksum(second));

    const restored = deserialiseState(serialiseState(first));
    for (let frame = 240; frame < 300; frame += 1) {
      step(first, scripted(frame), FIXED_DT);
      step(restored, scripted(frame), FIXED_DT);
    }
    expect(computeStateChecksum(restored)).toBe(computeStateChecksum(first));
  });
});
