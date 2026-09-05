import { describe, expect, test } from 'vitest';
import { RollbackSession } from '../net/rollbackSession';
import { createAiController } from './ai';
import { tickAiControllerWithRole } from './aiControllerRoles';
import { applyBalanceScenario } from './balanceScenarios';
import { createCharacterBalanceConfig, resolveCharacterBalanceConfig } from './characterBalance';
import { computeStateChecksum } from './checksum';
import { CombatEventTelemetryTracker } from './combatEventTelemetry';
import { LocalRoundReplayRecorder } from './localRoundReplayRecorder';
import { decrementSimulationTimer, framesToSeconds } from './moveData';
import { runReplay, validateReplayPayload } from './replay';
import {
  createInitialState, createStateSnapshot, deserialiseState, getRenderSnapshot,
  serialiseState, step,
} from './sim';
import type { GameState, PlayerFrameInput } from './types';

const DT = 1 / 60;
const neutral = (): PlayerFrameInput => ({
  moveX: 0, moveY: 0, boost: false, superBoost: false, special: false,
  launch: false, dunk: false, parry: false, breakLaunch: false,
});
const tick = (state: GameState, p1 = neutral(), p2 = neutral()) => step(state, { p1, p2 }, DT);
function parryState(startupFrames: number) {
  const config = createCharacterBalanceConfig('vanguard');
  config.moves.parry.startupFrames = startupFrames;
  return createInitialState({
    loadout: { P1: 'vanguard', P2: 'vanguard' },
    characterBalanceOverrides: { vanguard: config },
  });
}

describe('frame-authored timers', () => {
  test('status, recovery, cooldown, chain and projectile timers have no seventh tick', () => {
    const state = createInitialState();
    const player = state.players.P1;
    const duration = framesToSeconds(6);
    player.stunned = duration;
    player.helpless = duration;
    player.recovering = duration;
    player.recoveryDuration = duration;
    player.parry = duration;
    player.endLag = duration;
    player.chain = 1;
    player.chainTimer = duration;
    player.cool = { boost: duration, special: duration, launch: duration, dunk: duration };
    state.tuning.helplessReleaseSpeedRatio = 0;
    player.vel.x = 100;
    player.recoveryDir = { x: 1, y: 0 };
    state.projectiles.push({
      id: 1, ownerId: 'P1', pos: { x: 0, y: 40 }, vel: { x: 0, y: 0 },
      life: duration, hitRadius: 0, stunSeconds: 0, fuelDamage: 0, visualId: 'test',
    });
    const remainingTimers = () => [
      player.stunned, player.helpless, player.recovering, player.parry,
      player.endLag, player.chainTimer, ...Object.values(player.cool),
    ];
    for (let frame = 0; frame < 5; frame += 1) tick(state);
    expect(remainingTimers().every(timer => timer > 0)).toBe(true);
    expect(state.projectiles).toHaveLength(1);
    tick(state);
    expect(remainingTimers().every(timer => timer === 0)).toBe(true);
    expect(state.projectiles).toHaveLength(0);
  });

  test.each([1, 2])('exhausts all supported frame durations at exactly their authored ticks (%i substeps)', (substeps) => {
    for (let frames = 1; frames <= 2400; frames += 1) {
      let remaining = framesToSeconds(frames);
      const ticks = frames * substeps;
      for (let index = 1; index < ticks; index += 1) {
        remaining = decrementSimulationTimer(remaining, DT / substeps);
      }
      expect(remaining, `frame count ${frames}`).toBeGreaterThan(0);
      expect(decrementSimulationTimer(remaining, DT / substeps)).toBe(0);
    }
    expect(decrementSimulationTimer(0.025, 0.01)).toBeCloseTo(0.015);
  });

  test.each(['launch', 'dunk', 'special'] as const)('%s startup takes six advancement ticks, excluding acceptance', (action) => {
    const config = createCharacterBalanceConfig('vanguard');
    if (action === 'special') config.moves.special.timing.startupFrames = 6;
    else config.moves[action].startupFrames = 6;
    const state = createInitialState({ characterBalanceOverrides: { vanguard: config } });
    tick(state, { ...neutral(), [action]: true });
    for (let frame = 0; frame < 5; frame += 1) tick(state);
    expect(state.players.P1[`${action}Startup`]).toBeGreaterThan(0);
    tick(state);
    expect(state.players.P1[`${action}Startup`]).toBe(0);
    expect(state.players.P1[`${action}Active`]).toBeGreaterThan(0);
  });
});

