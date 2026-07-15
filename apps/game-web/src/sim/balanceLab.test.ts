import { describe, expect, test } from 'vitest';
import { createMatchTelemetryTracker } from './matchTelemetry';
import {
  BALANCE_LAB_DRAFT_SCHEMA_VERSION,
  BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION,
  aggregateBalanceLabLoopStages,
  buildBalanceLabFlowModel,
  buildBalanceLabFinishOpportunityReviews,
  buildBalanceLabRuleChanges,
  compareBalanceLabFlows,
  compareBalanceLabLoopStages,
  createBalanceLabDraft,
  createBalanceLabExperimentBundle,
  describeBalanceLabReentryContext,
  evaluateBalanceLabSampleStop,
  fingerprintBalanceTuning,
  parseBalanceLabDraft,
  parseFirstStoredBalanceLabDraft,
  resolveBalanceLabControlReturnReviewRange,
  resolveBalanceLabExchangeReviewFrame,
  resolveBalanceLabFinishOpportunityReviewRange,
  resolveBalanceLabReentryReviewRange,
  selectLongestBalanceLabPressureExchange,
  selectMostConstrainedBalanceLabControlReturn,
  selectMissedBalanceLabFinishOpportunity,
  selectLocalAiBehaviorTuning,
  selectLocalAiControllerRoles,
  selectLocalBalanceTuning,
  selectLocalCharacterBalanceOverrides,
  type BalanceLabControlReturnReview,
  type BalanceLabExchangeReview,
  type BalanceLabFinishOpportunityReview,
} from './balanceLab';
import {
  createDefaultAiBehaviorTuning,
  fingerprintAiBehaviorTuning,
} from './ai';
import { createCharacterBalanceConfig } from './characterBalance';
import { createInitialState } from './sim';
import { createDefaultTuning } from './tuning';
import type { GameTuning } from './types';

function createSummaryFixture() {
  const state = createInitialState();
  const summary = createMatchTelemetryTracker(state).toSummary();
  summary.combat.events = [];
  summary.combat.eventCount = 0;
  summary.combat.eventCounts.distance_band_change = 0;
  return summary;
}

function addVariedActionEvents(summary: ReturnType<typeof createSummaryFixture>): void {
  summary.combat.events.push(
    { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 60, timeSeconds: 1, type: 'action_start', actorId: 'P1', action: 'launch' },
    { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 120, timeSeconds: 2, type: 'action_start', actorId: 'P2', action: 'launch' },
    { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 180, timeSeconds: 3, type: 'action_start', actorId: 'P1', action: 'special' },
    { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 240, timeSeconds: 4, type: 'action_start', actorId: 'P2', action: 'special' },
    { schemaVersion: 'gw.combat-events.v2', sequence: 4, frame: 300, timeSeconds: 5, type: 'action_start', actorId: 'P1', action: 'parry' },
    { schemaVersion: 'gw.combat-events.v2', sequence: 5, frame: 360, timeSeconds: 6, type: 'action_start', actorId: 'P2', action: 'parry' },
  );
}

