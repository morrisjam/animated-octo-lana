import { describe, expect, test } from 'vitest';
import { CHARACTER_BY_ID } from './characters';
import { computeStateChecksum } from './checksum';
import { framesToSeconds } from './moveData';
import type { FrameInput } from './types';
import {
  createInitialState,
  createStateSnapshot,
  deserialiseState,
  nextDeterministicRandom,
  restoreStateFromSnapshot,
  serialiseState,
  STATE_SNAPSHOT_VERSION,
  step,
} from './sim';
import { CHAIN_WINDOW_SECONDS } from './constants';

const FIXED_DT = 1 / 60;
const VANGUARD_LAUNCH = CHARACTER_BY_ID.vanguard.moves.launch;
const VANGUARD_DUNK = CHARACTER_BY_ID.vanguard.moves.dunk;
const LAUNCH_RESOLVE_STEPS = VANGUARD_LAUNCH.startupFrames + VANGUARD_LAUNCH.activeFrames + 3;
const DUNK_RESOLVE_STEPS = VANGUARD_DUNK.startupFrames + VANGUARD_DUNK.activeFrames + 3;

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

function runSteps(state: ReturnType<typeof createInitialState>, input: FrameInput, stepCount: number): void {
  for (let i = 0; i < stepCount; i += 1) {
    step(state, input, FIXED_DT);
  }
}

function scriptedInputForFrame(frame: number): FrameInput {
  const input = neutralInput();
  if (frame % 15 < 5) {
    input.p1.moveX = 1;
  } else if (frame % 15 < 10) {
    input.p1.moveX = -1;
  }
  if (frame % 20 < 10) {
    input.p2.moveY = 1;
  } else {
    input.p2.moveY = -1;
  }
  if (frame % 30 === 0) {
    input.p1.boost = true;
  }
  if (frame % 45 === 0) {
    input.p2.parry = true;
  }
  if (frame % 50 === 0) {
    input.p1.special = true;
  }
  return input;
}

describe('chain reset rules', () => {
  test('resets chain after chain window without follow-up launch', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 20, y: 0 };
    state.players.P2.pos = { x: 24, y: 0 };

    const input = neutralInput();
    input.p1.launch = true;
    step(state, input, FIXED_DT);
    runSteps(state, neutralInput(), LAUNCH_RESOLVE_STEPS);
    expect(state.players.P1.chain).toBe(1);

    // Keep target in helpless long enough so this test exercises chain timeout.
    state.players.P2.helpless = 10;
    state.players.P2.lastLaunchedBy = 'P1';

    const neutral = neutralInput();
    const timeoutSteps = Math.ceil((CHAIN_WINDOW_SECONDS + 0.05) / FIXED_DT);
    runSteps(state, neutral, timeoutSteps);

    expect(state.players.P1.chain).toBe(0);
  });

  test('resets chain when attacker is parried and stunned', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 20, y: 0 };
    state.players.P2.pos = { x: 24, y: 0 };
    state.players.P1.chain = 2;
    state.players.P1.chainTimer = 0.8;
    state.players.P2.parry = 0.2;

    const input = neutralInput();
    input.p1.launch = true;
    step(state, input, FIXED_DT);
    runSteps(state, neutralInput(), LAUNCH_RESOLVE_STEPS);

    expect(state.players.P1.stunned).toBeGreaterThan(0);
    expect(state.players.P1.chain).toBe(0);
  });

  test('launch whiff applies vulnerable recovery end lag', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -30, y: 0 };
    state.players.P2.pos = { x: 30, y: 0 };

    const input = neutralInput();
    input.p1.launch = true;
    step(state, input, FIXED_DT);
    runSteps(state, neutralInput(), LAUNCH_RESOLVE_STEPS);

    const expectedRecovery = framesToSeconds(VANGUARD_LAUNCH.recoveryOnWhiffFrames);
    expect(state.players.P1.endLag).toBeGreaterThan(expectedRecovery - 0.2);

    const relaunch = neutralInput();
    relaunch.p1.launch = true;
    step(state, relaunch, FIXED_DT);
    expect(state.players.P1.launchStartup).toBe(0);
  });
});

