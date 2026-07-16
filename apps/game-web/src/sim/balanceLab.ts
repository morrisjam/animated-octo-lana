import {
  MATCH_TELEMETRY_SUSTAINED_DECISION_WINDOW_SECONDS,
  type MatchTelemetryPlayerSummary,
  type MatchTelemetrySummary,
} from './matchTelemetry';
import {
  createDefaultAiBehaviorTuning,
  fingerprintAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
} from './ai';
import type {
  CombatAction,
  CombatDistanceBand,
  CombatDistanceTransitionContext,
  CombatMovementIntent,
  CombatTelemetryEvent,
} from './combatEventTelemetry';
import type { BalanceTestRecipeId } from './balanceTestRecipes';
import {
  cloneCharacterBalanceOverrides,
  fingerprintCharacterBalanceOverrides,
  resolveCharacterBalanceConfig,
  sanitiseCharacterBalanceOverrides,
  type CharacterBalanceOverrides,
} from './characterBalance';
import type { CharacterId } from './characters';
import { fingerprintBalanceTuning } from './balanceLabRuntime';
import { fingerprintDeterministicValue } from './fingerprint';
import { createDefaultTuning, sanitiseTuning } from './tuning';
import type { GameTuning, PlayerId, PlayersById } from './types';

export {
  evaluateBalanceLabSampleStop,
  fingerprintBalanceTuning,
  selectLocalAiBehaviorTuning,
  selectLocalAiControllerRoles,
  selectLocalBalanceTuning,
  selectLocalCharacterBalanceOverrides,
} from './balanceLabRuntime';
export type {
  BalanceLabSampleStopDecision,
  BalanceLabSampleStopReason,
} from './balanceLabRuntime';

const LEGACY_BALANCE_LAB_DRAFT_SCHEMA_VERSION = 'gw.balance-lab-draft.v1';
const PREVIOUS_BALANCE_LAB_DRAFT_SCHEMA_VERSION = 'gw.balance-lab-draft.v2';
export const BALANCE_LAB_DRAFT_SCHEMA_VERSION = 'gw.balance-lab-draft.v3';
export const BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION = 'gw.balance-lab-experiment.v8';

export type BalanceLabDiagnosticSeverity = 'info' | 'warning' | 'critical';
export type BalanceLabAiBehaviorControl = Exclude<keyof AiBehaviorTuning, 'schemaVersion'>;

export type BalanceLabCharacterControlFocus =
  | 'launch'
  | 'dunk'
  | 'parry'
  | 'launch_break'
  | 'special'
  | 'movement';

export interface BalanceLabCharacterControlTarget {
  playerId: PlayerId;
  control: BalanceLabCharacterControlFocus;
}

export interface BalanceLabDiagnostic {
  id: 'contact_lock'
    | 'point_blank_lock'
    | 'launch_clash_loop'
    | 'pressure_lock'
    | 'pressure_sequence'
    | 'shared_decision_drought'
    | 'commitment_saturation'
    | 'close_range_pursuit'
    | 'contact_pursuit'
    | 'failed_reset'
    | 'brief_exit_loop'
    | 'unresolved_exchange_loop'
    | 'automatic_launch_break'
    | 'helpless_lock'
    | 'immediate_relaunch_loop'
    | 'post_control_reset_failure'
    | 'defensive_read_gap'
    | 'ineffective_guard_usage'
    | 'input_churn'
    | 'low_action_variety'
    | 'repetitive_action_loop'
    | 'zero_fuel_stall'
    | 'finish_pipeline_missing'
    | 'finish_risk'
    | 'loop_stage_issue'
    | 'sample_maturing'
    | 'healthy_flow';
  severity: BalanceLabDiagnosticSeverity;
  title: string;
  detail: string;
  relatedGlobalTuning?: readonly (keyof GameTuning)[];
  relatedAiBehavior?: readonly BalanceLabAiBehaviorControl[];
  relatedCharacterControls?: readonly BalanceLabCharacterControlFocus[];
  relatedCharacterTargets?: readonly BalanceLabCharacterControlTarget[];
  relatedPlayerIds?: readonly PlayerId[];
}

export type BalanceLabInputAction = 'launch' | 'special' | 'dunk' | 'parry' | 'launch_break';

export interface BalanceLabActionAcceptance {
  presses: number;
  starts: number;
  rejectedPresses: number;
  acceptanceRatio: number;
}

export interface BalanceLabMovementIntentFlow {
  controllableFrames: number;
  approachRatio: number;
  retreatRatio: number;
  orbitRatio: number;
  idleRatio: number;
  contestedContactFrames: number;
  contestedContactApproachRatio: number;
  contestedContactRetreatRatio: number;
  contestedContactOrbitRatio: number;
  contestedContactIdleRatio: number;
  pressureFrames: number;
  pressureApproachRatio: number;
  pressureRetreatRatio: number;
  pointBlankFrames: number;
  pointBlankApproachRatio: number;
  pointBlankRetreatRatio: number;
  contestedPressureFrames: number;
  contestedPressureApproachRatio: number;
  contestedPressureRetreatRatio: number;
  contestedPointBlankFrames: number;
  contestedPointBlankApproachRatio: number;
  contestedPointBlankRetreatRatio: number;
}

export const BALANCE_LAB_CONTROL_RETURN_ACTIONS = [
  'boost',
  'super_boost',
  'special',
  'launch',
  'dunk',
  'parry',
  'launch_break',
] as const satisfies readonly CombatAction[];

export const BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS = [
  'approach',
  'orbit',
  'retreat',
  'idle',
  'uncontrollable',
  'unavailable',
] as const;
export type BalanceLabPostControlMovementIntent =
  (typeof BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS)[number];

export interface BalanceLabControlReturnActionFlow {
  starts: number;
  startsInPressure: number;
  immediateRelaunches: number;
  sustainedResets: number;
  movementIntents: Record<BalanceLabPostControlMovementIntent, number>;
}

export interface BalanceLabControlReturnReview {
  playerId: PlayerId;
  returnFrame: number;
  returnSeconds: number;
  returnKind: 'natural' | 'launch_break';
  returnDistance: number | null;
  startedInPressure: boolean;
  firstAcceptedAction: CombatAction | null;
  firstActionFrame: number | null;
  firstActionSeconds: number | null;
  firstActionDelaySeconds: number | null;
  firstActionDistance: number | null;
  firstActionMovementIntent: CombatMovementIntent | null;
  relaunchFrame: number | null;
  relaunchSeconds: number | null;
  controlWindowSeconds: number | null;
  sustainedResetAfterReturn: boolean;
  sustainedResetAfterFirstAction: boolean;
}

export interface BalanceLabControlReturnFlow {
  controlReturns: number;
  naturalControlReturns: number;
  launchBreakControlReturns: number;
  relaunchesAfterControlReturn: number;
  relaunchesWithinOneSecond: number;
  relaunchesWithinTwoSeconds: number;
  immediateRelaunchRatio: number;
  averageControlWindowSeconds: number | null;
  minimumControlWindowSeconds: number | null;
  relaunchesWithAcceptedAction: number;
  returnsWithAcceptedAction: number;
  averageFirstActionDelaySeconds: number | null;
  controlReturnsInPressure: number;
  sustainedResetsAfterControlReturn: number;
  controlReturnResetRatio: number;
  firstActionsInPressure: number;
  sustainedResetsAfterFirstAction: number;
  postReturnResetRatio: number;
  firstAcceptedActions: Record<CombatAction, BalanceLabControlReturnActionFlow>;
  reviews: BalanceLabControlReturnReview[];
}

export interface BalanceLabLaunchDefenseFlow {
  incomingPressureLaunches: number;
  preemptiveResponses: number;
  reactiveResponses: number;
  responseCoverageRatio: number;
  parryResponses: number;
  guardResponses: number;
  counterLaunchResponses: number;
  successfulParries: number;
  successfulGuards: number;
  unattributedParrySuccesses: number;
  launchClashes: number;
  counterLaunchHits: number;
  launchHits: number;
  unansweredLaunchHits: number;
  whiffsOrUnresolved: number;
  averageReactiveResponseSeconds: number | null;
  successfulDefenses: number;
  sustainedResetsAfterSuccessfulDefense: number;
  successfulDefenseResetRatio: number;
}

export interface BalanceLabClashFollowUpActionFlow {
  starts: number;
  startsInPressure: number;
  startsWithinOneSecond: number;
}

export interface BalanceLabClashFollowUpPlayerFlow {
  firstActions: number;
  firstActionsInPressure: number;
  firstActionsWithinOneSecond: number;
  rapidLaunchRecommits: number;
  actionCoverageRatio: number;
  immediateActionRatio: number;
  rapidLaunchRecommitRatio: number;
  averageFirstActionDelaySeconds: number | null;
  firstAcceptedActions: Record<CombatAction, BalanceLabClashFollowUpActionFlow>;
}

export interface BalanceLabClashFollowUpFlow {
  clashes: number;
  repeatClashesWithinOneSecond: number;
  repeatClashRatio: number;
  players: PlayersById<BalanceLabClashFollowUpPlayerFlow>;
}

export interface BalanceLabPlayerFlow {
  acceptedActionsPerMinute: number;
  inputAcceptanceRatio: number;
  actionAcceptance: Record<BalanceLabInputAction, BalanceLabActionAcceptance>;
  launchConversionRate: number;
  dunkConversionRate: number;
  zeroFuelRatio: number;
  helplessRatio: number;
  launchHitsReceived: number;
  helplessSecondsPerLaunchReceived: number | null;
  controlReturn: BalanceLabControlReturnFlow;
  launchDefense: BalanceLabLaunchDefenseFlow;
  specialStartsPerMinute: number;
  dunkStartsPerMinute: number;
  breakEscapes: number;
  breakEscapesPerMinute: number;
  averageBreakReactionSeconds: number;
  zeroFuelTargetLaunchHits: number;
  finishDunkStarts: number;
  finishDunkWins: number;
  acceptedTacticalActions: CombatAction[];
  tacticalActionStarts: number;
  dominantTacticalAction: CombatAction | null;
  dominantTacticalActionShare: number;
  tacticalActionEntropy: number;
  longestRepeatedAction: CombatAction | null;
  longestRepeatedActionStreak: number;
  averageLaunchToDunkSeconds: number | null;
  firstDunkAttemptSeconds: number | null;
  movementIntent: BalanceLabMovementIntentFlow;
}

export interface BalanceLabSpacingSegment {
  band: CombatDistanceBand;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export type BalanceLabFlowMomentCategory = 'commitment' | 'transition' | 'outcome' | 'finish';

export interface BalanceLabFlowMoment {
  timeSeconds: number;
  actorId: PlayerId | null;
  kind: 'launch' | 'clash' | 'special' | 'parry' | 'break' | 'control' | 'dunk' | 'projectile' | 'finish';
  category: BalanceLabFlowMomentCategory;
  label: string;
}

export type BalanceLabExchangeStatus = 'ongoing' | 'brief_exit' | 'reset' | 'finished';

export const BALANCE_LAB_CARRIED_REENTRY_CAUSES = [
  'held_boost',
  'held_approach',
  'action_recovery_momentum',
  'uncontrolled_momentum',
  'residual_velocity',
  'unknown',
] as const;
export type BalanceLabCarriedReentryCause = (typeof BALANCE_LAB_CARRIED_REENTRY_CAUSES)[number];
export const BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS: Record<BalanceLabCarriedReentryCause, string> = {
  held_boost: 'active or held boost',
  held_approach: 'held approach input',
  action_recovery_momentum: 'action-recovery momentum',
  uncontrolled_momentum: 'uncontrolled launch momentum',
  residual_velocity: 'residual closing velocity',
  unknown: 'unattributed carry',
};

export interface BalanceLabExchangeReview {
  exchangeNumber: number;
  startSeconds: number;
  endSeconds: number;
  pressureSeconds: number;
  openerActorId: PlayerId | null;
  openerAction: CombatAction | null;
  outcomes: BalanceLabFlowMoment[];
  exitBand: CombatDistanceBand | null;
  neutralWindowSeconds: number;
  firstNeutralActionActorId: PlayerId | null;
  firstNeutralAction: CombatAction | null;
  firstNeutralActionDelaySeconds: number | null;
  carriedReentryCause: BalanceLabCarriedReentryCause | null;
  reentryContext: CombatDistanceTransitionContext | null;
  createdReset: boolean;
  resolved: boolean;
  status: BalanceLabExchangeStatus;
}

export const BALANCE_LAB_EXCHANGE_REVIEW_LEAD_SECONDS = 0.75;

export function resolveBalanceLabExchangeReviewFrame(
  summary: Pick<MatchTelemetrySummary, 'framesSimulated' | 'elapsedSeconds'>,
  exchangeStartSeconds: number,
  leadSeconds = BALANCE_LAB_EXCHANGE_REVIEW_LEAD_SECONDS,
): number {
  if (
    !Number.isFinite(summary.framesSimulated)
    || !Number.isFinite(summary.elapsedSeconds)
    || summary.framesSimulated <= 0
    || summary.elapsedSeconds <= 0
  ) {
    return 0;
  }
  const frameSeconds = summary.elapsedSeconds / summary.framesSimulated;
  if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) {
    return 0;
  }
  const safeStartSeconds = Number.isFinite(exchangeStartSeconds)
    ? Math.max(0, exchangeStartSeconds)
    : 0;
  const safeLeadSeconds = Number.isFinite(leadSeconds) ? Math.max(0, leadSeconds) : 0;
  const frame = Math.floor(Math.max(0, safeStartSeconds - safeLeadSeconds) / frameSeconds);
  return Math.max(0, Math.min(Math.floor(summary.framesSimulated) - 1, frame));
}

export function selectLongestBalanceLabPressureExchange(
  exchanges: readonly BalanceLabExchangeReview[],
): BalanceLabExchangeReview | null {
  let selected: BalanceLabExchangeReview | null = null;
  for (const exchange of exchanges) {
    if (!Number.isFinite(exchange.pressureSeconds) || exchange.pressureSeconds < 0) {
      continue;
    }
    if (
      selected === null
      || exchange.pressureSeconds > selected.pressureSeconds
      || (
        exchange.pressureSeconds === selected.pressureSeconds
        && exchange.startSeconds > selected.startSeconds
      )
    ) {
      selected = exchange;
    }
  }
  return selected;
}

export interface BalanceLabReentryReviewRange {
  focusFrame: number;
  endFrame: number;
  reentrySeconds: number;
}

export function describeBalanceLabReentryContext(
  exchange: BalanceLabExchangeReview,
): string {
  const cause = exchange.carriedReentryCause
    ? BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[exchange.carriedReentryCause]
    : 'unattributed carry';
  const context = exchange.reentryContext;
  if (!context) {
    return `${cause} | movement context unavailable`;
  }
  const direction = context.separationSpeed < 0
    ? `closing ${Math.abs(context.separationSpeed).toFixed(1)}`
    : `separating ${context.separationSpeed.toFixed(1)}`;
  const describePlayer = (playerId: PlayerId): string => {
    const player = context.players[playerId];
    const flags = [
      player.superBoostActive
        ? 'super boost active'
        : player.superBoostHeld
          ? 'super boost held'
          : null,
      player.boostActive
        ? 'boost active'
        : player.boostHeld
          ? 'boost held'
          : null,
      player.actionRecoveryActive ? 'action recovery' : null,
    ].filter((value): value is string => value !== null);
    return `${playerId} ${player.movementIntent.replace(/_/g, ' ')}${
      flags.length > 0 ? ` + ${flags.join(' + ')}` : ''
    }`;
  };
  return `${cause} | ${direction} from ${context.fromBand.replace(/_/g, ' ')} | ${
    describePlayer('P1')
  } | ${describePlayer('P2')}`;
}

export function resolveBalanceLabReentryReviewRange(
  summary: Pick<MatchTelemetrySummary, 'framesSimulated' | 'elapsedSeconds'>,
  exchange: BalanceLabExchangeReview,
  leadSeconds = 0.5,
  tailSeconds = 0.75,
): BalanceLabReentryReviewRange | null {
  if (
    exchange.status !== 'brief_exit'
    || !Number.isFinite(exchange.endSeconds)
    || !Number.isFinite(exchange.neutralWindowSeconds)
  ) {
    return null;
  }
  const reentrySeconds = Math.max(0, exchange.endSeconds + exchange.neutralWindowSeconds);
  const focusFrame = resolveBalanceLabExchangeReviewFrame(summary, reentrySeconds, leadSeconds);
  const endFrame = resolveBalanceLabExchangeReviewFrame(
    summary,
    reentrySeconds + Math.max(0, tailSeconds),
    0,
  );
  return {
    focusFrame,
    endFrame: Math.max(focusFrame, endFrame),
    reentrySeconds,
  };
}

export function selectMostConstrainedBalanceLabControlReturn(
  reviews: readonly BalanceLabControlReturnReview[],
): BalanceLabControlReturnReview | null {
  const rank = (review: BalanceLabControlReturnReview): number => (
    (review.relaunchFrame !== null ? 32 : 0)
    + (review.startedInPressure ? 16 : 0)
    + (!review.sustainedResetAfterReturn ? 8 : 0)
    + (review.controlWindowSeconds !== null && review.controlWindowSeconds <= 1.001 ? 4 : 0)
    + (review.firstAcceptedAction === null ? 2 : 0)
  );
  let selected: BalanceLabControlReturnReview | null = null;
  for (const review of reviews) {
    if (
      !Number.isFinite(review.returnSeconds)
      || review.returnSeconds < 0
      || (!review.startedInPressure && review.relaunchFrame === null)
    ) {
      continue;
    }
    if (!selected) {
      selected = review;
      continue;
    }
    const reviewRank = rank(review);
    const selectedRank = rank(selected);
    const reviewWindow = review.controlWindowSeconds ?? Number.POSITIVE_INFINITY;
    const selectedWindow = selected.controlWindowSeconds ?? Number.POSITIVE_INFINITY;
    if (
      reviewRank > selectedRank
      || (reviewRank === selectedRank && reviewWindow < selectedWindow)
      || (
        reviewRank === selectedRank
        && reviewWindow === selectedWindow
        && review.returnSeconds > selected.returnSeconds
      )
    ) {
      selected = review;
    }
  }
  return selected;
}

export interface BalanceLabControlReturnReviewRange {
  focusFrame: number;
  endFrame: number;
  evidenceEndSeconds: number;
}

export function resolveBalanceLabControlReturnReviewRange(
  summary: Pick<MatchTelemetrySummary, 'framesSimulated' | 'elapsedSeconds'>,
  review: BalanceLabControlReturnReview,
  leadSeconds = 0.5,
  tailSeconds = 0.75,
): BalanceLabControlReturnReviewRange | null {
  if (!Number.isFinite(review.returnSeconds) || review.returnSeconds < 0) {
    return null;
  }
  const evidenceEndSeconds = Math.max(
    review.returnSeconds + 2,
    review.firstActionSeconds ?? review.returnSeconds,
    review.relaunchSeconds ?? review.returnSeconds,
  );
  const focusFrame = resolveBalanceLabExchangeReviewFrame(
    summary,
    review.returnSeconds,
    Math.max(0, leadSeconds),
  );
  const endFrame = resolveBalanceLabExchangeReviewFrame(
    summary,
    evidenceEndSeconds + Math.max(0, tailSeconds),
    0,
  );
  return {
    focusFrame,
    endFrame: Math.max(focusFrame, endFrame),
    evidenceEndSeconds,
  };
}

export const BALANCE_LAB_FINISH_OPPORTUNITY_RESOLUTIONS = [
  'dunk_start',
  'target_control_return',
  'attacker_recommit',
  'round_end',
  'sample_end',
] as const;

export type BalanceLabFinishOpportunityResolution =
  (typeof BALANCE_LAB_FINISH_OPPORTUNITY_RESOLUTIONS)[number];

export interface BalanceLabFinishOpportunityReview {
  attackerId: PlayerId;
  targetId: PlayerId;
  launchHitSequence: number;
  launchHitFrame: number;
  launchHitSeconds: number;
  launchDistance: number | null;
  attackerSpeed: number | null;
  targetSpeed: number | null;
  separationSpeed: number | null;
  resolutionKind: BalanceLabFinishOpportunityResolution;
  resolutionFrame: number;
  resolutionSeconds: number;
  opportunityWindowSeconds: number;
}

export function buildBalanceLabFinishOpportunityReviews(
  summary: MatchTelemetrySummary,
  targetPlayerIds: readonly PlayerId[] = [],
): BalanceLabFinishOpportunityReview[] {
  const targetFilter = targetPlayerIds.length > 0 ? new Set(targetPlayerIds) : null;
  const events = [...summary.combat.events].sort((first, second) => (
    first.timeSeconds - second.timeSeconds || first.sequence - second.sequence
  ));
  const sampleEndFrame = Number.isFinite(summary.framesSimulated)
    ? Math.max(0, Math.floor(summary.framesSimulated) - 1)
    : 0;
  const sampleEndSeconds = Number.isFinite(summary.elapsedSeconds)
    ? Math.max(0, summary.elapsedSeconds)
    : 0;
  const reviews: BalanceLabFinishOpportunityReview[] = [];

  for (let hitIndex = 0; hitIndex < events.length; hitIndex += 1) {
    const launchHit = events[hitIndex];
    if (
      launchHit.type !== 'launch_hit'
      || !launchHit.actorId
      || !launchHit.targetId
      || (launchHit.targetFuelPercent ?? 1) > 0.001
      || (targetFilter && !targetFilter.has(launchHit.targetId))
      || !Number.isFinite(launchHit.timeSeconds)
      || launchHit.timeSeconds < 0
    ) {
      continue;
    }

    let resolutionEvent: CombatTelemetryEvent | null = null;
    let resolutionKind: BalanceLabFinishOpportunityResolution = 'sample_end';
    for (const event of events.slice(hitIndex + 1)) {
      if (
        event.type === 'action_start'
        && event.actorId === launchHit.actorId
        && event.action === 'dunk'
        && (event.targetFuelPercent ?? 1) <= 0.001
      ) {
        resolutionEvent = event;
        resolutionKind = 'dunk_start';
        break;
      }
      if (event.type === 'control_return' && event.actorId === launchHit.targetId) {
        resolutionEvent = event;
        resolutionKind = 'target_control_return';
        break;
      }
      if (
        event.type === 'action_start'
        && event.actorId === launchHit.actorId
        && event.action === 'launch'
      ) {
        resolutionEvent = event;
        resolutionKind = 'attacker_recommit';
        break;
      }
      if (event.type === 'round_end') {
        resolutionEvent = event;
        resolutionKind = 'round_end';
        break;
      }
    }

    const resolutionSeconds = Math.max(
      launchHit.timeSeconds,
      resolutionEvent?.timeSeconds ?? sampleEndSeconds,
    );
    reviews.push({
      attackerId: launchHit.actorId,
      targetId: launchHit.targetId,
      launchHitSequence: launchHit.sequence,
      launchHitFrame: launchHit.frame,
      launchHitSeconds: launchHit.timeSeconds,
      launchDistance: launchHit.distance ?? null,
      attackerSpeed: launchHit.actorSpeed ?? null,
      targetSpeed: launchHit.targetSpeed ?? null,
      separationSpeed: launchHit.separationSpeed ?? null,
      resolutionKind,
      resolutionFrame: resolutionEvent?.frame ?? sampleEndFrame,
      resolutionSeconds,
      opportunityWindowSeconds: roundMetric(resolutionSeconds - launchHit.timeSeconds, 2),
    });
  }

  return reviews;
}