describe('parry startup', () => {
  test('a nondefault parry counters on precisely its final startup advancement', () => {
    const state = parryState(6);
    tick(state, neutral(), { ...neutral(), parry: true });
    for (let frame = 0; frame < 5; frame += 1) tick(state);
    expect(state.players.P2.parry).toBe(0);
    state.players.P1.pos = { x: -3, y: 0 };
    state.players.P2.pos = { x: 3, y: 0 };
    state.players.P1.launchActive = 0.1;
    tick(state);
    expect(state.players.P1.stunned).toBeGreaterThan(0);
    expect(state.players.P2.helpless).toBe(0);
    expect(state.players.P2.parryStartup).toBe(0);
  });

  test.each([false, true])('telemetry counts acceptance, not activation (observer %s)', (observe) => {
    const state = parryState(6);
    const tracker = new CombatEventTelemetryTracker();
    tracker.startRound(state);
    for (let frame = 0; frame <= 6; frame += 1) {
      const input = { p1: { ...neutral(), parry: true }, p2: neutral() };
      const starts: import('./sim').SimulationActionStart[] = [];
      step(state, input, DT, { onActionStart: event => starts.push(event) });
      tracker.recordFrame(input, state, DT, observe ? starts : undefined);
    }
    const starts = tracker.toSummary().events.filter(event => event.type === 'action_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ action: 'parry', frame: 1 });
  });

  test.each([0, 60])('startup %i cannot counter before its activation', (startup) => {
    const state = parryState(startup);
    state.players.P1.pos = { x: -3, y: 0 };
    state.players.P2.pos = { x: 3, y: 0 };
    state.players.P1.launchActive = 0.1;
    tick(state, neutral(), { ...neutral(), parry: true });
    expect(state.players.P1.stunned > 0).toBe(startup === 0);
    expect(state.players.P2.helpless > 0).toBe(startup > 0);
    expect(state.players.P2.parryStartup).toBe(0);
  });

  test('wind-up blocks competing actions, activates once and leaves authored recovery', () => {
    const state = parryState(6);
    const accepted: string[] = [];
    const input = { ...neutral(), parry: true, launch: true, dunk: true, special: true, superBoost: true, moveX: 1 };
    for (let frame = 0; frame <= 6; frame += 1) {
      step(state, { p1: input, p2: neutral() }, DT, {
        onActionStart: event => accepted.push(event.action),
      });
      if (frame < 6) {
        expect(state.players.P1.parry).toBe(0);
        expect(getRenderSnapshot(state).players.P1.presentationPhase).toBe('startup');
      }
    }
    expect(accepted).toEqual(['parry']);
    expect(state.players.P1.parryStartup).toBe(0);
    expect(state.players.P1.parry).toBeGreaterThan(0);
    const move = resolveCharacterBalanceConfig('vanguard', state.characterBalanceOverrides).moves.parry;
    expect(state.players.P1.parry).toBeCloseTo(framesToSeconds(move.activeFrames) - DT);
    expect(state.players.P1.endLag).toBeCloseTo(framesToSeconds(move.recoveryFrames) - DT);
  });

  test.each(['stunned', 'helpless', 'recovering'] as const)('cancels wind-up when %s', (status) => {
    const state = parryState(6);
    tick(state, { ...neutral(), parry: true });
    state.players.P1[status] = 0.1;
    tick(state);
    for (let frame = 0; frame < 15; frame += 1) tick(state);
    expect(state.players.P1.parryStartup).toBe(0);
    expect(state.players.P1.parry).toBe(0);
  });

  test('snapshots, legacy migration, scenario resets and rollback preserve pending startup', () => {
    const initial = parryState(6);
    tick(initial, { ...neutral(), parry: true });
    const resumed = deserialiseState(serialiseState(initial));
    expect(resumed).toEqual(initial);
    const cleared = createStateSnapshot(initial);
    cleared.players.P1.parryStartup = 0;
    expect(computeStateChecksum(cleared)).not.toBe(computeStateChecksum(initial));
    const legacy = JSON.parse(serialiseState(initial));
    legacy.version = 5;
    delete legacy.state.players.P1.parryStartup;
    delete legacy.state.players.P2.parryStartup;
    expect(deserialiseState(JSON.stringify(legacy)).players.P1.parryStartup).toBe(0);
    applyBalanceScenario(cleared, 'close_pressure');
    expect(cleared.players.P1.parryStartup).toBe(0);
    const session = new RollbackSession({ initialState: initial, localPlayerId: 'P1', fixedDt: DT });
    session.advanceFrame({ localInput: neutral(), remoteAuthoritativeInput: neutral() });
    session.advanceFrame({ localInput: neutral() });
    session.advanceFrame({ localInput: neutral() });
    const corrected = { ...neutral(), moveY: 1 };
    expect(session.setRemoteAuthoritativeInput(1, corrected)).toBe(2);
    tick(resumed);
    tick(resumed, neutral(), corrected);
    tick(resumed, neutral(), corrected);
    expect(session.getStateSnapshot()).toEqual(resumed);
  });
});

describe('escape dummy mechanics', () => {
  test.each([0.1, 1])('close escape increases separation and spends fuel (%s)', (fuelFraction) => {
    const state = createInitialState();
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 12, y: 0 };
    state.players.P2.fuel = state.players.P2.maxFuel * fuelFraction;
    const fuel = state.players.P2.fuel;
    const result = tickAiControllerWithRole(state, 'P2', createAiController(42), 'evasive');
    tick(state, neutral(), result.input);
    expect(result.input.boost).toBe(false);
    expect(result.input.superBoost).toBe(fuelFraction >= 0.2);
    expect(state.players.P2.pos.x - state.players.P1.pos.x).toBeGreaterThan(12);
    expect(state.players.P2.fuel).toBeLessThan(fuel);
  });

  test.each([0.1, 1])('retreats at medium range without pursuing, fuel fraction %s', (fuelFraction) => {
    const state = createInitialState();
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 24, y: 0 };
    state.players.P2.fuel = state.players.P2.maxFuel * fuelFraction;
    const beforeFuel = state.players.P2.fuel;
    const result = tickAiControllerWithRole(state, 'P2', createAiController(42), 'evasive');
    tick(state, neutral(), result.input);
    expect(result.input.boost).toBe(false);
    expect(state.players.P2.pos.x).toBeGreaterThan(24);
    expect(state.players.P2.fuel).toBeLessThan(beforeFuel);
    expect(result.decision.selectedReason).toBe('scripted_escape_retreat');
  });

  test('steers inward at the boundary without boosting outward toward the pursuer', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: 70, y: 0 };
    state.players.P2.pos = { x: 55, y: 0 };
    state.players.P2.fuel = 10;
    const result = tickAiControllerWithRole(state, 'P2', createAiController(42), 'evasive');
    tick(state, neutral(), result.input);
    expect(state.players.P2.pos.x).toBeLessThan(55);
    expect(result.input.boost).toBe(false);
  });
});