describe('dunk move rules', () => {
  test('dunk can be attempted at zero fuel and connect against a neutral opponent', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    state.players.P1.fuel = 0;
    state.players.P2.helpless = 0;

    const input = neutralInput();
    input.p1.dunk = true;
    step(state, input, FIXED_DT);
    runSteps(state, neutralInput(), DUNK_RESOLVE_STEPS);

    expect(state.players.P2.recovering).toBeGreaterThan(0);
    expect(state.players.P1.fuel).toBe(0);
  });

  test('dunk whiff applies large recovery end lag', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -40, y: 0 };
    state.players.P2.pos = { x: 40, y: 0 };

    const input = neutralInput();
    input.p1.dunk = true;
    step(state, input, FIXED_DT);
    runSteps(state, neutralInput(), DUNK_RESOLVE_STEPS);

    const expectedRecovery = framesToSeconds(VANGUARD_DUNK.recoveryOnWhiffFrames);
    expect(state.players.P1.endLag).toBeGreaterThan(expectedRecovery - 0.25);

    const reDunk = neutralInput();
    reDunk.p1.dunk = true;
    step(state, reDunk, FIXED_DT);
    expect(state.players.P1.dunkStartup).toBe(0);
  });
});

describe('special move rules', () => {
  test('projectile special still spawns a projectile placeholder for projectile archetypes', () => {
    const state = createInitialState({
      loadout: {
        P1: 'ace',
        P2: 'duelist',
      },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 30, y: 0 };

    const input = neutralInput();
    input.p1.special = true;
    step(state, input, FIXED_DT);

    expect(state.projectiles.length).toBe(1);
    expect(state.players.P1.specialFlash).toBeGreaterThan(0);
  });

  test('projectile special respects cooldown and cannot be spammed instantly', () => {
    const state = createInitialState({
      loadout: {
        P1: 'ace',
        P2: 'duelist',
      },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 30, y: 0 };

    const input = neutralInput();
    input.p1.special = true;
    step(state, input, FIXED_DT);
    step(state, input, FIXED_DT);

    expect(state.projectiles.length).toBe(1);
  });

  test('vanguard special grants a guard window instead of spawning a projectile', () => {
    const state = createInitialState({
      loadout: {
        P1: 'vanguard',
        P2: 'duelist',
      },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 20, y: 0 };

    const input = neutralInput();
    input.p1.special = true;
    step(state, input, FIXED_DT);
    runSteps(
      state,
      neutralInput(),
      CHARACTER_BY_ID.vanguard.moves.special.timing.startupFrames + CHARACTER_BY_ID.vanguard.moves.special.timing.activeFrames + 1,
    );

    expect(state.players.P1.parry).toBeGreaterThan(0);
    expect(state.projectiles.length).toBe(0);
  });

  test('duelist special resolves as a forward dash and does not spawn a projectile', () => {
    const state = createInitialState({
      loadout: {
        P1: 'duelist',
        P2: 'vanguard',
      },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 20, y: 0 };

    const input = neutralInput();
    input.p1.special = true;
    step(state, input, FIXED_DT);
    runSteps(
      state,
      neutralInput(),
      CHARACTER_BY_ID.duelist.moves.special.timing.startupFrames + 2,
    );

    expect(state.players.P1.pos.x).toBeGreaterThan(0.5);
    expect(Math.abs(state.players.P1.pos.y)).toBeLessThan(0.001);
    expect(state.projectiles.length).toBe(0);
  });

  test('special behavior dispatch is keyed by behaviorId, not kind', () => {
    const originalSpecial = CHARACTER_BY_ID.vanguard.moves.special;
    CHARACTER_BY_ID.vanguard.moves.special = {
      ...originalSpecial,
      behaviorId: 'special.projectile.v1',
      kind: 'block',
      block: { guardFrames: 30 },
      projectile: CHARACTER_BY_ID.ace.moves.special.projectile,
    };

    try {
      const state = createInitialState();
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 30, y: 0 };

      const input = neutralInput();
      input.p1.special = true;
      step(state, input, FIXED_DT);
      runSteps(
        state,
        neutralInput(),
        CHARACTER_BY_ID.vanguard.moves.special.timing.startupFrames + 2,
      );

      expect(state.projectiles.length).toBe(1);
      expect(state.players.P1.parry).toBe(0);
    } finally {
      CHARACTER_BY_ID.vanguard.moves.special = originalSpecial;
    }
  });
});

describe('super boost commit tracking', () => {
  test('applies non-commit penalty only when launch or dunk was not attempted', () => {
    const noCommitState = createInitialState();
    const commitState = createInitialState();

    const startSuper = neutralInput();
    startSuper.p1.superBoost = true;
    startSuper.p1.moveX = 1;
    step(noCommitState, startSuper, FIXED_DT);
    step(commitState, startSuper, FIXED_DT);

    const noCommitInput = neutralInput();
    const commitInput = neutralInput();
    commitInput.p1.superBoost = true;
    commitInput.p1.moveX = 1;
    commitInput.p1.launch = true;

    // Attempt launch during active super boost, far from target, to set commit flag.
    step(commitState, commitInput, FIXED_DT);
    expect(commitState.players.P1.didCommitAttackDuringSuperBoost).toBe(true);

    const settleSteps = Math.ceil(1.1 / FIXED_DT);
    runSteps(noCommitState, noCommitInput, settleSteps);
    runSteps(commitState, noCommitInput, settleSteps);

    const superFuelScale = CHARACTER_BY_ID.vanguard.stats.superFuelMultiplier;
    const expectedPenaltyGap = CHARACTER_BY_ID.vanguard.moves.superBoost.nonCommitPenalty * superFuelScale;

    expect(noCommitState.players.P1.superBoost).toBe(0);
    expect(commitState.players.P1.superBoost).toBe(0);
    expect(commitState.players.P1.fuel).toBeGreaterThan(noCommitState.players.P1.fuel);
    expect(commitState.players.P1.fuel - noCommitState.players.P1.fuel).toBeGreaterThan(expectedPenaltyGap * 0.6);
  });
});

describe('launch recovery and spacing', () => {
  test('helpless state ends early once launch drift falls below controllable speed', () => {
    const state = createInitialState();
    state.players.P2.helpless = 4;
    state.players.P2.vel = { x: 6, y: 0 };

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P2.helpless).toBe(0);
  });

  test('close-range neutral overlap applies separation so players do not stay stacked', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 1, y: 0 };
    state.players.P1.vel = { x: 0, y: 0 };
    state.players.P2.vel = { x: 0, y: 0 };

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThan(1);
    expect(state.players.P1.vel.x).toBeLessThan(0);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
  });

  test('simultaneous launch attempts clash and create a large spacing reset', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    state.players.P1.launchActive = 0.12;
    state.players.P2.launchActive = 0.12;

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P1.helpless).toBe(0);
    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThan(14);
    expect(state.players.P1.vel.x).toBeLessThan(0);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
  });

  test('boost keeps its original chase line instead of retargeting every frame', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 24, y: 0 };

    const startBoost = neutralInput();
    startBoost.p1.boost = true;
    step(state, startBoost, FIXED_DT);

    const sidestep = neutralInput();
    sidestep.p1.boost = true;
    sidestep.p2.superBoost = true;
    sidestep.p2.moveY = 1;
    step(state, sidestep, FIXED_DT);

    expect(state.players.P1.boostActive).toBe(true);
    expect(state.players.P1.vel.x).toBeGreaterThan(55);
    expect(Math.abs(state.players.P1.vel.y)).toBeLessThan(0.5);
  });

  test('boost release applies a short recommit cooldown before it can lock again', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 24, y: 0 };

    const boostInput = neutralInput();
    boostInput.p1.boost = true;
    runSteps(state, boostInput, 6);

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P1.boostActive).toBe(false);
    expect(state.players.P1.cool.boost).toBeGreaterThan(0.1);

    state.players.P2.pos = { x: -24, y: 0 };
    step(state, boostInput, FIXED_DT);

    expect(state.players.P1.boostActive).toBe(false);
    expect(state.players.P1.vel.x).toBeGreaterThan(-20);
  });
});