export function selectMissedBalanceLabFinishOpportunity(
  reviews: readonly BalanceLabFinishOpportunityReview[],
): BalanceLabFinishOpportunityReview | null {
  let selected: BalanceLabFinishOpportunityReview | null = null;
  for (const review of reviews) {
    if (
      review.resolutionKind === 'dunk_start'
      || !Number.isFinite(review.launchHitSeconds)
      || !Number.isFinite(review.opportunityWindowSeconds)
      || review.launchHitSeconds < 0
      || review.opportunityWindowSeconds < 0
    ) {
      continue;
    }
    if (!selected) {
      selected = review;
      continue;
    }
    const reviewIsComplete = review.resolutionKind !== 'sample_end';
    const selectedIsComplete = selected.resolutionKind !== 'sample_end';
    if (
      (reviewIsComplete && !selectedIsComplete)
      || (
        reviewIsComplete === selectedIsComplete
        && review.opportunityWindowSeconds < selected.opportunityWindowSeconds
      )
      || (
        reviewIsComplete === selectedIsComplete
        && review.opportunityWindowSeconds === selected.opportunityWindowSeconds
        && review.launchHitSeconds > selected.launchHitSeconds
      )
      || (
        reviewIsComplete === selectedIsComplete
        && review.opportunityWindowSeconds === selected.opportunityWindowSeconds
        && review.launchHitSeconds === selected.launchHitSeconds
        && review.launchHitSequence > selected.launchHitSequence
      )
    ) {
      selected = review;
    }
  }
  return selected;
}

export interface BalanceLabFinishOpportunityReviewRange {
  focusFrame: number;
  endFrame: number;
  evidenceEndSeconds: number;
}

export function resolveBalanceLabFinishOpportunityReviewRange(
  summary: Pick<MatchTelemetrySummary, 'framesSimulated' | 'elapsedSeconds'>,
  review: BalanceLabFinishOpportunityReview,
  leadSeconds = 0.5,
  tailSeconds = 0.75,
): BalanceLabFinishOpportunityReviewRange | null {
  if (
    !Number.isFinite(review.launchHitSeconds)
    || !Number.isFinite(review.resolutionSeconds)
    || review.launchHitSeconds < 0
    || review.resolutionSeconds < review.launchHitSeconds
  ) {
    return null;
  }
  const evidenceEndSeconds = review.resolutionSeconds;
  const focusFrame = resolveBalanceLabExchangeReviewFrame(
    summary,
    review.launchHitSeconds,
    Math.max(0, leadSeconds),
  );
  const endFrame = resolveBalanceLabExchangeReviewFrame(
    summary,
    evidenceEndSeconds + Math.max(0, tailSeconds),
    0,
  );
  return {
    focusFrame,
    endFrame: Math.max(focusFrame, endFrame),
    evidenceEndSeconds,
  };
}

export interface BalanceLabNeutralExitFollowUp {
  exits: number;
  briefExits: number;
  resetExits: number;
  firstActions: number;
  firstActionCoverageRatio: number;
  averageFirstActionDelaySeconds: number | null;
  briefExitsWithoutAcceptedAction: number;
  carriedBriefExitRatio: number;
  carriedBriefExitCauses: Record<BalanceLabCarriedReentryCause, number>;
  playerFirstActions: PlayersById<number>;
  firstAcceptedActions: Record<CombatAction, number>;
}

export interface BalanceLabResetOutcome {
  attempts: number;
  successes: number;
  successRatio: number;
}

export interface BalanceLabResetOutcomes {
  all: BalanceLabResetOutcome;
  clashes: BalanceLabResetOutcome;
  defense: BalanceLabResetOutcome;
  parries: BalanceLabResetOutcome;
  launchBreaks: BalanceLabResetOutcome;
}

export const BALANCE_LAB_LOOP_STAGE_IDS = [
  'neutral',
  'commitment',
  'exchange',
  'separation',
  'chase',
  'finish',
] as const;

export type BalanceLabLoopStageId = typeof BALANCE_LAB_LOOP_STAGE_IDS[number];

export type BalanceLabLoopStageStatus = 'waiting' | 'observed' | 'watch' | 'blocked';

export interface BalanceLabLoopStage {
  id: BalanceLabLoopStageId;
  label: string;
  status: BalanceLabLoopStageStatus;
  detail: string;
  relatedGlobalTuning?: readonly (keyof GameTuning)[];
  relatedAiBehavior?: readonly BalanceLabAiBehaviorControl[];
  relatedCharacterControls?: readonly BalanceLabCharacterControlFocus[];
  relatedCharacterTargets?: readonly BalanceLabCharacterControlTarget[];
  relatedPlayerIds?: readonly PlayerId[];
}

export interface BalanceLabLoopStageComparison {
  stageId: BalanceLabLoopStageId;
  label: string;
  baseline: BalanceLabLoopStage;
  candidate: BalanceLabLoopStage;
  statusChanged: boolean;
}

export interface BalanceLabLoopStageAggregate {
  rounds: number;
  waitingRounds: number;
  observedRounds: number;
  watchRounds: number;
  blockedRounds: number;
  waitingRatio: number;
  issueRatio: number;
}

export type BalanceLabLoopStageAggregates = Record<
  BalanceLabLoopStageId,
  BalanceLabLoopStageAggregate
>;

export interface BalanceLabSharedAgencyFlow {
  controlFrames: number;
  controlSeconds: number;
  controlRatio: number;
  controlContactFrames: number;
  controlContactRatio: number;
  controlPressureFrames: number;
  controlPressureRatio: number;
  actionReadyFrames: number;
  actionReadySeconds: number;
  actionReadyRatio: number;
  actionReadyShareOfControlFrames: number;
  contactFrames: number;
  contactRatio: number;
  contactEpisodes: number;
  p90ContactEpisodeSeconds: number;
  maximumContactEpisodeSeconds: number;
  pressureFrames: number;
  pressureRatio: number;
  neutralFrames: number;
  neutralRatio: number;
  neutralEpisodes: number;
  averageNeutralEpisodeSeconds: number;
  p90NeutralEpisodeSeconds: number;
  maximumNeutralEpisodeSeconds: number;
  sustainedNeutralWindowSeconds: number;
  sustainedNeutralWindows: number;
  sustainedWindowThresholdSeconds: number;
}

export interface BalanceLabFlowModel {
  elapsedSeconds: number;
  averageDistance: number;
  contactRatio: number;
  contactEpisodes: number;
  averageContactEpisodeSeconds: number;
  p90ContactEpisodeSeconds: number;
  maximumContactEpisodeSeconds: number;
  pointBlankRatio: number;
  pressureBandRatio: number;
  sharedAgency: BalanceLabSharedAgencyFlow;
  launchClashes: number;
  clashesPerMinute: number;
  clashFollowUp: BalanceLabClashFollowUpFlow;
  pressureEngagements: number;
  firstPressureSeconds: number | null;
  neutralResets: number;
  neutralResetsPerMinute: number;
  averagePressureSequenceSeconds: number;
  p90PressureSequenceSeconds: number;
  longestPressureSequenceSeconds: number;
  averageNeutralWindowSeconds: number;
  longestNeutralWindowSeconds: number;
  resetOutcomes: BalanceLabResetOutcomes;
  neutralExitFollowUp: BalanceLabNeutralExitFollowUp;
  roundFinished: boolean;
  spacingTimeline: BalanceLabSpacingSegment[];
  moments: BalanceLabFlowMoment[];
  exchanges: BalanceLabExchangeReview[];
  players: PlayersById<BalanceLabPlayerFlow>;
  diagnostics: BalanceLabDiagnostic[];
  loopStages: BalanceLabLoopStage[];
}

export type BalanceLabFightStoryStatus = 'maturing' | 'progressing' | 'watch' | 'blocked';

export interface BalanceLabFightStory {
  status: BalanceLabFightStoryStatus;
  headline: string;
  overview: string;
  finding: string;
  focusStageId: BalanceLabLoopStageId | null;
  suggestedRecipeId: BalanceTestRecipeId | null;
  suggestedReason: string | null;
}

type BalanceLabFightStorySource = Pick<
  BalanceLabFlowModel,
  | 'elapsedSeconds'
  | 'contactRatio'
  | 'pressureBandRatio'
  | 'launchClashes'
  | 'neutralResets'
  | 'sharedAgency'
  | 'exchanges'
  | 'loopStages'
>;

const FIGHT_STORY_PROBE_BY_STAGE: Record<
  BalanceLabLoopStageId,
  { recipeId: BalanceTestRecipeId; reason: string }
> = {
  neutral: {
    recipeId: 'pursuit_vs_escape',
    reason: 'Separate pursuit and retreat decisions from the noise of a full mirror match.',
  },
  commitment: {
    recipeId: 'commitment_vs_defense',
    reason: 'Check whether an authored commitment can be read and answered before changing move strength.',
  },
  exchange: {
    recipeId: 'offense_vs_passive',
    reason: 'Check whether accepted offense creates a readable outcome when defender behavior is held constant.',
  },
  separation: {
    recipeId: 'commitment_vs_defense',
    reason: 'Check whether a successful defense creates a fresh decision instead of immediate contact.',
  },
  chase: {
    recipeId: 'post_control_agency',
    reason: 'Start at control return and judge whether the defender gets one visible decision before re-launch.',
  },
  finish: {
    recipeId: 'zero_fuel_finish',
    reason: 'Isolate the launch-to-dunk path without waiting for a full round to create the opportunity.',
  },
};

export function buildBalanceLabFightStory(
  flow: BalanceLabFightStorySource,
): BalanceLabFightStory {
  const exchangeCount = flow.exchanges.length;
  const resolvedExchanges = flow.exchanges.filter((exchange) => exchange.resolved).length;
  const resetExchanges = flow.exchanges.filter((exchange) => exchange.createdReset).length;
  const sharedWindowSummary = `${flow.sharedAgency.sustainedNeutralWindows} shared decision window${flow.sharedAgency.sustainedNeutralWindows === 1 ? '' : 's'} lasted at least ${flow.sharedAgency.sustainedWindowThresholdSeconds.toFixed(2)}s`;
  const overview = exchangeCount > 0
    ? `${resolvedExchanges} of ${exchangeCount} exchanges produced a concrete outcome; ${resetExchanges} created a sustained spacing reset, and ${sharedWindowSummary}. The fighters spent ${Math.round(flow.pressureBandRatio * 100)}% of the sample in pressure and ${Math.round(flow.contactRatio * 100)}% physically overlapping.`
    : `No pressure exchange has completed yet; ${sharedWindowSummary}. The fighters spent ${Math.round(flow.pressureBandRatio * 100)}% of the sample in pressure and ${Math.round(flow.contactRatio * 100)}% physically overlapping.`;

  if (flow.elapsedSeconds < 10) {
    return {
      status: 'maturing',
      headline: 'This sample is still forming',
      overview,
      finding: 'Keep the same seed running for at least ten seconds before choosing a mechanic to inspect.',
      focusStageId: null,
      suggestedRecipeId: null,
      suggestedReason: null,
    };
  }

  const focusStage = flow.loopStages.find((stage) => stage.status === 'blocked')
    ?? flow.loopStages.find((stage) => stage.status === 'watch')
    ?? null;
  if (!focusStage) {
    return {
      status: 'progressing',
      headline: 'The observed loop is progressing',
      overview,
      finding: flow.sharedAgency.sustainedNeutralWindows > 0
        ? `${flow.sharedAgency.sustainedNeutralWindows} shared action-ready windows created measurable new decisions. Review the longest exchange before changing a rule.`
        : flow.neutralResets > 0
          ? `${flow.neutralResets} spacing resets occurred, but none yet proves a shared action-ready decision window. Review the longest exchange before changing a rule.`
        : 'No known loop failure is visible yet. Keep watching the same seed or review the longest exchange before changing a rule.',
      focusStageId: null,
      suggestedRecipeId: null,
      suggestedReason: null,
    };
  }

  const defaultProbe = FIGHT_STORY_PROBE_BY_STAGE[focusStage.id];
  const probe = focusStage.id === 'separation' && flow.launchClashes > 0
    ? {
        recipeId: 'post_clash_reset' as const,
        reason: 'Start in deterministic clash recoil and judge whether separation survives the next decision.',
      }
    : defaultProbe;
  return {
    status: focusStage.status === 'blocked' ? 'blocked' : 'watch',
    headline: `${focusStage.label} is ${focusStage.status}`,
    overview,
    finding: focusStage.detail,
    focusStageId: focusStage.id,
    suggestedRecipeId: probe.recipeId,
    suggestedReason: probe.reason,
  };
}

export interface BalanceLabFlowComparison {
  sampleDurationRatio: number;
  sampleDurationComparable: boolean;
  deltas: {
    contactRatioPoints: number;
    sharedControlRatioPoints: number;
    sharedControlContactRatioPoints: number;
    sharedControlPressureRatioPoints: number;
    sharedActionReadyRatioPoints: number;
    sharedActionReadyShareOfControlPoints: number;
    sharedContactRatioPoints: number;
    sharedPressureRatioPoints: number;
    sharedNeutralRatioPoints: number;
    sharedSustainedNeutralWindows: number;
    sharedP90NeutralEpisodeSeconds: number;
    sharedMaximumContactEpisodeSeconds: number;
    p90ContactEpisodeSeconds: number;
    maximumContactEpisodeSeconds: number;
    pointBlankRatioPoints: number;
    pressureBandRatioPoints: number;
    launchClashesPerMinute: number;
    repeatClashRatioPoints: number;
    p1ClashRapidLaunchRecommitRatioPoints: number;
    p2ClashRapidLaunchRecommitRatioPoints: number;
    p1ClashFirstActionDelaySeconds: number | null;
    p2ClashFirstActionDelaySeconds: number | null;
    neutralResetsPerMinute: number;
    resetConversionRatioPoints: number;
    exchangeResolvedRatioPoints: number;
    exchangeResetRatioPoints: number;
    briefExitRatioPoints: number;
    carriedBriefExitRatioPoints: number;
    neutralFirstActionDelaySeconds: number | null;
    p90PressureSequenceSeconds: number;
    longestUnresolvedPressureSeconds: number;
    p1BreakEscapesPerMinute: number;
    p2BreakEscapesPerMinute: number;
    p1AcceptedActionsPerMinute: number;
    p2AcceptedActionsPerMinute: number;
    p1BreakReactionSeconds: number;
    p2BreakReactionSeconds: number;
    p1HelplessRatioPoints: number;
    p2HelplessRatioPoints: number;
    p1LaunchHitsReceivedPerMinute: number;
    p2LaunchHitsReceivedPerMinute: number;
    p1HelplessSecondsPerLaunchReceived: number | null;
    p2HelplessSecondsPerLaunchReceived: number | null;
    p1ImmediateRelaunchRatioPoints: number;
    p2ImmediateRelaunchRatioPoints: number;
    p1AverageControlWindowSeconds: number | null;
    p2AverageControlWindowSeconds: number | null;
    p1PostReturnResetRatioPoints: number;
    p2PostReturnResetRatioPoints: number;
    p1ControlReturnResetRatioPoints: number;
    p2ControlReturnResetRatioPoints: number;
    p1FirstActionDelaySeconds: number | null;
    p2FirstActionDelaySeconds: number | null;
    p1ZeroFuelRatioPoints: number;
    p2ZeroFuelRatioPoints: number;
    p1PointBlankApproachRatioPoints: number;
    p2PointBlankApproachRatioPoints: number;
    p1PressureRetreatRatioPoints: number;
    p2PressureRetreatRatioPoints: number;
    dominantTacticalActionSharePoints: number;
    repeatedTacticalActionStreak: number;
    launchToDunkSeconds: number | null;
  };
}

export interface BalanceLabRuleChange {
  scope: 'global' | 'character' | 'ai';
  characterId: CharacterId | null;
  path: string;
  baselineValue: number;
  candidateValue: number;
  delta: number;
}

export interface BalanceLabDraft {
  schemaVersion: typeof BALANCE_LAB_DRAFT_SCHEMA_VERSION;
  name: string;
  savedAt: string;
  tuningFingerprint: string;
  tuning: GameTuning;
  characterBalanceFingerprint: string;
  characterBalanceOverrides: CharacterBalanceOverrides;
  aiBehaviorFingerprint: string;
  aiBehaviorTuning: AiBehaviorTuning;
}

export interface BalanceLabScenarioIdentity {
  fingerprint: string;
  label: string;
  sampleId: string;
  descriptor: Record<string, unknown>;
}

export interface BalanceLabExperimentSampleInput {
  capturedAt: string;
  scenario: BalanceLabScenarioIdentity | null;
  tuning: GameTuning;
  characterBalanceOverrides: CharacterBalanceOverrides;
  aiBehaviorTuning?: AiBehaviorTuning;
  telemetry: MatchTelemetrySummary;
}

export interface BalanceLabExperimentSample extends BalanceLabExperimentSampleInput {
  aiBehaviorTuning: AiBehaviorTuning;
  tuningFingerprint: string;
  characterBalanceFingerprint: string;
  aiBehaviorFingerprint: string;
  flow: BalanceLabFlowModel;
}

export type BalanceLabExperimentIssue =
  | 'scenario_changed'
  | 'character_package_changed'
  | 'same_sample'
  | 'sample_duration_mismatch';

export type BalanceLabExperimentDecision = 'undecided' | 'keep' | 'revert' | 'iterate';

export const BALANCE_LAB_PLAYTEST_VERDICT_IDS = [
  'unrated',
  'clear',
  'mixed',
  'blocked',
] as const;

export type BalanceLabPlaytestVerdict = typeof BALANCE_LAB_PLAYTEST_VERDICT_IDS[number];

export interface BalanceLabPlaytestSampleReview {
  notes: string;
  stages: Record<BalanceLabLoopStageId, BalanceLabPlaytestVerdict>;
}

export interface BalanceLabExperimentReview {
  hypothesis: string;
  baseline: BalanceLabPlaytestSampleReview;
  candidate: BalanceLabPlaytestSampleReview;
  observations: string;
  decision: BalanceLabExperimentDecision;
}

export interface BalanceLabExperimentReviewInput {
  hypothesis?: string;
  baseline?: {
    notes?: string;
    stages?: Partial<Record<BalanceLabLoopStageId, BalanceLabPlaytestVerdict>>;
  };
  candidate?: {
    notes?: string;
    stages?: Partial<Record<BalanceLabLoopStageId, BalanceLabPlaytestVerdict>>;
  };
  observations?: string;
  decision?: BalanceLabExperimentDecision;
}

export interface BalanceLabExperimentBundle {
  schemaVersion: typeof BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION;
  exportedAt: string;
  purpose: 'flow_first_manual_balance_review';
  interpretation: string;
  status: 'comparable' | 'provisional' | 'invalid';
  issues: BalanceLabExperimentIssue[];
  controls: {
    sameScenario: boolean;
    sameCharacterPackages: boolean;
    independentSamples: boolean;
    sampleDurationComparable: boolean;
    pendingDraftExcluded: boolean;
  };
  review: BalanceLabExperimentReview;
  baseline: BalanceLabExperimentSample;
  candidate: BalanceLabExperimentSample;
  ruleChanges: BalanceLabRuleChange[];
  comparison: BalanceLabFlowComparison;
}

export interface CreateBalanceLabExperimentOptions {
  exportedAt?: string;
  pendingDraftExcluded?: boolean;
  review?: BalanceLabExperimentReviewInput;
  baseline: BalanceLabExperimentSampleInput;
  candidate: BalanceLabExperimentSampleInput;
}

function normalisePlaytestSampleReview(
  review: BalanceLabExperimentReviewInput['baseline'] | undefined,
): BalanceLabPlaytestSampleReview {
  const stages = Object.fromEntries(BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
    const verdict = review?.stages?.[stageId];
    return [
      stageId,
      BALANCE_LAB_PLAYTEST_VERDICT_IDS.includes(verdict ?? 'unrated')
        ? verdict ?? 'unrated'
        : 'unrated',
    ];
  })) as Record<BalanceLabLoopStageId, BalanceLabPlaytestVerdict>;
  return {
    notes: String(review?.notes ?? '').trim().slice(0, 2_000),
    stages,
  };
}

function normaliseExperimentReview(
  review: BalanceLabExperimentReviewInput | undefined,
): BalanceLabExperimentReview {
  const decision = review?.decision;
  return {
    hypothesis: String(review?.hypothesis ?? '').trim().slice(0, 1_200),
    baseline: normalisePlaytestSampleReview(review?.baseline),
    candidate: normalisePlaytestSampleReview(review?.candidate),
    observations: String(review?.observations ?? '').trim().slice(0, 3_000),
    decision: decision === 'keep' || decision === 'revert' || decision === 'iterate'
      ? decision
      : 'undecided',
  };
}

function roundMetric(value: number, precision = 3): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function collectNumericRuleValues(
  value: unknown,
  prefix = '',
  output = new Map<string, number>(),
): Map<string, number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return output;
  }
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    collectNumericRuleValues(
      (value as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
      output,
    );
  }
  return output;
}

function appendNumericRuleChanges(
  changes: BalanceLabRuleChange[],
  scope: BalanceLabRuleChange['scope'],
  characterId: CharacterId | null,
  baseline: unknown,
  candidate: unknown,
): void {
  const baselineValues = collectNumericRuleValues(baseline);
  const candidateValues = collectNumericRuleValues(candidate);
  const paths = Array.from(new Set([
    ...baselineValues.keys(),
    ...candidateValues.keys(),
  ])).sort();
  for (const path of paths) {
    const baselineValue = baselineValues.get(path);
    const candidateValue = candidateValues.get(path);
    if (baselineValue === undefined || candidateValue === undefined) {
      continue;
    }
    const delta = roundMetric(candidateValue - baselineValue, 6);
    if (delta === 0) {
      continue;
    }
    changes.push({
      scope,
      characterId,
      path,
      baselineValue,
      candidateValue,
      delta,
    });
  }
}

export function buildBalanceLabRuleChanges(
  baselineTuning: GameTuning,
  candidateTuning: GameTuning,
  baselineCharacterOverrides: CharacterBalanceOverrides | undefined,
  candidateCharacterOverrides: CharacterBalanceOverrides | undefined,
  characterIds: readonly CharacterId[],
  baselineAiBehaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning(),
  candidateAiBehaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning(),
): BalanceLabRuleChange[] {
  const changes: BalanceLabRuleChange[] = [];
  appendNumericRuleChanges(changes, 'global', null, baselineTuning, candidateTuning);
  appendNumericRuleChanges(
    changes,
    'ai',
    null,
    sanitiseAiBehaviorTuning(baselineAiBehaviorTuning),
    sanitiseAiBehaviorTuning(candidateAiBehaviorTuning),
  );
  for (const characterId of new Set(characterIds)) {
    const baseline = resolveCharacterBalanceConfig(characterId, baselineCharacterOverrides);
    const candidate = resolveCharacterBalanceConfig(characterId, candidateCharacterOverrides);
    appendNumericRuleChanges(
      changes,
      'character',
      characterId,
      { stats: baseline.stats, moves: baseline.moves },
      { stats: candidate.stats, moves: candidate.moves },
    );
  }
  return changes;
}

function createBalanceLabExperimentSample(
  input: BalanceLabExperimentSampleInput,
): BalanceLabExperimentSample {
  const tuning = sanitiseTuning(input.tuning);
  const characterBalanceOverrides = cloneCharacterBalanceOverrides(input.characterBalanceOverrides);
  const aiBehaviorTuning = sanitiseAiBehaviorTuning(input.aiBehaviorTuning);
  const telemetry = structuredClone(input.telemetry);
  return {
    capturedAt: input.capturedAt,
    scenario: input.scenario ? structuredClone(input.scenario) : null,
    tuning,
    characterBalanceOverrides,
    aiBehaviorTuning,
    telemetry,
    tuningFingerprint: fingerprintBalanceTuning(tuning),
    characterBalanceFingerprint: fingerprintCharacterBalanceOverrides(characterBalanceOverrides),
    aiBehaviorFingerprint: fingerprintAiBehaviorTuning(aiBehaviorTuning),
    flow: buildBalanceLabFlowModel(telemetry),
  };
}