describe('super-boost settlement', () => {
  test.each(['release', 'launch', 'parry_counter', 'projectile', 'round_end', 'launch_break'] as const)(
    '%s charges travel, turns and commitment exactly once', (interrupt) => {
      const state = createInitialState({ loadout: { P1: 'vanguard', P2: 'vanguard' } });
      const target = state.players.P2;
      state.players.P1.pos = { x: -3, y: 0 };
      target.pos = { x: 3, y: 0 };
      target.superBoost = 1;
      target.superDistance = 40;
      target.superTurnPenalty = 2;
      target.superDir = { x: 1, y: 0 };
      target.didCommitAttackDuringSuperBoost = interrupt === 'parry_counter';
      state.tuning.superBoostMinDistance = 0;
      const beforeFuel = target.fuel;
      const input = { ...neutral(), superBoost: interrupt !== 'release' };
      if (interrupt === 'launch') state.players.P1.launchActive = 0.1;
      if (interrupt === 'parry_counter') {
        target.launchActive = 0.1;
        state.players.P1.parry = 0.1;
      }
      if (interrupt === 'projectile') {
        state.projectiles.push({
          id: 1, ownerId: 'P1', pos: { x: 3, y: 0 }, vel: { x: 0, y: 0 },
          life: 1, hitRadius: 20, stunSeconds: 0.2, fuelDamage: 0, visualId: 'test',
        });
      }
      if (interrupt === 'round_end') state.winner = 'P1';
      if (interrupt === 'launch_break') {
        target.helpless = 1;
        target.lastLaunchedBy = 'P1';
        input.breakLaunch = true;
      }
      tick(state, neutral(), input);
      const config = resolveCharacterBalanceConfig(target.characterId, state.characterBalanceOverrides);
      const move = config.moves.superBoost;
      const debt = (target.superDistance * move.travelFuelPerDistance + target.superTurnPenalty
        + (target.didCommitAttackDuringSuperBoost ? 0 : move.nonCommitPenalty))
        * state.tuning.superBoostFuelMultiplier * config.stats.superFuelMultiplier;
      expect(target.superBoost).toBe(0);
      expect(target.fuel).toBeCloseTo(beforeFuel - debt);
      const settledFuel = target.fuel;
      tick(state);
      expect(target.fuel).toBe(settledFuel);
    },
  );

  test('late well-capture victory settles the other fighter in the same tick', () => {
    const state = createInitialState();
    state.tuning.wellCoreRadius = 10;
    state.tuning.helplessReleaseSpeedRatio = 0;
    state.players.P2.pos = { x: 0, y: 0 };
    state.players.P2.vel = { x: 1, y: 0 };
    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    state.players.P2.fuel = 0;
    const player = state.players.P1;
    player.superBoost = 1;
    player.superDistance = 40;
    player.superDir = { x: 1, y: 0 };
    const fuel = player.fuel;
    tick(state, { ...neutral(), superBoost: true });
    expect(state.winner).toBe('P1');
    expect(player.superBoost).toBe(0);
    const config = resolveCharacterBalanceConfig(player.characterId, state.characterBalanceOverrides);
    const debt = (player.superDistance * config.moves.superBoost.travelFuelPerDistance
      + config.moves.superBoost.nonCommitPenalty)
      * state.tuning.superBoostFuelMultiplier * config.stats.superFuelMultiplier;
    expect(player.fuel).toBeCloseTo(fuel - debt);
    tick(state);
    expect(player.fuel).toBeCloseTo(fuel - debt);
  });

  test('dunk evaluates zero fuel after settling the interrupted dash', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -3, y: 0 };
    state.players.P1.dunkActive = 0.1;
    state.players.P2.pos = { x: 3, y: 0 };
    state.players.P2.fuel = 1;
    state.players.P2.superBoost = 1;
    state.players.P2.superDistance = 100;
    tick(state);
    expect(state.players.P2.fuel).toBe(0);
    expect(state.players.P2.superBoost).toBe(0);
    expect(state.winner).toBe('P1');
  });

  test('normal-input dunk interruption charges accrued debt exactly once', () => {
    const state = createInitialState({ loadout: { P1: 'vanguard', P2: 'vanguard' } });
    let connected = false;
    for (let frame = 0; frame < 100; frame += 1) {
      const before = createStateSnapshot(state).players.P2;
      tick(state, { ...neutral(), dunk: frame === 15 }, { ...neutral(), superBoost: true, moveX: -1, moveY: 0.2 });
      const target = state.players.P2;
      if (target.recovering <= 0) continue;
      const config = resolveCharacterBalanceConfig(target.characterId, state.characterBalanceOverrides);
      const scale = state.tuning.superBoostFuelMultiplier * config.stats.superFuelMultiplier;
      const debt = (before.superDistance * config.moves.superBoost.travelFuelPerDistance
        + before.superTurnPenalty + config.moves.superBoost.nonCommitPenalty) * scale;
      const recoveryCost = target.maxFuel * state.tuning.dunkRecoveryFuelFraction * config.stats.dunkRecoveryFuelMultiplier;
      expect(before.helpless).toBe(0);
      expect(before.superBoost).toBe(1);
      expect(before.superDistance).toBeGreaterThan(40);
      expect(target.fuel).toBeCloseTo(before.fuel - debt - recoveryCost);
      expect(target.superBoost).toBe(0);
      const fuelAfter = target.fuel;
      tick(state);
      expect(target.fuel).toBe(fuelAfter);
      connected = true;
      break;
    }
    expect(connected).toBe(true);
  });
});