describe('deterministic seed and rng', () => {
  test('same seed produces identical deterministic random sequence', () => {
    const stateA = createInitialState({ seed: 1337 });
    const stateB = createInitialState({ seed: 1337 });
    const sequenceLength = 12;

    for (let i = 0; i < sequenceLength; i += 1) {
      const randomA = nextDeterministicRandom(stateA);
      const randomB = nextDeterministicRandom(stateB);
      expect(randomA).toBe(randomB);
    }
  });

  test('same seed and same inputs produce matching checksum sequence', () => {
    const stateA = createInitialState({ seed: 424242 });
    const stateB = createInitialState({ seed: 424242 });
    const checksumSequenceA: number[] = [];
    const checksumSequenceB: number[] = [];

    for (let frame = 0; frame < 240; frame += 1) {
      const input = scriptedInputForFrame(frame);

      step(stateA, input, FIXED_DT);
      step(stateB, input, FIXED_DT);

      // Advance deterministic rng stream in lockstep to validate seed determinism.
      nextDeterministicRandom(stateA);
      nextDeterministicRandom(stateB);

      checksumSequenceA.push(computeStateChecksum(stateA));
      checksumSequenceB.push(computeStateChecksum(stateB));
    }

    expect(checksumSequenceA).toEqual(checksumSequenceB);
  });
});