export function createBalanceLabExperimentBundle(
  options: CreateBalanceLabExperimentOptions,
): BalanceLabExperimentBundle {
  const baseline = createBalanceLabExperimentSample(options.baseline);
  const candidate = createBalanceLabExperimentSample(options.candidate);
  const comparison = compareBalanceLabFlows(baseline.flow, candidate.flow);
  const sameScenario = baseline.scenario !== null
    && candidate.scenario !== null
    && baseline.scenario.fingerprint === candidate.scenario.fingerprint;
  const sameCharacterPackages = (['P1', 'P2'] as const).every((playerId) => (
    baseline.telemetry.characters[playerId].characterId
      === candidate.telemetry.characters[playerId].characterId
    && baseline.telemetry.characters[playerId].packageVersion
      === candidate.telemetry.characters[playerId].packageVersion
  ));
  const independentSamples = baseline.scenario !== null
    && candidate.scenario !== null
    && baseline.scenario.sampleId !== candidate.scenario.sampleId;
  const issues: BalanceLabExperimentIssue[] = [];
  if (!sameScenario) {
    issues.push('scenario_changed');
  }
  if (!sameCharacterPackages) {
    issues.push('character_package_changed');
  }
  if (sameScenario && !independentSamples) {
    issues.push('same_sample');
  }
  if (!comparison.sampleDurationComparable) {
    issues.push('sample_duration_mismatch');
  }
  const status = !sameScenario || !sameCharacterPackages
    ? 'invalid'
    : comparison.sampleDurationComparable && independentSamples
      ? 'comparable'
      : 'provisional';
  const characterIds = [
    baseline.telemetry.characters.P1.characterId,
    baseline.telemetry.characters.P2.characterId,
    candidate.telemetry.characters.P1.characterId,
    candidate.telemetry.characters.P2.characterId,
  ];
  return {
    schemaVersion: BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    purpose: 'flow_first_manual_balance_review',
    interpretation: 'Use neutral, exchange, separation, chase, and finish evidence before class win percentage.',
    status,
    issues,
    controls: {
      sameScenario,
      sameCharacterPackages,
      independentSamples,
      sampleDurationComparable: comparison.sampleDurationComparable,
      pendingDraftExcluded: options.pendingDraftExcluded ?? false,
    },
    review: normaliseExperimentReview(options.review),
    baseline,
    candidate,
    ruleChanges: buildBalanceLabRuleChanges(
      baseline.tuning,
      candidate.tuning,
      baseline.characterBalanceOverrides,
      candidate.characterBalanceOverrides,
      characterIds,
      baseline.aiBehaviorTuning,
      candidate.aiBehaviorTuning,
    ),
    comparison,
  };
}

