import { describe, expect, test } from 'vitest';
import { CHARACTER_BY_ID } from './characters';
import { computeStateChecksum } from './checksum';
import { createCharacterBalanceConfig } from './characterBalance';
import { framesToSeconds } from './moveData';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId, PlayerState } from './types';
import { createDefaultTuning } from './tuning';
import {
  createInitialState,
  createStateSnapshot,
  deserialiseState,
  getRenderSnapshot,
  nextDeterministicRandom,
  restoreStateFromSnapshot,
  serialiseState,
  type SimulationActionStart,
  type SimulationLaunchClash,
  STATE_SNAPSHOT_VERSION,
  step,
} from './sim';
import { CHAIN_WINDOW_SECONDS, MAX_FUEL } from './constants';

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

function swapPlayerId(playerId: PlayerId | null): PlayerId | null {
  if (playerId === null) {
    return null;
  }
  return playerId === 'P1' ? 'P2' : 'P1';
}

function mirrorPlayerState(player: PlayerState, playerId: PlayerId): PlayerState {
  return {
    ...player,
    id: playerId,
    pos: { x: -player.pos.x, y: -player.pos.y },
    vel: { x: -player.vel.x, y: -player.vel.y },
    boostDir: { x: -player.boostDir.x, y: -player.boostDir.y },
    superDir: { x: -player.superDir.x, y: -player.superDir.y },
    lastLaunchedBy: swapPlayerId(player.lastLaunchedBy),
    recoveryDir: { x: -player.recoveryDir.x, y: -player.recoveryDir.y },
    cool: { ...player.cool },
  };
}

function mirrorStateForPlayerSwap(state: GameState): GameState {
  const source = createStateSnapshot(state);
  return {
    ...source,
    loadout: {
      P1: source.loadout.P2,
      P2: source.loadout.P1,
    },
    players: {
      P1: mirrorPlayerState(source.players.P2, 'P1'),
      P2: mirrorPlayerState(source.players.P1, 'P2'),
    },
    projectiles: source.projectiles.map((projectile) => ({
      ...projectile,
      ownerId: swapPlayerId(projectile.ownerId) as PlayerId,
      pos: { x: -projectile.pos.x, y: -projectile.pos.y },
      vel: { x: -projectile.vel.x, y: -projectile.vel.y },
    })),
    winner: swapPlayerId(source.winner),
  };
}

function mirrorPlayerInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    ...input,
    moveX: -input.moveX,
    moveY: -input.moveY,
  };
}

function mirrorFrameInputForPlayerSwap(input: FrameInput): FrameInput {
  return {
    p1: mirrorPlayerInput(input.p2),
    p2: mirrorPlayerInput(input.p1),
  };
}

function canonicalSymmetryState(state: GameState): GameState {
  const canonical = createStateSnapshot(state);
  canonical.projectiles = canonical.projectiles
    .map((projectile) => ({ ...projectile, id: 0 }))
    .sort((first, second) => (
      first.ownerId.localeCompare(second.ownerId)
      || first.visualId.localeCompare(second.visualId)
      || first.pos.x - second.pos.x
      || first.pos.y - second.pos.y
    ));
  return JSON.parse(JSON.stringify(canonical)) as GameState;
}

function symmetryScriptedInputForFrame(frame: number): FrameInput {
  const input = neutralInput();
  const phase = frame % 180;
  input.p1.moveX = phase < 60 ? 1 : phase < 120 ? -1 : 0;
  input.p1.moveY = phase < 90 ? -1 : 1;
  input.p2.moveX = phase < 45 ? -1 : phase < 135 ? 1 : 0;
  input.p2.moveY = phase < 75 ? 1 : -1;

  input.p1.boost = phase >= 6 && phase < 18;
  input.p2.boost = phase >= 96 && phase < 108;
  input.p1.superBoost = phase >= 30 && phase < 38;
  input.p2.superBoost = phase >= 120 && phase < 128;
  input.p1.special = phase === 48;
  input.p2.special = phase === 138;
  input.p1.launch = phase === 66 || phase === 156;
  input.p2.launch = phase === 66 || phase === 84;
  input.p1.parry = phase === 82;
  input.p2.parry = phase === 154;
  input.p1.dunk = phase === 112;
  input.p2.dunk = phase === 22;
  input.p1.breakLaunch = phase === 91;
  input.p2.breakLaunch = phase === 169;
  return input;
}

describe('player-order symmetry', () => {
  test('keeps mirrored asymmetric matches equivalent frame by frame', () => {
    const direct = createInitialState({
      seed: 8181,
      loadout: { P1: 'vanguard', P2: 'duelist' },
      rules: { allowDunkWin: false },
    });
    direct.players.P1.pos = { x: -9, y: 2 };
    direct.players.P2.pos = { x: 9, y: -2 };
    const mirrored = mirrorStateForPlayerSwap(direct);
    const acceptedActions = new Set<string>();

    for (let frame = 0; frame < 720; frame += 1) {
      const input = symmetryScriptedInputForFrame(frame);
      step(direct, input, FIXED_DT, {
        onActionStart: ({ action }) => acceptedActions.add(action),
      });
      step(mirrored, mirrorFrameInputForPlayerSwap(input), FIXED_DT);

      expect(
        canonicalSymmetryState(mirrorStateForPlayerSwap(mirrored)),
        `first mirrored simulation divergence at frame ${frame}`,
      ).toEqual(canonicalSymmetryState(direct));
    }

    expect(acceptedActions).toEqual(new Set(['boost', 'super_boost', 'special', 'dunk']));
  });
});