describe('state snapshot and restore', () => {
  test('snapshot is a deep copy and stays stable after source mutation', () => {
    const state = createInitialState({ seed: 1234 });
    const snapshot = createStateSnapshot(state);

    state.players.P1.pos.x += 10;
    state.players.P1.cool.special = 9;
    state.projectiles.push({
      id: 999,
      ownerId: 'P1',
      pos: { x: 1, y: 2 },
      vel: { x: 3, y: 4 },
      life: 5,
      hitRadius: 0.8,
      stunSeconds: 0.7,
      fuelDamage: 4,
      visualId: 'default_orb',
    });
    state.loadout.P1 = 'ace';
    state.tuning.playerMoveAccel += 5;
    state.rngState = 42;

    expect(snapshot.players.P1.pos.x).not.toBe(state.players.P1.pos.x);
    expect(snapshot.players.P1.cool.special).not.toBe(state.players.P1.cool.special);
    expect(snapshot.projectiles.length).toBe(0);
    expect(snapshot.loadout.P1).toBe('vanguard');
    expect(snapshot.tuning.playerMoveAccel).not.toBe(state.tuning.playerMoveAccel);
    expect(snapshot.rngState).not.toBe(state.rngState);
  });

  test('restore then resume produces identical final checksum', () => {
    const totalFrames = 240;
    const rewindFrame = 120;
    const state = createInitialState({ seed: 8675309 });
    let snapshot = createStateSnapshot(state);

    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (frame === rewindFrame) {
        snapshot = createStateSnapshot(state);
      }
      const input = scriptedInputForFrame(frame);
      step(state, input, FIXED_DT);
      nextDeterministicRandom(state);
    }
    const expectedChecksum = computeStateChecksum(state);

    const restored = restoreStateFromSnapshot(snapshot);
    for (let frame = rewindFrame; frame < totalFrames; frame += 1) {
      const input = scriptedInputForFrame(frame);
      step(restored, input, FIXED_DT);
      nextDeterministicRandom(restored);
    }
    const restoredChecksum = computeStateChecksum(restored);
    expect(restoredChecksum).toBe(expectedChecksum);
  });

  test('serialise and deserialise round-trip keeps state checksum', () => {
    const state = createInitialState({ seed: 9988 });
    for (let frame = 0; frame < 90; frame += 1) {
      const input = scriptedInputForFrame(frame);
      step(state, input, FIXED_DT);
      nextDeterministicRandom(state);
    }

    const serialised = serialiseState(state);
    const roundTrip = deserialiseState(serialised);
    expect(computeStateChecksum(roundTrip)).toBe(computeStateChecksum(state));
  });

  test('deserialise accepts legacy direct state payloads for compatibility', () => {
    const state = createInitialState({ seed: 2025 });
    for (let frame = 0; frame < 30; frame += 1) {
      const input = scriptedInputForFrame(frame);
      step(state, input, FIXED_DT);
      nextDeterministicRandom(state);
    }
    const legacyPayload = JSON.stringify(createStateSnapshot(state));
    const restored = deserialiseState(legacyPayload);
    expect(computeStateChecksum(restored)).toBe(computeStateChecksum(state));
  });

  test('deserialise rejects unsupported snapshot envelope versions', () => {
    const state = createInitialState({ seed: 777 });
    const payload = JSON.stringify({
      version: STATE_SNAPSHOT_VERSION + 1,
      state: createStateSnapshot(state),
    });
    expect(() => deserialiseState(payload)).toThrow(`Expected ${STATE_SNAPSHOT_VERSION}`);
  });

  test('deserialise rejects malformed snapshots with clear error', () => {
    expect(() => deserialiseState('{bad-json')).toThrow('not valid JSON');
    expect(() => deserialiseState(JSON.stringify({ version: STATE_SNAPSHOT_VERSION, state: {} }))).toThrow(
      'Invalid state snapshot',
    );
  });
});