function ratePerMinute(count: number, elapsedSeconds: number): number {
  return roundMetric(count * 60 / Math.max(1, elapsedSeconds), 2);
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

const TACTICAL_ACTIONS: CombatAction[] = [
  'launch',
  'special',
  'dunk',
  'parry',
  'launch_break',
  'super_boost',
];

function characterControlForAction(
  action: CombatAction | BalanceLabInputAction | null,
): BalanceLabCharacterControlFocus | null {
  if (action === 'launch' || action === 'dunk' || action === 'parry' || action === 'special') {
    return action;
  }
  if (action === 'launch_break') {
    return 'launch_break';
  }
  if (action === 'super_boost' || action === 'boost') {
    return 'movement';
  }
  return null;
}

function analyseTacticalSequence(
  summary: MatchTelemetrySummary,
  playerId: PlayerId,
): Pick<
  BalanceLabPlayerFlow,
  | 'tacticalActionStarts'
  | 'dominantTacticalAction'
  | 'dominantTacticalActionShare'
  | 'tacticalActionEntropy'
  | 'longestRepeatedAction'
  | 'longestRepeatedActionStreak'
  | 'averageLaunchToDunkSeconds'
> {
  const tacticalSet = new Set<CombatAction>(TACTICAL_ACTIONS);
  const actions = summary.combat.events
    .filter((event) => (
      event.type === 'action_start'
      && event.actorId === playerId
      && event.action
      && tacticalSet.has(event.action)
    ))
    .map((event) => event.action as CombatAction);
  const counts = new Map<CombatAction, number>();
  let longestRepeatedActionStreak = 0;
  let longestRepeatedAction: CombatAction | null = null;
  let repeatedActionStreak = 0;
  let previousAction: CombatAction | null = null;
  for (const action of actions) {
    counts.set(action, (counts.get(action) ?? 0) + 1);
    repeatedActionStreak = action === previousAction ? repeatedActionStreak + 1 : 1;
    if (repeatedActionStreak > longestRepeatedActionStreak) {
      longestRepeatedActionStreak = repeatedActionStreak;
      longestRepeatedAction = action;
    }
    previousAction = action;
  }
  const sortedCounts = [...counts.entries()].sort((first, second) => (
    second[1] - first[1] || first[0].localeCompare(second[0])
  ));
  const dominant = sortedCounts[0] ?? null;
  const entropy = actions.length > 0
    ? -sortedCounts.reduce((sum, [, count]) => {
      const probability = count / actions.length;
      return sum + probability * Math.log(probability);
    }, 0) / Math.log(TACTICAL_ACTIONS.length)
    : 0;

  let latestLaunchHitSeconds: number | null = null;
  const launchToDunkSeconds: number[] = [];
  for (const event of summary.combat.events) {
    if (event.actorId !== playerId) {
      continue;
    }
    if (event.type === 'launch_hit') {
      latestLaunchHitSeconds = event.timeSeconds;
    } else if (
      event.type === 'action_start'
      && event.action === 'dunk'
      && latestLaunchHitSeconds !== null
    ) {
      launchToDunkSeconds.push(Math.max(0, event.timeSeconds - latestLaunchHitSeconds));
      latestLaunchHitSeconds = null;
    }
  }

  return {
    tacticalActionStarts: actions.length,
    dominantTacticalAction: dominant?.[0] ?? null,
    dominantTacticalActionShare: roundMetric((dominant?.[1] ?? 0) / Math.max(1, actions.length)),
    tacticalActionEntropy: roundMetric(entropy),
    longestRepeatedAction,
    longestRepeatedActionStreak,
    averageLaunchToDunkSeconds: launchToDunkSeconds.length > 0
      ? roundMetric(launchToDunkSeconds.reduce((sum, value) => sum + value, 0) / launchToDunkSeconds.length, 2)
      : null,
  };
}

function createsSustainedPressureExit(
  events: MatchTelemetrySummary['combat']['events'],
  startEvent: MatchTelemetrySummary['combat']['events'][number],
  startsInPressure: boolean,
  boundarySeconds: number,
): boolean {
  if (!startsInPressure) {
    return false;
  }
  const distanceEvents = events.filter((event) => (
    event.type === 'distance_band_change'
    && event.distanceBand
    && event.frame >= startEvent.frame
    && event.timeSeconds - startEvent.timeSeconds <= 2.001
    && event.timeSeconds <= boundarySeconds
  ));
  return distanceEvents.some((candidate, candidateIndex) => {
    if (isPressureBand(candidate.distanceBand ?? null)) {
      return false;
    }
    const nextPressure = distanceEvents.slice(candidateIndex + 1).find((later) => (
      isPressureBand(later.distanceBand ?? null)
    ));
    const resetEndSeconds = Math.min(
      nextPressure?.timeSeconds ?? boundarySeconds,
      boundarySeconds,
    );
    return resetEndSeconds - candidate.timeSeconds >= 0.75;
  });
}

function analyseControlReturns(
  summary: MatchTelemetrySummary,
  playerId: PlayerId,
): BalanceLabControlReturnFlow {
  const events = [...summary.combat.events].sort((first, second) => (
    first.timeSeconds - second.timeSeconds || first.sequence - second.sequence
  ));
  const returns = events.filter((event) => (
    event.type === 'control_return' && event.actorId === playerId
  ));
  const controlWindows: number[] = [];
  const firstActionDelays: number[] = [];
  const reviews: BalanceLabControlReturnReview[] = [];
  const firstAcceptedActions = Object.fromEntries(
    BALANCE_LAB_CONTROL_RETURN_ACTIONS.map((action) => [action, {
      starts: 0,
      startsInPressure: 0,
      immediateRelaunches: 0,
      sustainedResets: 0,
      movementIntents: Object.fromEntries(
        BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS.map((intent) => [intent, 0]),
      ) as Record<BalanceLabPostControlMovementIntent, number>,
    }]),
  ) as Record<CombatAction, BalanceLabControlReturnActionFlow>;
  let relaunchesWithinOneSecond = 0;
  let relaunchesWithinTwoSeconds = 0;
  let relaunchesWithAcceptedAction = 0;
  let returnsWithAcceptedAction = 0;
  let controlReturnsInPressure = 0;
  let sustainedResetsAfterControlReturn = 0;
  let firstActionsInPressure = 0;
  let sustainedResetsAfterFirstAction = 0;

  for (const controlReturn of returns) {
    const laterEvents = events.filter((event) => event.sequence > controlReturn.sequence);
    const nextRoundEndIndex = laterEvents.findIndex((event) => event.type === 'round_end');
    const scopedEvents = nextRoundEndIndex >= 0
      ? laterEvents.slice(0, nextRoundEndIndex)
      : laterEvents;
    const relaunch = scopedEvents.find((event) => (
      event.type === 'launch_hit' && event.targetId === playerId
    ));
    const resetBoundarySeconds = relaunch?.timeSeconds
      ?? laterEvents[nextRoundEndIndex]?.timeSeconds
      ?? summary.elapsedSeconds;
    const returnStartDistance = controlReturn.controlReturnStartDistance ?? controlReturn.distance;
    const returnStartsInPressure = returnStartDistance !== undefined
      ? returnStartDistance <= 24
      : false;
    const sustainedResetAfterReturn = returnStartsInPressure && createsSustainedPressureExit(
      events,
      controlReturn,
      returnStartsInPressure,
      resetBoundarySeconds,
    );
    if (returnStartsInPressure) {
      controlReturnsInPressure += 1;
      if (sustainedResetAfterReturn) {
        sustainedResetsAfterControlReturn += 1;
      }
    }
    const actionWindow = relaunch
      ? scopedEvents.filter((event) => event.sequence < relaunch.sequence)
      : scopedEvents;
    const firstAcceptedAction = actionWindow.find((event) => (
      event.type === 'action_start'
      && event.actorId === playerId
      && event.action
    ));
    let firstActionCreatedSustainedReset = false;
    if (firstAcceptedAction?.action) {
      const action = firstAcceptedAction.action;
      const actionFlow = firstAcceptedActions[action];
      const movementIntent = firstAcceptedAction.movementIntent ?? 'unavailable';
      const actionDelay = Math.max(0, firstAcceptedAction.timeSeconds - controlReturn.timeSeconds);
      const startsInPressure = firstAcceptedAction.distance !== undefined
        ? firstAcceptedAction.distance <= 24
        : false;
      firstActionCreatedSustainedReset = createsSustainedPressureExit(
        events,
        firstAcceptedAction,
        startsInPressure,
        resetBoundarySeconds,
      );

      actionFlow.starts += 1;
      actionFlow.movementIntents[movementIntent] += 1;
      returnsWithAcceptedAction += 1;
      firstActionDelays.push(actionDelay);
      if (startsInPressure) {
        actionFlow.startsInPressure += 1;
        firstActionsInPressure += 1;
      }
      if (firstActionCreatedSustainedReset) {
        actionFlow.sustainedResets += 1;
        sustainedResetsAfterFirstAction += 1;
      }
      if (
        relaunch
        && relaunch.timeSeconds - controlReturn.timeSeconds <= 1.001
      ) {
        actionFlow.immediateRelaunches += 1;
      }
    }
    const controlWindowSeconds = relaunch
      ? Math.max(0, relaunch.timeSeconds - controlReturn.timeSeconds)
      : null;
    reviews.push({
      playerId,
      returnFrame: controlReturn.frame,
      returnSeconds: controlReturn.timeSeconds,
      returnKind: controlReturn.action === 'launch_break' ? 'launch_break' : 'natural',
      returnDistance: returnStartDistance ?? null,
      startedInPressure: returnStartsInPressure,
      firstAcceptedAction: firstAcceptedAction?.action ?? null,
      firstActionFrame: firstAcceptedAction?.frame ?? null,
      firstActionSeconds: firstAcceptedAction?.timeSeconds ?? null,
      firstActionDelaySeconds: firstAcceptedAction
        ? roundMetric(Math.max(0, firstAcceptedAction.timeSeconds - controlReturn.timeSeconds), 2)
        : null,
      firstActionDistance: firstAcceptedAction?.distance ?? null,
      firstActionMovementIntent: firstAcceptedAction?.movementIntent ?? null,
      relaunchFrame: relaunch?.frame ?? null,
      relaunchSeconds: relaunch?.timeSeconds ?? null,
      controlWindowSeconds: controlWindowSeconds === null
        ? null
        : roundMetric(controlWindowSeconds, 2),
      sustainedResetAfterReturn,
      sustainedResetAfterFirstAction: firstActionCreatedSustainedReset,
    });
    if (controlWindowSeconds === null) {
      continue;
    }
    controlWindows.push(controlWindowSeconds);
    if (controlWindowSeconds <= 1.001) {
      relaunchesWithinOneSecond += 1;
    }
    if (controlWindowSeconds <= 2.001) {
      relaunchesWithinTwoSeconds += 1;
    }
    if (firstAcceptedAction) {
      relaunchesWithAcceptedAction += 1;
    }
  }

  const launchBreakControlReturns = returns.filter((event) => event.action === 'launch_break').length;
  return {
    controlReturns: returns.length,
    naturalControlReturns: returns.length - launchBreakControlReturns,
    launchBreakControlReturns,
    relaunchesAfterControlReturn: controlWindows.length,
    relaunchesWithinOneSecond,
    relaunchesWithinTwoSeconds,
    immediateRelaunchRatio: roundMetric(relaunchesWithinOneSecond / Math.max(1, returns.length)),
    averageControlWindowSeconds: controlWindows.length > 0
      ? roundMetric(average(controlWindows), 2)
      : null,
    minimumControlWindowSeconds: controlWindows.length > 0
      ? roundMetric(Math.min(...controlWindows), 2)
      : null,
    relaunchesWithAcceptedAction,
    returnsWithAcceptedAction,
    averageFirstActionDelaySeconds: firstActionDelays.length > 0
      ? roundMetric(average(firstActionDelays), 2)
      : null,
    controlReturnsInPressure,
    sustainedResetsAfterControlReturn,
    controlReturnResetRatio: roundMetric(
      sustainedResetsAfterControlReturn / Math.max(1, controlReturnsInPressure),
    ),
    firstActionsInPressure,
    sustainedResetsAfterFirstAction,
    postReturnResetRatio: roundMetric(
      sustainedResetsAfterFirstAction / Math.max(1, firstActionsInPressure),
    ),
    firstAcceptedActions,
    reviews,
  };
}

const LAUNCH_DEFENSE_REACTIVE_SECONDS = 0.25;
const LAUNCH_DEFENSE_OUTCOME_SECONDS = 0.5;

function launchDefensePreemptiveSeconds(
  event: MatchTelemetrySummary['combat']['events'][number],
): number {
  if (event.action === 'special' && event.behaviorId === 'special.block_guard.v1') {
    return 0.45;
  }
  if (event.action === 'parry') {
    return 0.25;
  }
  return 0.2;
}

function isLaunchDefenseResponse(
  event: MatchTelemetrySummary['combat']['events'][number],
  playerId: PlayerId,
): boolean {
  return event.type === 'action_start'
    && event.actorId === playerId
    && (
      event.action === 'parry'
      || event.action === 'launch'
      || (
        event.action === 'special'
        && event.behaviorId === 'special.block_guard.v1'
      )
    );
}

function analyseLaunchDefense(
  summary: MatchTelemetrySummary,
  playerId: PlayerId,
): BalanceLabLaunchDefenseFlow {
  const opponentId: PlayerId = playerId === 'P1' ? 'P2' : 'P1';
  const events = [...summary.combat.events].sort((first, second) => (
    first.timeSeconds - second.timeSeconds || first.sequence - second.sequence
  ));
  const incomingLaunches = events.filter((event) => (
    event.type === 'action_start'
    && event.actorId === opponentId
    && event.action === 'launch'
    && event.distance !== undefined
    && event.distance <= 24
  ));
  const reactiveResponseSeconds: number[] = [];
  let preemptiveResponses = 0;
  let reactiveResponses = 0;
  let parryResponses = 0;
  let guardResponses = 0;
  let counterLaunchResponses = 0;
  let successfulParries = 0;
  let successfulGuards = 0;
  let unattributedParrySuccesses = 0;
  let launchClashes = 0;
  let counterLaunchHits = 0;
  let launchHits = 0;
  let unansweredLaunchHits = 0;
  let whiffsOrUnresolved = 0;
  let successfulDefenses = 0;
  let sustainedResetsAfterSuccessfulDefense = 0;

  incomingLaunches.forEach((launch, launchIndex) => {
    const previousLaunch = incomingLaunches[launchIndex - 1];
    const nextLaunch = incomingLaunches[launchIndex + 1];
    const lowerSequence = previousLaunch?.sequence ?? -1;
    const outcomeEndSeconds = Math.min(
      launch.timeSeconds + LAUNCH_DEFENSE_OUTCOME_SECONDS,
      nextLaunch?.timeSeconds ?? Number.POSITIVE_INFINITY,
    );
    const outcome = events.find((event) => (
      event.sequence > launch.sequence
      && event.timeSeconds <= outcomeEndSeconds
      && (
        (event.type === 'parry_success' && event.actorId === playerId && event.targetId === opponentId)
        || (event.type === 'launch_hit' && event.actorId === opponentId && event.targetId === playerId)
        || (event.type === 'launch_hit' && event.actorId === playerId && event.targetId === opponentId)
        || event.type === 'launch_clash'
        || event.type === 'round_end'
      )
    ));
    const responseBoundarySequence = outcome?.sequence ?? Number.POSITIVE_INFINITY;
    const responseEndSeconds = Math.min(
      launch.timeSeconds + LAUNCH_DEFENSE_REACTIVE_SECONDS,
      outcome?.timeSeconds ?? Number.POSITIVE_INFINITY,
      nextLaunch?.timeSeconds ?? Number.POSITIVE_INFINITY,
    );
    const reactiveResponse = events.find((event) => (
      event.sequence > lowerSequence
      && event.sequence < responseBoundarySequence
      && event.frame >= launch.frame
      && event.timeSeconds <= responseEndSeconds
      && isLaunchDefenseResponse(event, playerId)
    ));
    const preemptiveResponse = [...events].reverse().find((event) => (
      event.sequence > lowerSequence
      && event.sequence < launch.sequence
      && event.frame < launch.frame
      && launch.timeSeconds - event.timeSeconds <= launchDefensePreemptiveSeconds(event)
      && isLaunchDefenseResponse(event, playerId)
    ));
    const response = reactiveResponse ?? preemptiveResponse;

    if (reactiveResponse) {
      reactiveResponses += 1;
      reactiveResponseSeconds.push(Math.max(0, reactiveResponse.timeSeconds - launch.timeSeconds));
    } else if (preemptiveResponse) {
      preemptiveResponses += 1;
    }
    if (response?.action === 'parry') {
      parryResponses += 1;
    } else if (
      response?.action === 'special'
      && response.behaviorId === 'special.block_guard.v1'
    ) {
      guardResponses += 1;
    } else if (response?.action === 'launch') {
      counterLaunchResponses += 1;
    }

    if (outcome?.type === 'parry_success') {
      if (response?.action === 'parry') {
        successfulParries += 1;
      } else if (
        response?.action === 'special'
        && response.behaviorId === 'special.block_guard.v1'
      ) {
        successfulGuards += 1;
      } else {
        unattributedParrySuccesses += 1;
      }
      successfulDefenses += 1;
    } else if (outcome?.type === 'launch_clash') {
      launchClashes += 1;
      successfulDefenses += 1;
    } else if (
      outcome?.type === 'launch_hit'
      && outcome.actorId === playerId
      && outcome.targetId === opponentId
    ) {
      counterLaunchHits += 1;
      successfulDefenses += 1;
    } else if (outcome?.type === 'launch_hit') {
      launchHits += 1;
      if (!response) {
        unansweredLaunchHits += 1;
      }
    } else {
      whiffsOrUnresolved += 1;
    }

    if (
      (
        outcome?.type === 'parry_success'
        || outcome?.type === 'launch_clash'
        || (
          outcome?.type === 'launch_hit'
          && outcome.actorId === playerId
          && outcome.targetId === opponentId
        )
      )
      && createsSustainedPressureExit(
        events,
        outcome,
        true,
        nextLaunch?.timeSeconds ?? summary.elapsedSeconds,
      )
    ) {
      sustainedResetsAfterSuccessfulDefense += 1;
    }
  });

  const responses = preemptiveResponses + reactiveResponses;
  return {
    incomingPressureLaunches: incomingLaunches.length,
    preemptiveResponses,
    reactiveResponses,
    responseCoverageRatio: roundMetric(responses / Math.max(1, incomingLaunches.length)),
    parryResponses,
    guardResponses,
    counterLaunchResponses,
    successfulParries,
    successfulGuards,
    unattributedParrySuccesses,
    launchClashes,
    counterLaunchHits,
    launchHits,
    unansweredLaunchHits,
    whiffsOrUnresolved,
    averageReactiveResponseSeconds: reactiveResponseSeconds.length > 0
      ? roundMetric(average(reactiveResponseSeconds), 3)
      : null,
    successfulDefenses,
    sustainedResetsAfterSuccessfulDefense,
    successfulDefenseResetRatio: roundMetric(
      sustainedResetsAfterSuccessfulDefense / Math.max(1, successfulDefenses),
    ),
  };
}

function createClashFollowUpPlayerFlow(
  events: MatchTelemetrySummary['combat']['events'],
  clashes: MatchTelemetrySummary['combat']['events'],
  playerId: PlayerId,
): BalanceLabClashFollowUpPlayerFlow {
  const actionDelays: number[] = [];
  const firstAcceptedActions = Object.fromEntries(
    BALANCE_LAB_CONTROL_RETURN_ACTIONS.map((action) => [action, {
      starts: 0,
      startsInPressure: 0,
      startsWithinOneSecond: 0,
    }]),
  ) as Record<CombatAction, BalanceLabClashFollowUpActionFlow>;
  let firstActionsInPressure = 0;
  let firstActionsWithinOneSecond = 0;
  let rapidLaunchRecommits = 0;

  for (const [index, clash] of clashes.entries()) {
    const nextClash = clashes[index + 1];
    const roundEnd = events.find((event) => (
      event.sequence > clash.sequence && event.type === 'round_end'
    ));
    const boundarySequence = Math.min(
      nextClash?.sequence ?? Number.POSITIVE_INFINITY,
      roundEnd?.sequence ?? Number.POSITIVE_INFINITY,
    );
    const firstAction = events.find((event) => (
      event.sequence > clash.sequence
      && event.sequence < boundarySequence
      && event.type === 'action_start'
      && event.actorId === playerId
      && event.action
    ));
    if (!firstAction?.action) {
      continue;
    }

    const delaySeconds = Math.max(0, firstAction.timeSeconds - clash.timeSeconds);
    const startsInPressure = firstAction.distance !== undefined && firstAction.distance <= 24;
    const startsWithinOneSecond = delaySeconds <= 1.001;
    const actionFlow = firstAcceptedActions[firstAction.action];
    actionFlow.starts += 1;
    actionDelays.push(delaySeconds);
    if (startsInPressure) {
      actionFlow.startsInPressure += 1;
      firstActionsInPressure += 1;
    }
    if (startsWithinOneSecond) {
      actionFlow.startsWithinOneSecond += 1;
      firstActionsWithinOneSecond += 1;
      if (firstAction.action === 'launch') {
        rapidLaunchRecommits += 1;
      }
    }
  }

  const firstActions = actionDelays.length;
  return {
    firstActions,
    firstActionsInPressure,
    firstActionsWithinOneSecond,
    rapidLaunchRecommits,
    actionCoverageRatio: roundMetric(firstActions / Math.max(1, clashes.length)),
    immediateActionRatio: roundMetric(firstActionsWithinOneSecond / Math.max(1, clashes.length)),
    rapidLaunchRecommitRatio: roundMetric(rapidLaunchRecommits / Math.max(1, clashes.length)),
    averageFirstActionDelaySeconds: firstActions > 0
      ? roundMetric(average(actionDelays), 2)
      : null,
    firstAcceptedActions,
  };
}

function analyseClashFollowUps(summary: MatchTelemetrySummary): BalanceLabClashFollowUpFlow {
  const events = [...summary.combat.events].sort((first, second) => (
    first.timeSeconds - second.timeSeconds || first.sequence - second.sequence
  ));
  const clashes = events.filter((event) => event.type === 'launch_clash');
  const repeatClashesWithinOneSecond = clashes.reduce((count, clash, index) => {
    const nextClash = clashes[index + 1];
    return count + Number(
      Boolean(nextClash) && (nextClash?.timeSeconds ?? 0) - clash.timeSeconds <= 1.001,
    );
  }, 0);
  const repeatOpportunities = Math.max(0, clashes.length - 1);
  return {
    clashes: clashes.length,
    repeatClashesWithinOneSecond,
    repeatClashRatio: roundMetric(
      repeatClashesWithinOneSecond / Math.max(1, repeatOpportunities),
    ),
    players: {
      P1: createClashFollowUpPlayerFlow(events, clashes, 'P1'),
      P2: createClashFollowUpPlayerFlow(events, clashes, 'P2'),
    },
  };
}

function describeClashFollowUps(flow: BalanceLabClashFollowUpFlow): string {
  const playerDetails = (['P1', 'P2'] as const).map((playerId) => {
    const player = flow.players[playerId];
    const dominant = BALANCE_LAB_CONTROL_RETURN_ACTIONS
      .map((action) => ({ action, starts: player.firstAcceptedActions[action].starts }))
      .filter(({ starts }) => starts > 0)
      .sort((first, second) => second.starts - first.starts || first.action.localeCompare(second.action))[0];
    if (!dominant) {
      return `${playerId} recorded no accepted follow-up`;
    }
    const delay = player.averageFirstActionDelaySeconds === null
      ? '--'
      : `${player.averageFirstActionDelaySeconds.toFixed(2)}s`;
    return `${playerId} first chose ${dominant.action} after ${dominant.starts}/${player.firstActions} acted clashes (${delay} average; ${player.rapidLaunchRecommits} rapid launch recommits)`;
  });
  const recurrence = flow.clashes > 1
    ? `${flow.repeatClashesWithinOneSecond}/${flow.clashes - 1} following clashes recurred within one second`
    : 'no following clash was available for recurrence timing';
  return `${recurrence}; ${playerDetails.join('; ')}`;
}

function describePostReturnDecisions(control: BalanceLabControlReturnFlow): string {
  const dominant = BALANCE_LAB_CONTROL_RETURN_ACTIONS
    .map((action) => ({ action, ...control.firstAcceptedActions[action] }))
    .filter(({ starts }) => starts > 0)
    .sort((first, second) => second.starts - first.starts || first.action.localeCompare(second.action))[0];
  if (!dominant) {
    return 'no accepted post-return action was recorded';
  }
  const returnResetDetail = control.controlReturnsInPressure > 0
    ? `${control.sustainedResetsAfterControlReturn}/${control.controlReturnsInPressure} pressure-range control returns created a sustained reset`
    : 'no control return occurred inside pressure';
  const actionResetDetail = control.firstActionsInPressure > 0
    ? `${control.sustainedResetsAfterFirstAction}/${control.firstActionsInPressure} first pressure actions reset`
    : 'no first action began inside pressure';
  const dominantMovement = BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS
    .map((intent) => ({ intent, starts: dominant.movementIntents[intent] }))
    .filter(({ starts }) => starts > 0)
    .sort((first, second) => second.starts - first.starts || first.intent.localeCompare(second.intent))[0];
  const movementDetail = dominantMovement
    ? `${dominantMovement.intent} movement accompanied ${dominantMovement.starts}/${dominant.starts}`
    : 'movement direction was unavailable';
  return `${dominant.action} was the first action after ${dominant.starts}/${control.returnsWithAcceptedAction} acted returns; ${movementDetail}; ${returnResetDetail}; ${actionResetDetail}`;
}

function buildPlayerFlow(
  playerId: PlayerId,
  player: MatchTelemetryPlayerSummary,
  resource: MatchTelemetrySummary['combat']['resources']['P1'],
  framesSimulated: number,
  elapsedSeconds: number,
  summary: MatchTelemetrySummary,
): BalanceLabPlayerFlow {
  const actionPresses = player.launchPresses
    + player.specialPresses
    + player.dunkPresses
    + player.parryPresses
    + player.breakPresses;
  const acceptedTacticalStarts = player.launchStarts
    + player.specialStarts
    + player.dunkStarts
    + player.parryStarts
    + player.breakEscapes;
  const acceptanceDenominator = Math.max(1, actionPresses, acceptedTacticalStarts);
  const buildActionAcceptance = (presses: number, starts: number): BalanceLabActionAcceptance => ({
    presses,
    starts,
    rejectedPresses: Math.max(0, presses - starts),
    acceptanceRatio: roundMetric(starts / Math.max(1, presses, starts)),
  });
  const actionAcceptance: Record<BalanceLabInputAction, BalanceLabActionAcceptance> = {
    launch: buildActionAcceptance(player.launchPresses, player.launchStarts),
    special: buildActionAcceptance(player.specialPresses, player.specialStarts),
    dunk: buildActionAcceptance(player.dunkPresses, player.dunkStarts),
    parry: buildActionAcceptance(player.parryPresses, player.parryStarts),
    launch_break: buildActionAcceptance(player.breakPresses, player.breakEscapes),
  };
  const acceptedTacticalActions: CombatAction[] = [
    ...(player.launchStarts > 0 ? ['launch' as const] : []),
    ...(player.specialStarts > 0 ? ['special' as const] : []),
    ...(player.dunkStarts > 0 ? ['dunk' as const] : []),
    ...(player.parryStarts > 0 ? ['parry' as const] : []),
    ...(player.breakEscapes > 0 ? ['launch_break' as const] : []),
    ...(player.superBoostStarts > 0 ? ['super_boost' as const] : []),
  ];
  const firstDunkAttempt = summary.combat.events.find((event) => (
    event.type === 'action_start'
    && event.actorId === playerId
    && event.action === 'dunk'
  ));
  const zeroFuelTargetLaunchHits = summary.combat.events.filter((event) => (
    event.type === 'launch_hit'
    && event.actorId === playerId
    && (event.targetFuelPercent ?? 1) <= 0.001
  )).length;
  const finishDunkStarts = summary.combat.events.filter((event) => (
    event.type === 'action_start'
    && event.action === 'dunk'
    && event.actorId === playerId
    && (event.targetFuelPercent ?? 1) <= 0.001
  )).length;
  const finishDunkWins = summary.combat.events.filter((event) => (
    event.type === 'dunk_hit'
    && event.actorId === playerId
    && event.outcome === 'win'
  )).length;
  const tacticalSequence = analyseTacticalSequence(summary, playerId);
  const movement = player.movementIntent;
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  const launchHitsReceived = summary.players[opponentId].launchHits;
  const controlReturn = analyseControlReturns(summary, playerId);
  const launchDefense = analyseLaunchDefense(summary, playerId);
  return {
    acceptedActionsPerMinute: ratePerMinute(acceptedTacticalStarts, elapsedSeconds),
    inputAcceptanceRatio: roundMetric(acceptedTacticalStarts / acceptanceDenominator),
    actionAcceptance,
    launchConversionRate: roundMetric(player.launchConversionRate),
    dunkConversionRate: roundMetric(player.dunkConversionRate),
    zeroFuelRatio: roundMetric(resource.zeroFuelFrames / Math.max(1, framesSimulated)),
    helplessRatio: roundMetric(resource.helplessFrames / Math.max(1, framesSimulated)),
    launchHitsReceived,
    helplessSecondsPerLaunchReceived: launchHitsReceived > 0
      ? roundMetric(resource.helplessSeconds / launchHitsReceived, 2)
      : null,
    controlReturn,
    launchDefense,
    specialStartsPerMinute: ratePerMinute(player.specialStarts, elapsedSeconds),
    dunkStartsPerMinute: ratePerMinute(player.dunkStarts, elapsedSeconds),
    breakEscapes: player.breakEscapes,
    breakEscapesPerMinute: ratePerMinute(player.breakEscapes, elapsedSeconds),
    averageBreakReactionSeconds: roundMetric(player.averageBreakReactionSeconds, 2),
    zeroFuelTargetLaunchHits,
    finishDunkStarts,
    finishDunkWins,
    acceptedTacticalActions,
    ...tacticalSequence,
    firstDunkAttemptSeconds: firstDunkAttempt?.timeSeconds ?? null,
    movementIntent: {
      controllableFrames: movement.controllableFrames,
      approachRatio: roundMetric(movement.approachFrames / Math.max(1, movement.controllableFrames)),
      retreatRatio: roundMetric(movement.retreatFrames / Math.max(1, movement.controllableFrames)),
      orbitRatio: roundMetric(movement.orbitFrames / Math.max(1, movement.controllableFrames)),
      idleRatio: roundMetric(movement.idleFrames / Math.max(1, movement.controllableFrames)),
      contestedContactFrames: movement.contestedContactFrames,
      contestedContactApproachRatio: roundMetric(
        movement.contestedContactApproachFrames / Math.max(1, movement.contestedContactFrames),
      ),
      contestedContactRetreatRatio: roundMetric(
        movement.contestedContactRetreatFrames / Math.max(1, movement.contestedContactFrames),
      ),
      contestedContactOrbitRatio: roundMetric(
        movement.contestedContactOrbitFrames / Math.max(1, movement.contestedContactFrames),
      ),
      contestedContactIdleRatio: roundMetric(
        movement.contestedContactIdleFrames / Math.max(1, movement.contestedContactFrames),
      ),
      pressureFrames: movement.pressureFrames,
      pressureApproachRatio: roundMetric(
        movement.pressureApproachFrames / Math.max(1, movement.pressureFrames),
      ),
      pressureRetreatRatio: roundMetric(
        movement.pressureRetreatFrames / Math.max(1, movement.pressureFrames),
      ),
      pointBlankFrames: movement.pointBlankFrames,
      pointBlankApproachRatio: roundMetric(
        movement.pointBlankApproachFrames / Math.max(1, movement.pointBlankFrames),
      ),
      pointBlankRetreatRatio: roundMetric(
        movement.pointBlankRetreatFrames / Math.max(1, movement.pointBlankFrames),
      ),
      contestedPressureFrames: movement.contestedPressureFrames,
      contestedPressureApproachRatio: roundMetric(
        movement.contestedPressureApproachFrames / Math.max(1, movement.contestedPressureFrames),
      ),
      contestedPressureRetreatRatio: roundMetric(
        movement.contestedPressureRetreatFrames / Math.max(1, movement.contestedPressureFrames),
      ),
      contestedPointBlankFrames: movement.contestedPointBlankFrames,
      contestedPointBlankApproachRatio: roundMetric(
        movement.contestedPointBlankApproachFrames / Math.max(1, movement.contestedPointBlankFrames),
      ),
      contestedPointBlankRetreatRatio: roundMetric(
        movement.contestedPointBlankRetreatFrames / Math.max(1, movement.contestedPointBlankFrames),
      ),
    },
  };
}

function isPressureBand(band: CombatDistanceBand | null): boolean {
  return band === 'point_blank' || band === 'pressure';
}

function analysePressureSequences(summary: MatchTelemetrySummary): {
  engagements: number;
  firstPressureSeconds: number | null;
  neutralResets: number;
  averageSeconds: number;
  p90Seconds: number;
  longestSeconds: number;
  averageNeutralSeconds: number;
  longestNeutralSeconds: number;
} {
  const changes = summary.combat.events.filter((event) => (
    event.type === 'distance_band_change' && event.distanceBand
  ));
  let previousBand: CombatDistanceBand | null = null;
  let pressureStartedAt: number | null = null;
  let neutralStartedAt: number | null = null;
  let engagements = 0;
  let neutralResets = 0;
  let firstPressureSeconds: number | null = null;
  const pressureDurations: number[] = [];
  const neutralDurations: number[] = [];

  for (const event of changes) {
    const nextBand = event.distanceBand ?? null;
    const wasPressure = isPressureBand(previousBand);
    const isPressure = isPressureBand(nextBand);
    if (!wasPressure && isPressure) {
      if (neutralStartedAt !== null) {
        const neutralDuration = Math.max(0, event.timeSeconds - neutralStartedAt);
        neutralDurations.push(neutralDuration);
        if (neutralDuration >= 0.75) {
          neutralResets += 1;
        }
      }
      neutralStartedAt = null;
      engagements += 1;
      pressureStartedAt = previousBand === null ? 0 : event.timeSeconds;
      firstPressureSeconds ??= pressureStartedAt;
    } else if (wasPressure && !isPressure && pressureStartedAt !== null) {
      const duration = Math.max(0, event.timeSeconds - pressureStartedAt);
      pressureDurations.push(duration);
      pressureStartedAt = null;
      neutralStartedAt = event.timeSeconds;
    }
    previousBand = nextBand;
  }
  if (pressureStartedAt !== null) {
    pressureDurations.push(Math.max(0, summary.elapsedSeconds - pressureStartedAt));
  }
  if (neutralStartedAt !== null) {
    const neutralDuration = Math.max(0, summary.elapsedSeconds - neutralStartedAt);
    neutralDurations.push(neutralDuration);
    if (neutralDuration >= 0.75) {
      neutralResets += 1;
    }
  }
  return {
    engagements,
    firstPressureSeconds: firstPressureSeconds === null ? null : roundMetric(firstPressureSeconds, 2),
    neutralResets,
    averageSeconds: roundMetric(average(pressureDurations), 2),
    p90Seconds: roundMetric(percentile(pressureDurations, 0.9), 2),
    longestSeconds: roundMetric(Math.max(0, ...pressureDurations), 2),
    averageNeutralSeconds: roundMetric(average(neutralDurations), 2),
    longestNeutralSeconds: roundMetric(Math.max(0, ...neutralDurations), 2),
  };
}

function buildSpacingTimeline(summary: MatchTelemetrySummary): BalanceLabSpacingSegment[] {
  const elapsedSeconds = Math.max(0, summary.elapsedSeconds);
  const changes = summary.combat.events
    .filter((event) => event.type === 'distance_band_change' && event.distanceBand)
    .sort((first, second) => first.timeSeconds - second.timeSeconds || first.sequence - second.sequence);
  let currentBand: CombatDistanceBand | null = null;
  let segmentStartedAt = 0;
  const segments: BalanceLabSpacingSegment[] = [];

  for (const event of changes) {
    const nextBand = event.distanceBand ?? null;
    if (!nextBand) {
      continue;
    }
    const transitionAt = Math.min(elapsedSeconds, Math.max(0, event.timeSeconds));
    if (currentBand === null) {
      currentBand = nextBand;
      segmentStartedAt = 0;
      continue;
    }
    if (nextBand === currentBand) {
      continue;
    }
    segments.push({
      band: currentBand,
      startSeconds: roundMetric(segmentStartedAt, 2),
      endSeconds: roundMetric(transitionAt, 2),
      durationSeconds: roundMetric(Math.max(0, transitionAt - segmentStartedAt), 2),
    });
    currentBand = nextBand;
    segmentStartedAt = transitionAt;
  }

  if (currentBand === null && elapsedSeconds > 0) {
    const orderedBands = Object.entries(summary.combat.spacingBands.frames)
      .sort((first, second) => second[1] - first[1]);
    currentBand = (orderedBands[0]?.[0] as CombatDistanceBand | undefined) ?? 'long';
  }
  if (currentBand !== null) {
    segments.push({
      band: currentBand,
      startSeconds: roundMetric(segmentStartedAt, 2),
      endSeconds: roundMetric(elapsedSeconds, 2),
      durationSeconds: roundMetric(Math.max(0, elapsedSeconds - segmentStartedAt), 2),
    });
  }
  return segments.filter((segment) => segment.durationSeconds > 0);
}

function createResetOutcome(attempts: number, successes: number): BalanceLabResetOutcome {
  return {
    attempts,
    successes,
    successRatio: roundMetric(successes / Math.max(1, attempts)),
  };
}

function analyseResetOutcomes(
  summary: MatchTelemetrySummary,
): BalanceLabResetOutcomes {
  const attempts = {
    all: 0,
    clashes: 0,
    defense: 0,
    parries: 0,
    launchBreaks: 0,
  };
  const successes = {
    all: 0,
    clashes: 0,
    defense: 0,
    parries: 0,
    launchBreaks: 0,
  };
  const resetEvents = summary.combat.events.filter((event) => (
    event.type === 'launch_clash'
    || event.type === 'parry_success'
    || event.type === 'launch_break'
  ));
  const distanceEvents = summary.combat.events.filter((event) => (
    event.type === 'distance_band_change' && event.distanceBand
  ));

  for (const event of resetEvents) {
    const previousBandEvent = [...distanceEvents]
      .reverse()
      .find((candidate) => candidate.frame < event.frame);
    if (!isPressureBand(previousBandEvent?.distanceBand ?? null)) {
      continue;
    }
    const kind = event.type === 'launch_clash'
      ? 'clashes'
      : event.type === 'parry_success'
        ? 'parries'
        : 'launchBreaks';
    attempts.all += 1;
    attempts[kind] += 1;
    if (kind === 'parries' || kind === 'launchBreaks') {
      attempts.defense += 1;
    }
    const createdReset = distanceEvents.some((candidate, candidateIndex) => {
      if (
        candidate.frame < event.frame
        || candidate.timeSeconds - event.timeSeconds > 2
        || isPressureBand(candidate.distanceBand ?? null)
      ) {
        return false;
      }
      const nextPressure = distanceEvents.slice(candidateIndex + 1).find((later) => (
        isPressureBand(later.distanceBand ?? null)
      ));
      const resetEndSeconds = nextPressure?.timeSeconds ?? summary.elapsedSeconds;
      return resetEndSeconds - candidate.timeSeconds >= 0.75;
    });
    if (createdReset) {
      successes.all += 1;
      successes[kind] += 1;
      if (kind === 'parries' || kind === 'launchBreaks') {
        successes.defense += 1;
      }
    }
  }

  return {
    all: createResetOutcome(attempts.all, successes.all),
    clashes: createResetOutcome(attempts.clashes, successes.clashes),
    defense: createResetOutcome(attempts.defense, successes.defense),
    parries: createResetOutcome(attempts.parries, successes.parries),
    launchBreaks: createResetOutcome(attempts.launchBreaks, successes.launchBreaks),
  };
}

function flowMomentsForEvent(
  event: MatchTelemetrySummary['combat']['events'][number],
): BalanceLabFlowMoment[] {
  const actorId = event.actorId ?? null;
  const base = { timeSeconds: event.timeSeconds, actorId };
  if (event.type === 'launch_clash') {
    return [{ ...base, actorId: null, kind: 'clash', category: 'outcome', label: 'Launch clash' }];
  }
  if (event.type === 'launch_hit') {
    return [{ ...base, kind: 'launch', category: 'outcome', label: `${actorId ?? 'Player'} launch hit` }];
  }
  if (event.type === 'dunk_hit') {
    return [{ ...base, kind: 'dunk', category: 'outcome', label: `${actorId ?? 'Player'} dunk connected` }];
  }
  if (event.type === 'parry_success') {
    return [{ ...base, kind: 'parry', category: 'outcome', label: `${actorId ?? 'Player'} parry` }];
  }
  if (event.type === 'launch_break') {
    return [{ ...base, kind: 'break', category: 'outcome', label: `${actorId ?? 'Player'} launch break` }];
  }
  if (event.type === 'control_return') {
    return [{
      ...base,
      kind: 'control',
      category: 'transition',
      label: `${actorId ?? 'Player'} control returned${event.action === 'launch_break' ? ' via break' : ''}`,
    }];
  }
  if (event.type === 'special_resolve') {
    return [{ ...base, kind: 'special', category: 'outcome', label: `${actorId ?? 'Player'} special resolved` }];
  }
  if (event.type === 'projectile_end' && event.outcome === 'impact') {
    return [{ ...base, kind: 'projectile', category: 'outcome', label: `${actorId ?? 'Player'} projectile hit` }];
  }
  if (event.type === 'round_end') {
    return [{ ...base, kind: 'finish', category: 'finish', label: `${actorId ?? 'Player'} round finish` }];
  }
  if (event.type !== 'action_start') {
    return [];
  }
  if (event.action === 'special') {
    return [{ ...base, kind: 'special', category: 'commitment', label: `${actorId ?? 'Player'} special` }];
  }
  if (event.action === 'dunk') {
    return [{ ...base, kind: 'dunk', category: 'commitment', label: `${actorId ?? 'Player'} dunk attempt` }];
  }
  return [];
}

function buildFlowMoments(summary: MatchTelemetrySummary): BalanceLabFlowMoment[] {
  const moments = summary.combat.events.flatMap(flowMomentsForEvent);
  if (moments.length <= 96) {
    return moments;
  }
  const stride = Math.ceil(moments.length / 96);
  return moments.filter((moment, index) => (
    moment.kind === 'finish'
    || moment.kind === 'dunk'
    || moment.kind === 'clash'
    || index % stride === 0
  ));
}

function classifyCarriedReentry(
  context: CombatDistanceTransitionContext | null,
): BalanceLabCarriedReentryCause {
  if (!context) {
    return 'unknown';
  }
  const players = [context.players.P1, context.players.P2];
  if (players.some((player) => (
    player.boostHeld
    || player.superBoostHeld
    || player.boostActive
    || player.superBoostActive
  ))) {
    return 'held_boost';
  }
  if (players.some((player) => player.movementIntent === 'approach')) {
    return 'held_approach';
  }
  if (context.separationSpeed < -0.5) {
    if (players.some((player) => player.actionRecoveryActive)) {
      return 'action_recovery_momentum';
    }
    if (players.some((player) => player.movementIntent === 'uncontrollable')) {
      return 'uncontrolled_momentum';
    }
    return 'residual_velocity';
  }
  return 'unknown';
}

function buildExchangeReview(
  summary: MatchTelemetrySummary,
  spacingTimeline: readonly BalanceLabSpacingSegment[],
): BalanceLabExchangeReview[] {
  const elapsedSeconds = Math.max(0, summary.elapsedSeconds);
  const pressureWindows: Array<{
    startSeconds: number;
    endSeconds: number;
    exitBand: CombatDistanceBand | null;
  }> = [];
  let activeWindow: { startSeconds: number; endSeconds: number } | null = null;

  for (const segment of spacingTimeline) {
    if (isPressureBand(segment.band)) {
      if (!activeWindow) {
        activeWindow = {
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
        };
      } else {
        activeWindow.endSeconds = segment.endSeconds;
      }
      continue;
    }
    if (activeWindow) {
      pressureWindows.push({ ...activeWindow, exitBand: segment.band });
      activeWindow = null;
    }
  }
  if (activeWindow) {
    pressureWindows.push({ ...activeWindow, exitBand: null });
  }

  const orderedEvents = [...summary.combat.events].sort((first, second) => (
    first.timeSeconds - second.timeSeconds || first.sequence - second.sequence
  ));
  const acceptedOpeners = orderedEvents.filter((event) => (
    event.type === 'action_start'
    && event.actorId
    && event.action
    && event.action !== 'boost'
  ));
  const acceptedActions = orderedEvents.filter((event) => (
    event.type === 'action_start' && event.actorId && event.action
  ));
  const distanceTransitions = orderedEvents.filter((event) => (
    event.type === 'distance_band_change' && event.distanceBand
  ));
  const outcomes = orderedEvents
    .flatMap(flowMomentsForEvent)
    .filter((moment) => moment.category === 'outcome' || moment.category === 'finish');
  const eventToleranceSeconds = 1 / 60 + 0.001;

  return pressureWindows.map((window, index) => {
    const previousPressureEnd = pressureWindows[index - 1]?.endSeconds ?? 0;
    const nextPressureStart = pressureWindows[index + 1]?.startSeconds ?? elapsedSeconds;
    const neutralWindowSeconds = Math.max(0, nextPressureStart - window.endSeconds);
    const ongoing = window.exitBand === null
      && window.endSeconds >= elapsedSeconds - eventToleranceSeconds;
    const openerSearchStart = Math.max(previousPressureEnd, window.startSeconds - 2);
    const openerCandidates = acceptedOpeners.filter((event) => (
      event.timeSeconds >= openerSearchStart - eventToleranceSeconds
      && event.timeSeconds <= window.endSeconds + eventToleranceSeconds
    ));
    const openerBeforeContact = [...openerCandidates]
      .reverse()
      .find((event) => event.timeSeconds <= window.startSeconds + eventToleranceSeconds);
    const opener = openerBeforeContact ?? openerCandidates[0] ?? null;
    const exchangeOutcomes = outcomes.filter((moment) => (
      moment.timeSeconds >= window.startSeconds - eventToleranceSeconds
      && moment.timeSeconds <= window.endSeconds + eventToleranceSeconds
    ));
    const finished = exchangeOutcomes.some((moment) => moment.category === 'finish');
    const createdReset = !ongoing && neutralWindowSeconds >= 0.75;
    const exitTransition = !ongoing && window.exitBand
      ? distanceTransitions.find((event) => (
        !isPressureBand(event.distanceBand ?? null)
        && Math.abs(event.timeSeconds - window.endSeconds) <= eventToleranceSeconds
      )) ?? null
      : null;
    const reentryTransition = exitTransition
      ? distanceTransitions.find((event) => (
        event.sequence > exitTransition.sequence
        && isPressureBand(event.distanceBand ?? null)
      )) ?? null
      : null;
    const firstNeutralAction = exitTransition
      ? acceptedActions.find((event) => (
        event.sequence > exitTransition.sequence
        && (reentryTransition ? event.sequence < reentryTransition.sequence : true)
      )) ?? null
      : !ongoing && window.exitBand
        ? acceptedActions.find((event) => (
          event.timeSeconds > window.endSeconds + 0.001
          && event.timeSeconds < nextPressureStart - 0.001
        )) ?? null
        : null;
    const status: BalanceLabExchangeStatus = finished
      ? 'finished'
      : ongoing
        ? 'ongoing'
        : createdReset
          ? 'reset'
          : 'brief_exit';

    const reentryContext = reentryTransition?.distanceTransition ?? null;
    const carriedReentryCause = status === 'brief_exit' && !firstNeutralAction
      ? classifyCarriedReentry(reentryContext)
      : null;

    return {
      exchangeNumber: index + 1,
      startSeconds: roundMetric(window.startSeconds, 2),
      endSeconds: roundMetric(window.endSeconds, 2),
      pressureSeconds: roundMetric(Math.max(0, window.endSeconds - window.startSeconds), 2),
      openerActorId: opener?.actorId ?? null,
      openerAction: opener?.action ?? null,
      outcomes: exchangeOutcomes,
      exitBand: window.exitBand,
      neutralWindowSeconds: roundMetric(neutralWindowSeconds, 2),
      firstNeutralActionActorId: firstNeutralAction?.actorId ?? null,
      firstNeutralAction: firstNeutralAction?.action ?? null,
      firstNeutralActionDelaySeconds: firstNeutralAction
        ? roundMetric(Math.max(0, firstNeutralAction.timeSeconds - window.endSeconds), 2)
        : null,
      carriedReentryCause,
      reentryContext,
      createdReset,
      resolved: exchangeOutcomes.length > 0,
      status,
    };
  });
}

function analyseNeutralExitFollowUp(
  exchanges: readonly BalanceLabExchangeReview[],
): BalanceLabNeutralExitFollowUp {
  const exits = exchanges.filter((exchange) => exchange.exitBand !== null);
  const briefExits = exits.filter((exchange) => exchange.status === 'brief_exit');
  const resetExits = exits.filter((exchange) => exchange.status === 'reset');
  const withFirstAction = exits.filter((exchange) => (
    exchange.firstNeutralActionActorId !== null && exchange.firstNeutralAction !== null
  ));
  const firstAcceptedActions = Object.fromEntries(
    BALANCE_LAB_CONTROL_RETURN_ACTIONS.map((action) => [
      action,
      withFirstAction.filter((exchange) => exchange.firstNeutralAction === action).length,
    ]),
  ) as Record<CombatAction, number>;
  const playerFirstActions: PlayersById<number> = {
    P1: withFirstAction.filter((exchange) => exchange.firstNeutralActionActorId === 'P1').length,
    P2: withFirstAction.filter((exchange) => exchange.firstNeutralActionActorId === 'P2').length,
  };
  const actionDelays = withFirstAction.flatMap((exchange) => (
    exchange.firstNeutralActionDelaySeconds === null
      ? []
      : [exchange.firstNeutralActionDelaySeconds]
  ));
  const briefExitsWithoutAcceptedAction = briefExits.filter((exchange) => (
    exchange.firstNeutralAction === null
  )).length;
  const carriedBriefExitCauses = Object.fromEntries(
    BALANCE_LAB_CARRIED_REENTRY_CAUSES.map((cause) => [
      cause,
      briefExits.filter((exchange) => exchange.carriedReentryCause === cause).length,
    ]),
  ) as Record<BalanceLabCarriedReentryCause, number>;
  return {
    exits: exits.length,
    briefExits: briefExits.length,
    resetExits: resetExits.length,
    firstActions: withFirstAction.length,
    firstActionCoverageRatio: roundMetric(withFirstAction.length / Math.max(1, exits.length)),
    averageFirstActionDelaySeconds: actionDelays.length > 0
      ? roundMetric(average(actionDelays), 2)
      : null,
    briefExitsWithoutAcceptedAction,
    carriedBriefExitRatio: roundMetric(
      briefExitsWithoutAcceptedAction / Math.max(1, briefExits.length),
    ),
    carriedBriefExitCauses,
    playerFirstActions,
    firstAcceptedActions,
  };
}

function hasEitherPlayer(
  players: PlayersById<BalanceLabPlayerFlow>,
  predicate: (player: BalanceLabPlayerFlow, playerId: PlayerId) => boolean,
): boolean {
  return predicate(players.P1, 'P1') || predicate(players.P2, 'P2');
}

function exchangeRatio(
  flow: BalanceLabFlowModel,
  predicate: (exchange: BalanceLabExchangeReview) => boolean,
): number {
  return flow.exchanges.length > 0
    ? flow.exchanges.filter(predicate).length / flow.exchanges.length
    : 0;
}

function longestUnresolvedPressure(flow: BalanceLabFlowModel): number {
  return Math.max(
    0,
    ...flow.exchanges
      .filter((exchange) => !exchange.resolved)
      .map((exchange) => exchange.pressureSeconds),
  );
}

function averageLaunchToDunk(flow: BalanceLabFlowModel): number | null {
  const values = (['P1', 'P2'] as const).flatMap((playerId) => {
    const value = flow.players[playerId].averageLaunchToDunkSeconds;
    return value === null ? [] : [value];
  });
  return values.length > 0 ? average(values) : null;
}

type BalanceLabFlowEvidence = Omit<BalanceLabFlowModel, 'loopStages'>;

function buildBalanceLabLoopStages(
  summary: MatchTelemetrySummary,
  flow: BalanceLabFlowEvidence,
): BalanceLabLoopStage[] {
  const playerIds = ['P1', 'P2'] as const;
  const actionRequests = (playerId: PlayerId): number => Object.values(
    flow.players[playerId].actionAcceptance,
  ).reduce((total, action) => total + action.presses, 0);
  const lowAcceptancePlayers = playerIds.filter((playerId) => (
    actionRequests(playerId) >= 4
    && flow.players[playerId].inputAcceptanceRatio < 0.45
  ));
  const noCommitmentPlayers = playerIds.filter((playerId) => (
    flow.players[playerId].tacticalActionStarts === 0
  ));
  const narrowKitPlayers = playerIds.filter((playerId) => (
    flow.players[playerId].acceptedTacticalActions.length < 3
  ));
  const repetitivePlayers = playerIds.filter((playerId) => {
    const player = flow.players[playerId];
    return player.tacticalActionStarts >= 8
      && (player.dominantTacticalActionShare >= 0.72 || player.longestRepeatedActionStreak >= 6);
  });
  const totalTacticalActionStarts = playerIds.reduce(
    (total, playerId) => total + flow.players[playerId].tacticalActionStarts,
    0,
  );
  const commitmentSaturation = flow.elapsedSeconds >= 15
    && flow.sharedAgency.controlSeconds >= 5
    && totalTacticalActionStarts >= 8
    && flow.sharedAgency.actionReadyShareOfControlFrames <= 0.3
    && flow.sharedAgency.controlPressureRatio >= 0.75;
  const resolvedExchanges = flow.exchanges.filter((exchange) => exchange.resolved).length;
  const unresolvedExchanges = flow.exchanges.filter((exchange) => !exchange.resolved);
  const unresolvedRatio = unresolvedExchanges.length / Math.max(1, flow.exchanges.length);
  const averageUnresolvedSeconds = average(
    unresolvedExchanges.map((exchange) => exchange.pressureSeconds),
  );
  const briefExitCount = flow.exchanges.filter((exchange) => (
    exchange.status === 'brief_exit'
  )).length;
  const briefExitRatio = briefExitCount / Math.max(1, flow.exchanges.length);
  const launchHits = summary.players.P1.launchHits + summary.players.P2.launchHits;
  const dunkStarts = summary.players.P1.dunkStarts + summary.players.P2.dunkStarts;
  const dunkHits = summary.players.P1.dunkHits + summary.players.P2.dunkHits;
  const launchToDunkSamples = playerIds
    .map((playerId) => flow.players[playerId].averageLaunchToDunkSeconds)
    .filter((value): value is number => value !== null);
  const launchToDunkSeconds = launchToDunkSamples.length > 0
    ? average(launchToDunkSamples)
    : null;
  const mostHelplessPlayer = flow.players.P1.helplessRatio >= flow.players.P2.helplessRatio
    ? 'P1' as const
    : 'P2' as const;
  const mostHelplessFlow = flow.players[mostHelplessPlayer];
  const mostHelplessRatio = mostHelplessFlow.helplessRatio;
  const helplessAttribution = mostHelplessFlow.helplessSecondsPerLaunchReceived === null
    ? `${mostHelplessFlow.launchHitsReceived} received launch hits; helpless duration per hit is unavailable`
    : `${mostHelplessFlow.launchHitsReceived} received launch hit${mostHelplessFlow.launchHitsReceived === 1 ? '' : 's'} at ${mostHelplessFlow.helplessSecondsPerLaunchReceived.toFixed(2)}s helpless per hit`;
  const helplessDurationDominant = mostHelplessFlow.helplessSecondsPerLaunchReceived === null
    || mostHelplessFlow.helplessSecondsPerLaunchReceived >= 3;
  const immediateRelaunchPlayers = playerIds.filter((playerId) => {
    const control = flow.players[playerId].controlReturn;
    return control.controlReturns >= 3
      && control.relaunchesWithinOneSecond >= 2
      && control.immediateRelaunchRatio >= 0.5;
  });
  const primaryImmediateRelaunchPlayer = [...immediateRelaunchPlayers].sort((first, second) => (
    flow.players[second].controlReturn.immediateRelaunchRatio
      - flow.players[first].controlReturn.immediateRelaunchRatio
    || flow.players[second].controlReturn.relaunchesWithinOneSecond
      - flow.players[first].controlReturn.relaunchesWithinOneSecond
    || first.localeCompare(second)
  ))[0] ?? null;
  const postControlResetFailurePlayers = playerIds.filter((playerId) => {
    const control = flow.players[playerId].controlReturn;
    return control.controlReturnsInPressure >= 3
      && control.controlReturnResetRatio < 0.35;
  });
  const primaryPostControlResetFailurePlayer = [...postControlResetFailurePlayers]
    .sort((first, second) => {
      const firstControl = flow.players[first].controlReturn;
      const secondControl = flow.players[second].controlReturn;
      return firstControl.controlReturnResetRatio - secondControl.controlReturnResetRatio
        || secondControl.controlReturnsInPressure - firstControl.controlReturnsInPressure
        || first.localeCompare(second);
    })[0] ?? null;
  const chaseFocusPlayer = primaryImmediateRelaunchPlayer
    ?? primaryPostControlResetFailurePlayer
    ?? mostHelplessPlayer;
  const chaseFocusAttacker = chaseFocusPlayer === 'P1' ? 'P2' as const : 'P1' as const;
  const chaseCharacterTargets: BalanceLabCharacterControlTarget[] = (
    primaryImmediateRelaunchPlayer !== null
    || primaryPostControlResetFailurePlayer !== null
    || mostHelplessRatio >= 0.3
  )
    ? [
      { playerId: chaseFocusAttacker, control: 'launch' },
      { playerId: chaseFocusPlayer, control: 'launch_break' },
      { playerId: chaseFocusPlayer, control: 'movement' },
      { playerId: chaseFocusAttacker, control: 'dunk' },
    ]
    : playerIds.flatMap((playerId): BalanceLabCharacterControlTarget[] => (
      summary.players[playerId].launchHits > 0
        ? [
          { playerId, control: 'launch' },
          { playerId, control: 'dunk' },
        ]
        : []
    ));
  const zeroFuelPlayers = playerIds.filter((playerId) => (
    flow.players[playerId].zeroFuelRatio >= 0.3
  ));
  const zeroFuelLaunchHits = flow.players.P1.zeroFuelTargetLaunchHits
    + flow.players.P2.zeroFuelTargetLaunchHits;
  const finishDunkStarts = flow.players.P1.finishDunkStarts + flow.players.P2.finishDunkStarts;
  const launchClashLoopBlocked = flow.launchClashes >= 6 && flow.clashesPerMinute >= 10;
  const launchClashLoopWatch = flow.launchClashes >= 4 && flow.clashesPerMinute >= 6;
  const sharedControlSampleReady = flow.sharedAgency.controlSeconds >= 5;
  const sharedAgencySampleReady = flow.sharedAgency.actionReadySeconds >= 5;

  let neutralStatus: BalanceLabLoopStageStatus = 'observed';
  let neutralDetail = `${flow.neutralResets} sustained spacing reset${flow.neutralResets === 1 ? '' : 's'}; ${flow.sharedAgency.sustainedNeutralWindows} shared action-ready window${flow.sharedAgency.sustainedNeutralWindows === 1 ? '' : 's'} lasted at least ${flow.sharedAgency.sustainedWindowThresholdSeconds.toFixed(2)}s.`;
  if (flow.elapsedSeconds < 10) {
    neutralStatus = 'waiting';
    neutralDetail = `Only ${flow.elapsedSeconds.toFixed(1)}s observed; wait for pressure and a credible disengagement.`;
  } else if (
    flow.elapsedSeconds >= 20
    && sharedAgencySampleReady
    && flow.sharedAgency.sustainedNeutralWindows === 0
    && flow.sharedAgency.pressureRatio >= 0.85
  ) {
    neutralStatus = 'blocked';
    neutralDetail = `No shared action-ready window lasted ${flow.sharedAgency.sustainedWindowThresholdSeconds.toFixed(2)}s; ${Math.round(flow.sharedAgency.pressureRatio * 100)}% of the ${flow.sharedAgency.actionReadySeconds.toFixed(1)}s where both fighters could commit remained in pressure.`;
  } else if (flow.pressureBandRatio >= 0.92 || flow.longestPressureSequenceSeconds >= 20) {
    neutralStatus = 'blocked';
    neutralDetail = `${Math.round(flow.pressureBandRatio * 100)}% pressure occupancy with a ${flow.longestPressureSequenceSeconds.toFixed(1)}s longest sequence leaves no reliable neutral loop.`;
  } else if (
    flow.pressureBandRatio >= 0.82
    || flow.longestPressureSequenceSeconds >= 12
    || (flow.elapsedSeconds >= 20 && flow.pressureEngagements >= 2 && flow.neutralResets === 0)
    || (
      sharedAgencySampleReady
      && flow.sharedAgency.sustainedNeutralWindows === 0
      && flow.sharedAgency.pressureRatio >= 0.65
    )
  ) {
    neutralStatus = 'watch';
    neutralDetail = `${Math.round(flow.pressureBandRatio * 100)}% pressure occupancy; ${flow.neutralResets} spacing resets, ${flow.sharedAgency.sustainedNeutralWindows} shared action-ready windows, and a ${flow.longestPressureSequenceSeconds.toFixed(1)}s longest pressure sequence.`;
  }

  let commitmentStatus: BalanceLabLoopStageStatus = 'observed';
  let commitmentDetail = playerIds.map((playerId) => (
    `${playerId} ${flow.players[playerId].acceptedTacticalActions.length}/6 actions, ${Math.round(flow.players[playerId].inputAcceptanceRatio * 100)}% accepted`
  )).join('; ');
  if (flow.elapsedSeconds < 10) {
    commitmentStatus = 'waiting';
    commitmentDetail = 'The sample is too short to judge whether both fighters are making varied, accepted commitments.';
  } else if (flow.elapsedSeconds >= 15 && noCommitmentPlayers.length > 0) {
    commitmentStatus = 'blocked';
    commitmentDetail = `${noCommitmentPlayers.join(' and ')} recorded no accepted tactical action starts.`;
  } else if (lowAcceptancePlayers.some((playerId) => (
    actionRequests(playerId) >= 8 && flow.players[playerId].inputAcceptanceRatio < 0.25
  ))) {
    commitmentStatus = 'blocked';
    commitmentDetail = `${lowAcceptancePlayers.join(' and ')} are requesting actions that the simulation rejects most of the time.`;
  } else if (
    commitmentSaturation
    && flow.sharedAgency.actionReadyShareOfControlFrames <= 0.1
    && flow.sharedAgency.controlPressureRatio >= 0.85
  ) {
    commitmentStatus = 'blocked';
    commitmentDetail = `${Math.round(flow.sharedAgency.controlPressureRatio * 100)}% of shared movement-control time remained in pressure while ${totalTacticalActionStarts} accepted tactical starts left both fighters simultaneously free to choose for only ${Math.round(flow.sharedAgency.actionReadyShareOfControlFrames * 100)}%.`;
  } else if (
    lowAcceptancePlayers.length > 0
    || (flow.elapsedSeconds >= 20 && narrowKitPlayers.length > 0)
    || repetitivePlayers.length > 0
    || commitmentSaturation
  ) {
    commitmentStatus = 'watch';
    const affectedPlayers = [...new Set([
      ...lowAcceptancePlayers,
      ...narrowKitPlayers,
      ...repetitivePlayers,
    ])];
    commitmentDetail = commitmentSaturation
      ? `${Math.round(flow.sharedAgency.controlPressureRatio * 100)}% of shared movement-control time remained in pressure while ${totalTacticalActionStarts} accepted tactical starts left both fighters simultaneously free to choose for only ${Math.round(flow.sharedAgency.actionReadyShareOfControlFrames * 100)}%; inspect cadence and controller decisions before changing move strength.`
      : `${affectedPlayers.join(' and ')} show rejected, narrow, or repetitive commitments; inspect controller decisions before changing damage or launch power.`;
  }

  let exchangeStatus: BalanceLabLoopStageStatus = 'observed';
  let exchangeDetail = `${resolvedExchanges}/${flow.exchanges.length} pressure exchanges produced a concrete outcome.`;
  if (flow.exchanges.length === 0) {
    exchangeStatus = 'waiting';
    exchangeDetail = 'No pressure exchange has formed yet.';
  } else if (launchClashLoopBlocked) {
    exchangeStatus = 'blocked';
    exchangeDetail = `${flow.launchClashes} launch clashes (${flow.clashesPerMinute.toFixed(1)}/min) are repeatedly resolving contact without producing varied outcomes or durable separation.`;
  } else if (launchClashLoopWatch) {
    exchangeStatus = 'watch';
    exchangeDetail = `${flow.launchClashes} launch clashes (${flow.clashesPerMinute.toFixed(1)}/min) may be replacing meaningful attack, defense, and chase decisions.`;
  } else if (
    flow.exchanges.length >= 6
    && unresolvedRatio >= 0.7
    && averageUnresolvedSeconds >= 1.5
  ) {
    exchangeStatus = 'blocked';
    exchangeDetail = `${unresolvedExchanges.length}/${flow.exchanges.length} exchanges produced no hit, clash, defense, special resolution, or finish.`;
  } else if (
    flow.exchanges.length >= 6
    && unresolvedRatio >= 0.3
    && averageUnresolvedSeconds >= 1.5
  ) {
    exchangeStatus = 'watch';
    exchangeDetail = `${unresolvedExchanges.length}/${flow.exchanges.length} exchanges are unresolved at ${averageUnresolvedSeconds.toFixed(1)}s average pressure.`;
  }

  let separationStatus: BalanceLabLoopStageStatus = 'observed';
  let separationDetail = `${Math.round(flow.contactRatio * 100)}% physical contact overall, ${Math.round(flow.sharedAgency.controlContactRatio * 100)}% while both could steer, and ${Math.round(flow.sharedAgency.contactRatio * 100)}% while both were action-ready; ${flow.resetOutcomes.all.successes}/${flow.resetOutcomes.all.attempts} defensive resets and ${briefExitCount} brief exits.`;
  if (
    flow.contactRatio >= 0.35
    || (
      sharedAgencySampleReady
      && flow.sharedAgency.contactRatio >= 0.45
      && flow.sharedAgency.maximumContactEpisodeSeconds >= 1.5
    )
    || (
      sharedControlSampleReady
      && flow.sharedAgency.controlContactRatio >= 0.4
    )
    || (flow.exchanges.length >= 6 && briefExitRatio >= 0.75)
    || (flow.resetOutcomes.all.attempts >= 3 && flow.resetOutcomes.all.successRatio < 0.2)
  ) {
    separationStatus = 'blocked';
    separationDetail = `${Math.round(flow.contactRatio * 100)}% physical contact overall, ${Math.round(flow.sharedAgency.controlContactRatio * 100)}% while both could steer, ${Math.round(flow.sharedAgency.contactRatio * 100)}% during shared action-ready time, and a ${flow.sharedAgency.maximumContactEpisodeSeconds.toFixed(2)}s longest action-ready contact episode; ${briefExitCount}/${flow.exchanges.length} brief exits and ${flow.resetOutcomes.all.successes}/${flow.resetOutcomes.all.attempts} defensive resets.`;
  } else if (
    flow.contactRatio >= 0.2
    || (
      sharedAgencySampleReady
      && (
        flow.sharedAgency.contactRatio >= 0.25
        || flow.sharedAgency.p90ContactEpisodeSeconds >= 0.75
      )
    )
    || (sharedControlSampleReady && flow.sharedAgency.controlContactRatio >= 0.25)
    || (flow.exchanges.length >= 6 && briefExitRatio >= 0.5)
    || (flow.resetOutcomes.all.attempts >= 3 && flow.resetOutcomes.all.successRatio < 0.35)
  ) {
    separationStatus = 'watch';
  } else if (flow.exchanges.length < 2 && flow.resetOutcomes.all.attempts === 0) {
    separationStatus = 'waiting';
    separationDetail = 'More than one exchange is needed to judge whether outcomes create space.';
  }

  let chaseStatus: BalanceLabLoopStageStatus = 'observed';
  let chaseDetail = `${launchHits} launch hit${launchHits === 1 ? '' : 's'}, ${dunkStarts} dunk start${dunkStarts === 1 ? '' : 's'}${launchToDunkSeconds === null ? '' : `, ${launchToDunkSeconds.toFixed(2)}s average launch-to-dunk`}.`;
  if (launchHits === 0) {
    chaseStatus = 'waiting';
    chaseDetail = 'No launch hit has created a chase state yet.';
  } else if (primaryImmediateRelaunchPlayer) {
    const control = flow.players[primaryImmediateRelaunchPlayer].controlReturn;
    const critical = mostHelplessRatio >= 0.5 || (
      control.controlReturns >= 4
      && control.relaunchesWithinOneSecond >= 3
      && control.immediateRelaunchRatio >= 0.7
    );
    chaseStatus = critical ? 'blocked' : 'watch';
    chaseDetail = `${primaryImmediateRelaunchPlayer} was launched again within 1s after ${control.relaunchesWithinOneSecond}/${control.controlReturns} control returns; ${control.relaunchesWithAcceptedAction}/${control.relaunchesAfterControlReturn} re-launches allowed an accepted action first; ${describePostReturnDecisions(control)}.`;
  } else if (primaryPostControlResetFailurePlayer) {
    const control = flow.players[primaryPostControlResetFailurePlayer].controlReturn;
    const critical = mostHelplessRatio >= 0.5 || (
      control.controlReturnsInPressure >= 4
      && control.sustainedResetsAfterControlReturn === 0
    );
    chaseStatus = critical ? 'blocked' : 'watch';
    chaseDetail = `${primaryPostControlResetFailurePlayer} regained control inside pressure ${control.controlReturnsInPressure} times, but only ${control.sustainedResetsAfterControlReturn}/${control.controlReturnsInPressure} returns created a sustained reset; ${describePostReturnDecisions(control)}.`;
  } else if (mostHelplessRatio >= 0.5) {
    chaseStatus = 'blocked';
    chaseDetail = `${mostHelplessPlayer} spent ${Math.round(mostHelplessRatio * 100)}% of the sample helpless after ${helplessAttribution}; compare hit frequency before changing global duration.`;
  } else if (zeroFuelLaunchHits > 0 && finishDunkStarts === 0) {
    chaseStatus = 'watch';
    chaseDetail = `${zeroFuelLaunchHits} launch hit${zeroFuelLaunchHits === 1 ? '' : 's'} created a finish chase against an empty target without an accepted finish-state dunk start.`;
  } else if (flow.elapsedSeconds < 10) {
    chaseStatus = 'waiting';
    chaseDetail = `${launchHits} launch hit${launchHits === 1 ? '' : 's'} created early chase evidence; continue observing before treating ${dunkStarts} dunk start${dunkStarts === 1 ? '' : 's'} as a pursuit failure.`;
  } else if (flow.elapsedSeconds >= 15 && launchHits >= 3 && dunkStarts === 0) {
    chaseStatus = 'blocked';
    chaseDetail = `${launchHits} launch hits over ${flow.elapsedSeconds.toFixed(1)}s produced no accepted dunk attempt.`;
  } else if (mostHelplessRatio >= 0.3 || (launchHits >= 2 && launchToDunkSeconds === null)) {
    chaseStatus = 'watch';
    chaseDetail = `${launchHits} launch hits; ${dunkStarts} dunk starts, with ${mostHelplessPlayer} helpless for ${Math.round(mostHelplessRatio * 100)}% after ${helplessAttribution}.`;
  }

  let finishStatus: BalanceLabLoopStageStatus = 'waiting';
  let finishDetail = 'No finish window has resolved yet; keep observing fuel depletion, launch, and dunk conversion.';
  if (flow.roundFinished) {
    finishStatus = 'observed';
    finishDetail = `${dunkHits} dunk hit${dunkHits === 1 ? '' : 's'} and a recorded round finish.`;
  } else if (
    (flow.elapsedSeconds >= 45 && dunkHits === 0)
    || (flow.elapsedSeconds >= 20 && zeroFuelPlayers.length > 0 && dunkHits === 0)
  ) {
    finishStatus = 'blocked';
    finishDetail = zeroFuelPlayers.length > 0
      ? `${zeroFuelPlayers.join(' and ')} spent substantial time empty without a converted dunk.`
      : `No dunk connected during ${flow.elapsedSeconds.toFixed(1)}s of play.`;
  } else if (zeroFuelLaunchHits > 0 && finishDunkStarts === 0) {
    finishStatus = 'watch';
    finishDetail = `${zeroFuelLaunchHits} launch hit${zeroFuelLaunchHits === 1 ? '' : 's'} on an empty target produced no finish-state dunk start.`;
  } else if (dunkHits > 0) {
    finishStatus = 'observed';
    finishDetail = `${dunkHits} dunk hit${dunkHits === 1 ? '' : 's'} connected; the current sample has not ended the round.`;
  } else if (dunkStarts > 0) {
    finishStatus = 'watch';
    finishDetail = `${dunkStarts} dunk attempt${dunkStarts === 1 ? '' : 's'} started without a connection yet.`;
  }

  return [
    {
      id: 'neutral',
      label: 'Neutral',
      status: neutralStatus,
      detail: neutralDetail,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
        'defensiveResetDistance',
        'defensiveResetImpulse',
      ],
      relatedCharacterControls: ['movement'],
      relatedAiBehavior: [
        'engagementDistanceScale',
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'commitmentObserveFrames',
        'commitmentResetFrames',
      ],
    },
    {
      id: 'commitment',
      label: 'Commitment',
      status: commitmentStatus,
      detail: commitmentDetail,
      relatedGlobalTuning: commitmentSaturation
        ? []
        : ['startupClashGraceSeconds', 'postControlCounterLaunchClashGraceSeconds'],
      relatedAiBehavior: [
        'reactionDelayScale',
        'postCommitmentDecisionScale',
        'riskAppetiteOffset',
        'commitmentObserveFrames',
        'commitmentPressFrames',
        'commitmentResetFrames',
        'opponentControlReturnObserveFrames',
        'repositionWeightScale',
        'launchWeightScale',
        'specialWeightScale',
        'dunkWeightScale',
        'parryWeightScale',
      ],
      relatedCharacterControls: ['movement', 'launch', 'special', 'dunk', 'parry'],
      relatedPlayerIds: [...new Set([
        ...noCommitmentPlayers,
        ...lowAcceptancePlayers,
        ...narrowKitPlayers,
        ...repetitivePlayers,
      ])],
    },
    {
      id: 'exchange',
      label: 'Exchange',
      status: exchangeStatus,
      detail: exchangeDetail,
      relatedGlobalTuning: [
        'startupClashGraceSeconds',
        'postControlCounterLaunchClashGraceSeconds',
        'launchClashSeparationPadding',
        'launchClashRecoilMultiplier',
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
      ],
      relatedCharacterControls: ['launch', 'special', 'parry'],
      relatedAiBehavior: [
        'reactionDelayScale',
        'postCommitmentDecisionScale',
        'commitmentPressFrames',
        'commitmentResetFrames',
        'postClashSpacingFrames',
      ],
    },
    {
      id: 'separation',
      label: 'Separation',
      status: separationStatus,
      detail: separationDetail,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'launchClashSeparationPadding',
        'launchClashRecoilMultiplier',
        'closeRangeSeparationPadding',
        'closeRangeSeparationImpulse',
        'closeRangeCommitSeparationMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'launchBreakResetMultiplier',
        'naturalRecoveryResetMultiplier',
      ],
      relatedCharacterControls: ['movement', 'parry', 'launch_break'],
      relatedAiBehavior: [
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'commitmentObserveFrames',
        'commitmentResetFrames',
        'postClashSpacingFrames',
        'postRecoverySpacingFrames',
        'postControlSteeringFrames',
        'postControlCounterstepScale',
        'opponentControlReturnObserveFrames',
        'postEventRetreatChanceOffset',
        'repositionWeightScale',
      ],
    },
    {
      id: 'chase',
      label: 'Chase',
      status: chaseStatus,
      detail: chaseDetail,
      relatedGlobalTuning: primaryImmediateRelaunchPlayer || primaryPostControlResetFailurePlayer
        ? [
          'naturalRecoveryResetMultiplier',
          'defensiveResetDistance',
          'defensiveResetImpulse',
        ]
        : helplessDurationDominant
          ? [
            'launchHelplessSeconds',
            'helplessReleaseSpeedRatio',
            'helplessVelocityDamping',
          ]
          : [],
      relatedCharacterTargets: chaseCharacterTargets,
      relatedAiBehavior: [
        'reactionDelayScale',
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'commitmentPressFrames',
        'commitmentResetFrames',
        'postRecoverySpacingFrames',
        'postControlSteeringFrames',
        'postControlCounterstepScale',
        'opponentControlReturnObserveFrames',
        'postEventRetreatChanceOffset',
        'postRecoverySuperBoostChance',
        'postRecoveryDefenseFrames',
        'postRecoveryDefensiveSpecialChance',
        'postRecoveryThreatParryChance',
        'committedLaunchGuardChance',
        'repositionWeightScale',
        'launchWeightScale',
        'dunkWeightScale',
        'launchBreakWeightScale',
      ],
      relatedPlayerIds: chaseStatus === 'watch' || chaseStatus === 'blocked'
        ? [chaseFocusPlayer]
        : undefined,
    },
    {
      id: 'finish',
      label: 'Finish',
      status: finishStatus,
      detail: finishDetail,
      relatedGlobalTuning: [
        'launchBasePower',
        'dunkRecoveryDurationSeconds',
        'dunkRecoveryMoveSpeed',
      ],
      relatedAiBehavior: ['finishPursuitReachScale', 'dunkWeightScale'],
      relatedCharacterControls: ['launch', 'dunk'],
      relatedPlayerIds: zeroFuelPlayers,
    },
  ];
}