describe('balance lab flow model', () => {
  test('selects the longest pressure exchange and prefers the latest exact tie', () => {
    const exchange = (
      exchangeNumber: number,
      startSeconds: number,
      pressureSeconds: number,
    ): BalanceLabExchangeReview => ({
      exchangeNumber,
      startSeconds,
      endSeconds: startSeconds + Math.max(0, pressureSeconds),
      pressureSeconds,
      openerActorId: null,
      openerAction: null,
      outcomes: [],
      exitBand: null,
      neutralWindowSeconds: 0,
      firstNeutralActionActorId: null,
      firstNeutralAction: null,
      firstNeutralActionDelaySeconds: null,
      carriedReentryCause: null,
      reentryContext: null,
      createdReset: false,
      resolved: false,
      status: 'ongoing',
    });

    const latestTie = exchange(3, 12, 8);
    expect(selectLongestBalanceLabPressureExchange([
      exchange(1, 1, Number.NaN),
      exchange(2, 2, 8),
      latestTie,
      exchange(4, 22, 3),
    ])).toBe(latestTie);
    expect(selectLongestBalanceLabPressureExchange([])).toBeNull();
  });

  test('opens exchange review with readable lead-in and clamps malformed samples', () => {
    expect(resolveBalanceLabExchangeReviewFrame({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, 5)).toBe(255);
    expect(resolveBalanceLabExchangeReviewFrame({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, 0.5)).toBe(0);
    expect(resolveBalanceLabExchangeReviewFrame({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, 12, 0)).toBe(599);
    expect(resolveBalanceLabExchangeReviewFrame({
      framesSimulated: 0,
      elapsedSeconds: 0,
    }, Number.NaN)).toBe(0);
  });

  test('frames a brief-exit re-entry with visible lead-in and aftermath', () => {
    const exchange: BalanceLabExchangeReview = {
      exchangeNumber: 1,
      startSeconds: 1,
      endSeconds: 4,
      pressureSeconds: 3,
      openerActorId: 'P1',
      openerAction: 'launch',
      outcomes: [],
      exitBand: 'mid',
      neutralWindowSeconds: 0.5,
      firstNeutralActionActorId: null,
      firstNeutralAction: null,
      firstNeutralActionDelaySeconds: null,
      carriedReentryCause: 'held_approach',
      reentryContext: null,
      createdReset: false,
      resolved: true,
      status: 'brief_exit',
    };
    expect(resolveBalanceLabReentryReviewRange({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, exchange)).toEqual({
      focusFrame: 240,
      endFrame: 315,
      reentrySeconds: 4.5,
    });
    expect(resolveBalanceLabReentryReviewRange({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, { ...exchange, status: 'reset' })).toBeNull();
    expect(describeBalanceLabReentryContext({
      ...exchange,
      reentryContext: {
        fromBand: 'mid',
        separationSpeed: -12.5,
        players: {
          P1: {
            movementIntent: 'approach',
            moveMagnitude: 1,
            boostHeld: true,
            superBoostHeld: false,
            boostActive: false,
            superBoostActive: false,
            actionRecoveryActive: false,
          },
          P2: {
            movementIntent: 'idle',
            moveMagnitude: 0,
            boostHeld: false,
            superBoostHeld: false,
            boostActive: false,
            superBoostActive: false,
            actionRecoveryActive: true,
          },
        },
      },
    })).toBe(
      'held approach input | closing 12.5 from mid | P1 approach + boost held | P2 idle + action recovery',
    );
    expect(describeBalanceLabReentryContext(exchange)).toBe(
      'held approach input | movement context unavailable',
    );
  });

  test('selects and frames the most constrained post-control sequence', () => {
    const review = (
      overrides: Partial<BalanceLabControlReturnReview>,
    ): BalanceLabControlReturnReview => ({
      playerId: 'P1',
      returnFrame: 240,
      returnSeconds: 4,
      returnKind: 'natural',
      returnDistance: 12,
      startedInPressure: true,
      firstAcceptedAction: 'super_boost',
      firstActionFrame: 252,
      firstActionSeconds: 4.2,
      firstActionDelaySeconds: 0.2,
      firstActionDistance: 12,
      relaunchFrame: 330,
      relaunchSeconds: 5.5,
      controlWindowSeconds: 1.5,
      sustainedResetAfterReturn: false,
      sustainedResetAfterFirstAction: false,
      ...overrides,
    });
    const immediateWithoutAction = review({
      playerId: 'P2',
      firstAcceptedAction: null,
      firstActionFrame: null,
      firstActionSeconds: null,
      firstActionDelaySeconds: null,
      firstActionDistance: null,
      relaunchFrame: 270,
      relaunchSeconds: 4.5,
      controlWindowSeconds: 0.5,
    });
    const selected = selectMostConstrainedBalanceLabControlReturn([
      review({
        startedInPressure: false,
        returnDistance: 40,
        relaunchFrame: null,
        relaunchSeconds: null,
        controlWindowSeconds: null,
        sustainedResetAfterReturn: true,
      }),
      review({}),
      immediateWithoutAction,
    ]);

    expect(selected).toBe(immediateWithoutAction);
    expect(resolveBalanceLabControlReturnReviewRange({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, immediateWithoutAction)).toEqual({
      focusFrame: 210,
      endFrame: 405,
      evidenceEndSeconds: 6,
    });
    expect(resolveBalanceLabControlReturnReviewRange({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, { ...immediateWithoutAction, returnSeconds: Number.NaN })).toBeNull();
    expect(selectMostConstrainedBalanceLabControlReturn([])).toBeNull();
  });

  test('identifies an exact missed empty-fuel finish opportunity', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 600;
    summary.elapsedSeconds = 10;
    summary.combat.events = [
      {
        schemaVersion: 'gw.combat-events.v4',
        sequence: 0,
        frame: 120,
        timeSeconds: 2,
        type: 'launch_hit',
        actorId: 'P1',
        targetId: 'P2',
        targetFuelPercent: 0,
        targetSpeed: 100,
        separationSpeed: 80,
      },
      {
        schemaVersion: 'gw.combat-events.v4',
        sequence: 1,
        frame: 138,
        timeSeconds: 2.3,
        type: 'action_start',
        actorId: 'P1',
        action: 'dunk',
        targetFuelPercent: 0,
      },
      {
        schemaVersion: 'gw.combat-events.v4',
        sequence: 2,
        frame: 300,
        timeSeconds: 5,
        type: 'launch_hit',
        actorId: 'P2',
        targetId: 'P1',
        targetFuelPercent: 0,
        distance: 7,
        targetSpeed: 120,
        separationSpeed: 102,
      },
      {
        schemaVersion: 'gw.combat-events.v4',
        sequence: 3,
        frame: 360,
        timeSeconds: 6,
        type: 'control_return',
        actorId: 'P1',
      },
    ];

    const reviews = buildBalanceLabFinishOpportunityReviews(summary);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].resolutionKind).toBe('dunk_start');
    expect(selectMissedBalanceLabFinishOpportunity(reviews)).toMatchObject({
      attackerId: 'P2',
      targetId: 'P1',
      launchHitSeconds: 5,
      resolutionKind: 'target_control_return',
      opportunityWindowSeconds: 1,
      targetSpeed: 120,
      separationSpeed: 102,
    });
    expect(buildBalanceLabFinishOpportunityReviews(summary, ['P2'])).toHaveLength(1);
  });

  test('does not report a converted empty-fuel finish as missed', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 300;
    summary.elapsedSeconds = 5;
    summary.combat.events = [
      {
        schemaVersion: 'gw.combat-events.v4',
        sequence: 0,
        frame: 120,
        timeSeconds: 2,
        type: 'launch_hit',
        actorId: 'P1',
        targetId: 'P2',
        targetFuelPercent: 0,
      },
      {
        schemaVersion: 'gw.combat-events.v4',
        sequence: 1,
        frame: 150,
        timeSeconds: 2.5,
        type: 'action_start',
        actorId: 'P1',
        action: 'dunk',
        targetFuelPercent: 0,
      },
    ];

    expect(selectMissedBalanceLabFinishOpportunity(
      buildBalanceLabFinishOpportunityReviews(summary),
    )).toBeNull();
  });

  test('prefers a complete, narrow finish miss and breaks exact ties by latest hit', () => {
    const review = (
      overrides: Partial<BalanceLabFinishOpportunityReview>,
    ): BalanceLabFinishOpportunityReview => ({
      attackerId: 'P1',
      targetId: 'P2',
      launchHitSequence: 1,
      launchHitFrame: 120,
      launchHitSeconds: 2,
      launchDistance: 8,
      attackerSpeed: 20,
      targetSpeed: 120,
      separationSpeed: 100,
      resolutionKind: 'target_control_return',
      resolutionFrame: 240,
      resolutionSeconds: 4,
      opportunityWindowSeconds: 2,
      ...overrides,
    });
    const latestNarrowTie = review({
      launchHitSequence: 4,
      launchHitFrame: 360,
      launchHitSeconds: 6,
      resolutionFrame: 420,
      resolutionSeconds: 7,
      opportunityWindowSeconds: 1,
    });

    expect(selectMissedBalanceLabFinishOpportunity([
      review({
        launchHitSequence: 5,
        launchHitSeconds: 9,
        resolutionKind: 'sample_end',
        resolutionSeconds: 9.5,
        opportunityWindowSeconds: 0.5,
      }),
      review({}),
      review({ opportunityWindowSeconds: 1, resolutionSeconds: 3 }),
      latestNarrowTie,
    ])).toBe(latestNarrowTie);
    expect(selectMissedBalanceLabFinishOpportunity([])).toBeNull();
  });

  test('frames a missed finish with lead-in and resolution aftermath', () => {
    const review: BalanceLabFinishOpportunityReview = {
      attackerId: 'P2',
      targetId: 'P1',
      launchHitSequence: 2,
      launchHitFrame: 300,
      launchHitSeconds: 5,
      launchDistance: 7,
      attackerSpeed: 20,
      targetSpeed: 120,
      separationSpeed: 102,
      resolutionKind: 'target_control_return',
      resolutionFrame: 360,
      resolutionSeconds: 6,
      opportunityWindowSeconds: 1,
    };
    expect(resolveBalanceLabFinishOpportunityReviewRange({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, review)).toEqual({
      focusFrame: 270,
      endFrame: 405,
      evidenceEndSeconds: 6,
    });
    expect(resolveBalanceLabFinishOpportunityReviewRange({
      framesSimulated: 600,
      elapsedSeconds: 10,
    }, { ...review, resolutionSeconds: Number.NaN })).toBeNull();
  });

  test('flags contact lock, rejected inputs, and zero-fuel finish stalls', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 3600;
    summary.elapsedSeconds = 60;
    summary.spacing.contactFrames = 1200;
    summary.spacing.contactEpisodeCount = 8;
    summary.spacing.averageContactEpisodeSeconds = 0.6;
    summary.spacing.p90ContactEpisodeSeconds = 1.2;
    summary.spacing.maximumContactEpisodeSeconds = 2.4;
    summary.spacing.pointBlankFrames = 2400;
    summary.spacing.pressureBandFrames = 3300;
    summary.spacing.averageDistance = 8.5;
    summary.players.P1.launchPresses = 100;
    summary.players.P1.acceptedActionStarts = 20;
    summary.players.P1.launchStarts = 20;
    summary.combat.resources.P1.zeroFuelFrames = 1800;
    summary.combat.resources.P2.zeroFuelFrames = 300;

    const model = buildBalanceLabFlowModel(summary);

    expect(model.contactRatio).toBeCloseTo(0.333, 3);
    expect(model.contactEpisodes).toBe(8);
    expect(model.p90ContactEpisodeSeconds).toBe(1.2);
    expect(model.maximumContactEpisodeSeconds).toBe(2.4);
    expect(model.pointBlankRatio).toBeCloseTo(0.667, 3);
    expect(model.pressureBandRatio).toBeCloseTo(0.917, 3);
    expect(model.players.P1.inputAcceptanceRatio).toBe(0.2);
    expect(model.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(expect.arrayContaining([
      'contact_lock',
      'point_blank_lock',
      'pressure_lock',
      'input_churn',
      'zero_fuel_stall',
      'finish_risk',
    ]));
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'contact_lock')?.relatedGlobalTuning)
      .toContain('closeRangeSeparationImpulse');
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'input_churn')?.relatedPlayerIds)
      .toEqual(['P1']);
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'zero_fuel_stall')?.relatedPlayerIds)
      .toEqual(['P1']);
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'finish_risk')?.relatedCharacterControls)
      .toEqual(['launch', 'dunk']);
    expect(model.loopStages.map((stage) => stage.id)).toEqual([
      'neutral',
      'commitment',
      'exchange',
      'separation',
      'chase',
      'finish',
    ]);
    expect(model.loopStages.find((stage) => stage.id === 'commitment')?.status).toBe('blocked');
    expect(model.loopStages.find((stage) => stage.id === 'separation')?.status).toBe('watch');
    expect(model.loopStages.find((stage) => stage.id === 'separation')?.relatedAiBehavior)
      .toContain('neutralHoldFrames');
    expect(model.loopStages.find((stage) => stage.id === 'separation')?.relatedGlobalTuning)
      .toContain('naturalRecoveryResetMultiplier');
    expect(model.loopStages.find((stage) => stage.id === 'finish')?.status).toBe('blocked');
  });

  test('does not mistake spacing during lockout for a shared decision window', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.spacing.contactFrames = 60;
    summary.spacing.pointBlankFrames = 180;
    summary.spacing.pressureBandFrames = 600;
    Object.assign(summary.sharedAgency, {
      controlFrames: 1000,
      controlSeconds: 16.67,
      actionReadyFrames: 900,
      actionReadySeconds: 15,
      contactFrames: 90,
      contactSeconds: 1.5,
      contactEpisodeCount: 3,
      contactEpisodeDurationsSeconds: [0.25, 0.5, 0.75],
      averageContactEpisodeSeconds: 0.5,
      maximumContactEpisodeSeconds: 0.75,
      p90ContactEpisodeSeconds: 0.75,
      pressureFrames: 800,
      pressureSeconds: 13.33,
      neutralFrames: 100,
      neutralSeconds: 1.67,
      neutralEpisodeCount: 10,
      neutralEpisodeDurationsSeconds: Array.from({ length: 10 }, () => 0.167),
      averageNeutralEpisodeSeconds: 0.167,
      maximumNeutralEpisodeSeconds: 0.167,
      p90NeutralEpisodeSeconds: 0.167,
      sustainedNeutralWindowCount: 0,
      sustainedNeutralWindowSeconds: 0,
    });

    const model = buildBalanceLabFlowModel(summary);

    expect(model.sharedAgency).toMatchObject({
      controlRatio: 0.833,
      actionReadyRatio: 0.75,
      actionReadyShareOfControlFrames: 0.9,
      contactRatio: 0.1,
      pressureRatio: 0.889,
      neutralRatio: 0.111,
      sustainedNeutralWindows: 0,
      sustainedWindowThresholdSeconds: 0.75,
    });
    expect(model.diagnostics.find((entry) => entry.id === 'shared_decision_drought')).toMatchObject({
      severity: 'critical',
      title: 'No shared decision window',
    });
    expect(model.loopStages.find((stage) => stage.id === 'neutral')).toMatchObject({
      status: 'blocked',
    });
    expect(model.loopStages.find((stage) => stage.id === 'neutral')?.detail)
      .toContain('both fighters could commit');
  });

  test('flags continuous commitments separately from movement-control loss', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.spacing.pressureBandFrames = 480;
    Object.assign(summary.sharedAgency, {
      controlFrames: 1000,
      controlSeconds: 16.67,
      actionReadyFrames: 40,
      actionReadySeconds: 0.67,
      pressureFrames: 20,
      pressureSeconds: 0.33,
      neutralFrames: 20,
      neutralSeconds: 0.33,
    });
    for (const playerId of ['P1', 'P2'] as const) {
      summary.players[playerId].movementIntent.contestedContactFrames = 200;
      summary.players[playerId].movementIntent.contestedPressureFrames = 900;
    }
    for (let index = 0; index < 12; index += 1) {
      summary.combat.events.push({
        schemaVersion: 'gw.combat-events.v2',
        sequence: index,
        frame: 30 + index * 60,
        timeSeconds: 0.5 + index,
        type: 'action_start',
        actorId: index % 2 === 0 ? 'P1' : 'P2',
        action: index % 3 === 0 ? 'special' : 'launch',
      });
    }

    const model = buildBalanceLabFlowModel(summary);

    expect(model.sharedAgency).toMatchObject({
      controlRatio: 0.833,
      controlContactRatio: 0.2,
      controlPressureRatio: 0.9,
      actionReadyRatio: 0.033,
      actionReadyShareOfControlFrames: 0.04,
    });
    expect(model.diagnostics.find((entry) => entry.id === 'commitment_saturation')).toMatchObject({
      severity: 'critical',
      title: 'Commitments saturate shared pressure',
    });
    expect(model.loopStages.find((stage) => stage.id === 'commitment')).toMatchObject({
      status: 'blocked',
      relatedGlobalTuning: [],
    });
  });

  test('summarises a complete gameplay loop without using matchup win rate', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.spacing.contactFrames = 90;
    summary.spacing.pointBlankFrames = 300;
    summary.spacing.pressureBandFrames = 600;
    summary.spacing.averageDistance = 22;
    Object.assign(summary.players.P1, {
      launchPresses: 1,
      launchStarts: 1,
      launchHits: 1,
      specialPresses: 1,
      specialStarts: 1,
      dunkPresses: 1,
      dunkStarts: 1,
      dunkHits: 1,
      parryPresses: 1,
      parryStarts: 1,
    });
    Object.assign(summary.players.P2, {
      launchPresses: 1,
      launchStarts: 1,
      specialPresses: 1,
      specialStarts: 1,
      parryPresses: 1,
      parryStarts: 1,
    });
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 0, timeSeconds: 0, type: 'distance_band_change', distanceBand: 'long' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 60, timeSeconds: 1, type: 'action_start', actorId: 'P1', action: 'launch' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 120, timeSeconds: 2, type: 'action_start', actorId: 'P2', action: 'special' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 180, timeSeconds: 3, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 4, frame: 240, timeSeconds: 4, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 5, frame: 300, timeSeconds: 5, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 6, frame: 360, timeSeconds: 6, type: 'action_start', actorId: 'P1', action: 'special' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 7, frame: 390, timeSeconds: 6.5, type: 'action_start', actorId: 'P2', action: 'parry' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 8, frame: 420, timeSeconds: 7, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 9, frame: 480, timeSeconds: 8, type: 'special_resolve', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 10, frame: 540, timeSeconds: 9, type: 'distance_band_change', distanceBand: 'long' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 11, frame: 600, timeSeconds: 10, type: 'action_start', actorId: 'P1', action: 'dunk' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 12, frame: 630, timeSeconds: 10.5, type: 'action_start', actorId: 'P2', action: 'launch' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 13, frame: 660, timeSeconds: 11, type: 'dunk_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 14, frame: 720, timeSeconds: 12, type: 'action_start', actorId: 'P1', action: 'parry' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.loopStages.map((stage) => `${stage.id}:${stage.status}`)).toEqual([
      'neutral:observed',
      'commitment:observed',
      'exchange:observed',
      'separation:observed',
      'chase:observed',
      'finish:observed',
    ]);
    expect(model.loopStages.find((stage) => stage.id === 'chase')?.detail)
      .toContain('1 launch hit, 1 dunk start');
    expect(JSON.stringify(model.loopStages).toLowerCase()).not.toContain('win rate');
  });

  test('separates launch-defense reads from their reset conversion', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 720;
    summary.elapsedSeconds = 12;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v4', sequence: 0, frame: 0, timeSeconds: 0, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v4', sequence: 1, frame: 60, timeSeconds: 1, type: 'action_start', actorId: 'P2', action: 'launch', distance: 10 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 2, frame: 64, timeSeconds: 1.067, type: 'action_start', actorId: 'P1', action: 'parry', distance: 10 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 3, frame: 68, timeSeconds: 1.133, type: 'parry_success', actorId: 'P1', targetId: 'P2', distance: 12 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 4, frame: 75, timeSeconds: 1.25, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v4', sequence: 5, frame: 135, timeSeconds: 2.25, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v4', sequence: 6, frame: 180, timeSeconds: 3, type: 'action_start', actorId: 'P1', action: 'special', behaviorId: 'special.block_guard.v1', distance: 11 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 7, frame: 190, timeSeconds: 3.167, type: 'action_start', actorId: 'P2', action: 'launch', distance: 11 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 8, frame: 196, timeSeconds: 3.267, type: 'parry_success', actorId: 'P1', targetId: 'P2', distance: 13 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 9, frame: 240, timeSeconds: 4, type: 'action_start', actorId: 'P2', action: 'launch', distance: 9 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 10, frame: 247, timeSeconds: 4.117, type: 'launch_hit', actorId: 'P2', targetId: 'P1', distance: 8 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 11, frame: 300, timeSeconds: 5, type: 'action_start', actorId: 'P2', action: 'launch', distance: 10 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 12, frame: 300, timeSeconds: 5, type: 'action_start', actorId: 'P1', action: 'launch', distance: 10 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 13, frame: 304, timeSeconds: 5.067, type: 'launch_clash', distance: 18 },
      { schemaVersion: 'gw.combat-events.v4', sequence: 14, frame: 312, timeSeconds: 5.2, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v4', sequence: 15, frame: 372, timeSeconds: 6.2, type: 'distance_band_change', distanceBand: 'pressure' },
    );

    const defense = buildBalanceLabFlowModel(summary).players.P1.launchDefense;

    expect(defense).toMatchObject({
      incomingPressureLaunches: 4,
      preemptiveResponses: 1,
      reactiveResponses: 2,
      parryResponses: 1,
      guardResponses: 1,
      counterLaunchResponses: 1,
      successfulParries: 1,
      successfulGuards: 1,
      unattributedParrySuccesses: 0,
      launchClashes: 1,
      counterLaunchHits: 0,
      launchHits: 1,
      unansweredLaunchHits: 1,
      successfulDefenses: 3,
      sustainedResetsAfterSuccessfulDefense: 2,
    });
    expect(defense.responseCoverageRatio).toBe(0.75);
    expect(defense.averageReactiveResponseSeconds).toBe(0.033);
    expect(defense.successfulDefenseResetRatio).toBeCloseTo(0.667, 3);
  });

  test('flags repeated unanswered pressure launches as a defensive read gap', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 600;
    summary.elapsedSeconds = 10;
    for (let index = 0; index < 4; index += 1) {
      const launchSeconds = 1 + index * 2;
      summary.combat.events.push(
        {
          schemaVersion: 'gw.combat-events.v4',
          sequence: index * 2,
          frame: launchSeconds * 60,
          timeSeconds: launchSeconds,
          type: 'action_start',
          actorId: 'P2',
          action: 'launch',
          distance: 10,
        },
        {
          schemaVersion: 'gw.combat-events.v4',
          sequence: index * 2 + 1,
          frame: launchSeconds * 60 + 7,
          timeSeconds: launchSeconds + 0.117,
          type: 'launch_hit',
          actorId: 'P2',
          targetId: 'P1',
          distance: 8,
        },
      );
    }

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'defensive_read_gap');

    expect(model.players.P1.launchDefense).toMatchObject({
      incomingPressureLaunches: 4,
      reactiveResponses: 0,
      preemptiveResponses: 0,
      launchHits: 4,
      unansweredLaunchHits: 4,
    });
    expect(diagnostic).toMatchObject({
      severity: 'critical',
      relatedPlayerIds: ['P1'],
    });
    expect(diagnostic?.relatedAiBehavior).toContain('postRecoveryThreatParryChance');
    expect(diagnostic?.relatedAiBehavior).toContain('committedLaunchGuardChance');
  });

  test('flags repeated guard spends that do not stop incoming launches', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 600;
    summary.elapsedSeconds = 10;
    for (let index = 0; index < 4; index += 1) {
      const launchSeconds = 1 + index * 2;
      summary.combat.events.push(
        {
          schemaVersion: 'gw.combat-events.v4',
          sequence: index * 3,
          frame: launchSeconds * 60 - 6,
          timeSeconds: launchSeconds - 0.1,
          type: 'action_start',
          actorId: 'P1',
          action: 'special',
          behaviorId: 'special.block_guard.v1',
          distance: 10,
        },
        {
          schemaVersion: 'gw.combat-events.v4',
          sequence: index * 3 + 1,
          frame: launchSeconds * 60,
          timeSeconds: launchSeconds,
          type: 'action_start',
          actorId: 'P2',
          action: 'launch',
          distance: 10,
        },
        {
          schemaVersion: 'gw.combat-events.v4',
          sequence: index * 3 + 2,
          frame: launchSeconds * 60 + 7,
          timeSeconds: launchSeconds + 0.117,
          type: 'launch_hit',
          actorId: 'P2',
          targetId: 'P1',
          distance: 8,
        },
      );
    }

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'ineffective_guard_usage');

    expect(model.players.P1.launchDefense).toMatchObject({
      guardResponses: 4,
      successfulGuards: 0,
      launchHits: 4,
    });
    expect(diagnostic).toMatchObject({
      severity: 'warning',
      relatedPlayerIds: ['P1'],
    });
    expect(diagnostic?.relatedAiBehavior).toContain('committedLaunchGuardChance');
    expect(diagnostic?.relatedCharacterTargets).toContainEqual({
      playerId: 'P1',
      control: 'special',
    });
  });

  test('aggregates loop-stage evidence across rounds without collapsing waiting into failure', () => {
    const waitingSummary = createSummaryFixture();
    const blockedSummary = createSummaryFixture();
    blockedSummary.framesSimulated = 3600;
    blockedSummary.elapsedSeconds = 60;
    blockedSummary.spacing.pressureBandFrames = 3500;
    blockedSummary.combat.resources.P1.zeroFuelFrames = 2400;

    const aggregates = aggregateBalanceLabLoopStages([
      buildBalanceLabFlowModel(waitingSummary),
      buildBalanceLabFlowModel(blockedSummary),
    ]);

    expect(aggregates.commitment).toEqual({
      rounds: 2,
      waitingRounds: 1,
      observedRounds: 0,
      watchRounds: 0,
      blockedRounds: 1,
      waitingRatio: 0.5,
      issueRatio: 0.5,
    });
    expect(aggregates.finish.waitingRounds).toBe(1);
    expect(aggregates.finish.blockedRounds).toBe(1);
  });

  test('separates close-range controller pursuit from mechanical contact lock', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.spacing.pointBlankFrames = 600;
    summary.spacing.pressureBandFrames = 900;
    summary.players.P1.movementIntent = {
      controllableFrames: 1500,
      approachFrames: 650,
      retreatFrames: 100,
      orbitFrames: 650,
      idleFrames: 100,
      contactFrames: 300,
      contactApproachFrames: 150,
      contactRetreatFrames: 15,
      contactOrbitFrames: 120,
      contactIdleFrames: 15,
      contestedContactFrames: 280,
      contestedContactApproachFrames: 140,
      contestedContactRetreatFrames: 14,
      contestedContactOrbitFrames: 112,
      contestedContactIdleFrames: 14,
      pressureFrames: 800,
      pressureApproachFrames: 360,
      pressureRetreatFrames: 40,
      pointBlankFrames: 400,
      pointBlankApproachFrames: 200,
      pointBlankRetreatFrames: 20,
      contestedPressureFrames: 700,
      contestedPressureApproachFrames: 320,
      contestedPressureRetreatFrames: 35,
      contestedPointBlankFrames: 360,
      contestedPointBlankApproachFrames: 180,
      contestedPointBlankRetreatFrames: 18,
    };

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'close_range_pursuit');
    const contactDiagnostic = model.diagnostics.find((entry) => entry.id === 'contact_pursuit');

    expect(model.players.P1.movementIntent.approachRatio).toBeCloseTo(0.433, 3);
    expect(model.players.P1.movementIntent.pointBlankApproachRatio).toBe(0.5);
    expect(model.players.P1.movementIntent.pointBlankRetreatRatio).toBe(0.05);
    expect(model.players.P1.movementIntent.contestedPointBlankApproachRatio).toBe(0.5);
    expect(model.players.P1.movementIntent.contestedContactApproachRatio).toBe(0.5);
    expect(model.players.P1.movementIntent.contestedContactRetreatRatio).toBe(0.05);
    expect(diagnostic).toMatchObject({
      title: 'Point-blank pursuit loop',
      relatedAiBehavior: [
        'engagementDistanceScale',
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'commitmentObserveFrames',
        'commitmentResetFrames',
        'postEventRetreatChanceOffset',
      ],
      relatedCharacterControls: ['movement'],
      relatedPlayerIds: ['P1'],
    });
    expect(diagnostic?.detail).toContain('AI spacing and retreat decisions');
    expect(contactDiagnostic).toMatchObject({
      title: 'Controller sustains body contact',
      relatedCharacterControls: ['movement'],
      relatedPlayerIds: ['P1'],
    });
  });

  test('reports a healthy local heuristic result without claiming the game is balanced', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.spacing.pointBlankFrames = 120;
    summary.spacing.pressureBandFrames = 600;
    summary.players.P1.acceptedActionStarts = 20;
    summary.players.P2.acceptedActionStarts = 20;
    summary.players.P1.launchStarts = 8;
    summary.players.P1.specialStarts = 6;
    summary.players.P1.parryStarts = 6;
    summary.players.P2.launchStarts = 8;
    summary.players.P2.specialStarts = 6;
    summary.players.P2.parryStarts = 6;
    addVariedActionEvents(summary);

    const model = buildBalanceLabFlowModel(summary);

    expect(model.diagnostics).toHaveLength(1);
    expect(model.diagnostics[0].id).toBe('healthy_flow');
    expect(model.diagnostics[0].detail).toContain('before treating this as balanced');
  });

  test('labels a short unfinished run as early evidence instead of healthy flow', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 900;
    summary.elapsedSeconds = 15;
    summary.spacing.pointBlankFrames = 90;
    summary.spacing.pressureBandFrames = 300;
    summary.players.P1.acceptedActionStarts = 12;
    summary.players.P2.acceptedActionStarts = 12;
    summary.players.P1.launchStarts = 4;
    summary.players.P1.specialStarts = 4;
    summary.players.P1.parryStarts = 4;
    summary.players.P2.launchStarts = 4;
    summary.players.P2.specialStarts = 4;
    summary.players.P2.parryStarts = 4;
    addVariedActionEvents(summary);

    const model = buildBalanceLabFlowModel(summary);

    expect(model.diagnostics).toHaveLength(1);
    expect(model.diagnostics[0]).toMatchObject({
      id: 'sample_maturing',
      title: 'Early sample: keep observing',
    });
    expect(model.diagnostics[0].detail).toContain('30s or a round end');
  });

  test('does not report healthy flow when a focused replay has a blocked loop stage', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 720;
    summary.elapsedSeconds = 12;
    summary.players.P1.launchPresses = 1;
    summary.players.P1.launchStarts = 1;
    summary.players.P1.specialPresses = 1;
    summary.players.P1.specialStarts = 1;
    summary.players.P1.parryPresses = 1;
    summary.players.P1.parryStarts = 1;
    summary.players.P2.launchPresses = 1;
    summary.players.P2.launchStarts = 1;
    summary.players.P2.specialPresses = 1;
    summary.players.P2.specialStarts = 1;
    summary.players.P2.parryPresses = 1;
    summary.players.P2.parryStarts = 1;
    summary.players.P1.launchHits = 2;
    summary.players.P1.dunkStarts = 1;
    summary.combat.resources.P2.helplessFrames = 367;
    summary.combat.resources.P2.helplessSeconds = 6.12;
    summary.combat.eventCounts.round_end = 1;
    addVariedActionEvents(summary);

    const model = buildBalanceLabFlowModel(summary);
    const chase = model.loopStages.find((stage) => stage.id === 'chase');

    expect(chase?.status).toBe('blocked');
    expect(model.diagnostics).toHaveLength(1);
    expect(model.diagnostics[0]).toMatchObject({
      id: 'loop_stage_issue',
      severity: 'critical',
      title: 'Gameplay loop stage blocked',
    });
    expect(model.diagnostics[0].detail).toContain('Chase: P2 spent 51%');
    expect(model.diagnostics.map((diagnostic) => diagnostic.id)).not.toContain('healthy_flow');
  });

  test('reconstructs pressure sequences, tactical variety, and the missing finish pipeline', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.spacing.pointBlankFrames = 900;
    summary.spacing.pressureBandFrames = 1500;
    summary.players.P1.acceptedActionStarts = 8;
    summary.players.P1.launchStarts = 8;
    summary.players.P1.launchHits = 3;
    summary.players.P2.acceptedActionStarts = 7;
    summary.players.P2.launchStarts = 3;
    summary.players.P2.specialStarts = 2;
    summary.players.P2.parryStarts = 2;
    summary.players.P2.launchHits = 1;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 1, timeSeconds: 0.02, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 900, timeSeconds: 15, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 1200, timeSeconds: 20, type: 'distance_band_change', distanceBand: 'point_blank' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.pressureEngagements).toBe(2);
    expect(model.neutralResets).toBe(1);
    expect(model.neutralResetsPerMinute).toBe(2);
    expect(model.longestPressureSequenceSeconds).toBe(15);
    expect(model.players.P1.acceptedTacticalActions).toEqual(['launch']);
    expect(model.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(expect.arrayContaining([
      'pressure_sequence',
      'low_action_variety',
      'finish_pipeline_missing',
    ]));
  });

  test('requires a sustained exit from pressure before counting a neutral reset', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 1, timeSeconds: 0.02, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 600, timeSeconds: 10, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 612, timeSeconds: 10.2, type: 'distance_band_change', distanceBand: 'point_blank' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 900, timeSeconds: 15, type: 'distance_band_change', distanceBand: 'long' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.pressureEngagements).toBe(2);
    expect(model.neutralResets).toBe(1);
  });

  test('flags repeated brief exits and pressure phases without outcomes', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    let sequence = 0;
    for (let exchange = 0; exchange < 6; exchange += 1) {
      const pressureAt = exchange * 2;
      const exitAt = pressureAt + 1.5;
      const reengageAt = exitAt + 0.2;
      summary.combat.events.push(
        {
          schemaVersion: 'gw.combat-events.v2',
          sequence: sequence++,
          frame: Math.round(pressureAt * 60),
          timeSeconds: pressureAt,
          type: 'distance_band_change',
          distanceBand: 'pressure',
        },
        {
          schemaVersion: 'gw.combat-events.v2',
          sequence: sequence++,
          frame: Math.round(exitAt * 60),
          timeSeconds: exitAt,
          type: 'distance_band_change',
          distanceBand: 'mid',
        },
        {
          schemaVersion: 'gw.combat-events.v2',
          sequence: sequence++,
          frame: Math.round(reengageAt * 60),
          timeSeconds: reengageAt,
          type: 'distance_band_change',
          distanceBand: 'pressure',
          distanceTransition: {
            fromBand: 'mid',
            separationSpeed: -20,
            players: {
              P1: {
                movementIntent: 'approach',
                moveMagnitude: 1,
                boostHeld: false,
                superBoostHeld: false,
                boostActive: false,
                superBoostActive: false,
                actionRecoveryActive: false,
              },
              P2: {
                movementIntent: 'orbit',
                moveMagnitude: 1,
                boostHeld: false,
                superBoostHeld: false,
                boostActive: false,
                superBoostActive: false,
                actionRecoveryActive: false,
              },
            },
          },
        },
      );
    }

    const model = buildBalanceLabFlowModel(summary);
    const briefExitDiagnostic = model.diagnostics.find((entry) => entry.id === 'brief_exit_loop');
    const unresolvedDiagnostic = model.diagnostics.find(
      (entry) => entry.id === 'unresolved_exchange_loop',
    );

    expect(model.exchanges).toHaveLength(7);
    expect(model.exchanges.filter((exchange) => exchange.status === 'brief_exit')).toHaveLength(6);
    expect(briefExitDiagnostic?.severity).toBe('critical');
    expect(briefExitDiagnostic?.detail).toContain('6 of 7 pressure phases');
    expect(briefExitDiagnostic?.relatedGlobalTuning).toContain('closeRangeSeparationImpulse');
    expect(briefExitDiagnostic?.relatedAiBehavior).toEqual([
      'engagementDistanceScale',
      'neutralApproachScale',
      'neutralBoostDistanceOffset',
      'neutralHoldFrames',
      'neutralHoldDistance',
      'commitmentObserveFrames',
      'commitmentResetFrames',
      'postEventRetreatChanceOffset',
    ]);
    expect(unresolvedDiagnostic?.severity).toBe('critical');
    expect(unresolvedDiagnostic?.detail).toContain('7 of 7 pressure phases');
  });

  test('measures pressure phases and whether clashes or defense create real resets', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 900;
    summary.elapsedSeconds = 15;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 1, timeSeconds: 0.02, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 180, timeSeconds: 3, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 210, timeSeconds: 3.5, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 300, timeSeconds: 5, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 4, frame: 420, timeSeconds: 7, type: 'parry_success', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 5, frame: 570, timeSeconds: 9.5, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 6, frame: 720, timeSeconds: 12, type: 'distance_band_change', distanceBand: 'point_blank' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 7, frame: 780, timeSeconds: 13, type: 'launch_break', actorId: 'P2' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.firstPressureSeconds).toBe(0);
    expect(model.averagePressureSequenceSeconds).toBe(3.67);
    expect(model.p90PressureSequenceSeconds).toBe(4.5);
    expect(model.averageNeutralWindowSeconds).toBe(2);
    expect(model.longestNeutralWindowSeconds).toBe(2.5);
    expect(model.resetOutcomes).toEqual({
      all: { attempts: 3, successes: 1, successRatio: 0.333 },
      clashes: { attempts: 1, successes: 1, successRatio: 1 },
      defense: { attempts: 2, successes: 0, successRatio: 0 },
      parries: { attempts: 1, successes: 0, successRatio: 0 },
      launchBreaks: { attempts: 1, successes: 0, successRatio: 0 },
    });
    expect(model.diagnostics.map((diagnostic) => diagnostic.id)).toContain('failed_reset');
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'failed_reset')).toMatchObject({
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'launchBreakResetMultiplier',
      ],
      relatedCharacterControls: ['parry', 'launch_break'],
    });
  });

  test('treats repeated launch clashes as an exchange loop instead of healthy resolution', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.combat.eventCounts.launch_clash = 6;
    summary.players.P1.clashCount = 6;
    summary.players.P2.clashCount = 6;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 0, timeSeconds: 0, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 120, timeSeconds: 2, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 360, timeSeconds: 6, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 600, timeSeconds: 10, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 4, frame: 840, timeSeconds: 14, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 5, frame: 1080, timeSeconds: 18, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 6, frame: 1320, timeSeconds: 22, type: 'launch_clash' },
    );

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'launch_clash_loop');

    expect(model.launchClashes).toBe(6);
    expect(model.clashesPerMinute).toBe(12);
    expect(diagnostic?.severity).toBe('critical');
    expect(diagnostic?.relatedGlobalTuning).toContain('launchClashRecoilMultiplier');
    expect(model.loopStages.find((stage) => stage.id === 'exchange')).toMatchObject({
      status: 'blocked',
    });
  });

  test('attributes each player first accepted decision after a clash before the next clash', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 600;
    summary.elapsedSeconds = 10;
    summary.combat.eventCounts.launch_clash = 2;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v3', sequence: 0, frame: 0, timeSeconds: 0, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 1, frame: 120, timeSeconds: 2, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 2, frame: 135, timeSeconds: 2.25, type: 'action_start', actorId: 'P1', action: 'launch', distance: 10 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 3, frame: 168, timeSeconds: 2.8, type: 'action_start', actorId: 'P2', action: 'super_boost', distance: 30 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 4, frame: 174, timeSeconds: 2.9, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 5, frame: 192, timeSeconds: 3.2, type: 'action_start', actorId: 'P1', action: 'special', distance: 20 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 6, frame: 258, timeSeconds: 4.3, type: 'action_start', actorId: 'P2', action: 'launch', distance: 18 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 7, frame: 300, timeSeconds: 5, type: 'round_end', actorId: 'P1', targetId: 'P2', outcome: 'win' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 8, frame: 330, timeSeconds: 5.5, type: 'action_start', actorId: 'P1', action: 'dunk', distance: 8 },
    );

    const followUp = buildBalanceLabFlowModel(summary).clashFollowUp;

    expect(followUp.clashes).toBe(2);
    expect(followUp.repeatClashesWithinOneSecond).toBe(1);
    expect(followUp.repeatClashRatio).toBe(1);
    expect(followUp.players.P1).toMatchObject({
      firstActions: 2,
      firstActionsInPressure: 2,
      firstActionsWithinOneSecond: 2,
      rapidLaunchRecommits: 1,
      actionCoverageRatio: 1,
      immediateActionRatio: 1,
      rapidLaunchRecommitRatio: 0.5,
      averageFirstActionDelaySeconds: 0.28,
    });
    expect(followUp.players.P1.firstAcceptedActions.launch).toEqual({
      starts: 1,
      startsInPressure: 1,
      startsWithinOneSecond: 1,
    });
    expect(followUp.players.P1.firstAcceptedActions.special.starts).toBe(1);
    expect(followUp.players.P1.firstAcceptedActions.dunk.starts).toBe(0);
    expect(followUp.players.P2).toMatchObject({
      firstActions: 2,
      firstActionsInPressure: 1,
      firstActionsWithinOneSecond: 1,
      rapidLaunchRecommits: 0,
      actionCoverageRatio: 1,
      immediateActionRatio: 0.5,
      rapidLaunchRecommitRatio: 0,
      averageFirstActionDelaySeconds: 1.1,
    });
  });

  test('measures immediate re-launches after control returns without using win rate', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P1.launchStarts = 3;
    summary.players.P1.launchHits = 3;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v3', sequence: 0, frame: 120, timeSeconds: 2, type: 'control_return', actorId: 'P2', outcome: 'recovery' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 1, frame: 150, timeSeconds: 2.5, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 2, frame: 360, timeSeconds: 6, type: 'control_return', actorId: 'P2', outcome: 'recovery', distance: 26, controlReturnStartDistance: 10 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 3, frame: 372, timeSeconds: 6.2, type: 'action_start', actorId: 'P2', action: 'special', distance: 10 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 4, frame: 408, timeSeconds: 6.8, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 5, frame: 600, timeSeconds: 10, type: 'control_return', actorId: 'P2', action: 'launch_break', outcome: 'recovery' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 6, frame: 654, timeSeconds: 10.9, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 7, frame: 840, timeSeconds: 14, type: 'control_return', actorId: 'P2', outcome: 'recovery', distance: 12 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 8, frame: 846, timeSeconds: 14.1, type: 'action_start', actorId: 'P2', action: 'super_boost', distance: 12 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 9, frame: 852, timeSeconds: 14.2, type: 'distance_band_change', distanceBand: 'mid' },
    );

    const model = buildBalanceLabFlowModel(summary);
    const control = model.players.P2.controlReturn;

    expect(control).toMatchObject({
      controlReturns: 4,
      naturalControlReturns: 3,
      launchBreakControlReturns: 1,
      relaunchesAfterControlReturn: 3,
      relaunchesWithinOneSecond: 3,
      relaunchesWithinTwoSeconds: 3,
      immediateRelaunchRatio: 0.75,
      averageControlWindowSeconds: 0.73,
      minimumControlWindowSeconds: 0.5,
      relaunchesWithAcceptedAction: 1,
      returnsWithAcceptedAction: 2,
      averageFirstActionDelaySeconds: 0.15,
      controlReturnsInPressure: 2,
      sustainedResetsAfterControlReturn: 1,
      controlReturnResetRatio: 0.5,
      firstActionsInPressure: 2,
      sustainedResetsAfterFirstAction: 1,
      postReturnResetRatio: 0.5,
      firstAcceptedActions: {
        boost: { starts: 0, startsInPressure: 0, immediateRelaunches: 0, sustainedResets: 0 },
        super_boost: { starts: 1, startsInPressure: 1, immediateRelaunches: 0, sustainedResets: 1 },
        special: { starts: 1, startsInPressure: 1, immediateRelaunches: 1, sustainedResets: 0 },
        launch: { starts: 0, startsInPressure: 0, immediateRelaunches: 0, sustainedResets: 0 },
        dunk: { starts: 0, startsInPressure: 0, immediateRelaunches: 0, sustainedResets: 0 },
        parry: { starts: 0, startsInPressure: 0, immediateRelaunches: 0, sustainedResets: 0 },
        launch_break: { starts: 0, startsInPressure: 0, immediateRelaunches: 0, sustainedResets: 0 },
      },
    });
    expect(control.reviews).toMatchObject([
      {
        playerId: 'P2',
        returnSeconds: 2,
        returnKind: 'natural',
        returnDistance: null,
        startedInPressure: false,
        firstAcceptedAction: null,
        controlWindowSeconds: 0.5,
        sustainedResetAfterReturn: false,
      },
      {
        playerId: 'P2',
        returnSeconds: 6,
        returnDistance: 10,
        startedInPressure: true,
        firstAcceptedAction: 'special',
        firstActionDelaySeconds: 0.2,
        controlWindowSeconds: 0.8,
        sustainedResetAfterReturn: false,
        sustainedResetAfterFirstAction: false,
      },
      {
        playerId: 'P2',
        returnSeconds: 10,
        returnKind: 'launch_break',
        firstAcceptedAction: null,
        controlWindowSeconds: 0.9,
      },
      {
        playerId: 'P2',
        returnSeconds: 14,
        startedInPressure: true,
        firstAcceptedAction: 'super_boost',
        firstActionDelaySeconds: 0.1,
        controlWindowSeconds: null,
        sustainedResetAfterReturn: true,
        sustainedResetAfterFirstAction: true,
      },
    ]);
    expect(model.diagnostics.find((entry) => entry.id === 'immediate_relaunch_loop')).toMatchObject({
      severity: 'critical',
      relatedPlayerIds: ['P2'],
    });
    expect(model.diagnostics.find((entry) => entry.id === 'immediate_relaunch_loop')?.relatedAiBehavior)
      .toContain('postRecoveryDefenseFrames');
    expect(model.diagnostics.find((entry) => entry.id === 'immediate_relaunch_loop')?.relatedGlobalTuning)
      .toContain('naturalRecoveryResetMultiplier');
    expect(model.loopStages.find((stage) => stage.id === 'chase')).toMatchObject({
      status: 'blocked',
      relatedPlayerIds: ['P2'],
    });
    expect(model.loopStages.find((stage) => stage.id === 'chase')?.relatedAiBehavior)
      .toContain('postRecoveryThreatParryChance');
    expect(model.loopStages.find((stage) => stage.id === 'chase')?.detail)
      .toContain('launched again within 1s');
  });

  test('rejects delayed re-engagement that never creates a post-control reset', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P1.launchStarts = 4;
    summary.players.P1.launchHits = 4;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v3', sequence: 0, frame: 120, timeSeconds: 2, type: 'control_return', actorId: 'P2', outcome: 'recovery', distance: 10 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 1, frame: 132, timeSeconds: 2.2, type: 'action_start', actorId: 'P2', action: 'super_boost', distance: 10 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 2, frame: 204, timeSeconds: 3.4, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 3, frame: 360, timeSeconds: 6, type: 'control_return', actorId: 'P2', outcome: 'recovery', distance: 12 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 4, frame: 372, timeSeconds: 6.2, type: 'action_start', actorId: 'P2', action: 'boost', distance: 12 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 5, frame: 444, timeSeconds: 7.4, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 6, frame: 600, timeSeconds: 10, type: 'control_return', actorId: 'P2', outcome: 'recovery', distance: 14 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 7, frame: 612, timeSeconds: 10.2, type: 'action_start', actorId: 'P2', action: 'special', distance: 14 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 8, frame: 684, timeSeconds: 11.4, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v3', sequence: 9, frame: 840, timeSeconds: 14, type: 'control_return', actorId: 'P2', outcome: 'recovery', distance: 16 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 10, frame: 852, timeSeconds: 14.2, type: 'action_start', actorId: 'P2', action: 'parry', distance: 16 },
      { schemaVersion: 'gw.combat-events.v3', sequence: 11, frame: 924, timeSeconds: 15.4, type: 'launch_hit', actorId: 'P1', targetId: 'P2' },
    );

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => (
      entry.id === 'post_control_reset_failure'
    ));
    const chase = model.loopStages.find((stage) => stage.id === 'chase');

    expect(model.players.P2.controlReturn).toMatchObject({
      controlReturns: 4,
      relaunchesWithinOneSecond: 0,
      controlReturnsInPressure: 4,
      sustainedResetsAfterControlReturn: 0,
      controlReturnResetRatio: 0,
    });
    expect(model.diagnostics.find((entry) => entry.id === 'immediate_relaunch_loop')).toBeUndefined();
    expect(diagnostic).toMatchObject({
      severity: 'critical',
      relatedPlayerIds: ['P2'],
    });
    expect(diagnostic?.relatedAiBehavior).toContain('postRecoverySuperBoostChance');
    expect(diagnostic?.relatedGlobalTuning).toContain('naturalRecoveryResetMultiplier');
    expect(chase?.status).toBe('blocked');
    expect(chase?.relatedPlayerIds).toEqual(['P2']);
    expect(chase?.detail).toContain('only 0/4 returns created a sustained reset');
    expect(chase?.relatedAiBehavior).toContain('postRecoverySpacingFrames');
  });

  test('counts a reset when spacing changes before the outcome event in the same frame', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 180;
    summary.elapsedSeconds = 3;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 0, timeSeconds: 0, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 60, timeSeconds: 1, type: 'distance_band_change', distanceBand: 'mid' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 60, timeSeconds: 1, type: 'parry_success', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 132, timeSeconds: 2.2, type: 'distance_band_change', distanceBand: 'pressure' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.resetOutcomes.parries).toEqual({ attempts: 1, successes: 1, successRatio: 1 });
    expect(model.resetOutcomes.all).toEqual({ attempts: 1, successes: 1, successRatio: 1 });
  });

  test('surfaces prolonged loss of control independently from spacing and win rate', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.combat.resources.P2.helplessFrames = 990;
    summary.combat.resources.P2.helplessSeconds = 16.5;

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'helpless_lock');

    expect(model.players.P2.helplessRatio).toBe(0.55);
    expect(model.players.P2.launchHitsReceived).toBe(0);
    expect(model.players.P2.helplessSecondsPerLaunchReceived).toBeNull();
    expect(diagnostic?.severity).toBe('critical');
    expect(diagnostic?.detail).toContain('P2 spent 55%');
    expect(diagnostic?.relatedCharacterTargets).toEqual([
      { playerId: 'P1', control: 'launch' },
      { playerId: 'P2', control: 'launch_break' },
      { playerId: 'P2', control: 'movement' },
    ]);
    expect(diagnostic?.relatedPlayerIds).toEqual(['P2']);
  });

  test('attributes launch-state pressure to hit frequency before global helpless duration', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.players.P1.launchHits = 10;
    summary.players.P1.dunkStarts = 2;
    summary.combat.resources.P2.helplessFrames = 600;
    summary.combat.resources.P2.helplessSeconds = 10;

    const model = buildBalanceLabFlowModel(summary);
    const chase = model.loopStages.find((stage) => stage.id === 'chase');
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'helpless_lock');

    expect(model.players.P2.launchHitsReceived).toBe(10);
    expect(model.players.P2.helplessSecondsPerLaunchReceived).toBe(1);
    expect(chase?.status).toBe('watch');
    expect(chase?.detail).toContain('10 received launch hits at 1.00s helpless per hit');
    expect(chase?.relatedGlobalTuning).toEqual([]);
    expect(chase?.relatedCharacterTargets?.slice(0, 3)).toEqual([
      { playerId: 'P1', control: 'launch' },
      { playerId: 'P2', control: 'launch_break' },
      { playerId: 'P2', control: 'movement' },
    ]);
    expect(diagnostic?.relatedGlobalTuning).toEqual([]);
  });

  test('does not call an early non-finish chase a blocked dunk pipeline', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 282;
    summary.elapsedSeconds = 4.7;
    summary.players.P1.launchHits = 2;
    summary.players.P2.launchHits = 1;

    const model = buildBalanceLabFlowModel(summary);
    const chase = model.loopStages.find((stage) => stage.id === 'chase');

    expect(chase?.status).toBe('waiting');
    expect(chase?.detail).toContain('early chase evidence');
    expect(chase?.detail).toContain('continue observing');
    expect(chase?.detail).not.toContain('produced no accepted dunk attempt');
  });

  test('still blocks a sustained launch sequence with no accepted dunk attempt', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P1.launchHits = 3;

    const chase = buildBalanceLabFlowModel(summary).loopStages.find(
      (stage) => stage.id === 'chase',
    );

    expect(chase?.status).toBe('blocked');
    expect(chase?.detail).toBe('3 launch hits over 20.0s produced no accepted dunk attempt.');
  });

  test('does not let boost starts hide rejected tactical input churn', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P1.launchPresses = 20;
    summary.players.P1.boostStarts = 20;
    summary.players.P1.acceptedActionStarts = 20;

    const model = buildBalanceLabFlowModel(summary);

    expect(model.players.P1.inputAcceptanceRatio).toBe(0);
    expect(model.diagnostics.map((diagnostic) => diagnostic.id)).toContain('input_churn');
  });

  test('identifies the specific combat action producing rejected-input churn', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P2.specialPresses = 10;
    summary.players.P2.specialStarts = 2;
    summary.players.P2.parryPresses = 4;
    summary.players.P2.parryStarts = 4;

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'input_churn');

    expect(model.players.P2.actionAcceptance.special).toEqual({
      presses: 10,
      starts: 2,
      rejectedPresses: 8,
      acceptanceRatio: 0.2,
    });
    expect(diagnostic?.relatedPlayerIds).toEqual(['P2']);
    expect(model.players.P2.actionAcceptance.parry.acceptanceRatio).toBe(1);
    expect(diagnostic?.detail).toContain('P2 special accepted 2/10 requests (20%)');
    expect(diagnostic?.relatedCharacterControls).toEqual(['special']);
  });

  test('detects dominant repeated actions and measures launch-to-dunk timing', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P1.acceptedActionStarts = 8;
    summary.players.P1.launchStarts = 6;
    summary.players.P1.specialStarts = 1;
    summary.players.P1.dunkStarts = 1;
    for (let index = 0; index < 6; index += 1) {
      summary.combat.events.push({
        schemaVersion: 'gw.combat-events.v2',
        sequence: index,
        frame: 60 + index * 30,
        timeSeconds: 1 + index * 0.5,
        type: 'action_start',
        actorId: 'P1',
        actorCharacterId: 'vanguard',
        action: 'launch',
      });
    }
    summary.combat.events.push(
      {
        schemaVersion: 'gw.combat-events.v2',
        sequence: 6,
        frame: 300,
        timeSeconds: 5,
        type: 'launch_hit',
        actorId: 'P1',
        actorCharacterId: 'vanguard',
        targetId: 'P2',
      },
      {
        schemaVersion: 'gw.combat-events.v2',
        sequence: 7,
        frame: 330,
        timeSeconds: 5.5,
        type: 'action_start',
        actorId: 'P1',
        actorCharacterId: 'vanguard',
        action: 'special',
      },
      {
        schemaVersion: 'gw.combat-events.v2',
        sequence: 8,
        frame: 420,
        timeSeconds: 7,
        type: 'action_start',
        actorId: 'P1',
        actorCharacterId: 'vanguard',
        action: 'dunk',
      },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.players.P1.dominantTacticalAction).toBe('launch');
    expect(model.players.P1.dominantTacticalActionShare).toBe(0.75);
    expect(model.players.P1.longestRepeatedActionStreak).toBe(6);
    expect(model.players.P1.averageLaunchToDunkSeconds).toBe(2);
    expect(model.diagnostics.map((diagnostic) => diagnostic.id)).toContain('repetitive_action_loop');
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'repetitive_action_loop')?.relatedCharacterControls)
      .toEqual(['launch']);
    expect(model.diagnostics.find((diagnostic) => diagnostic.id === 'repetitive_action_loop')?.relatedPlayerIds)
      .toEqual(['P1']);
  });

  test('reports the first accepted dunk attempt for each fighter', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.players.P1.dunkStarts = 1;
    summary.combat.events.push({
      schemaVersion: 'gw.combat-events.v2',
      sequence: 0,
      frame: 720,
      timeSeconds: 12,
      type: 'action_start',
      actorId: 'P1',
      actorCharacterId: 'vanguard',
      action: 'dunk',
    });

    const model = buildBalanceLabFlowModel(summary);

    expect(model.players.P1.firstDunkAttemptSeconds).toBe(12);
    expect(model.players.P2.firstDunkAttemptSeconds).toBeNull();
  });

  test('separates launch-break timing from the zero-fuel finish funnel', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.players.P1.breakPresses = 2;
    summary.players.P1.breakEscapes = 2;
    summary.players.P1.averageBreakReactionSeconds = 0.35;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 300, timeSeconds: 5, type: 'launch_hit', actorId: 'P1', targetId: 'P2', targetFuelPercent: 0 },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 600, timeSeconds: 10, type: 'launch_hit', actorId: 'P1', targetId: 'P2', targetFuelPercent: 0 },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 660, timeSeconds: 11, type: 'action_start', actorId: 'P1', action: 'dunk', targetFuelPercent: 0 },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 690, timeSeconds: 11.5, type: 'dunk_hit', actorId: 'P1', targetId: 'P2', outcome: 'win' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.players.P1.breakEscapesPerMinute).toBe(4);
    expect(model.players.P1.averageBreakReactionSeconds).toBe(0.35);
    expect(model.players.P1.zeroFuelTargetLaunchHits).toBe(2);
    expect(model.players.P1.finishDunkStarts).toBe(1);
    expect(model.players.P1.finishDunkWins).toBe(1);
  });

  test('flags repeated near-instant launch-break spending as an AI flow problem', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1800;
    summary.elapsedSeconds = 30;
    summary.players.P2.breakPresses = 4;
    summary.players.P2.breakEscapes = 4;
    summary.players.P2.averageBreakReactionSeconds = 0.04;

    const model = buildBalanceLabFlowModel(summary);
    const diagnostic = model.diagnostics.find((entry) => entry.id === 'automatic_launch_break');

    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.detail).toContain('P2 used 4 breaks at 0.04s average reaction');
    expect(diagnostic?.relatedCharacterControls).toEqual(['launch_break']);
    expect(diagnostic?.relatedPlayerIds).toEqual(['P2']);

    summary.players.P2.breakEscapes = 2;
    expect(buildBalanceLabFlowModel(summary).diagnostics.map((entry) => entry.id))
      .not.toContain('automatic_launch_break');
  });

  test('compares flow with normalized rates and warns on mismatched sample duration', () => {
    const baseline = buildBalanceLabFlowModel(createSummaryFixture());
    baseline.elapsedSeconds = 30;
    baseline.neutralResets = 3;
    baseline.neutralResetsPerMinute = 6;
    baseline.players.P1.breakEscapes = 2;
    baseline.players.P1.breakEscapesPerMinute = 4;
    baseline.clashesPerMinute = 2;
    baseline.players.P1.acceptedActionsPerMinute = 18;
    baseline.players.P2.acceptedActionsPerMinute = 20;
    baseline.players.P1.averageBreakReactionSeconds = 0.05;
    baseline.players.P1.launchHitsReceived = 3;
    baseline.players.P1.helplessSecondsPerLaunchReceived = 2.5;
    baseline.players.P1.controlReturn.postReturnResetRatio = 0.2;
    baseline.players.P1.controlReturn.controlReturnResetRatio = 0.1;
    baseline.players.P1.controlReturn.averageFirstActionDelaySeconds = 0.3;
    baseline.clashFollowUp.repeatClashRatio = 0.6;
    baseline.clashFollowUp.players.P1.rapidLaunchRecommitRatio = 0.5;
    baseline.clashFollowUp.players.P2.rapidLaunchRecommitRatio = 0.25;
    baseline.clashFollowUp.players.P1.averageFirstActionDelaySeconds = 0.4;
    baseline.clashFollowUp.players.P2.averageFirstActionDelaySeconds = 0.2;
    baseline.players.P1.averageLaunchToDunkSeconds = 2;
    baseline.players.P2.averageLaunchToDunkSeconds = 4;
    baseline.exchanges = [
      {
        exchangeNumber: 1,
        startSeconds: 1,
        endSeconds: 3,
        pressureSeconds: 2,
        openerActorId: 'P1',
        openerAction: 'launch',
        outcomes: [],
        exitBand: 'mid',
        neutralWindowSeconds: 1,
        firstNeutralActionActorId: 'P1',
        firstNeutralAction: 'boost',
        firstNeutralActionDelaySeconds: 0.2,
        carriedReentryCause: null,
        reentryContext: null,
        createdReset: true,
        resolved: true,
        status: 'reset',
      },
      {
        exchangeNumber: 2,
        startSeconds: 5,
        endSeconds: 9,
        pressureSeconds: 4,
        openerActorId: 'P2',
        openerAction: 'special',
        outcomes: [],
        exitBand: null,
        neutralWindowSeconds: 0,
        firstNeutralActionActorId: null,
        firstNeutralAction: null,
        firstNeutralActionDelaySeconds: null,
        carriedReentryCause: null,
        reentryContext: null,
        createdReset: false,
        resolved: false,
        status: 'ongoing',
      },
    ];
    const candidate = structuredClone(baseline);
    candidate.elapsedSeconds = 60;
    candidate.neutralResets = 6;
    candidate.neutralResetsPerMinute = 6;
    candidate.players.P1.breakEscapes = 4;
    candidate.players.P1.breakEscapesPerMinute = 4;
    candidate.clashesPerMinute = 8;
    candidate.players.P1.acceptedActionsPerMinute = 12;
    candidate.players.P2.acceptedActionsPerMinute = 24;
    candidate.players.P1.averageBreakReactionSeconds = 0.35;
    candidate.players.P1.launchHitsReceived = 9;
    candidate.players.P1.helplessSecondsPerLaunchReceived = 1.75;
    candidate.players.P1.controlReturn.postReturnResetRatio = 0.5;
    candidate.players.P1.controlReturn.controlReturnResetRatio = 0.5;
    candidate.players.P1.controlReturn.averageFirstActionDelaySeconds = 0.1;
    candidate.clashFollowUp.repeatClashRatio = 0.3;
    candidate.clashFollowUp.players.P1.rapidLaunchRecommitRatio = 0.2;
    candidate.clashFollowUp.players.P2.rapidLaunchRecommitRatio = 0.5;
    candidate.clashFollowUp.players.P1.averageFirstActionDelaySeconds = 0.1;
    candidate.clashFollowUp.players.P2.averageFirstActionDelaySeconds = 0.35;
    candidate.players.P1.averageLaunchToDunkSeconds = 3;
    candidate.players.P2.averageLaunchToDunkSeconds = 5;
    candidate.exchanges = [
      baseline.exchanges[0],
      {
        ...baseline.exchanges[0],
        exchangeNumber: 2,
        neutralWindowSeconds: 0.2,
        createdReset: false,
        status: 'brief_exit',
      },
      {
        ...baseline.exchanges[0],
        exchangeNumber: 3,
        neutralWindowSeconds: 0.2,
        createdReset: false,
        status: 'brief_exit',
      },
      {
        ...baseline.exchanges[1],
        exchangeNumber: 4,
        pressureSeconds: 2,
      },
    ];

    const comparison = compareBalanceLabFlows(baseline, candidate);

    expect(comparison.sampleDurationRatio).toBe(0.5);
    expect(comparison.sampleDurationComparable).toBe(false);
    expect(comparison.deltas.neutralResetsPerMinute).toBe(0);
    expect(comparison.deltas.launchClashesPerMinute).toBe(6);
    expect(comparison.deltas.repeatClashRatioPoints).toBe(-30);
    expect(comparison.deltas.p1ClashRapidLaunchRecommitRatioPoints).toBe(-30);
    expect(comparison.deltas.p2ClashRapidLaunchRecommitRatioPoints).toBe(25);
    expect(comparison.deltas.p1ClashFirstActionDelaySeconds).toBe(-0.3);
    expect(comparison.deltas.p2ClashFirstActionDelaySeconds).toBe(0.15);
    expect(comparison.deltas.p1BreakEscapesPerMinute).toBe(0);
    expect(comparison.deltas.p1AcceptedActionsPerMinute).toBe(-6);
    expect(comparison.deltas.p2AcceptedActionsPerMinute).toBe(4);
    expect(comparison.deltas.p1BreakReactionSeconds).toBe(0.3);
    expect(comparison.deltas.p1LaunchHitsReceivedPerMinute).toBe(3);
    expect(comparison.deltas.p1HelplessSecondsPerLaunchReceived).toBe(-0.75);
    expect(comparison.deltas.p1PostReturnResetRatioPoints).toBe(30);
    expect(comparison.deltas.p1ControlReturnResetRatioPoints).toBe(40);
    expect(comparison.deltas.p1FirstActionDelaySeconds).toBe(-0.2);
    expect(comparison.deltas.exchangeResolvedRatioPoints).toBe(25);
    expect(comparison.deltas.exchangeResetRatioPoints).toBe(-25);
    expect(comparison.deltas.briefExitRatioPoints).toBe(50);
    expect(comparison.deltas.longestUnresolvedPressureSeconds).toBe(-2);
    expect(comparison.deltas.launchToDunkSeconds).toBe(1);
  });

  test('compares categorical gameplay-loop stages without inventing a directional score', () => {
    const baseline = buildBalanceLabFlowModel(createSummaryFixture());
    const candidate = structuredClone(baseline);
    const setStatus = (
      model: typeof baseline,
      stageId: 'separation' | 'chase' | 'finish',
      status: 'waiting' | 'observed' | 'watch' | 'blocked',
    ): void => {
      const stage = model.loopStages.find((entry) => entry.id === stageId);
      if (!stage) {
        throw new Error(`Missing ${stageId} stage fixture.`);
      }
      stage.status = status;
    };
    setStatus(baseline, 'separation', 'observed');
    setStatus(candidate, 'separation', 'watch');
    setStatus(baseline, 'chase', 'blocked');
    setStatus(candidate, 'chase', 'observed');
    setStatus(baseline, 'finish', 'waiting');
    setStatus(candidate, 'finish', 'observed');

    const comparison = compareBalanceLabLoopStages(baseline, candidate);

    expect(comparison.map((stage) => stage.stageId)).toEqual([
      'neutral',
      'commitment',
      'exchange',
      'separation',
      'chase',
      'finish',
    ]);
    expect(comparison.find((stage) => stage.stageId === 'separation')).toMatchObject({
      statusChanged: true,
      baseline: { status: 'observed' },
      candidate: { status: 'watch' },
    });
    expect(comparison.find((stage) => stage.stageId === 'chase')).toMatchObject({
      statusChanged: true,
      baseline: { status: 'blocked' },
      candidate: { status: 'observed' },
    });
    expect(comparison.find((stage) => stage.stageId === 'finish')).toMatchObject({
      statusChanged: true,
      baseline: { status: 'waiting' },
      candidate: { status: 'observed' },
    });
    expect(comparison.find((stage) => stage.stageId === 'neutral')?.statusChanged).toBe(false);
  });

  test('builds an ordered spacing and combat timeline for manual review', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 1200;
    summary.elapsedSeconds = 20;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 1, timeSeconds: 0.02, type: 'distance_band_change', distanceBand: 'long' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 300, timeSeconds: 5, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 360, timeSeconds: 6, type: 'launch_hit', actorId: 'P1', actorCharacterId: 'vanguard', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 600, timeSeconds: 10, type: 'distance_band_change', distanceBand: 'point_blank' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 4, frame: 720, timeSeconds: 12, type: 'action_start', actorId: 'P2', actorCharacterId: 'duelist', action: 'dunk' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 5, frame: 900, timeSeconds: 15, type: 'distance_band_change', distanceBand: 'mid' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.spacingTimeline).toEqual([
      { band: 'long', startSeconds: 0, endSeconds: 5, durationSeconds: 5 },
      { band: 'pressure', startSeconds: 5, endSeconds: 10, durationSeconds: 5 },
      { band: 'point_blank', startSeconds: 10, endSeconds: 15, durationSeconds: 5 },
      { band: 'mid', startSeconds: 15, endSeconds: 20, durationSeconds: 5 },
    ]);
    expect(model.moments).toMatchObject([
      { timeSeconds: 6, actorId: 'P1', kind: 'launch', category: 'outcome' },
      { timeSeconds: 12, actorId: 'P2', kind: 'dunk', category: 'commitment' },
    ]);
  });

  test('groups pressure into inspectable exchanges with openers, outcomes, and real resets', () => {
    const summary = createSummaryFixture();
    summary.framesSimulated = 600;
    summary.elapsedSeconds = 10;
    summary.combat.events.push(
      { schemaVersion: 'gw.combat-events.v2', sequence: 0, frame: 0, timeSeconds: 0, type: 'distance_band_change', distanceBand: 'long' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 1, frame: 120, timeSeconds: 2, type: 'action_start', actorId: 'P1', action: 'super_boost' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 2, frame: 180, timeSeconds: 3, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 3, frame: 240, timeSeconds: 4, type: 'launch_clash' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 4, frame: 270, timeSeconds: 4.5, type: 'distance_band_change', distanceBand: 'mid' },
      {
        schemaVersion: 'gw.combat-events.v2',
        sequence: 5,
        frame: 294,
        timeSeconds: 4.9,
        type: 'distance_band_change',
        distanceBand: 'point_blank',
        distanceTransition: {
          fromBand: 'mid',
          separationSpeed: -18,
          players: {
            P1: {
              movementIntent: 'approach',
              moveMagnitude: 1,
              boostHeld: true,
              superBoostHeld: false,
              boostActive: true,
              superBoostActive: false,
              actionRecoveryActive: true,
            },
            P2: {
              movementIntent: 'orbit',
              moveMagnitude: 1,
              boostHeld: false,
              superBoostHeld: false,
              boostActive: false,
              superBoostActive: false,
              actionRecoveryActive: false,
            },
          },
        },
      },
      { schemaVersion: 'gw.combat-events.v2', sequence: 6, frame: 294, timeSeconds: 4.9, type: 'action_start', actorId: 'P2', action: 'launch' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 7, frame: 360, timeSeconds: 6, type: 'parry_success', actorId: 'P1', targetId: 'P2' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 8, frame: 390, timeSeconds: 6.5, type: 'distance_band_change', distanceBand: 'long' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 9, frame: 432, timeSeconds: 7.2, type: 'action_start', actorId: 'P2', action: 'boost' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 10, frame: 480, timeSeconds: 8, type: 'distance_band_change', distanceBand: 'pressure' },
      { schemaVersion: 'gw.combat-events.v2', sequence: 11, frame: 492, timeSeconds: 8.2, type: 'action_start', actorId: 'P1', action: 'special' },
    );

    const model = buildBalanceLabFlowModel(summary);

    expect(model.exchanges).toHaveLength(3);
    expect(model.exchanges[0]).toMatchObject({
      exchangeNumber: 1,
      startSeconds: 3,
      endSeconds: 4.5,
      pressureSeconds: 1.5,
      openerActorId: 'P1',
      openerAction: 'super_boost',
      neutralWindowSeconds: 0.4,
      firstNeutralActionActorId: null,
      firstNeutralAction: null,
      firstNeutralActionDelaySeconds: null,
      carriedReentryCause: 'held_boost',
      createdReset: false,
      resolved: true,
      status: 'brief_exit',
    });
    expect(model.exchanges[0].outcomes).toMatchObject([
      { timeSeconds: 4, kind: 'clash', category: 'outcome' },
    ]);
    expect(model.exchanges[1]).toMatchObject({
      exchangeNumber: 2,
      openerActorId: 'P2',
      openerAction: 'launch',
      neutralWindowSeconds: 1.5,
      firstNeutralActionActorId: 'P2',
      firstNeutralAction: 'boost',
      firstNeutralActionDelaySeconds: 0.7,
      carriedReentryCause: null,
      createdReset: true,
      resolved: true,
      status: 'reset',
    });
    expect(model.exchanges[1].outcomes).toMatchObject([
      { timeSeconds: 6, actorId: 'P1', kind: 'parry', category: 'outcome' },
    ]);
    expect(model.exchanges[2]).toMatchObject({
      exchangeNumber: 3,
      startSeconds: 8,
      endSeconds: 10,
      openerActorId: 'P1',
      openerAction: 'special',
      neutralWindowSeconds: 0,
      createdReset: false,
      resolved: false,
      status: 'ongoing',
    });
    expect(model.neutralExitFollowUp).toEqual({
      exits: 2,
      briefExits: 1,
      resetExits: 1,
      firstActions: 1,
      firstActionCoverageRatio: 0.5,
      averageFirstActionDelaySeconds: 0.7,
      briefExitsWithoutAcceptedAction: 1,
      carriedBriefExitRatio: 1,
      carriedBriefExitCauses: {
        held_boost: 1,
        held_approach: 0,
        action_recovery_momentum: 0,
        uncontrolled_momentum: 0,
        residual_velocity: 0,
        unknown: 0,
      },
      playerFirstActions: { P1: 0, P2: 1 },
      firstAcceptedActions: {
        boost: 1,
        super_boost: 0,
        special: 0,
        launch: 0,
        dunk: 0,
        parry: 0,
        launch_break: 0,
      },
    });
  });
});