describe('simulation step observation', () => {
  test('reports only actions accepted by the simulator', () => {
    const state = createInitialState();
    const input = neutralInput();
    input.p1.parry = true;
    input.p1.launch = true;
    const starts: SimulationActionStart[] = [];

    step(state, input, FIXED_DT, {
      onActionStart: (event) => starts.push(event),
    });

    expect(starts).toEqual([{ playerId: 'P1', action: 'parry' }]);
    expect(state.players.P1.launchStartup).toBe(0);
    expect(state.players.P1.launchActive).toBe(0);
  });

  test('observation does not alter deterministic state', () => {
    const observed = createInitialState({ seed: 2026 });
    const unobserved = createInitialState({ seed: 2026 });
    const input = neutralInput();
    input.p1.special = true;
    input.p2.launch = true;
    const starts: SimulationActionStart[] = [];

    step(observed, input, FIXED_DT, {
      onActionStart: (event) => starts.push(event),
    });
    step(unobserved, input, FIXED_DT);

    expect(starts.length).toBeGreaterThan(0);
    expect(computeStateChecksum(observed)).toBe(computeStateChecksum(unobserved));
    expect(createStateSnapshot(observed)).toEqual(createStateSnapshot(unobserved));
  });

  test.each([
    ['P1', 'P2'],
    ['P2', 'P1'],
  ] as const)(
    'latches %s launch against %s parry without side-order bias',
    (attackerId, defenderId) => {
      const state = createInitialState({ seed: 2027 });
      state.players.P1.pos = { x: -3, y: 0 };
      state.players.P2.pos = { x: 3, y: 0 };
      state.players[attackerId].launchActive = 0.1;
      const input = neutralInput();
      input[defenderId.toLowerCase() as 'p1' | 'p2'].parry = true;
      const starts: SimulationActionStart[] = [];

      step(state, input, FIXED_DT, {
        onActionStart: (event) => starts.push(event),
      });

      expect(starts).toContainEqual({ playerId: defenderId, action: 'parry' });
      expect(state.players[attackerId].stunned).toBeGreaterThan(0);
      expect(state.players[defenderId].helpless).toBe(0);
    },
  );
});

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

  test('dunk startup pursues a launched target but releases tracking when helpless ends', () => {
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.dunk.startupPursuitSpeed = 60;
    vanguard.moves.dunk.startupTracking = 1;
    const state = createInitialState({ characterBalanceOverrides: { vanguard } });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 7, y: 0 };
    state.players.P2.vel = { x: 0, y: 70 };
    state.players.P2.helpless = 1;

    const input = neutralInput();
    input.p1.dunk = true;
    step(state, input, FIXED_DT);
    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P1.dunkStartup).toBeGreaterThan(0);
    expect(state.players.P1.vel.y).toBeGreaterThan(20);

    state.players.P1.vel = { x: 0, y: 0 };
    state.players.P2.helpless = 0;
    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P1.vel.x).toBe(0);
    expect(state.players.P1.vel.y).toBe(0);
  });

  test('launch break severs a committed dunk chase immediately', () => {
    const state = createInitialState();
    state.players.P1.dunkStartup = 1;
    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    const input = neutralInput();
    input.p2.breakLaunch = true;

    step(state, input, FIXED_DT);

    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P2.lastLaunchedBy).toBeNull();
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

  test.each(['stunned', 'helpless', 'recovering'] as const)(
    'ends active super boost and settles its cost when the fighter becomes %s',
    (controlLoss) => {
      const state = createInitialState();
      const startSuper = neutralInput();
      startSuper.p1.superBoost = true;
      startSuper.p1.moveX = 1;
      step(state, startSuper, FIXED_DT);
      const fuelBeforeControlLoss = state.players.P1.fuel;

      state.players.P1[controlLoss] = 1;
      step(state, neutralInput(), FIXED_DT);

      expect(state.players.P1.superBoost).toBe(0);
      expect(state.players.P1.fuel).toBeLessThan(fuelBeforeControlLoss);
    },
  );

  test('ends active super boost and settles its cost when the round ends', () => {
    const state = createInitialState();
    const startSuper = neutralInput();
    startSuper.p1.superBoost = true;
    startSuper.p1.moveX = 1;
    step(state, startSuper, FIXED_DT);
    const fuelBeforeRoundEnd = state.players.P1.fuel;

    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 0, y: 0 };
    state.players.P1.dunkActive = 1;
    state.players.P1.didCommitAttackDuringSuperBoost = true;
    state.players.P2.fuel = 0;
    step(state, neutralInput(), FIXED_DT);

    expect(state.winner).toBe('P1');
    expect(state.players.P1.superBoost).toBe(0);
    expect(state.players.P1.fuel).toBeLessThan(fuelBeforeRoundEnd);
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

  test('launch release speed ratio can preserve control loss at the same drift speed', () => {
    const state = createInitialState();
    state.tuning.helplessReleaseSpeedRatio = 0.05;
    state.players.P2.helpless = 4;
    state.players.P2.vel = { x: 6, y: 0 };

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P2.helpless).toBeGreaterThan(0);
  });

  test('natural control return preserves current movement when its reset scale is zero', () => {
    const baseline = createInitialState();
    const linked = createInitialState();
    for (const state of [baseline, linked]) {
      state.players.P1.pos = { x: -8, y: 0 };
      state.players.P2.pos = { x: 8, y: 0 };
      state.players.P2.vel = { x: 6, y: 0 };
      state.players.P2.helpless = 4;
      state.players.P1.chain = 1;
      state.players.P1.chainTimer = 1;
    }
    linked.players.P2.lastLaunchedBy = 'P1';

    step(baseline, neutralInput(), FIXED_DT);
    step(linked, neutralInput(), FIXED_DT);

    expect(linked.players.P1.pos).toEqual(baseline.players.P1.pos);
    expect(linked.players.P2.pos).toEqual(baseline.players.P2.pos);
    expect(linked.players.P1.vel).toEqual(baseline.players.P1.vel);
    expect(linked.players.P2.vel).toEqual(baseline.players.P2.vel);
    expect(linked.players.P1.chain).toBe(0);
    expect(linked.players.P2.lastLaunchedBy).toBeNull();
  });

  test('natural recovery reset can create space when control returns inside pressure', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    candidate.tuning.naturalRecoveryResetMultiplier = 1;
    for (const state of [baseline, candidate]) {
      state.players.P1.pos = { x: -8, y: 0 };
      state.players.P2.pos = { x: 8, y: 0 };
      state.players.P1.vel = { x: 0, y: 0 };
      state.players.P2.vel = { x: 6, y: 0 };
      state.players.P2.helpless = 4;
      state.players.P2.lastLaunchedBy = 'P1';
    }

    step(baseline, neutralInput(), FIXED_DT);
    step(candidate, neutralInput(), FIXED_DT);

    const baselineDistance = baseline.players.P2.pos.x - baseline.players.P1.pos.x;
    const candidateDistance = candidate.players.P2.pos.x - candidate.players.P1.pos.x;
    expect(candidateDistance).toBeGreaterThanOrEqual(26);
    expect(candidateDistance).toBeGreaterThan(baselineDistance);
    expect(candidate.players.P1.vel.x).toBeLessThan(0);
    expect(candidate.players.P2.vel.x).toBeGreaterThan(baseline.players.P2.vel.x);
  });

  test('natural recovery reset does not add impulse after safe spacing is established', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    candidate.tuning.naturalRecoveryResetMultiplier = 0.5;
    for (const state of [baseline, candidate]) {
      state.players.P1.pos = { x: -20, y: 0 };
      state.players.P2.pos = { x: 20, y: 0 };
      state.players.P1.vel = { x: 0, y: 0 };
      state.players.P2.vel = { x: 6, y: 0 };
      state.players.P2.helpless = 4;
      state.players.P2.lastLaunchedBy = 'P1';
    }

    step(baseline, neutralInput(), FIXED_DT);
    step(candidate, neutralInput(), FIXED_DT);

    expect(candidate.players.P1.pos).toEqual(baseline.players.P1.pos);
    expect(candidate.players.P2.pos).toEqual(baseline.players.P2.pos);
    expect(candidate.players.P1.vel).toEqual(baseline.players.P1.vel);
    expect(candidate.players.P2.vel).toEqual(baseline.players.P2.vel);
  });

  test('character rules scale natural recovery reset without changing the global mechanic', () => {
    const fullReset = createInitialState();
    const duelist = createCharacterBalanceConfig('duelist');
    duelist.stats.naturalRecoveryResetMultiplier = 0.5;
    const reducedReset = createInitialState({ characterBalanceOverrides: { duelist } });
    for (const state of [fullReset, reducedReset]) {
      state.tuning.naturalRecoveryResetMultiplier = 1;
      state.players.P1.pos = { x: -4, y: 0 };
      state.players.P2.pos = { x: 4, y: 0 };
      state.players.P1.vel = { x: 0, y: 0 };
      state.players.P2.vel = { x: 6, y: 0 };
      state.players.P2.helpless = 4;
      state.players.P2.lastLaunchedBy = 'P1';
    }

    step(fullReset, neutralInput(), FIXED_DT);
    step(reducedReset, neutralInput(), FIXED_DT);

    const fullDistance = fullReset.players.P2.pos.x - fullReset.players.P1.pos.x;
    const reducedDistance = reducedReset.players.P2.pos.x - reducedReset.players.P1.pos.x;
    expect(fullDistance).toBeGreaterThanOrEqual(26);
    expect(reducedDistance).toBeGreaterThanOrEqual(13);
    expect(reducedDistance).toBeLessThan(fullDistance);
  });

  test('natural recovery does not grant free separation to a low-reserve finish target', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    candidate.tuning.naturalRecoveryResetMultiplier = 1;
    for (const state of [baseline, candidate]) {
      state.players.P1.pos = { x: -8, y: 0 };
      state.players.P2.pos = { x: 8, y: 0 };
      state.players.P1.vel = { x: 0, y: 0 };
      state.players.P2.vel = { x: 6, y: 0 };
      state.players.P2.fuel = state.players.P2.maxFuel * 0.1;
      state.players.P2.helpless = 4;
      state.players.P2.lastLaunchedBy = 'P1';
    }

    step(baseline, neutralInput(), FIXED_DT);
    step(candidate, neutralInput(), FIXED_DT);

    expect(candidate.players.P1.pos).toEqual(baseline.players.P1.pos);
    expect(candidate.players.P2.pos).toEqual(baseline.players.P2.pos);
    expect(candidate.players.P1.vel).toEqual(baseline.players.P1.vel);
    expect(candidate.players.P2.vel).toEqual(baseline.players.P2.vel);
  });

  test('simultaneous natural returns apply one symmetric reset without player-order bias', () => {
    const state = createInitialState();
    state.tuning.naturalRecoveryResetMultiplier = 1;
    for (const player of Object.values(state.players)) {
      player.pos = { x: 0, y: 0 };
      player.vel = { x: 0, y: 0 };
      player.helpless = 4;
      player.chain = 1;
      player.chainTimer = 1;
    }
    state.players.P1.lastLaunchedBy = 'P2';
    state.players.P2.lastLaunchedBy = 'P1';

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P1.pos.x).toBeCloseTo(-13);
    expect(state.players.P2.pos.x).toBeCloseTo(13);
    expect(state.players.P1.vel.x).toBeCloseTo(-14);
    expect(state.players.P2.vel.x).toBeCloseTo(14);
    expect(state.players.P1.lastLaunchedBy).toBeNull();
    expect(state.players.P2.lastLaunchedBy).toBeNull();
    expect(state.players.P1.chain).toBe(0);
    expect(state.players.P2.chain).toBe(0);
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

  test('commit separation is disabled by default and can be enabled for local experiments', () => {
    const baseline = createInitialState();
    baseline.players.P1.pos = { x: 0, y: 0 };
    baseline.players.P2.pos = { x: 1, y: 0 };
    baseline.players.P1.launchStartup = 0.2;

    step(baseline, neutralInput(), FIXED_DT);

    expect(baseline.players.P2.pos.x - baseline.players.P1.pos.x).toBeCloseTo(1);

    const candidate = createInitialState();
    candidate.tuning.closeRangeSeparationPadding = 8;
    candidate.tuning.closeRangeSeparationImpulse = 20;
    candidate.tuning.closeRangeCommitSeparationMultiplier = 0.5;
    candidate.players.P1.pos = { x: 0, y: 0 };
    candidate.players.P2.pos = { x: 1, y: 0 };
    candidate.players.P1.launchStartup = 0.2;

    step(candidate, neutralInput(), FIXED_DT);

    expect(candidate.players.P2.pos.x - candidate.players.P1.pos.x).toBeGreaterThan(8);
    expect(candidate.players.P1.vel.x).toBeLessThan(0);
    expect(candidate.players.P2.vel.x).toBeGreaterThan(0);
  });

  test('action recovery control can preserve recoil instead of letting held boost overwrite it', () => {
    const createRecoveryState = () => {
      const state = createInitialState();
      state.players.P1.pos = { x: -8, y: 0 };
      state.players.P2.pos = { x: 8, y: 0 };
      state.players.P1.vel = { x: -40, y: 0 };
      state.players.P1.endLag = 0.2;
      return state;
    };
    const baseline = createRecoveryState();
    const committed = createRecoveryState();
    committed.tuning.actionRecoveryControlMultiplier = 0;
    const input = neutralInput();
    input.p1.moveX = 1;
    input.p1.boost = true;

    step(baseline, input, FIXED_DT);
    step(committed, input, FIXED_DT);

    expect(baseline.players.P1.vel.x).toBeGreaterThan(0);
    expect(committed.players.P1.vel.x).toBeLessThan(0);
    expect(committed.players.P1.boostActive).toBe(false);
  });

  test('combat boost lock is opt-in and preserves inherited momentum after an accepted launch', () => {
    const boosted = createInitialState();
    boosted.players.P1.vel = { x: -40, y: 0 };
    const startBoost = neutralInput();
    startBoost.p1.moveX = -1;
    startBoost.p1.boost = true;
    step(boosted, startBoost, FIXED_DT);
    expect(boosted.players.P1.boostActive).toBe(true);
    boosted.players.P1.vel = { x: -40, y: 0 };

    const baseline = restoreStateFromSnapshot(createStateSnapshot(boosted));
    const candidate = restoreStateFromSnapshot(createStateSnapshot(boosted));
    candidate.tuning.combatBoostReacquireDelaySeconds = 0.18;
    const input = neutralInput();
    input.p1.moveX = 1;
    input.p1.boost = true;
    input.p1.launch = true;
    const lockFrames: Array<{
      phase: 'commitment' | 'recovery' | 'delay';
      inputHeld: boolean;
      cancelledActiveBoost: boolean;
    }> = [];
    const actionStarts: SimulationActionStart[] = [];

    step(baseline, input, FIXED_DT);
    step(candidate, input, FIXED_DT, {
      onActionStart: (event) => actionStarts.push(event),
      onCombatBoostLockFrame: (event) => {
        if (event.playerId === 'P1') {
          lockFrames.push(event);
        }
      },
    });

    expect(baseline.players.P1.boostActive).toBe(true);
    expect(candidate.players.P1.boostActive).toBe(false);
    expect(candidate.players.P1.vel.x).toBeLessThan(0);
    expect(candidate.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);
    expect(actionStarts).toContainEqual({ playerId: 'P1', action: 'launch' });
    expect(lockFrames).toEqual([{
      playerId: 'P1',
      phase: 'commitment',
      inputHeld: true,
      cancelledActiveBoost: true,
    }]);
  });

  test.each(['special', 'dunk', 'parry'] as const)(
    'accepted %s commitment cancels ordinary boost and arms the lock',
    (action) => {
      const state = createInitialState();
      state.tuning.combatBoostReacquireDelaySeconds = 0.18;
      const boost = neutralInput();
      boost.p1.moveX = 1;
      boost.p1.boost = true;
      step(state, boost, FIXED_DT);
      expect(state.players.P1.boostActive).toBe(true);

      const commitment = neutralInput();
      commitment.p1.boost = true;
      commitment.p1[action] = true;
      const actionStarts: SimulationActionStart[] = [];
      step(state, commitment, FIXED_DT, {
        onActionStart: (event) => actionStarts.push(event),
        onCombatBoostLockFrame: () => undefined,
      });

      expect(actionStarts).toContainEqual({ playerId: 'P1', action });
      expect(state.players.P1.boostActive).toBe(false);
      expect(state.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);
    },
  );

  test('combat boost lock keeps ordinary boost unavailable for the authored post-recovery delay', () => {
    const state = createInitialState();
    state.tuning.combatBoostReacquireDelaySeconds = 0.18;
    const startLaunch = neutralInput();
    startLaunch.p1.launch = true;
    step(state, startLaunch, FIXED_DT);

    const heldBoost = neutralInput();
    heldBoost.p1.moveX = 1;
    heldBoost.p1.boost = true;
    const observedPhases = new Set<'commitment' | 'recovery' | 'delay'>();
    const observer = {
      onActionStart: () => undefined,
      onCombatBoostLockFrame: (event: {
        playerId: PlayerId;
        phase: 'commitment' | 'recovery' | 'delay';
      }) => {
        if (event.playerId === 'P1') {
          observedPhases.add(event.phase);
        }
      },
    };

    let recoveryFrames = 0;
    while (
      state.players.P1.launchStartup > 0
      || state.players.P1.launchActive > 0
      || state.players.P1.endLag > 0
    ) {
      step(state, heldBoost, FIXED_DT, observer);
      expect(state.players.P1.boostActive).toBe(false);
      recoveryFrames += 1;
      expect(recoveryFrames).toBeLessThan(120);
    }
    expect(state.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);

    let delayFrames = 0;
    while (state.players.P1.combatBoostLockRemaining > 0) {
      step(state, heldBoost, FIXED_DT, observer);
      expect(state.players.P1.boostActive).toBe(false);
      delayFrames += 1;
      expect(delayFrames).toBeLessThan(20);
    }
    step(state, heldBoost, FIXED_DT);

    expect(delayFrames).toBe(11);
    expect(state.players.P1.boostActive).toBe(true);
    expect(observedPhases).toEqual(new Set(['commitment', 'recovery', 'delay']));
  });

  test('combat boost lock does not disable paid super boost during an attack commitment', () => {
    const state = createInitialState();
    state.tuning.combatBoostReacquireDelaySeconds = 0.18;
    const input = neutralInput();
    input.p1.moveY = 1;
    input.p1.superBoost = true;
    input.p1.launch = true;

    step(state, input, FIXED_DT);

    expect(state.players.P1.superBoost).toBeGreaterThan(0);
    expect(state.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);
  });

  test('launch break starts its boost delay only after authored recovery returns control', () => {
    const state = createInitialState();
    state.tuning.combatBoostReacquireDelaySeconds = 0.18;
    state.players.P1.helpless = 1;
    state.players.P1.lastLaunchedBy = 'P2';
    const breakAndBoost = neutralInput();
    breakAndBoost.p1.breakLaunch = true;
    breakAndBoost.p1.boost = true;
    const phases: string[] = [];
    const observer = {
      onActionStart: () => undefined,
      onCombatBoostLockFrame: (event: { playerId: PlayerId; phase: string }) => {
        if (event.playerId === 'P1') {
          phases.push(event.phase);
        }
      },
    };

    step(state, breakAndBoost, FIXED_DT, observer);
    expect(state.players.P1.stunned).toBeGreaterThan(0);
    expect(state.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);

    let recoveryFrames = 0;
    while (state.players.P1.stunned > 0) {
      step(state, breakAndBoost, FIXED_DT, observer);
      expect(state.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);
      recoveryFrames += 1;
      expect(recoveryFrames).toBeLessThan(60);
    }
    expect(phases).toContain('recovery');

    let delayFrames = 0;
    while (state.players.P1.combatBoostLockRemaining > 0) {
      step(state, breakAndBoost, FIXED_DT, observer);
      expect(state.players.P1.boostActive).toBe(false);
      delayFrames += 1;
      expect(delayFrames).toBeLessThan(20);
    }
    step(state, breakAndBoost, FIXED_DT);
    expect(delayFrames).toBe(11);
    expect(state.players.P1.boostActive).toBe(true);
  });

  test('a rejected commitment does not create a combat boost lock', () => {
    const state = createInitialState();
    state.tuning.combatBoostReacquireDelaySeconds = 0.18;
    state.players.P1.endLag = 0.2;
    const input = neutralInput();
    input.p1.moveX = 1;
    input.p1.boost = true;
    input.p1.launch = true;
    const actionStarts: SimulationActionStart[] = [];

    step(state, input, FIXED_DT, {
      onActionStart: (event) => actionStarts.push(event),
      onCombatBoostLockFrame: () => undefined,
    });

    expect(actionStarts).not.toContainEqual({ playerId: 'P1', action: 'launch' });
    expect(state.players.P1.combatBoostLockRemaining).toBe(0);
    expect(state.players.P1.boostActive).toBe(true);
  });

  test('setting combat boost delay back to zero disables a latent lock immediately', () => {
    const state = createInitialState();
    state.tuning.combatBoostReacquireDelaySeconds = 0;
    state.players.P1.combatBoostLockRemaining = 0.18;
    const input = neutralInput();
    input.p1.moveX = 1;
    input.p1.boost = true;

    step(state, input, FIXED_DT);

    expect(state.players.P1.boostActive).toBe(true);
    expect(state.players.P1.combatBoostLockRemaining).toBe(0);
  });

  test('combat boost lock survives an interrupted accepted commitment and is checksummed', () => {
    const state = createInitialState();
    state.tuning.combatBoostReacquireDelaySeconds = 0.18;
    const input = neutralInput();
    input.p1.launch = true;
    step(state, input, FIXED_DT);

    state.players.P1.launchStartup = 0;
    state.players.P1.stunned = 4 * FIXED_DT;
    const interrupted = restoreStateFromSnapshot(createStateSnapshot(state));
    const unlocked = restoreStateFromSnapshot(createStateSnapshot(state));
    unlocked.players.P1.combatBoostLockRemaining = 0;

    expect(computeStateChecksum(interrupted)).not.toBe(computeStateChecksum(unlocked));
    for (let frame = 0; frame < 4; frame += 1) {
      step(interrupted, neutralInput(), FIXED_DT);
      expect(interrupted.players.P1.combatBoostLockRemaining).toBeCloseTo(0.18);
    }
  });

  test('default parry reset converts a successful defense into neutral space', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -2, y: 0 };
    state.players.P2.pos = { x: 2, y: 0 };
    state.players.P1.launchActive = 0.12;
    state.players.P2.parry = 0.12;

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThanOrEqual(26);
    expect(state.players.P1.stunned).toBeGreaterThan(0);
    expect(state.players.P1.vel.x).toBeLessThan(0);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
  });

  test('defense impulse still applies when fighters already exceed the configured reset distance', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    candidate.tuning.defensiveResetDistance = 4;
    candidate.tuning.defensiveResetImpulse = 24;
    for (const state of [baseline, candidate]) {
      state.players.P1.pos = { x: -3, y: 0 };
      state.players.P2.pos = { x: 3, y: 0 };
      state.players.P1.launchActive = 0.12;
      state.players.P2.parry = 0.12;
    }

    step(baseline, neutralInput(), FIXED_DT);
    step(candidate, neutralInput(), FIXED_DT);

    expect(candidate.players.P1.vel.x).toBeLessThan(baseline.players.P1.vel.x);
    expect(candidate.players.P2.vel.x).toBeGreaterThan(baseline.players.P2.vel.x);
  });

  test('default launch break reset converts the resource spend into neutral space', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -2, y: 0 };
    state.players.P2.pos = { x: 2, y: 0 };
    state.players.P1.vel = { x: 0, y: 0 };
    state.players.P2.vel = { x: 0, y: 0 };
    state.players.P1.helpless = 1;
    state.players.P1.lastLaunchedBy = 'P2';
    const input = neutralInput();
    input.p1.breakLaunch = true;

    step(state, input, FIXED_DT);

    expect(state.players.P1.helpless).toBe(0);
    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThanOrEqual(26 * 1.1);
    expect(state.players.P1.vel.x).toBeLessThan(0);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
  });

  test('launch break reset scale can preserve parry spacing without moving a breaker', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    candidate.tuning.defensiveResetDistance = 28;
    candidate.tuning.defensiveResetImpulse = 35;
    candidate.tuning.launchBreakResetMultiplier = 0;
    baseline.tuning.defensiveResetDistance = 0;
    baseline.tuning.defensiveResetImpulse = 0;
    for (const state of [baseline, candidate]) {
      state.players.P1.pos = { x: -2, y: 0 };
      state.players.P2.pos = { x: 2, y: 0 };
      state.players.P1.vel = { x: 0, y: 0 };
      state.players.P2.vel = { x: 0, y: 0 };
      state.players.P1.helpless = 1;
      state.players.P1.lastLaunchedBy = 'P2';
    }
    const input = neutralInput();
    input.p1.breakLaunch = true;

    step(baseline, input, FIXED_DT);
    step(candidate, input, FIXED_DT);

    expect(candidate.players.P1.pos).toEqual(baseline.players.P1.pos);
    expect(candidate.players.P2.pos).toEqual(baseline.players.P2.pos);
    expect(candidate.players.P1.vel).toEqual(baseline.players.P1.vel);
    expect(candidate.players.P2.vel).toEqual(baseline.players.P2.vel);
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

  test('clash distance and recoil are independently tunable', () => {
    const createClashState = () => {
      const state = createInitialState();
      state.players.P1.pos = { x: -2.5, y: 0 };
      state.players.P2.pos = { x: 2.5, y: 0 };
      state.players.P1.launchActive = 0.12;
      state.players.P2.launchActive = 0.12;
      return state;
    };
    const baseline = createClashState();
    const wider = createClashState();
    const stronger = createClashState();
    wider.tuning.launchClashSeparationPadding = 24;
    stronger.tuning.launchClashRecoilMultiplier = 1;

    step(baseline, neutralInput(), FIXED_DT);
    step(wider, neutralInput(), FIXED_DT);
    step(stronger, neutralInput(), FIXED_DT);

    const baselineDistance = baseline.players.P2.pos.x - baseline.players.P1.pos.x;
    const widerDistance = wider.players.P2.pos.x - wider.players.P1.pos.x;
    const strongerDistance = stronger.players.P2.pos.x - stronger.players.P1.pos.x;
    expect(widerDistance).toBeGreaterThan(baselineDistance);
    expect(wider.players.P2.vel.x).toBeCloseTo(baseline.players.P2.vel.x);
    expect(stronger.players.P2.vel.x).toBeGreaterThan(baseline.players.P2.vel.x);
    expect(strongerDistance).toBeGreaterThan(baselineDistance);
  });

  test('startup clash grace lets near-simultaneous launch attempts trade', () => {
    const state = createInitialState();
    state.tuning.startupClashGraceSeconds = 0.033;
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    state.players.P1.launchActive = 0.12;
    state.players.P2.launchStartup = 0.02;

    step(state, neutralInput(), FIXED_DT);

    expect(state.players.P1.helpless).toBe(0);
    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P1.launchActive).toBe(0);
    expect(state.players.P2.launchStartup).toBe(0);
    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThan(14);
  });

  test('startup clash grace uses frame-start state symmetrically for P1 and P2', () => {
    const p1Active = createInitialState();
    const p2Active = createInitialState();
    for (const state of [p1Active, p2Active]) {
      state.tuning.startupClashGraceSeconds = 0.033;
      state.players.P1.pos = { x: -2.5, y: 0 };
      state.players.P2.pos = { x: 2.5, y: 0 };
    }
    p1Active.players.P1.launchActive = 0.12;
    p1Active.players.P2.launchStartup = 0.04;
    p2Active.players.P1.launchStartup = 0.04;
    p2Active.players.P2.launchActive = 0.12;

    step(p1Active, neutralInput(), FIXED_DT);
    step(p2Active, neutralInput(), FIXED_DT);

    expect(p1Active.players.P1.chain).toBe(1);
    expect(p1Active.players.P2.helpless).toBeGreaterThan(0);
    expect(p2Active.players.P2.chain).toBe(1);
    expect(p2Active.players.P1.helpless).toBeGreaterThan(0);
  });

  test('post-control counter launch clashes only against a launch started after control return', () => {
    const state = createInitialState();
    state.tuning.postControlCounterLaunchClashGraceSeconds = 2 / 60;
    state.tuning.closeRangeSeparationPadding = 0;
    state.tuning.closeRangeSeparationImpulse = 0;
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    state.players.P1.helpless = FIXED_DT * 0.5;
    state.players.P1.lastLaunchedBy = 'P2';
    state.players.P1.postControlCounterPending = true;
    state.players.P2.launchAttemptSerial = 4;

    step(state, neutralInput(), FIXED_DT);
    expect(state.players.P1.postControlCounterWindow).toBe(1);
    expect(state.players.P1.postControlCounterOpponentLaunchSerialAtReturn).toBe(4);

    const launchInput = neutralInput();
    launchInput.p1.launch = true;
    launchInput.p2.launch = true;
    const clashes: SimulationLaunchClash[] = [];
    for (let frame = 0; frame < 12 && clashes.length === 0; frame += 1) {
      step(state, frame === 0 ? launchInput : neutralInput(), FIXED_DT, {
        onActionStart: () => undefined,
        onLaunchClash: (event) => clashes.push(event),
      });
    }

    expect(clashes).toEqual([{
      cause: 'post_control_counter_launch',
      gracePlayerId: 'P1',
    }]);
    expect(state.players.P1.helpless).toBe(0);
    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThan(14);
  });

  test('post-control counter launch does not armor against an attack already underway at return', () => {
    const state = createInitialState();
    state.tuning.postControlCounterLaunchClashGraceSeconds = 2 / 60;
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    state.players.P1.launchStartup = 0.02;
    state.players.P1.postControlCounterLaunchEligible = true;
    state.players.P1.postControlCounterOpponentLaunchSerialAtReturn = 5;
    state.players.P2.launchAttemptSerial = 5;
    state.players.P2.launchActive = 0.12;
    const clashes: SimulationLaunchClash[] = [];

    step(state, neutralInput(), FIXED_DT, {
      onActionStart: () => undefined,
      onLaunchClash: (event) => clashes.push(event),
    });

    expect(clashes).toEqual([]);
    expect(state.players.P1.helpless).toBeGreaterThan(0);
    expect(state.players.P2.chain).toBe(1);
  });

  test('the first accepted non-launch action consumes post-control counter eligibility', () => {
    const state = createInitialState();
    state.tuning.postControlCounterLaunchClashGraceSeconds = 2 / 60;
    state.players.P1.postControlCounterWindow = 1;
    state.players.P1.postControlCounterOpponentLaunchSerialAtReturn = 3;
    const input = neutralInput();
    input.p1.parry = true;

    step(state, input, FIXED_DT);

    expect(state.players.P1.parry).toBeGreaterThan(0);
    expect(state.players.P1.postControlCounterWindow).toBe(0);
    expect(state.players.P1.postControlCounterOpponentLaunchSerialAtReturn).toBe(0);
    expect(state.players.P1.postControlCounterLaunchEligible).toBe(false);
  });

  test('launch-break recovery arms the post-control counter window after recovery, not on spend', () => {
    const state = createInitialState();
    state.tuning.postControlCounterLaunchClashGraceSeconds = 2 / 60;
    state.players.P1.helpless = 1;
    state.players.P1.lastLaunchedBy = 'P2';
    state.players.P1.postControlCounterPending = true;
    const input = neutralInput();
    input.p1.breakLaunch = true;

    step(state, input, FIXED_DT);
    expect(state.players.P1.postControlCounterWindow).toBe(0);
    expect(state.players.P1.postControlCounterPending).toBe(true);

    for (let frame = 0; frame < 120 && state.players.P1.stunned > 0; frame += 1) {
      step(state, neutralInput(), FIXED_DT);
    }

    expect(state.players.P1.stunned).toBe(0);
    expect(state.players.P1.postControlCounterPending).toBe(false);
    expect(state.players.P1.postControlCounterWindow).toBeGreaterThan(0);
  });

  test('launch activation uses only frame-start clash state for both player orders', () => {
    const p2Active = createInitialState();
    const p1Active = createInitialState();
    for (const state of [p2Active, p1Active]) {
      state.tuning.startupClashGraceSeconds = 0;
      state.players.P1.pos = { x: -2.5, y: 0 };
      state.players.P2.pos = { x: 2.5, y: 0 };
    }
    p2Active.players.P1.launchStartup = 0.01;
    p2Active.players.P2.launchActive = 0.12;
    p1Active.players.P1.launchActive = 0.12;
    p1Active.players.P2.launchStartup = 0.01;

    step(p2Active, neutralInput(), FIXED_DT);
    step(p1Active, neutralInput(), FIXED_DT);

    expect(p2Active.players.P2.chain).toBe(1);
    expect(p2Active.players.P1.helpless).toBeGreaterThan(0);
    expect(p1Active.players.P1.chain).toBe(1);
    expect(p1Active.players.P2.helpless).toBeGreaterThan(0);
  });

  test.each(['P1', 'P2'] as const)(
    'resolves an active %s launch before the defender locomotion phase',
    (attackerId) => {
      const defenderId = attackerId === 'P1' ? 'P2' : 'P1';
      const state = createInitialState();
      state.players.P1.pos = { x: -2.5, y: 0 };
      state.players.P2.pos = { x: 2.5, y: 0 };
      state.players[attackerId].launchActive = 0.12;
      const defenderFuel = state.players[defenderId].fuel;
      const input = neutralInput();
      input[defenderId === 'P1' ? 'p1' : 'p2'].moveY = 1;

      step(state, input, FIXED_DT);

      expect(state.players[defenderId].helpless).toBeGreaterThan(0);
      expect(state.players[defenderId].fuel).toBe(defenderFuel);
    },
  );

  test('uses action phase priority instead of player order for launch versus special', () => {
    const direct = createInitialState({
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    direct.players.P1.pos = { x: -2.5, y: 0 };
    direct.players.P2.pos = { x: 2.5, y: 0 };
    direct.players.P1.launchActive = 0.12;
    direct.players.P2.specialActive = 0.12;
    direct.players.P2.specialDidResolve = false;
    const mirrored = mirrorStateForPlayerSwap(direct);

    step(direct, neutralInput(), FIXED_DT);
    step(mirrored, neutralInput(), FIXED_DT);

    expect(canonicalSymmetryState(mirrorStateForPlayerSwap(mirrored))).toEqual(
      canonicalSymmetryState(direct),
    );
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

  test('checksum includes global tuning and local character rules', () => {
    const baseline = createInitialState({ seed: 424243 });
    const changedTuning = createInitialState({ seed: 424243 });
    changedTuning.tuning.launchBasePower += 1;

    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.dunk.hitRange += 0.5;
    const changedCharacter = createInitialState({
      seed: 424243,
      characterBalanceOverrides: { vanguard },
    });

    expect(computeStateChecksum(changedTuning)).not.toBe(computeStateChecksum(baseline));
    expect(computeStateChecksum(changedCharacter)).not.toBe(computeStateChecksum(baseline));
  });

  test('local character rules drive move timing without mutating the package registry', () => {
    const packageStartup = CHARACTER_BY_ID.vanguard.moves.launch.startupFrames;
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames = 1;
    vanguard.stats.fuelCapacityMultiplier = 1.4;
    const state = createInitialState({ characterBalanceOverrides: { vanguard } });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    const input = neutralInput();
    input.p1.launch = true;

    step(state, input, FIXED_DT);

    expect(state.players.P1.launchStartup).toBeCloseTo(framesToSeconds(1));
    expect(state.players.P1.maxFuel).toBeCloseTo(MAX_FUEL * 1.4);
    expect(CHARACTER_BY_ID.vanguard.moves.launch.startupFrames).toBe(packageStartup);
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
    const vanguardOverride = createCharacterBalanceConfig('vanguard');
    vanguardOverride.moves.dunk.hitRange += 1;
    state.characterBalanceOverrides.vanguard = vanguardOverride;
    state.rngState = 42;

    expect(snapshot.players.P1.pos.x).not.toBe(state.players.P1.pos.x);
    expect(snapshot.players.P1.cool.special).not.toBe(state.players.P1.cool.special);
    expect(snapshot.projectiles.length).toBe(0);
    expect(snapshot.loadout.P1).toBe('vanguard');
    expect(snapshot.tuning.playerMoveAccel).not.toBe(state.tuning.playerMoveAccel);
    expect(snapshot.characterBalanceOverrides.vanguard).toBeUndefined();
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

  test('restore preserves finite custom tuning exactly instead of applying editor clamps', () => {
    const state = createInitialState({ seed: 90210 });
    state.tuning.defensiveResetImpulse = 151;
    state.tuning.playerMoveAccel = 0.25;
    const snapshot = createStateSnapshot(state);

    const restored = restoreStateFromSnapshot(snapshot);

    expect(restored.tuning.defensiveResetImpulse).toBe(151);
    expect(restored.tuning.playerMoveAccel).toBe(0.25);
    expect(computeStateChecksum(restored)).toBe(computeStateChecksum(state));
  });

  test('exposes deterministic presentation actions for sprite startup and active tells', () => {
    const state = createInitialState({ seed: 8102 });
    expect(getRenderSnapshot(state).players.P1).toMatchObject({
      presentationAction: 'idle',
      presentationPhase: 'none',
    });

    state.players.P1.launchStartup = 0.1;
    expect(getRenderSnapshot(state).players.P1).toMatchObject({
      presentationAction: 'launch',
      presentationPhase: 'startup',
    });

    state.players.P1.launchStartup = 0;
    state.players.P1.launchActive = 0.05;
    expect(getRenderSnapshot(state).players.P1).toMatchObject({
      presentationAction: 'launch',
      presentationPhase: 'active',
    });

    state.players.P1.launchActive = 0;
    state.players.P1.helpless = 0.3;
    expect(getRenderSnapshot(state).players.P1).toMatchObject({
      presentationAction: 'helpless',
      presentationPhase: 'sustain',
    });

    state.players.P1.helpless = 0;
    state.players.P1.endLag = 0.2;
    expect(getRenderSnapshot(state).players.P1).toMatchObject({
      presentationAction: 'recover',
      presentationPhase: 'recovery',
    });
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

  test('deserialise v1 snapshots without character overrides as package-default state', () => {
    const state = createStateSnapshot(createInitialState({ seed: 2024 }));
    const legacyState = { ...state } as Partial<typeof state>;
    delete legacyState.characterBalanceOverrides;
    const restored = deserialiseState(JSON.stringify({ version: 1, state: legacyState }));

    expect(restored.characterBalanceOverrides).toEqual({});
    expect(restored.players.P1.maxFuel).toBe(state.players.P1.maxFuel);
  });

  test('deserialise fills new flow controls into older tuning snapshots', () => {
    const state = createStateSnapshot(createInitialState({ seed: 2026 }));
    const legacyTuning = { ...state.tuning } as Partial<typeof state.tuning>;
    delete legacyTuning.helplessReleaseSpeedRatio;
    delete legacyTuning.actionRecoveryControlMultiplier;
    delete legacyTuning.combatBoostReacquireDelaySeconds;
    delete legacyTuning.startupClashGraceSeconds;
    delete legacyTuning.launchClashSeparationPadding;
    delete legacyTuning.launchClashRecoilMultiplier;
    delete legacyTuning.closeRangeSeparationPadding;
    delete legacyTuning.closeRangeSeparationImpulse;
    delete legacyTuning.closeRangeCommitSeparationMultiplier;
    delete legacyTuning.defensiveResetDistance;
    delete legacyTuning.defensiveResetImpulse;
    delete legacyTuning.launchBreakResetMultiplier;
    delete legacyTuning.naturalRecoveryResetMultiplier;

    const restored = deserialiseState(JSON.stringify({
      version: STATE_SNAPSHOT_VERSION,
      state: { ...state, tuning: legacyTuning },
    }));

    expect(restored.tuning).toEqual(createDefaultTuning());
  });

  test('deserialise v2 snapshots without post-control counter fields as neutral state', () => {
    const state = createStateSnapshot(createInitialState({ seed: 2027 }));
    const legacyTuning = state.tuning as Partial<typeof state.tuning>;
    delete legacyTuning.postControlCounterLaunchClashGraceSeconds;
    delete legacyTuning.combatBoostReacquireDelaySeconds;
    for (const playerId of ['P1', 'P2'] as const) {
      const legacyPlayer = state.players[playerId] as Partial<PlayerState>;
      delete legacyPlayer.combatBoostLockRemaining;
      delete legacyPlayer.launchAttemptSerial;
      delete legacyPlayer.postControlCounterPending;
      delete legacyPlayer.postControlCounterWindow;
      delete legacyPlayer.postControlCounterOpponentLaunchSerialAtReturn;
      delete legacyPlayer.postControlCounterLaunchEligible;
    }

    const restored = deserialiseState(JSON.stringify({ version: 2, state }));

    expect(restored.tuning.postControlCounterLaunchClashGraceSeconds).toBe(0);
    expect(restored.tuning.combatBoostReacquireDelaySeconds).toBe(0);
    for (const playerId of ['P1', 'P2'] as const) {
      expect(restored.players[playerId]).toMatchObject({
        combatBoostLockRemaining: 0,
        launchAttemptSerial: 0,
        postControlCounterPending: false,
        postControlCounterWindow: 0,
        postControlCounterOpponentLaunchSerialAtReturn: 0,
        postControlCounterLaunchEligible: false,
      });
    }
  });

  test('deserialise v3 snapshots without combat boost fields as an unlocked state', () => {
    const state = createStateSnapshot(createInitialState({ seed: 2028 }));
    delete (state.tuning as Partial<typeof state.tuning>).combatBoostReacquireDelaySeconds;
    for (const playerId of ['P1', 'P2'] as const) {
      delete (state.players[playerId] as Partial<PlayerState>).combatBoostLockRemaining;
    }

    const restored = deserialiseState(JSON.stringify({ version: 3, state }));

    expect(restored.tuning.combatBoostReacquireDelaySeconds).toBe(0);
    expect(restored.players.P1.combatBoostLockRemaining).toBe(0);
    expect(restored.players.P2.combatBoostLockRemaining).toBe(0);
  });

  test('snapshot and checksum preserve active post-control counter state', () => {
    const state = createInitialState({ seed: 2028 });
    state.tuning.postControlCounterLaunchClashGraceSeconds = 2 / 60;
    Object.assign(state.players.P1, {
      launchAttemptSerial: 7,
      postControlCounterPending: false,
      postControlCounterWindow: 0,
      postControlCounterOpponentLaunchSerialAtReturn: 5,
      postControlCounterLaunchEligible: true,
      launchStartup: 1 / 60,
    });
    const checksum = computeStateChecksum(state);

    const restored = restoreStateFromSnapshot(createStateSnapshot(state));
    expect(restored.players.P1).toMatchObject({
      launchAttemptSerial: 7,
      postControlCounterOpponentLaunchSerialAtReturn: 5,
      postControlCounterLaunchEligible: true,
    });
    expect(computeStateChecksum(restored)).toBe(checksum);

    restored.players.P1.launchAttemptSerial = 0;
    restored.players.P1.postControlCounterOpponentLaunchSerialAtReturn = 0;
    restored.players.P1.postControlCounterLaunchEligible = false;
    expect(computeStateChecksum(restored)).not.toBe(checksum);
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