export function aggregateBalanceLabLoopStages(
  flows: readonly BalanceLabFlowModel[],
): BalanceLabLoopStageAggregates {
  return Object.fromEntries(BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
    const statuses = flows.map((flow) => (
      flow.loopStages.find((stage) => stage.id === stageId)?.status ?? 'waiting'
    ));
    const waitingRounds = statuses.filter((status) => status === 'waiting').length;
    const observedRounds = statuses.filter((status) => status === 'observed').length;
    const watchRounds = statuses.filter((status) => status === 'watch').length;
    const blockedRounds = statuses.filter((status) => status === 'blocked').length;
    const rounds = statuses.length;
    return [stageId, {
      rounds,
      waitingRounds,
      observedRounds,
      watchRounds,
      blockedRounds,
      waitingRatio: roundMetric(waitingRounds / Math.max(1, rounds)),
      issueRatio: roundMetric((watchRounds + blockedRounds) / Math.max(1, rounds)),
    }];
  })) as BalanceLabLoopStageAggregates;
}

export function compareBalanceLabLoopStages(
  baseline: BalanceLabFlowModel,
  candidate: BalanceLabFlowModel,
): BalanceLabLoopStageComparison[] {
  const waitingStage = (stageId: BalanceLabLoopStageId): BalanceLabLoopStage => ({
    id: stageId,
    label: stageId.charAt(0).toUpperCase() + stageId.slice(1),
    status: 'waiting',
    detail: 'This stage was not reached in the captured sample.',
  });

  return BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
    const baselineStage = baseline.loopStages.find((stage) => stage.id === stageId)
      ?? waitingStage(stageId);
    const candidateStage = candidate.loopStages.find((stage) => stage.id === stageId)
      ?? waitingStage(stageId);
    return {
      stageId,
      label: candidateStage.label || baselineStage.label,
      baseline: baselineStage,
      candidate: candidateStage,
      statusChanged: baselineStage.status !== candidateStage.status,
    };
  });
}