describe('matched Balance Lab sample', () => {
  test('continues until the exact baseline frame count', () => {
    expect(evaluateBalanceLabSampleStop(1800, 1799, false)).toEqual({
      shouldStop: false,
      reason: null,
      completedFrames: 1799,
      targetFrames: 1800,
      progressRatio: 0.999,
    });
    expect(evaluateBalanceLabSampleStop(1800, 1800, false)).toEqual({
      shouldStop: true,
      reason: 'target_reached',
      completedFrames: 1800,
      targetFrames: 1800,
      progressRatio: 1,
    });
  });

  test('stops on an earlier finish and ignores invalid targets', () => {
    expect(evaluateBalanceLabSampleStop(1800, 900, true)).toEqual({
      shouldStop: true,
      reason: 'round_finished_early',
      completedFrames: 900,
      targetFrames: 1800,
      progressRatio: 0.5,
    });
    expect(evaluateBalanceLabSampleStop(Number.NaN, 120, true)).toEqual({
      shouldStop: false,
      reason: null,
      completedFrames: 120,
      targetFrames: 0,
      progressRatio: 0,
    });
  });
});

describe('Balance Lab experiment change set', () => {
  test('reports only effective global and in-match character rule changes', () => {
    const baselineTuning = createDefaultTuning();
    const candidateTuning = {
      ...baselineTuning,
      closeRangeSeparationImpulse: baselineTuning.closeRangeSeparationImpulse + 5,
    };
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames -= 1;
    const duelist = createCharacterBalanceConfig('duelist');
    duelist.moves.dunk.startupFrames += 4;
    const baselineAi = createDefaultAiBehaviorTuning();
    const candidateAi = { ...baselineAi, engagementDistanceScale: 1.25 };

    expect(buildBalanceLabRuleChanges(
      baselineTuning,
      candidateTuning,
      {},
      { vanguard, duelist },
      ['vanguard'],
      baselineAi,
      candidateAi,
    )).toEqual([
      {
        scope: 'global',
        characterId: null,
        path: 'closeRangeSeparationImpulse',
        baselineValue: baselineTuning.closeRangeSeparationImpulse,
        candidateValue: candidateTuning.closeRangeSeparationImpulse,
        delta: 5,
      },
      {
        scope: 'ai',
        characterId: null,
        path: 'engagementDistanceScale',
        baselineValue: 1,
        candidateValue: 1.25,
        delta: 0.25,
      },
      {
        scope: 'character',
        characterId: 'vanguard',
        path: 'moves.launch.startupFrames',
        baselineValue: vanguard.moves.launch.startupFrames + 1,
        candidateValue: vanguard.moves.launch.startupFrames,
        delta: -1,
      },
    ]);
  });

  test('treats an override equal to package defaults as no rule change', () => {
    const tuning = createDefaultTuning();

    expect(buildBalanceLabRuleChanges(
      tuning,
      { ...tuning },
      {},
      { vanguard: createCharacterBalanceConfig('vanguard') },
      ['vanguard', 'vanguard'],
    )).toEqual([]);
  });

  test('exports exact comparable samples, active rule changes, and flow evidence together', () => {
    const baselineTelemetry = createSummaryFixture();
    baselineTelemetry.framesSimulated = 1800;
    baselineTelemetry.elapsedSeconds = 30;
    const candidateTelemetry = structuredClone(baselineTelemetry);
    candidateTelemetry.spacing.pointBlankFrames = 300;
    const baselineTuning = createDefaultTuning();
    const candidateTuning = {
      ...baselineTuning,
      closeRangeSeparationImpulse: baselineTuning.closeRangeSeparationImpulse + 5,
    };
    const baselineAiBehavior = createDefaultAiBehaviorTuning();
    const candidateAiBehavior = {
      ...baselineAiBehavior,
      neutralHoldFrames: 18,
    };
    const baselineScenario = {
      fingerprint: 'fnv1a32:scenario',
      label: 'cpu_vs_cpu | seed 90210 | veteran | vanguard vs duelist',
      sampleId: 'local-sample-1',
      descriptor: {
        mode: 'cpu_vs_cpu',
        seed: 90210,
        fixedDt: 1 / 60,
        aiDifficulty: 'veteran',
      },
    };

    const bundle = createBalanceLabExperimentBundle({
      exportedAt: '2026-07-13T13:00:00.000Z',
      pendingDraftExcluded: true,
      review: {
        hypothesis: '  More clash separation should create clearer neutral resets.  ',
        baseline: {
          notes: ' Contact returned before I could choose a retreat. ',
          stages: {
            neutral: 'mixed',
            chase: 'blocked',
          },
        },
        candidate: {
          notes: ' The reset survived long enough to reposition. ',
          stages: {
            neutral: 'clear',
            chase: 'mixed',
          },
        },
        observations: ' The candidate produced more readable disengagements. ',
        decision: 'iterate',
      },
      baseline: {
        capturedAt: '2026-07-13T12:58:00.000Z',
        scenario: baselineScenario,
        tuning: baselineTuning,
        characterBalanceOverrides: {},
        aiBehaviorTuning: baselineAiBehavior,
        telemetry: baselineTelemetry,
      },
      candidate: {
        capturedAt: '2026-07-13T12:59:00.000Z',
        scenario: { ...baselineScenario, sampleId: 'local-sample-2' },
        tuning: candidateTuning,
        characterBalanceOverrides: {},
        aiBehaviorTuning: candidateAiBehavior,
        telemetry: candidateTelemetry,
      },
    });

    expect(bundle.schemaVersion).toBe(BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION);
    expect(bundle.status).toBe('comparable');
    expect(bundle.issues).toEqual([]);
    expect(bundle.controls).toEqual({
      sameScenario: true,
      sameCharacterPackages: true,
      independentSamples: true,
      sampleDurationComparable: true,
      pendingDraftExcluded: true,
    });
    expect(bundle.review).toEqual({
      hypothesis: 'More clash separation should create clearer neutral resets.',
      baseline: {
        notes: 'Contact returned before I could choose a retreat.',
        stages: {
          neutral: 'mixed',
          commitment: 'unrated',
          exchange: 'unrated',
          separation: 'unrated',
          chase: 'blocked',
          finish: 'unrated',
        },
      },
      candidate: {
        notes: 'The reset survived long enough to reposition.',
        stages: {
          neutral: 'clear',
          commitment: 'unrated',
          exchange: 'unrated',
          separation: 'unrated',
          chase: 'mixed',
          finish: 'unrated',
        },
      },
      observations: 'The candidate produced more readable disengagements.',
      decision: 'iterate',
    });
    expect(bundle.baseline.scenario?.descriptor.seed).toBe(90210);
    expect(bundle.baseline.telemetry.framesSimulated).toBe(1800);
    expect(bundle.baseline.aiBehaviorFingerprint)
      .toBe(fingerprintAiBehaviorTuning(baselineAiBehavior));
    expect(bundle.candidate.aiBehaviorTuning.neutralHoldFrames).toBe(18);
    expect(bundle.candidate.flow.pointBlankRatio).toBeCloseTo(1 / 6, 3);
    expect(bundle.ruleChanges).toContainEqual({
      scope: 'global',
      characterId: null,
      path: 'closeRangeSeparationImpulse',
      baselineValue: baselineTuning.closeRangeSeparationImpulse,
      candidateValue: candidateTuning.closeRangeSeparationImpulse,
      delta: 5,
    });
    expect(bundle.ruleChanges).toContainEqual({
      scope: 'ai',
      characterId: null,
      path: 'neutralHoldFrames',
      baselineValue: 0,
      candidateValue: 18,
      delta: 18,
    });
  });

  test('defaults invalid or missing human review fields without affecting sample status', () => {
    const telemetry = createSummaryFixture();
    telemetry.framesSimulated = 600;
    telemetry.elapsedSeconds = 10;
    const tuning = createDefaultTuning();
    const scenario = {
      fingerprint: 'fnv1a32:scenario',
      label: 'review defaults',
      sampleId: 'local-sample-1',
      descriptor: { seed: 42 },
    };

    const bundle = createBalanceLabExperimentBundle({
      review: {
        decision: 'invalid' as never,
        baseline: {
          stages: { neutral: 'invalid' as never },
        },
      },
      baseline: {
        capturedAt: '2026-07-13T12:58:00.000Z',
        scenario,
        tuning,
        characterBalanceOverrides: {},
        telemetry,
      },
      candidate: {
        capturedAt: '2026-07-13T12:59:00.000Z',
        scenario: { ...scenario, sampleId: 'local-sample-2' },
        tuning,
        characterBalanceOverrides: {},
        telemetry,
      },
    });

    expect(bundle.status).toBe('comparable');
    expect(bundle.review).toEqual({
      hypothesis: '',
      baseline: {
        notes: '',
        stages: {
          neutral: 'unrated',
          commitment: 'unrated',
          exchange: 'unrated',
          separation: 'unrated',
          chase: 'unrated',
          finish: 'unrated',
        },
      },
      candidate: {
        notes: '',
        stages: {
          neutral: 'unrated',
          commitment: 'unrated',
          exchange: 'unrated',
          separation: 'unrated',
          chase: 'unrated',
          finish: 'unrated',
        },
      },
      observations: '',
      decision: 'undecided',
    });
  });

  test('keeps a self-comparison provisional until a clean restart creates a new sample', () => {
    const telemetry = createSummaryFixture();
    telemetry.framesSimulated = 1800;
    telemetry.elapsedSeconds = 30;
    const tuning = createDefaultTuning();
    const scenario = {
      fingerprint: 'fnv1a32:scenario',
      label: 'same active run',
      sampleId: 'local-sample-1',
      descriptor: { seed: 90210 },
    };
    const sample = {
      capturedAt: '2026-07-13T12:58:00.000Z',
      scenario,
      tuning,
      characterBalanceOverrides: {},
      telemetry,
    };

    const bundle = createBalanceLabExperimentBundle({ baseline: sample, candidate: sample });

    expect(bundle.status).toBe('provisional');
    expect(bundle.issues).toEqual(['same_sample']);
    expect(bundle.controls.independentSamples).toBe(false);
  });

  test('marks scenario, package, and duration drift explicitly', () => {
    const baselineTelemetry = createSummaryFixture();
    baselineTelemetry.framesSimulated = 1800;
    baselineTelemetry.elapsedSeconds = 30;
    const candidateTelemetry = structuredClone(baselineTelemetry);
    candidateTelemetry.framesSimulated = 3600;
    candidateTelemetry.elapsedSeconds = 60;
    candidateTelemetry.characters.P2.packageVersion = 'changed-package';
    const tuning = createDefaultTuning();

    const bundle = createBalanceLabExperimentBundle({
      baseline: {
        capturedAt: '2026-07-13T12:58:00.000Z',
        scenario: {
          fingerprint: 'baseline',
          label: 'baseline',
          sampleId: 'local-sample-1',
          descriptor: { seed: 1 },
        },
        tuning,
        characterBalanceOverrides: {},
        telemetry: baselineTelemetry,
      },
      candidate: {
        capturedAt: '2026-07-13T12:59:00.000Z',
        scenario: {
          fingerprint: 'candidate',
          label: 'candidate',
          sampleId: 'local-sample-2',
          descriptor: { seed: 2 },
        },
        tuning,
        characterBalanceOverrides: {},
        telemetry: candidateTelemetry,
      },
    });

    expect(bundle.status).toBe('invalid');
    expect(bundle.issues).toEqual([
      'scenario_changed',
      'character_package_changed',
      'sample_duration_mismatch',
    ]);
  });
});

