import { describe, expect, test } from 'vitest';
import {
  AI_DIFFICULTY_ORDER,
  AI_DIFFICULTY_PROFILES,
  AI_DECISION_TRACE_SCHEMA_VERSION,
  buildFrameInputWithAi,
  createDefaultAiBehaviorTuning,
  createAiController,
  fingerprintAiBehaviorTuning,
  resolveAiDifficultyProfile,
  sanitiseAiBehaviorTuning,
  tickAiController,
} from './ai';
import { createMatchTelemetryTracker } from './matchTelemetry';
import { framesToSeconds } from './moveData';
import { createInitialState, step, type SimulationActionStart } from './sim';
import type { PlayerFrameInput } from './types';
import type { CharacterId } from './characters';

function createIdleInput(): PlayerFrameInput {
  return {
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
}

function runAiMirrorMatch(
  loadout: { P1: CharacterId; P2: CharacterId },
  frames: number,
  profileId: 'cadet' | 'veteran' | 'ace' = 'ace',
) {
  const state = createInitialState({ seed: 2026, loadout });
  let p1Controller = createAiController({ seed: 101, profileId });
  let p2Controller = createAiController({ seed: 202, profileId });
  const stats = {
    p1Specials: 0,
    p2Specials: 0,
    p1Parries: 0,
    p2Parries: 0,
    p1Breaks: 0,
    p2Breaks: 0,
    maxProjectilesSeen: 0,
  };

  for (let frame = 0; frame < frames; frame += 1) {
    const p1Tick = tickAiController(state, 'P1', p1Controller);
    const p2Tick = tickAiController(state, 'P2', p2Controller);
    p1Controller = p1Tick.next;
    p2Controller = p2Tick.next;

    if (p1Tick.input.special) {
      stats.p1Specials += 1;
    }
    if (p2Tick.input.special) {
      stats.p2Specials += 1;
    }
    if (p1Tick.input.parry) {
      stats.p1Parries += 1;
    }
    if (p2Tick.input.parry) {
      stats.p2Parries += 1;
    }
    if (p1Tick.input.breakLaunch) {
      stats.p1Breaks += 1;
    }
    if (p2Tick.input.breakLaunch) {
      stats.p2Breaks += 1;
    }

    step(
      state,
      {
        p1: p1Tick.input,
        p2: p2Tick.input,
      },
      1 / 60,
    );
    stats.maxProjectilesSeen = Math.max(stats.maxProjectilesSeen, state.projectiles.length);
  }

  return stats;
}

describe('sim AI behaviour framework', () => {
  test('exposes four data-driven difficulty profiles', () => {
    expect(AI_DIFFICULTY_ORDER).toEqual(['rookie', 'cadet', 'veteran', 'ace']);

    const rookie = AI_DIFFICULTY_PROFILES.rookie;
    const ace = AI_DIFFICULTY_PROFILES.ace;
    expect(rookie.reactionDelayFrames).toBeGreaterThan(ace.reactionDelayFrames);
    expect(rookie.errorRate).toBeGreaterThan(ace.errorRate);
    expect(rookie.riskAppetite).toBeLessThan(ace.riskAppetite);
    expect(rookie.approachDistance).toBeGreaterThan(ace.approachDistance);
  });

  test('keeps neutral designer tuning behavior-compatible and sanitises staged values', () => {
    const defaults = createDefaultAiBehaviorTuning();

    expect(defaults.finishPursuitReachScale).toBe(0.7);
    expect(defaults.postControlSteeringFrames).toBe(0);
    expect(defaults.opponentControlReturnObserveFrames).toBe(0);
    expect(resolveAiDifficultyProfile('veteran', defaults)).toEqual(
      AI_DIFFICULTY_PROFILES.veteran,
    );
    expect(sanitiseAiBehaviorTuning({
      engagementDistanceScale: 99,
      neutralApproachScale: -4,
      neutralBoostDistanceOffset: 99,
      reactionDelayScale: Number.NaN,
      neutralHoldFrames: 12.6,
      commitmentObserveFrames: 999,
      commitmentPressFrames: 999,
      commitmentResetFrames: 999,
      opponentControlReturnObserveFrames: 999,
      postControlSteeringFrames: 999,
      riskAppetiteOffset: -9,
      postRecoveryDefenseFrames: 999,
      postRecoveryDefensiveSpecialChance: 5,
      postRecoveryThreatParryChance: 5,
      committedLaunchGuardChance: 5,
      finishPursuitReachScale: 99,
    })).toMatchObject({
      engagementDistanceScale: 3,
      neutralApproachScale: 0,
      neutralBoostDistanceOffset: 60,
      reactionDelayScale: 1,
      neutralHoldFrames: 13,
      commitmentObserveFrames: 120,
      commitmentPressFrames: 180,
      commitmentResetFrames: 120,
      opponentControlReturnObserveFrames: 120,
      postControlSteeringFrames: 120,
      riskAppetiteOffset: -0.8,
      postRecoveryDefenseFrames: 120,
      postRecoveryDefensiveSpecialChance: 1,
      postRecoveryThreatParryChance: 1,
      committedLaunchGuardChance: 1,
      finishPursuitReachScale: 2,
    });
    expect(sanitiseAiBehaviorTuning({
      schemaVersion: 'gw.ai-behavior-tuning.v6',
    })).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
    });
    expect(sanitiseAiBehaviorTuning({
      schemaVersion: 'gw.ai-behavior-tuning.v7',
    })).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
    });
    expect(sanitiseAiBehaviorTuning({
      schemaVersion: 'gw.ai-behavior-tuning.v8',
    })).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
    });
    expect(fingerprintAiBehaviorTuning(defaults)).not.toBe(
      fingerprintAiBehaviorTuning({ ...defaults, engagementDistanceScale: 1.1 }),
    );
  });

  test('separately controls neutral inward drive and auto-lock boost range', () => {
    const state = createInitialState({ seed: 79 });
    state.players.P1.pos = { x: -20, y: 0 };
    state.players.P2.pos = { x: 20, y: 0 };
    const shared = {
      reactionFramesRemaining: 100,
      maneuverFramesRemaining: 100,
      strafeSign: 1 as const,
    };
    const legacyBehavior = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
    };
    const legacy = tickAiController(state, 'P1', {
      ...createAiController({ seed: 79, profileId: 'cadet', behaviorTuning: legacyBehavior }),
      ...shared,
    });
    const tunedBehavior = {
      ...legacyBehavior,
      neutralApproachScale: 0.25,
      neutralBoostDistanceOffset: 30,
    };
    const paced = tickAiController(state, 'P1', {
      ...createAiController({ seed: 79, profileId: 'cadet', behaviorTuning: tunedBehavior }),
      ...shared,
    });

    const legacyTowardRatio = legacy.input.moveX / Math.hypot(legacy.input.moveX, legacy.input.moveY);
    const pacedTowardRatio = paced.input.moveX / Math.hypot(paced.input.moveX, paced.input.moveY);
    expect(legacyTowardRatio).toBeGreaterThan(0.35);
    expect(legacy.input.boost).toBe(true);
    expect(pacedTowardRatio).toBeLessThan(0.35);
    expect(paced.input.boost).toBe(false);
  });

  test('can respect an opponent control return without suppressing ordinary neutral play', () => {
    const state = createInitialState({ seed: 177 });
    state.players.P1.pos = { x: -10, y: 0 };
    state.players.P2.pos = { x: 10, y: 0 };
    const tunedBehavior = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      opponentControlReturnObserveFrames: 18,
    };
    const tunedController = {
      ...createAiController({ seed: 177, profileId: 'veteran', behaviorTuning: tunedBehavior }),
      wasOpponentWithoutControl: true,
      reactionFramesRemaining: 0,
      decisionLockFrames: 0,
    };

    const observed = tickAiController(state, 'P1', tunedController);
    const ordinary = tickAiController(state, 'P1', {
      ...tunedController,
      behaviorTuning: createDefaultAiBehaviorTuning(),
    });

    expect(observed.next.opponentControlReturnObserveFramesRemaining).toBe(18);
    expect(observed.decision.movementIntent).toBe('commitment_observe');
    expect(observed.decision.selectedReason).toBe('opponent_control_return_observe');
    expect(observed.decision.gates.postEventSpacingActive).toBe(true);
    expect(observed.decision.candidates.launch.reason).toBe('opponent_control_return_observe');
    expect(observed.input.launch).toBe(false);
    expect(observed.input.special).toBe(false);
    expect(observed.input.dunk).toBe(false);
    expect(ordinary.next.opponentControlReturnObserveFramesRemaining).toBe(0);

    const expired = tickAiController(state, 'P1', {
      ...observed.next,
      opponentControlReturnObserveFramesRemaining: 1,
    });
    expect(expired.next.opponentControlReturnObserveFramesRemaining).toBe(0);
    expect(expired.decision.selectedReason).not.toBe('opponent_control_return_observe');
  });

  test('can create a deterministic pressure-exit decision window without changing defaults', () => {
    const state = createInitialState({ seed: 78 });
    state.players.P1.pos.x = -15;
    state.players.P1.pos.y = 0;
    state.players.P2.pos.x = 15;
    state.players.P2.pos.y = 0;
    const defaults = {
      ...createAiController({ seed: 78, profileId: 'cadet' }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    };
    const tunedBehavior = {
      ...createDefaultAiBehaviorTuning(),
      neutralHoldFrames: 42,
      neutralHoldDistance: 30,
    };
    const tuned = {
      ...createAiController({ seed: 78, profileId: 'cadet', behaviorTuning: tunedBehavior }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    };

    const defaultTick = tickAiController(state, 'P1', defaults);
    const firstTunedTick = tickAiController(state, 'P1', tuned);
    const secondTunedTick = tickAiController(state, 'P1', tuned);

    expect(defaultTick.next.neutralHoldFramesRemaining).toBe(0);
    expect(firstTunedTick.next.neutralHoldFramesRemaining).toBe(42);
    expect(firstTunedTick.input).toEqual(secondTunedTick.input);
    expect(firstTunedTick.next).toEqual(secondTunedTick.next);
  });

  test('assigns complementary initiative and response roles from the round seed', () => {
    const state = createInitialState({ seed: 178 });
    state.players.P1.pos = { x: -15, y: 0 };
    state.players.P2.pos = { x: 15, y: 0 };
    state.players.P1.cool.launch = 10;
    state.players.P1.cool.special = 10;
    state.players.P1.cool.dunk = 10;
    state.players.P2.cool.launch = 10;
    state.players.P2.cool.special = 10;
    state.players.P2.cool.dunk = 10;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const p1Controller = {
      ...createAiController({ seed: 178, profileId: 'cadet', behaviorTuning }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    };
    const p2Controller = {
      ...createAiController({ seed: 179, profileId: 'cadet', behaviorTuning }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    };

    const p1 = tickAiController(state, 'P1', p1Controller);
    const p2 = tickAiController(state, 'P2', p2Controller);
    const repeated = tickAiController(state, 'P1', p1Controller);

    expect(p1.decision.movementIntent).toBe('commitment_press');
    expect(p2.decision.movementIntent).toBe('commitment_observe');
    expect(p1.next.commitmentInitiativeOwner).toBe('P1');
    expect(p2.next.commitmentInitiativeOwner).toBe('P1');
    expect(p1.next.commitmentFramesRemaining).toBe(30);
    expect(p2.next.commitmentFramesRemaining).toBe(20);
    expect(p2.decision.selectedAction).toBeNull();
    expect(p1.input).toEqual(repeated.input);
    expect(p1.next).toEqual(repeated.next);
  });

  test('expires an unanswered response window back to legacy navigation', () => {
    const state = createInitialState({ seed: 179 });
    state.players.P1.pos = { x: -15, y: 0 };
    state.players.P2.pos = { x: 15, y: 0 };
    state.players.P1.cool.launch = 10;
    state.players.P1.cool.special = 10;
    state.players.P1.cool.dunk = 10;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const controller = {
      ...createAiController({ seed: 179, profileId: 'cadet', behaviorTuning }),
      commitmentMode: 'observe' as const,
      commitmentFramesRemaining: 0,
      commitmentInitiativeOwner: 'P2' as const,
      reactionFramesRemaining: 0,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.next.commitmentMode).toBe('legacy');
    expect(tick.next.commitmentFramesRemaining).toBe(0);
    expect(tick.decision.movementIntent).toBe('long_range_approach');
    expect(tick.input.moveX).toBeGreaterThan(0);
  });

  test('keeps the responder readable when the initiative owner commits', () => {
    const state = createInitialState({ seed: 180 });
    state.players.P1.pos = { x: -5, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    state.players.P2.launchStartup = 0.2;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const controller = {
      ...createAiController({ seed: 180, profileId: 'veteran', behaviorTuning }),
      commitmentMode: 'observe' as const,
      commitmentFramesRemaining: 15,
      commitmentInitiativeOwner: 'P2' as const,
      reactionFramesRemaining: 0,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.next.commitmentMode).toBe('observe');
    expect(tick.next.commitmentInitiativeOwner).toBe('P2');
    expect(tick.decision.movementIntent).toBe('commitment_observe');
    expect(tick.decision.candidates.launch.reason).toBe('commitment_observe');
    expect(tick.input.launch).toBe(false);
    expect(tick.input.special).toBe(false);
    expect(tick.input.dunk).toBe(false);
  });

  test('transfers initiative without forcing a shared reset after a whiff', () => {
    const state = createInitialState({ seed: 181 });
    state.players.P1.pos = { x: -5, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const controller = {
      ...createAiController({ seed: 181, profileId: 'cadet', behaviorTuning }),
      commitmentMode: 'press' as const,
      commitmentFramesRemaining: 20,
      commitmentInitiativeOwner: 'P1' as const,
      wasStrikeCommitted: true,
      reactionFramesRemaining: 0,
    };
    const opponentController = {
      ...createAiController({ seed: 182, profileId: 'cadet', behaviorTuning }),
      commitmentMode: 'observe' as const,
      commitmentFramesRemaining: 15,
      commitmentInitiativeOwner: 'P1' as const,
      wasOpponentStrikeCommitted: true,
      reactionFramesRemaining: 0,
    };

    const tick = tickAiController(state, 'P1', controller);
    const opponentTick = tickAiController(state, 'P2', opponentController);

    expect(tick.next.commitmentMode).toBe('observe');
    expect(opponentTick.next.commitmentMode).toBe('press');
    expect(tick.next.commitmentFramesRemaining).toBe(20);
    expect(opponentTick.next.commitmentFramesRemaining).toBe(30);
    expect(tick.next.commitmentInitiativeOwner).toBe('P2');
    expect(opponentTick.next.commitmentInitiativeOwner).toBe('P2');
    expect(tick.decision.movementIntent).toBe('commitment_observe');
    expect(opponentTick.decision.movementIntent).toBe('commitment_press');
    expect(tick.decision.candidates.launch.reason).toBe('commitment_observe');
    expect(tick.input.moveX).toBeLessThan(0);
  });

  test('counts commitment reset only while both fighters are action-ready', () => {
    const state = createInitialState({ seed: 183 });
    state.players.P1.pos = { x: -5, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    state.players.P1.endLag = 0.2;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentResetFrames: 12,
    };
    const controller = {
      ...createAiController({ seed: 183, profileId: 'cadet', behaviorTuning }),
      commitmentMode: 'reset' as const,
      commitmentFramesRemaining: 12,
      commitmentInitiativeOwner: 'P1' as const,
      reactionFramesRemaining: 0,
    };

    const duringEndLag = tickAiController(state, 'P1', controller);

    expect(duringEndLag.decision.movementIntent).toBe('commitment_reset');
    expect(duringEndLag.next.commitmentFramesRemaining).toBe(12);
    expect(duringEndLag.input.launch).toBe(false);
    expect(duringEndLag.input.special).toBe(false);

    state.players.P1.endLag = 0;
    state.players.P1.parry = 0.2;
    const duringParry = tickAiController(state, 'P1', duringEndLag.next);

    expect(duringParry.decision.movementIntent).toBe('commitment_reset');
    expect(duringParry.next.commitmentFramesRemaining).toBe(12);
    expect(duringParry.input.launch).toBe(false);
    expect(duringParry.input.special).toBe(false);

    state.players.P1.parry = 0;
    const firstSharedDecisionFrame = tickAiController(state, 'P1', duringParry.next);

    expect(firstSharedDecisionFrame.decision.movementIntent).toBe('commitment_reset');
    expect(firstSharedDecisionFrame.next.commitmentFramesRemaining).toBe(11);
    expect(firstSharedDecisionFrame.input.launch).toBe(false);
    expect(firstSharedDecisionFrame.input.special).toBe(false);
  });

  test('both controllers transfer initiative after the same clash', () => {
    const state = createInitialState({ seed: 184 });
    state.players.P1.pos = { x: -5, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    state.players.P1.launchFlash = 0.1;
    state.players.P2.launchFlash = 0.1;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const p1Controller = {
      ...createAiController({ seed: 184, profileId: 'veteran', behaviorTuning }),
      commitmentMode: 'press' as const,
      commitmentFramesRemaining: 20,
      commitmentInitiativeOwner: 'P1' as const,
      reactionFramesRemaining: 0,
    };
    const p2Controller = {
      ...createAiController({ seed: 185, profileId: 'veteran', behaviorTuning }),
      commitmentMode: 'observe' as const,
      commitmentFramesRemaining: 15,
      commitmentInitiativeOwner: 'P1' as const,
      reactionFramesRemaining: 0,
    };

    const p1 = tickAiController(state, 'P1', p1Controller);
    const p2 = tickAiController(state, 'P2', p2Controller);

    expect(p1.next.commitmentMode).toBe('reset');
    expect(p2.next.commitmentMode).toBe('reset');
    expect(p1.next.commitmentFramesRemaining).toBe(12);
    expect(p2.next.commitmentFramesRemaining).toBe(12);
    expect(p1.next.commitmentInitiativeOwner).toBe('P2');
    expect(p2.next.commitmentInitiativeOwner).toBe('P2');
  });

  test.each([
    ['vanguard', 'duelist'],
    ['duelist', 'vanguard'],
  ] as const)('does not transfer initiative when the %s utility special ends', (characterId, opponentId) => {
    const state = createInitialState({
      seed: 186,
      loadout: { P1: characterId, P2: opponentId },
    });
    state.players.P1.pos = { x: -5, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    state.players.P1.specialStartup = 0.2;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const controller = {
      ...createAiController({ seed: 186, profileId: 'veteran', behaviorTuning }),
      commitmentMode: 'press' as const,
      commitmentFramesRemaining: 20,
      commitmentInitiativeOwner: 'P1' as const,
      reactionFramesRemaining: 0,
    };

    const duringSpecial = tickAiController(state, 'P1', controller);
    state.players.P1.specialStartup = 0;
    const afterSpecial = tickAiController(state, 'P1', duringSpecial.next);

    expect(duringSpecial.next.wasStrikeCommitted).toBe(false);
    expect(afterSpecial.next.commitmentMode).toBe('press');
    expect(afterSpecial.next.commitmentInitiativeOwner).toBe('P1');
  });

  test('transfers initiative after an offensive projectile special misses', () => {
    const state = createInitialState({
      seed: 188,
      loadout: { P1: 'ace', P2: 'vanguard' },
    });
    state.players.P1.pos = { x: -15, y: 0 };
    state.players.P2.pos = { x: 15, y: 0 };
    state.players.P1.specialStartup = 0.2;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const controller = {
      ...createAiController({ seed: 188, profileId: 'veteran', behaviorTuning }),
      commitmentMode: 'press' as const,
      commitmentFramesRemaining: 20,
      commitmentInitiativeOwner: 'P1' as const,
      reactionFramesRemaining: 0,
    };

    const duringSpecial = tickAiController(state, 'P1', controller);
    state.players.P1.specialStartup = 0;
    const afterSpecial = tickAiController(state, 'P1', duringSpecial.next);

    expect(duringSpecial.next.wasStrikeCommitted).toBe(true);
    expect(afterSpecial.next.commitmentMode).toBe('observe');
    expect(afterSpecial.next.commitmentInitiativeOwner).toBe('P2');
  });

  test('hands initiative to the recovered fighter after a symmetric reset window', () => {
    const state = createInitialState({ seed: 182 });
    state.players.P1.pos = { x: -5, y: 0 };
    state.players.P2.pos = { x: 5, y: 0 };
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const p1Controller = {
      ...createAiController({ seed: 182, profileId: 'veteran', behaviorTuning }),
      wasOpponentWithoutControl: true,
      reactionFramesRemaining: 0,
    };
    const p2Controller = {
      ...createAiController({ seed: 183, profileId: 'veteran', behaviorTuning }),
      wasPlayerWithoutControl: true,
      reactionFramesRemaining: 0,
    };

    const p1Reset = tickAiController(state, 'P1', p1Controller);
    const p2Reset = tickAiController(state, 'P2', p2Controller);

    expect(p1Reset.next.commitmentMode).toBe('reset');
    expect(p2Reset.next.commitmentMode).toBe('reset');
    expect(p1Reset.next.commitmentFramesRemaining).toBe(12);
    expect(p2Reset.next.commitmentFramesRemaining).toBe(12);
    expect(p1Reset.next.commitmentInitiativeOwner).toBe('P2');
    expect(p2Reset.next.commitmentInitiativeOwner).toBe('P2');

    const p1Role = tickAiController(state, 'P1', {
      ...p1Reset.next,
      commitmentFramesRemaining: 0,
    });
    const p2Role = tickAiController(state, 'P2', {
      ...p2Reset.next,
      commitmentFramesRemaining: 0,
    });
    expect(p1Role.next.commitmentMode).toBe('observe');
    expect(p2Role.next.commitmentMode).toBe('press');
    expect(p1Role.decision.movementIntent).toBe('commitment_observe');
    expect(p2Role.decision.movementIntent).toBe('commitment_press');
  });

  test('AI emits standard PlayerFrameInput shape for deterministic sim use', () => {
    const state = createInitialState({ seed: 77 });
    const controller = createAiController({ seed: 77, profileId: 'cadet' });
    const tick = tickAiController(state, 'P2', controller);

    expect(typeof tick.input.moveX).toBe('number');
    expect(typeof tick.input.moveY).toBe('number');
    expect(typeof tick.input.launch).toBe('boolean');
    expect(typeof tick.input.parry).toBe('boolean');
    expect(typeof tick.input.breakLaunch).toBe('boolean');
    expect(typeof tick.next.rngState).toBe('number');
    expect(tick.next.recoveryPolicyId).toBe('legacy');
    expect(tick.next.clashPolicyId).toBe('legacy');
    expect(tick.next.pursuitPolicyId).toBe('legacy');
    expect(tick.next.commitmentMode).toBe('legacy');
    expect(tick.next.commitmentFramesRemaining).toBe(0);
    expect(tick.next.commitmentInitiativeOwner).toBeNull();
    expect(tick.next.wasOpponentStrikeCommitted).toBe(false);
    expect(tick.next.wasPlayerWithoutControl).toBe(false);
    expect(tick.next.wasOpponentWithoutControl).toBe(false);
  });

  test('AI policy is deterministic under fixed seed and fixed-step simulation', () => {
    const runSimulation = () => {
      const state = createInitialState({ seed: 1337 });
      let controller = createAiController({ seed: 1337, profileId: 'veteran' });
      const launchFrames: number[] = [];
      const parryFrames: number[] = [];
      const specialFrames: number[] = [];
      for (let frame = 0; frame < 360; frame += 1) {
        const tick = tickAiController(state, 'P2', controller);
        controller = tick.next;
        if (tick.input.launch) {
          launchFrames.push(frame);
        }
        if (tick.input.parry) {
          parryFrames.push(frame);
        }
        if (tick.input.special) {
          specialFrames.push(frame);
        }
        const frameInput = buildFrameInputWithAi(createIdleInput(), tick.input, 'P2');
        step(state, frameInput, 1 / 60);
      }
      return {
        launchFrames,
        parryFrames,
        specialFrames,
        finalP2Fuel: state.players.P2.fuel,
        finalP1Fuel: state.players.P1.fuel,
      };
    };

    const first = runSimulation();
    const second = runSimulation();

    expect(first).toEqual(second);
  });

  test('difficulty profile changes movement and action cadence', () => {
    const runSimulation = (profileId: 'rookie' | 'ace') => {
      const state = createInitialState({ seed: 2026 });
      let controller = createAiController({ seed: 2026, profileId });
      let actions = 0;
      let movementEnergy = 0;
      const actionFrames: number[] = [];
      for (let frame = 0; frame < 360; frame += 1) {
        const tick = tickAiController(state, 'P2', controller);
        controller = tick.next;
        if (tick.input.launch || tick.input.special || tick.input.dunk || tick.input.parry) {
          actions += 1;
          actionFrames.push(frame);
        }
        movementEnergy += Math.abs(tick.input.moveX) + Math.abs(tick.input.moveY);
        const frameInput = buildFrameInputWithAi(createIdleInput(), tick.input, 'P2');
        step(state, frameInput, 1 / 60);
      }
      return { actions, actionFrames, movementEnergy };
    };

    const rookie = runSimulation('rookie');
    const ace = runSimulation('ace');

    expect(ace.actionFrames).not.toEqual(rookie.actionFrames);
    expect(ace.movementEnergy).toBeGreaterThan(rookie.movementEnergy);
  });

  test('AI uses character-specific specials and defensive options in the default matchup', () => {
    const stats = runAiMirrorMatch({ P1: 'vanguard', P2: 'duelist' }, 900);

    expect(stats.p1Specials).toBeGreaterThan(0);
    expect(stats.p2Specials).toBeGreaterThan(0);
    expect(stats.p1Parries + stats.p2Parries + stats.p1Breaks + stats.p2Breaks).toBeGreaterThan(0);
  });

  test('projectile archetype AI actually creates projectile traffic', () => {
    const stats = runAiMirrorMatch({ P1: 'ace', P2: 'warden' }, 900);

    expect(stats.p1Specials + stats.p2Specials).toBeGreaterThan(0);
    expect(stats.maxProjectilesSeen).toBeGreaterThan(0);
  });

  test('AI spends launch breaks in urgent helpless situations', () => {
    const state = createInitialState({ seed: 44 });
    state.players.P2.helpless = 1.9;
    state.players.P2.launchBreaks = 2;
    state.players.P2.fuel = 0;
    state.players.P2.pos = { x: 61, y: 0 };
    state.players.P2.vel = { x: 50, y: 0 };
    state.players.P1.pos = { x: 67, y: 0 };
    const controller = createAiController({ seed: 44, profileId: 'ace' });

    const tick = tickAiController(state, 'P2', controller);

    expect(tick.input.breakLaunch).toBe(true);
  });

  test('AI delays a non-urgent launch break using deterministic controller state', () => {
    const runBreakPlan = (seed: number) => {
      const state = createInitialState({ seed });
      state.players.P2.helpless = 4;
      state.players.P2.launchBreaks = 2;
      state.players.P2.pos = { x: 0, y: 0 };
      state.players.P2.vel = { x: 126, y: 0 };
      state.players.P1.pos = { x: -32, y: 0 };
      let controller = {
        ...createAiController({ seed, profileId: 'veteran' }),
        wasHelpless: true,
        launchBreakDelayFramesRemaining: 12,
        launchBreakPlanned: true,
      };

      for (let frame = 0; frame < 90; frame += 1) {
        const tick = tickAiController(state, 'P2', controller);
        controller = tick.next;
        if (tick.input.breakLaunch) {
          return frame;
        }
      }
      return null;
    };

    const first = runBreakPlan(4401);
    const second = runBreakPlan(4401);

    expect(first).toBe(second);
    expect(first).not.toBeNull();
    expect(first).toBeGreaterThanOrEqual(11);
  });

  test('AI seed stream produces both hold and spend launch-break plans', () => {
    const plans = new Set<boolean>();

    for (let seed = 1; seed <= 64; seed += 1) {
      const state = createInitialState({ seed });
      state.players.P2.helpless = 4;
      state.players.P2.launchBreaks = 3;
      state.players.P2.pos = { x: 0, y: 0 };
      state.players.P2.vel = { x: 126, y: 0 };
      state.players.P1.pos = { x: -32, y: 0 };

      const tick = tickAiController(
        state,
        'P2',
        createAiController({ seed, profileId: 'veteran' }),
      );
      plans.add(tick.next.launchBreakPlanned);
    }

    expect(plans).toEqual(new Set([false, true]));
  });

  test('AI conserves its last launch break when natural recovery is imminent', () => {
    const state = createInitialState({ seed: 4402 });
    state.players.P2.helpless = 0.3;
    state.players.P2.launchBreaks = 1;
    state.players.P2.pos = { x: 0, y: 0 };
    state.players.P2.vel = { x: 126, y: 0 };
    state.players.P1.pos = { x: -32, y: 0 };
    const controller = {
      ...createAiController({ seed: 4402, profileId: 'ace' }),
      wasHelpless: true,
      launchBreakDelayFramesRemaining: 0,
      launchBreakPlanned: true,
    };

    const tick = tickAiController(state, 'P2', controller);

    expect(tick.input.breakLaunch).toBe(false);
  });

  test('AI commits to a low-fuel helpless target instead of relaunching it', () => {
    const state = createInitialState({ seed: 45 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P1.fuel = state.players.P1.maxFuel * 0.5;
    state.players.P2.pos = { x: 28, y: 0 };
    state.players.P2.vel = { x: 24, y: 8 };
    state.players.P2.helpless = 1.2;
    state.players.P2.fuel = 0;
    const controller = createAiController({ seed: 45, profileId: 'veteran' });

    const chase = tickAiController(state, 'P1', controller);

    expect(chase.input.boost || chase.input.superBoost).toBe(true);
    expect(chase.input.launch).toBe(false);

    state.players.P2.pos = { x: 6, y: 0 };
    state.players.P2.vel = { x: 0, y: 0 };
    const finish = tickAiController(state, 'P1', chase.next);
    expect(finish.input.dunk).toBe(true);
    expect(finish.input.launch).toBe(false);
    expect(finish.input.special).toBe(false);
  });

  test('AI delays a dunk when relative velocity would overshoot before activation', () => {
    const state = createInitialState({ seed: 451 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P1.vel = { x: 50, y: 0 };
    state.players.P2.pos = { x: 6, y: 0 };
    state.players.P2.vel = { x: -3, y: 0 };
    state.players.P2.helpless = 1.2;
    state.players.P2.fuel = state.players.P2.maxFuel * 0.5;
    const controller = createAiController({ seed: 451, profileId: 'veteran' });

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.input.dunk).toBe(false);
    expect(tick.input.special).toBe(false);
    expect(tick.input.launch).toBe(false);
  });

  test('AI uses authored startup pursuit reach to commit before raw dunk hit range', () => {
    const state = createInitialState({ seed: 454 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 14, y: 0 };
    state.players.P2.vel = { x: 0, y: 0 };
    state.players.P2.helpless = 2;
    state.players.P2.fuel = 0;
    const controller = {
      ...createAiController({ seed: 454, profileId: 'veteran' }),
      decisionLockFrames: 0,
      reactionFramesRemaining: 0,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.input.dunk).toBe(true);
    expect(tick.input.launch).toBe(false);
    expect(tick.input.special).toBe(false);
  });

  test('finish pursuit reach is tunable without changing the neutral commit range', () => {
    const state = createInitialState({ seed: 455 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 40, y: 0 };
    state.players.P2.vel = { x: 0, y: 0 };
    state.players.P2.helpless = 2;
    state.players.P2.fuel = 0;
    const baselineBehavior = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
    };
    const baseline = tickAiController(
      state,
      'P1',
      {
        ...createAiController({ seed: 455, profileId: 'veteran', behaviorTuning: baselineBehavior }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      },
    );
    const extended = tickAiController(
      state,
      'P1',
      {
        ...createAiController({
          seed: 455,
          profileId: 'veteran',
          behaviorTuning: { ...baselineBehavior, finishPursuitReachScale: 1.25 },
        }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      },
    );

    expect(baseline.input.dunk).toBe(false);
    expect(baseline.decision.candidates.dunk.reason).toBe('out_of_range');
    expect(extended.input.dunk).toBe(true);
    expect(extended.input.launch).toBe(false);
    expect(extended.decision.selectedReason).toBe('zero_fuel_finish_window');
  });

  test('AI treats low fuel as setup rather than an exact-zero finishing window', () => {
    const state = createInitialState({ seed: 453 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P1.vel = { x: 50, y: 0 };
    state.players.P2.pos = { x: 6, y: 0 };
    state.players.P2.vel = { x: -3, y: 0 };
    state.players.P2.helpless = 1.2;
    state.players.P2.fuel = state.players.P2.maxFuel * 0.05;
    const controller = createAiController({ seed: 453, profileId: 'veteran' });

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.input.dunk).toBe(false);
  });

  test('AI prioritises the launch setup against a depleted target', () => {
    const state = createInitialState({ seed: 452 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P1.fuel = 0;
    state.players.P2.pos = { x: 7, y: 0 };
    state.players.P2.fuel = 0;
    const controller = {
      ...createAiController({ seed: 452, profileId: 'veteran' }),
      decisionLockFrames: 0,
      reactionFramesRemaining: 0,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.input.moveX).toBeGreaterThan(0);
    expect(tick.input.launch).toBe(true);
    expect(tick.input.special).toBe(false);
  });

  test.each(['vanguard', 'duelist'] as const)(
    '%s AI does not repeatedly request an unaffordable special',
    (characterId) => {
      const opponentId = characterId === 'vanguard' ? 'duelist' : 'vanguard';
      const state = createInitialState({
        seed: 46,
        loadout: { P1: characterId, P2: opponentId },
      });
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P1.fuel = 0;
      state.players.P2.pos = { x: 8, y: 0 };
      let controller = createAiController({ seed: 46, profileId: 'veteran' });

      for (let frame = 0; frame < 120; frame += 1) {
        const tick = tickAiController(state, 'P1', controller);
        controller = tick.next;
        expect(tick.input.special).toBe(false);
      }
    },
  );

  test('AI creates a deliberate spacing window when launch control returns', () => {
    const state = createInitialState({
      seed: 460,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    const controller = {
      ...createAiController({ seed: 460, profileId: 'veteran', recoveryPolicyId: 'spacing' }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.next.postRecoveryFramesRemaining).toBeGreaterThan(0);
    expect(tick.input.moveX).toBeLessThan(0);
    expect(tick.input.boost).toBe(false);
    expect(tick.input.launch).toBe(false);
    expect(tick.input.special).toBe(false);
    expect(tick.input.dunk).toBe(false);
  });

  test('post-control steering creates space without suppressing defensive counters', () => {
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postControlSteeringFrames: 12,
      postRecoveryDefenseFrames: 12,
      postRecoveryThreatParryChance: 1,
    };
    const threatenedState = createInitialState({
      seed: 482,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    threatenedState.players.P1.pos = { x: 0, y: 0 };
    threatenedState.players.P2.pos = { x: 8, y: 0 };
    threatenedState.players.P2.launchStartup = 1;
    const threatened = tickAiController(threatenedState, 'P1', {
      ...createAiController({ seed: 482, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    });

    expect(threatened.next.postControlSteeringFramesRemaining).toBe(12);
    expect(threatened.input.moveX).toBeLessThan(0);
    expect(threatened.input.boost).toBe(false);
    expect(threatened.input.superBoost).toBe(false);
    expect(threatened.input.parry).toBe(true);
    expect(threatened.decision.gates.postEventSpacingActive).toBe(true);

    const neutralState = createInitialState({
      seed: 483,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    neutralState.players.P1.pos = { x: 0, y: 0 };
    neutralState.players.P2.pos = { x: 8, y: 0 };
    const neutral = tickAiController(neutralState, 'P1', {
      ...createAiController({ seed: 483, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    });

    expect(neutral.input.moveX).toBeLessThan(0);
    expect(neutral.input.special).toBe(false);
    expect(neutral.decision.candidates.launch.reason).toBe('ready');
    expect(neutral.decision.candidates.special.reason).toBe('post_control_dash_suppressed');
  });

  test('post-control steering only starts for a close control return', () => {
    const state = createInitialState({ seed: 484 });
    state.players.P1.pos = { x: -20, y: 0 };
    state.players.P2.pos = { x: 20, y: 0 };
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postControlSteeringFrames: 12,
    };
    const tick = tickAiController(state, 'P1', {
      ...createAiController({ seed: 484, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    });

    expect(tick.next.postControlSteeringFramesRemaining).toBe(0);
    expect(tick.decision.gates.postEventSpacingActive).toBe(false);
  });

  test('slower-startup AI withholds launch during a configured post-control defense window', () => {
    const state = createInitialState({
      seed: 474,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postRecoveryDefenseFrames: 12,
      postRecoveryThreatParryChance: 1,
    };
    const controller = {
      ...createAiController({ seed: 474, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.next.postRecoveryDefenseFramesRemaining).toBe(12);
    expect(tick.input.launch).toBe(false);
    expect(tick.input.parry).toBe(false);
    expect(tick.decision.candidates.launch).toMatchObject({
      eligible: false,
      reason: 'post_control_defense',
    });
    expect(tick.next.recoveryRngState).toBe(controller.recoveryRngState);
  });

  test('post-control defense parries only after a real threat appears', () => {
    const state = createInitialState({
      seed: 475,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    state.players.P2.launchStartup = 1;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postRecoveryDefenseFrames: 12,
      postRecoveryThreatParryChance: 1,
    };
    const controller = {
      ...createAiController({ seed: 475, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.input.parry).toBe(true);
    expect(tick.input.launch).toBe(false);
    expect(tick.input.special).toBe(false);
    expect(tick.input.dunk).toBe(false);
    expect(tick.decision.selectedAction).toBe('parry');
    expect(tick.decision.selectedReason).toBe('post_control_threat_parry');
    expect(tick.decision.candidates.parry).toMatchObject({
      eligible: true,
      weight: 1,
      reason: 'post_control_threat_parry',
    });
    expect(tick.next.postRecoveryThreatParryAttempted).toBe(true);
    expect(tick.next.recoveryRngState).not.toBe(controller.recoveryRngState);
  });

  test('post-control defense can use an authored defensive special before a threat', () => {
    const state = createInitialState({
      seed: 480,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postRecoveryDefenseFrames: 12,
      postRecoveryDefensiveSpecialChance: 1,
      postRecoveryThreatParryChance: 1,
    };
    const controller = {
      ...createAiController({ seed: 480, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const tick = tickAiController(state, 'P1', controller);

    expect(tick.input.special).toBe(true);
    expect(tick.input.launch).toBe(false);
    expect(tick.input.parry).toBe(false);
    expect(tick.decision.selectedAction).toBe('special');
    expect(tick.decision.selectedReason).toBe('post_control_defensive_special');
    expect(tick.decision.candidates.special).toMatchObject({
      eligible: true,
      weight: 1,
      reason: 'post_control_defensive_special',
    });
    expect(tick.next.recoveryRngState).not.toBe(controller.recoveryRngState);
  });

  test('zero post-control defense preserves the default decision and RNG stream', () => {
    const state = createInitialState({ seed: 475 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    const shared = {
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };
    const baselineController = {
      ...createAiController({ seed: 475, profileId: 'veteran' }),
      ...shared,
    };
    const explicitZeroController = {
      ...createAiController({
        seed: 475,
        profileId: 'veteran',
        behaviorTuning: {
          ...createDefaultAiBehaviorTuning(),
          postRecoveryDefenseFrames: 0,
          postRecoveryThreatParryChance: 0,
        },
      }),
      ...shared,
    };

    const baseline = tickAiController(state, 'P1', baselineController);
    const explicitZero = tickAiController(state, 'P1', explicitZeroController);

    expect(explicitZero.input).toEqual(baseline.input);
    expect(explicitZero.decision).toEqual(baseline.decision);
    expect(explicitZero.next.recoveryRngState).toBe(baselineController.recoveryRngState);
    expect(explicitZero.next.recoveryRngState).toBe(baseline.next.recoveryRngState);
  });

  test('post-control defense requires pressure, control, and slower authored launch startup', () => {
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postRecoveryDefenseFrames: 12,
      postRecoveryThreatParryChance: 1,
    };
    const rangedState = createInitialState({ seed: 476 });
    rangedState.players.P1.pos = { x: -20, y: 0 };
    rangedState.players.P2.pos = { x: 20, y: 0 };
    const rangedController = {
      ...createAiController({ seed: 476, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const ranged = tickAiController(rangedState, 'P1', rangedController);
    expect(ranged.input.parry).toBe(false);
    expect(ranged.next.postRecoveryDefenseFramesRemaining).toBe(0);
    expect(ranged.next.recoveryRngState).toBe(rangedController.recoveryRngState);

    const stunnedState = createInitialState({ seed: 477 });
    stunnedState.players.P1.pos = { x: 0, y: 0 };
    stunnedState.players.P2.pos = { x: 8, y: 0 };
    stunnedState.players.P1.stunned = 0.1;
    const stunnedController = {
      ...createAiController({ seed: 477, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const stunned = tickAiController(stunnedState, 'P1', stunnedController);
    expect(stunned.input.parry).toBe(false);
    expect(stunned.next.postRecoveryDefenseFramesRemaining).toBe(0);
    expect(stunned.next.recoveryRngState).toBe(stunnedController.recoveryRngState);

    const fasterState = createInitialState({
      seed: 478,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    fasterState.players.P1.pos = { x: 0, y: 0 };
    fasterState.players.P2.pos = { x: 8, y: 0 };
    const fasterController = {
      ...createAiController({ seed: 478, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const faster = tickAiController(fasterState, 'P1', fasterController);
    expect(faster.next.postRecoveryDefenseFramesRemaining).toBe(0);
    expect(faster.next.recoveryRngState).toBe(fasterController.recoveryRngState);
  });

  test('post-control defense makes at most one threat-parry roll per window', () => {
    const state = createInitialState({
      seed: 479,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    state.players.P2.launchStartup = 1;
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      postRecoveryDefenseFrames: 12,
      postRecoveryThreatParryChance: Number.MIN_VALUE,
    };
    const controller = {
      ...createAiController({ seed: 479, profileId: 'veteran', behaviorTuning }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 100,
    };

    const attempted = tickAiController(state, 'P1', controller);
    const repeated = tickAiController(state, 'P1', attempted.next);

    expect(attempted.next.postRecoveryThreatParryAttempted).toBe(true);
    expect(attempted.next.recoveryRngState).not.toBe(controller.recoveryRngState);
    expect(repeated.next.recoveryRngState).toBe(attempted.next.recoveryRngState);
  });

  test('committed launch guard answers one readable launch commitment despite decision lock', () => {
    const state = createInitialState({
      seed: 481,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    state.players.P2.launchStartup = framesToSeconds(5);
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      committedLaunchGuardChance: 1,
    };
    const controller = {
      ...createAiController({ seed: 481, profileId: 'veteran', behaviorTuning }),
      decisionLockFrames: 100,
      reactionFramesRemaining: 100,
      maneuverFramesRemaining: 100,
    };

    const answered = tickAiController(state, 'P1', controller);
    const repeated = tickAiController(state, 'P1', answered.next);

    expect(answered.input.special).toBe(true);
    expect(answered.input.launch).toBe(false);
    expect(answered.input.parry).toBe(false);
    expect(answered.decision.selectedAction).toBe('special');
    expect(answered.decision.selectedReason).toBe('committed_launch_guard');
    expect(answered.decision.candidates.special).toMatchObject({
      eligible: true,
      weight: 1,
      reason: 'committed_launch_guard',
    });
    expect(answered.next.observedOpponentLaunchCommitment).toBe(true);
    expect(answered.next.recoveryRngState).not.toBe(controller.recoveryRngState);
    expect(repeated.next.recoveryRngState).toBe(answered.next.recoveryRngState);
  });

  test('committed launch guard rejects late, unrelated, and unauthored responses', () => {
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      committedLaunchGuardChance: 1,
    };
    const createLockedController = (seed: number) => ({
      ...createAiController({ seed, profileId: 'veteran', behaviorTuning }),
      decisionLockFrames: 100,
      reactionFramesRemaining: 100,
      maneuverFramesRemaining: 100,
    });

    const lateState = createInitialState({
      seed: 482,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    lateState.players.P1.pos = { x: 0, y: 0 };
    lateState.players.P2.pos = { x: 8, y: 0 };
    lateState.players.P2.launchStartup = framesToSeconds(3);
    const lateController = createLockedController(482);
    const late = tickAiController(lateState, 'P1', lateController);
    expect(late.input.special).toBe(false);
    expect(late.next.recoveryRngState).toBe(lateController.recoveryRngState);

    const dunkState = createInitialState({
      seed: 483,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    dunkState.players.P1.pos = { x: 0, y: 0 };
    dunkState.players.P2.pos = { x: 8, y: 0 };
    dunkState.players.P2.dunkStartup = framesToSeconds(10);
    const dunkController = createLockedController(483);
    const dunk = tickAiController(dunkState, 'P1', dunkController);
    expect(dunk.input.special).toBe(false);
    expect(dunk.next.recoveryRngState).toBe(dunkController.recoveryRngState);

    const duelistState = createInitialState({
      seed: 484,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    duelistState.players.P1.pos = { x: 0, y: 0 };
    duelistState.players.P2.pos = { x: 8, y: 0 };
    duelistState.players.P2.launchStartup = framesToSeconds(7);
    const duelistController = createLockedController(484);
    const duelist = tickAiController(duelistState, 'P1', duelistController);
    expect(duelist.input.special).toBe(false);
    expect(duelist.next.recoveryRngState).toBe(duelistController.recoveryRngState);
  });

  test('experimental spacing policy preserves clash separation before pursuing again', () => {
    const state = createInitialState({
      seed: 464,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: -6, y: 0 };
    state.players.P2.pos = { x: 6, y: 0 };
    state.players.P1.launchFlash = 0.2;
    state.players.P2.launchFlash = 0.2;
    const controller = {
      ...createAiController({
        seed: 464,
        profileId: 'veteran',
        recoveryPolicyId: 'legacy',
        clashPolicyId: 'spacing',
      }),
      reactionFramesRemaining: 0,
    };

    const first = tickAiController(state, 'P1', controller);

    expect(first.next.observedClashFlash).toBe(true);
    expect(first.next.postRecoveryFramesRemaining).toBeGreaterThan(0);
    expect(first.input.moveX).toBeLessThan(0);
    expect(first.input.boost).toBe(false);
    expect(first.input.launch).toBe(false);
    expect(first.input.special).toBe(false);
    expect(first.input.dunk).toBe(false);

    const repeatedFlash = tickAiController(state, 'P1', first.next);
    expect(repeatedFlash.next.postRecoveryFramesRemaining)
      .toBe(first.next.postRecoveryFramesRemaining - 1);
    expect(repeatedFlash.next.recoveryRngState).toBe(first.next.recoveryRngState);
  });

  test('legacy clash policy and launch-hit flashes do not trigger post-clash spacing', () => {
    const clashState = createInitialState({ seed: 465 });
    clashState.players.P1.launchFlash = 0.2;
    clashState.players.P2.launchFlash = 0.2;
    const legacy = tickAiController(
      clashState,
      'P1',
      createAiController({ seed: 465, profileId: 'veteran', recoveryPolicyId: 'legacy' }),
    );
    expect(legacy.next.observedClashFlash).toBe(true);
    expect(legacy.next.postRecoveryFramesRemaining).toBe(0);

    const launchHitState = createInitialState({ seed: 466 });
    launchHitState.players.P1.launchFlash = 0.2;
    launchHitState.players.P2.launchFlash = 0.2;
    launchHitState.players.P2.helpless = 1;
    const launchHit = tickAiController(
      launchHitState,
      'P1',
      createAiController({ seed: 466, profileId: 'veteran', clashPolicyId: 'spacing' }),
    );
    expect(launchHit.next.observedClashFlash).toBe(false);
    expect(launchHit.next.postRecoveryFramesRemaining).toBe(0);
  });

  test('recovery and clash policies activate only from their own events', () => {
    const clashState = createInitialState({ seed: 467 });
    clashState.players.P1.launchFlash = 0.2;
    clashState.players.P2.launchFlash = 0.2;
    const recoveryOnly = tickAiController(
      clashState,
      'P1',
      createAiController({ seed: 467, profileId: 'veteran', recoveryPolicyId: 'spacing' }),
    );
    expect(recoveryOnly.next.postRecoveryFramesRemaining).toBe(0);

    const controlReturnState = createInitialState({ seed: 468 });
    const clashOnly = tickAiController(controlReturnState, 'P1', {
      ...createAiController({ seed: 468, profileId: 'veteran', clashPolicyId: 'spacing' }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
    });
    expect(clashOnly.next.postRecoveryFramesRemaining).toBe(0);
  });

  test('neutral-hold pursuit creates one decision window after leaving pressure', () => {
    const state = createInitialState({ seed: 469 });
    state.players.P1.pos = { x: -13, y: 0 };
    state.players.P2.pos = { x: 13, y: 0 };
    const controller = {
      ...createAiController({ seed: 469, profileId: 'veteran', pursuitPolicyId: 'neutral_hold' }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    };

    const first = tickAiController(state, 'P1', controller);

    expect(first.next.wasInPressureBand).toBe(false);
    expect(first.next.neutralHoldPending).toBe(false);
    expect(first.next.neutralHoldFramesRemaining).toBeGreaterThan(0);
    expect(first.input.moveX).toBeLessThan(0);
    expect(first.input.boost).toBe(false);
    expect(first.input.superBoost).toBe(false);
    expect(first.input.launch).toBe(false);
    expect(first.input.special).toBe(false);

    const continued = tickAiController(state, 'P1', first.next);
    expect(continued.next.neutralHoldFramesRemaining)
      .toBe(first.next.neutralHoldFramesRemaining - 1);
  });

  test('neutral hold waits for post-exchange end lag and does not trigger at initial range', () => {
    const state = createInitialState({ seed: 470 });
    state.players.P1.pos = { x: -13, y: 0 };
    state.players.P2.pos = { x: 13, y: 0 };
    state.players.P1.endLag = 0.2;
    state.players.P2.endLag = 0.2;
    const controller = {
      ...createAiController({ seed: 470, profileId: 'cadet', pursuitPolicyId: 'neutral_hold' }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    };

    const pending = tickAiController(state, 'P1', controller);
    expect(pending.next.neutralHoldPending).toBe(true);
    expect(pending.next.neutralHoldFramesRemaining).toBe(0);

    state.players.P1.endLag = 0;
    state.players.P2.endLag = 0;
    const active = tickAiController(state, 'P1', pending.next);
    expect(active.next.neutralHoldPending).toBe(false);
    expect(active.next.neutralHoldFramesRemaining).toBeGreaterThan(0);

    const initialRange = tickAiController(
      state,
      'P1',
      createAiController({ seed: 471, profileId: 'cadet', pursuitPolicyId: 'neutral_hold' }),
    );
    expect(initialRange.next.neutralHoldPending).toBe(false);
    expect(initialRange.next.neutralHoldFramesRemaining).toBe(0);
  });

  test('neutral hold does not replace launch chase and legacy pursuit does not pause', () => {
    const chaseState = createInitialState({ seed: 472 });
    chaseState.players.P1.pos = { x: -13, y: 0 };
    chaseState.players.P2.pos = { x: 13, y: 0 };
    chaseState.players.P2.helpless = 1;
    const chase = tickAiController(chaseState, 'P1', {
      ...createAiController({ seed: 472, profileId: 'veteran', pursuitPolicyId: 'neutral_hold' }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    });
    expect(chase.next.neutralHoldPending).toBe(false);
    expect(chase.next.neutralHoldFramesRemaining).toBe(0);
    expect(chase.input.moveX).toBeGreaterThan(0);

    const legacyState = createInitialState({ seed: 473 });
    legacyState.players.P1.pos = { x: -13, y: 0 };
    legacyState.players.P2.pos = { x: 13, y: 0 };
    const legacy = tickAiController(legacyState, 'P1', {
      ...createAiController({ seed: 473, profileId: 'veteran' }),
      wasInPressureBand: true,
      reactionFramesRemaining: 0,
    });
    expect(legacy.next.neutralHoldFramesRemaining).toBe(0);
  });

  test('AI can spend super boost to escape a close control return', () => {
    const state = createInitialState({
      seed: 462,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    let evasiveSamples = 0;

    for (let seed = 1; seed <= 128; seed += 1) {
      const tick = tickAiController(state, 'P1', {
        ...createAiController({ seed, profileId: 'veteran', recoveryPolicyId: 'evasive' }),
        wasHelpless: true,
        reactionFramesRemaining: 0,
      });
      if (!tick.input.superBoost) {
        continue;
      }
      evasiveSamples += 1;
      expect(tick.input.moveX).toBeLessThan(0);
      expect(tick.input.launch).toBe(false);
      expect(tick.input.special).toBe(false);
    }

    expect(evasiveSamples).toBeGreaterThan(0);
    expect(evasiveSamples).toBeLessThan(128);
  });

  test('AI waits for launch-break stun to end before starting its recovery posture', () => {
    const state = createInitialState({ seed: 461 });
    state.players.P1.stunned = 0.1;
    const controller = {
      ...createAiController({ seed: 461, profileId: 'cadet', recoveryPolicyId: 'spacing' }),
      wasHelpless: true,
      reactionFramesRemaining: 0,
    };

    const stunnedTick = tickAiController(state, 'P1', controller);
    expect(stunnedTick.next.wasHelpless).toBe(true);
    expect(stunnedTick.next.postRecoveryFramesRemaining).toBe(0);

    state.players.P1.stunned = 0;
    const recoveredTick = tickAiController(state, 'P1', stunnedTick.next);
    expect(recoveredTick.next.wasHelpless).toBe(false);
    expect(recoveredTick.next.postRecoveryFramesRemaining).toBeGreaterThan(0);
  });

  test('recovery policy rolls do not consume the main decision stream', () => {
    const state = createInitialState({ seed: 463 });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 8, y: 0 };
    const shared = {
      wasHelpless: true,
      reactionFramesRemaining: 100,
      maneuverFramesRemaining: 100,
    };
    const legacy = tickAiController(state, 'P1', {
      ...createAiController({ seed: 463, profileId: 'veteran', recoveryPolicyId: 'legacy' }),
      ...shared,
    });
    const spacing = tickAiController(state, 'P1', {
      ...createAiController({ seed: 463, profileId: 'veteran', recoveryPolicyId: 'spacing' }),
      ...shared,
    });

    expect(spacing.next.rngState).toBe(legacy.next.rngState);
    expect(spacing.next.recoveryRngState).not.toBe(legacy.next.recoveryRngState);
    expect(legacy.next.postRecoveryFramesRemaining).toBe(0);
    expect(spacing.next.postRecoveryFramesRemaining).toBeGreaterThan(0);
  });

  test.each([
    ['helpless', (state: ReturnType<typeof createInitialState>) => {
      state.players.P1.helpless = 1;
      state.players.P1.launchBreaks = 0;
    }],
    ['stunned', (state: ReturnType<typeof createInitialState>) => {
      state.players.P1.stunned = 1;
    }],
    ['recovering', (state: ReturnType<typeof createInitialState>) => {
      state.players.P1.recovering = 1;
    }],
  ] as const)(
    'AI emits no buffered combat or movement requests while %s',
    (_label, applyUnavailableState) => {
      const state = createInitialState({
        seed: 47,
        loadout: { P1: 'duelist', P2: 'vanguard' },
      });
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 7, y: 0 };
      applyUnavailableState(state);
      let controller = {
        ...createAiController({ seed: 47, profileId: 'ace' }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      };

      for (let frame = 0; frame < 120; frame += 1) {
        const tick = tickAiController(state, 'P1', controller);
        controller = tick.next;
        expect({
          launch: tick.input.launch,
          special: tick.input.special,
          dunk: tick.input.dunk,
          parry: tick.input.parry,
          boost: tick.input.boost,
          superBoost: tick.input.superBoost,
          moveX: tick.input.moveX,
          moveY: tick.input.moveY,
        }).toEqual({
          launch: false,
          special: false,
          dunk: false,
          parry: false,
          boost: false,
          superBoost: false,
          moveX: 0,
          moveY: 0,
        });
      }
    },
  );

  test.each(['launchStartup', 'launchActive', 'dunkStartup', 'dunkActive', 'specialStartup', 'specialActive'] as const)(
    'AI does not request a second tactical action during %s',
    (commitment) => {
      const state = createInitialState({
        seed: 48,
        loadout: { P1: 'duelist', P2: 'vanguard' },
      });
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 7, y: 0 };
      state.players.P1[commitment] = 1;
      let controller = {
        ...createAiController({ seed: 48, profileId: 'ace' }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      };

      for (let frame = 0; frame < 120; frame += 1) {
        const tick = tickAiController(state, 'P1', controller);
        controller = tick.next;
        expect(tick.input.launch).toBe(false);
        expect(tick.input.special).toBe(false);
        expect(tick.input.dunk).toBe(false);
        expect(tick.input.parry).toBe(false);
      }
    },
  );

  test('reactive parry overrides rather than colliding with a selected attack', () => {
    const state = createInitialState({
      seed: 49,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    state.players.P1.pos = { x: 0, y: 0 };
    state.players.P2.pos = { x: 6, y: 0 };
    state.players.P2.launchActive = 1;
    let parrySamples = 0;

    for (let seed = 1; seed <= 256; seed += 1) {
      const tick = tickAiController(state, 'P1', {
        ...createAiController({ seed, profileId: 'ace' }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      });
      if (!tick.input.parry) {
        continue;
      }
      parrySamples += 1;
      expect(tick.input.launch).toBe(false);
      expect(tick.input.special).toBe(false);
      expect(tick.input.dunk).toBe(false);
      expect(tick.input.superBoost).toBe(false);
    }

    expect(parrySamples).toBeGreaterThan(0);
  });

  test('AI does not spend parry or Guard on non-parryable movement and dunk commitments', () => {
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
    };
    const movementState = createInitialState({
      seed: 491,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    movementState.players.P1.pos = { x: 0, y: 0 };
    movementState.players.P2.pos = { x: 6, y: 0 };
    movementState.players.P2.specialStartup = 1;

    const dunkState = createInitialState({
      seed: 492,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    dunkState.players.P1.pos = { x: 0, y: 0 };
    dunkState.players.P2.pos = { x: 6, y: 0 };
    dunkState.players.P2.dunkStartup = 1;

    for (let seed = 1; seed <= 256; seed += 1) {
      const movementResponse = tickAiController(movementState, 'P1', {
        ...createAiController({ seed, profileId: 'ace', behaviorTuning }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      });
      expect(movementResponse.input.parry).toBe(false);

      const dunkResponse = tickAiController(dunkState, 'P1', {
        ...createAiController({ seed, profileId: 'ace', behaviorTuning }),
        decisionLockFrames: 0,
        reactionFramesRemaining: 0,
      });
      expect(dunkResponse.input.parry).toBe(false);
    }
  });

  test('AI does not request a launch break after the round has ended', () => {
    const state = createInitialState({ seed: 50 });
    state.winner = 'P1';
    state.players.P2.helpless = 1;
    state.players.P2.launchBreaks = 2;
    state.players.P2.pos = { x: 64, y: 0 };

    const tick = tickAiController(state, 'P2', createAiController({ seed: 50, profileId: 'ace' }));

    expect(tick.input.breakLaunch).toBe(false);
  });

  test('AI respects boost cooldown and super-boost start readiness', () => {
    const cooldownState = createInitialState({ seed: 51 });
    cooldownState.players.P1.pos = { x: -25, y: 0 };
    cooldownState.players.P2.pos = { x: 25, y: 0 };
    cooldownState.players.P1.fuel = cooldownState.players.P1.maxFuel * 0.2;
    cooldownState.players.P1.cool.boost = 1;
    const cooldownTick = tickAiController(
      cooldownState,
      'P1',
      createAiController({ seed: 51, profileId: 'ace' }),
    );
    expect(cooldownTick.input.boost).toBe(false);
    expect(cooldownTick.input.superBoost).toBe(false);

    const endLagState = createInitialState({ seed: 52 });
    endLagState.players.P1.pos = { x: -25, y: 0 };
    endLagState.players.P2.pos = { x: 25, y: 0 };
    endLagState.players.P1.endLag = 1;
    const endLagTick = tickAiController(
      endLagState,
      'P1',
      createAiController({ seed: 52, profileId: 'ace' }),
    );
    expect(endLagTick.input.superBoost).toBe(false);
  });

  test('AI spaces super-boost starts and requires a tactical action after repeated approaches', () => {
    const chaseState = createInitialState({
      seed: 54,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    chaseState.players.P1.pos = { x: -20, y: 0 };
    chaseState.players.P2.pos = { x: 20, y: 0 };
    chaseState.players.P2.helpless = 1.5;
    chaseState.players.P2.fuel = chaseState.players.P2.maxFuel * 0.5;
    const firstStart = tickAiController(
      chaseState,
      'P1',
      createAiController({ seed: 54, profileId: 'cadet' }),
    );

    expect(firstStart.input.superBoost).toBe(true);
    expect(firstStart.next.superBoostStartsSinceTacticalAction).toBe(1);
    expect(firstStart.next.superBoostRecommitFrames).toBeGreaterThan(0);

    const immediateRestart = tickAiController(chaseState, 'P1', firstStart.next);
    expect(immediateRestart.input.superBoost).toBe(false);

    const exhaustedApproachBudget = tickAiController(chaseState, 'P1', {
      ...firstStart.next,
      superBoostRecommitFrames: 0,
      superBoostStartsSinceTacticalAction: 2,
    });
    expect(exhaustedApproachBudget.input.superBoost).toBe(false);

    const attackState = createInitialState({
      seed: 452,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });
    attackState.players.P1.pos = { x: 0, y: 0 };
    attackState.players.P1.fuel = 0;
    attackState.players.P2.pos = { x: 7, y: 0 };
    attackState.players.P2.fuel = 0;
    const tacticalReset = tickAiController(attackState, 'P1', {
      ...createAiController({ seed: 452, profileId: 'veteran' }),
      decisionLockFrames: 0,
      reactionFramesRemaining: 0,
      superBoostStartsSinceTacticalAction: 2,
    });

    expect(tacticalReset.input.launch).toBe(true);
    expect(tacticalReset.next.superBoostStartsSinceTacticalAction).toBe(0);
  });

  test('single-agent stepped simulation does not generate rejected combat-button churn', () => {
    const state = createInitialState({
      seed: 53,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    let controller = createAiController({ seed: 53, profileId: 'veteran' });
    const tracker = createMatchTelemetryTracker(state);
    const idle = createIdleInput();

    for (let frame = 0; frame < 1800; frame += 1) {
      const tick = tickAiController(state, 'P1', controller);
      controller = tick.next;
      const tacticalRequests = [
        tick.input.launch,
        tick.input.special,
        tick.input.dunk,
        tick.input.parry,
      ].filter(Boolean).length;
      expect(tacticalRequests).toBeLessThanOrEqual(1);
      const frameInput = { p1: tick.input, p2: idle };
      const acceptedActionStarts: SimulationActionStart[] = [];
      step(state, frameInput, 1 / 60, {
        onActionStart: (event) => acceptedActionStarts.push(event),
      });
      tracker.recordFrame(frameInput, state, 1 / 60, acceptedActionStarts);
    }

    const player = tracker.toSummary().players.P1;
    expect(player.launchStarts).toBe(player.launchPresses);
    expect(player.specialStarts).toBe(player.specialPresses);
    expect(player.dunkStarts).toBe(player.dunkPresses);
    expect(player.parryStarts).toBe(player.parryPresses);
  });

  test('emits a deterministic designer-facing decision trace with action blockers', () => {
    const state = createInitialState({
      seed: 81,
      loadout: { P1: 'duelist', P2: 'vanguard' },
    });
    state.players.P1.pos = { x: -52, y: 0 };
    state.players.P2.pos = { x: 52, y: 0 };
    const controller = {
      ...createAiController({ seed: 81, profileId: 'veteran' }),
      decisionLockFrames: 0,
      reactionFramesRemaining: 0,
    };

    const first = tickAiController(state, 'P1', controller);
    const second = tickAiController(state, 'P1', controller);

    expect(first.decision).toEqual(second.decision);
    expect(first.decision).toMatchObject({
      schemaVersion: AI_DECISION_TRACE_SCHEMA_VERSION,
      playerId: 'P1',
      profileId: 'veteran',
      movementIntent: 'long_range_approach',
      context: {
        distance: 104,
      },
      gates: {
        hasControl: true,
        canChooseTacticalAction: true,
      },
      candidates: {
        launch: {
          eligible: false,
          reason: 'out_of_range',
        },
      },
    });
  });

  test('explains an urgent launch-break decision near the boundary', () => {
    const state = createInitialState({ seed: 82 });
    state.players.P1.pos = { x: 80, y: 0 };
    state.players.P2.pos = { x: 100, y: 0 };
    state.players.P2.vel = { x: 60, y: 0 };
    state.players.P2.fuel = state.players.P2.maxFuel * 0.1;
    state.players.P2.helpless = 1.5;
    state.players.P2.lastLaunchedBy = 'P1';
    const tick = tickAiController(state, 'P2', {
      ...createAiController({ seed: 82, profileId: 'veteran' }),
      launchBreakPlanned: true,
      launchBreakDelayFramesRemaining: 0,
      reactionFramesRemaining: 0,
    });

    expect(tick.input.breakLaunch).toBe(true);
    expect(tick.decision.selectedAction).toBe('launch_break');
    expect(tick.decision.selectedReason).toBe('urgent_survival_break');
    expect(tick.decision.candidates.launch_break).toMatchObject({
      eligible: true,
      reason: 'ready',
    });
  });
});
