import { describe, expect, test } from 'vitest';
import {
  createInitialState,
  step,
  type SimulationActionStart,
  type SimulationLaunchClash,
} from './sim';
import {
  MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION,
  MATCH_TELEMETRY_SCHEMA_VERSION,
  aggregateMatchTelemetrySummaries,
  createMatchTelemetryTracker,
} from './matchTelemetry';
import { createCharacterBalanceConfig } from './characterBalance';
import { COMBAT_EVENT_SCHEMA_VERSION } from './combatEventTelemetry';
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

function recordContactEpisode(
  tracker: ReturnType<typeof createMatchTelemetryTracker>,
  state: ReturnType<typeof createInitialState>,
  frames: number,
  closeEpisode = true,
): void {
  state.players.P1.pos = { x: -2.5, y: 0 };
  state.players.P2.pos = { x: 2.5, y: 0 };
  for (let frame = 0; frame < frames; frame += 1) {
    tracker.recordFrame(neutralInput(), state, 0.1);
  }
  if (closeEpisode) {
    state.players.P1.pos = { x: -3, y: 0 };
    state.players.P2.pos = { x: 3, y: 0 };
    tracker.recordFrame(neutralInput(), state, 0.1);
  }
}

describe('match telemetry tracker', () => {
  test('records attributed launch clashes without relying on flash inference', () => {
    const state = createInitialState();
    const tracker = createMatchTelemetryTracker(state);
    const clash: SimulationLaunchClash = {
      cause: 'post_control_counter_launch',
      gracePlayerId: 'P1',
    };

    tracker.recordFrame(neutralInput(), state, 1 / 60, [], [clash]);

    const summary = tracker.toSummary();
    expect(summary.combat.schemaVersion).toBe(COMBAT_EVENT_SCHEMA_VERSION);
    expect(summary.combat.launchClashCauses).toEqual({
      simultaneous_active: 0,
      global_startup_grace: 0,
      post_control_counter_launch: 1,
      unattributed: 0,
    });
    expect(summary.combat.events.find((event) => event.type === 'launch_clash')).toMatchObject({
      launchClashCause: 'post_control_counter_launch',
      launchClashAttribution: 'simulation',
      launchClashGracePlayerId: 'P1',
    });
    expect(summary.combat.events.find((event) => event.type === 'launch_clash'))
      .not.toHaveProperty('actorId');
  });

  test('records an accepted action that is consumed later in the same frame', () => {
    const state = createInitialState({ seed: 10 });
    state.players.P1.pos = { x: -3, y: 0 };
    state.players.P2.pos = { x: 3, y: 0 };
    state.players.P2.launchActive = 0.1;
    const tracker = createMatchTelemetryTracker(state);
    const input = neutralInput();
    input.p1.moveX = 1;
    input.p1.parry = true;
    const acceptedActionStarts: SimulationActionStart[] = [];

    step(state, input, 1 / 60, {
      onActionStart: (event) => acceptedActionStarts.push(event),
    });
    expect(state.players.P1.parry).toBe(0);
    tracker.recordFrame(input, state, 1 / 60, acceptedActionStarts);

    const summary = tracker.toSummary();
    expect(summary.players.P1.parryPresses).toBe(1);
    expect(summary.players.P1.parryStarts).toBe(1);
    expect(summary.combat.events).toContainEqual(expect.objectContaining({
      type: 'action_start',
      actorId: 'P1',
      action: 'parry',
      movementIntent: 'approach',
    }));
  });

  test('tracks both player inputs and combat outcomes for live analysis', () => {
    const state = createInitialState({ seed: 11 });
    const tracker = createMatchTelemetryTracker(state);
    state.players.P1.pos = { x: -4, y: 0 };
    state.players.P2.pos = { x: 4, y: 0 };

    const firstFrame = neutralInput();
    firstFrame.p1.launch = true;
    firstFrame.p2.parry = true;
    state.players.P1.launchStartup = 0.1;
    state.players.P1.launchActive = 0;
    state.players.P2.launchActive = 0;
    state.players.P2.parry = 0.1;
    state.players.P1.launchFlash = 0.18;
    state.players.P2.launchFlash = 0.18;
    tracker.recordFrame(firstFrame, state, 1 / 60);

    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    state.players.P1.chain = 1;
    state.players.P1.launchStartup = 0;
    state.players.P1.specialStartup = 0.1;
    state.players.P1.launchActive = 0;
    state.players.P2.launchActive = 0;
    state.players.P1.launchFlash = 0;
    state.players.P2.launchFlash = 0;
    const secondFrame = neutralInput();
    secondFrame.p1.special = true;
    secondFrame.p2.breakLaunch = true;
    tracker.recordFrame(secondFrame, state, 1 / 60);

    state.players.P1.specialStartup = 0;
    state.players.P1.specialDidResolve = true;
    state.players.P1.dunkStartup = 0.1;
    state.players.P2.helpless = 0;
    state.players.P2.launchBreaks = 2;
    state.players.P2.boostActive = true;
    state.nextProjectileId = 2;
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
    expect(summary.schemaVersion).toBe(MATCH_TELEMETRY_SCHEMA_VERSION);
    expect(summary.characterRegistryFingerprint).toMatch(/^gw\.character-registry\.v1:[0-9a-f]{8}$/);
    expect(summary.characters.P1).toEqual({ characterId: 'vanguard', packageVersion: '0.3.3' });
    expect(summary.characters.P2).toEqual({ characterId: 'duelist', packageVersion: '0.3.2' });
    expect(summary.players.P1.launchPresses).toBe(1);
    expect(summary.players.P1.specialPresses).toBe(1);
    expect(summary.players.P1.dunkPresses).toBe(1);
    expect(summary.players.P1.launchStarts).toBe(1);
    expect(summary.players.P1.specialStarts).toBe(1);
    expect(summary.players.P1.dunkStarts).toBe(1);
    expect(summary.players.P1.launchHits).toBe(1);
    expect(summary.players.P1.specialResolves).toBe(1);
    expect(summary.players.P1.projectilesSpawned).toBe(1);
    expect(summary.players.P1.dunkHits).toBe(1);
    expect(summary.players.P1.clashCount).toBe(1);
    expect(summary.players.P1.launchConversionRate).toBe(1);
    expect(summary.players.P1.dunkConversionRate).toBe(1);
    expect(summary.players.P2.parryPresses).toBe(1);
    expect(summary.players.P2.breakPresses).toBe(1);
    expect(summary.players.P2.breakEscapes).toBe(1);
    expect(summary.players.P2.averageBreakReactionSeconds).toBeGreaterThan(0);
    expect(summary.players.P2.boostFrames).toBe(1);
    expect(summary.players.P2.boostStarts).toBe(1);
    expect(summary.spacing.averageDistance).toBeGreaterThan(0);
    expect(summary.spacing.closestDistance).toBeLessThanOrEqual(summary.spacing.farthestDistance);
    expect(summary.spacing.contactFrames).toBe(0);
    expect(summary.spacing.pointBlankFrames).toBeGreaterThan(0);
    expect(summary.spacing.pressureBandFrames).toBe(summary.framesSimulated);
    expect(summary.combat.events[0]).toMatchObject({
      frame: 0,
      timeSeconds: 0,
      type: 'distance_band_change',
    });
    expect(summary.combat.eventCounts.action_press).toBe(6);
    expect(summary.combat.eventCounts.action_start).toBe(6);
    expect(summary.combat.eventCounts.launch_clash).toBe(1);
    expect(summary.combat.eventCounts.launch_hit).toBe(1);
    expect(summary.combat.eventCounts.control_return).toBe(1);
    expect(summary.combat.eventCounts.special_resolve).toBe(1);
    expect(summary.combat.eventCounts.projectile_spawn).toBe(1);
    expect(summary.combat.eventCounts.dunk_hit).toBe(1);
    expect(summary.combat.events.find((event) => event.type === 'control_return')).toMatchObject({
      schemaVersion: COMBAT_EVENT_SCHEMA_VERSION,
      actorId: 'P2',
      action: 'launch_break',
      outcome: 'recovery',
    });
    expect(summary.combat.events.map((event) => event.sequence)).toEqual(
      summary.combat.events.map((_, index) => index),
    );
    expect(summary.combat.events.find((event) => event.type === 'special_resolve')).toMatchObject({
      actorId: 'P1',
      actorCharacterId: 'vanguard',
      behaviorId: 'special.block_guard.v1',
    });
    expect(summary.combat.events.find((event) => (
      event.type === 'action_start' && event.actorId === 'P1' && event.action === 'special'
    ))).toMatchObject({
      moveId: 'guard_bastion',
      behaviorId: 'special.block_guard.v1',
    });
    expect(summary.combat.events.find((event) => (
      event.type === 'action_start' && event.action === 'dunk'
    ))).toMatchObject({
      distance: expect.any(Number),
      actorSpeed: expect.any(Number),
      targetSpeed: expect.any(Number),
      separationSpeed: expect.any(Number),
      actorFuelPercent: expect.any(Number),
      targetFuelPercent: expect.any(Number),
    });
  });

  test('separates physical contact from the broader point-blank band', () => {
    const state = createInitialState({ seed: 12 });
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    const tracker = createMatchTelemetryTracker(state);

    tracker.recordFrame(neutralInput(), state, 1 / 60);
    state.players.P1.pos = { x: -3, y: 0 };
    state.players.P2.pos = { x: 3, y: 0 };
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    const summary = tracker.toSummary();
    expect(summary.spacing.contactFrames).toBe(1);
    expect(summary.spacing.contactSeconds).toBeCloseTo(1 / 60, 2);
    expect(summary.spacing.contactEpisodeCount).toBe(1);
    expect(summary.spacing.contactEpisodeDurationsSeconds).toEqual([0.017]);
    expect(summary.spacing.maximumContactEpisodeSeconds).toBe(0.017);
    expect(summary.spacing.p90ContactEpisodeSeconds).toBe(0.017);
    expect(summary.spacing.pointBlankFrames).toBe(2);
  });

  test('counts distinct contact episodes and reports their duration distribution', () => {
    const state = createInitialState({ seed: 14 });
    const tracker = createMatchTelemetryTracker(state);

    for (let episodeFrames = 1; episodeFrames <= 10; episodeFrames += 1) {
      recordContactEpisode(tracker, state, episodeFrames, episodeFrames < 10);
    }

    const summary = tracker.toSummary();
    expect(summary.spacing.contactFrames).toBe(55);
    expect(summary.spacing.contactSeconds).toBe(5.5);
    expect(summary.spacing.contactEpisodeCount).toBe(10);
    expect(summary.spacing.contactEpisodeDurationsSeconds).toEqual([
      0.1,
      0.2,
      0.3,
      0.4,
      0.5,
      0.6,
      0.7,
      0.8,
      0.9,
      1,
    ]);
    expect(summary.spacing.averageContactEpisodeSeconds).toBe(0.55);
    expect(summary.spacing.maximumContactEpisodeSeconds).toBe(1);
    expect(summary.spacing.p90ContactEpisodeSeconds).toBe(0.9);
  });

  test('separates shared action-ready decisions from helpless travel and recovery lockout', () => {
    const state = createInitialState({ seed: 15 });
    state.players.P1.pos = { x: -20, y: 0 };
    state.players.P2.pos = { x: 20, y: 0 };
    const tracker = createMatchTelemetryTracker(state);

    tracker.recordFrame(neutralInput(), state, 0.5);

    state.players.P1.endLag = 0.2;
    tracker.recordFrame(neutralInput(), state, 0.25);

    state.players.P1.endLag = 0;
    state.players.P1.pos = { x: -4, y: 0 };
    state.players.P2.pos = { x: 4, y: 0 };
    tracker.recordFrame(neutralInput(), state, 0.25);

    state.players.P1.pos = { x: -20, y: 0 };
    state.players.P2.pos = { x: 20, y: 0 };
    tracker.recordFrame(neutralInput(), state, 0.8);

    const shared = tracker.toSummary().sharedAgency;
    expect(shared).toMatchObject({
      controlFrames: 4,
      controlSeconds: 1.8,
      actionReadyFrames: 3,
      actionReadySeconds: 1.55,
      pressureFrames: 1,
      pressureSeconds: 0.25,
      neutralFrames: 2,
      neutralSeconds: 1.3,
      neutralEpisodeCount: 2,
      neutralEpisodeDurationsSeconds: [0.5, 0.8],
      averageNeutralEpisodeSeconds: 0.65,
      maximumNeutralEpisodeSeconds: 0.8,
      p90NeutralEpisodeSeconds: 0.8,
      sustainedNeutralWindowCount: 1,
      sustainedNeutralWindowSeconds: 0.8,
    });
  });

  test('counts contact lock only while both fighters can start a new commitment', () => {
    const state = createInitialState({ seed: 16 });
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    const tracker = createMatchTelemetryTracker(state);

    tracker.recordFrame(neutralInput(), state, 0.2);
    state.players.P2.helpless = 1;
    tracker.recordFrame(neutralInput(), state, 0.3);
    state.players.P2.helpless = 0;
    tracker.recordFrame(neutralInput(), state, 0.4);

    const summary = tracker.toSummary();
    expect(summary.spacing.contactFrames).toBe(3);
    expect(summary.sharedAgency).toMatchObject({
      controlFrames: 2,
      actionReadyFrames: 2,
      contactFrames: 2,
      contactSeconds: 0.6,
      contactEpisodeCount: 2,
      contactEpisodeDurationsSeconds: [0.2, 0.4],
      averageContactEpisodeSeconds: 0.3,
      maximumContactEpisodeSeconds: 0.4,
      p90ContactEpisodeSeconds: 0.4,
    });
  });

  test('classifies approach, orbit, disengage, and idle intent while a fighter has control', () => {
    const state = createInitialState({ seed: 13 });
    state.players.P1.pos = { x: -2.5, y: 0 };
    state.players.P2.pos = { x: 2.5, y: 0 };
    const tracker = createMatchTelemetryTracker(state);

    const approachAndRetreat = neutralInput();
    approachAndRetreat.p1.moveX = 1;
    approachAndRetreat.p2.moveX = 1;
    tracker.recordFrame(approachAndRetreat, state, 1 / 60);

    const orbitAndIdle = neutralInput();
    orbitAndIdle.p1.moveY = 1;
    tracker.recordFrame(orbitAndIdle, state, 1 / 60);

    const retreatAndApproach = neutralInput();
    retreatAndApproach.p1.moveX = -1;
    retreatAndApproach.p2.moveX = -1;
    tracker.recordFrame(retreatAndApproach, state, 1 / 60);

    state.players.P1.helpless = 1;
    tracker.recordFrame(approachAndRetreat, state, 1 / 60);

    const summary = tracker.toSummary();
    expect(summary.players.P1.movementIntent).toMatchObject({
      controllableFrames: 3,
      approachFrames: 1,
      retreatFrames: 1,
      orbitFrames: 1,
      idleFrames: 0,
      contactFrames: 3,
      contactApproachFrames: 1,
      contactRetreatFrames: 1,
      contactOrbitFrames: 1,
      contactIdleFrames: 0,
      contestedContactFrames: 3,
      contestedContactApproachFrames: 1,
      contestedContactRetreatFrames: 1,
      contestedContactOrbitFrames: 1,
      contestedContactIdleFrames: 0,
      pressureFrames: 3,
      pointBlankFrames: 3,
      pointBlankApproachFrames: 1,
      pointBlankRetreatFrames: 1,
      contestedPointBlankFrames: 3,
      contestedPointBlankApproachFrames: 1,
      contestedPointBlankRetreatFrames: 1,
    });
    expect(summary.players.P2.movementIntent).toMatchObject({
      controllableFrames: 4,
      approachFrames: 1,
      retreatFrames: 2,
      orbitFrames: 0,
      idleFrames: 1,
      contactFrames: 4,
      contactApproachFrames: 1,
      contactRetreatFrames: 2,
      contactOrbitFrames: 0,
      contactIdleFrames: 1,
      contestedContactFrames: 3,
      contestedContactApproachFrames: 1,
      contestedContactRetreatFrames: 1,
      contestedContactOrbitFrames: 0,
      contestedContactIdleFrames: 1,
      pressureFrames: 4,
      pointBlankFrames: 4,
      contestedPointBlankFrames: 3,
    });
  });

  test('captures causal movement and velocity context on distance transitions', () => {
    const state = createInitialState({ loadout: { P1: 'vanguard', P2: 'duelist' } });
    state.players.P1.pos = { x: -13, y: 0 };
    state.players.P2.pos = { x: 13, y: 0 };
    const tracker = createMatchTelemetryTracker(state);

    state.players.P1.pos = { x: -11.5, y: 0 };
    state.players.P2.pos = { x: 11.5, y: 0 };
    state.players.P1.vel = { x: 5, y: 0 };
    state.players.P2.vel = { x: -5, y: 0 };
    state.players.P1.boostActive = true;
    state.players.P1.endLag = 0.2;
    const input = neutralInput();
    input.p1.moveX = 1;
    input.p1.boost = true;
    input.p2.moveX = -1;
    tracker.recordFrame(input, state, 1 / 60);

    const transition = tracker.toSummary().combat.events.find((event) => (
      event.type === 'distance_band_change' && event.distanceBand === 'pressure'
    ));
    expect(transition).toMatchObject({
      schemaVersion: COMBAT_EVENT_SCHEMA_VERSION,
      distanceTransition: {
        fromBand: 'mid',
        separationSpeed: -10,
        players: {
          P1: {
            movementIntent: 'approach',
            moveMagnitude: 1,
            boostHeld: true,
            boostActive: true,
            actionRecoveryActive: true,
          },
          P2: {
            movementIntent: 'approach',
            moveMagnitude: 1,
            boostHeld: false,
            boostActive: false,
            actionRecoveryActive: false,
          },
        },
      },
    });
  });

  test('records deterministic break, fuel, spacing, and round-end events', () => {
    const runScenario = () => {
      const state = createInitialState({ seed: 22 });
      state.players.P2.helpless = 1;
      state.players.P2.launchBreaks = 3;
      state.players.P2.fuel = 1;
      const tracker = createMatchTelemetryTracker(state);

      state.players.P2.helpless = 0;
      state.players.P2.launchBreaks = 2;
      state.players.P2.fuel = 0;
      state.players.P2.pos = { x: 80, y: 0 };
      const breakFrame = neutralInput();
      breakFrame.p2.breakLaunch = true;
      tracker.recordFrame(breakFrame, state, 1 / 30);

      state.winner = 'P1';
      tracker.recordFrame(neutralInput(), state, 1 / 30);
      return tracker.toSummary();
    };

    const first = runScenario();
    const second = runScenario();
    expect(first.combat.events).toEqual(second.combat.events);
    expect(first.combat.eventCounts.launch_break).toBe(1);
    expect(first.combat.eventCounts.control_return).toBe(1);
    expect(first.combat.eventCounts.fuel_depleted).toBe(1);
    expect(first.combat.eventCounts.round_end).toBe(1);
    expect(first.combat.resources.P2.fuelLost).toBe(1);
    expect(first.combat.resources.P2.fuelRestored).toBe(0);
    expect(first.combat.spacingBands.frames.long).toBe(2);
    expect(first.combat.spacingBands.seconds.long).toBeCloseTo(0.07, 2);
  });

  test('distinguishes natural and launch-break control returns', () => {
    const state = createInitialState({ seed: 25 });
    state.players.P2.helpless = 1;
    state.players.P2.launchBreaks = 3;
    const tracker = createMatchTelemetryTracker(state);

    state.players.P2.helpless = 0;
    tracker.recordFrame(neutralInput(), state, 0.5);

    state.players.P1.chain = 1;
    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    tracker.recordFrame(neutralInput(), state, 0.5);

    state.players.P2.helpless = 0;
    state.players.P2.launchBreaks = 2;
    state.players.P2.stunned = 0.25;
    const breakInput = neutralInput();
    breakInput.p2.breakLaunch = true;
    tracker.recordFrame(breakInput, state, 0.25);

    state.players.P2.stunned = 0;
    tracker.recordFrame(neutralInput(), state, 0.25);

    const summary = tracker.toSummary();
    const returns = summary.combat.events.filter((event) => event.type === 'control_return');
    expect(returns).toHaveLength(2);
    expect(returns[0]).toMatchObject({ actorId: 'P2', outcome: 'recovery' });
    expect(returns[0]?.action).toBeUndefined();
    expect(returns[1]).toMatchObject({ actorId: 'P2', action: 'launch_break' });
    expect(summary.combat.eventCounts.control_return).toBe(2);
    expect(summary.combat.eventCounts.launch_hit).toBe(1);
    expect(summary.combat.eventCounts.launch_break).toBe(1);
  });

  test('classifies a control return from its pre-reset distance', () => {
    const state = createInitialState({ seed: 27 });
    state.players.P1.pos = { x: -4, y: 0 };
    state.players.P2.pos = { x: 4, y: 0 };
    state.players.P1.vel = { x: 0, y: 0 };
    state.players.P2.vel = { x: 0, y: 0 };
    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    state.tuning.naturalRecoveryResetMultiplier = 1;
    const tracker = createMatchTelemetryTracker(state);

    step(state, neutralInput(), 1 / 60);
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    const controlReturn = tracker.toSummary().combat.events.find((event) => (
      event.type === 'control_return'
    ));
    expect(controlReturn).toMatchObject({
      actorId: 'P2',
      distance: 26,
      controlReturnStartDistance: 8,
    });
  });

  test('does not treat forced dunk recovery as returned control', () => {
    const state = createInitialState({ seed: 26 });
    state.players.P2.helpless = 1;
    const tracker = createMatchTelemetryTracker(state);

    state.players.P2.helpless = 0;
    state.players.P2.recovering = 1;
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    expect(tracker.toSummary().combat.eventCounts.control_return).toBe(0);
  });

  test('detects real dunk and one-frame projectile outcomes after simulation step', () => {
    const dunkState = createInitialState({ seed: 23 });
    dunkState.players.P1.pos = { x: 0, y: 0 };
    dunkState.players.P2.pos = { x: 5, y: 0 };
    const dunkTracker = createMatchTelemetryTracker(dunkState);
    for (let frame = 0; frame < 45; frame += 1) {
      const input = neutralInput();
      input.p1.dunk = frame === 0;
      step(dunkState, input, 1 / 60);
      dunkTracker.recordFrame(input, dunkState, 1 / 60);
    }
    const dunkSummary = dunkTracker.toSummary();
    expect(dunkSummary.players.P1.dunkHits).toBe(1);
    expect(dunkSummary.combat.events.find((event) => event.type === 'dunk_hit')).toMatchObject({
      actorId: 'P1',
      targetId: 'P2',
      outcome: 'recovery',
    });

    const projectileState = createInitialState({
      seed: 24,
      loadout: { P1: 'ace', P2: 'duelist' },
    });
    projectileState.players.P1.pos = { x: 0, y: 0 };
    projectileState.players.P2.pos = { x: 36, y: 0 };
    const projectileTracker = createMatchTelemetryTracker(projectileState);
    const specialInput = neutralInput();
    specialInput.p1.special = true;
    step(projectileState, specialInput, 1 / 60);
    projectileTracker.recordFrame(specialInput, projectileState, 1 / 60);
    const projectileSummary = projectileTracker.toSummary();
    expect(projectileSummary.players.P1.specialResolves).toBe(1);
    expect(projectileSummary.players.P1.projectilesSpawned).toBe(1);
  });

  test('aggregates compatible rounds and rejects mixed registries', () => {
    const state = createInitialState({ seed: 33 });
    const firstTracker = createMatchTelemetryTracker(state);
    const firstInput = neutralInput();
    firstInput.p1.launch = true;
    firstTracker.recordFrame(firstInput, state, 1 / 60);
    const first = firstTracker.toSummary();

    const secondState = createInitialState({ seed: 34 });
    const secondTracker = createMatchTelemetryTracker(secondState);
    secondTracker.recordFrame(firstInput, secondState, 1 / 60);
    const second = secondTracker.toSummary();
    const aggregate = aggregateMatchTelemetrySummaries([first, second]);

    expect(aggregate.schemaVersion).toBe(MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION);
    expect(aggregate.rounds).toBe(2);
    expect(aggregate.framesSimulated).toBe(2);
    expect(aggregate.spacing.contactRatio).toBe(0);
    expect(aggregate.sharedAgency).toMatchObject({
      controlFrames: 2,
      controlRatio: 1,
      actionReadyFrames: 2,
      actionReadyRatio: 1,
      actionReadyShareOfControlFrames: 1,
      pressureFrames: 0,
      pressureRatio: 0,
      neutralFrames: 2,
      neutralRatio: 1,
      sustainedNeutralWindowCount: 0,
    });
    expect(aggregate.players.P1.launchPresses).toBe(2);
    expect(aggregate.players.P1.movementIntent.controllableFrames).toBe(2);
    expect(aggregate.players.P1.movementIntent.idleFrames).toBe(2);
    expect(aggregate.eventCounts.action_press).toBe(2);

    const incompatible = {
      ...second,
      characterRegistryFingerprint: 'gw.character-registry.v1:00000000',
    };
    expect(() => aggregateMatchTelemetrySummaries([first, incompatible])).toThrow(
      'different character registries',
    );

    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames -= 1;
    const customState = createInitialState({
      seed: 35,
      characterBalanceOverrides: { vanguard },
    });
    const custom = createMatchTelemetryTracker(customState).toSummary();
    expect(custom.characterRegistryFingerprint).toMatch(
      /^gw\.character-registry\.v1:[0-9a-f]{8}\+local:[0-9a-f]{8}$/,
    );
    expect(custom.characters.P1.packageVersion).toMatch(/^0\.3\.3\+local\.[0-9a-f]{8}$/);
    expect(() => aggregateMatchTelemetrySummaries([first, custom])).toThrow(
      'different character registries',
    );
  });

  test('aggregates contact episode samples before calculating p90', () => {
    const firstState = createInitialState({ seed: 36 });
    const firstTracker = createMatchTelemetryTracker(firstState);
    recordContactEpisode(firstTracker, firstState, 1);
    recordContactEpisode(firstTracker, firstState, 10);

    const secondState = createInitialState({ seed: 37 });
    const secondTracker = createMatchTelemetryTracker(secondState);
    for (let episode = 0; episode < 8; episode += 1) {
      recordContactEpisode(secondTracker, secondState, 2);
    }

    const aggregate = aggregateMatchTelemetrySummaries([
      firstTracker.toSummary(),
      secondTracker.toSummary(),
    ]);
    expect(aggregate.spacing.contactEpisodeCount).toBe(10);
    expect(aggregate.spacing.contactEpisodeDurationsSeconds).toEqual([
      0.1,
      0.2,
      0.2,
      0.2,
      0.2,
      0.2,
      0.2,
      0.2,
      0.2,
      1,
    ]);
    expect(aggregate.spacing.maximumContactEpisodeSeconds).toBe(1);
    expect(aggregate.spacing.p90ContactEpisodeSeconds).toBe(0.2);
  });

  test('separates rejected presses from accepted actions', () => {
    const state = createInitialState({ seed: 35 });
    state.players.P1.endLag = 1;
    const tracker = createMatchTelemetryTracker(state);
    const heldLaunch = neutralInput();
    heldLaunch.p1.launch = true;

    step(state, heldLaunch, 1 / 60);
    tracker.recordFrame(heldLaunch, state, 1 / 60);
    expect(tracker.toSummary().players.P1.launchPresses).toBe(1);
    expect(tracker.toSummary().players.P1.launchStarts).toBe(0);

    state.players.P1.endLag = 0;
    step(state, heldLaunch, 1 / 60);
    tracker.recordFrame(heldLaunch, state, 1 / 60);
    const summary = tracker.toSummary();
    expect(summary.players.P1.launchPresses).toBe(1);
    expect(summary.players.P1.launchStarts).toBe(1);
  });

  test('counts launch extensions while the target is already helpless', () => {
    const state = createInitialState({ seed: 36 });
    const tracker = createMatchTelemetryTracker(state);

    state.players.P1.chain = 1;
    state.players.P2.helpless = 1;
    state.players.P2.lastLaunchedBy = 'P1';
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    state.players.P1.chain = 2;
    state.players.P2.helpless = 1;
    tracker.recordFrame(neutralInput(), state, 1 / 60);

    expect(tracker.toSummary().players.P1.launchHits).toBe(2);
  });
});