describe('balance lab drafts', () => {
  test('fingerprints, serialises, and validates exact local tuning and character rules', () => {
    const tuning = createDefaultTuning();
    tuning.launchBasePower += 4;
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames = 3;
    const aiBehavior = {
      ...createDefaultAiBehaviorTuning(),
      neutralHoldFrames: 24,
    };
    const draft = createBalanceLabDraft(
      'Pacing experiment',
      tuning,
      { vanguard },
      '2026-07-13T12:00:00.000Z',
      aiBehavior,
    );

    expect(draft.schemaVersion).toBe(BALANCE_LAB_DRAFT_SCHEMA_VERSION);
    expect(draft.tuningFingerprint).toBe(fingerprintBalanceTuning(tuning));
    expect(draft.characterBalanceOverrides.vanguard?.moves.launch.startupFrames).toBe(3);
    expect(draft.aiBehaviorFingerprint).toBe(fingerprintAiBehaviorTuning(aiBehavior));
    expect(draft.aiBehaviorTuning.neutralHoldFrames).toBe(24);
    expect(parseBalanceLabDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  test('fills commitment controls when loading a v3 draft with v5 AI tuning', () => {
    const draft = createBalanceLabDraft(
      'Pre-commitment behavior draft',
      createDefaultTuning(),
      {},
      '2026-07-13T12:00:00.000Z',
      { ...createDefaultAiBehaviorTuning(), neutralHoldFrames: 21 },
    );
    const legacyAiBehavior = { ...draft.aiBehaviorTuning } as Record<string, unknown>;
    legacyAiBehavior.schemaVersion = 'gw.ai-behavior-tuning.v5';
    delete legacyAiBehavior.commitmentObserveFrames;
    delete legacyAiBehavior.commitmentPressFrames;
    delete legacyAiBehavior.commitmentResetFrames;
    delete legacyAiBehavior.finishPursuitReachScale;
    delete legacyAiBehavior.postControlSteeringFrames;
    delete legacyAiBehavior.opponentControlReturnObserveFrames;

    const parsed = parseBalanceLabDraft({
      ...draft,
      aiBehaviorTuning: legacyAiBehavior,
    });

    expect(parsed?.aiBehaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      neutralHoldFrames: 21,
      commitmentObserveFrames: 0,
      commitmentPressFrames: 0,
      commitmentResetFrames: 0,
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
    });
  });

  test('preserves legacy finish pursuit when loading a v3 draft with v6 AI tuning', () => {
    const draft = createBalanceLabDraft(
      'Pre-finish-pursuit behavior draft',
      createDefaultTuning(),
      {},
      '2026-07-13T12:00:00.000Z',
      createDefaultAiBehaviorTuning(),
    );
    const previousAiBehavior = { ...draft.aiBehaviorTuning } as Record<string, unknown>;
    previousAiBehavior.schemaVersion = 'gw.ai-behavior-tuning.v6';
    delete previousAiBehavior.finishPursuitReachScale;
    delete previousAiBehavior.postControlSteeringFrames;
    delete previousAiBehavior.opponentControlReturnObserveFrames;

    const parsed = parseBalanceLabDraft({
      ...draft,
      aiBehaviorTuning: previousAiBehavior,
    });

    expect(parsed?.aiBehaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.25,
    });
  });

  test('fills post-control steering when loading a v3 draft with v7 AI tuning', () => {
    const draft = createBalanceLabDraft(
      'Pre-steering behavior draft',
      createDefaultTuning(),
      {},
      '2026-07-13T12:00:00.000Z',
      createDefaultAiBehaviorTuning(),
    );
    const previousAiBehavior = { ...draft.aiBehaviorTuning } as Record<string, unknown>;
    previousAiBehavior.schemaVersion = 'gw.ai-behavior-tuning.v7';
    delete previousAiBehavior.postControlSteeringFrames;
    delete previousAiBehavior.opponentControlReturnObserveFrames;

    const parsed = parseBalanceLabDraft({
      ...draft,
      aiBehaviorTuning: previousAiBehavior,
    });

    expect(parsed?.aiBehaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
    });
  });

  test('fills opponent recovery respect when loading a v3 draft with v8 AI tuning', () => {
    const draft = createBalanceLabDraft(
      'Pre-recovery-respect behavior draft',
      createDefaultTuning(),
      {},
      '2026-07-13T12:00:00.000Z',
      createDefaultAiBehaviorTuning(),
    );
    const previousAiBehavior = { ...draft.aiBehaviorTuning } as Record<string, unknown>;
    previousAiBehavior.schemaVersion = 'gw.ai-behavior-tuning.v8';
    delete previousAiBehavior.opponentControlReturnObserveFrames;

    const parsed = parseBalanceLabDraft({
      ...draft,
      aiBehaviorTuning: previousAiBehavior,
    });

    expect(parsed?.aiBehaviorTuning).toMatchObject({
      schemaVersion: 'gw.ai-behavior-tuning.v9',
      opponentControlReturnObserveFrames: 0,
      postControlSteeringFrames: 0,
      finishPursuitReachScale: 0.7,
    });
  });

  test('migrates tuning-only v1 drafts to empty character overrides', () => {
    const tuning = createDefaultTuning();
    const parsed = parseBalanceLabDraft({
      schemaVersion: 'gw.balance-lab-draft.v1',
      name: 'Old draft',
      savedAt: '2026-07-13T12:00:00.000Z',
      tuningFingerprint: 'ignored',
      tuning,
    });

    expect(parsed?.schemaVersion).toBe(BALANCE_LAB_DRAFT_SCHEMA_VERSION);
    expect(parsed?.characterBalanceOverrides).toEqual({});
    expect(parsed?.aiBehaviorTuning).toEqual(createDefaultAiBehaviorTuning());
  });

  test('fills new flow controls when loading an older v2 draft', () => {
    const tuning = { ...createDefaultTuning() } as Partial<GameTuning>;
    delete tuning.helplessReleaseSpeedRatio;
    delete tuning.actionRecoveryControlMultiplier;
    delete tuning.startupClashGraceSeconds;
    delete tuning.launchClashSeparationPadding;
    delete tuning.launchClashRecoilMultiplier;
    delete tuning.closeRangeSeparationPadding;
    delete tuning.closeRangeSeparationImpulse;
    delete tuning.closeRangeCommitSeparationMultiplier;
    delete tuning.defensiveResetDistance;
    delete tuning.defensiveResetImpulse;
    delete tuning.launchBreakResetMultiplier;
    delete tuning.naturalRecoveryResetMultiplier;

    const parsed = parseBalanceLabDraft({
      schemaVersion: 'gw.balance-lab-draft.v2',
      name: 'Older v2 draft',
      savedAt: '2026-07-13T12:00:00.000Z',
      tuning,
      characterBalanceOverrides: {},
    });

    expect(parsed?.tuning).toEqual(createDefaultTuning());
    expect(parsed?.aiBehaviorTuning).toEqual(createDefaultAiBehaviorTuning());
  });

  test('rejects incomplete or unversioned tuning payloads', () => {
    expect(parseBalanceLabDraft({ tuning: createDefaultTuning() })).toBeNull();
    expect(parseBalanceLabDraft({
      schemaVersion: BALANCE_LAB_DRAFT_SCHEMA_VERSION,
      name: 'Broken',
      tuning: { launchBasePower: 70 },
    })).toBeNull();
  });

  test('falls back to a valid legacy storage value when the current value is malformed', () => {
    const legacyDraft = createBalanceLabDraft(
      'Legacy fallback',
      createDefaultTuning(),
      {},
      '2026-07-13T12:00:00.000Z',
    );

    const parsed = parseFirstStoredBalanceLabDraft('{bad-json', JSON.stringify(legacyDraft));

    expect(parsed).toEqual(legacyDraft);
  });
});