export function compareBalanceLabFlows(
  baseline: BalanceLabFlowModel,
  candidate: BalanceLabFlowModel,
): BalanceLabFlowComparison {
  const shorterSample = Math.min(baseline.elapsedSeconds, candidate.elapsedSeconds);
  const longerSample = Math.max(baseline.elapsedSeconds, candidate.elapsedSeconds);
  const sampleDurationRatio = longerSample > 0 ? shorterSample / longerSample : 0;
  const baselineLaunchToDunk = averageLaunchToDunk(baseline);
  const candidateLaunchToDunk = averageLaunchToDunk(candidate);
  const baselineDominantShare = Math.max(
    baseline.players.P1.dominantTacticalActionShare,
    baseline.players.P2.dominantTacticalActionShare,
  );
  const candidateDominantShare = Math.max(
    candidate.players.P1.dominantTacticalActionShare,
    candidate.players.P2.dominantTacticalActionShare,
  );
  const baselineRepeatStreak = Math.max(
    baseline.players.P1.longestRepeatedActionStreak,
    baseline.players.P2.longestRepeatedActionStreak,
  );
  const candidateRepeatStreak = Math.max(
    candidate.players.P1.longestRepeatedActionStreak,
    candidate.players.P2.longestRepeatedActionStreak,
  );

  return {
    sampleDurationRatio: roundMetric(sampleDurationRatio),
    sampleDurationComparable: sampleDurationRatio >= 0.75,
    deltas: {
      contactRatioPoints: roundMetric((candidate.contactRatio - baseline.contactRatio) * 100, 2),
      sharedControlRatioPoints: roundMetric(
        (candidate.sharedAgency.controlRatio - baseline.sharedAgency.controlRatio) * 100,
        2,
      ),
      sharedControlContactRatioPoints: roundMetric(
        (candidate.sharedAgency.controlContactRatio
          - baseline.sharedAgency.controlContactRatio) * 100,
        2,
      ),
      sharedControlPressureRatioPoints: roundMetric(
        (candidate.sharedAgency.controlPressureRatio
          - baseline.sharedAgency.controlPressureRatio) * 100,
        2,
      ),
      sharedActionReadyRatioPoints: roundMetric(
        (candidate.sharedAgency.actionReadyRatio - baseline.sharedAgency.actionReadyRatio) * 100,
        2,
      ),
      sharedActionReadyShareOfControlPoints: roundMetric(
        (candidate.sharedAgency.actionReadyShareOfControlFrames
          - baseline.sharedAgency.actionReadyShareOfControlFrames) * 100,
        2,
      ),
      sharedContactRatioPoints: roundMetric(
        (candidate.sharedAgency.contactRatio - baseline.sharedAgency.contactRatio) * 100,
        2,
      ),
      sharedPressureRatioPoints: roundMetric(
        (candidate.sharedAgency.pressureRatio - baseline.sharedAgency.pressureRatio) * 100,
        2,
      ),
      sharedNeutralRatioPoints: roundMetric(
        (candidate.sharedAgency.neutralRatio - baseline.sharedAgency.neutralRatio) * 100,
        2,
      ),
      sharedSustainedNeutralWindows: candidate.sharedAgency.sustainedNeutralWindows
        - baseline.sharedAgency.sustainedNeutralWindows,
      sharedP90NeutralEpisodeSeconds: roundMetric(
        candidate.sharedAgency.p90NeutralEpisodeSeconds
          - baseline.sharedAgency.p90NeutralEpisodeSeconds,
        2,
      ),
      sharedMaximumContactEpisodeSeconds: roundMetric(
        candidate.sharedAgency.maximumContactEpisodeSeconds
          - baseline.sharedAgency.maximumContactEpisodeSeconds,
        2,
      ),
      p90ContactEpisodeSeconds: roundMetric(
        candidate.p90ContactEpisodeSeconds - baseline.p90ContactEpisodeSeconds,
        2,
      ),
      maximumContactEpisodeSeconds: roundMetric(
        candidate.maximumContactEpisodeSeconds - baseline.maximumContactEpisodeSeconds,
        2,
      ),
      pointBlankRatioPoints: roundMetric((candidate.pointBlankRatio - baseline.pointBlankRatio) * 100, 2),
      pressureBandRatioPoints: roundMetric((candidate.pressureBandRatio - baseline.pressureBandRatio) * 100, 2),
      launchClashesPerMinute: roundMetric(
        candidate.clashesPerMinute - baseline.clashesPerMinute,
        2,
      ),
      repeatClashRatioPoints: roundMetric(
        (candidate.clashFollowUp.repeatClashRatio
          - baseline.clashFollowUp.repeatClashRatio) * 100,
        2,
      ),
      p1ClashRapidLaunchRecommitRatioPoints: roundMetric(
        (candidate.clashFollowUp.players.P1.rapidLaunchRecommitRatio
          - baseline.clashFollowUp.players.P1.rapidLaunchRecommitRatio) * 100,
        2,
      ),
      p2ClashRapidLaunchRecommitRatioPoints: roundMetric(
        (candidate.clashFollowUp.players.P2.rapidLaunchRecommitRatio
          - baseline.clashFollowUp.players.P2.rapidLaunchRecommitRatio) * 100,
        2,
      ),
      p1ClashFirstActionDelaySeconds:
        candidate.clashFollowUp.players.P1.averageFirstActionDelaySeconds === null
          || baseline.clashFollowUp.players.P1.averageFirstActionDelaySeconds === null
          ? null
          : roundMetric(
            candidate.clashFollowUp.players.P1.averageFirstActionDelaySeconds
              - baseline.clashFollowUp.players.P1.averageFirstActionDelaySeconds,
            2,
          ),
      p2ClashFirstActionDelaySeconds:
        candidate.clashFollowUp.players.P2.averageFirstActionDelaySeconds === null
          || baseline.clashFollowUp.players.P2.averageFirstActionDelaySeconds === null
          ? null
          : roundMetric(
            candidate.clashFollowUp.players.P2.averageFirstActionDelaySeconds
              - baseline.clashFollowUp.players.P2.averageFirstActionDelaySeconds,
            2,
          ),
      neutralResetsPerMinute: roundMetric(
        candidate.neutralResetsPerMinute - baseline.neutralResetsPerMinute,
        2,
      ),
      resetConversionRatioPoints: roundMetric(
        (candidate.resetOutcomes.all.successRatio - baseline.resetOutcomes.all.successRatio) * 100,
        2,
      ),
      exchangeResolvedRatioPoints: roundMetric(
        (exchangeRatio(candidate, (exchange) => exchange.resolved)
          - exchangeRatio(baseline, (exchange) => exchange.resolved)) * 100,
        2,
      ),
      exchangeResetRatioPoints: roundMetric(
        (exchangeRatio(candidate, (exchange) => exchange.createdReset)
          - exchangeRatio(baseline, (exchange) => exchange.createdReset)) * 100,
        2,
      ),
      briefExitRatioPoints: roundMetric(
        (exchangeRatio(candidate, (exchange) => exchange.status === 'brief_exit')
          - exchangeRatio(baseline, (exchange) => exchange.status === 'brief_exit')) * 100,
        2,
      ),
      carriedBriefExitRatioPoints: roundMetric(
        (candidate.neutralExitFollowUp.carriedBriefExitRatio
          - baseline.neutralExitFollowUp.carriedBriefExitRatio) * 100,
        2,
      ),
      neutralFirstActionDelaySeconds:
        candidate.neutralExitFollowUp.averageFirstActionDelaySeconds === null
          || baseline.neutralExitFollowUp.averageFirstActionDelaySeconds === null
          ? null
          : roundMetric(
            candidate.neutralExitFollowUp.averageFirstActionDelaySeconds
              - baseline.neutralExitFollowUp.averageFirstActionDelaySeconds,
            2,
          ),
      p90PressureSequenceSeconds: roundMetric(
        candidate.p90PressureSequenceSeconds - baseline.p90PressureSequenceSeconds,
        2,
      ),
      longestUnresolvedPressureSeconds: roundMetric(
        longestUnresolvedPressure(candidate) - longestUnresolvedPressure(baseline),
        2,
      ),
      p1BreakEscapesPerMinute: roundMetric(
        candidate.players.P1.breakEscapesPerMinute - baseline.players.P1.breakEscapesPerMinute,
        2,
      ),
      p2BreakEscapesPerMinute: roundMetric(
        candidate.players.P2.breakEscapesPerMinute - baseline.players.P2.breakEscapesPerMinute,
        2,
      ),
      p1AcceptedActionsPerMinute: roundMetric(
        candidate.players.P1.acceptedActionsPerMinute - baseline.players.P1.acceptedActionsPerMinute,
        2,
      ),
      p2AcceptedActionsPerMinute: roundMetric(
        candidate.players.P2.acceptedActionsPerMinute - baseline.players.P2.acceptedActionsPerMinute,
        2,
      ),
      p1BreakReactionSeconds: roundMetric(
        candidate.players.P1.averageBreakReactionSeconds - baseline.players.P1.averageBreakReactionSeconds,
        2,
      ),
      p2BreakReactionSeconds: roundMetric(
        candidate.players.P2.averageBreakReactionSeconds - baseline.players.P2.averageBreakReactionSeconds,
        2,
      ),
      p1HelplessRatioPoints: roundMetric(
        (candidate.players.P1.helplessRatio - baseline.players.P1.helplessRatio) * 100,
        2,
      ),
      p2HelplessRatioPoints: roundMetric(
        (candidate.players.P2.helplessRatio - baseline.players.P2.helplessRatio) * 100,
        2,
      ),
      p1LaunchHitsReceivedPerMinute: roundMetric(
        ratePerMinute(candidate.players.P1.launchHitsReceived, candidate.elapsedSeconds)
          - ratePerMinute(baseline.players.P1.launchHitsReceived, baseline.elapsedSeconds),
        2,
      ),
      p2LaunchHitsReceivedPerMinute: roundMetric(
        ratePerMinute(candidate.players.P2.launchHitsReceived, candidate.elapsedSeconds)
          - ratePerMinute(baseline.players.P2.launchHitsReceived, baseline.elapsedSeconds),
        2,
      ),
      p1HelplessSecondsPerLaunchReceived:
        candidate.players.P1.helplessSecondsPerLaunchReceived === null
          || baseline.players.P1.helplessSecondsPerLaunchReceived === null
          ? null
          : roundMetric(
            candidate.players.P1.helplessSecondsPerLaunchReceived
              - baseline.players.P1.helplessSecondsPerLaunchReceived,
            2,
          ),
      p2HelplessSecondsPerLaunchReceived:
        candidate.players.P2.helplessSecondsPerLaunchReceived === null
          || baseline.players.P2.helplessSecondsPerLaunchReceived === null
          ? null
          : roundMetric(
            candidate.players.P2.helplessSecondsPerLaunchReceived
              - baseline.players.P2.helplessSecondsPerLaunchReceived,
            2,
          ),
      p1ImmediateRelaunchRatioPoints: roundMetric(
        (candidate.players.P1.controlReturn.immediateRelaunchRatio
          - baseline.players.P1.controlReturn.immediateRelaunchRatio) * 100,
        2,
      ),
      p2ImmediateRelaunchRatioPoints: roundMetric(
        (candidate.players.P2.controlReturn.immediateRelaunchRatio
          - baseline.players.P2.controlReturn.immediateRelaunchRatio) * 100,
        2,
      ),
      p1AverageControlWindowSeconds:
        candidate.players.P1.controlReturn.averageControlWindowSeconds === null
          || baseline.players.P1.controlReturn.averageControlWindowSeconds === null
          ? null
          : roundMetric(
            candidate.players.P1.controlReturn.averageControlWindowSeconds
              - baseline.players.P1.controlReturn.averageControlWindowSeconds,
            2,
          ),
      p2AverageControlWindowSeconds:
        candidate.players.P2.controlReturn.averageControlWindowSeconds === null
          || baseline.players.P2.controlReturn.averageControlWindowSeconds === null
          ? null
          : roundMetric(
            candidate.players.P2.controlReturn.averageControlWindowSeconds
              - baseline.players.P2.controlReturn.averageControlWindowSeconds,
            2,
          ),
      p1PostReturnResetRatioPoints: roundMetric(
        (candidate.players.P1.controlReturn.postReturnResetRatio
          - baseline.players.P1.controlReturn.postReturnResetRatio) * 100,
        2,
      ),
      p2PostReturnResetRatioPoints: roundMetric(
        (candidate.players.P2.controlReturn.postReturnResetRatio
          - baseline.players.P2.controlReturn.postReturnResetRatio) * 100,
        2,
      ),
      p1ControlReturnResetRatioPoints: roundMetric(
        (candidate.players.P1.controlReturn.controlReturnResetRatio
          - baseline.players.P1.controlReturn.controlReturnResetRatio) * 100,
        2,
      ),
      p2ControlReturnResetRatioPoints: roundMetric(
        (candidate.players.P2.controlReturn.controlReturnResetRatio
          - baseline.players.P2.controlReturn.controlReturnResetRatio) * 100,
        2,
      ),
      p1FirstActionDelaySeconds:
        candidate.players.P1.controlReturn.averageFirstActionDelaySeconds === null
          || baseline.players.P1.controlReturn.averageFirstActionDelaySeconds === null
          ? null
          : roundMetric(
            candidate.players.P1.controlReturn.averageFirstActionDelaySeconds
              - baseline.players.P1.controlReturn.averageFirstActionDelaySeconds,
            2,
          ),
      p2FirstActionDelaySeconds:
        candidate.players.P2.controlReturn.averageFirstActionDelaySeconds === null
          || baseline.players.P2.controlReturn.averageFirstActionDelaySeconds === null
          ? null
          : roundMetric(
            candidate.players.P2.controlReturn.averageFirstActionDelaySeconds
              - baseline.players.P2.controlReturn.averageFirstActionDelaySeconds,
            2,
          ),
      p1ZeroFuelRatioPoints: roundMetric(
        (candidate.players.P1.zeroFuelRatio - baseline.players.P1.zeroFuelRatio) * 100,
        2,
      ),
      p2ZeroFuelRatioPoints: roundMetric(
        (candidate.players.P2.zeroFuelRatio - baseline.players.P2.zeroFuelRatio) * 100,
        2,
      ),
      p1PointBlankApproachRatioPoints: roundMetric(
        (candidate.players.P1.movementIntent.contestedPointBlankApproachRatio
          - baseline.players.P1.movementIntent.contestedPointBlankApproachRatio) * 100,
        2,
      ),
      p2PointBlankApproachRatioPoints: roundMetric(
        (candidate.players.P2.movementIntent.contestedPointBlankApproachRatio
          - baseline.players.P2.movementIntent.contestedPointBlankApproachRatio) * 100,
        2,
      ),
      p1PressureRetreatRatioPoints: roundMetric(
        (candidate.players.P1.movementIntent.contestedPressureRetreatRatio
          - baseline.players.P1.movementIntent.contestedPressureRetreatRatio) * 100,
        2,
      ),
      p2PressureRetreatRatioPoints: roundMetric(
        (candidate.players.P2.movementIntent.contestedPressureRetreatRatio
          - baseline.players.P2.movementIntent.contestedPressureRetreatRatio) * 100,
        2,
      ),
      dominantTacticalActionSharePoints: roundMetric(
        (candidateDominantShare - baselineDominantShare) * 100,
        2,
      ),
      repeatedTacticalActionStreak: candidateRepeatStreak - baselineRepeatStreak,
      launchToDunkSeconds: baselineLaunchToDunk === null || candidateLaunchToDunk === null
        ? null
        : roundMetric(candidateLaunchToDunk - baselineLaunchToDunk, 2),
    },
  };
}

