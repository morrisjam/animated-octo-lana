import { describe, expect, test } from 'vitest';
import {
  applyBalanceScenario,
  BALANCE_SCENARIO_BY_ID,
  BALANCE_SCENARIO_IDS,
  BALANCE_SCENARIO_SCHEMA_VERSION,
  BALANCE_SCENARIOS,
  DEFAULT_BALANCE_SCENARIO_ID,
  resolveBalanceScenario,
  type BalanceScenarioId,
} from './balanceScenarios';
import { createCharacterBalanceConfig } from './characterBalance';
import { createInitialState, step } from './sim';
import type { FrameInput, GameState } from './types';

const EXPECTED_SCENARIO_IDS: BalanceScenarioId[] = [
  'standard',
  'long_neutral',
  'close_pressure',
  'post_clash',
  'launch_break_decision',
  'control_return_pressure',
  'p1_control_return_pressure',
  'zero_fuel_chase',
];

function playerDistance(state: GameState): number {
  return Math.hypot(
    state.players.P2.pos.x - state.players.P1.pos.x,
    state.players.P2.pos.y - state.players.P1.pos.y,
  );
}

function neutralInput(): FrameInput {
  const player = {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
  return { p1: { ...player }, p2: { ...player } };
}

function dirtyTransientState(state: GameState): void {
  state.rngState = 123;
  state.gameTime = 19;
  state.winner = 'P1';
  state.nextProjectileId = 8;
  state.projectiles.push({
    id: 7,
    ownerId: 'P2',
    pos: { x: 4, y: 5 },
    vel: { x: 6, y: 7 },
    life: 1,
    hitRadius: 2,
    stunSeconds: 0.5,
    fuelDamage: 3,
    visualId: 'test',
  });
  state.players.P1.pos = { x: 60, y: 20 };
  state.players.P1.vel = { x: -80, y: 11 };
  state.players.P1.fuel = 1;
  state.players.P1.launchBreaks = 0;
  state.players.P1.boostActive = true;
  state.players.P1.boostDir = { x: -1, y: 0 };
  state.players.P1.boostHeldTime = 2;
  state.players.P1.superBoost = 1;
  state.players.P1.superDir = { x: -1, y: 0 };
  state.players.P1.launchStartup = 1;
  state.players.P1.cool.special = 2;
  state.players.P2.pos = { x: -50, y: -30 };
  state.players.P2.vel = { x: 70, y: -12 };
  state.players.P2.fuel = 2;
  state.players.P2.launchBreaks = 2;
  state.players.P2.stunned = 1;
  state.players.P2.recovering = 2;
  state.players.P2.recoveryDuration = 3;
  state.players.P2.recoveryDir = { x: 0, y: 1 };
  state.players.P2.specialActive = 1;
  state.players.P2.lastLaunchedBy = 'P1';
}

describe('balance scenario registry', () => {
  test('exports the versioned presets in stable display order', () => {
    expect(BALANCE_SCENARIO_SCHEMA_VERSION).toBe('gw.balance-scenario.v1');
    expect(BALANCE_SCENARIO_IDS).toEqual(EXPECTED_SCENARIO_IDS);
    expect(BALANCE_SCENARIOS.map((scenario) => scenario.id)).toEqual(EXPECTED_SCENARIO_IDS);
    for (const scenario of BALANCE_SCENARIOS) {
      expect(BALANCE_SCENARIO_BY_ID[scenario.id]).toBe(scenario);
      expect(scenario.label.length).toBeGreaterThan(0);
      expect(scenario.description.length).toBeGreaterThan(0);
    }
  });

  test('resolves missing, blank, and unknown ids to the standard preset', () => {
    const fallback = BALANCE_SCENARIO_BY_ID[DEFAULT_BALANCE_SCENARIO_ID];
    expect(resolveBalanceScenario(undefined)).toBe(fallback);
    expect(resolveBalanceScenario(null)).toBe(fallback);
    expect(resolveBalanceScenario('')).toBe(fallback);
    expect(resolveBalanceScenario('   ')).toBe(fallback);
    expect(resolveBalanceScenario('missing_scenario')).toBe(fallback);
    expect(resolveBalanceScenario('toString')).toBe(fallback);
    expect(resolveBalanceScenario(42)).toBe(fallback);
    expect(resolveBalanceScenario(' close_pressure ')).toBe(BALANCE_SCENARIO_BY_ID.close_pressure);
  });
});

describe('balance scenario application', () => {
  test('keeps the standard preset as a strict no-op', () => {
    const state = createInitialState({ seed: 1201 });
    dirtyTransientState(state);
    const before = structuredClone(state);

    expect(applyBalanceScenario(state, 'standard')).toBe(state);
    expect(state).toEqual(before);
    expect(applyBalanceScenario(state, 'unknown')).toBe(state);
    expect(state).toEqual(before);
  });

  test.each(EXPECTED_SCENARIO_IDS.filter((id) => id !== 'standard'))(
    'applies %s deterministically from any transient state',
    (scenarioId) => {
      const dirty = createInitialState({ seed: 2402, rules: { allowDunkWin: false } });
      const clean = createInitialState({ seed: 2402, rules: { allowDunkWin: false } });
      dirtyTransientState(dirty);

      applyBalanceScenario(dirty, scenarioId);
      applyBalanceScenario(clean, scenarioId);

      expect(dirty).toEqual(clean);
    },
  );

  test('preserves match configuration, identities, and character fuel capacities', () => {
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.stats.fuelCapacityMultiplier = 1.25;
    const state = createInitialState({
      seed: 9876,
      loadout: { P1: 'vanguard', P2: 'duelist' },
      rules: { allowDunkWin: false },
      characterBalanceOverrides: { vanguard },
    });
    state.tuning.playerMoveAccel = 177;
    const loadout = state.loadout;
    const rules = state.rules;
    const tuning = state.tuning;
    const overrides = state.characterBalanceOverrides;
    const identities = {
      P1: { id: state.players.P1.id, characterId: state.players.P1.characterId },
      P2: { id: state.players.P2.id, characterId: state.players.P2.characterId },
    };
    const maxFuel = {
      P1: state.players.P1.maxFuel,
      P2: state.players.P2.maxFuel,
    };

    applyBalanceScenario(state, 'zero_fuel_chase');

    expect(state.loadout).toBe(loadout);
    expect(state.rules).toBe(rules);
    expect(state.tuning).toBe(tuning);
    expect(state.characterBalanceOverrides).toBe(overrides);
    expect(state.seed).toBe(9876);
    expect(state.players.P1.id).toBe(identities.P1.id);
    expect(state.players.P1.characterId).toBe(identities.P1.characterId);
    expect(state.players.P2.id).toBe(identities.P2.id);
    expect(state.players.P2.characterId).toBe(identities.P2.characterId);
    expect(state.players.P1.maxFuel).toBe(maxFuel.P1);
    expect(state.players.P2.maxFuel).toBe(maxFuel.P2);
    expect(state.players.P1.maxFuel).not.toBe(state.players.P2.maxFuel);
  });

  test('mutates only the supplied local state', () => {
    const applied = createInitialState({ seed: 3303 });
    const untouched = createInitialState({ seed: 3303 });
    const untouchedBefore = structuredClone(untouched);

    applyBalanceScenario(applied, 'close_pressure');

    expect(untouched).toEqual(untouchedBefore);
    expect(applied).not.toEqual(untouched);
  });
});

describe('balance scenario semantics', () => {
  test('long neutral starts fully resourced, controllable, and far apart', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'long_neutral');

    expect(playerDistance(state)).toBeGreaterThan(80);
    expect(state.players.P1.fuel).toBe(state.players.P1.maxFuel);
    expect(state.players.P2.fuel).toBe(state.players.P2.maxFuel);
    expect(state.players.P1.launchBreaks).toBe(3);
    expect(state.players.P2.launchBreaks).toBe(3);
    expect(state.players.P1.helpless).toBe(0);
    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P1.vel.y).toBeGreaterThan(0);
    expect(state.players.P2.vel.y).toBeLessThan(0);
  });

  test('close pressure starts in range with both fighters moving inward', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'close_pressure');

    expect(playerDistance(state)).toBe(10);
    expect(state.players.P1.vel.x).toBeGreaterThan(0);
    expect(state.players.P2.vel.x).toBeLessThan(0);
    expect(state.players.P1.fuel).toBe(state.players.P1.maxFuel * 0.75);
    expect(state.players.P2.fuel).toBe(state.players.P2.maxFuel * 0.75);
    expect(state.players.P1.endLag).toBe(0);
    expect(state.players.P2.endLag).toBe(0);
  });

  test('post clash starts separated with outward recoil and shared recovery', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'post_clash');

    expect(playerDistance(state)).toBe(24);
    expect(state.players.P1.vel.x).toBeLessThan(0);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
    expect(state.players.P1.endLag).toBeGreaterThan(0);
    expect(state.players.P2.endLag).toBe(state.players.P1.endLag);
    expect(state.players.P1.cool.launch).toBe(state.players.P1.endLag);
    expect(state.players.P2.cool.launch).toBe(state.players.P2.endLag);
    expect(state.players.P1.launchFlash).toBeGreaterThan(0);
    expect(state.players.P2.launchFlash).toBeGreaterThan(0);
  });

  test('launch-break decision gives the launched defender one escape choice', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'launch_break_decision');

    expect(state.players.P2.helpless).toBeGreaterThan(0);
    expect(state.players.P2.lastLaunchedBy).toBe('P1');
    expect(state.players.P2.launchBreaks).toBe(1);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
    expect(state.players.P1.chain).toBe(1);
    expect(state.players.P1.endLag).toBeGreaterThan(0);
  });

  test('control-return pressure isolates a natural recovery inside a committed chase', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'control_return_pressure');

    expect(playerDistance(state)).toBe(8);
    expect(state.players.P2.helpless).toBeGreaterThan(0);
    expect(state.players.P2.helpless).toBeLessThanOrEqual(1 / 60);
    expect(state.players.P2.lastLaunchedBy).toBe('P1');
    expect(state.players.P1.launchStartup).toBeGreaterThan(0);
    expect(state.players.P1.chain).toBe(1);
    expect(state.players.P2.launchBreaks).toBe(1);
  });

  test('control-return pressure resolves naturally and exposes low reset candidates', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    applyBalanceScenario(baseline, 'control_return_pressure');
    applyBalanceScenario(candidate, 'control_return_pressure');
    candidate.tuning.naturalRecoveryResetMultiplier = 0.35;

    step(baseline, neutralInput(), 1 / 60);
    step(candidate, neutralInput(), 1 / 60);

    expect(baseline.players.P2.helpless).toBe(0);
    expect(candidate.players.P2.helpless).toBe(0);
    expect(baseline.players.P2.lastLaunchedBy).toBeNull();
    expect(candidate.players.P2.lastLaunchedBy).toBeNull();
    expect(baseline.players.P2.launchBreaks).toBe(1);
    expect(candidate.players.P2.launchBreaks).toBe(1);
    expect(playerDistance(candidate)).toBeGreaterThan(playerDistance(baseline));
  });

  test('human control-return pressure mirrors the recovery decision onto P1', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'p1_control_return_pressure');

    expect(playerDistance(state)).toBe(8);
    expect(state.players.P1.helpless).toBeGreaterThan(0);
    expect(state.players.P1.helpless).toBeLessThanOrEqual(1 / 60);
    expect(state.players.P1.lastLaunchedBy).toBe('P2');
    expect(state.players.P1.launchBreaks).toBe(1);
    expect(state.players.P2.launchStartup).toBeGreaterThan(0);
    expect(state.players.P2.chain).toBe(1);
  });

  test('human control-return pressure applies candidate recovery reset to P1', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    applyBalanceScenario(baseline, 'p1_control_return_pressure');
    applyBalanceScenario(candidate, 'p1_control_return_pressure');
    candidate.tuning.naturalRecoveryResetMultiplier = 0.35;

    step(baseline, neutralInput(), 1 / 60);
    step(candidate, neutralInput(), 1 / 60);

    expect(baseline.players.P1.helpless).toBe(0);
    expect(candidate.players.P1.helpless).toBe(0);
    expect(baseline.players.P1.lastLaunchedBy).toBeNull();
    expect(candidate.players.P1.lastLaunchedBy).toBeNull();
    expect(playerDistance(candidate)).toBeGreaterThan(playerDistance(baseline));
  });

  test('human recovery candidate creates a deterministic action window against the same chase', () => {
    const baseline = createInitialState();
    const candidate = createInitialState();
    applyBalanceScenario(baseline, 'p1_control_return_pressure');
    applyBalanceScenario(candidate, 'p1_control_return_pressure');
    candidate.tuning.naturalRecoveryResetMultiplier = 0.75;

    for (let frame = 0; frame < 8; frame += 1) {
      const input = neutralInput();
      input.p1.moveX = 1;
      step(baseline, input, 1 / 60);
      step(candidate, input, 1 / 60);
    }

    expect(baseline.players.P1.helpless).toBeGreaterThan(0);
    expect(candidate.players.P1.helpless).toBe(0);
    expect(playerDistance(candidate)).toBeGreaterThan(playerDistance(baseline));
  });

  test('zero-fuel chase creates a live finish opportunity with no defender escape', () => {
    const state = createInitialState();
    applyBalanceScenario(state, 'zero_fuel_chase');

    expect(state.players.P2.fuel).toBe(0);
    expect(state.players.P2.helpless).toBeGreaterThan(0);
    expect(state.players.P2.lastLaunchedBy).toBe('P1');
    expect(state.players.P2.launchBreaks).toBe(0);
    expect(state.players.P1.fuel).toBeGreaterThan(0);
    expect(state.players.P1.vel.x).toBeGreaterThan(0);
    expect(state.players.P2.vel.x).toBeGreaterThan(0);
    expect(state.players.P1.endLag).toBe(0);
  });

  test.each(EXPECTED_SCENARIO_IDS)('%s keeps fuel and launch-break resources valid', (scenarioId) => {
    const state = createInitialState({ loadout: { P1: 'vanguard', P2: 'duelist' } });
    applyBalanceScenario(state, scenarioId);

    for (const player of Object.values(state.players)) {
      expect(Number.isFinite(player.fuel)).toBe(true);
      expect(player.fuel).toBeGreaterThanOrEqual(0);
      expect(player.fuel).toBeLessThanOrEqual(player.maxFuel);
      expect(Number.isInteger(player.launchBreaks)).toBe(true);
      expect(player.launchBreaks).toBeGreaterThanOrEqual(0);
      expect(player.launchBreaks).toBeLessThanOrEqual(3);
    }
  });
});