describe('balance lab match isolation', () => {
  test('only supplies staged global tuning to eligible offline modes', () => {
    const configured = createDefaultTuning();
    const draft = { ...configured, launchBasePower: configured.launchBasePower + 10 };

    expect(selectLocalBalanceTuning('training', false, configured, draft).launchBasePower)
      .toBe(draft.launchBasePower);
    expect(selectLocalBalanceTuning('cpu_vs_cpu', false, configured, draft).launchBasePower)
      .toBe(draft.launchBasePower);
    expect(selectLocalBalanceTuning('balance_sparring', false, configured, draft).launchBasePower)
      .toBe(draft.launchBasePower);
    expect(selectLocalBalanceTuning('training', true, configured, draft).launchBasePower)
      .toBe(configured.launchBasePower);
    expect(selectLocalBalanceTuning('online', false, configured, draft).launchBasePower)
      .toBe(configured.launchBasePower);
    expect(selectLocalBalanceTuning('arcade', false, configured, draft).launchBasePower)
      .toBe(configured.launchBasePower);
    expect(selectLocalBalanceTuning('versus', false, configured, draft).launchBasePower)
      .toBe(configured.launchBasePower);
  });

  test('only supplies cloned local character rules to eligible offline modes', () => {
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.stats.moveAccelMultiplier = 1.25;
    const overrides = { vanguard };

    const training = selectLocalCharacterBalanceOverrides('training', false, overrides);
    const cpuVsCpu = selectLocalCharacterBalanceOverrides('cpu_vs_cpu', false, overrides);
    const balanceSparring = selectLocalCharacterBalanceOverrides('balance_sparring', false, overrides);

    expect(training).toEqual(overrides);
    expect(cpuVsCpu).toEqual(overrides);
    expect(balanceSparring).toEqual(overrides);
    expect(balanceSparring).not.toBe(overrides);
    expect(training).not.toBe(overrides);
    expect(selectLocalCharacterBalanceOverrides('training', true, overrides)).toEqual({});
    expect(selectLocalCharacterBalanceOverrides('online', false, overrides)).toEqual({});
    expect(selectLocalCharacterBalanceOverrides('arcade', false, overrides)).toEqual({});
  });

  test('only supplies staged AI behavior to local AI-vs-AI matches', () => {
    const defaults = createDefaultAiBehaviorTuning();
    const draft = { ...defaults, neutralHoldFrames: 30 };

    expect(selectLocalAiBehaviorTuning('cpu_vs_cpu', false, draft)).toEqual(draft);
    expect(selectLocalAiBehaviorTuning('cpu_vs_cpu', false, draft)).not.toBe(draft);
    expect(selectLocalAiBehaviorTuning('balance_sparring', false, draft)).toEqual(draft);
    expect(selectLocalAiBehaviorTuning('balance_sparring', false, draft)).not.toBe(draft);
    expect(selectLocalAiBehaviorTuning('balance_sparring', true, draft)).toEqual(defaults);
    expect(selectLocalAiBehaviorTuning('training', false, draft)).toEqual(defaults);
    expect(selectLocalAiBehaviorTuning('cpu_vs_cpu', true, draft)).toEqual(defaults);
    expect(selectLocalAiBehaviorTuning('arcade', false, draft)).toEqual(defaults);
    expect(selectLocalAiBehaviorTuning('online', false, draft)).toEqual(defaults);
  });

  test('keeps both AI roles for AI-vs-AI and canonicalizes human P1 in Balance Sparring', () => {
    const roles = { P1: 'passive', P2: 'evasive' } as const;

    expect(selectLocalAiControllerRoles('cpu_vs_cpu', false, roles)).toEqual(roles);
    expect(selectLocalAiControllerRoles('balance_sparring', false, roles)).toEqual({
      P1: 'adaptive',
      P2: 'evasive',
    });
    expect(selectLocalAiControllerRoles('balance_sparring', true, roles)).toEqual({
      P1: 'adaptive',
      P2: 'adaptive',
    });
    expect(selectLocalAiControllerRoles('online', false, roles)).toEqual({
      P1: 'adaptive',
      P2: 'adaptive',
    });
  });
});