export function buildBalanceLabFlowModel(summary: MatchTelemetrySummary): BalanceLabFlowModel {
  const frames = Math.max(0, summary.framesSimulated);
  const elapsed = Math.max(0, summary.elapsedSeconds);
  const contactRatio = roundMetric(summary.spacing.contactFrames / Math.max(1, frames));
  const pointBlankRatio = roundMetric(summary.spacing.pointBlankFrames / Math.max(1, frames));
  const pressureBandRatio = roundMetric(summary.spacing.pressureBandFrames / Math.max(1, frames));
  const sharedReadyFrames = Math.max(0, summary.sharedAgency.actionReadyFrames);
  const sharedControlFrames = Math.max(0, summary.sharedAgency.controlFrames);
  const sharedControlContactFrames = Math.max(0, Math.min(
    summary.players.P1.movementIntent.contestedContactFrames,
    summary.players.P2.movementIntent.contestedContactFrames,
  ));
  const sharedControlPressureFrames = Math.max(0, Math.min(
    summary.players.P1.movementIntent.contestedPressureFrames,
    summary.players.P2.movementIntent.contestedPressureFrames,
  ));
  const sharedAgency: BalanceLabSharedAgencyFlow = {
    controlFrames: sharedControlFrames,
    controlSeconds: Math.max(0, summary.sharedAgency.controlSeconds),
    controlRatio: roundMetric(sharedControlFrames / Math.max(1, frames)),
    controlContactFrames: sharedControlContactFrames,
    controlContactRatio: roundMetric(
      sharedControlContactFrames / Math.max(1, sharedControlFrames),
    ),
    controlPressureFrames: sharedControlPressureFrames,
    controlPressureRatio: roundMetric(
      sharedControlPressureFrames / Math.max(1, sharedControlFrames),
    ),
    actionReadyFrames: sharedReadyFrames,
    actionReadySeconds: Math.max(0, summary.sharedAgency.actionReadySeconds),
    actionReadyRatio: roundMetric(sharedReadyFrames / Math.max(1, frames)),
    actionReadyShareOfControlFrames: roundMetric(
      sharedReadyFrames / Math.max(1, sharedControlFrames),
    ),
    contactFrames: Math.max(0, summary.sharedAgency.contactFrames),
    contactRatio: roundMetric(summary.sharedAgency.contactFrames / Math.max(1, sharedReadyFrames)),
    contactEpisodes: Math.max(0, summary.sharedAgency.contactEpisodeCount),
    p90ContactEpisodeSeconds: Math.max(0, summary.sharedAgency.p90ContactEpisodeSeconds),
    maximumContactEpisodeSeconds: Math.max(0, summary.sharedAgency.maximumContactEpisodeSeconds),
    pressureFrames: Math.max(0, summary.sharedAgency.pressureFrames),
    pressureRatio: roundMetric(summary.sharedAgency.pressureFrames / Math.max(1, sharedReadyFrames)),
    neutralFrames: Math.max(0, summary.sharedAgency.neutralFrames),
    neutralRatio: roundMetric(summary.sharedAgency.neutralFrames / Math.max(1, sharedReadyFrames)),
    neutralEpisodes: Math.max(0, summary.sharedAgency.neutralEpisodeCount),
    averageNeutralEpisodeSeconds: Math.max(0, summary.sharedAgency.averageNeutralEpisodeSeconds),
    p90NeutralEpisodeSeconds: Math.max(0, summary.sharedAgency.p90NeutralEpisodeSeconds),
    maximumNeutralEpisodeSeconds: Math.max(0, summary.sharedAgency.maximumNeutralEpisodeSeconds),
    sustainedNeutralWindowSeconds: Math.max(0, summary.sharedAgency.sustainedNeutralWindowSeconds),
    sustainedNeutralWindows: Math.max(0, summary.sharedAgency.sustainedNeutralWindowCount),
    sustainedWindowThresholdSeconds: MATCH_TELEMETRY_SUSTAINED_DECISION_WINDOW_SECONDS,
  };
  const pressureSequences = analysePressureSequences(summary);
  const spacingTimeline = buildSpacingTimeline(summary);
  const exchanges = buildExchangeReview(summary, spacingTimeline);
  const neutralExitFollowUp = analyseNeutralExitFollowUp(exchanges);
  const resetOutcomes = analyseResetOutcomes(summary);
  const launchClashes = summary.combat.eventCounts.launch_clash;
  const recoveryCounterLaunchClashes =
    summary.combat.launchClashCauses.post_control_counter_launch;
  const clashesPerMinute = ratePerMinute(launchClashes, elapsed);
  const clashFollowUp = analyseClashFollowUps(summary);
  const players: PlayersById<BalanceLabPlayerFlow> = {
    P1: buildPlayerFlow('P1', summary.players.P1, summary.combat.resources.P1, frames, elapsed, summary),
    P2: buildPlayerFlow('P2', summary.players.P2, summary.combat.resources.P2, frames, elapsed, summary),
  };
  const diagnostics: BalanceLabDiagnostic[] = [];
  const totalTacticalActionStarts = players.P1.tacticalActionStarts
    + players.P2.tacticalActionStarts;

  if (
    elapsed >= 15
    && sharedAgency.controlSeconds >= 5
    && totalTacticalActionStarts >= 8
    && sharedAgency.actionReadyShareOfControlFrames <= 0.3
    && sharedAgency.controlPressureRatio >= 0.75
  ) {
    diagnostics.push({
      id: 'commitment_saturation',
      severity: sharedAgency.actionReadyShareOfControlFrames <= 0.1
        && sharedAgency.controlPressureRatio >= 0.85
        ? 'critical'
        : 'warning',
      title: 'Commitments saturate shared pressure',
      detail: `Both fighters could steer for ${sharedAgency.controlSeconds.toFixed(1)}s, with ${Math.round(sharedAgency.controlPressureRatio * 100)}% of that time in pressure and ${Math.round(sharedAgency.controlContactRatio * 100)}% in physical contact. They were simultaneously free to start a fresh commitment for only ${Math.round(sharedAgency.actionReadyShareOfControlFrames * 100)}% of shared control while ${totalTacticalActionStarts} accepted tactical starts kept at least one fighter committed. Review cadence and decision policy before changing collision physics.`,
      relatedAiBehavior: [
        'reactionDelayScale',
        'postCommitmentDecisionScale',
        'commitmentObserveFrames',
        'commitmentPressFrames',
        'commitmentResetFrames',
        'launchWeightScale',
        'specialWeightScale',
        'dunkWeightScale',
        'parryWeightScale',
      ],
      relatedCharacterControls: ['launch', 'special', 'dunk', 'parry'],
      relatedPlayerIds: ['P1', 'P2'],
    });
  }

  for (const playerId of ['P1', 'P2'] as const) {
    const defense = players[playerId].launchDefense;
    const unansweredHitRatio = defense.unansweredLaunchHits
      / Math.max(1, defense.incomingPressureLaunches);
    if (
      defense.incomingPressureLaunches >= 4
      && defense.responseCoverageRatio < 0.35
      && unansweredHitRatio >= 0.4
    ) {
      diagnostics.push({
        id: 'defensive_read_gap',
        severity: unansweredHitRatio >= 0.65 ? 'critical' : 'warning',
        title: `${playerId} is not reading committed launches`,
        detail: `${playerId} answered ${defense.preemptiveResponses + defense.reactiveResponses}/${defense.incomingPressureLaunches} pressure-range launch commitments; ${defense.unansweredLaunchHits} became unanswered hits. Successful parries or clashes created ${defense.sustainedResetsAfterSuccessfulDefense}/${defense.successfulDefenses} sustained resets.`,
        relatedAiBehavior: [
          'reactionDelayScale',
          'postRecoveryDefenseFrames',
          'postRecoveryDefensiveSpecialChance',
          'postRecoveryThreatParryChance',
          'committedLaunchGuardChance',
          'parryWeightScale',
        ],
        relatedCharacterControls: ['parry', 'special', 'movement'],
        relatedCharacterTargets: [
          { playerId, control: 'parry' },
          { playerId, control: 'special' },
          { playerId, control: 'movement' },
        ],
        relatedPlayerIds: [playerId],
      });
    }
    const guardSuccessRatio = defense.successfulGuards / Math.max(1, defense.guardResponses);
    if (defense.guardResponses >= 3 && guardSuccessRatio < 0.25) {
      diagnostics.push({
        id: 'ineffective_guard_usage',
        severity: defense.guardResponses >= 5 && defense.successfulGuards === 0
          ? 'critical'
          : 'warning',
        title: `${playerId} is spending Guard outside useful timing`,
        detail: `${playerId} used an authored block guard against ${defense.guardResponses} incoming pressure launches, but stopped only ${defense.successfulGuards}. This is decision timing or threat-context evidence before it is move-strength evidence.`,
        relatedAiBehavior: [
          'reactionDelayScale',
          'postRecoveryDefensiveSpecialChance',
          'committedLaunchGuardChance',
          'specialWeightScale',
        ],
        relatedCharacterControls: ['special', 'movement'],
        relatedCharacterTargets: [
          { playerId, control: 'special' },
          { playerId, control: 'movement' },
        ],
        relatedPlayerIds: [playerId],
      });
    }
  }

  const p90ContactEpisodeSeconds = summary.spacing.p90ContactEpisodeSeconds;
  const maximumContactEpisodeSeconds = summary.spacing.maximumContactEpisodeSeconds;
  if (
    elapsed >= 10
    && (
      contactRatio >= 0.2
      || p90ContactEpisodeSeconds >= 1
      || maximumContactEpisodeSeconds >= 2
    )
  ) {
    diagnostics.push({
      id: 'contact_lock',
      severity: contactRatio >= 0.35
        || p90ContactEpisodeSeconds >= 1.5
        || maximumContactEpisodeSeconds >= 4
        ? 'critical'
        : 'warning',
      title: 'Contact lock',
      detail: `${Math.round(contactRatio * 100)}% of the round is at collision distance across ${summary.spacing.contactEpisodeCount} episodes; p90 ${p90ContactEpisodeSeconds.toFixed(2)}s, longest ${maximumContactEpisodeSeconds.toFixed(2)}s.`,
      relatedGlobalTuning: [
        'closeRangeSeparationPadding',
        'closeRangeSeparationImpulse',
        'closeRangeCommitSeparationMultiplier',
        'actionRecoveryControlMultiplier',
      ],
    });
  }
  if (elapsed >= 10 && pointBlankRatio >= 0.55) {
    diagnostics.push({
      id: 'point_blank_lock',
      severity: 'warning',
      title: 'Point-blank lock',
      detail: `${Math.round(pointBlankRatio * 100)}% of the round is inside the 12-unit close-range band; clashes, whiffs, or defensive actions are not resetting neutral enough.`,
      relatedGlobalTuning: [
        'launchClashSeparationPadding',
        'launchClashRecoilMultiplier',
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
        'defensiveResetDistance',
        'defensiveResetImpulse',
      ],
    });
  }
  if (elapsed >= 15 && launchClashes >= 4 && clashesPerMinute >= 6) {
    diagnostics.push({
      id: 'launch_clash_loop',
      severity: launchClashes >= 6 && clashesPerMinute >= 10 ? 'critical' : 'warning',
      title: 'Launch-clash loop',
      detail: `${launchClashes} launch clashes (${clashesPerMinute.toFixed(1)}/min), including ${recoveryCounterLaunchClashes} attributed recovery counter${recoveryCounterLaunchClashes === 1 ? '' : 's'}, are counting as exchange outcomes while repeatedly cancelling commitments. ${describeClashFollowUps(clashFollowUp)}. Compare the action mix and resulting separation before treating fewer hits as healthier play.`,
      relatedGlobalTuning: [
        'startupClashGraceSeconds',
        'postControlCounterLaunchClashGraceSeconds',
        'launchClashSeparationPadding',
        'launchClashRecoilMultiplier',
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
      ],
      relatedAiBehavior: [
        'reactionDelayScale',
        'postCommitmentDecisionScale',
        'postClashSpacingFrames',
        'postEventRetreatChanceOffset',
      ],
      relatedCharacterControls: ['launch', 'movement'],
      relatedPlayerIds: ['P1', 'P2'],
    });
  }
  if (elapsed >= 10 && pressureBandRatio >= 0.82) {
    diagnostics.push({
      id: 'pressure_lock',
      severity: 'warning',
      title: 'Pressure never releases',
      detail: `${Math.round(pressureBandRatio * 100)}% of the round is inside the pressure band, leaving little mid-range decision play.`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'launchBreakResetMultiplier',
        'naturalRecoveryResetMultiplier',
      ],
      relatedAiBehavior: [
        'engagementDistanceScale',
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'commitmentObserveFrames',
        'commitmentResetFrames',
      ],
    });
  }
  if (elapsed >= 12 && pressureSequences.longestSeconds >= 12) {
    diagnostics.push({
      id: 'pressure_sequence',
      severity: 'warning',
      title: 'Neutral reset drought',
      detail: `The longest uninterrupted pressure sequence is ${pressureSequences.longestSeconds.toFixed(1)}s. A clash or defensive exchange should create a clearer reset opportunity.`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
        'defensiveResetDistance',
        'defensiveResetImpulse',
      ],
      relatedAiBehavior: [
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'commitmentObserveFrames',
        'commitmentResetFrames',
        'postEventRetreatChanceOffset',
      ],
    });
  }
  if (
    elapsed >= 15
    && sharedAgency.actionReadySeconds >= 5
    && sharedAgency.sustainedNeutralWindows === 0
    && sharedAgency.pressureRatio >= 0.65
  ) {
    diagnostics.push({
      id: 'shared_decision_drought',
      severity: sharedAgency.pressureRatio >= 0.85 ? 'critical' : 'warning',
      title: 'No shared decision window',
      detail: `Both fighters were free to start a new commitment for ${sharedAgency.actionReadySeconds.toFixed(1)}s, but none of their outside-pressure windows lasted ${sharedAgency.sustainedWindowThresholdSeconds.toFixed(2)}s. ${Math.round(sharedAgency.pressureRatio * 100)}% of shared action-ready time remained in pressure. This distinguishes real neutral from helpless travel or move recovery.`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'naturalRecoveryResetMultiplier',
      ],
      relatedAiBehavior: [
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'postClashSpacingFrames',
        'postRecoverySpacingFrames',
        'postControlSteeringFrames',
        'postControlCounterstepScale',
        'opponentControlReturnObserveFrames',
        'postEventRetreatChanceOffset',
      ],
      relatedCharacterControls: ['movement'],
      relatedPlayerIds: ['P1', 'P2'],
    });
  }
  const closeRangePursuitPlayers = (['P1', 'P2'] as const).filter((playerId) => {
    const movement = players[playerId].movementIntent;
    return movement.contestedPointBlankFrames >= 180
      && movement.contestedPointBlankApproachRatio >= 0.32
      && movement.contestedPointBlankRetreatRatio <= 0.08;
  });
  if (elapsed >= 15 && closeRangePursuitPlayers.length > 0) {
    const detail = closeRangePursuitPlayers.map((playerId) => {
      const movement = players[playerId].movementIntent;
      return `${playerId} approached on ${Math.round(movement.contestedPointBlankApproachRatio * 100)}% and disengaged on ${Math.round(movement.contestedPointBlankRetreatRatio * 100)}% of point-blank frames where both fighters could act`;
    }).join('; ');
    diagnostics.push({
      id: 'close_range_pursuit',
      severity: 'warning',
      title: 'Point-blank pursuit loop',
      detail: `${detail}. Inspect AI spacing and retreat decisions before compensating with stronger collision separation or weaker attacks.`,
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
      relatedPlayerIds: closeRangePursuitPlayers,
    });
  }
  const contactPursuitPlayers = (['P1', 'P2'] as const).filter((playerId) => {
    const movement = players[playerId].movementIntent;
    return movement.contestedContactFrames >= 120
      && movement.contestedContactApproachRatio >= 0.35
      && movement.contestedContactRetreatRatio <= 0.08;
  });
  if (elapsed >= 15 && contactPursuitPlayers.length > 0) {
    const detail = contactPursuitPlayers.map((playerId) => {
      const movement = players[playerId].movementIntent;
      return `${playerId} kept approaching on ${Math.round(movement.contestedContactApproachRatio * 100)}% and disengaged on ${Math.round(movement.contestedContactRetreatRatio * 100)}% of collision frames where both fighters could act`;
    }).join('; ');
    diagnostics.push({
      id: 'contact_pursuit',
      severity: 'warning',
      title: 'Controller sustains body contact',
      detail: `${detail}. Tune spacing decisions before increasing collision impulse.`,
      relatedAiBehavior: [
        'neutralApproachScale',
        'neutralBoostDistanceOffset',
        'neutralHoldFrames',
        'neutralHoldDistance',
        'commitmentObserveFrames',
        'commitmentResetFrames',
        'postEventRetreatChanceOffset',
      ],
      relatedCharacterControls: ['movement'],
      relatedPlayerIds: contactPursuitPlayers,
    });
  }
  if (
    elapsed >= 15
    && resetOutcomes.all.attempts >= 3
    && resetOutcomes.all.successRatio < 0.35
  ) {
    diagnostics.push({
      id: 'failed_reset',
      severity: 'warning',
      title: 'Exchanges fail to reset',
      detail: `Only ${resetOutcomes.all.successes} of ${resetOutcomes.all.attempts} clashes, parries, or launch breaks created at least 0.75s outside pressure. Review separation impulse and post-action recovery.`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'launchBreakResetMultiplier',
      ],
      relatedCharacterControls: ['parry', 'launch_break'],
    });
  }
  const briefExitExchanges = exchanges.filter((exchange) => exchange.status === 'brief_exit');
  const briefExitRatio = briefExitExchanges.length / Math.max(1, exchanges.length);
  const carriedCauseSummary = Object.entries(neutralExitFollowUp.carriedBriefExitCauses)
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => (
      `${BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[cause as BalanceLabCarriedReentryCause]} ${count}`
    ))
    .join(', ') || 'none attributed';
  const dominantCarriedCause = BALANCE_LAB_CARRIED_REENTRY_CAUSES
    .map((cause) => ({
      cause,
      count: neutralExitFollowUp.carriedBriefExitCauses[cause],
    }))
    .sort((left, right) => right.count - left.count)[0];
  const carriedCauseGuidance = dominantCarriedCause?.count
    ? dominantCarriedCause.cause === 'held_approach'
      ? 'Held approach is the main cause, so inspect AI pursuit and spacing policy before changing recovery or separation physics.'
      : dominantCarriedCause.cause === 'held_boost'
        ? 'Held boost is the main cause, so inspect boost commitment and release policy before changing recovery physics.'
        : dominantCarriedCause.cause === 'action_recovery_momentum'
          ? 'Action-recovery momentum is the main cause, so recovery control and post-commitment damping are the relevant physics levers.'
          : dominantCarriedCause.cause === 'uncontrolled_momentum'
            ? 'Uncontrolled launch momentum is the main cause, so helpless release and velocity damping are the relevant physics levers.'
            : dominantCarriedCause.cause === 'residual_velocity'
              ? 'Residual closing velocity is the main cause, so movement damping and separation impulse are the relevant physics levers.'
              : 'The transition lacks enough movement context to attribute the loop; capture a current-schema sample before tuning physics.'
    : 'No carried re-entry cause was observed in this sample.';
  let carriedCauseAiBehavior: readonly BalanceLabAiBehaviorControl[] = [];
  if (dominantCarriedCause?.count) {
    switch (dominantCarriedCause.cause) {
      case 'held_approach':
        carriedCauseAiBehavior = [
          'engagementDistanceScale',
          'neutralApproachScale',
          'neutralBoostDistanceOffset',
          'neutralHoldFrames',
          'neutralHoldDistance',
          'commitmentObserveFrames',
          'commitmentResetFrames',
          'postEventRetreatChanceOffset',
        ];
        break;
      case 'held_boost':
        carriedCauseAiBehavior = [
          'neutralBoostDistanceOffset',
          'neutralHoldFrames',
          'neutralHoldDistance',
          'commitmentObserveFrames',
          'commitmentResetFrames',
          'postEventRetreatChanceOffset',
        ];
        break;
      case 'action_recovery_momentum':
        carriedCauseAiBehavior = [
          'postRecoverySpacingFrames',
          'postControlSteeringFrames',
          'opponentControlReturnObserveFrames',
          'commitmentResetFrames',
          'postEventRetreatChanceOffset',
        ];
        break;
      case 'uncontrolled_momentum':
        carriedCauseAiBehavior = [
          'launchBreakWeightScale',
          'postRecoverySuperBoostChance',
        ];
        break;
      case 'residual_velocity':
        carriedCauseAiBehavior = [
          'neutralHoldFrames',
          'commitmentResetFrames',
          'postClashSpacingFrames',
          'postRecoverySpacingFrames',
          'postControlSteeringFrames',
          'opponentControlReturnObserveFrames',
        ];
        break;
      default:
        break;
    }
  }
  if (elapsed >= 15 && exchanges.length >= 6 && briefExitRatio >= 0.5) {
    diagnostics.push({
      id: 'brief_exit_loop',
      severity: briefExitRatio >= 0.75 ? 'critical' : 'warning',
      title: 'Immediate re-engagement loop',
      detail: `${briefExitExchanges.length} of ${exchanges.length} pressure phases left close range for less than 0.75s; ${neutralExitFollowUp.briefExitsWithoutAcceptedAction}/${neutralExitFollowUp.briefExits} brief exits resumed without any newly accepted action (${carriedCauseSummary}). The fighters are crossing the spacing threshold and snapping straight back in instead of creating a decision window. ${carriedCauseGuidance}`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'closeRangeSeparationImpulse',
        'closeRangeCommitSeparationMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
      ],
      relatedAiBehavior: carriedCauseAiBehavior,
      relatedCharacterControls: ['movement'],
    });
  }
  const unresolvedExchanges = exchanges.filter((exchange) => !exchange.resolved);
  const unresolvedRatio = unresolvedExchanges.length / Math.max(1, exchanges.length);
  const averageUnresolvedPressureSeconds = average(
    unresolvedExchanges.map((exchange) => exchange.pressureSeconds),
  );
  if (
    elapsed >= 15
    && exchanges.length >= 6
    && unresolvedRatio >= 0.3
    && averageUnresolvedPressureSeconds >= 1.5
  ) {
    diagnostics.push({
      id: 'unresolved_exchange_loop',
      severity: unresolvedRatio >= 0.7 ? 'critical' : 'warning',
      title: 'Pressure without outcomes',
      detail: `${unresolvedExchanges.length} of ${exchanges.length} pressure phases produced no clash, hit, parry, launch break, resolved special, or finish (${averageUnresolvedPressureSeconds.toFixed(1)}s average). Inspect accepted actions and AI state transitions before changing move strength.`,
    });
  }
  const automaticBreakPlayers = (['P1', 'P2'] as const).filter((playerId) => (
    players[playerId].breakEscapes >= 3
    && players[playerId].averageBreakReactionSeconds < 0.12
  ));
  if (elapsed >= 15 && automaticBreakPlayers.length > 0) {
    const breakDetails = automaticBreakPlayers.map((playerId) => (
      `${playerId} used ${players[playerId].breakEscapes} breaks at ${players[playerId].averageBreakReactionSeconds.toFixed(2)}s average reaction`
    ));
    diagnostics.push({
      id: 'automatic_launch_break',
      severity: 'warning',
      title: 'Automatic launch-break spending',
      detail: `${breakDetails.join('; ')}. The escape resource is being spent before a bait, chase, or boundary threat can develop.`,
      relatedAiBehavior: ['launchBreakWeightScale', 'reactionDelayScale'],
      relatedCharacterControls: ['launch_break'],
      relatedPlayerIds: automaticBreakPlayers,
    });
  }
  if (elapsed >= 10 && hasEitherPlayer(players, (player) => {
    const requests = Object.values(player.actionAcceptance).reduce(
      (total, action) => total + action.presses,
      0,
    );
    return requests >= 4 && player.inputAcceptanceRatio < 0.45;
  })) {
    const worstRejectedAction = (['P1', 'P2'] as const)
      .flatMap((playerId) => (
        Object.entries(players[playerId].actionAcceptance).map(([action, acceptance]) => ({
          playerId,
          action: action as BalanceLabInputAction,
          acceptance,
        }))
      ))
      .filter((candidate) => candidate.acceptance.rejectedPresses > 0)
      .sort((first, second) => (
        second.acceptance.rejectedPresses - first.acceptance.rejectedPresses
        || first.acceptance.acceptanceRatio - second.acceptance.acceptanceRatio
        || first.playerId.localeCompare(second.playerId)
        || first.action.localeCompare(second.action)
      ))[0];
    diagnostics.push({
      id: 'input_churn',
      severity: 'warning',
      title: 'Rejected-input churn',
      detail: worstRejectedAction
        ? `${worstRejectedAction.playerId} ${worstRejectedAction.action.replace('_', ' ')} accepted ${worstRejectedAction.acceptance.starts}/${worstRejectedAction.acceptance.presses} requests (${Math.round(worstRejectedAction.acceptance.acceptanceRatio * 100)}%). Check control state, affordability, cooldown awareness, and action commitment.`
        : 'At least one agent is having fewer than 45% of combat button presses accepted. Check control state, affordability, cooldown awareness, and action commitment.',
      relatedAiBehavior: [
        'reactionDelayScale',
        'riskAppetiteOffset',
      ],
      relatedCharacterControls: worstRejectedAction
        ? [characterControlForAction(worstRejectedAction.action)].filter(
          (focus): focus is BalanceLabCharacterControlFocus => focus !== null,
        )
        : undefined,
      relatedPlayerIds: worstRejectedAction ? [worstRejectedAction.playerId] : undefined,
    });
  }
  const lowActionVarietyPlayers = (['P1', 'P2'] as const).filter(
    (playerId) => players[playerId].acceptedTacticalActions.length < 3,
  );
  if (elapsed >= 20 && lowActionVarietyPlayers.length > 0) {
    diagnostics.push({
      id: 'low_action_variety',
      severity: 'warning',
      title: 'Narrow tactical loop',
      detail: 'At least one fighter has used fewer than three accepted tactical action types. Review AI state awareness before strengthening the unused moves.',
      relatedAiBehavior: [
        'launchWeightScale',
        'specialWeightScale',
        'dunkWeightScale',
        'parryWeightScale',
      ],
      relatedPlayerIds: lowActionVarietyPlayers,
    });
  }
  const repetitivePlayer = (['P1', 'P2'] as const).find((playerId) => {
    const player = players[playerId];
    return player.tacticalActionStarts >= 8
      && (player.dominantTacticalActionShare >= 0.72 || player.longestRepeatedActionStreak >= 6);
  });
  if (elapsed >= 20 && repetitivePlayer) {
    const repeatedFocus = characterControlForAction(players[repetitivePlayer].dominantTacticalAction);
    diagnostics.push({
      id: 'repetitive_action_loop',
      severity: 'warning',
      title: 'Repetitive tactical loop',
      detail: 'At least one fighter is overusing a single tactical action or repeating the same action six times in sequence. Review state transitions and counterplay recognition.',
      relatedAiBehavior: [
        'reactionDelayScale',
        'riskAppetiteOffset',
      ],
      relatedCharacterControls: repeatedFocus ? [repeatedFocus] : undefined,
      relatedPlayerIds: [repetitivePlayer],
    });
  }
  const immediateRelaunchPlayers = (['P1', 'P2'] as const).filter((playerId) => {
    const control = players[playerId].controlReturn;
    return control.controlReturns >= 3
      && control.relaunchesWithinOneSecond >= 2
      && control.immediateRelaunchRatio >= 0.5;
  });
  if (elapsed >= 15 && immediateRelaunchPlayers.length > 0) {
    const critical = immediateRelaunchPlayers.some((playerId) => {
      const control = players[playerId].controlReturn;
      return control.controlReturns >= 4
        && control.relaunchesWithinOneSecond >= 3
        && control.immediateRelaunchRatio >= 0.7;
    });
    const detail = immediateRelaunchPlayers.map((playerId) => {
      const control = players[playerId].controlReturn;
      const averageWindow = control.averageControlWindowSeconds === null
        ? 'no completed re-launch window'
        : `${control.averageControlWindowSeconds.toFixed(2)}s average control window`;
      return `${playerId} was re-launched within 1s after ${control.relaunchesWithinOneSecond}/${control.controlReturns} returns (${averageWindow}); ${control.relaunchesWithAcceptedAction}/${control.relaunchesAfterControlReturn} re-launches allowed an accepted action first; ${describePostReturnDecisions(control)}`;
    }).join('; ');
    diagnostics.push({
      id: 'immediate_relaunch_loop',
      severity: critical ? 'critical' : 'warning',
      title: 'Immediate re-launch loop',
      detail: `${detail}. Inspect the returning fighter's movement and break choices alongside the attacker's launch cadence before changing global helpless duration.`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'launchBreakResetMultiplier',
        'naturalRecoveryResetMultiplier',
      ],
      relatedAiBehavior: [
        'postRecoverySpacingFrames',
        'postControlSteeringFrames',
        'postControlCounterstepScale',
        'opponentControlReturnObserveFrames',
        'postEventRetreatChanceOffset',
        'postRecoveryDefenseFrames',
        'postRecoveryDefensiveSpecialChance',
        'postRecoveryThreatParryChance',
        'committedLaunchGuardChance',
        'repositionWeightScale',
        'launchBreakWeightScale',
      ],
      relatedCharacterTargets: immediateRelaunchPlayers.flatMap((playerId) => {
        const attackerId = playerId === 'P1' ? 'P2' as const : 'P1' as const;
        return [
          { playerId: attackerId, control: 'launch' as const },
          { playerId, control: 'movement' as const },
          { playerId, control: 'launch_break' as const },
        ];
      }),
      relatedPlayerIds: immediateRelaunchPlayers,
    });
  }
  const postControlResetFailurePlayers = (['P1', 'P2'] as const).filter((playerId) => {
    const control = players[playerId].controlReturn;
    return !immediateRelaunchPlayers.includes(playerId)
      && control.controlReturnsInPressure >= 3
      && control.controlReturnResetRatio < 0.35;
  });
  if (elapsed >= 15 && postControlResetFailurePlayers.length > 0) {
    const critical = postControlResetFailurePlayers.some((playerId) => {
      const control = players[playerId].controlReturn;
      return control.controlReturnsInPressure >= 4
        && control.sustainedResetsAfterControlReturn === 0;
    });
    const detail = postControlResetFailurePlayers.map((playerId) => {
      const control = players[playerId].controlReturn;
      return `${playerId} created ${control.sustainedResetsAfterControlReturn}/${control.controlReturnsInPressure} sustained resets after regaining control inside pressure; ${describePostReturnDecisions(control)}`;
    }).join('; ');
    diagnostics.push({
      id: 'post_control_reset_failure',
      severity: critical ? 'critical' : 'warning',
      title: 'Post-control reset failure',
      detail: `${detail}. A delayed re-launch is not healthier if the returning fighter still cannot establish a durable decision window.`,
      relatedGlobalTuning: [
        'actionRecoveryControlMultiplier',
        'defensiveResetDistance',
        'defensiveResetImpulse',
        'launchBreakResetMultiplier',
        'naturalRecoveryResetMultiplier',
      ],
      relatedAiBehavior: [
        'postRecoverySpacingFrames',
        'postControlSteeringFrames',
        'postControlCounterstepScale',
        'opponentControlReturnObserveFrames',
        'postEventRetreatChanceOffset',
        'postRecoverySuperBoostChance',
        'postRecoveryDefenseFrames',
        'postRecoveryDefensiveSpecialChance',
        'postRecoveryThreatParryChance',
        'committedLaunchGuardChance',
        'launchWeightScale',
        'repositionWeightScale',
        'launchBreakWeightScale',
      ],
      relatedCharacterTargets: postControlResetFailurePlayers.flatMap((playerId) => {
        const attackerId = playerId === 'P1' ? 'P2' as const : 'P1' as const;
        return [
          { playerId: attackerId, control: 'launch' as const },
          { playerId, control: 'movement' as const },
          { playerId, control: 'launch_break' as const },
        ];
      }),
      relatedPlayerIds: postControlResetFailurePlayers,
    });
  }
  const mostHelpless = players.P1.helplessRatio >= players.P2.helplessRatio
    ? { playerId: 'P1' as const, ratio: players.P1.helplessRatio }
    : { playerId: 'P2' as const, ratio: players.P2.helplessRatio };
  if (elapsed >= 15 && mostHelpless.ratio >= 0.3) {
    const target = players[mostHelpless.playerId];
    const attackerId = mostHelpless.playerId === 'P1' ? 'P2' as const : 'P1' as const;
    const launchAttribution = target.helplessSecondsPerLaunchReceived === null
      ? `${target.launchHitsReceived} received launch hits with no duration-per-hit attribution`
      : `${target.launchHitsReceived} received launch hit${target.launchHitsReceived === 1 ? '' : 's'} at ${target.helplessSecondsPerLaunchReceived.toFixed(2)}s helpless per hit`;
    const durationDominant = target.helplessSecondsPerLaunchReceived === null
      || target.helplessSecondsPerLaunchReceived >= 3;
    diagnostics.push({
      id: 'helpless_lock',
      severity: mostHelpless.ratio >= 0.5 ? 'critical' : 'warning',
      title: 'Launch-state lock',
      detail: `${mostHelpless.playerId} spent ${Math.round(mostHelpless.ratio * 100)}% of the round without control after ${launchAttribution}. Compare received-hit frequency with duration per hit before tuning recovery.`,
      relatedGlobalTuning: durationDominant
        ? [
          'launchHelplessSeconds',
          'helplessReleaseSpeedRatio',
          'helplessVelocityDamping',
        ]
        : [],
      relatedCharacterTargets: [
        { playerId: attackerId, control: 'launch' },
        { playerId: mostHelpless.playerId, control: 'launch_break' },
        { playerId: mostHelpless.playerId, control: 'movement' },
      ],
      relatedPlayerIds: [mostHelpless.playerId],
    });
  }
  const totalDunkHits = summary.players.P1.dunkHits + summary.players.P2.dunkHits;
  const totalDunkStarts = summary.players.P1.dunkStarts + summary.players.P2.dunkStarts;
  const totalLaunchHits = summary.players.P1.launchHits + summary.players.P2.launchHits;
  const zeroFuelPlayers = (['P1', 'P2'] as const).filter(
    (playerId) => players[playerId].zeroFuelRatio >= 0.3,
  );
  if (
    elapsed >= 20
    && totalDunkHits === 0
    && zeroFuelPlayers.length > 0
  ) {
    diagnostics.push({
      id: 'zero_fuel_stall',
      severity: 'critical',
      title: 'Zero-fuel stall',
      detail: 'A fighter has spent at least 30% of the round empty, but neither side has converted a dunk. Review chase, launch release, and finish windows.',
      relatedAiBehavior: ['launchWeightScale', 'finishPursuitReachScale', 'dunkWeightScale'],
      relatedCharacterControls: ['launch', 'dunk'],
      relatedPlayerIds: zeroFuelPlayers,
    });
  }
  if (elapsed >= 20 && totalLaunchHits >= 3 && totalDunkStarts === 0) {
    const launchHitPlayers = (['P1', 'P2'] as const).filter(
      (playerId) => summary.players[playerId].launchHits > 0,
    );
    diagnostics.push({
      id: 'finish_pipeline_missing',
      severity: 'warning',
      title: 'Launches do not become finishes',
      detail: `${totalLaunchHits} launch hits have connected without a single accepted dunk start. Review finish recognition, chase spacing, and dunk commitment.`,
      relatedAiBehavior: ['finishPursuitReachScale', 'dunkWeightScale', 'reactionDelayScale'],
      relatedCharacterControls: ['launch', 'dunk'],
      relatedPlayerIds: launchHitPlayers,
    });
  }
  const roundFinished = summary.combat.eventCounts.round_end > 0;
  if (elapsed >= 45 && !roundFinished && totalDunkHits === 0) {
    diagnostics.push({
      id: 'finish_risk',
      severity: 'critical',
      title: 'Round finish risk',
      detail: 'No dunk has connected after 45 seconds. The loop is generating activity without progressing toward its win condition.',
      relatedAiBehavior: ['launchWeightScale', 'finishPursuitReachScale', 'dunkWeightScale'],
      relatedCharacterControls: ['launch', 'dunk'],
      relatedPlayerIds: ['P1', 'P2'],
    });
  }
  const flow: BalanceLabFlowEvidence = {
    elapsedSeconds: roundMetric(elapsed, 2),
    averageDistance: roundMetric(summary.spacing.averageDistance, 2),
    contactRatio,
    contactEpisodes: summary.spacing.contactEpisodeCount,
    averageContactEpisodeSeconds: summary.spacing.averageContactEpisodeSeconds,
    p90ContactEpisodeSeconds,
    maximumContactEpisodeSeconds,
    pointBlankRatio,
    pressureBandRatio,
    sharedAgency,
    launchClashes,
    clashesPerMinute,
    clashFollowUp,
    pressureEngagements: pressureSequences.engagements,
    firstPressureSeconds: pressureSequences.firstPressureSeconds,
    neutralResets: pressureSequences.neutralResets,
    neutralResetsPerMinute: ratePerMinute(pressureSequences.neutralResets, elapsed),
    averagePressureSequenceSeconds: pressureSequences.averageSeconds,
    p90PressureSequenceSeconds: pressureSequences.p90Seconds,
    longestPressureSequenceSeconds: pressureSequences.longestSeconds,
    averageNeutralWindowSeconds: pressureSequences.averageNeutralSeconds,
    longestNeutralWindowSeconds: pressureSequences.longestNeutralSeconds,
    resetOutcomes,
    neutralExitFollowUp,
    roundFinished,
    spacingTimeline,
    moments: buildFlowMoments(summary),
    exchanges,
    players,
    diagnostics,
  };
  const loopStages = buildBalanceLabLoopStages(summary, flow);
  if (diagnostics.length === 0 && elapsed >= 10) {
    const blockedStages = loopStages.filter((stage) => stage.status === 'blocked');
    const watchStages = loopStages.filter((stage) => stage.status === 'watch');
    const issueStages = blockedStages.length > 0 ? blockedStages : watchStages;
    const primaryIssue = issueStages[0];
    if (primaryIssue) {
      diagnostics.push({
        id: 'loop_stage_issue',
        severity: blockedStages.length > 0 ? 'critical' : 'warning',
        title: blockedStages.length > 0
          ? 'Gameplay loop stage blocked'
          : 'Gameplay loop stage needs review',
        detail: `${issueStages.map((stage) => stage.label).join(', ')}: ${primaryIssue.detail}`,
        relatedGlobalTuning: primaryIssue.relatedGlobalTuning,
        relatedAiBehavior: primaryIssue.relatedAiBehavior,
        relatedCharacterControls: primaryIssue.relatedCharacterControls,
        relatedCharacterTargets: primaryIssue.relatedCharacterTargets,
        relatedPlayerIds: primaryIssue.relatedPlayerIds,
      });
    } else if (elapsed < 30 && !roundFinished) {
      diagnostics.push({
        id: 'sample_maturing',
        severity: 'info',
        title: 'Early sample: keep observing',
        detail: `Only ${elapsed.toFixed(1)}s has been captured and the round has not finished. Continue to 30s or a round end before treating the absence of a warning as evidence about the full neutral-to-finish loop.`,
      });
    } else {
      diagnostics.push({
        id: 'healthy_flow',
        severity: 'info',
        title: 'No obvious flow pathology',
        detail: 'Spacing, accepted actions, fuel state, and finishing activity are inside the current local heuristics. Review the replay before treating this as balanced.',
      });
    }
  }
  return {
    ...flow,
    loopStages,
  };
}