describe('combat replay determinism', () => {
  test('late remote correction rolls back across a dunk and settles dash debt identically', () => {
    const initial = parryState(6);
    const session = new RollbackSession({ initialState: initial, localPlayerId: 'P1', fixedDt: DT });
    const direct = createStateSnapshot(initial);
    const predicted = { ...neutral(), superBoost: true, moveX: -1, moveY: 0.2 };
    const corrected = { ...predicted, moveY: 0.25 };
    let sawDunk = false;
    for (let frame = 0; frame < 80; frame += 1) {
      const local = { ...neutral(), dunk: frame === 15 };
      session.advanceFrame({ localInput: local, remoteAuthoritativeInput: frame === 0 ? predicted : undefined });
      tick(direct, local, frame < 10 ? predicted : corrected);
      sawDunk ||= direct.players.P2.recovering > 0;
    }
    expect(sawDunk).toBe(true);
    expect(session.setRemoteAuthoritativeInput(10, corrected)).toBe(70);
    expect(session.getStateSnapshot()).toEqual(direct);
    expect(computeStateChecksum(session.getStateSnapshot())).toBe(computeStateChecksum(direct));
  });

  test.each([0, 6, 60])('recorded startup %i and interrupted boost reproduce every checksum', (startup) => {
    const state = parryState(startup);
    const recorder = new LocalRoundReplayRecorder({
      rulesetVersion: 'prototype-2026.09', simBuildHash: 'combat-regression', roundNumber: 1,
      sourceLabel: 'Combat timing and interrupted super-boost regression',
      seed: state.seed, loadout: state.loadout, fixedDt: DT, rules: state.rules,
      tuning: state.tuning, characterBalanceOverrides: state.characterBalanceOverrides,
    });
    let sawStartup = false;
    let sawDunkRecovery = false;
    for (let frame = 0; frame < 220; frame += 1) {
      const input = {
        p1: { ...neutral(), dunk: frame === 15, parry: frame === 110 },
        p2: frame < 100 ? { ...neutral(), superBoost: true, moveX: -1, moveY: 0.2 } : neutral(),
      };
      step(state, input, DT);
      recorder.recordFrame(input, state);
      sawStartup ||= state.players.P1.parryStartup > 0;
      sawDunkRecovery ||= state.players.P2.recovering > 0;
    }
    expect(sawStartup).toBe(startup > 0);
    expect(sawDunkRecovery).toBe(true);
    const payload = recorder.buildPayload()!;
    expect(validateReplayPayload(payload).ok).toBe(true);
    expect(runReplay(payload).checksums).toEqual(payload.expectedChecksums);
  });
});

describe('snapshot presentation', () => {
  test('ordinary end-lag is distinct from dunk recovery', () => {
    const state = createInitialState();
    state.players.P1.endLag = 0.2;
    expect(getRenderSnapshot(state).players.P1.presentationAction).toBe('attack_recovery');
    state.players.P1.recovering = 0.5;
    state.players.P1.recoveryDuration = 1;
    expect(getRenderSnapshot(state).players.P1).toMatchObject({
      presentationAction: 'recover', presentationElapsedSeconds: 0.5,
    });
  });

  test('phase elapsed rewinds with snapshots instead of render history', () => {
    const state = parryState(6);
    tick(state, { ...neutral(), parry: true });
    const earlier = createStateSnapshot(state);
    tick(state);
    tick(state);
    expect(getRenderSnapshot(state).players.P1.presentationElapsedSeconds).toBeCloseTo(2 * DT);
    expect(getRenderSnapshot(earlier).players.P1.presentationElapsedSeconds).toBe(0);
  });
});