export function createBalanceLabDraft(
  name: string,
  tuning: GameTuning,
  characterBalanceOverrides: CharacterBalanceOverrides = {},
  savedAt = new Date().toISOString(),
  aiBehaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning(),
): BalanceLabDraft {
  const sanitised = sanitiseTuning(tuning);
  const sanitisedOverrides = sanitiseCharacterBalanceOverrides(characterBalanceOverrides);
  const sanitisedAiBehavior = sanitiseAiBehaviorTuning(aiBehaviorTuning);
  return {
    schemaVersion: BALANCE_LAB_DRAFT_SCHEMA_VERSION,
    name: name.trim() || 'Local Draft',
    savedAt,
    tuningFingerprint: fingerprintBalanceTuning(sanitised),
    tuning: sanitised,
    characterBalanceFingerprint: fingerprintCharacterBalanceOverrides(sanitisedOverrides),
    characterBalanceOverrides: sanitisedOverrides,
    aiBehaviorFingerprint: fingerprintAiBehaviorTuning(sanitisedAiBehavior),
    aiBehaviorTuning: sanitisedAiBehavior,
  };
}

const LEGACY_REQUIRED_TUNING_KEYS = [
  'chainWindowSeconds',
  'playerMoveAccel',
  'playerVelocityDamping',
  'helplessVelocityDamping',
  'boostHoldSpeed',
  'superBoostHoldSpeed',
  'superBoostSteerLerp',
  'superBoostVelocityBlend',
  'superBoostWaveAmplitude',
  'superBoostFuelMultiplier',
  'launchBasePower',
  'launchChainBonus',
  'launchInputInfluence',
  'launchHelplessSeconds',
  'dunkRecoveryDurationSeconds',
  'dunkRecoveryMoveSpeed',
  'dunkRecoveryFuelFraction',
] as const satisfies readonly (keyof GameTuning)[];

export function parseBalanceLabDraft(value: unknown): BalanceLabDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const isCurrentDraft = record.schemaVersion === BALANCE_LAB_DRAFT_SCHEMA_VERSION;
  const isPreviousDraft = record.schemaVersion === PREVIOUS_BALANCE_LAB_DRAFT_SCHEMA_VERSION;
  const isLegacyDraft = record.schemaVersion === LEGACY_BALANCE_LAB_DRAFT_SCHEMA_VERSION;
  if ((!isCurrentDraft && !isPreviousDraft && !isLegacyDraft) || typeof record.name !== 'string') {
    return null;
  }
  if (!record.tuning || typeof record.tuning !== 'object' || Array.isArray(record.tuning)) {
    return null;
  }
  const tuningRecord = record.tuning as Record<string, unknown>;
  for (const key of LEGACY_REQUIRED_TUNING_KEYS) {
    if (typeof tuningRecord[key] !== 'number' || !Number.isFinite(tuningRecord[key])) {
      return null;
    }
  }
  const defaults = createDefaultTuning();
  for (const key of Object.keys(defaults) as Array<keyof GameTuning>) {
    if (
      Object.prototype.hasOwnProperty.call(tuningRecord, key)
      && (typeof tuningRecord[key] !== 'number' || !Number.isFinite(tuningRecord[key]))
    ) {
      return null;
    }
  }
  const tuning = sanitiseTuning({
    ...defaults,
    ...tuningRecord,
  });
  if (
    (isCurrentDraft || isPreviousDraft)
    && (!record.characterBalanceOverrides
      || typeof record.characterBalanceOverrides !== 'object'
      || Array.isArray(record.characterBalanceOverrides))
  ) {
    return null;
  }
  if (
    isCurrentDraft
    && (!record.aiBehaviorTuning
      || typeof record.aiBehaviorTuning !== 'object'
      || Array.isArray(record.aiBehaviorTuning))
  ) {
    return null;
  }
  return createBalanceLabDraft(
    record.name,
    tuning,
    isCurrentDraft || isPreviousDraft
      ? sanitiseCharacterBalanceOverrides(record.characterBalanceOverrides)
      : {},
    typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
    isCurrentDraft
      ? sanitiseAiBehaviorTuning(record.aiBehaviorTuning)
      : createDefaultAiBehaviorTuning(),
  );
}

export function parseFirstStoredBalanceLabDraft(
  ...storedValues: Array<string | null>
): BalanceLabDraft | null {
  for (const storedValue of storedValues) {
    if (!storedValue) {
      continue;
    }
    try {
      const draft = parseBalanceLabDraft(JSON.parse(storedValue) as unknown);
      if (draft) {
        return draft;
      }
    } catch {
      // Continue to older storage keys when a newer local value is malformed.
    }
  }
  return null;
}
