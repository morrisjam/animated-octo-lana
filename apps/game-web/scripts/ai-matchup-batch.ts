import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CHARACTER_IDS,
  CHARACTER_PACKAGE_VERSION_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
  CHARACTER_REGISTRY_SCHEMA_VERSION,
  isCharacterId,
  type CharacterId,
} from '../src/sim/characters';
import {
  AI_DIFFICULTY_PROFILES,
  AI_DIFFICULTY_ORDER,
  AI_CLASH_POLICY_IDS,
  AI_POLICY_REVISION,
  AI_PURSUIT_POLICY_IDS,
  AI_RECOVERY_POLICY_IDS,
  DEFAULT_AI_CLASH_POLICY,
  DEFAULT_AI_PURSUIT_POLICY,
  DEFAULT_AI_RECOVERY_POLICY,
  createDefaultAiBehaviorTuning,
  fingerprintAiBehaviorTuning,
  resolveAiDifficultyProfile,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
  type AiClashPolicyId,
  type AiDifficultyId,
  type AiPursuitPolicyId,
  type AiRecoveryPolicyId,
} from '../src/sim/ai';
import {
  compareAiBatchRuleSnapshots,
  createAiBatchRuleSnapshot,
  parseAiBatchRuleSnapshot,
  type AiBatchRuleComparison,
  type AiBatchRuleSnapshot,
} from '../src/sim/aiBatchRuleComparison';
import { resolveBalanceProfile } from '../src/sim/balanceProfiles';
import {
  AI_BALANCE_THRESHOLD_SCHEMA_VERSION,
  deriveStableSetSeed,
  evaluateBalanceGate,
  type AiBalanceGateResult,
  type AiBalanceThresholds,
} from '../src/sim/aiBalanceGate';
import {
  buildAiFlowDesignerBrief,
  compareAiFlowDesignerBriefs,
  type AiFlowDesignerBrief,
  type AiFlowDesignerBriefComparison,
} from '../src/sim/aiFlowDesignerBrief';
import {
  MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION,
  MATCH_TELEMETRY_SCHEMA_VERSION,
  PREVIOUS_MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION,
  PREVIOUS_MATCH_TELEMETRY_SCHEMA_VERSION,
  aggregateMatchTelemetrySummaries,
  type MatchTelemetryAggregateOrdinaryBoostCounterplaySummary,
  type MatchTelemetryAggregateSummary,
  type MatchTelemetrySummary,
} from '../src/sim/matchTelemetry';
import {
  BALANCE_LAB_CARRIED_REENTRY_CAUSES,
  BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS,
  BALANCE_LAB_CONTROL_RETURN_ACTIONS,
  BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS,
  BALANCE_LAB_LOOP_STAGE_IDS,
  aggregateBalanceLabLoopStages,
  buildBalanceLabFinishOpportunityReviews,
  buildBalanceLabFlowModel,
  fingerprintBalanceTuning,
  parseBalanceLabDraft,
  resolveBalanceLabControlReturnReviewRange,
  resolveBalanceLabFinishOpportunityReviewRange,
  selectMissedBalanceLabFinishOpportunity,
  selectMostConstrainedBalanceLabControlReturn,
  type BalanceLabActionAcceptance,
  type BalanceLabCarriedReentryCause,
  type BalanceLabControlReturnCausalFlow,
  type BalanceLabControlReturnCausalRoleFlow,
  type BalanceLabDraft,
  type BalanceLabExchangeStatus,
  type BalanceLabInputAction,
  type BalanceLabLaunchDefenseFlow,
  type BalanceLabLoopStageAggregate,
  type BalanceLabLoopStageAggregates,
  type BalanceLabLoopStageId,
  type BalanceLabPostControlMovementIntent,
  type BalanceLabRuleChange,
} from '../src/sim/balanceLab';
import {
  COMBAT_CONTROL_RETURN_ACTIVE_ACTIONS,
  COMBAT_CONTROL_RETURN_MOVEMENT_INTENTS,
  COMBAT_CONTROL_RETURN_OUTCOMES,
  COMBAT_ORDINARY_BOOST_OUTCOMES,
  type CombatAction,
  type CombatControlReturnOutcome,
  type CombatDistanceTransitionContext,
} from '../src/sim/combatEventTelemetry';
import {
  fingerprintCharacterBalanceOverrides,
  resolveCharacterRulesFingerprint,
  type CharacterBalanceOverrides,
} from '../src/sim/characterBalance';
import {
  createAiRoundReplay,
  simulateAiRound,
  type AiRoundDecisionFlowSummary,
} from '../src/sim/aiRoundSimulation';
import { findFirstChecksumMismatch, runReplay } from '../src/sim/replay';
import type { GameTuning, PlayersById } from '../src/sim/types';

interface CliOptions {
  gamesPerPairing: number;
  maxRoundSeconds: number;
  baseSeed: number;
  profileId: string;
  difficultyIds: AiDifficultyId[];
  recoveryPolicyId: AiRecoveryPolicyId;
  clashPolicyId: AiClashPolicyId;
  pursuitPolicyId: AiPursuitPolicyId;
  characterIds: CharacterId[];
  pairings: Array<{ p1: CharacterId; p2: CharacterId }>;
  thresholdsPath: string | null;
  draftPath: string | null;
  compareReportPath: string | null;
  allowMultiRuleComparison: boolean;
  reportName: string;
  outputDir: string;
  emitReviewReplays: boolean;
  advisoryGate: boolean;
}

interface BatchBalanceRules {
  source: 'profile' | 'draft';
  profileId: string;
  tuning: GameTuning;
  tuningFingerprint: string;
  characterBalanceOverrides: CharacterBalanceOverrides;
  characterBalanceFingerprint: string;
  effectiveCharacterRulesFingerprint: string;
  aiBehaviorTuning: AiBehaviorTuning;
  aiBehaviorFingerprint: string;
  draft: {
    path: string;
    name: string;
    savedAt: string;
  } | null;
}

interface MatchSummary {
  p1: CharacterId;
  p2: CharacterId;
  difficulty: AiDifficultyId;
  profileId: string;
  games: number;
  seeds: number[];
  p1SetWins: number;
  p2SetWins: number;
  drawnSets: number;
  totalRoundTimeouts: number;
  averageSetSeconds: number;
  averageRoundsPerSet: number;
  telemetry: MatchTelemetryAggregateSummary;
  flow: AiMatchupFlowSummary;
}

type AiMatchupRoundStopReason = 'round_win' | 'round_timeout';

interface AiMatchupRoundEvidence {
  telemetry: MatchTelemetrySummary;
  decisionFlow: AiRoundDecisionFlowSummary;
  setSeed: number;
  roundSeed: number;
  gameNumber: number;
  roundNumber: number;
  stopReason: AiMatchupRoundStopReason;
  winner: 'P1' | 'P2' | null;
}

interface AiMatchupFlowPlayerSummary {
  actionAcceptance: Record<BalanceLabInputAction, BalanceLabActionAcceptance>;
  acceptedCombatActionStartsPerRound: number;
  acceptedCombatActionStartsPerMinute: number;
  dunkStarts: number;
  dunkHits: number;
  averageDunkStartDistance: number;
  p90DunkStartDistance: number;
  averageDunkHitDistance: number;
  averageDunkStartTargetSpeed: number;
  averageDunkStartSeparationSpeed: number;
  finishDunkStarts: number;
  finishDunkWins: number;
  averageFinishDunkStartTargetSpeed: number;
  averageFinishDunkStartSeparationSpeed: number;
  zeroFuelTargetLaunchHits: number;
  zeroFuelLaunchBreakEscapes: number;
  averageAcceptedTacticalActionTypes: number;
  averageDominantTacticalActionShare: number;
  averageTacticalActionEntropy: number;
  p90LongestRepeatedActionStreak: number;
  maximumRepeatedAction: string | null;
  maximumRepeatedActionStreak: number;
  averageLaunchToDunkSeconds: number | null;
  breakEscapesPerRound: number;
  averageBreakReactionSeconds: number;
  helplessRatio: number;
  launchHitsReceived: number;
  helplessSecondsPerLaunchReceived: number | null;
  launchDefense: BalanceLabLaunchDefenseFlow;
  controlReturns: number;
  tacticalRepositionOpportunityFrames: number;
  tacticalRepositionOpportunityWindows: number;
  tacticalRepositionSelections: number;
  tacticalRepositionSelectionRatio: number | null;
  tacticalRepositionSelectionsPerRound: number;
  tacticalRepositionSecondsPerRound: number;
  postControlCounterstepWindows: number;
  postControlCounterstepWindowsPerRound: number;
  postControlCounterstepSecondsPerRound: number;
  postControlChaseLockWindows: number;
  postControlChaseLockWindowsPerRound: number;
  postControlChaseLockFrames: number;
  postControlChaseLockSecondsPerRound: number;
  postControlBoostSuppressionFrames: number;
  postControlBoostSuppressionSecondsPerRound: number;
  postControlDashSuppressionFrames: number;
  postControlDashSuppressionSecondsPerRound: number;
  postControlChaseLockConsumptions: number;
  postControlChaseLockConsumptionsPerRound: number;
  postControlRepeatDashWindows: number;
  postControlRepeatDashWindowsPerRound: number;
  postControlRepeatDashWeightFrames: number;
  postControlRepeatDashWeightSecondsPerRound: number;
  postControlRepeatDashConsumptions: number;
  postControlRepeatDashConsumptionsPerRound: number;
  postControlRepeatDashSelections: number;
  postControlRepeatDashSelectionsPerRound: number;
  combatBoostLockFrames: number;
  combatBoostLockSecondsPerRound: number;
  combatBoostDelayFrames: number;
  combatBoostDelaySecondsPerRound: number;
  combatBoostHeldInputFrames: number;
  combatBoostHeldInputSecondsPerRound: number;
  combatBoostCancellations: number;
  combatBoostCancellationsPerRound: number;
  naturalControlReturns: number;
  launchBreakControlReturns: number;
  relaunchesAfterControlReturn: number;
  relaunchesWithinOneSecond: number;
  relaunchesWithinTwoSeconds: number;
  immediateRelaunchRatio: number;
  averageControlWindowSeconds: number | null;
  relaunchesWithAcceptedAction: number;
  returnsWithAcceptedAction: number;
  averageFirstActionDelaySeconds: number | null;
  controlReturnsInPressure: number;
  sustainedResetsAfterControlReturn: number;
  controlReturnResetRatio: number;
  firstActionsInPressure: number;
  sustainedResetsAfterFirstAction: number;
  postReturnResetRatio: number;
  firstAcceptedActions: Record<CombatAction, {
    starts: number;
    startsInPressure: number;
    immediateRelaunches: number;
    sustainedResets: number;
    movementIntents: Record<BalanceLabPostControlMovementIntent, number>;
  }>;
  controlReturnCausal: BalanceLabControlReturnCausalFlow | null;
  clashFirstActions: number;
  clashFirstActionsInPressure: number;
  clashFirstActionsWithinOneSecond: number;
  clashRapidLaunchRecommits: number;
  clashActionCoverageRatio: number;
  clashImmediateActionRatio: number;
  clashRapidLaunchRecommitRatio: number;
  averageClashFirstActionDelaySeconds: number | null;
  clashFirstAcceptedActions: Record<CombatAction, {
    starts: number;
    startsInPressure: number;
    startsWithinOneSecond: number;
  }>;
  zeroFuelRatio: number;
  approachRatio: number;
  orbitRatio: number;
  retreatRatio: number;
  idleRatio: number;
  contestedContactFrames: number;
  contactApproachRatio: number;
  contactOrbitRatio: number;
  contactRetreatRatio: number;
  contactIdleRatio: number;
  pressureApproachRatio: number;
  pressureRetreatRatio: number;
  pointBlankApproachRatio: number;
  pointBlankRetreatRatio: number;
}

interface AiMatchupResetSummary {
  attempts: number;
  successes: number;
  successRatio: number | null;
}

type AiMatchupExchangeStopReason =
  | 'round_win'
  | 'round_timeout'
  | 'neutral_reset'
  | 'brief_exit';

interface AiMatchupExchangeSequenceEvidence {
  seed: number;
  setSeed: number;
  gameNumber: number;
  roundNumber: number;
  exchangeNumber: number;
  startSeconds: number;
  endSeconds: number;
  pressureSeconds: number;
  neutralWindowSeconds: number;
  status: BalanceLabExchangeStatus;
  stopReason: AiMatchupExchangeStopReason;
  roundStopReason: AiMatchupRoundStopReason;
  roundWinner: 'P1' | 'P2' | null;
  resolved: boolean;
  openerActorId: 'P1' | 'P2' | null;
  openerAction: string | null;
  outcomeLabels: string[];
  exitBand: string | null;
  firstNeutralActionActorId: 'P1' | 'P2' | null;
  firstNeutralAction: string | null;
  firstNeutralActionDelaySeconds: number | null;
  carriedReentryCause: BalanceLabCarriedReentryCause | null;
  reentryContext: CombatDistanceTransitionContext | null;
  roundContactRatio: number;
  roundContactSeconds: number;
}

interface AiMatchupTimeoutRoundEvidence {
  seed: number;
  setSeed: number;
  gameNumber: number;
  roundNumber: number;
  elapsedSeconds: number;
  focusStartSeconds: number;
  focusEndSeconds: number;
  contactRatio: number;
  contactSeconds: number;
  pointBlankRatio: number;
  pressureBandRatio: number;
  neutralResets: number;
  averageNeutralWindowSeconds: number;
  longestPressureSequenceSeconds: number;
  resolvedExchangeRatio: number | null;
  briefExitRatio: number | null;
}

interface AiMatchupExchangeSummary {
  total: number;
  resolved: number;
  unresolved: number;
  resolvedRatio: number | null;
  resets: number;
  resetRatio: number | null;
  briefExits: number;
  ongoing: number;
  finished: number;
  averagePressureSeconds: number;
  p90PressureSeconds: number;
  averageUnresolvedPressureSeconds: number | null;
  longestUnresolvedPressureSeconds: number;
  representativeSequences: {
    worstUnresolved: AiMatchupExchangeSequenceEvidence | null;
    worstBriefExit: AiMatchupExchangeSequenceEvidence | null;
    worstContact: AiMatchupExchangeSequenceEvidence | null;
  };
}

interface AiMatchupNeutralExitFollowUpSummary {
  exits: number;
  briefExits: number;
  resetExits: number;
  firstActions: number;
  firstActionCoverageRatio: number | null;
  averageFirstActionDelaySeconds: number | null;
  briefExitsWithoutAcceptedAction: number;
  carriedBriefExitRatio: number | null;
  carriedBriefExitCauses: Record<BalanceLabCarriedReentryCause, number>;
  playerFirstActions: { P1: number; P2: number };
  firstAcceptedActions: Record<CombatAction, number>;
}

interface AiMatchupOrdinaryBoostCounterplayPlayerSummary
  extends MatchTelemetryAggregateOrdinaryBoostCounterplaySummary {
  opportunitiesPerRound: number;
}

interface AiMatchupLoopStageEvidence {
  stageId: BalanceLabLoopStageId;
  label: string;
  status: 'watch' | 'blocked';
  detail: string;
  seed: number;
  setSeed: number;
  gameNumber: number;
  roundNumber: number;
  elapsedSeconds: number;
  focusStartSeconds: number;
  focusEndSeconds: number;
  relatedGlobalTuning: string[];
  relatedAiBehavior: string[];
  relatedCharacterControls: string[];
  relatedCharacterTargets: Array<{
    playerId: 'P1' | 'P2';
    control: string;
  }>;
  relatedPlayerIds: Array<'P1' | 'P2'>;
}

type AiMatchupLoopStageRepresentatives = Record<
  BalanceLabLoopStageId,
  AiMatchupLoopStageEvidence | null
>;

interface AiMatchupFlowSummary {
  rounds: number;
  loopStages: BalanceLabLoopStageAggregates;
  loopStageRepresentatives: AiMatchupLoopStageRepresentatives;
  timeoutRounds: number;
  representativeTimeout: AiMatchupTimeoutRoundEvidence | null;
  launchClashes: number;
  launchClashesPerRound: number;
  launchClashesPerMinute: number;
  clashRepeatOpportunities: number;
  repeatClashesWithinOneSecond: number;
  repeatClashRatio: number | null;
  neutralResetsPerRound: number;
  neutralResetsPerMinute: number;
  averagePressureSequenceSeconds: number;
  averageLongestPressureSequenceSeconds: number;
  p90LongestPressureSequenceSeconds: number;
  averageNeutralWindowSeconds: number;
  averageLongestNeutralWindowSeconds: number;
  resetOutcomes: {
    all: AiMatchupResetSummary;
    clashes: AiMatchupResetSummary;
    defense: AiMatchupResetSummary;
    parries: AiMatchupResetSummary;
    launchBreaks: AiMatchupResetSummary;
  };
  exchanges: AiMatchupExchangeSummary;
  neutralExitFollowUp: AiMatchupNeutralExitFollowUpSummary;
  ordinaryBoostCounterplay: PlayersById<AiMatchupOrdinaryBoostCounterplayPlayerSummary>;
  roundsWithNoDunkStart: number;
  roundsWithLaunchHitsButNoDunkStart: number;
  players: {
    P1: AiMatchupFlowPlayerSummary;
    P2: AiMatchupFlowPlayerSummary;
  };
}

interface BatchComparisonDelta {
  pairing: { p1: CharacterId; p2: CharacterId; difficulty: AiDifficultyId };
  averageRoundSeconds: number;
  launchClashesPerRound: number;
  launchClashesPerMinute: number;
  p1AcceptedCombatActionStartsPerRound: number;
  p2AcceptedCombatActionStartsPerRound: number;
  p1AcceptedCombatActionStartsPerMinute: number;
  p2AcceptedCombatActionStartsPerMinute: number;
  timeoutRoundRatioPoints: number;
  contactRatioPoints: number;
  sharedControlRatioPoints: number | null;
  sharedControlContactRatioPoints: number | null;
  sharedControlPressureRatioPoints: number | null;
  sharedActionReadyRatioPoints: number | null;
  sharedActionReadyShareOfControlPoints: number | null;
  sharedContactRatioPoints: number | null;
  sharedPressureRatioPoints: number | null;
  sharedNeutralRatioPoints: number | null;
  sharedSustainedNeutralWindowsPerRound: number | null;
  sharedP90NeutralEpisodeSeconds: number | null;
  sharedMaximumContactEpisodeSeconds: number | null;
  p1TacticalRepositionSelectionsPerRound: number | null;
  p2TacticalRepositionSelectionsPerRound: number | null;
  p1TacticalRepositionSecondsPerRound: number | null;
  p2TacticalRepositionSecondsPerRound: number | null;
  p1PostControlChaseLockWindowsPerRound: number | null;
  p2PostControlChaseLockWindowsPerRound: number | null;
  p1PostControlChaseLockSecondsPerRound: number | null;
  p2PostControlChaseLockSecondsPerRound: number | null;
  p1PostControlBoostSuppressionSecondsPerRound: number | null;
  p2PostControlBoostSuppressionSecondsPerRound: number | null;
  p1PostControlDashSuppressionSecondsPerRound: number | null;
  p2PostControlDashSuppressionSecondsPerRound: number | null;
  p1PostControlChaseLockConsumptionsPerRound: number | null;
  p2PostControlChaseLockConsumptionsPerRound: number | null;
  p1PostControlRepeatDashWindowsPerRound: number | null;
  p2PostControlRepeatDashWindowsPerRound: number | null;
  p1PostControlRepeatDashWeightSecondsPerRound: number | null;
  p2PostControlRepeatDashWeightSecondsPerRound: number | null;
  p1PostControlRepeatDashConsumptionsPerRound: number | null;
  p2PostControlRepeatDashConsumptionsPerRound: number | null;
  p1PostControlRepeatDashSelectionsPerRound: number | null;
  p2PostControlRepeatDashSelectionsPerRound: number | null;
  p1CombatBoostLockSecondsPerRound: number | null;
  p2CombatBoostLockSecondsPerRound: number | null;
  p1CombatBoostDelaySecondsPerRound: number | null;
  p2CombatBoostDelaySecondsPerRound: number | null;
  p1CombatBoostHeldInputSecondsPerRound: number | null;
  p2CombatBoostHeldInputSecondsPerRound: number | null;
  p1CombatBoostCancellationsPerRound: number | null;
  p2CombatBoostCancellationsPerRound: number | null;
  pointBlankRatioPoints: number;
  pressureBandRatioPoints: number;
  neutralResetsPerRound: number;
  p90PressureSequenceSeconds: number;
  noDunkStartRoundRatioPoints: number;
  launchWithoutDunkRoundRatioPoints: number;
  dominantTacticalActionSharePoints: number;
  repeatedTacticalActionStreak: number;
  launchToDunkSeconds: number | null;
  p1BreakEscapesPerRound: number;
  p2BreakEscapesPerRound: number;
  p1BreakReactionSeconds: number;
  p2BreakReactionSeconds: number;
  resetConversionRatioPoints: number | null;
  defenseResetConversionRatioPoints: number | null;
  parryResetConversionRatioPoints: number | null;
  launchBreakResetConversionRatioPoints: number | null;
  resolvedExchangeRatioPoints: number | null;
  exchangeResetRatioPoints: number | null;
  briefExitRatioPoints: number | null;
  averageUnresolvedPressureSeconds: number | null;
  p1HelplessRatioPoints: number;
  p2HelplessRatioPoints: number;
  p1LaunchHitsReceivedPerRound: number;
  p2LaunchHitsReceivedPerRound: number;
  p1HelplessSecondsPerLaunchReceived: number | null;
  p2HelplessSecondsPerLaunchReceived: number | null;
  p1ImmediateRelaunchRatioPoints: number | null;
  p2ImmediateRelaunchRatioPoints: number | null;
  p1AverageControlWindowSeconds: number | null;
  p2AverageControlWindowSeconds: number | null;
  p1PostReturnResetRatioPoints: number | null;
  p2PostReturnResetRatioPoints: number | null;
  p1ControlReturnResetRatioPoints: number | null;
  p2ControlReturnResetRatioPoints: number | null;
  p1ReturnerClosingSharePoints: number | null;
  p2ReturnerClosingSharePoints: number | null;
  p1OpponentClosedMoreRatioPoints: number | null;
  p2OpponentClosedMoreRatioPoints: number | null;
  p1SustainedExitRatioPoints: number | null;
  p2SustainedExitRatioPoints: number | null;
  p1ControlGrantedDistance: number | null;
  p2ControlGrantedDistance: number | null;
  p1MaximumControlReturnDistance: number | null;
  p2MaximumControlReturnDistance: number | null;
  p1FirstActionDelaySeconds: number | null;
  p2FirstActionDelaySeconds: number | null;
  repeatClashRatioPoints: number | null;
  p1ClashRapidLaunchRecommitRatioPoints: number | null;
  p2ClashRapidLaunchRecommitRatioPoints: number | null;
  p1ClashFirstActionDelaySeconds: number | null;
  p2ClashFirstActionDelaySeconds: number | null;
  carriedBriefExitRatioPoints: number | null;
  neutralFirstActionDelaySeconds: number | null;
}

interface BatchComparison {
  baselinePath: string;
  baselineGeneratedAt: string;
  controlledScenarioFingerprint: string;
  ruleChangePolicy: 'single_variable' | 'explicit_multi_variable';
  ruleChanges: BalanceLabRuleChange[];
  designerFlow: AiFlowDesignerBriefComparison | null;
  deltas: BatchComparisonDelta[];
}

interface BatchReport {
  schemaVersion: 'gw.ai-matchup-batch.v24';
  generatedAt: string;
  characterRegistry: {
    schemaVersion: string;
    fingerprint: string;
    packageVersions: Record<string, string>;
  };
  options: {
    gamesPerPairing: number;
    maxRoundSeconds: number;
    baseSeed: number;
    seedStrategy: 'mirrored_common_scenario_v1';
    aiSeedStrategy: 'character_round_stream_v1';
    profileId: string;
    draftPath: string | null;
    difficultyIds: AiDifficultyId[];
    recoveryPolicyId: AiRecoveryPolicyId;
    clashPolicyId: AiClashPolicyId;
    pursuitPolicyId: AiPursuitPolicyId;
    characterIds: CharacterId[];
    pairings: Array<{ p1: CharacterId; p2: CharacterId }>;
    emitReviewReplays: boolean;
    allowMultiRuleComparison: boolean;
  };
  simulation: {
    fixedDt: number;
    roundsToWin: number;
    maximumRoundsPerSet: number;
    roundSampling: 'fixed_rounds_v1';
    rules: { allowDunkWin: boolean };
  };
  balanceProfile: {
    requestedId: string;
    resolvedId: string;
    tuningFingerprint: string;
    source: 'profile' | 'draft';
    characterBalanceFingerprint: string;
    effectiveCharacterRulesFingerprint: string;
    aiBehaviorFingerprint: string;
    aiBehaviorTuning: AiBehaviorTuning;
    draft: BatchBalanceRules['draft'];
  };
  aiBaseProfilesFingerprint: string;
  aiProfilesFingerprint: string;
  ruleSnapshot: AiBatchRuleSnapshot;
  summaries: MatchSummary[];
  designerBrief: AiFlowDesignerBrief;
  reviewReplays: AiMatchupReviewReplay[];
  gate: AiBalanceGateResult | null;
  comparison: BatchComparison | null;
}

type AiMatchupReviewReplayKind =
  | 'worst-unresolved'
  | 'worst-brief-exit'
  | 'worst-contact'
  | 'worst-timeout'
  | `loop-${BalanceLabLoopStageId}`;

type AiMatchupReviewReplayStatus = 'blocked' | 'watch' | 'representative';

interface AiMatchupReviewReplay {
  kind: AiMatchupReviewReplayKind;
  status: AiMatchupReviewReplayStatus;
  summary: string;
  path: string;
  label: string;
  p1: CharacterId;
  p2: CharacterId;
  difficulty: AiDifficultyId;
  gameNumber: number;
  roundNumber: number;
  setSeed: number;
  roundSeed: number;
  focusFrame: number;
  endFrame: number | null;
  frames: number;
}

const FIXED_DT = 1 / 60;
const DEFAULT_GAMES_PER_PAIRING = 12;
const DEFAULT_MAX_ROUND_SECONDS = 90;
const DEFAULT_BASE_SEED = 0x10293847;
const DEFAULT_PROFILE_ID = 'default';
const ROUNDS_TO_WIN = 2;
const MAX_ROUNDS_PER_SET = 3;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const canonical = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildAiProfilesFingerprint(
  difficultyIds: readonly AiDifficultyId[],
  recoveryPolicyId: AiRecoveryPolicyId,
  clashPolicyId: AiClashPolicyId,
  pursuitPolicyId: AiPursuitPolicyId,
  behaviorTuning: AiBehaviorTuning,
): string {
  const sanitisedBehavior = sanitiseAiBehaviorTuning(behaviorTuning);
  const defaultBehaviorFingerprint = fingerprintAiBehaviorTuning(
    createDefaultAiBehaviorTuning(),
  );
  const behaviorIsDefault = fingerprintAiBehaviorTuning(sanitisedBehavior)
    === defaultBehaviorFingerprint;
  if (
    behaviorIsDefault
    && recoveryPolicyId === 'legacy'
    && clashPolicyId === 'legacy'
    && pursuitPolicyId === 'legacy'
  ) {
    const legacyProfiles = difficultyIds.map((difficultyId) => {
      const profile = AI_DIFFICULTY_PROFILES[difficultyId];
      return {
        id: profile.id,
        label: profile.label,
        reactionDelayFrames: profile.reactionDelayFrames,
        errorRate: profile.errorRate,
        riskAppetite: profile.riskAppetite,
        approachDistance: profile.approachDistance,
        actionWeights: profile.actionWeights,
      };
    });
    return `fnv1a32:${fingerprint({
      policyRevision: AI_POLICY_REVISION,
      profiles: legacyProfiles,
    })}`;
  }

  if (behaviorIsDefault) {
    return `fnv1a32:${fingerprint({
      policyRevision: AI_POLICY_REVISION,
      recoveryPolicyId,
      clashPolicyId,
      pursuitPolicyId,
      profiles: difficultyIds.map((difficultyId) => AI_DIFFICULTY_PROFILES[difficultyId]),
    })}`;
  }

  return `fnv1a32:${fingerprint({
    policyRevision: AI_POLICY_REVISION,
    behaviorTuningRevision: 'designer-v1',
    recoveryPolicyId,
    clashPolicyId,
    pursuitPolicyId,
    behaviorTuning: sanitisedBehavior,
    profiles: difficultyIds.map((difficultyId) => (
      resolveAiDifficultyProfile(difficultyId, sanitisedBehavior)
    )),
  })}`;
}

function buildAiBaseProfilesFingerprint(
  difficultyIds: readonly AiDifficultyId[],
  recoveryPolicyId: AiRecoveryPolicyId,
  clashPolicyId: AiClashPolicyId,
  pursuitPolicyId: AiPursuitPolicyId,
): string {
  return `fnv1a32:${fingerprint({
    policyRevision: AI_POLICY_REVISION,
    recoveryPolicyId,
    clashPolicyId,
    pursuitPolicyId,
    profiles: difficultyIds.map((difficultyId) => AI_DIFFICULTY_PROFILES[difficultyId]),
  })}`;
}

function roundMetric(value: number, precision = 3): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[Math.min(sorted.length - 1, index)] ?? 0;
}

function collectEventMetric(
  summaries: MatchTelemetrySummary[],
  playerId: 'P1' | 'P2',
  type: 'action_start' | 'dunk_hit',
  metric: 'distance' | 'targetSpeed' | 'separationSpeed',
  finishOnly = false,
): number[] {
  return summaries.flatMap((summary) => summary.combat.events
    .filter((event) => (
      event.actorId === playerId
      && event.type === type
      && (type !== 'action_start' || event.action === 'dunk')
      && (!finishOnly || (event.targetFuelPercent ?? 1) <= 0.001)
      && typeof event[metric] === 'number'
    ))
    .map((event) => event[metric] as number));
}

function exchangeStopReason(
  status: BalanceLabExchangeStatus,
  roundStopReason: AiMatchupRoundStopReason,
): AiMatchupExchangeStopReason {
  if (status === 'reset') {
    return 'neutral_reset';
  }
  if (status === 'brief_exit') {
    return 'brief_exit';
  }
  return roundStopReason;
}

function compareExchangeContext(
  first: AiMatchupExchangeSequenceEvidence,
  second: AiMatchupExchangeSequenceEvidence,
): number {
  return first.gameNumber - second.gameNumber
    || first.roundNumber - second.roundNumber
    || first.exchangeNumber - second.exchangeNumber;
}

function selectExchangeSequence(
  sequences: readonly AiMatchupExchangeSequenceEvidence[],
  compare: (
    first: AiMatchupExchangeSequenceEvidence,
    second: AiMatchupExchangeSequenceEvidence,
  ) => number,
): AiMatchupExchangeSequenceEvidence | null {
  return [...sequences].sort(compare)[0] ?? null;
}

function aggregateControlReturnCausalFlows(
  flows: readonly (BalanceLabControlReturnCausalFlow | null)[],
): BalanceLabControlReturnCausalFlow | null {
  if (flows.some((flow) => flow === null)) {
    return null;
  }
  const available = flows as readonly BalanceLabControlReturnCausalFlow[];
  const outcomes = Object.fromEntries(
    COMBAT_CONTROL_RETURN_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<CombatControlReturnOutcome, number>;
  let windows = 0;
  let controlGrantedInPressure = 0;
  let safeAtGrant = 0;
  let controlGrantedDistanceTotal = 0;
  let maximumDistanceTotal = 0;
  let returnedPlayerClosingDistance = 0;
  let opponentClosingDistance = 0;
  let returnedPlayerClosedMore = 0;
  let opponentClosedMore = 0;
  let balancedClosure = 0;
  let returnedPlayerFirstActions = 0;
  let opponentFirstActions = 0;
  let returnedPlayerDominantApproachWindows = 0;
  let opponentDominantApproachWindows = 0;
  const createRole = (): BalanceLabControlReturnCausalRoleFlow => ({
    dominantMovementIntents: Object.fromEntries([
      ...COMBAT_CONTROL_RETURN_MOVEMENT_INTENTS,
      'unobserved',
    ].map((intent) => [intent, 0])) as BalanceLabControlReturnCausalRoleFlow['dominantMovementIntents'],
    dominantActiveActions: Object.fromEntries([
      ...COMBAT_CONTROL_RETURN_ACTIVE_ACTIONS,
      'unobserved',
    ].map((action) => [action, 0])) as BalanceLabControlReturnCausalRoleFlow['dominantActiveActions'],
    firstAcceptedActions: Object.fromEntries([
      ...BALANCE_LAB_CONTROL_RETURN_ACTIONS,
      'none',
    ].map((action) => [action, 0])) as BalanceLabControlReturnCausalRoleFlow['firstAcceptedActions'],
  });
  const roles = { returner: createRole(), opponent: createRole() };
  for (const flow of available) {
    windows += flow.windows;
    controlGrantedInPressure += flow.controlGrantedInPressure;
    safeAtGrant += flow.safeAtGrant;
    controlGrantedDistanceTotal += flow.controlGrantedDistanceTotal;
    maximumDistanceTotal += flow.maximumDistanceTotal;
    returnedPlayerClosingDistance += flow.returnedPlayerClosingDistance;
    opponentClosingDistance += flow.opponentClosingDistance;
    returnedPlayerClosedMore += flow.returnedPlayerClosedMore;
    opponentClosedMore += flow.opponentClosedMore;
    balancedClosure += flow.balancedClosure;
    returnedPlayerFirstActions += flow.returnedPlayerFirstActions;
    opponentFirstActions += flow.opponentFirstActions;
    returnedPlayerDominantApproachWindows += flow.returnedPlayerDominantApproachWindows;
    opponentDominantApproachWindows += flow.opponentDominantApproachWindows;
    for (const outcome of COMBAT_CONTROL_RETURN_OUTCOMES) {
      outcomes[outcome] += flow.outcomes[outcome];
    }
    for (const roleId of ['returner', 'opponent'] as const) {
      for (const intent of [...COMBAT_CONTROL_RETURN_MOVEMENT_INTENTS, 'unobserved'] as const) {
        roles[roleId].dominantMovementIntents[intent]
          += flow.roles[roleId].dominantMovementIntents[intent];
      }
      for (const action of [...COMBAT_CONTROL_RETURN_ACTIVE_ACTIONS, 'unobserved'] as const) {
        roles[roleId].dominantActiveActions[action]
          += flow.roles[roleId].dominantActiveActions[action];
      }
      for (const action of [...BALANCE_LAB_CONTROL_RETURN_ACTIONS, 'none'] as const) {
        roles[roleId].firstAcceptedActions[action]
          += flow.roles[roleId].firstAcceptedActions[action];
      }
    }
  }
  const totalClosingDistance = returnedPlayerClosingDistance + opponentClosingDistance;
  return {
    windows,
    outcomes,
    controlGrantedInPressure,
    safeAtGrant,
    controlGrantedDistanceTotal: roundMetric(controlGrantedDistanceTotal, 2),
    maximumDistanceTotal: roundMetric(maximumDistanceTotal, 2),
    averageControlGrantedDistance: windows > 0
      ? roundMetric(controlGrantedDistanceTotal / windows, 2)
      : null,
    averageMaximumDistance: windows > 0
      ? roundMetric(maximumDistanceTotal / windows, 2)
      : null,
    returnedPlayerClosingDistance: roundMetric(returnedPlayerClosingDistance, 2),
    opponentClosingDistance: roundMetric(opponentClosingDistance, 2),
    returnedPlayerClosingShare: totalClosingDistance > 0
      ? roundMetric(returnedPlayerClosingDistance / totalClosingDistance, 3)
      : null,
    returnedPlayerClosedMore,
    opponentClosedMore,
    balancedClosure,
    returnedPlayerFirstActions,
    opponentFirstActions,
    returnedPlayerDominantApproachWindows,
    opponentDominantApproachWindows,
    roles,
  };
}

function buildAiMatchupFlowSummary(
  roundEvidence: AiMatchupRoundEvidence[],
  ordinaryBoostCounterplay: PlayersById<MatchTelemetryAggregateOrdinaryBoostCounterplaySummary>,
): AiMatchupFlowSummary {
  const summaries = roundEvidence.map((round) => round.telemetry);
  const flowModels = summaries.map(buildBalanceLabFlowModel);
  const elapsedSeconds = summaries.reduce((sum, summary) => sum + summary.elapsedSeconds, 0);
  const buildPlayer = (playerId: 'P1' | 'P2'): AiMatchupFlowPlayerSummary => {
    const opponentId = playerId === 'P1' ? 'P2' : 'P1';
    const total = (select: (summary: MatchTelemetrySummary['players']['P1']) => number): number => (
      summaries.reduce((sum, summary) => sum + select(summary.players[playerId]), 0)
    );
    const decisionTotal = (
      select: (summary: AiRoundDecisionFlowSummary['players']['P1']) => number,
    ): number => roundEvidence.reduce(
      (sum, round) => sum + select(round.decisionFlow.players[playerId]),
      0,
    );
    const buildActionAcceptance = (presses: number, starts: number): BalanceLabActionAcceptance => ({
      presses,
      starts,
      rejectedPresses: Math.max(0, presses - starts),
      acceptanceRatio: roundMetric(starts / Math.max(1, presses, starts), 3),
    });
    const actionAcceptance: Record<BalanceLabInputAction, BalanceLabActionAcceptance> = {
      launch: buildActionAcceptance(total((player) => player.launchPresses), total((player) => player.launchStarts)),
      special: buildActionAcceptance(total((player) => player.specialPresses), total((player) => player.specialStarts)),
      dunk: buildActionAcceptance(total((player) => player.dunkPresses), total((player) => player.dunkStarts)),
      parry: buildActionAcceptance(total((player) => player.parryPresses), total((player) => player.parryStarts)),
      launch_break: buildActionAcceptance(total((player) => player.breakPresses), total((player) => player.breakEscapes)),
    };
    const acceptedCombatActionStarts = Object.values(actionAcceptance).reduce(
      (sum, action) => sum + action.starts,
      0,
    );
    const startDistances = collectEventMetric(summaries, playerId, 'action_start', 'distance');
    const hitDistances = collectEventMetric(summaries, playerId, 'dunk_hit', 'distance');
    const startTargetSpeeds = collectEventMetric(summaries, playerId, 'action_start', 'targetSpeed');
    const startSeparationSpeeds = collectEventMetric(summaries, playerId, 'action_start', 'separationSpeed');
    const finishStartTargetSpeeds = collectEventMetric(summaries, playerId, 'action_start', 'targetSpeed', true);
    const finishStartSeparationSpeeds = collectEventMetric(summaries, playerId, 'action_start', 'separationSpeed', true);
    const finishDunkStarts = summaries.reduce((count, summary) => count + summary.combat.events.filter((event) => (
      event.type === 'action_start'
      && event.action === 'dunk'
      && event.actorId === playerId
      && (event.targetFuelPercent ?? 1) <= 0.001
    )).length, 0);
    const finishDunkWins = summaries.reduce((count, summary) => count + summary.combat.events.filter((event) => (
      event.type === 'dunk_hit'
      && event.actorId === playerId
      && event.outcome === 'win'
    )).length, 0);
    const zeroFuelTargetLaunchHits = summaries.reduce((count, summary) => count + summary.combat.events.filter((event) => (
      event.type === 'launch_hit'
      && event.actorId === playerId
      && (event.targetFuelPercent ?? 1) <= 0.001
    )).length, 0);
    const zeroFuelLaunchBreakEscapes = summaries.reduce((count, summary) => count + summary.combat.events.filter((event) => (
      event.type === 'launch_break'
      && event.actorId === playerId
      && (event.actorFuelPercent ?? 1) <= 0.001
    )).length, 0);
    const launchToDunkSeconds = flowModels.flatMap((flow) => {
      const value = flow.players[playerId].averageLaunchToDunkSeconds;
      return value === null ? [] : [value];
    });
    const breakEscapes = total((player) => player.breakEscapes);
    const launchHitsReceived = summaries.reduce(
      (sum, summary) => sum + summary.players[opponentId].launchHits,
      0,
    );
    const helplessSeconds = summaries.reduce(
      (sum, summary) => sum + summary.combat.resources[playerId].helplessSeconds,
      0,
    );
    const controlReturns = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.controlReturns,
      0,
    );
    const controlReturnCausal = aggregateControlReturnCausalFlows(
      flowModels.map((flow) => flow.players[playerId].controlReturn.causal),
    );
    const tacticalRepositionOpportunityFrames = decisionTotal(
      (player) => player.tacticalRepositionOpportunityFrames,
    );
    const tacticalRepositionOpportunityWindows = decisionTotal(
      (player) => player.tacticalRepositionOpportunityWindows,
    );
    const tacticalRepositionSelections = decisionTotal(
      (player) => player.tacticalRepositionSelections,
    );
    const tacticalRepositionFrames = decisionTotal(
      (player) => player.tacticalRepositionFrames,
    );
    const postControlCounterstepWindows = decisionTotal(
      (player) => player.postControlCounterstepWindows ?? 0,
    );
    const postControlCounterstepFrames = decisionTotal(
      (player) => player.postControlCounterstepFrames ?? 0,
    );
    const postControlChaseLockWindows = decisionTotal(
      (player) => player.postControlChaseLockWindows ?? 0,
    );
    const postControlChaseLockFrames = decisionTotal(
      (player) => player.postControlChaseLockFrames ?? 0,
    );
    const postControlBoostSuppressionFrames = decisionTotal(
      (player) => player.postControlBoostSuppressionFrames ?? 0,
    );
    const postControlDashSuppressionFrames = decisionTotal(
      (player) => player.postControlDashSuppressionFrames ?? 0,
    );
    const postControlChaseLockConsumptions = decisionTotal(
      (player) => player.postControlChaseLockConsumptions ?? 0,
    );
    const postControlRepeatDashWindows = decisionTotal(
      (player) => player.postControlRepeatDashWindows ?? 0,
    );
    const postControlRepeatDashWeightFrames = decisionTotal(
      (player) => player.postControlRepeatDashWeightFrames ?? 0,
    );
    const postControlRepeatDashConsumptions = decisionTotal(
      (player) => player.postControlRepeatDashConsumptions ?? 0,
    );
    const postControlRepeatDashSelections = decisionTotal(
      (player) => player.postControlRepeatDashSelections ?? 0,
    );
    const combatBoostLockFrames = decisionTotal(
      (player) => player.combatBoostLockFrames ?? 0,
    );
    const combatBoostDelayFrames = decisionTotal(
      (player) => player.combatBoostDelayFrames ?? 0,
    );
    const combatBoostHeldInputFrames = decisionTotal(
      (player) => player.combatBoostHeldInputFrames ?? 0,
    );
    const combatBoostCancellations = decisionTotal(
      (player) => player.combatBoostCancellations ?? 0,
    );
    const naturalControlReturns = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.naturalControlReturns,
      0,
    );
    const launchBreakControlReturns = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.launchBreakControlReturns,
      0,
    );
    const relaunchesAfterControlReturn = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.relaunchesAfterControlReturn,
      0,
    );
    const relaunchesWithinOneSecond = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.relaunchesWithinOneSecond,
      0,
    );
    const relaunchesWithinTwoSeconds = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.relaunchesWithinTwoSeconds,
      0,
    );
    const relaunchesWithAcceptedAction = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.relaunchesWithAcceptedAction,
      0,
    );
    const returnsWithAcceptedAction = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.returnsWithAcceptedAction,
      0,
    );
    const firstActionsInPressure = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.firstActionsInPressure,
      0,
    );
    const controlReturnsInPressure = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.controlReturnsInPressure,
      0,
    );
    const sustainedResetsAfterControlReturn = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.sustainedResetsAfterControlReturn,
      0,
    );
    const sustainedResetsAfterFirstAction = flowModels.reduce(
      (sum, flow) => sum + flow.players[playerId].controlReturn.sustainedResetsAfterFirstAction,
      0,
    );
    const accumulatedFirstActionDelaySeconds = flowModels.reduce((sum, flow) => {
      const control = flow.players[playerId].controlReturn;
      return sum + (control.averageFirstActionDelaySeconds ?? 0) * control.returnsWithAcceptedAction;
    }, 0);
    const firstAcceptedActions = Object.fromEntries(
      BALANCE_LAB_CONTROL_RETURN_ACTIONS.map((action) => {
        const aggregate = flowModels.reduce((current, flow) => {
          const actionFlow = flow.players[playerId].controlReturn.firstAcceptedActions[action];
          current.starts += actionFlow.starts;
          current.startsInPressure += actionFlow.startsInPressure;
          current.immediateRelaunches += actionFlow.immediateRelaunches;
          current.sustainedResets += actionFlow.sustainedResets;
          for (const intent of BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS) {
            current.movementIntents[intent] += actionFlow.movementIntents[intent];
          }
          return current;
        }, {
          starts: 0,
          startsInPressure: 0,
          immediateRelaunches: 0,
          sustainedResets: 0,
          movementIntents: Object.fromEntries(
            BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS.map((intent) => [intent, 0]),
          ) as Record<BalanceLabPostControlMovementIntent, number>,
        });
        return [action, aggregate];
      }),
    ) as AiMatchupFlowPlayerSummary['firstAcceptedActions'];
    const clashFirstActions = flowModels.reduce(
      (sum, flow) => sum + flow.clashFollowUp.players[playerId].firstActions,
      0,
    );
    const clashFirstActionsInPressure = flowModels.reduce(
      (sum, flow) => sum + flow.clashFollowUp.players[playerId].firstActionsInPressure,
      0,
    );
    const clashFirstActionsWithinOneSecond = flowModels.reduce(
      (sum, flow) => sum + flow.clashFollowUp.players[playerId].firstActionsWithinOneSecond,
      0,
    );
    const clashRapidLaunchRecommits = flowModels.reduce(
      (sum, flow) => sum + flow.clashFollowUp.players[playerId].rapidLaunchRecommits,
      0,
    );
    const accumulatedClashFirstActionDelaySeconds = flowModels.reduce((sum, flow) => {
      const clash = flow.clashFollowUp.players[playerId];
      return sum + (clash.averageFirstActionDelaySeconds ?? 0) * clash.firstActions;
    }, 0);
    const clashFirstAcceptedActions = Object.fromEntries(
      BALANCE_LAB_CONTROL_RETURN_ACTIONS.map((action) => {
        const aggregate = flowModels.reduce((current, flow) => {
          const actionFlow = flow.clashFollowUp.players[playerId].firstAcceptedActions[action];
          current.starts += actionFlow.starts;
          current.startsInPressure += actionFlow.startsInPressure;
          current.startsWithinOneSecond += actionFlow.startsWithinOneSecond;
          return current;
        }, {
          starts: 0,
          startsInPressure: 0,
          startsWithinOneSecond: 0,
        });
        return [action, aggregate];
      }),
    ) as AiMatchupFlowPlayerSummary['clashFirstAcceptedActions'];
    const accumulatedControlWindowSeconds = flowModels.reduce((sum, flow) => {
      const control = flow.players[playerId].controlReturn;
      return sum + (control.averageControlWindowSeconds ?? 0) * control.relaunchesAfterControlReturn;
    }, 0);
    const launchDefenseTotals = flowModels.reduce((current, flow) => {
      const defense = flow.players[playerId].launchDefense;
      current.incomingPressureLaunches += defense.incomingPressureLaunches;
      current.preemptiveResponses += defense.preemptiveResponses;
      current.reactiveResponses += defense.reactiveResponses;
      current.parryResponses += defense.parryResponses;
      current.guardResponses += defense.guardResponses;
      current.counterLaunchResponses += defense.counterLaunchResponses;
      current.successfulParries += defense.successfulParries;
      current.successfulGuards += defense.successfulGuards;
      current.unattributedParrySuccesses += defense.unattributedParrySuccesses;
      current.launchClashes += defense.launchClashes;
      current.counterLaunchHits += defense.counterLaunchHits;
      current.launchHits += defense.launchHits;
      current.unansweredLaunchHits += defense.unansweredLaunchHits;
      current.whiffsOrUnresolved += defense.whiffsOrUnresolved;
      current.successfulDefenses += defense.successfulDefenses;
      current.sustainedResetsAfterSuccessfulDefense += defense.sustainedResetsAfterSuccessfulDefense;
      current.reactiveResponseSeconds += (defense.averageReactiveResponseSeconds ?? 0)
        * defense.reactiveResponses;
      return current;
    }, {
      incomingPressureLaunches: 0,
      preemptiveResponses: 0,
      reactiveResponses: 0,
      parryResponses: 0,
      guardResponses: 0,
      counterLaunchResponses: 0,
      successfulParries: 0,
      successfulGuards: 0,
      unattributedParrySuccesses: 0,
      launchClashes: 0,
      counterLaunchHits: 0,
      launchHits: 0,
      unansweredLaunchHits: 0,
      whiffsOrUnresolved: 0,
      successfulDefenses: 0,
      sustainedResetsAfterSuccessfulDefense: 0,
      reactiveResponseSeconds: 0,
    });
    const launchDefenseResponses = launchDefenseTotals.preemptiveResponses
      + launchDefenseTotals.reactiveResponses;
    const launchDefense: BalanceLabLaunchDefenseFlow = {
      incomingPressureLaunches: launchDefenseTotals.incomingPressureLaunches,
      preemptiveResponses: launchDefenseTotals.preemptiveResponses,
      reactiveResponses: launchDefenseTotals.reactiveResponses,
      responseCoverageRatio: roundMetric(
        launchDefenseResponses / Math.max(1, launchDefenseTotals.incomingPressureLaunches),
        3,
      ),
      parryResponses: launchDefenseTotals.parryResponses,
      guardResponses: launchDefenseTotals.guardResponses,
      counterLaunchResponses: launchDefenseTotals.counterLaunchResponses,
      successfulParries: launchDefenseTotals.successfulParries,
      successfulGuards: launchDefenseTotals.successfulGuards,
      unattributedParrySuccesses: launchDefenseTotals.unattributedParrySuccesses,
      launchClashes: launchDefenseTotals.launchClashes,
      counterLaunchHits: launchDefenseTotals.counterLaunchHits,
      launchHits: launchDefenseTotals.launchHits,
      unansweredLaunchHits: launchDefenseTotals.unansweredLaunchHits,
      whiffsOrUnresolved: launchDefenseTotals.whiffsOrUnresolved,
      averageReactiveResponseSeconds: launchDefenseTotals.reactiveResponses > 0
        ? roundMetric(
          launchDefenseTotals.reactiveResponseSeconds / launchDefenseTotals.reactiveResponses,
          3,
        )
        : null,
      successfulDefenses: launchDefenseTotals.successfulDefenses,
      sustainedResetsAfterSuccessfulDefense:
        launchDefenseTotals.sustainedResetsAfterSuccessfulDefense,
      successfulDefenseResetRatio: roundMetric(
        launchDefenseTotals.sustainedResetsAfterSuccessfulDefense
          / Math.max(1, launchDefenseTotals.successfulDefenses),
        3,
      ),
    };
    const controllableFrames = total((player) => player.movementIntent.controllableFrames);
    const contactFrames = total((player) => player.movementIntent.contestedContactFrames);
    const pressureFrames = total((player) => player.movementIntent.contestedPressureFrames);
    const pointBlankFrames = total((player) => player.movementIntent.contestedPointBlankFrames);
    const breakReactionSeconds = summaries.reduce((sum, summary) => (
      sum
      + summary.players[playerId].averageBreakReactionSeconds
        * summary.players[playerId].breakEscapes
    ), 0);
    const maximumRepeat = flowModels.reduce<{
      action: string | null;
      streak: number;
    }>((current, flow) => {
      const player = flow.players[playerId];
      return player.longestRepeatedActionStreak > current.streak
        ? { action: player.longestRepeatedAction, streak: player.longestRepeatedActionStreak }
        : current;
    }, { action: null, streak: 0 });
    return {
      actionAcceptance,
      acceptedCombatActionStartsPerRound: roundMetric(
        acceptedCombatActionStarts / Math.max(1, summaries.length),
        2,
      ),
      acceptedCombatActionStartsPerMinute: roundMetric(
        acceptedCombatActionStarts * 60 / Math.max(1, elapsedSeconds),
        2,
      ),
      dunkStarts: summaries.reduce((sum, summary) => sum + summary.players[playerId].dunkStarts, 0),
      dunkHits: summaries.reduce((sum, summary) => sum + summary.players[playerId].dunkHits, 0),
      averageDunkStartDistance: roundMetric(average(startDistances), 2),
      p90DunkStartDistance: roundMetric(percentile(startDistances, 0.9), 2),
      averageDunkHitDistance: roundMetric(average(hitDistances), 2),
      averageDunkStartTargetSpeed: roundMetric(average(startTargetSpeeds), 2),
      averageDunkStartSeparationSpeed: roundMetric(average(startSeparationSpeeds), 2),
      finishDunkStarts,
      finishDunkWins,
      averageFinishDunkStartTargetSpeed: roundMetric(average(finishStartTargetSpeeds), 2),
      averageFinishDunkStartSeparationSpeed: roundMetric(average(finishStartSeparationSpeeds), 2),
      zeroFuelTargetLaunchHits,
      zeroFuelLaunchBreakEscapes,
      averageAcceptedTacticalActionTypes: roundMetric(average(
        flowModels.map((flow) => flow.players[playerId].acceptedTacticalActions.length),
      ), 2),
      averageDominantTacticalActionShare: roundMetric(average(
        flowModels.map((flow) => flow.players[playerId].dominantTacticalActionShare),
      ), 3),
      averageTacticalActionEntropy: roundMetric(average(
        flowModels.map((flow) => flow.players[playerId].tacticalActionEntropy),
      ), 3),
      p90LongestRepeatedActionStreak: roundMetric(percentile(
        flowModels.map((flow) => flow.players[playerId].longestRepeatedActionStreak),
        0.9,
      ), 2),
      maximumRepeatedAction: maximumRepeat.action,
      maximumRepeatedActionStreak: maximumRepeat.streak,
      averageLaunchToDunkSeconds: launchToDunkSeconds.length > 0
        ? roundMetric(average(launchToDunkSeconds), 2)
        : null,
      breakEscapesPerRound: roundMetric(breakEscapes / Math.max(1, summaries.length), 2),
      averageBreakReactionSeconds: roundMetric(
        breakEscapes > 0 ? breakReactionSeconds / breakEscapes : 0,
        2,
      ),
      helplessRatio: roundMetric(
        summaries.reduce(
          (sum, summary) => sum + summary.combat.resources[playerId].helplessSeconds,
          0,
        ) / Math.max(1, elapsedSeconds),
        3,
      ),
      launchHitsReceived,
      helplessSecondsPerLaunchReceived: launchHitsReceived > 0
        ? roundMetric(helplessSeconds / launchHitsReceived, 2)
        : null,
      launchDefense,
      controlReturns,
      tacticalRepositionOpportunityFrames,
      tacticalRepositionOpportunityWindows,
      tacticalRepositionSelections,
      tacticalRepositionSelectionRatio: tacticalRepositionOpportunityWindows > 0
        ? roundMetric(
          tacticalRepositionSelections / tacticalRepositionOpportunityWindows,
          3,
        )
        : null,
      tacticalRepositionSelectionsPerRound: roundMetric(
        tacticalRepositionSelections / Math.max(1, summaries.length),
        2,
      ),
      tacticalRepositionSecondsPerRound: roundMetric(
        tacticalRepositionFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      postControlCounterstepWindows,
      postControlCounterstepWindowsPerRound: roundMetric(
        postControlCounterstepWindows / Math.max(1, summaries.length),
        2,
      ),
      postControlCounterstepSecondsPerRound: roundMetric(
        postControlCounterstepFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      postControlChaseLockWindows,
      postControlChaseLockWindowsPerRound: roundMetric(
        postControlChaseLockWindows / Math.max(1, summaries.length),
        2,
      ),
      postControlChaseLockFrames,
      postControlChaseLockSecondsPerRound: roundMetric(
        postControlChaseLockFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      postControlBoostSuppressionFrames,
      postControlBoostSuppressionSecondsPerRound: roundMetric(
        postControlBoostSuppressionFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      postControlDashSuppressionFrames,
      postControlDashSuppressionSecondsPerRound: roundMetric(
        postControlDashSuppressionFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      postControlChaseLockConsumptions,
      postControlChaseLockConsumptionsPerRound: roundMetric(
        postControlChaseLockConsumptions / Math.max(1, summaries.length),
        2,
      ),
      postControlRepeatDashWindows,
      postControlRepeatDashWindowsPerRound: roundMetric(
        postControlRepeatDashWindows / Math.max(1, summaries.length),
        2,
      ),
      postControlRepeatDashWeightFrames,
      postControlRepeatDashWeightSecondsPerRound: roundMetric(
        postControlRepeatDashWeightFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      postControlRepeatDashConsumptions,
      postControlRepeatDashConsumptionsPerRound: roundMetric(
        postControlRepeatDashConsumptions / Math.max(1, summaries.length),
        2,
      ),
      postControlRepeatDashSelections,
      postControlRepeatDashSelectionsPerRound: roundMetric(
        postControlRepeatDashSelections / Math.max(1, summaries.length),
        2,
      ),
      combatBoostLockFrames,
      combatBoostLockSecondsPerRound: roundMetric(
        combatBoostLockFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      combatBoostDelayFrames,
      combatBoostDelaySecondsPerRound: roundMetric(
        combatBoostDelayFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      combatBoostHeldInputFrames,
      combatBoostHeldInputSecondsPerRound: roundMetric(
        combatBoostHeldInputFrames * FIXED_DT / Math.max(1, summaries.length),
        2,
      ),
      combatBoostCancellations,
      combatBoostCancellationsPerRound: roundMetric(
        combatBoostCancellations / Math.max(1, summaries.length),
        2,
      ),
      naturalControlReturns,
      launchBreakControlReturns,
      relaunchesAfterControlReturn,
      relaunchesWithinOneSecond,
      relaunchesWithinTwoSeconds,
      immediateRelaunchRatio: roundMetric(
        relaunchesWithinOneSecond / Math.max(1, controlReturns),
        3,
      ),
      averageControlWindowSeconds: relaunchesAfterControlReturn > 0
        ? roundMetric(accumulatedControlWindowSeconds / relaunchesAfterControlReturn, 2)
        : null,
      relaunchesWithAcceptedAction,
      returnsWithAcceptedAction,
      averageFirstActionDelaySeconds: returnsWithAcceptedAction > 0
        ? roundMetric(accumulatedFirstActionDelaySeconds / returnsWithAcceptedAction, 2)
        : null,
      controlReturnsInPressure,
      sustainedResetsAfterControlReturn,
      controlReturnResetRatio: roundMetric(
        sustainedResetsAfterControlReturn / Math.max(1, controlReturnsInPressure),
        3,
      ),
      firstActionsInPressure,
      sustainedResetsAfterFirstAction,
      postReturnResetRatio: roundMetric(
        sustainedResetsAfterFirstAction / Math.max(1, firstActionsInPressure),
        3,
      ),
      firstAcceptedActions,
      controlReturnCausal,
      clashFirstActions,
      clashFirstActionsInPressure,
      clashFirstActionsWithinOneSecond,
      clashRapidLaunchRecommits,
      clashActionCoverageRatio: roundMetric(
        clashFirstActions / Math.max(1, launchClashes),
        3,
      ),
      clashImmediateActionRatio: roundMetric(
        clashFirstActionsWithinOneSecond / Math.max(1, launchClashes),
        3,
      ),
      clashRapidLaunchRecommitRatio: roundMetric(
        clashRapidLaunchRecommits / Math.max(1, launchClashes),
        3,
      ),
      averageClashFirstActionDelaySeconds: clashFirstActions > 0
        ? roundMetric(accumulatedClashFirstActionDelaySeconds / clashFirstActions, 2)
        : null,
      clashFirstAcceptedActions,
      zeroFuelRatio: roundMetric(
        summaries.reduce(
          (sum, summary) => sum + summary.combat.resources[playerId].zeroFuelSeconds,
          0,
        ) / Math.max(1, elapsedSeconds),
        3,
      ),
      approachRatio: roundMetric(
        total((player) => player.movementIntent.approachFrames) / Math.max(1, controllableFrames),
        3,
      ),
      orbitRatio: roundMetric(
        total((player) => player.movementIntent.orbitFrames) / Math.max(1, controllableFrames),
        3,
      ),
      retreatRatio: roundMetric(
        total((player) => player.movementIntent.retreatFrames) / Math.max(1, controllableFrames),
        3,
      ),
      idleRatio: roundMetric(
        total((player) => player.movementIntent.idleFrames) / Math.max(1, controllableFrames),
        3,
      ),
      contestedContactFrames: contactFrames,
      contactApproachRatio: roundMetric(
        total((player) => player.movementIntent.contestedContactApproachFrames) / Math.max(1, contactFrames),
        3,
      ),
      contactOrbitRatio: roundMetric(
        total((player) => player.movementIntent.contestedContactOrbitFrames) / Math.max(1, contactFrames),
        3,
      ),
      contactRetreatRatio: roundMetric(
        total((player) => player.movementIntent.contestedContactRetreatFrames) / Math.max(1, contactFrames),
        3,
      ),
      contactIdleRatio: roundMetric(
        total((player) => player.movementIntent.contestedContactIdleFrames) / Math.max(1, contactFrames),
        3,
      ),
      pressureApproachRatio: roundMetric(
        total((player) => player.movementIntent.contestedPressureApproachFrames) / Math.max(1, pressureFrames),
        3,
      ),
      pressureRetreatRatio: roundMetric(
        total((player) => player.movementIntent.contestedPressureRetreatFrames) / Math.max(1, pressureFrames),
        3,
      ),
      pointBlankApproachRatio: roundMetric(
        total((player) => player.movementIntent.contestedPointBlankApproachFrames) / Math.max(1, pointBlankFrames),
        3,
      ),
      pointBlankRetreatRatio: roundMetric(
        total((player) => player.movementIntent.contestedPointBlankRetreatFrames) / Math.max(1, pointBlankFrames),
        3,
      ),
    };
  };
  const launchClashes = summaries.reduce(
    (sum, summary) => sum + summary.combat.eventCounts.launch_clash,
    0,
  );
  const clashRepeatOpportunities = flowModels.reduce(
    (sum, flow) => sum + Math.max(0, flow.clashFollowUp.clashes - 1),
    0,
  );
  const repeatClashesWithinOneSecond = flowModels.reduce(
    (sum, flow) => sum + flow.clashFollowUp.repeatClashesWithinOneSecond,
    0,
  );
  const totalNeutralResets = flowModels.reduce((sum, flow) => sum + flow.neutralResets, 0);
  const longestPressureSequences = flowModels.map((flow) => flow.longestPressureSequenceSeconds);
  const exchanges = flowModels.flatMap((flow) => flow.exchanges);
  const neutralExitCount = flowModels.reduce(
    (sum, flow) => sum + flow.neutralExitFollowUp.exits,
    0,
  );
  const neutralExitFirstActions = flowModels.reduce(
    (sum, flow) => sum + flow.neutralExitFollowUp.firstActions,
    0,
  );
  const neutralExitBriefExits = flowModels.reduce(
    (sum, flow) => sum + flow.neutralExitFollowUp.briefExits,
    0,
  );
  const neutralExitResetExits = flowModels.reduce(
    (sum, flow) => sum + flow.neutralExitFollowUp.resetExits,
    0,
  );
  const neutralExitCarriedBriefExits = flowModels.reduce(
    (sum, flow) => sum + flow.neutralExitFollowUp.briefExitsWithoutAcceptedAction,
    0,
  );
  const neutralExitCarriedBriefCauses = Object.fromEntries(
    BALANCE_LAB_CARRIED_REENTRY_CAUSES.map((cause) => [
      cause,
      flowModels.reduce(
        (sum, flow) => sum + flow.neutralExitFollowUp.carriedBriefExitCauses[cause],
        0,
      ),
    ]),
  ) as Record<BalanceLabCarriedReentryCause, number>;
  const accumulatedNeutralFirstActionDelaySeconds = flowModels.reduce((sum, flow) => (
    sum
    + (flow.neutralExitFollowUp.averageFirstActionDelaySeconds ?? 0)
      * flow.neutralExitFollowUp.firstActions
  ), 0);
  const neutralExitFirstAcceptedActions = Object.fromEntries(
    BALANCE_LAB_CONTROL_RETURN_ACTIONS.map((action) => [
      action,
      flowModels.reduce(
        (sum, flow) => sum + flow.neutralExitFollowUp.firstAcceptedActions[action],
        0,
      ),
    ]),
  ) as Record<CombatAction, number>;
  const unresolvedExchanges = exchanges.filter((exchange) => !exchange.resolved);
  const resolvedExchangeCount = exchanges.length - unresolvedExchanges.length;
  const resetExchangeCount = exchanges.filter((exchange) => exchange.createdReset).length;
  const exchangeSequences = flowModels.flatMap((flow, index) => {
    const round = roundEvidence[index];
    if (!round) {
      return [];
    }
    const roundContactRatio = roundMetric(
      round.telemetry.spacing.contactFrames / Math.max(1, round.telemetry.framesSimulated),
      3,
    );
    return flow.exchanges.map((exchange): AiMatchupExchangeSequenceEvidence => ({
      seed: round.roundSeed,
      setSeed: round.setSeed,
      gameNumber: round.gameNumber,
      roundNumber: round.roundNumber,
      exchangeNumber: exchange.exchangeNumber,
      startSeconds: exchange.startSeconds,
      endSeconds: exchange.endSeconds,
      pressureSeconds: exchange.pressureSeconds,
      neutralWindowSeconds: exchange.neutralWindowSeconds,
      status: exchange.status,
      stopReason: exchangeStopReason(exchange.status, round.stopReason),
      roundStopReason: round.stopReason,
      roundWinner: round.winner,
      resolved: exchange.resolved,
      openerActorId: exchange.openerActorId,
      openerAction: exchange.openerAction,
      outcomeLabels: exchange.outcomes.map((outcome) => outcome.label),
      exitBand: exchange.exitBand,
      firstNeutralActionActorId: exchange.firstNeutralActionActorId,
      firstNeutralAction: exchange.firstNeutralAction,
      firstNeutralActionDelaySeconds: exchange.firstNeutralActionDelaySeconds,
      carriedReentryCause: exchange.carriedReentryCause,
      reentryContext: exchange.reentryContext,
      roundContactRatio,
      roundContactSeconds: roundMetric(round.telemetry.spacing.contactSeconds, 2),
    }));
  });
  const worstUnresolved = selectExchangeSequence(
    exchangeSequences.filter((exchange) => !exchange.resolved),
    (first, second) => second.pressureSeconds - first.pressureSeconds
      || first.neutralWindowSeconds - second.neutralWindowSeconds
      || compareExchangeContext(first, second),
  );
  const worstBriefExit = selectExchangeSequence(
    exchangeSequences.filter((exchange) => exchange.status === 'brief_exit'),
    (first, second) => second.pressureSeconds - first.pressureSeconds
      || first.neutralWindowSeconds - second.neutralWindowSeconds
      || compareExchangeContext(first, second),
  );
  const worstContact = selectExchangeSequence(
    exchangeSequences.filter((exchange) => exchange.roundContactSeconds > 0),
    (first, second) => second.roundContactRatio - first.roundContactRatio
      || second.pressureSeconds - first.pressureSeconds
      || compareExchangeContext(first, second),
  );
  const timeoutRoundEvidence = flowModels.flatMap((flow, index): AiMatchupTimeoutRoundEvidence[] => {
    const round = roundEvidence[index];
    if (!round || round.stopReason !== 'round_timeout') {
      return [];
    }
    const exchangeCount = flow.exchanges.length;
    const resolvedExchangeCount = flow.exchanges.filter((exchange) => exchange.resolved).length;
    const briefExitCount = flow.exchanges.filter((exchange) => exchange.status === 'brief_exit').length;
    const elapsedSeconds = roundMetric(round.telemetry.elapsedSeconds, 2);
    return [{
      seed: round.roundSeed,
      setSeed: round.setSeed,
      gameNumber: round.gameNumber,
      roundNumber: round.roundNumber,
      elapsedSeconds,
      focusStartSeconds: roundMetric(Math.max(0, elapsedSeconds - 12), 2),
      focusEndSeconds: elapsedSeconds,
      contactRatio: roundMetric(flow.contactRatio, 3),
      contactSeconds: roundMetric(round.telemetry.spacing.contactSeconds, 2),
      pointBlankRatio: roundMetric(flow.pointBlankRatio, 3),
      pressureBandRatio: roundMetric(flow.pressureBandRatio, 3),
      neutralResets: flow.neutralResets,
      averageNeutralWindowSeconds: roundMetric(flow.averageNeutralWindowSeconds, 2),
      longestPressureSequenceSeconds: roundMetric(flow.longestPressureSequenceSeconds, 2),
      resolvedExchangeRatio: exchangeCount > 0
        ? roundMetric(resolvedExchangeCount / exchangeCount, 3)
        : null,
      briefExitRatio: exchangeCount > 0
        ? roundMetric(briefExitCount / exchangeCount, 3)
        : null,
    }];
  });
  const representativeTimeout = [...timeoutRoundEvidence].sort((first, second) => (
    second.pressureBandRatio - first.pressureBandRatio
    || second.contactRatio - first.contactRatio
    || (second.briefExitRatio ?? -1) - (first.briefExitRatio ?? -1)
    || second.longestPressureSequenceSeconds - first.longestPressureSequenceSeconds
    || first.averageNeutralWindowSeconds - second.averageNeutralWindowSeconds
    || first.gameNumber - second.gameNumber
    || first.roundNumber - second.roundNumber
  ))[0] ?? null;
  const combineResetOutcomes = (
    key: keyof AiMatchupFlowSummary['resetOutcomes'],
  ): AiMatchupResetSummary => {
    const attempts = flowModels.reduce((sum, flow) => sum + flow.resetOutcomes[key].attempts, 0);
    const successes = flowModels.reduce((sum, flow) => sum + flow.resetOutcomes[key].successes, 0);
    return {
      attempts,
      successes,
      successRatio: attempts > 0 ? roundMetric(successes / attempts, 3) : null,
    };
  };
  const loopStageRepresentatives = Object.fromEntries(
    BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
      const candidates = flowModels.flatMap((flow, index): AiMatchupLoopStageEvidence[] => {
        const round = roundEvidence[index];
        const stage = flow.loopStages.find((entry) => entry.id === stageId);
        if (!round || !stage || (stage.status !== 'watch' && stage.status !== 'blocked')) {
          return [];
        }
        const focusEndSeconds = roundMetric(flow.elapsedSeconds, 2);
        return [{
          stageId,
          label: stage.label,
          status: stage.status,
          detail: stage.detail,
          seed: round.roundSeed,
          setSeed: round.setSeed,
          gameNumber: round.gameNumber,
          roundNumber: round.roundNumber,
          elapsedSeconds: focusEndSeconds,
          focusStartSeconds: roundMetric(Math.max(0, focusEndSeconds - 12), 2),
          focusEndSeconds,
          relatedGlobalTuning: (stage.relatedGlobalTuning ?? []).map(String),
          relatedAiBehavior: [...(stage.relatedAiBehavior ?? [])],
          relatedCharacterControls: [...(stage.relatedCharacterControls ?? [])],
          relatedCharacterTargets: (stage.relatedCharacterTargets ?? []).map((target) => ({
            playerId: target.playerId,
            control: target.control,
          })),
          relatedPlayerIds: [...(stage.relatedPlayerIds ?? [])],
        }];
      });
      const representative = [...candidates].sort((first, second) => (
        Number(second.status === 'blocked') - Number(first.status === 'blocked')
        || second.elapsedSeconds - first.elapsedSeconds
        || first.gameNumber - second.gameNumber
        || first.roundNumber - second.roundNumber
      ))[0] ?? null;
      return [stageId, representative];
    }),
  ) as AiMatchupLoopStageRepresentatives;
  return {
    rounds: summaries.length,
    loopStages: aggregateBalanceLabLoopStages(flowModels),
    loopStageRepresentatives,
    timeoutRounds: flowModels.filter((flow) => !flow.roundFinished).length,
    representativeTimeout,
    launchClashes,
    launchClashesPerRound: roundMetric(launchClashes / Math.max(1, summaries.length), 2),
    launchClashesPerMinute: roundMetric(launchClashes * 60 / Math.max(1, elapsedSeconds), 2),
    clashRepeatOpportunities,
    repeatClashesWithinOneSecond,
    repeatClashRatio: clashRepeatOpportunities > 0
      ? roundMetric(repeatClashesWithinOneSecond / clashRepeatOpportunities, 3)
      : null,
    neutralResetsPerRound: roundMetric(totalNeutralResets / Math.max(1, summaries.length), 2),
    neutralResetsPerMinute: roundMetric(totalNeutralResets * 60 / Math.max(1, elapsedSeconds), 2),
    averagePressureSequenceSeconds: roundMetric(average(
      flowModels.map((flow) => flow.averagePressureSequenceSeconds),
    ), 2),
    averageLongestPressureSequenceSeconds: roundMetric(average(longestPressureSequences), 2),
    p90LongestPressureSequenceSeconds: roundMetric(percentile(longestPressureSequences, 0.9), 2),
    averageNeutralWindowSeconds: roundMetric(average(
      flowModels.map((flow) => flow.averageNeutralWindowSeconds),
    ), 2),
    averageLongestNeutralWindowSeconds: roundMetric(average(
      flowModels.map((flow) => flow.longestNeutralWindowSeconds),
    ), 2),
    resetOutcomes: {
      all: combineResetOutcomes('all'),
      clashes: combineResetOutcomes('clashes'),
      defense: combineResetOutcomes('defense'),
      parries: combineResetOutcomes('parries'),
      launchBreaks: combineResetOutcomes('launchBreaks'),
    },
    exchanges: {
      total: exchanges.length,
      resolved: resolvedExchangeCount,
      unresolved: unresolvedExchanges.length,
      resolvedRatio: exchanges.length > 0
        ? roundMetric(resolvedExchangeCount / exchanges.length, 3)
        : null,
      resets: resetExchangeCount,
      resetRatio: exchanges.length > 0
        ? roundMetric(resetExchangeCount / exchanges.length, 3)
        : null,
      briefExits: exchanges.filter((exchange) => exchange.status === 'brief_exit').length,
      ongoing: exchanges.filter((exchange) => exchange.status === 'ongoing').length,
      finished: exchanges.filter((exchange) => exchange.status === 'finished').length,
      averagePressureSeconds: roundMetric(average(
        exchanges.map((exchange) => exchange.pressureSeconds),
      ), 2),
      p90PressureSeconds: roundMetric(percentile(
        exchanges.map((exchange) => exchange.pressureSeconds),
        0.9,
      ), 2),
      averageUnresolvedPressureSeconds: exchanges.length === 0
        ? null
        : roundMetric(average(
          unresolvedExchanges.map((exchange) => exchange.pressureSeconds),
        ), 2),
      longestUnresolvedPressureSeconds: roundMetric(Math.max(
        0,
        ...unresolvedExchanges.map((exchange) => exchange.pressureSeconds),
      ), 2),
      representativeSequences: {
        worstUnresolved,
        worstBriefExit,
        worstContact,
      },
    },
    neutralExitFollowUp: {
      exits: neutralExitCount,
      briefExits: neutralExitBriefExits,
      resetExits: neutralExitResetExits,
      firstActions: neutralExitFirstActions,
      firstActionCoverageRatio: neutralExitCount > 0
        ? roundMetric(neutralExitFirstActions / neutralExitCount, 3)
        : null,
      averageFirstActionDelaySeconds: neutralExitFirstActions > 0
        ? roundMetric(accumulatedNeutralFirstActionDelaySeconds / neutralExitFirstActions, 2)
        : null,
      briefExitsWithoutAcceptedAction: neutralExitCarriedBriefExits,
      carriedBriefExitRatio: neutralExitBriefExits > 0
        ? roundMetric(neutralExitCarriedBriefExits / neutralExitBriefExits, 3)
        : null,
      carriedBriefExitCauses: neutralExitCarriedBriefCauses,
      playerFirstActions: {
        P1: flowModels.reduce(
          (sum, flow) => sum + flow.neutralExitFollowUp.playerFirstActions.P1,
          0,
        ),
        P2: flowModels.reduce(
          (sum, flow) => sum + flow.neutralExitFollowUp.playerFirstActions.P2,
          0,
        ),
      },
      firstAcceptedActions: neutralExitFirstAcceptedActions,
    },
    ordinaryBoostCounterplay: {
      P1: {
        ...ordinaryBoostCounterplay.P1,
        opportunitiesPerRound: roundMetric(
          ordinaryBoostCounterplay.P1.opportunities / Math.max(1, summaries.length),
          2,
        ),
      },
      P2: {
        ...ordinaryBoostCounterplay.P2,
        opportunitiesPerRound: roundMetric(
          ordinaryBoostCounterplay.P2.opportunities / Math.max(1, summaries.length),
          2,
        ),
      },
    },
    roundsWithNoDunkStart: summaries.filter((summary) => (
      summary.players.P1.dunkStarts + summary.players.P2.dunkStarts === 0
    )).length,
    roundsWithLaunchHitsButNoDunkStart: summaries.filter((summary) => (
      summary.players.P1.launchHits + summary.players.P2.launchHits > 0
      && summary.players.P1.dunkStarts + summary.players.P2.dunkStarts === 0
    )).length,
    players: {
      P1: buildPlayer('P1'),
      P2: buildPlayer('P2'),
    },
  };
}

function resolveExactBalanceProfile(profileId: string) {
  const profile = resolveBalanceProfile(profileId);
  if (profile.id !== profileId) {
    throw new Error(`Unknown balance profile "${profileId}". Resolved fallback "${profile.id}" is not allowed in batch reports.`);
  }
  return profile;
}

function readBalanceLabDraft(path: string): BalanceLabDraft {
  const absolutePath = resolve(process.cwd(), path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Balance Lab draft "${path}": ${detail}`);
  }
  const draft = parseBalanceLabDraft(parsed);
  if (!draft) {
    throw new Error(`Invalid Balance Lab draft "${path}". Export a gw.balance-lab-draft.v3 payload from the in-game Balance Lab.`);
  }
  return draft;
}

function resolveBatchBalanceRules(profileId: string, draftPath: string | null): BatchBalanceRules {
  const profile = resolveExactBalanceProfile(profileId);
  if (!draftPath) {
    const characterBalanceOverrides: CharacterBalanceOverrides = {};
    const aiBehaviorTuning = createDefaultAiBehaviorTuning();
    return {
      source: 'profile',
      profileId: profile.id,
      tuning: { ...profile.tuning },
      tuningFingerprint: fingerprintBalanceTuning(profile.tuning),
      characterBalanceOverrides,
      characterBalanceFingerprint: fingerprintCharacterBalanceOverrides(characterBalanceOverrides),
      effectiveCharacterRulesFingerprint: resolveCharacterRulesFingerprint(
        CHARACTER_REGISTRY_FINGERPRINT,
        characterBalanceOverrides,
      ),
      aiBehaviorTuning,
      aiBehaviorFingerprint: fingerprintAiBehaviorTuning(aiBehaviorTuning),
      draft: null,
    };
  }

  const draft = readBalanceLabDraft(draftPath);
  return {
    source: 'draft',
    profileId: profile.id,
    tuning: { ...draft.tuning },
    tuningFingerprint: draft.tuningFingerprint,
    characterBalanceOverrides: draft.characterBalanceOverrides,
    characterBalanceFingerprint: draft.characterBalanceFingerprint,
    effectiveCharacterRulesFingerprint: resolveCharacterRulesFingerprint(
      CHARACTER_REGISTRY_FINGERPRINT,
      draft.characterBalanceOverrides,
    ),
    aiBehaviorTuning: sanitiseAiBehaviorTuning(draft.aiBehaviorTuning),
    aiBehaviorFingerprint: draft.aiBehaviorFingerprint,
    draft: {
      path: draftPath,
      name: draft.name,
      savedAt: draft.savedAt,
    },
  };
}

function parseIntegerArg(argv: string[], flag: string, fallback: number): number {
  const index = argv.findIndex((value) => value === flag);
  const raw = index >= 0 ? Number(argv[index + 1]) : Number.NaN;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1, Math.floor(raw));
}

function parseStringArg(argv: string[], flag: string): string | null {
  const index = argv.findIndex((value) => value === flag);
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1]?.trim();
  return value ? value : null;
}

const VALUE_CLI_FLAGS = new Set([
  '--games',
  '--max-round-seconds',
  '--seed',
  '--profile',
  '--difficulty',
  '--recovery-policy',
  '--clash-policy',
  '--pursuit-policy',
  '--characters',
  '--p1',
  '--p2',
  '--thresholds',
  '--draft',
  '--compare-report',
  '--report-name',
  '--output-dir',
]);
const BOOLEAN_CLI_FLAGS = new Set([
  '--emit-review-replays',
  '--allow-multi-rule-comparison',
  '--advisory-gate',
]);

function assertKnownCliFlags(argv: string[]): void {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      continue;
    }
    if (BOOLEAN_CLI_FLAGS.has(value)) {
      continue;
    }
    if (!VALUE_CLI_FLAGS.has(value)) {
      throw new Error(`Unknown AI batch option "${value}". Check the documented command flags.`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`AI batch option "${value}" requires a value.`);
    }
    index += 1;
  }
}

function getPositionalArgs(argv: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith('--')) {
      if (!BOOLEAN_CLI_FLAGS.has(value)) {
        index += 1;
      }
      continue;
    }
    values.push(value);
  }
  return values;
}

function parseDifficultyIds(raw: string | null): AiDifficultyId[] {
  if (!raw || raw.toLowerCase() === 'all') {
    const difficultyIds = [...AI_DIFFICULTY_ORDER];
    if (difficultyIds.length === 0) {
      throw new Error('No AI difficulty profiles are registered for the batch matrix.');
    }
    return difficultyIds;
  }
  const requestedIds = raw
    .split(',')
    .map((value) => value.trim());
  if (requestedIds.some((value) => value.length === 0)) {
    throw new Error('--difficulty must select at least one AI difficulty id.');
  }
  const unknownIds = requestedIds.filter(
    (value) => !AI_DIFFICULTY_ORDER.includes(value as AiDifficultyId),
  );
  if (unknownIds.length > 0) {
    throw new Error(
      `Unknown --difficulty id(s): ${unknownIds.map((value) => `"${value}"`).join(', ')}. Use ${AI_DIFFICULTY_ORDER.join(', ')}, or all.`,
    );
  }
  return [...new Set(requestedIds as AiDifficultyId[])];
}

function parseRecoveryPolicyId(raw: string | null): AiRecoveryPolicyId {
  if (!raw) {
    return DEFAULT_AI_RECOVERY_POLICY;
  }
  if (AI_RECOVERY_POLICY_IDS.includes(raw as AiRecoveryPolicyId)) {
    return raw as AiRecoveryPolicyId;
  }
  throw new Error(
    `Unknown --recovery-policy "${raw}". Use ${AI_RECOVERY_POLICY_IDS.join(', ')}.`,
  );
}

function parseClashPolicyId(raw: string | null): AiClashPolicyId {
  if (!raw) {
    return DEFAULT_AI_CLASH_POLICY;
  }
  if (AI_CLASH_POLICY_IDS.includes(raw as AiClashPolicyId)) {
    return raw as AiClashPolicyId;
  }
  throw new Error(
    `Unknown --clash-policy "${raw}". Use ${AI_CLASH_POLICY_IDS.join(', ')}.`,
  );
}

function parsePursuitPolicyId(raw: string | null): AiPursuitPolicyId {
  if (!raw) {
    return DEFAULT_AI_PURSUIT_POLICY;
  }
  if (AI_PURSUIT_POLICY_IDS.includes(raw as AiPursuitPolicyId)) {
    return raw as AiPursuitPolicyId;
  }
  throw new Error(
    `Unknown --pursuit-policy "${raw}". Use ${AI_PURSUIT_POLICY_IDS.join(', ')}.`,
  );
}

function parseCharacterIds(raw: string | null): CharacterId[] {
  if (!raw || raw.toLowerCase() === 'all') {
    return [...CHARACTER_IDS];
  }
  const requestedIds = raw
    .split(',')
    .map((value) => value.trim());
  if (requestedIds.some((value) => value.length === 0)) {
    throw new Error('--characters must select at least one registered character id.');
  }
  const unknownIds = requestedIds.filter((value) => !isCharacterId(value));
  if (unknownIds.length > 0) {
    throw new Error(
      `Unknown --characters id(s): ${unknownIds.map((value) => `"${value}"`).join(', ')}. Use ${CHARACTER_IDS.join(', ')}, or all.`,
    );
  }
  return [...new Set(requestedIds as CharacterId[])];
}

function buildPairings(
  p1Raw: string | null,
  p2Raw: string | null,
  characterIds: readonly CharacterId[],
): Array<{ p1: CharacterId; p2: CharacterId }> {
  for (const [flag, characterId] of [['--p1', p1Raw], ['--p2', p2Raw]] as const) {
    if (characterId && !isCharacterId(characterId)) {
      throw new Error(
        `Unknown ${flag} character id "${characterId}". Use ${CHARACTER_IDS.join(', ')}.`,
      );
    }
  }
  if ((p1Raw && !p2Raw) || (!p1Raw && p2Raw)) {
    throw new Error('--p1 and --p2 must be provided together.');
  }
  if (p1Raw && p2Raw) {
    return [{ p1: p1Raw, p2: p2Raw }];
  }
  if (characterIds.length === 0) {
    throw new Error('No registered characters are available for the AI batch roster.');
  }

  const pairings: Array<{ p1: CharacterId; p2: CharacterId }> = [];
  for (const p1 of characterIds) {
    for (const p2 of characterIds) {
      if (p1 === p2) {
        continue;
      }
      pairings.push({ p1, p2 });
    }
  }
  if (pairings.length === 0) {
    throw new Error(
      'AI batch selection generated zero directed pairings. Select at least two characters with --characters, or provide both --p1 and --p2.',
    );
  }
  return pairings;
}

function parseArgs(argv: string[]): CliOptions {
  assertKnownCliFlags(argv);
  const positionalArgs = getPositionalArgs(argv);
  const hasExpandedPositionalArgs = positionalArgs.length >= 5 && Number.isFinite(Number(positionalArgs[1]));
  const gamesPerPairing = parseIntegerArg(argv, '--games', Number(positionalArgs[0] ?? DEFAULT_GAMES_PER_PAIRING));
  const maxRoundSeconds = parseIntegerArg(
    argv,
    '--max-round-seconds',
    hasExpandedPositionalArgs ? Number(positionalArgs[1]) : DEFAULT_MAX_ROUND_SECONDS,
  );
  const baseSeed = parseIntegerArg(argv, '--seed', DEFAULT_BASE_SEED) >>> 0;
  const profileId = parseStringArg(argv, '--profile') ?? DEFAULT_PROFILE_ID;
  const difficultyIds = parseDifficultyIds(
    parseStringArg(argv, '--difficulty') ?? positionalArgs[hasExpandedPositionalArgs ? 2 : 1] ?? null,
  );
  const recoveryPolicyId = parseRecoveryPolicyId(parseStringArg(argv, '--recovery-policy'));
  const clashPolicyId = parseClashPolicyId(parseStringArg(argv, '--clash-policy'));
  const pursuitPolicyId = parsePursuitPolicyId(parseStringArg(argv, '--pursuit-policy'));
  const characterIds = parseCharacterIds(parseStringArg(argv, '--characters'));
  const pairings = buildPairings(
    parseStringArg(argv, '--p1') ?? positionalArgs[hasExpandedPositionalArgs ? 3 : 2] ?? null,
    parseStringArg(argv, '--p2') ?? positionalArgs[hasExpandedPositionalArgs ? 4 : 3] ?? null,
    characterIds,
  );
  const thresholdsPath = parseStringArg(argv, '--thresholds');
  const draftPath = parseStringArg(argv, '--draft');
  const compareReportPath = parseStringArg(argv, '--compare-report');
  const allowMultiRuleComparison = argv.includes('--allow-multi-rule-comparison');
  const reportName = (parseStringArg(argv, '--report-name') ?? 'ai-matchup-batch-report')
    .replace(/[^a-z0-9_-]/gi, '-');
  const outputDir = resolve(
    process.cwd(),
    parseStringArg(argv, '--output-dir') ?? 'build-artifacts',
  );
  const emitReviewReplays = argv.includes('--emit-review-replays');
  const advisoryGate = argv.includes('--advisory-gate');

  return {
    gamesPerPairing,
    maxRoundSeconds,
    baseSeed,
    profileId,
    difficultyIds,
    recoveryPolicyId,
    clashPolicyId,
    pursuitPolicyId,
    characterIds,
    pairings,
    thresholdsPath,
    draftPath,
    compareReportPath,
    allowMultiRuleComparison,
    reportName,
    outputDir,
    emitReviewReplays,
    advisoryGate,
  };
}

function simulateSet(
  p1: CharacterId,
  p2: CharacterId,
  difficulty: AiDifficultyId,
  balanceRules: BatchBalanceRules,
  setSeed: number,
  gameNumber: number,
  maxRoundSeconds: number,
  recoveryPolicyId: AiRecoveryPolicyId,
  clashPolicyId: AiClashPolicyId,
  pursuitPolicyId: AiPursuitPolicyId,
): {
  winner: 'P1' | 'P2' | null;
  roundsPlayed: number;
  totalFrames: number;
  timeoutRounds: number;
  telemetrySummaries: MatchTelemetrySummary[];
  flowEvidence: AiMatchupRoundEvidence[];
} {
  const maxRoundFrames = Math.max(1, Math.floor(maxRoundSeconds / FIXED_DT));
  let p1RoundWins = 0;
  let p2RoundWins = 0;
  let totalFrames = 0;
  let timeoutRounds = 0;
  const telemetrySummaries: MatchTelemetrySummary[] = [];
  const flowEvidence: AiMatchupRoundEvidence[] = [];

  for (let round = 0; round < MAX_ROUNDS_PER_SET; round += 1) {
    const result = simulateAiRound({
      p1,
      p2,
      difficulty,
      recoveryPolicyId,
      clashPolicyId,
      pursuitPolicyId,
      behaviorTuning: balanceRules.aiBehaviorTuning,
      setSeed,
      roundIndex: round,
      maxFrames: maxRoundFrames,
      rules: { allowDunkWin: true },
      tuning: balanceRules.tuning,
      characterBalanceOverrides: balanceRules.characterBalanceOverrides,
    });
    const roundWinner = result.winner;
    const telemetrySummary = result.telemetry;
    totalFrames += result.framesSimulated;
    telemetrySummaries.push(telemetrySummary);
    flowEvidence.push({
      telemetry: telemetrySummary,
      decisionFlow: result.decisionFlow,
      setSeed,
      roundSeed: result.roundSeed,
      gameNumber,
      roundNumber: round + 1,
      stopReason: roundWinner ? 'round_win' : 'round_timeout',
      winner: roundWinner,
    });

    if (!roundWinner) {
      timeoutRounds += 1;
      continue;
    }

    if (roundWinner === 'P1') {
      p1RoundWins += 1;
    } else {
      p2RoundWins += 1;
    }

  }

  return {
    winner: p1RoundWins >= ROUNDS_TO_WIN && p1RoundWins > p2RoundWins
      ? 'P1'
      : p2RoundWins >= ROUNDS_TO_WIN && p2RoundWins > p1RoundWins
        ? 'P2'
        : null,
    roundsPlayed: telemetrySummaries.length,
    totalFrames,
    timeoutRounds,
    telemetrySummaries,
    flowEvidence,
  };
}

function readBalanceThresholds(path: string): AiBalanceThresholds {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AiBalanceThresholds>;
  if (parsed.schemaVersion !== AI_BALANCE_THRESHOLD_SCHEMA_VERSION || typeof parsed.id !== 'string') {
    throw new Error(`Invalid AI balance threshold file: ${path}.`);
  }
  const numericKeys: Array<keyof Omit<AiBalanceThresholds, 'schemaVersion' | 'id'>> = [
    'minimumGamesPerPairing',
    'minimumCompletedSetRatio',
    'minimumRoundResolutionRatio',
    'maximumTimeoutRoundRatio',
    'maximumAverageRoundSeconds',
    'maximumContactRatio',
    'maximumP90ContactEpisodeSeconds',
    'maximumContactEpisodeSeconds',
    'maximumPointBlankRatio',
    'maximumPressureBandRatio',
    'maximumP90PressureSequenceSeconds',
    'minimumLoopStageReachedRounds',
    'maximumCommitmentIssueRatio',
    'maximumChaseIssueRatio',
    'maximumCommitmentBlockedRatio',
    'maximumChaseBlockedRatio',
    'minimumNeutralResetsPerRound',
    'minimumResetConversionRatio',
    'minimumAverageNeutralWindowSeconds',
    'minimumResolvedExchangeRatio',
    'minimumExchangeResetRatio',
    'maximumBriefExitRatio',
    'maximumAverageUnresolvedPressureSeconds',
    'minimumRepeatClashOpportunities',
    'maximumRepeatClashRatio',
    'minimumPostClashLaunchOpportunities',
    'maximumRapidPostClashLaunchRatio',
    'minimumImmediateRelaunchOpportunities',
    'maximumImmediateRelaunchRatio',
    'minimumControlReturnResetOpportunities',
    'minimumControlReturnResetRatio',
    'minimumBriefReentryOpportunities',
    'maximumCarriedBriefReentryRatio',
    'maximumRoundsWithoutDunkStartRatio',
    'maximumLaunchHitRoundsWithoutDunkStartRatio',
    'minimumAcceptedActionsPerPlayerPerRound',
    'minimumAcceptedTacticalActionTypes',
    'maximumAverageDominantTacticalActionShare',
    'maximumP90RepeatedTacticalActionStreak',
    'minimumSpecialStartsPerPlayerPerRound',
    'minimumDunkStartsPerPlayerPerRound',
    'minimumFinishDunkStartsPerPlayerPerRound',
    'minimumFinishDunkConversionOpportunities',
    'minimumFinishDunkConversionRatio',
    'minimumAverageLaunchBreakReactionSeconds',
    'maximumAverageLaunchToDunkSeconds',
    'maximumLaunchConversionRate',
    'maximumHelplessRatio',
  ];
  for (const key of numericKeys) {
    if (!Number.isFinite(parsed[key])) {
      throw new Error(`AI balance threshold ${String(key)} must be a finite number.`);
    }
  }
  return parsed as AiBalanceThresholds;
}

interface ComparableBatchReport {
  schemaVersion: string;
  generatedAt: string;
  characterRegistry: BatchReport['characterRegistry'];
  options: Omit<BatchReport['options'], 'draftPath' | 'clashPolicyId' | 'pursuitPolicyId'> & {
    draftPath?: string | null;
    clashPolicyId?: AiClashPolicyId;
    pursuitPolicyId?: AiPursuitPolicyId;
  };
  simulation: BatchReport['simulation'];
  aiBaseProfilesFingerprint?: string;
  aiProfilesFingerprint: string;
  ruleSnapshot?: AiBatchRuleSnapshot;
  designerBrief?: AiFlowDesignerBrief;
  summaries: MatchSummary[];
}

interface BatchComparisonPreflight {
  baseline: ComparableBatchReport;
  ruleComparison: AiBatchRuleComparison;
}

function isFiniteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeIntegerMetric(value: unknown): value is number {
  return isFiniteMetric(value) && Number.isInteger(value) && value >= 0;
}

function isRoundedPerRoundMetric(
  value: unknown,
  rawValue: number,
  rounds: number,
  scale = 1,
): value is number {
  return isFiniteMetric(value)
    && value >= 0
    && value === roundMetric(rawValue * scale / rounds, 2);
}

function isNullableFiniteMetric(value: unknown): value is number | null {
  return value === null || isFiniteMetric(value);
}

function hasExactCountHistogram(
  value: unknown,
  keys: readonly string[],
  expectedTotal: number,
): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  let total = 0;
  for (const key of keys) {
    const count = record[key];
    if (!isNonNegativeIntegerMetric(count)) {
      return false;
    }
    total += count;
  }
  return total === expectedTotal;
}

function hasControlReturnCausalRoleFlow(
  value: unknown,
  windows: number,
  firstActions: number,
  dominantApproachWindows: number,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const role = value as Partial<BalanceLabControlReturnCausalRoleFlow>;
  const movementIntents = role.dominantMovementIntents;
  const activeActions = role.dominantActiveActions;
  const firstAcceptedActions = role.firstAcceptedActions;
  return hasExactCountHistogram(
    movementIntents,
    [...COMBAT_CONTROL_RETURN_MOVEMENT_INTENTS, 'unobserved'],
    windows,
  )
    && hasExactCountHistogram(
      activeActions,
      [...COMBAT_CONTROL_RETURN_ACTIVE_ACTIONS, 'unobserved'],
      windows,
    )
    && hasExactCountHistogram(
      firstAcceptedActions,
      [...BALANCE_LAB_CONTROL_RETURN_ACTIONS, 'none'],
      windows,
    )
    && movementIntents.approach === dominantApproachWindows
    && firstAcceptedActions.none === windows - firstActions;
}

function isComparableMatchSummary(value: unknown): value is MatchSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const summary = value as Partial<MatchSummary>;
  const telemetry = summary.telemetry;
  const flow = summary.flow;
  return typeof summary.p1 === 'string'
    && isCharacterId(summary.p1)
    && typeof summary.p2 === 'string'
    && isCharacterId(summary.p2)
    && typeof summary.difficulty === 'string'
    && AI_DIFFICULTY_ORDER.includes(summary.difficulty as AiDifficultyId)
    && Array.isArray(summary.seeds)
    && summary.seeds.every(isFiniteMetric)
    && isFiniteMetric(summary.totalRoundTimeouts)
    && Boolean(telemetry)
    && isFiniteMetric(telemetry?.rounds)
    && isFiniteMetric(telemetry?.elapsedSeconds)
    && isFiniteMetric(telemetry?.spacing?.contactRatio)
    && isFiniteMetric(telemetry?.spacing?.pointBlankRatio)
    && isFiniteMetric(telemetry?.spacing?.pressureBandRatio)
    && Boolean(flow)
    && isFiniteMetric(flow?.rounds)
    && isFiniteMetric(flow?.neutralResetsPerRound)
    && isFiniteMetric(flow?.p90LongestPressureSequenceSeconds)
    && isFiniteMetric(flow?.roundsWithNoDunkStart)
    && isFiniteMetric(flow?.roundsWithLaunchHitsButNoDunkStart)
    && isFiniteMetric(flow?.players?.P1?.averageDominantTacticalActionShare)
    && isFiniteMetric(flow?.players?.P2?.averageDominantTacticalActionShare)
    && isFiniteMetric(flow?.players?.P1?.p90LongestRepeatedActionStreak)
    && isFiniteMetric(flow?.players?.P2?.p90LongestRepeatedActionStreak)
    && isNullableFiniteMetric(flow?.players?.P1?.averageLaunchToDunkSeconds)
    && isNullableFiniteMetric(flow?.players?.P2?.averageLaunchToDunkSeconds);
}

function hasSharedAgencyTelemetry(summary: MatchSummary): boolean {
  const agency = (summary.telemetry as Partial<MatchTelemetryAggregateSummary>).sharedAgency;
  return Boolean(agency)
    && isFiniteMetric(agency?.controlRatio)
    && isFiniteMetric(agency?.actionReadyRatio)
    && isFiniteMetric(agency?.actionReadyShareOfControlFrames)
    && isFiniteMetric(agency?.contactRatio)
    && isFiniteMetric(agency?.pressureRatio)
    && isFiniteMetric(agency?.neutralRatio)
    && isFiniteMetric(agency?.sustainedNeutralWindowCount)
    && isFiniteMetric(agency?.p90NeutralEpisodeSeconds)
    && isFiniteMetric(agency?.maximumContactEpisodeSeconds);
}

function hasPostControlChaseLockTelemetry(summary: MatchSummary): boolean {
  const rounds = summary.flow?.rounds;
  if (!isNonNegativeIntegerMetric(rounds) || rounds <= 0) {
    return false;
  }
  return (['P1', 'P2'] as const).every((playerId) => {
    const player = summary.flow?.players?.[playerId] as Partial<AiMatchupFlowPlayerSummary>
      | undefined;
    if (!player) {
      return false;
    }
    const windows = player.postControlChaseLockWindows;
    const frames = player.postControlChaseLockFrames;
    const boostFrames = player.postControlBoostSuppressionFrames;
    const dashFrames = player.postControlDashSuppressionFrames;
    const consumptions = player.postControlChaseLockConsumptions;
    return isNonNegativeIntegerMetric(windows)
      && isNonNegativeIntegerMetric(frames)
      && isNonNegativeIntegerMetric(boostFrames)
      && isNonNegativeIntegerMetric(dashFrames)
      && isNonNegativeIntegerMetric(consumptions)
      && windows <= frames
      && boostFrames <= frames
      && dashFrames <= frames
      && consumptions <= windows
      && isRoundedPerRoundMetric(
        player.postControlChaseLockWindowsPerRound,
        windows,
        rounds,
      )
      && isRoundedPerRoundMetric(
        player.postControlChaseLockSecondsPerRound,
        frames,
        rounds,
        FIXED_DT,
      )
      && isRoundedPerRoundMetric(
        player.postControlBoostSuppressionSecondsPerRound,
        boostFrames,
        rounds,
        FIXED_DT,
      )
      && isRoundedPerRoundMetric(
        player.postControlDashSuppressionSecondsPerRound,
        dashFrames,
        rounds,
        FIXED_DT,
      )
      && isRoundedPerRoundMetric(
        player.postControlChaseLockConsumptionsPerRound,
        consumptions,
        rounds,
      );
  });
}

function hasPostControlRepeatDashTelemetry(summary: MatchSummary): boolean {
  const rounds = summary.flow?.rounds;
  const framesSimulated = summary.telemetry?.framesSimulated;
  if (
    !isNonNegativeIntegerMetric(rounds)
    || rounds <= 0
    || !isNonNegativeIntegerMetric(framesSimulated)
  ) {
    return false;
  }
  return (['P1', 'P2'] as const).every((playerId) => {
    const player = summary.flow?.players?.[playerId] as Partial<AiMatchupFlowPlayerSummary>
      | undefined;
    if (!player) {
      return false;
    }
    const windows = player.postControlRepeatDashWindows;
    const weightFrames = player.postControlRepeatDashWeightFrames;
    const consumptions = player.postControlRepeatDashConsumptions;
    const selections = player.postControlRepeatDashSelections;
    return isNonNegativeIntegerMetric(windows)
      && isNonNegativeIntegerMetric(weightFrames)
      && isNonNegativeIntegerMetric(consumptions)
      && isNonNegativeIntegerMetric(selections)
      && windows <= framesSimulated
      && weightFrames <= framesSimulated
      && consumptions <= windows
      && selections <= consumptions
      && selections <= weightFrames
      && (windows > 0 || weightFrames === 0)
      && isRoundedPerRoundMetric(
        player.postControlRepeatDashWindowsPerRound,
        windows,
        rounds,
      )
      && isRoundedPerRoundMetric(
        player.postControlRepeatDashWeightSecondsPerRound,
        weightFrames,
        rounds,
        FIXED_DT,
      )
      && isRoundedPerRoundMetric(
        player.postControlRepeatDashConsumptionsPerRound,
        consumptions,
        rounds,
      )
      && isRoundedPerRoundMetric(
        player.postControlRepeatDashSelectionsPerRound,
        selections,
        rounds,
      );
  });
}

function hasControlReturnCausalTelemetry(
  summary: MatchSummary,
  provenance: 'current' | 'previous',
): boolean {
  const expectedAggregateSchema = provenance === 'current'
    ? MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION
    : PREVIOUS_MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION;
  const expectedMatchSchema = provenance === 'current'
    ? MATCH_TELEMETRY_SCHEMA_VERSION
    : PREVIOUS_MATCH_TELEMETRY_SCHEMA_VERSION;
  if (
    summary.telemetry.schemaVersion !== expectedAggregateSchema
    || summary.telemetry.matchTelemetrySchemaVersion !== expectedMatchSchema
  ) {
    return false;
  }
  return (['P1', 'P2'] as const).every((playerId) => {
    const player = summary.flow?.players?.[playerId] as Partial<AiMatchupFlowPlayerSummary>
      | undefined;
    const causal = player?.controlReturnCausal;
    if (!player || !causal || !isNonNegativeIntegerMetric(causal.windows)) {
      return false;
    }
    const outcomeTotal = COMBAT_CONTROL_RETURN_OUTCOMES.reduce((sum, outcome) => {
      const value = causal.outcomes?.[outcome];
      return isNonNegativeIntegerMetric(value) ? sum + value : Number.NaN;
    }, 0);
    const totalClosingDistance = causal.returnedPlayerClosingDistance
      + causal.opponentClosingDistance;
    return player.controlReturns === causal.windows
      && outcomeTotal === causal.windows
      && isNonNegativeIntegerMetric(causal.controlGrantedInPressure)
      && isNonNegativeIntegerMetric(causal.safeAtGrant)
      && causal.controlGrantedInPressure + causal.safeAtGrant === causal.windows
      && isFiniteMetric(causal.controlGrantedDistanceTotal)
      && causal.controlGrantedDistanceTotal >= 0
      && isFiniteMetric(causal.maximumDistanceTotal)
      && causal.maximumDistanceTotal >= causal.controlGrantedDistanceTotal
      && isNullableFiniteMetric(causal.averageControlGrantedDistance)
      && isNullableFiniteMetric(causal.averageMaximumDistance)
      && (causal.windows > 0
        ? causal.averageControlGrantedDistance !== null
          && causal.averageControlGrantedDistance >= 0
          && causal.averageControlGrantedDistance
            === roundMetric(causal.controlGrantedDistanceTotal / causal.windows, 2)
          && causal.averageMaximumDistance !== null
          && causal.averageMaximumDistance >= causal.averageControlGrantedDistance
          && causal.averageMaximumDistance
            === roundMetric(causal.maximumDistanceTotal / causal.windows, 2)
        : causal.averageControlGrantedDistance === null
          && causal.averageMaximumDistance === null
          && causal.controlGrantedDistanceTotal === 0
          && causal.maximumDistanceTotal === 0)
      && isFiniteMetric(causal.returnedPlayerClosingDistance)
      && causal.returnedPlayerClosingDistance >= 0
      && isFiniteMetric(causal.opponentClosingDistance)
      && causal.opponentClosingDistance >= 0
      && isNullableFiniteMetric(causal.returnedPlayerClosingShare)
      && causal.returnedPlayerClosingShare === (totalClosingDistance > 0
        ? roundMetric(causal.returnedPlayerClosingDistance / totalClosingDistance, 3)
        : null)
      && isNonNegativeIntegerMetric(causal.returnedPlayerClosedMore)
      && isNonNegativeIntegerMetric(causal.opponentClosedMore)
      && isNonNegativeIntegerMetric(causal.balancedClosure)
      && causal.returnedPlayerClosedMore + causal.opponentClosedMore + causal.balancedClosure
        === causal.windows
      && isNonNegativeIntegerMetric(causal.returnedPlayerFirstActions)
      && causal.returnedPlayerFirstActions <= causal.windows
      && isNonNegativeIntegerMetric(causal.opponentFirstActions)
      && causal.opponentFirstActions <= causal.windows
      && isNonNegativeIntegerMetric(causal.returnedPlayerDominantApproachWindows)
      && causal.returnedPlayerDominantApproachWindows <= causal.windows
      && isNonNegativeIntegerMetric(causal.opponentDominantApproachWindows)
      && causal.opponentDominantApproachWindows <= causal.windows
      && hasControlReturnCausalRoleFlow(
        causal.roles?.returner,
        causal.windows,
        causal.returnedPlayerFirstActions,
        causal.returnedPlayerDominantApproachWindows,
      )
      && hasControlReturnCausalRoleFlow(
        causal.roles?.opponent,
        causal.windows,
        causal.opponentFirstActions,
        causal.opponentDominantApproachWindows,
      );
  });
}

function hasOrdinaryBoostCounterplayTelemetry(summary: MatchSummary): boolean {
  if (
    summary.telemetry.schemaVersion !== MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION
    || summary.telemetry.matchTelemetrySchemaVersion !== MATCH_TELEMETRY_SCHEMA_VERSION
    || !summary.telemetry.ordinaryBoostCounterplay
    || !summary.flow.ordinaryBoostCounterplay
    || !isNonNegativeIntegerMetric(summary.flow.rounds)
    || summary.flow.rounds <= 0
  ) {
    return false;
  }
  return (['P1', 'P2'] as const).every((playerId) => {
    const telemetry = summary.telemetry.ordinaryBoostCounterplay[playerId];
    const flow = summary.flow.ordinaryBoostCounterplay[playerId];
    if (!telemetry || !flow) {
      return false;
    }
    const opportunities = flow.opportunities;
    const firstResponses = flow.firstResponses;
    const superBoostResponses = flow.targetSuperBoostResponses;
    const expectedResponseRatio = roundMetric(
      firstResponses / Math.max(1, opportunities),
      3,
    );
    const expectedSuperBoostRatio = roundMetric(
      superBoostResponses / Math.max(1, opportunities),
      3,
    );
    const { opportunitiesPerRound: _opportunitiesPerRound, ...flowTelemetry } = flow;
    return isNonNegativeIntegerMetric(opportunities)
      && isNonNegativeIntegerMetric(flow.completedOpportunities)
      && flow.completedOpportunities <= opportunities
      && isNonNegativeIntegerMetric(firstResponses)
      && firstResponses <= opportunities
      && isNonNegativeIntegerMetric(superBoostResponses)
      && superBoostResponses <= opportunities
      && hasExactCountHistogram(
        flow.firstResponseActions,
        [...BALANCE_LAB_CONTROL_RETURN_ACTIONS, 'none'],
        opportunities,
      )
      && hasExactCountHistogram(
        flow.outcomes,
        COMBAT_ORDINARY_BOOST_OUTCOMES,
        opportunities,
      )
      && flow.responseCoverageRatio === expectedResponseRatio
      && flow.superBoostResponseRatio === expectedSuperBoostRatio
      && isNullableFiniteMetric(flow.averageFirstResponseSeconds)
      && isNullableFiniteMetric(flow.averageAvailableReactionSeconds)
      && isNullableFiniteMetric(flow.averageStartDistance)
      && (firstResponses > 0
        ? flow.averageFirstResponseSeconds !== null
          && flow.averageFirstResponseSeconds >= 0
        : flow.averageFirstResponseSeconds === null)
      && (opportunities > 0
        ? flow.averageAvailableReactionSeconds !== null
          && flow.averageAvailableReactionSeconds >= 0
          && flow.averageStartDistance !== null
          && flow.averageStartDistance >= 0
        : flow.averageAvailableReactionSeconds === null
          && flow.averageStartDistance === null)
      && isRoundedPerRoundMetric(
        flow.opportunitiesPerRound,
        opportunities,
        summary.flow.rounds,
      )
      && canonicalJson(flowTelemetry) === canonicalJson(telemetry);
  });
}

function hasFixedRoundSampling(report: Partial<ComparableBatchReport>): boolean {
  const gamesPerPairing = report.options?.gamesPerPairing;
  const simulation = report.simulation;
  if (
    !Number.isInteger(gamesPerPairing)
    || (gamesPerPairing ?? 0) <= 0
    || simulation?.roundSampling !== 'fixed_rounds_v1'
    || simulation.roundsToWin !== ROUNDS_TO_WIN
    || simulation.maximumRoundsPerSet !== MAX_ROUNDS_PER_SET
    || !Array.isArray(report.summaries)
  ) {
    return false;
  }
  const expectedRounds = (gamesPerPairing as number) * MAX_ROUNDS_PER_SET;
  return report.summaries.every((summary) => (
    summary.seeds.length === gamesPerPairing
    && summary.averageRoundsPerSet === MAX_ROUNDS_PER_SET
    && summary.telemetry.rounds === expectedRounds
    && summary.flow.rounds === expectedRounds
  ));
}

function hasLoopStageReasonBreakdown(summary: MatchSummary): boolean {
  return BALANCE_LAB_LOOP_STAGE_IDS.every((stageId) => {
    const stage = summary.flow.loopStages[stageId];
    const reasons = stage.issueReasons;
    if (!Array.isArray(reasons)) {
      return false;
    }
    const seen = new Set<string>();
    let watchRounds = 0;
    let blockedRounds = 0;
    for (const reason of reasons) {
      if (
        !reason
        || typeof reason.reasonId !== 'string'
        || !reason.reasonId.startsWith(`${stageId}.`)
        || seen.has(reason.reasonId)
        || !isNonNegativeIntegerMetric(reason.watchRounds)
        || !isNonNegativeIntegerMetric(reason.blockedRounds)
        || !isNonNegativeIntegerMetric(reason.rounds)
        || reason.rounds !== reason.watchRounds + reason.blockedRounds
        || reason.issueRatio !== roundMetric(reason.rounds / Math.max(1, stage.rounds))
      ) {
        return false;
      }
      seen.add(reason.reasonId);
      watchRounds += reason.watchRounds;
      blockedRounds += reason.blockedRounds;
    }
    return watchRounds === stage.watchRounds && blockedRounds === stage.blockedRounds;
  });
}

function readComparableBatchReport(path: string): ComparableBatchReport {
  const absolutePath = resolve(process.cwd(), path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read comparison report "${path}": ${detail}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Comparison report "${path}" is not a JSON object.`);
  }
  const report = parsed as Partial<ComparableBatchReport>;
  const ruleSnapshot = (
    report.schemaVersion === 'gw.ai-matchup-batch.v15'
    || report.schemaVersion === 'gw.ai-matchup-batch.v16'
    || report.schemaVersion === 'gw.ai-matchup-batch.v17'
    || report.schemaVersion === 'gw.ai-matchup-batch.v18'
    || report.schemaVersion === 'gw.ai-matchup-batch.v19'
    || report.schemaVersion === 'gw.ai-matchup-batch.v20'
    || report.schemaVersion === 'gw.ai-matchup-batch.v21'
    || report.schemaVersion === 'gw.ai-matchup-batch.v22'
    || report.schemaVersion === 'gw.ai-matchup-batch.v23'
    || report.schemaVersion === 'gw.ai-matchup-batch.v24'
  )
    ? parseAiBatchRuleSnapshot(report.ruleSnapshot)
    : null;
  if (
    (
      report.schemaVersion !== 'gw.ai-matchup-batch.v3'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v4'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v5'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v6'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v7'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v8'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v9'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v10'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v11'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v12'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v13'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v14'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v15'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v16'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v17'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v18'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v19'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v20'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v21'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v22'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v23'
      && report.schemaVersion !== 'gw.ai-matchup-batch.v24'
    )
    || typeof report.generatedAt !== 'string'
    || !report.options
    || !report.simulation
    || !report.characterRegistry
    || typeof report.aiProfilesFingerprint !== 'string'
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v10'
        || report.schemaVersion === 'gw.ai-matchup-batch.v11'
        || report.schemaVersion === 'gw.ai-matchup-batch.v12'
        || report.schemaVersion === 'gw.ai-matchup-batch.v13'
        || report.schemaVersion === 'gw.ai-matchup-batch.v14'
        || report.schemaVersion === 'gw.ai-matchup-batch.v15'
        || report.schemaVersion === 'gw.ai-matchup-batch.v16'
        || report.schemaVersion === 'gw.ai-matchup-batch.v17'
        || report.schemaVersion === 'gw.ai-matchup-batch.v18'
        || report.schemaVersion === 'gw.ai-matchup-batch.v19'
        || report.schemaVersion === 'gw.ai-matchup-batch.v20'
        || report.schemaVersion === 'gw.ai-matchup-batch.v21'
        || report.schemaVersion === 'gw.ai-matchup-batch.v22'
        || report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && typeof report.aiBaseProfilesFingerprint !== 'string'
    )
    || !Array.isArray(report.summaries)
    || report.summaries.some((summary) => !isComparableMatchSummary(summary))
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v14'
        || report.schemaVersion === 'gw.ai-matchup-batch.v15'
        || report.schemaVersion === 'gw.ai-matchup-batch.v16'
        || report.schemaVersion === 'gw.ai-matchup-batch.v17'
        || report.schemaVersion === 'gw.ai-matchup-batch.v18'
        || report.schemaVersion === 'gw.ai-matchup-batch.v19'
        || report.schemaVersion === 'gw.ai-matchup-batch.v20'
        || report.schemaVersion === 'gw.ai-matchup-batch.v21'
        || report.schemaVersion === 'gw.ai-matchup-batch.v22'
        || report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && report.summaries.some((summary) => !hasSharedAgencyTelemetry(summary))
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v19'
        || report.schemaVersion === 'gw.ai-matchup-batch.v20'
        || report.schemaVersion === 'gw.ai-matchup-batch.v21'
        || report.schemaVersion === 'gw.ai-matchup-batch.v22'
        || report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && report.summaries.some((summary) => !hasPostControlChaseLockTelemetry(summary))
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v20'
        || report.schemaVersion === 'gw.ai-matchup-batch.v21'
        || report.schemaVersion === 'gw.ai-matchup-batch.v22'
        || report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && !hasFixedRoundSampling(report)
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v21'
        || report.schemaVersion === 'gw.ai-matchup-batch.v22')
      && report.summaries.some((summary) => !hasControlReturnCausalTelemetry(summary, 'previous'))
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && report.summaries.some((summary) => !hasControlReturnCausalTelemetry(summary, 'current'))
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v22'
        || report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && report.summaries.some((summary) => !hasPostControlRepeatDashTelemetry(summary))
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && report.summaries.some((summary) => !hasOrdinaryBoostCounterplayTelemetry(summary))
    )
    || (
      report.schemaVersion === 'gw.ai-matchup-batch.v24'
      && report.summaries.some((summary) => !hasLoopStageReasonBreakdown(summary))
    )
    || (
      (report.schemaVersion === 'gw.ai-matchup-batch.v15'
        || report.schemaVersion === 'gw.ai-matchup-batch.v16'
        || report.schemaVersion === 'gw.ai-matchup-batch.v17'
        || report.schemaVersion === 'gw.ai-matchup-batch.v18'
        || report.schemaVersion === 'gw.ai-matchup-batch.v19'
        || report.schemaVersion === 'gw.ai-matchup-batch.v20'
        || report.schemaVersion === 'gw.ai-matchup-batch.v21'
        || report.schemaVersion === 'gw.ai-matchup-batch.v22'
        || report.schemaVersion === 'gw.ai-matchup-batch.v23'
        || report.schemaVersion === 'gw.ai-matchup-batch.v24')
      && !ruleSnapshot
    )
  ) {
    throw new Error(`Comparison report "${path}" is not a compatible AI matchup batch report.`);
  }
  return {
    ...report,
    ...(ruleSnapshot ? { ruleSnapshot } : {}),
  } as ComparableBatchReport;
}

function summaryKey(summary: Pick<MatchSummary, 'p1' | 'p2' | 'difficulty'>): string {
  return `${summary.difficulty}:${summary.p1}:${summary.p2}`;
}

function controlledScenarioFingerprint(report: ComparableBatchReport): string {
  const summarySeeds = report.summaries
    .map((summary) => ({
      key: summaryKey(summary),
      seeds: summary.seeds,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return `fnv1a32:${fingerprint({
    gamesPerPairing: report.options.gamesPerPairing,
    maxRoundSeconds: report.options.maxRoundSeconds,
    baseSeed: report.options.baseSeed,
    seedStrategy: report.options.seedStrategy,
    aiSeedStrategy: report.options.aiSeedStrategy,
    difficultyIds: report.options.difficultyIds,
    characterIds: report.options.characterIds,
    pairings: report.options.pairings,
    simulation: report.simulation,
    aiBaseProfilesFingerprint: report.aiBaseProfilesFingerprint ?? report.aiProfilesFingerprint,
    characterRegistry: report.characterRegistry,
    summarySeeds,
  })}`;
}

function averageRoundSeconds(summary: MatchSummary): number {
  return summary.telemetry.elapsedSeconds / Math.max(1, summary.telemetry.rounds);
}

function launchClashesPerRound(summary: MatchSummary): number {
  const flowValue = summary.flow.launchClashesPerRound;
  if (isFiniteMetric(flowValue)) {
    return flowValue;
  }
  return roundMetric(
    summary.telemetry.eventCounts.launch_clash / Math.max(1, summary.telemetry.rounds),
    2,
  );
}

function launchClashesPerMinute(summary: MatchSummary): number {
  const flowValue = summary.flow.launchClashesPerMinute;
  if (isFiniteMetric(flowValue)) {
    return flowValue;
  }
  return roundMetric(
    summary.telemetry.eventCounts.launch_clash * 60
      / Math.max(1, summary.telemetry.elapsedSeconds),
    2,
  );
}

function acceptedCombatActionStarts(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number {
  const player = summary.telemetry.players[playerId];
  return player.launchStarts
    + player.specialStarts
    + player.dunkStarts
    + player.parryStarts
    + player.breakEscapes;
}

function acceptedCombatActionStartsPerRound(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number {
  const flowValue = summary.flow.players[playerId].acceptedCombatActionStartsPerRound;
  if (isFiniteMetric(flowValue)) {
    return flowValue;
  }
  return roundMetric(
    acceptedCombatActionStarts(summary, playerId) / Math.max(1, summary.telemetry.rounds),
    2,
  );
}

function acceptedCombatActionStartsPerMinute(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number {
  const flowValue = summary.flow.players[playerId].acceptedCombatActionStartsPerMinute;
  if (isFiniteMetric(flowValue)) {
    return flowValue;
  }
  return roundMetric(
    acceptedCombatActionStarts(summary, playerId) * 60
      / Math.max(1, summary.telemetry.elapsedSeconds),
    2,
  );
}

function tacticalRepositionMetric(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
  key: 'tacticalRepositionSelectionsPerRound' | 'tacticalRepositionSecondsPerRound',
): number | null {
  const player = summary.flow.players[playerId] as Partial<AiMatchupFlowPlayerSummary>;
  const value = player[key];
  return isFiniteMetric(value) ? value : null;
}

function postControlChaseLockMetric(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
  key: 'postControlChaseLockWindowsPerRound'
    | 'postControlChaseLockSecondsPerRound'
    | 'postControlBoostSuppressionSecondsPerRound'
    | 'postControlDashSuppressionSecondsPerRound'
    | 'postControlChaseLockConsumptionsPerRound',
): number | null {
  const player = summary.flow.players[playerId] as Partial<AiMatchupFlowPlayerSummary>;
  const value = player[key];
  return isFiniteMetric(value) ? value : null;
}

function postControlRepeatDashMetric(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
  key: 'postControlRepeatDashWindowsPerRound'
    | 'postControlRepeatDashWeightSecondsPerRound'
    | 'postControlRepeatDashConsumptionsPerRound'
    | 'postControlRepeatDashSelectionsPerRound',
): number | null {
  const player = summary.flow.players[playerId] as Partial<AiMatchupFlowPlayerSummary>;
  const value = player[key];
  return isFiniteMetric(value) ? value : null;
}

function combatBoostCommitmentMetric(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
  key: 'combatBoostLockSecondsPerRound'
    | 'combatBoostDelaySecondsPerRound'
    | 'combatBoostHeldInputSecondsPerRound'
    | 'combatBoostCancellationsPerRound',
): number | null {
  const player = summary.flow.players[playerId] as Partial<AiMatchupFlowPlayerSummary>;
  const value = player[key];
  return isFiniteMetric(value) ? value : null;
}

function maximumDominantActionShare(summary: MatchSummary): number {
  return Math.max(
    summary.flow.players.P1.averageDominantTacticalActionShare,
    summary.flow.players.P2.averageDominantTacticalActionShare,
  );
}

function maximumRepeatedActionStreak(summary: MatchSummary): number {
  return Math.max(
    summary.flow.players.P1.p90LongestRepeatedActionStreak,
    summary.flow.players.P2.p90LongestRepeatedActionStreak,
  );
}

function averageLaunchToDunkSeconds(summary: MatchSummary): number | null {
  const p1 = summary.flow.players.P1.averageLaunchToDunkSeconds;
  const p2 = summary.flow.players.P2.averageLaunchToDunkSeconds;
  return p1 === null || p2 === null ? null : average([p1, p2]);
}

function breakReactionSeconds(summary: MatchSummary, playerId: 'P1' | 'P2'): number {
  const flowValue = summary.flow.players[playerId].averageBreakReactionSeconds;
  return isFiniteMetric(flowValue)
    ? flowValue
    : summary.telemetry.players[playerId].averageBreakReactionSeconds;
}

function breakEscapesPerRound(summary: MatchSummary, playerId: 'P1' | 'P2'): number {
  const flowValue = summary.flow.players[playerId].breakEscapesPerRound;
  return isFiniteMetric(flowValue)
    ? flowValue
    : summary.flow.players[playerId].actionAcceptance.launch_break.starts
      / Math.max(1, summary.flow.rounds);
}

function resetConversionRatio(
  summary: MatchSummary,
  key: keyof AiMatchupFlowSummary['resetOutcomes'],
): number | null {
  const outcome = summary.flow.resetOutcomes?.[key];
  return outcome
    && isFiniteMetric(outcome.attempts)
    && outcome.attempts > 0
    && isFiniteMetric(outcome.successRatio)
    ? outcome.successRatio
    : null;
}

function exchangeRatio(
  summary: MatchSummary,
  key: 'resolvedRatio' | 'resetRatio' | 'briefExitRatio',
): number | null {
  const exchanges = summary.flow.exchanges;
  if (!exchanges || !isFiniteMetric(exchanges.total) || exchanges.total <= 0) {
    return null;
  }
  if (key === 'briefExitRatio') {
    return isFiniteMetric(exchanges.briefExits)
      ? exchanges.briefExits / exchanges.total
      : null;
  }
  const value = exchanges[key];
  return isFiniteMetric(value) ? value : null;
}

function averageUnresolvedPressureSeconds(summary: MatchSummary): number | null {
  const exchanges = summary.flow.exchanges;
  return exchanges
    && isFiniteMetric(exchanges.total)
    && exchanges.total > 0
    && isFiniteMetric(exchanges.averageUnresolvedPressureSeconds)
    ? exchanges.averageUnresolvedPressureSeconds
    : null;
}

function helplessRatio(summary: MatchSummary, playerId: 'P1' | 'P2'): number {
  const flowRatio = summary.flow.players[playerId].helplessRatio;
  if (isFiniteMetric(flowRatio)) {
    return flowRatio;
  }
  return summary.telemetry.players[playerId].helplessSeconds
    / Math.max(1, summary.telemetry.elapsedSeconds);
}

function launchHitsReceived(summary: MatchSummary, playerId: 'P1' | 'P2'): number {
  const flowValue = summary.flow.players[playerId].launchHitsReceived;
  if (isFiniteMetric(flowValue)) {
    return flowValue;
  }
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  return summary.telemetry.players[opponentId].launchHits;
}

function helplessSecondsPerLaunchReceived(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const flowValue = summary.flow.players[playerId].helplessSecondsPerLaunchReceived;
  if (isNullableFiniteMetric(flowValue)) {
    return flowValue;
  }
  const received = launchHitsReceived(summary, playerId);
  return received > 0
    ? summary.telemetry.players[playerId].helplessSeconds / received
    : null;
}

function immediateRelaunchRatio(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].immediateRelaunchRatio;
  return isFiniteMetric(value) ? value : null;
}

function averageControlWindowSeconds(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].averageControlWindowSeconds;
  return isNullableFiniteMetric(value) ? value : null;
}

function postReturnResetRatio(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].postReturnResetRatio;
  return isFiniteMetric(value) ? value : null;
}

function controlReturnResetRatio(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].controlReturnResetRatio;
  return isFiniteMetric(value) ? value : null;
}

function averageFirstActionDelaySeconds(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].averageFirstActionDelaySeconds;
  return isNullableFiniteMetric(value) ? value : null;
}

function controlReturnCausalMetric(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
  metric: 'returnedPlayerClosingShare' | 'averageControlGrantedDistance' | 'averageMaximumDistance',
): number | null {
  const value = summary.flow.players[playerId].controlReturnCausal?.[metric];
  return isNullableFiniteMetric(value) ? value : null;
}

function controlReturnCausalRatio(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
  metric: 'opponent_closed_more' | 'sustained_exit',
): number | null {
  const causal = summary.flow.players[playerId].controlReturnCausal;
  if (!causal || causal.windows <= 0) {
    return null;
  }
  const count = metric === 'opponent_closed_more'
    ? causal.opponentClosedMore
    : causal.outcomes.sustained_exit;
  return roundMetric(count / causal.windows, 3);
}

function repeatClashRatio(summary: MatchSummary): number | null {
  const value = summary.flow.repeatClashRatio;
  return isNullableFiniteMetric(value) ? value : null;
}

function clashRapidLaunchRecommitRatio(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].clashRapidLaunchRecommitRatio;
  return isFiniteMetric(value) ? value : null;
}

function averageClashFirstActionDelaySeconds(
  summary: MatchSummary,
  playerId: 'P1' | 'P2',
): number | null {
  const value = summary.flow.players[playerId].averageClashFirstActionDelaySeconds;
  return isNullableFiniteMetric(value) ? value : null;
}

function carriedBriefExitRatio(summary: MatchSummary): number | null {
  const value = (summary.flow as Partial<AiMatchupFlowSummary>)
    .neutralExitFollowUp?.carriedBriefExitRatio;
  return isNullableFiniteMetric(value) ? value : null;
}

function averageNeutralFirstActionDelaySeconds(summary: MatchSummary): number | null {
  const value = (summary.flow as Partial<AiMatchupFlowSummary>)
    .neutralExitFollowUp?.averageFirstActionDelaySeconds;
  return isNullableFiniteMetric(value) ? value : null;
}

function ratioPointDelta(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null
    ? null
    : roundMetric((candidate - baseline) * 100, 2);
}

function optionalMetricDelta(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null
    ? null
    : roundMetric(candidate - baseline, 2);
}

type SharedAgencyMetric = keyof Pick<
  MatchTelemetryAggregateSummary['sharedAgency'],
  | 'actionReadyRatio'
  | 'controlRatio'
  | 'actionReadyShareOfControlFrames'
  | 'contactRatio'
  | 'pressureRatio'
  | 'neutralRatio'
  | 'sustainedNeutralWindowCount'
  | 'p90NeutralEpisodeSeconds'
  | 'maximumContactEpisodeSeconds'
>;

function sharedAgencyMetric(
  summary: MatchSummary,
  key: SharedAgencyMetric,
): number | null {
  const agency = (summary.telemetry as Partial<MatchTelemetryAggregateSummary>).sharedAgency;
  const value = agency?.[key];
  return isFiniteMetric(value) ? value : null;
}

function sharedAgencyRatioPointDelta(
  candidate: MatchSummary,
  baseline: MatchSummary,
  key: 'controlRatio'
    | 'actionReadyRatio'
    | 'actionReadyShareOfControlFrames'
    | 'contactRatio'
    | 'pressureRatio'
    | 'neutralRatio',
): number | null {
  return ratioPointDelta(
    sharedAgencyMetric(candidate, key),
    sharedAgencyMetric(baseline, key),
  );
}

function sharedControlBandRatio(
  summary: MatchSummary,
  band: 'contact' | 'pressure',
): number | null {
  const telemetry = summary.telemetry as Partial<MatchTelemetryAggregateSummary>;
  const controlFrames = telemetry.sharedAgency?.controlFrames;
  const p1Movement = telemetry.players?.P1?.movementIntent;
  const p2Movement = telemetry.players?.P2?.movementIntent;
  if (!isFiniteMetric(controlFrames) || controlFrames <= 0 || !p1Movement || !p2Movement) {
    return null;
  }
  const key = band === 'contact' ? 'contestedContactFrames' : 'contestedPressureFrames';
  const p1Frames = p1Movement[key];
  const p2Frames = p2Movement[key];
  if (!isFiniteMetric(p1Frames) || !isFiniteMetric(p2Frames)) {
    return null;
  }
  return Math.min(p1Frames, p2Frames) / controlFrames;
}

function prepareBatchComparison(
  candidateRuleSnapshot: AiBatchRuleSnapshot,
  baselinePath: string,
  allowMultiRuleComparison: boolean,
): BatchComparisonPreflight {
  const baseline = readComparableBatchReport(baselinePath);
  if (!baseline.ruleSnapshot) {
    throw new Error(
      `Comparison report "${baselinePath}" predates exact rule snapshots. Regenerate the baseline with the current AI batch runner before comparing a candidate.`,
    );
  }
  return {
    baseline,
    ruleComparison: compareAiBatchRuleSnapshots(
      baseline.ruleSnapshot,
      candidateRuleSnapshot,
      { allowMultipleRuleChanges: allowMultiRuleComparison },
    ),
  };
}

function buildBatchComparison(
  candidate: BatchReport,
  baselinePath: string,
  preflight: BatchComparisonPreflight,
): BatchComparison {
  const { baseline, ruleComparison } = preflight;
  const baselineHasCausalNeutralExitAttribution = baseline.schemaVersion === 'gw.ai-matchup-batch.v8'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v9'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v10'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v11'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v12'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v13'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v14'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v15'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v16'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v17'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v18'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v19'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v20'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v21'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v22'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v23'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v24';
  const baselineHasControlReturnCausality = baseline.schemaVersion === 'gw.ai-matchup-batch.v21'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v22'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v23'
    || baseline.schemaVersion === 'gw.ai-matchup-batch.v24';
  const candidateScenarioFingerprint = controlledScenarioFingerprint(candidate);
  const baselineScenarioFingerprint = controlledScenarioFingerprint(baseline);
  if (candidateScenarioFingerprint !== baselineScenarioFingerprint) {
    throw new Error(
      `Comparison report scenarios differ (${baselineScenarioFingerprint} baseline vs ${candidateScenarioFingerprint} candidate). Use the same seed, games, pairings, AI difficulty, character packages, and round limit.`,
    );
  }
  const baselineByKey = new Map(baseline.summaries.map((summary) => [summaryKey(summary), summary]));
  const deltas = candidate.summaries.map((summary): BatchComparisonDelta => {
    const previous = baselineByKey.get(summaryKey(summary));
    if (!previous) {
      throw new Error(`Comparison report is missing ${summaryKey(summary)}.`);
    }
    const rounds = Math.max(1, summary.flow.rounds);
    const previousRounds = Math.max(1, previous.flow.rounds);
    const sharedWindows = sharedAgencyMetric(summary, 'sustainedNeutralWindowCount');
    const previousSharedWindows = sharedAgencyMetric(previous, 'sustainedNeutralWindowCount');
    return {
      pairing: { p1: summary.p1, p2: summary.p2, difficulty: summary.difficulty },
      averageRoundSeconds: roundMetric(averageRoundSeconds(summary) - averageRoundSeconds(previous), 2),
      launchClashesPerRound: roundMetric(
        launchClashesPerRound(summary) - launchClashesPerRound(previous),
        2,
      ),
      launchClashesPerMinute: roundMetric(
        launchClashesPerMinute(summary) - launchClashesPerMinute(previous),
        2,
      ),
      p1AcceptedCombatActionStartsPerRound: roundMetric(
        acceptedCombatActionStartsPerRound(summary, 'P1')
          - acceptedCombatActionStartsPerRound(previous, 'P1'),
        2,
      ),
      p2AcceptedCombatActionStartsPerRound: roundMetric(
        acceptedCombatActionStartsPerRound(summary, 'P2')
          - acceptedCombatActionStartsPerRound(previous, 'P2'),
        2,
      ),
      p1AcceptedCombatActionStartsPerMinute: roundMetric(
        acceptedCombatActionStartsPerMinute(summary, 'P1')
          - acceptedCombatActionStartsPerMinute(previous, 'P1'),
        2,
      ),
      p2AcceptedCombatActionStartsPerMinute: roundMetric(
        acceptedCombatActionStartsPerMinute(summary, 'P2')
          - acceptedCombatActionStartsPerMinute(previous, 'P2'),
        2,
      ),
      timeoutRoundRatioPoints: roundMetric(
        ((summary.totalRoundTimeouts / rounds) - (previous.totalRoundTimeouts / previousRounds)) * 100,
        2,
      ),
      contactRatioPoints: roundMetric(
        (summary.telemetry.spacing.contactRatio - previous.telemetry.spacing.contactRatio) * 100,
        2,
      ),
      sharedControlRatioPoints: sharedAgencyRatioPointDelta(
        summary,
        previous,
        'controlRatio',
      ),
      sharedControlContactRatioPoints: ratioPointDelta(
        sharedControlBandRatio(summary, 'contact'),
        sharedControlBandRatio(previous, 'contact'),
      ),
      sharedControlPressureRatioPoints: ratioPointDelta(
        sharedControlBandRatio(summary, 'pressure'),
        sharedControlBandRatio(previous, 'pressure'),
      ),
      sharedActionReadyRatioPoints: sharedAgencyRatioPointDelta(
        summary,
        previous,
        'actionReadyRatio',
      ),
      sharedActionReadyShareOfControlPoints: sharedAgencyRatioPointDelta(
        summary,
        previous,
        'actionReadyShareOfControlFrames',
      ),
      sharedContactRatioPoints: sharedAgencyRatioPointDelta(summary, previous, 'contactRatio'),
      sharedPressureRatioPoints: sharedAgencyRatioPointDelta(summary, previous, 'pressureRatio'),
      sharedNeutralRatioPoints: sharedAgencyRatioPointDelta(summary, previous, 'neutralRatio'),
      sharedSustainedNeutralWindowsPerRound: optionalMetricDelta(
        sharedWindows === null ? null : sharedWindows / rounds,
        previousSharedWindows === null ? null : previousSharedWindows / previousRounds,
      ),
      sharedP90NeutralEpisodeSeconds: optionalMetricDelta(
        sharedAgencyMetric(summary, 'p90NeutralEpisodeSeconds'),
        sharedAgencyMetric(previous, 'p90NeutralEpisodeSeconds'),
      ),
      sharedMaximumContactEpisodeSeconds: optionalMetricDelta(
        sharedAgencyMetric(summary, 'maximumContactEpisodeSeconds'),
        sharedAgencyMetric(previous, 'maximumContactEpisodeSeconds'),
      ),
      p1TacticalRepositionSelectionsPerRound: optionalMetricDelta(
        tacticalRepositionMetric(summary, 'P1', 'tacticalRepositionSelectionsPerRound'),
        tacticalRepositionMetric(previous, 'P1', 'tacticalRepositionSelectionsPerRound'),
      ),
      p2TacticalRepositionSelectionsPerRound: optionalMetricDelta(
        tacticalRepositionMetric(summary, 'P2', 'tacticalRepositionSelectionsPerRound'),
        tacticalRepositionMetric(previous, 'P2', 'tacticalRepositionSelectionsPerRound'),
      ),
      p1TacticalRepositionSecondsPerRound: optionalMetricDelta(
        tacticalRepositionMetric(summary, 'P1', 'tacticalRepositionSecondsPerRound'),
        tacticalRepositionMetric(previous, 'P1', 'tacticalRepositionSecondsPerRound'),
      ),
      p2TacticalRepositionSecondsPerRound: optionalMetricDelta(
        tacticalRepositionMetric(summary, 'P2', 'tacticalRepositionSecondsPerRound'),
        tacticalRepositionMetric(previous, 'P2', 'tacticalRepositionSecondsPerRound'),
      ),
      p1PostControlChaseLockWindowsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P1', 'postControlChaseLockWindowsPerRound'),
        postControlChaseLockMetric(previous, 'P1', 'postControlChaseLockWindowsPerRound'),
      ),
      p2PostControlChaseLockWindowsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P2', 'postControlChaseLockWindowsPerRound'),
        postControlChaseLockMetric(previous, 'P2', 'postControlChaseLockWindowsPerRound'),
      ),
      p1PostControlChaseLockSecondsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P1', 'postControlChaseLockSecondsPerRound'),
        postControlChaseLockMetric(previous, 'P1', 'postControlChaseLockSecondsPerRound'),
      ),
      p2PostControlChaseLockSecondsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P2', 'postControlChaseLockSecondsPerRound'),
        postControlChaseLockMetric(previous, 'P2', 'postControlChaseLockSecondsPerRound'),
      ),
      p1PostControlBoostSuppressionSecondsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P1', 'postControlBoostSuppressionSecondsPerRound'),
        postControlChaseLockMetric(previous, 'P1', 'postControlBoostSuppressionSecondsPerRound'),
      ),
      p2PostControlBoostSuppressionSecondsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P2', 'postControlBoostSuppressionSecondsPerRound'),
        postControlChaseLockMetric(previous, 'P2', 'postControlBoostSuppressionSecondsPerRound'),
      ),
      p1PostControlDashSuppressionSecondsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P1', 'postControlDashSuppressionSecondsPerRound'),
        postControlChaseLockMetric(previous, 'P1', 'postControlDashSuppressionSecondsPerRound'),
      ),
      p2PostControlDashSuppressionSecondsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P2', 'postControlDashSuppressionSecondsPerRound'),
        postControlChaseLockMetric(previous, 'P2', 'postControlDashSuppressionSecondsPerRound'),
      ),
      p1PostControlChaseLockConsumptionsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P1', 'postControlChaseLockConsumptionsPerRound'),
        postControlChaseLockMetric(previous, 'P1', 'postControlChaseLockConsumptionsPerRound'),
      ),
      p2PostControlChaseLockConsumptionsPerRound: optionalMetricDelta(
        postControlChaseLockMetric(summary, 'P2', 'postControlChaseLockConsumptionsPerRound'),
        postControlChaseLockMetric(previous, 'P2', 'postControlChaseLockConsumptionsPerRound'),
      ),
      p1PostControlRepeatDashWindowsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P1', 'postControlRepeatDashWindowsPerRound'),
        postControlRepeatDashMetric(previous, 'P1', 'postControlRepeatDashWindowsPerRound'),
      ),
      p2PostControlRepeatDashWindowsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P2', 'postControlRepeatDashWindowsPerRound'),
        postControlRepeatDashMetric(previous, 'P2', 'postControlRepeatDashWindowsPerRound'),
      ),
      p1PostControlRepeatDashWeightSecondsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P1', 'postControlRepeatDashWeightSecondsPerRound'),
        postControlRepeatDashMetric(previous, 'P1', 'postControlRepeatDashWeightSecondsPerRound'),
      ),
      p2PostControlRepeatDashWeightSecondsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P2', 'postControlRepeatDashWeightSecondsPerRound'),
        postControlRepeatDashMetric(previous, 'P2', 'postControlRepeatDashWeightSecondsPerRound'),
      ),
      p1PostControlRepeatDashConsumptionsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P1', 'postControlRepeatDashConsumptionsPerRound'),
        postControlRepeatDashMetric(previous, 'P1', 'postControlRepeatDashConsumptionsPerRound'),
      ),
      p2PostControlRepeatDashConsumptionsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P2', 'postControlRepeatDashConsumptionsPerRound'),
        postControlRepeatDashMetric(previous, 'P2', 'postControlRepeatDashConsumptionsPerRound'),
      ),
      p1PostControlRepeatDashSelectionsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P1', 'postControlRepeatDashSelectionsPerRound'),
        postControlRepeatDashMetric(previous, 'P1', 'postControlRepeatDashSelectionsPerRound'),
      ),
      p2PostControlRepeatDashSelectionsPerRound: optionalMetricDelta(
        postControlRepeatDashMetric(summary, 'P2', 'postControlRepeatDashSelectionsPerRound'),
        postControlRepeatDashMetric(previous, 'P2', 'postControlRepeatDashSelectionsPerRound'),
      ),
      p1CombatBoostLockSecondsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P1', 'combatBoostLockSecondsPerRound'),
        combatBoostCommitmentMetric(previous, 'P1', 'combatBoostLockSecondsPerRound'),
      ),
      p2CombatBoostLockSecondsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P2', 'combatBoostLockSecondsPerRound'),
        combatBoostCommitmentMetric(previous, 'P2', 'combatBoostLockSecondsPerRound'),
      ),
      p1CombatBoostDelaySecondsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P1', 'combatBoostDelaySecondsPerRound'),
        combatBoostCommitmentMetric(previous, 'P1', 'combatBoostDelaySecondsPerRound'),
      ),
      p2CombatBoostDelaySecondsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P2', 'combatBoostDelaySecondsPerRound'),
        combatBoostCommitmentMetric(previous, 'P2', 'combatBoostDelaySecondsPerRound'),
      ),
      p1CombatBoostHeldInputSecondsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P1', 'combatBoostHeldInputSecondsPerRound'),
        combatBoostCommitmentMetric(previous, 'P1', 'combatBoostHeldInputSecondsPerRound'),
      ),
      p2CombatBoostHeldInputSecondsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P2', 'combatBoostHeldInputSecondsPerRound'),
        combatBoostCommitmentMetric(previous, 'P2', 'combatBoostHeldInputSecondsPerRound'),
      ),
      p1CombatBoostCancellationsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P1', 'combatBoostCancellationsPerRound'),
        combatBoostCommitmentMetric(previous, 'P1', 'combatBoostCancellationsPerRound'),
      ),
      p2CombatBoostCancellationsPerRound: optionalMetricDelta(
        combatBoostCommitmentMetric(summary, 'P2', 'combatBoostCancellationsPerRound'),
        combatBoostCommitmentMetric(previous, 'P2', 'combatBoostCancellationsPerRound'),
      ),
      pointBlankRatioPoints: roundMetric(
        (summary.telemetry.spacing.pointBlankRatio - previous.telemetry.spacing.pointBlankRatio) * 100,
        2,
      ),
      pressureBandRatioPoints: roundMetric(
        (summary.telemetry.spacing.pressureBandRatio - previous.telemetry.spacing.pressureBandRatio) * 100,
        2,
      ),
      neutralResetsPerRound: roundMetric(
        summary.flow.neutralResetsPerRound - previous.flow.neutralResetsPerRound,
        2,
      ),
      p90PressureSequenceSeconds: roundMetric(
        summary.flow.p90LongestPressureSequenceSeconds - previous.flow.p90LongestPressureSequenceSeconds,
        2,
      ),
      noDunkStartRoundRatioPoints: roundMetric(
        ((summary.flow.roundsWithNoDunkStart / rounds)
          - (previous.flow.roundsWithNoDunkStart / previousRounds)) * 100,
        2,
      ),
      launchWithoutDunkRoundRatioPoints: roundMetric(
        ((summary.flow.roundsWithLaunchHitsButNoDunkStart / rounds)
          - (previous.flow.roundsWithLaunchHitsButNoDunkStart / previousRounds)) * 100,
        2,
      ),
      dominantTacticalActionSharePoints: roundMetric(
        (maximumDominantActionShare(summary) - maximumDominantActionShare(previous)) * 100,
        2,
      ),
      repeatedTacticalActionStreak: roundMetric(
        maximumRepeatedActionStreak(summary) - maximumRepeatedActionStreak(previous),
        2,
      ),
      launchToDunkSeconds: optionalMetricDelta(
        averageLaunchToDunkSeconds(summary),
        averageLaunchToDunkSeconds(previous),
      ),
      p1BreakEscapesPerRound: roundMetric(
        breakEscapesPerRound(summary, 'P1') - breakEscapesPerRound(previous, 'P1'),
        2,
      ),
      p2BreakEscapesPerRound: roundMetric(
        breakEscapesPerRound(summary, 'P2') - breakEscapesPerRound(previous, 'P2'),
        2,
      ),
      p1BreakReactionSeconds: roundMetric(
        breakReactionSeconds(summary, 'P1') - breakReactionSeconds(previous, 'P1'),
        2,
      ),
      p2BreakReactionSeconds: roundMetric(
        breakReactionSeconds(summary, 'P2') - breakReactionSeconds(previous, 'P2'),
        2,
      ),
      resetConversionRatioPoints: ratioPointDelta(
        resetConversionRatio(summary, 'all'),
        resetConversionRatio(previous, 'all'),
      ),
      defenseResetConversionRatioPoints: ratioPointDelta(
        resetConversionRatio(summary, 'defense'),
        resetConversionRatio(previous, 'defense'),
      ),
      parryResetConversionRatioPoints: ratioPointDelta(
        resetConversionRatio(summary, 'parries'),
        resetConversionRatio(previous, 'parries'),
      ),
      launchBreakResetConversionRatioPoints: ratioPointDelta(
        resetConversionRatio(summary, 'launchBreaks'),
        resetConversionRatio(previous, 'launchBreaks'),
      ),
      resolvedExchangeRatioPoints: ratioPointDelta(
        exchangeRatio(summary, 'resolvedRatio'),
        exchangeRatio(previous, 'resolvedRatio'),
      ),
      exchangeResetRatioPoints: ratioPointDelta(
        exchangeRatio(summary, 'resetRatio'),
        exchangeRatio(previous, 'resetRatio'),
      ),
      briefExitRatioPoints: ratioPointDelta(
        exchangeRatio(summary, 'briefExitRatio'),
        exchangeRatio(previous, 'briefExitRatio'),
      ),
      averageUnresolvedPressureSeconds: optionalMetricDelta(
        averageUnresolvedPressureSeconds(summary),
        averageUnresolvedPressureSeconds(previous),
      ),
      p1HelplessRatioPoints: roundMetric(
        (helplessRatio(summary, 'P1') - helplessRatio(previous, 'P1')) * 100,
        2,
      ),
      p2HelplessRatioPoints: roundMetric(
        (helplessRatio(summary, 'P2') - helplessRatio(previous, 'P2')) * 100,
        2,
      ),
      p1LaunchHitsReceivedPerRound: roundMetric(
        launchHitsReceived(summary, 'P1') / rounds
          - launchHitsReceived(previous, 'P1') / previousRounds,
        2,
      ),
      p2LaunchHitsReceivedPerRound: roundMetric(
        launchHitsReceived(summary, 'P2') / rounds
          - launchHitsReceived(previous, 'P2') / previousRounds,
        2,
      ),
      p1HelplessSecondsPerLaunchReceived: optionalMetricDelta(
        helplessSecondsPerLaunchReceived(summary, 'P1'),
        helplessSecondsPerLaunchReceived(previous, 'P1'),
      ),
      p2HelplessSecondsPerLaunchReceived: optionalMetricDelta(
        helplessSecondsPerLaunchReceived(summary, 'P2'),
        helplessSecondsPerLaunchReceived(previous, 'P2'),
      ),
      p1ImmediateRelaunchRatioPoints: ratioPointDelta(
        immediateRelaunchRatio(summary, 'P1'),
        immediateRelaunchRatio(previous, 'P1'),
      ),
      p2ImmediateRelaunchRatioPoints: ratioPointDelta(
        immediateRelaunchRatio(summary, 'P2'),
        immediateRelaunchRatio(previous, 'P2'),
      ),
      p1AverageControlWindowSeconds: optionalMetricDelta(
        averageControlWindowSeconds(summary, 'P1'),
        averageControlWindowSeconds(previous, 'P1'),
      ),
      p2AverageControlWindowSeconds: optionalMetricDelta(
        averageControlWindowSeconds(summary, 'P2'),
        averageControlWindowSeconds(previous, 'P2'),
      ),
      p1PostReturnResetRatioPoints: ratioPointDelta(
        postReturnResetRatio(summary, 'P1'),
        postReturnResetRatio(previous, 'P1'),
      ),
      p2PostReturnResetRatioPoints: ratioPointDelta(
        postReturnResetRatio(summary, 'P2'),
        postReturnResetRatio(previous, 'P2'),
      ),
      p1ControlReturnResetRatioPoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnResetRatio(summary, 'P1'),
        controlReturnResetRatio(previous, 'P1'),
      ) : null,
      p2ControlReturnResetRatioPoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnResetRatio(summary, 'P2'),
        controlReturnResetRatio(previous, 'P2'),
      ) : null,
      p1ReturnerClosingSharePoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnCausalMetric(summary, 'P1', 'returnedPlayerClosingShare'),
        controlReturnCausalMetric(previous, 'P1', 'returnedPlayerClosingShare'),
      ) : null,
      p2ReturnerClosingSharePoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnCausalMetric(summary, 'P2', 'returnedPlayerClosingShare'),
        controlReturnCausalMetric(previous, 'P2', 'returnedPlayerClosingShare'),
      ) : null,
      p1OpponentClosedMoreRatioPoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnCausalRatio(summary, 'P1', 'opponent_closed_more'),
        controlReturnCausalRatio(previous, 'P1', 'opponent_closed_more'),
      ) : null,
      p2OpponentClosedMoreRatioPoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnCausalRatio(summary, 'P2', 'opponent_closed_more'),
        controlReturnCausalRatio(previous, 'P2', 'opponent_closed_more'),
      ) : null,
      p1SustainedExitRatioPoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnCausalRatio(summary, 'P1', 'sustained_exit'),
        controlReturnCausalRatio(previous, 'P1', 'sustained_exit'),
      ) : null,
      p2SustainedExitRatioPoints: baselineHasControlReturnCausality ? ratioPointDelta(
        controlReturnCausalRatio(summary, 'P2', 'sustained_exit'),
        controlReturnCausalRatio(previous, 'P2', 'sustained_exit'),
      ) : null,
      p1ControlGrantedDistance: baselineHasControlReturnCausality ? optionalMetricDelta(
        controlReturnCausalMetric(summary, 'P1', 'averageControlGrantedDistance'),
        controlReturnCausalMetric(previous, 'P1', 'averageControlGrantedDistance'),
      ) : null,
      p2ControlGrantedDistance: baselineHasControlReturnCausality ? optionalMetricDelta(
        controlReturnCausalMetric(summary, 'P2', 'averageControlGrantedDistance'),
        controlReturnCausalMetric(previous, 'P2', 'averageControlGrantedDistance'),
      ) : null,
      p1MaximumControlReturnDistance: baselineHasControlReturnCausality ? optionalMetricDelta(
        controlReturnCausalMetric(summary, 'P1', 'averageMaximumDistance'),
        controlReturnCausalMetric(previous, 'P1', 'averageMaximumDistance'),
      ) : null,
      p2MaximumControlReturnDistance: baselineHasControlReturnCausality ? optionalMetricDelta(
        controlReturnCausalMetric(summary, 'P2', 'averageMaximumDistance'),
        controlReturnCausalMetric(previous, 'P2', 'averageMaximumDistance'),
      ) : null,
      p1FirstActionDelaySeconds: optionalMetricDelta(
        averageFirstActionDelaySeconds(summary, 'P1'),
        averageFirstActionDelaySeconds(previous, 'P1'),
      ),
      p2FirstActionDelaySeconds: optionalMetricDelta(
        averageFirstActionDelaySeconds(summary, 'P2'),
        averageFirstActionDelaySeconds(previous, 'P2'),
      ),
      repeatClashRatioPoints: ratioPointDelta(
        repeatClashRatio(summary),
        repeatClashRatio(previous),
      ),
      p1ClashRapidLaunchRecommitRatioPoints: ratioPointDelta(
        clashRapidLaunchRecommitRatio(summary, 'P1'),
        clashRapidLaunchRecommitRatio(previous, 'P1'),
      ),
      p2ClashRapidLaunchRecommitRatioPoints: ratioPointDelta(
        clashRapidLaunchRecommitRatio(summary, 'P2'),
        clashRapidLaunchRecommitRatio(previous, 'P2'),
      ),
      p1ClashFirstActionDelaySeconds: optionalMetricDelta(
        averageClashFirstActionDelaySeconds(summary, 'P1'),
        averageClashFirstActionDelaySeconds(previous, 'P1'),
      ),
      p2ClashFirstActionDelaySeconds: optionalMetricDelta(
        averageClashFirstActionDelaySeconds(summary, 'P2'),
        averageClashFirstActionDelaySeconds(previous, 'P2'),
      ),
      carriedBriefExitRatioPoints: baselineHasCausalNeutralExitAttribution
        ? ratioPointDelta(
          carriedBriefExitRatio(summary),
          carriedBriefExitRatio(previous),
        )
        : null,
      neutralFirstActionDelaySeconds: baselineHasCausalNeutralExitAttribution
        ? optionalMetricDelta(
          averageNeutralFirstActionDelaySeconds(summary),
          averageNeutralFirstActionDelaySeconds(previous),
        )
        : null,
    };
  });

  return {
    baselinePath,
    baselineGeneratedAt: baseline.generatedAt,
    controlledScenarioFingerprint: candidateScenarioFingerprint,
    ruleChangePolicy: ruleComparison.policy,
    ruleChanges: ruleComparison.changes,
    designerFlow: baseline.designerBrief?.schemaVersion === candidate.designerBrief.schemaVersion
      && baseline.designerBrief.stages
      ? compareAiFlowDesignerBriefs(baseline.designerBrief, candidate.designerBrief)
      : null,
    deltas,
  };
}

function formatSigned(value: number, suffix = ''): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
}

function formatSignedOptional(value: number | null, suffix = ''): string {
  return value === null ? 'N/A' : formatSigned(value, suffix);
}

function formatRatio(
  numerator: number,
  denominator: number,
  ratio: number | null,
  missingEvidence: string,
): string {
  return ratio === null
    ? `${numerator}/${denominator} (N/A: ${missingEvidence})`
    : `${numerator}/${denominator} (${(ratio * 100).toFixed(1)}%)`;
}

function formatSeconds(value: number | null, missingEvidence: string): string {
  return value === null ? `N/A (${missingEvidence})` : `${value.toFixed(2)}s`;
}

function formatExchangeSequenceEvidence(evidence: AiMatchupExchangeSequenceEvidence): string {
  const opener = evidence.openerActorId && evidence.openerAction
    ? `${evidence.openerActorId} ${evidence.openerAction}`
    : 'none recorded';
  const outcomes = evidence.outcomeLabels.length > 0
    ? evidence.outcomeLabels.join(', ')
    : 'none recorded';
  const roundResult = evidence.roundWinner
    ? `${evidence.roundStopReason}, winner ${evidence.roundWinner}`
    : evidence.roundStopReason;
  const firstNeutralAction = evidence.firstNeutralActionActorId && evidence.firstNeutralAction
    ? `${evidence.firstNeutralActionActorId} ${evidence.firstNeutralAction} +${evidence.firstNeutralActionDelaySeconds?.toFixed(2) ?? '0.00'}s`
    : evidence.carriedReentryCause
      ? `none; carried via ${BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[evidence.carriedReentryCause]}${evidence.reentryContext ? ` at ${Math.abs(evidence.reentryContext.separationSpeed).toFixed(1)} closing units/s` : ''}`
      : 'none before re-entry/end';
  return `seed \`${evidence.seed}\` (set \`${evidence.setSeed}\`), game ${evidence.gameNumber}, round ${evidence.roundNumber}, exchange ${evidence.exchangeNumber}; ${evidence.startSeconds.toFixed(2)}s-${evidence.endSeconds.toFixed(2)}s; stop \`${evidence.stopReason}\` (round: ${roundResult}); pressure ${evidence.pressureSeconds.toFixed(2)}s, neutral ${evidence.neutralWindowSeconds.toFixed(2)}s, round contact ${(evidence.roundContactRatio * 100).toFixed(1)}%/${evidence.roundContactSeconds.toFixed(2)}s; opener ${opener}; outcomes ${outcomes}; exit ${evidence.exitBand ?? 'none'}; first neutral ${firstNeutralAction}`;
}

function formatTimeoutRoundEvidence(evidence: AiMatchupTimeoutRoundEvidence): string {
  const resolved = evidence.resolvedExchangeRatio === null
    ? 'N/A'
    : `${(evidence.resolvedExchangeRatio * 100).toFixed(1)}%`;
  const briefExits = evidence.briefExitRatio === null
    ? 'N/A'
    : `${(evidence.briefExitRatio * 100).toFixed(1)}%`;
  return `seed \`${evidence.seed}\` (set \`${evidence.setSeed}\`), game ${evidence.gameNumber}, round ${evidence.roundNumber}; timed out at ${evidence.elapsedSeconds.toFixed(2)}s; review tail ${evidence.focusStartSeconds.toFixed(2)}s-${evidence.focusEndSeconds.toFixed(2)}s; contact ${(evidence.contactRatio * 100).toFixed(1)}%/${evidence.contactSeconds.toFixed(2)}s, point blank ${(evidence.pointBlankRatio * 100).toFixed(1)}%, pressure ${(evidence.pressureBandRatio * 100).toFixed(1)}%; neutral resets ${evidence.neutralResets}, average neutral ${evidence.averageNeutralWindowSeconds.toFixed(2)}s, longest pressure ${evidence.longestPressureSequenceSeconds.toFixed(2)}s; resolved exchanges ${resolved}, brief exits ${briefExits}`;
}

function formatLoopStageEvidence(evidence: AiMatchupLoopStageEvidence): string {
  const affectedPlayers = evidence.relatedPlayerIds.length > 0
    ? ` Affected: ${evidence.relatedPlayerIds.join(', ')}.`
    : '';
  const globalLevers = evidence.relatedGlobalTuning.length > 0
    ? ` Global levers: ${evidence.relatedGlobalTuning.map((key) => `\`${key}\``).join(', ')}.`
    : '';
  const aiLevers = evidence.relatedAiBehavior.length > 0
    ? ` AI behavior: ${evidence.relatedAiBehavior.map((key) => `\`${key}\``).join(', ')}.`
    : '';
  const characterLevers = evidence.relatedCharacterControls.length > 0
    ? ` Character controls: ${evidence.relatedCharacterControls.map((key) => `\`${key}\``).join(', ')}.`
    : '';
  const targetedCharacterLevers = evidence.relatedCharacterTargets.length > 0
    ? ` Targeted character controls: ${evidence.relatedCharacterTargets.map((target) => `\`${target.playerId} ${target.control}\``).join(', ')}.`
    : '';
  return `seed \`${evidence.seed}\` (set \`${evidence.setSeed}\`), game ${evidence.gameNumber}, round ${evidence.roundNumber}; ${evidence.status.toUpperCase()}: ${evidence.detail}${affectedPlayers}${globalLevers}${aiLevers}${characterLevers}${targetedCharacterLevers}`;
}

interface EmitReviewReplayOptions {
  includeGeneralEvidence?: boolean;
  loopStageIds?: readonly BalanceLabLoopStageId[];
  oneReplayPerLoopStage?: boolean;
}

function emitReviewReplayArtifacts(
  report: BatchReport,
  balanceRules: BatchBalanceRules,
  outputDir: string,
  reportName: string,
  options: EmitReviewReplayOptions = {},
): AiMatchupReviewReplay[] {
  const replayDirectoryName = `${reportName}-replays`;
  const replayDirectory = join(outputDir, replayDirectoryName);
  rmSync(replayDirectory, { recursive: true, force: true });
  mkdirSync(replayDirectory, { recursive: true });
  const artifacts: AiMatchupReviewReplay[] = [];
  const maxFrames = Math.max(1, Math.floor(report.options.maxRoundSeconds / report.simulation.fixedDt));
  const loopStageIds = new Set(options.loopStageIds ?? BALANCE_LAB_LOOP_STAGE_IDS);
  const selectedLoopEvidence = new Map<BalanceLabLoopStageId, {
    summary: MatchSummary;
    evidence: AiMatchupLoopStageEvidence;
  }>();
  if (options.oneReplayPerLoopStage) {
    for (const stageId of loopStageIds) {
      const candidates = report.summaries.flatMap((summary) => {
        const evidence = summary.flow.loopStageRepresentatives[stageId];
        return evidence ? [{ summary, evidence }] : [];
      }).sort((left, right) => (
        Number(right.evidence.status === 'blocked') - Number(left.evidence.status === 'blocked')
        || left.summary.difficulty.localeCompare(right.summary.difficulty)
        || left.summary.p1.localeCompare(right.summary.p1)
        || left.summary.p2.localeCompare(right.summary.p2)
      ));
      const selected = candidates[0];
      if (selected) {
        selectedLoopEvidence.set(stageId, selected);
      }
    }
  }

  for (const summary of report.summaries) {
    const representatives = summary.flow.exchanges.representativeSequences;
    const entries: Array<{
      kind: AiMatchupReviewReplayKind;
      status: AiMatchupReviewReplayStatus;
      summary: string;
      setSeed: number;
      roundSeed: number;
      gameNumber: number;
      roundNumber: number;
      focusStartSeconds: number;
      focusEndSeconds: number;
      relatedPlayerIds?: Array<'P1' | 'P2'>;
    }> = [];
    if (options.includeGeneralEvidence !== false) {
      for (const [kind, evidence] of [
        ['worst-unresolved', representatives.worstUnresolved],
        ['worst-brief-exit', representatives.worstBriefExit],
        ['worst-contact', representatives.worstContact],
      ] as const) {
        if (!evidence) {
          continue;
        }
        entries.push({
          kind,
          status: 'representative',
          summary: formatExchangeSequenceEvidence(evidence).replace(/`/g, ''),
          setSeed: evidence.setSeed,
          roundSeed: evidence.seed,
          gameNumber: evidence.gameNumber,
          roundNumber: evidence.roundNumber,
          focusStartSeconds: evidence.startSeconds,
          focusEndSeconds: evidence.endSeconds,
        });
      }
      const timeout = summary.flow.representativeTimeout;
      if (timeout) {
        entries.push({
          kind: 'worst-timeout',
          status: 'representative',
          summary: formatTimeoutRoundEvidence(timeout).replace(/`/g, ''),
          setSeed: timeout.setSeed,
          roundSeed: timeout.seed,
          gameNumber: timeout.gameNumber,
          roundNumber: timeout.roundNumber,
          focusStartSeconds: timeout.focusStartSeconds,
          focusEndSeconds: timeout.focusEndSeconds,
        });
      }
    }
    for (const stageId of BALANCE_LAB_LOOP_STAGE_IDS) {
      if (!loopStageIds.has(stageId)) {
        continue;
      }
      const evidence = summary.flow.loopStageRepresentatives[stageId];
      if (!evidence) {
        continue;
      }
      const selected = selectedLoopEvidence.get(stageId);
      if (selected && (selected.summary !== summary || selected.evidence !== evidence)) {
        continue;
      }
      entries.push({
        kind: `loop-${stageId}`,
        status: evidence.status,
        summary: formatLoopStageEvidence(evidence).replace(/`/g, ''),
        setSeed: evidence.setSeed,
        roundSeed: evidence.seed,
        gameNumber: evidence.gameNumber,
        roundNumber: evidence.roundNumber,
        focusStartSeconds: evidence.focusStartSeconds,
        focusEndSeconds: evidence.focusEndSeconds,
        relatedPlayerIds: [...evidence.relatedPlayerIds],
      });
    }

    for (const entry of entries) {
      let label = `${entry.kind.replace(/-/g, ' ')} | ${summary.difficulty} ${summary.p1} vs ${summary.p2} | game ${entry.gameNumber}, round ${entry.roundNumber}`;
      let artifactSummary = entry.summary;
      const replay = createAiRoundReplay({
        p1: summary.p1,
        p2: summary.p2,
        difficulty: summary.difficulty,
        recoveryPolicyId: report.options.recoveryPolicyId,
        clashPolicyId: report.options.clashPolicyId,
        pursuitPolicyId: report.options.pursuitPolicyId,
        behaviorTuning: balanceRules.aiBehaviorTuning,
        setSeed: entry.setSeed,
        roundIndex: entry.roundNumber - 1,
        maxFrames,
        fixedDt: report.simulation.fixedDt,
        rules: report.simulation.rules,
        tuning: balanceRules.tuning,
        characterBalanceOverrides: balanceRules.characterBalanceOverrides,
        rulesetVersion: 'prototype-2026.09',
        simBuildHash: `ai-batch:${report.aiProfilesFingerprint}:${report.balanceProfile.tuningFingerprint}`,
        reviewFocus: {
          source: `ai-matchup-batch:${reportName}`,
          label,
          focusFrame: Math.floor(entry.focusStartSeconds / report.simulation.fixedDt),
          endFrame: Math.floor(entry.focusEndSeconds / report.simulation.fixedDt),
        },
      });
      if (entry.kind === 'loop-chase') {
        const flow = buildBalanceLabFlowModel(replay.simulation.telemetry);
        const relatedPlayers = entry.relatedPlayerIds && entry.relatedPlayerIds.length > 0
          ? new Set(entry.relatedPlayerIds)
          : null;
        const controlReturns = (['P1', 'P2'] as const).flatMap((playerId) => (
          relatedPlayers && !relatedPlayers.has(playerId)
            ? []
            : flow.players[playerId].controlReturn.reviews
        ));
        const review = selectMostConstrainedBalanceLabControlReturn(controlReturns);
        const range = review
          ? resolveBalanceLabControlReturnReviewRange(replay.simulation.telemetry, review)
          : null;
        if (review && range && replay.payload.header.reviewFocus) {
          replay.payload.header.reviewFocus.focusFrame = range.focusFrame;
          replay.payload.header.reviewFocus.endFrame = range.endFrame;
          label = `${label} | ${review.playerId} control return`;
          replay.payload.header.reviewFocus.label = label;
          const firstAction = review.firstAcceptedAction
            ? `${review.firstAcceptedAction}${review.firstActionMovementIntent ? ` with ${review.firstActionMovementIntent} movement` : ''} after ${review.firstActionDelaySeconds?.toFixed(2) ?? 'N/A'}s`
            : 'no accepted action';
          const relaunch = review.controlWindowSeconds === null
            ? 'no re-launch recorded'
            : `re-launched after ${review.controlWindowSeconds.toFixed(2)}s`;
          artifactSummary = `${entry.summary} Review focus: ${review.playerId} ${review.returnKind.replace('_', ' ')} control return at ${review.returnSeconds.toFixed(2)}s; ${firstAction}; ${relaunch}; ${review.sustainedResetAfterReturn ? 'durable reset created' : 'no durable reset'}.`;
        }
      }
      if (entry.kind === 'loop-finish') {
        const reviews = buildBalanceLabFinishOpportunityReviews(replay.simulation.telemetry);
        const review = selectMissedBalanceLabFinishOpportunity(reviews);
        const range = review
          ? resolveBalanceLabFinishOpportunityReviewRange(replay.simulation.telemetry, review)
          : null;
        if (review && range && replay.payload.header.reviewFocus) {
          replay.payload.header.reviewFocus.focusFrame = range.focusFrame;
          replay.payload.header.reviewFocus.endFrame = range.endFrame;
          label = `${label} | ${review.attackerId} missed finish on ${review.targetId}`;
          replay.payload.header.reviewFocus.label = label;
          const targetMotion = review.targetSpeed === null
            ? 'target speed unavailable'
            : `target speed ${review.targetSpeed.toFixed(1)}`;
          const separation = review.separationSpeed === null
            ? 'separation unavailable'
            : review.separationSpeed >= 0
              ? `separating at ${review.separationSpeed.toFixed(1)}`
              : `closing at ${Math.abs(review.separationSpeed).toFixed(1)}`;
          const resolution = review.resolutionKind === 'target_control_return'
            ? `${review.targetId} regained control ${review.opportunityWindowSeconds.toFixed(2)}s later`
            : review.resolutionKind === 'attacker_recommit'
              ? `${review.attackerId} started another launch ${review.opportunityWindowSeconds.toFixed(2)}s later`
              : review.resolutionKind === 'round_end'
                ? `the round ended ${review.opportunityWindowSeconds.toFixed(2)}s later`
                : `the sample ended ${review.opportunityWindowSeconds.toFixed(2)}s later`;
          artifactSummary = `${entry.summary} Review focus: ${review.attackerId} launched empty ${review.targetId} at ${review.launchHitSeconds.toFixed(2)}s (${targetMotion}; ${separation}); no dunk started before ${resolution}.`;
        }
      }
      const mismatch = findFirstChecksumMismatch(
        runReplay(replay.payload).checksums,
        replay.payload.expectedChecksums ?? [],
      );
      if (mismatch) {
        throw new Error(
          `Review replay checksum mismatch for ${label} at frame ${mismatch.frame}: expected ${mismatch.expected}, received ${mismatch.actual}.`,
        );
      }
      if (replay.simulation.roundSeed !== entry.roundSeed) {
        throw new Error(
          `Review replay seed mismatch for ${label}: expected ${entry.roundSeed}, received ${replay.simulation.roundSeed}.`,
        );
      }

      const fileName = [
        summary.difficulty,
        `${summary.p1}-vs-${summary.p2}`,
        entry.kind,
        `g${entry.gameNumber}`,
        `r${entry.roundNumber}`,
        'replay.json',
      ].join('-').replace(/[^a-z0-9._-]/gi, '-');
      const relativePath = `${replayDirectoryName}/${fileName}`;
      writeFileSync(
        join(replayDirectory, fileName),
        `${JSON.stringify(replay.payload, null, 2)}\n`,
        'utf8',
      );
      artifacts.push({
        kind: entry.kind,
        status: entry.status,
        summary: artifactSummary,
        path: relativePath,
        label,
        p1: summary.p1,
        p2: summary.p2,
        difficulty: summary.difficulty,
        gameNumber: entry.gameNumber,
        roundNumber: entry.roundNumber,
        setSeed: entry.setSeed,
        roundSeed: entry.roundSeed,
        focusFrame: replay.payload.header.reviewFocus?.focusFrame ?? 0,
        endFrame: replay.payload.header.reviewFocus?.endFrame ?? null,
        frames: replay.payload.inputTimeline.length,
      });
    }
  }

  const severity = { blocked: 0, watch: 1, representative: 2 } satisfies Record<
    AiMatchupReviewReplayStatus,
    number
  >;
  return artifacts.sort((left, right) => (
    severity[left.status] - severity[right.status]
    || left.difficulty.localeCompare(right.difficulty)
    || left.p1.localeCompare(right.p1)
    || left.p2.localeCompare(right.p2)
    || left.kind.localeCompare(right.kind)
    || left.gameNumber - right.gameNumber
    || left.roundNumber - right.roundNumber
  ));
}

function formatSummaryMarkdown(report: BatchReport): string {
  const formatDesignerLevers = (priority: AiFlowDesignerBrief['priorities'][number]): string => {
    const formatGroup = (label: string, entries: typeof priority.aiBehaviorLevers): string | null => {
      if (entries.length === 0) {
        return null;
      }
      return `${label}: ${entries.slice(0, 3).map((entry) => `\`${entry.key}\` (${entry.representativeCount})`).join(', ')}`;
    };
    return [
      formatGroup('AI', priority.aiBehaviorLevers),
      formatGroup('Global', priority.globalTuningLevers),
      formatGroup('Character', priority.characterControlLevers),
    ].filter((entry): entry is string => entry !== null).join('; ') || 'No repeated lever family recorded';
  };
  const formatPostReturnActionMix = (player: AiMatchupFlowPlayerSummary): string => {
    const actions = BALANCE_LAB_CONTROL_RETURN_ACTIONS.flatMap((action) => {
      const flow = player.firstAcceptedActions[action];
      if (flow.starts === 0) {
        return [];
      }
      const movement = BALANCE_LAB_POST_CONTROL_MOVEMENT_INTENTS
        .flatMap((intent) => flow.movementIntents[intent] > 0
          ? [`${intent} ${flow.movementIntents[intent]}`]
          : []);
      const movementSummary = movement.length > 0 ? `; move ${movement.join('/')}` : '';
      return [`${action.replace('_', ' ')} ${flow.starts} (<=1s ${flow.immediateRelaunches}; reset ${flow.sustainedResets}/${flow.startsInPressure}${movementSummary})`];
    });
    return actions.length > 0 ? actions.join(', ') : 'N/A (no accepted action after return)';
  };
  const formatPostClashActionMix = (player: AiMatchupFlowPlayerSummary): string => {
    const actions = BALANCE_LAB_CONTROL_RETURN_ACTIONS.flatMap((action) => {
      const flow = player.clashFirstAcceptedActions[action];
      if (flow.starts === 0) {
        return [];
      }
      return [`${action.replace('_', ' ')} ${flow.starts} (<=1s ${flow.startsWithinOneSecond}; pressure ${flow.startsInPressure})`];
    });
    return actions.length > 0 ? actions.join(', ') : 'N/A (no accepted action after clash)';
  };
  const characterResultLines = report.gate
    ? Object.entries(report.gate.observed.characters)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([characterId, result]) => (
        `- \`${characterId}\`: ${result.setWins}/${result.completedSets} completed-set wins (${(result.winRate * 100).toFixed(1)}%)`
      ))
    : [];
  const gateLines = report.gate
    ? [
      `Regression gate: **${report.gate.pass ? 'PASS' : 'FAIL'}** (\`${report.gate.thresholdId}\`)`,
      ...report.gate.issues.map((issue) => `- ${issue}`),
      '',
      'AI completed-set outcomes (context only; not a gate or class-balance target):',
      ...characterResultLines,
      '',
    ]
    : [];
  const balanceSource = report.balanceProfile.draft
    ? `Draft: \`${report.balanceProfile.draft.name}\` from \`${basename(report.balanceProfile.draft.path)}\``
    : `Profile: \`${report.balanceProfile.resolvedId}\``;
  const lines: string[] = [
    '# AI Matchup Batch Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${balanceSource} (${report.balanceProfile.tuningFingerprint})`,
    `Base profile: \`${report.balanceProfile.resolvedId}\``,
    `Games per pairing: ${report.options.gamesPerPairing}`,
    `Max round seconds: ${report.options.maxRoundSeconds}`,
    `Base seed: ${report.options.baseSeed}`,
    `Scenario seed strategy: \`${report.options.seedStrategy}\``,
    `AI seed strategy: \`${report.options.aiSeedStrategy}\``,
    `AI recovery policy: \`${report.options.recoveryPolicyId}\``,
    `AI clash policy: \`${report.options.clashPolicyId}\``,
    `AI pursuit policy: \`${report.options.pursuitPolicyId}\``,
    `Fixed step: ${report.simulation.fixedDt}`,
    `AI profiles: ${report.aiProfilesFingerprint}`,
    `AI controller base: ${report.aiBaseProfilesFingerprint}`,
    `AI behavior tuning: ${report.balanceProfile.aiBehaviorFingerprint}`,
    `Exact rule snapshot: ${report.ruleSnapshot.fingerprint}`,
    '',
    `Character rules: \`${report.balanceProfile.effectiveCharacterRulesFingerprint}\``,
  ];

  const formatLoopStage = (stage: BalanceLabLoopStageAggregate): string => (
    `${stage.blockedRounds} blocked / ${stage.watchRounds} watch / ${stage.observedRounds} observed / ${stage.waitingRounds} waiting (${(stage.issueRatio * 100).toFixed(1)}% flagged)`
  );
  const formatLoopReason = (reasonId: string): string => {
    const reason = reasonId.split('.').slice(1).join('.') || reasonId;
    return reason.replace(/[._-]+/g, ' ');
  };

  lines.push(
    '',
    '## Designer Brief',
    '',
    report.designerBrief.primaryStageId
      ? `Primary observed bottleneck: **${report.designerBrief.priorities[0]?.label}**. Blocked evidence receives twice the priority weight of Watch evidence; set wins and class win rate are not inputs.`
      : 'No Watch or Blocked loop stage was observed. This does not prove the game is balanced; inspect the sample duration and Waiting counts before drawing a conclusion.',
    '',
  );
  if (report.designerBrief.priorities.length > 0) {
    lines.push(
      '| Priority | Stage | Blocked / watch / reached rounds | Flagged pairings | Repeated investigation levers |',
      '| ---: | --- | ---: | ---: | --- |',
    );
    for (const priority of report.designerBrief.priorities) {
      lines.push(
        `| ${priority.rank} | **${priority.label}** | ${priority.blockedRounds} / ${priority.watchRounds} / ${priority.reachedRounds} (${(priority.issueRatio * 100).toFixed(1)}% flagged) | ${priority.flaggedPairings.length}/${report.designerBrief.pairingCount} | ${formatDesignerLevers(priority)} |`,
      );
    }
    const issueReasonRows = report.designerBrief.priorities.flatMap((priority) => (
      (priority.issueReasons ?? []).map((reason) => ({ priority, reason }))
    ));
    if (issueReasonRows.length > 0) {
      lines.push(
        '',
        '### Flag Reasons',
        '',
        'Stable reason IDs show why rounds were flagged. Counts come from every deterministic round, not only the representative replay.',
        '',
        '| Stage | Reason | Blocked / watch / flagged rounds | Share of reached rounds |',
        '| --- | --- | ---: | ---: |',
      );
      for (const { priority, reason } of issueReasonRows) {
        lines.push(
          `| **${priority.label}** | <code>${reason.reasonId}</code> (${formatLoopReason(reason.reasonId)}) | ${reason.blockedRounds} / ${reason.watchRounds} / ${reason.rounds} | ${(reason.issueRatio * 100).toFixed(1)}% |`,
        );
      }
    }
    lines.push(
      '',
      '### Start Here',
      '',
      'These representatives are deterministic inspection points, not automatic balance prescriptions.',
      '',
    );
    for (const priority of report.designerBrief.priorities.slice(0, 3)) {
      const representative = priority.representative;
      lines.push(representative
        ? `- **${priority.label}** (${representative.pairing}, ${representative.status.toUpperCase()}): ${representative.detail}`
        : `- **${priority.label}**: flagged aggregate evidence exists, but no representative round was retained.`);
    }
  }

  lines.push(
    '',
    '### Launch Defense Reads',
    '',
    'This table follows pressure-range launch commitments from the defender\'s perspective. An answer is a pre-emptive or reactive parry, authored block-guard special, or counter-launch. Success means a parry or clash; reset conversion requires the resulting exit from pressure to last at least 0.75 seconds. These are gameplay-loop diagnostics, not class-strength targets.',
    '',
    '| Match | Defender | Incoming launches | Answers pre / reactive | Answer coverage | Answer mix parry / guard / counter | Success parry / guard / clash / counter | Hits / unanswered | Whiff or unresolved | Reactive delay | Success -> reset |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    for (const playerId of ['P1', 'P2'] as const) {
      const defense = summary.flow.players[playerId].launchDefense;
      const defender = playerId === 'P1' ? summary.p1 : summary.p2;
      const delay = defense.averageReactiveResponseSeconds === null
        ? 'N/A'
        : `${defense.averageReactiveResponseSeconds.toFixed(3)}s`;
      lines.push(
        `| \`${summary.difficulty}/${summary.p1}-vs-${summary.p2}\` | ${playerId} \`${defender}\` | ${defense.incomingPressureLaunches} | ${defense.preemptiveResponses} / ${defense.reactiveResponses} | ${(defense.responseCoverageRatio * 100).toFixed(1)}% | ${defense.parryResponses} / ${defense.guardResponses} / ${defense.counterLaunchResponses} | ${defense.successfulParries} / ${defense.successfulGuards} / ${defense.launchClashes} / ${defense.counterLaunchHits}${defense.unattributedParrySuccesses > 0 ? ` (+${defense.unattributedParrySuccesses} unattributed)` : ''} | ${defense.launchHits} / ${defense.unansweredLaunchHits} | ${defense.whiffsOrUnresolved} | ${delay} | ${defense.sustainedResetsAfterSuccessfulDefense}/${defense.successfulDefenses} (${(defense.successfulDefenseResetRatio * 100).toFixed(1)}%) |`,
      );
    }
  }

  lines.push(
    '',
    '## Gameplay Loop Chain',
    '',
    'Round-level flow evidence is the primary balancing signal. Waiting means the round did not reach that stage and is kept separate from failure; Watch plus Blocked form the flagged ratio. Class win rate is not used.',
    '',
    '| P1 | P2 | Difficulty | Neutral | Commitment | Exchange | Separation | Chase | Finish |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const summary of report.summaries) {
    const stages = summary.flow.loopStages;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${formatLoopStage(stages.neutral)} | ${formatLoopStage(stages.commitment)} | ${formatLoopStage(stages.exchange)} | ${formatLoopStage(stages.separation)} | ${formatLoopStage(stages.chase)} | ${formatLoopStage(stages.finish)} |`,
    );
  }

  lines.push(
    '',
    '### Control-Return Causality',
    '',
    'Each two-second window starts when control is actually granted, not when helpless movement first ends. Closing distance is attributed separately to the returning fighter and opponent from their actual radial movement. This shows whether the returner rushed back in, the opponent erased the gap, both did, or neither did.',
    '',
    '| P1 | P2 | Difficulty | P1 granted / max | P1 closure returner / opponent | P1 closed more R / O / even | P1 role evidence R / O | P1 outcomes exit / brief / pressure relaunch / held / interrupted | P2 granted / max | P2 closure returner / opponent | P2 closed more R / O / even | P2 role evidence R / O | P2 outcomes exit / brief / pressure relaunch / held / interrupted |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const formatRole = (role: BalanceLabControlReturnCausalRoleFlow): string => {
      const dominant = (values: Record<string, number>): string => {
        const [entry] = Object.entries(values)
          .filter(([, count]) => count > 0)
          .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]));
        return entry ? `${entry[0].replace(/_/g, ' ')} ${entry[1]}` : 'none';
      };
      return `move ${dominant(role.dominantMovementIntents)}; active ${dominant(role.dominantActiveActions)}; first ${dominant(role.firstAcceptedActions)}`;
    };
    const formatCausal = (player: AiMatchupFlowPlayerSummary): string[] => {
      const causal = player.controlReturnCausal;
      if (!causal || causal.windows === 0) {
        return ['N/A', 'N/A', 'N/A', 'N/A', 'N/A'];
      }
      return [
        `${causal.averageControlGrantedDistance?.toFixed(1) ?? 'N/A'} / ${causal.averageMaximumDistance?.toFixed(1) ?? 'N/A'} (${causal.controlGrantedInPressure} pressured / ${causal.safeAtGrant} safe)`,
        `${causal.returnedPlayerClosingDistance.toFixed(1)} / ${causal.opponentClosingDistance.toFixed(1)} (${causal.returnedPlayerClosingShare === null ? 'N/A' : `${(causal.returnedPlayerClosingShare * 100).toFixed(1)}% R`})`,
        `${causal.returnedPlayerClosedMore} / ${causal.opponentClosedMore} / ${causal.balancedClosure}`,
        `R ${causal.returnedPlayerFirstActions} [${formatRole(causal.roles.returner)}] / O ${causal.opponentFirstActions} [${formatRole(causal.roles.opponent)}]`,
        `${causal.outcomes.sustained_exit} / ${causal.outcomes.brief_reentry} / ${causal.outcomes.relaunched_in_pressure} / ${causal.outcomes.pressure_continued} / ${causal.outcomes.control_interrupted}`,
      ];
    };
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${[...formatCausal(summary.flow.players.P1), ...formatCausal(summary.flow.players.P2)].join(' | ')} |`,
    );
  }

  lines.push(
    '',
    '### Flagged Stage Representatives',
    '',
    'Each Watch or Blocked stage points to one deterministic round and the controls most directly related to the evidence. These are inspection starting points, not automatic prescriptions.',
    '',
  );
  for (const summary of report.summaries) {
    const label = `\`${summary.difficulty}/${summary.p1}-vs-${summary.p2}\``;
    const representatives = BALANCE_LAB_LOOP_STAGE_IDS.flatMap((stageId) => {
      const evidence = summary.flow.loopStageRepresentatives[stageId];
      return evidence ? [evidence] : [];
    });
    if (representatives.length === 0) {
      lines.push(`- ${label}: no Watch or Blocked stage representative.`);
      continue;
    }
    for (const evidence of representatives) {
      lines.push(`- ${label} **${evidence.label}**: ${formatLoopStageEvidence(evidence)}`);
    }
  }

  if (gateLines.length > 0) {
    lines.push(
      '',
      '## Regression Gate',
      '',
      ...gateLines,
    );
  }

  lines.push(
    '',
    '## AI Set Outcomes (Context Only)',
    '',
    'Set results can expose AI-policy or kit asymmetry, but they are not the balancing target or score.',
    '',
    '| P1 | P2 | Difficulty | Games | P1 wins | P2 wins | Draws | Timeouts | Avg set sec | Avg rounds | P1 launch conv | P2 launch conv | Accepted starts | Clashes / round | Recovery clashes | Dunk hits | Specials | Projectile impacts | Contact | Point blank |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );

  for (const summary of report.summaries) {
    const telemetry = summary.telemetry;
    const rounds = Math.max(1, telemetry.rounds);
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${summary.games} | ${summary.p1SetWins} | ${summary.p2SetWins} | ${summary.drawnSets} | ${summary.totalRoundTimeouts} | ${summary.averageSetSeconds.toFixed(2)} | ${summary.averageRoundsPerSet.toFixed(2)} | ${(telemetry.players.P1.launchConversionRate * 100).toFixed(1)}% | ${(telemetry.players.P2.launchConversionRate * 100).toFixed(1)}% | ${telemetry.players.P1.acceptedActionStarts}/${telemetry.players.P2.acceptedActionStarts} | ${(telemetry.eventCounts.launch_clash / rounds).toFixed(2)} | ${telemetry.launchClashCauses.post_control_counter_launch} | ${telemetry.players.P1.dunkHits}/${telemetry.players.P2.dunkHits} | ${telemetry.players.P1.specialResolves}/${telemetry.players.P2.specialResolves} | ${telemetry.players.P1.projectileImpacts}/${telemetry.players.P2.projectileImpacts} | ${(telemetry.spacing.contactRatio * 100).toFixed(1)}% | ${(telemetry.spacing.pointBlankRatio * 100).toFixed(1)}% |`,
    );
  }

  lines.push(
    '',
    '## Contact Lock Evidence',
    '',
    'Contact duration separates short collision exchanges from the sustained body-contact failure mode. Controller intent is limited to collision frames where both fighters could act; it is evidence for AI spacing changes, not class scoring.',
    '',
    '| P1 | P2 | Difficulty | Contact | Episodes | Avg / p90 / max | P1 contact A / O / D / I | P2 contact A / O / D / I |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  );
  const formatContactMovement = (player: AiMatchupFlowPlayerSummary): string => (
    `${(player.contactApproachRatio * 100).toFixed(1)}% / ${(player.contactOrbitRatio * 100).toFixed(1)}% / ${(player.contactRetreatRatio * 100).toFixed(1)}% / ${(player.contactIdleRatio * 100).toFixed(1)}% (${player.contestedContactFrames}f)`
  );
  for (const summary of report.summaries) {
    const spacing = summary.telemetry.spacing;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${(spacing.contactRatio * 100).toFixed(1)}% | ${spacing.contactEpisodeCount} | ${spacing.averageContactEpisodeSeconds.toFixed(2)}s / ${spacing.p90ContactEpisodeSeconds.toFixed(2)}s / ${spacing.maximumContactEpisodeSeconds.toFixed(2)}s | ${formatContactMovement(summary.flow.players.P1)} | ${formatContactMovement(summary.flow.players.P2)} |`,
    );
  }

  lines.push(
    '',
    '## Shared Decision Agency',
    '',
    'Shared movement control means neither fighter is helpless, stunned, or in forced dunk recovery. Shared action-ready time is the stricter subset where neither fighter is also in end lag, parry, or an active attack commitment. A shared decision window additionally requires that subset to be outside pressure. This prevents launch travel or move lockout from being counted as healthy neutral. Contact, pressure, and neutral percentages use shared action-ready frames as their denominator.',
    '',
    '| P1 | P2 | Difficulty | Shared control / sample | Contact / pressure while both steer | Action-ready / sample / control | Contact while ready | Ready contact avg / p90 / max | Pressure / neutral while ready | Shared windows >=0.75s | Neutral avg / p90 / max |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const agency = summary.telemetry.sharedAgency;
    const windowsPerRound = agency.sustainedNeutralWindowCount
      / Math.max(1, summary.telemetry.rounds);
    const controlContactRatio = sharedControlBandRatio(summary, 'contact') ?? 0;
    const controlPressureRatio = sharedControlBandRatio(summary, 'pressure') ?? 0;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${(agency.controlRatio * 100).toFixed(1)}% / ${agency.controlSeconds.toFixed(2)}s | ${(controlContactRatio * 100).toFixed(1)}% / ${(controlPressureRatio * 100).toFixed(1)}% | ${(agency.actionReadyRatio * 100).toFixed(1)}% / ${(agency.actionReadyShareOfControlFrames * 100).toFixed(1)}% / ${agency.actionReadySeconds.toFixed(2)}s | ${(agency.contactRatio * 100).toFixed(1)}% | ${agency.averageContactEpisodeSeconds.toFixed(2)}s / ${agency.p90ContactEpisodeSeconds.toFixed(2)}s / ${agency.maximumContactEpisodeSeconds.toFixed(2)}s | ${(agency.pressureRatio * 100).toFixed(1)}% / ${(agency.neutralRatio * 100).toFixed(1)}% | ${agency.sustainedNeutralWindowCount} (${windowsPerRound.toFixed(2)}/round, ${agency.sustainedNeutralWindowSeconds.toFixed(2)}s) | ${agency.averageNeutralEpisodeSeconds.toFixed(2)}s / ${agency.p90NeutralEpisodeSeconds.toFixed(2)}s / ${agency.maximumNeutralEpisodeSeconds.toFixed(2)}s |`,
    );
  }

  lines.push(
    '',
    '## Movement Intent',
    '',
    'Movement is classified relative to the opponent on every controllable frame. This separates controller behavior from collision and move-data effects; it is diagnostic evidence, not a desired play-style target.',
    '',
    '| P1 | P2 | Difficulty | P1 overall A / O / D / I | P2 overall A / O / D / I | P1 both-active pressure A / D | P2 both-active pressure A / D | P1 both-active point-blank A / D | P2 both-active point-blank A / D |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  const formatMovement = (player: AiMatchupFlowPlayerSummary): string => (
    `${(player.approachRatio * 100).toFixed(1)}% / ${(player.orbitRatio * 100).toFixed(1)}% / ${(player.retreatRatio * 100).toFixed(1)}% / ${(player.idleRatio * 100).toFixed(1)}%`
  );
  const formatCloseMovement = (
    approachRatio: number,
    retreatRatio: number,
  ): string => `${(approachRatio * 100).toFixed(1)}% / ${(retreatRatio * 100).toFixed(1)}%`;
  for (const summary of report.summaries) {
    const p1 = summary.flow.players.P1;
    const p2 = summary.flow.players.P2;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${formatMovement(p1)} | ${formatMovement(p2)} | ${formatCloseMovement(p1.pressureApproachRatio, p1.pressureRetreatRatio)} | ${formatCloseMovement(p2.pressureApproachRatio, p2.pressureRetreatRatio)} | ${formatCloseMovement(p1.pointBlankApproachRatio, p1.pointBlankRetreatRatio)} | ${formatCloseMovement(p2.pointBlankApproachRatio, p2.pointBlankRetreatRatio)} |`,
    );
  }

  lines.push(
    '',
    '## Detailed Gameplay Flow',
    '',
    'These diagnostics describe how rounds unfold. They are intentionally separate from class win rate.',
    '',
    '### Gameplay Cadence (Context Only)',
    '',
    'Cadence is descriptive, not directionally scored: lower clash or combat-start cadence is not inherently healthier. Read it beside pressure, resets, exchanges, and finishes to distinguish deliberate pacing from stalled play or action substitution.',
    '',
    '| P1 | P2 | Difficulty | Launch clashes / round | Launch clashes / min | Accepted combat starts P1 / P2 per round | Accepted combat starts P1 / P2 per min |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const flow = summary.flow;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${flow.launchClashesPerRound.toFixed(2)} | ${flow.launchClashesPerMinute.toFixed(2)} | ${flow.players.P1.acceptedCombatActionStartsPerRound.toFixed(2)} / ${flow.players.P2.acceptedCombatActionStartsPerRound.toFixed(2)} | ${flow.players.P1.acceptedCombatActionStartsPerMinute.toFixed(2)} / ${flow.players.P2.acceptedCombatActionStartsPerMinute.toFixed(2)} |`,
    );
  }

  lines.push(
    '',
    '### Post-Clash Decisions',
    '',
    'This table isolates the first simulation-accepted action by each fighter after every launch clash and before the next clash or round end. Rapid launch recommit uses the clash count as its denominator. It distinguishes a fast movement or defensive decision from immediately repeating the same cancelling attack.',
    '',
    '| P1 | P2 | Difficulty | Clash recurrence <=1s | P1 acted / clashes | P1 first-action delay | P1 rapid launch | P1 first-action mix | P2 acted / clashes | P2 first-action delay | P2 rapid launch | P2 first-action mix |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |',
  );
  for (const summary of report.summaries) {
    const flow = summary.flow;
    const p1 = flow.players.P1;
    const p2 = flow.players.P2;
    const recurrence = flow.repeatClashRatio === null
      ? 'N/A'
      : `${flow.repeatClashesWithinOneSecond}/${flow.clashRepeatOpportunities} (${(flow.repeatClashRatio * 100).toFixed(1)}%)`;
    const p1Delay = p1.averageClashFirstActionDelaySeconds === null
      ? 'N/A'
      : `${p1.averageClashFirstActionDelaySeconds.toFixed(2)}s`;
    const p2Delay = p2.averageClashFirstActionDelaySeconds === null
      ? 'N/A'
      : `${p2.averageClashFirstActionDelaySeconds.toFixed(2)}s`;
    lines.push(
      `| <code>${summary.p1}</code> | <code>${summary.p2}</code> | <code>${summary.difficulty}</code> | ${recurrence} | ${p1.clashFirstActions}/${flow.launchClashes} | ${p1Delay} | ${p1.clashRapidLaunchRecommits} (${(p1.clashRapidLaunchRecommitRatio * 100).toFixed(1)}%) | ${formatPostClashActionMix(p1)} | ${p2.clashFirstActions}/${flow.launchClashes} | ${p2Delay} | ${p2.clashRapidLaunchRecommits} (${(p2.clashRapidLaunchRecommitRatio * 100).toFixed(1)}%) | ${formatPostClashActionMix(p2)} |`,
    );
  }

  lines.push(
    '',
    '### Neutral Exit Decisions',
    '',
    'This table begins when pressure changes to mid/long range. It records the first newly accepted action before pressure resumes or the sample ends. A carried brief re-entry has no new accepted action, indicating that existing movement, boost, or momentum erased the exit before either controller made another accepted decision.',
    '',
    '| P1 | P2 | Difficulty | First action / exits | First-action delay | First-action actor P1 / P2 | First-action mix | Carried brief re-entry | Carried cause mix | Resets / exits |',
    '| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | ---: |',
  );
  for (const summary of report.summaries) {
    const followUp = summary.flow.neutralExitFollowUp;
    const actionMix = Object.entries(followUp.firstAcceptedActions)
      .filter(([, starts]) => starts > 0)
      .map(([action, starts]) => `${action.replace(/_/g, ' ')} ${starts}`)
      .join(', ') || 'N/A';
    const carriedCauseMix = Object.entries(followUp.carriedBriefExitCauses)
      .filter(([, count]) => count > 0)
      .map(([cause, count]) => (
        `${BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[cause as BalanceLabCarriedReentryCause]} ${count}`
      ))
      .join(', ') || 'N/A';
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${formatRatio(followUp.firstActions, followUp.exits, followUp.firstActionCoverageRatio, 'no neutral exits')} | ${formatSeconds(followUp.averageFirstActionDelaySeconds, 'no accepted neutral action')} | ${followUp.playerFirstActions.P1} / ${followUp.playerFirstActions.P2} | ${actionMix} | ${formatRatio(followUp.briefExitsWithoutAcceptedAction, followUp.briefExits, followUp.carriedBriefExitRatio, 'no brief exits')} | ${carriedCauseMix} | ${followUp.resetExits}/${followUp.exits} |`,
    );
  }

  lines.push(
    '',
    '### Ordinary Boost Counterplay',
    '',
    'A read opens only when an accepted ordinary Boost is close, closing, aimed through the defender, and the defender had agency on the preceding frame. Counts are grouped by defender and describe interaction shape, not matchup strength or win rate.',
    '',
    '| P1 | P2 | Difficulty | Defender | Reads / round | Answered | Paid Super Boost | Contact / conversion / clean pass | First response avg | Available reaction avg | Start distance avg | First-response mix |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  );
  for (const summary of report.summaries) {
    for (const playerId of ['P1', 'P2'] as const) {
      const counterplay = summary.flow.ordinaryBoostCounterplay[playerId];
      const actionMix = Object.entries(counterplay.firstResponseActions)
        .filter(([, count]) => count > 0)
        .map(([action, count]) => `${action.replace(/_/g, ' ')} ${count}`)
        .join(', ') || 'N/A';
      lines.push(
        `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${playerId} (\`${playerId === 'P1' ? summary.p1 : summary.p2}\`) | ${counterplay.opportunities} / ${counterplay.opportunitiesPerRound.toFixed(2)} | ${formatRatio(counterplay.firstResponses, counterplay.opportunities, counterplay.responseCoverageRatio, 'no reads')} | ${formatRatio(counterplay.targetSuperBoostResponses, counterplay.opportunities, counterplay.superBoostResponseRatio, 'no reads')} | ${counterplay.outcomes.contact} / ${counterplay.outcomes.combat_conversion} / ${counterplay.outcomes.clean_pass} | ${formatSeconds(counterplay.averageFirstResponseSeconds, 'no accepted response')} | ${formatSeconds(counterplay.averageAvailableReactionSeconds, 'no reads')} | ${counterplay.averageStartDistance === null ? 'N/A' : counterplay.averageStartDistance.toFixed(2)} | ${actionMix} |`,
      );
    }
  }

  lines.push(
    '',
    '### Pressure And Resolution',
    '',
    '| P1 | P2 | Difficulty | Contact | Point blank | Pressure | Pressure avg / longest p90 | Neutral window avg / longest avg | Exchange outcomes | Exchange resets | Exchange sec avg / p90 | Unresolved sec avg / max | Brief / live | All resets | Parry resets | Break resets | Launch pressure P1 / P2 | Return -> re-launch P1 / P2 | Helpless P1 / P2 | Zero fuel P1 / P2 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const flow = summary.flow;
    const telemetry = summary.telemetry;
    const formatReset = (outcome: AiMatchupResetSummary): string => formatRatio(
      outcome.successes,
      outcome.attempts,
      outcome.successRatio,
      'no reset attempts',
    );
    const exchanges = flow.exchanges;
    const exchangePressure = exchanges.total > 0
      ? `${exchanges.averagePressureSeconds.toFixed(2)}s / ${exchanges.p90PressureSeconds.toFixed(2)}s`
      : 'N/A (no exchanges)';
    const unresolvedPressure = exchanges.total > 0
      ? `${formatSeconds(exchanges.averageUnresolvedPressureSeconds, 'no exchange evidence')} / ${exchanges.longestUnresolvedPressureSeconds.toFixed(2)}s`
      : 'N/A (no exchanges)';
    const formatLaunchPressure = (player: AiMatchupFlowPlayerSummary): string => (
      player.helplessSecondsPerLaunchReceived === null
        ? `${player.launchHitsReceived} @ N/A`
        : `${player.launchHitsReceived} @ ${player.helplessSecondsPerLaunchReceived.toFixed(2)}s/hit`
    );
    const formatControlReturn = (player: AiMatchupFlowPlayerSummary): string => (
      player.controlReturns === 0
        ? 'N/A'
        : `${player.relaunchesWithinOneSecond}/${player.controlReturns} <=1s (${(player.immediateRelaunchRatio * 100).toFixed(1)}%), ${player.averageControlWindowSeconds === null ? 'N/A' : `${player.averageControlWindowSeconds.toFixed(2)}s avg`}, acted ${player.relaunchesWithAcceptedAction}/${player.relaunchesAfterControlReturn}, return reset ${player.sustainedResetsAfterControlReturn}/${player.controlReturnsInPressure}, action reset ${player.sustainedResetsAfterFirstAction}/${player.firstActionsInPressure}`
    );
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${(telemetry.spacing.contactRatio * 100).toFixed(1)}% | ${(telemetry.spacing.pointBlankRatio * 100).toFixed(1)}% | ${(telemetry.spacing.pressureBandRatio * 100).toFixed(1)}% | ${flow.averagePressureSequenceSeconds.toFixed(2)}s / ${flow.p90LongestPressureSequenceSeconds.toFixed(2)}s | ${flow.averageNeutralWindowSeconds.toFixed(2)}s / ${flow.averageLongestNeutralWindowSeconds.toFixed(2)}s | ${formatRatio(exchanges.resolved, exchanges.total, exchanges.resolvedRatio, 'no exchanges')} | ${formatRatio(exchanges.resets, exchanges.total, exchanges.resetRatio, 'no exchanges')} | ${exchangePressure} | ${unresolvedPressure} | ${exchanges.briefExits} / ${exchanges.ongoing} | ${formatReset(flow.resetOutcomes.all)} | ${formatReset(flow.resetOutcomes.parries)} | ${formatReset(flow.resetOutcomes.launchBreaks)} | ${formatLaunchPressure(flow.players.P1)} / ${formatLaunchPressure(flow.players.P2)} | ${formatControlReturn(flow.players.P1)} / ${formatControlReturn(flow.players.P2)} | ${(flow.players.P1.helplessRatio * 100).toFixed(1)}% / ${(flow.players.P2.helplessRatio * 100).toFixed(1)}% | ${(flow.players.P1.zeroFuelRatio * 100).toFixed(1)}% / ${(flow.players.P2.zeroFuelRatio * 100).toFixed(1)}% |`,
    );
  }

  lines.push(
    '',
    '### Post-Control AI Decisions',
    '',
    'Reposition columns record the one-shot weighted choice after control returns. Counterstep columns record the separate zero-default movement interception that cancels inward locomotion without suppressing launch, parry, or Guard. A neutral baseline correctly reports no exposure. These are mechanism diagnostics, not a score; read them beside first-action direction, control-return resets, exchanges, and finishes.',
    '',
    '| P1 | P2 | Difficulty | P1 reposition selected / windows | P1 reposition eligible frames | P1 reposition / round | P1 reposition sec / round | P1 countersteps / round | P1 counterstep sec / round | P1 return reset | P2 reposition selected / windows | P2 reposition eligible frames | P2 reposition / round | P2 reposition sec / round | P2 countersteps / round | P2 counterstep sec / round | P2 return reset |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const p1 = summary.flow.players.P1;
    const p2 = summary.flow.players.P2;
    const formatSelection = (player: AiMatchupFlowPlayerSummary): string => (
      player.tacticalRepositionSelectionRatio === null
        ? `${player.tacticalRepositionSelections}/${player.tacticalRepositionOpportunityWindows} (N/A)`
        : `${player.tacticalRepositionSelections}/${player.tacticalRepositionOpportunityWindows} (${(player.tacticalRepositionSelectionRatio * 100).toFixed(1)}%)`
    );
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${formatSelection(p1)} | ${p1.tacticalRepositionOpportunityFrames} | ${p1.tacticalRepositionSelectionsPerRound.toFixed(2)} | ${p1.tacticalRepositionSecondsPerRound.toFixed(2)}s | ${p1.postControlCounterstepWindowsPerRound.toFixed(2)} | ${p1.postControlCounterstepSecondsPerRound.toFixed(2)}s | ${p1.sustainedResetsAfterControlReturn}/${p1.controlReturnsInPressure} | ${formatSelection(p2)} | ${p2.tacticalRepositionOpportunityFrames} | ${p2.tacticalRepositionSelectionsPerRound.toFixed(2)} | ${p2.tacticalRepositionSecondsPerRound.toFixed(2)}s | ${p2.postControlCounterstepWindowsPerRound.toFixed(2)} | ${p2.postControlCounterstepSecondsPerRound.toFixed(2)}s | ${p2.sustainedResetsAfterControlReturn}/${p2.controlReturnsInPressure} |`,
    );
  }

  lines.push(
    '',
    '### Post-Control Chase Lock',
    '',
    'These counters prove whether the zero-default chase-lock probe was exposed after natural or launch-break control returns. Once both fighters are action-ready, it suppresses inward ordinary Boost pressure and package-declared movement-dash specials while preserving steering, outward escape, tactical actions, Guard, projectiles, and paid Super Boost. Dash time records frames where a movement dash was otherwise ready; consumption records a tactical action or Super Boost ending the window. These are mechanism diagnostics, not a quality score.',
    '',
    '| P1 | P2 | Difficulty | P1 windows / round | P1 active sec / round | P1 boost-suppressed sec / round | P1 ready-dash sec / round | P1 consumptions / round | P2 windows / round | P2 active sec / round | P2 boost-suppressed sec / round | P2 ready-dash sec / round | P2 consumptions / round |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const p1 = summary.flow.players.P1;
    const p2 = summary.flow.players.P2;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${p1.postControlChaseLockWindowsPerRound.toFixed(2)} | ${p1.postControlChaseLockSecondsPerRound.toFixed(2)}s | ${p1.postControlBoostSuppressionSecondsPerRound.toFixed(2)}s | ${p1.postControlDashSuppressionSecondsPerRound.toFixed(2)}s | ${p1.postControlChaseLockConsumptionsPerRound.toFixed(2)} | ${p2.postControlChaseLockWindowsPerRound.toFixed(2)} | ${p2.postControlChaseLockSecondsPerRound.toFixed(2)}s | ${p2.postControlBoostSuppressionSecondsPerRound.toFixed(2)}s | ${p2.postControlDashSuppressionSecondsPerRound.toFixed(2)}s | ${p2.postControlChaseLockConsumptionsPerRound.toFixed(2)} |`,
    );
  }

  lines.push(
    '',
    '### Post-Control Repeat Dash',
    '',
    'Pending windows count each newly armed repeat-dash opportunity after control returns. Weight time counts decision frames where the repeat-dash weight was actually applied; consumptions count resolved windows, and selections count resolutions that chose the weighted dash. These are deterministic mechanism diagnostics, not a quality score.',
    '',
    '| P1 | P2 | Difficulty | P1 windows / round | P1 weighted sec / round | P1 consumptions / round | P1 selections / round | P2 windows / round | P2 weighted sec / round | P2 consumptions / round | P2 selections / round |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const p1 = summary.flow.players.P1;
    const p2 = summary.flow.players.P2;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${p1.postControlRepeatDashWindowsPerRound.toFixed(2)} | ${p1.postControlRepeatDashWeightSecondsPerRound.toFixed(2)}s | ${p1.postControlRepeatDashConsumptionsPerRound.toFixed(2)} | ${p1.postControlRepeatDashSelectionsPerRound.toFixed(2)} | ${p2.postControlRepeatDashWindowsPerRound.toFixed(2)} | ${p2.postControlRepeatDashWeightSecondsPerRound.toFixed(2)}s | ${p2.postControlRepeatDashConsumptionsPerRound.toFixed(2)} | ${p2.postControlRepeatDashSelectionsPerRound.toFixed(2)} |`,
    );
  }

  lines.push(
    '',
    '### Combat Boost Commitment',
    '',
    'These counters prove whether the zero-default ordinary-boost commitment rule was exposed. Lock time covers attack, parry, launch-break recovery, interrupted commitments, and the configured post-recovery delay; held time is the subset where boost input continued; cancellations count active boosts interrupted by the rule. Super boost is intentionally excluded.',
    '',
    '| P1 | P2 | Difficulty | P1 lock sec / round | P1 delay sec / round | P1 held sec / round | P1 cancels / round | P2 lock sec / round | P2 delay sec / round | P2 held sec / round | P2 cancels / round |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const p1 = summary.flow.players.P1;
    const p2 = summary.flow.players.P2;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${p1.combatBoostLockSecondsPerRound.toFixed(2)}s | ${p1.combatBoostDelaySecondsPerRound.toFixed(2)}s | ${p1.combatBoostHeldInputSecondsPerRound.toFixed(2)}s | ${p1.combatBoostCancellationsPerRound.toFixed(2)} | ${p2.combatBoostLockSecondsPerRound.toFixed(2)}s | ${p2.combatBoostDelaySecondsPerRound.toFixed(2)}s | ${p2.combatBoostHeldInputSecondsPerRound.toFixed(2)}s | ${p2.combatBoostCancellationsPerRound.toFixed(2)} |`,
    );
  }

  lines.push(
    '',
    '### Post-Control Decisions',
    '',
    'This table classifies the first simulation-accepted action after control returns. `Return reset` starts at the actual control-return moment; per-action `reset` starts at the first accepted action. Both require a sustained 0.75s exit from pressure within two seconds. `<=1s` counts immediate counter-launches after that action. `Move` records whether the accepted action was accompanied by approach, orbit, retreat, idle, or uncontrollable input; historical samples without that context remain `unavailable`. It is intended to expose controller choices and their consequences, not class strength.',
    '',
    '| P1 | P2 | Difficulty | P1 accepted returns / total | P1 return reset | P1 first-action delay | P1 first-action outcomes | P2 accepted returns / total | P2 return reset | P2 first-action delay | P2 first-action outcomes |',
    '| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |',
  );
  for (const summary of report.summaries) {
    const p1 = summary.flow.players.P1;
    const p2 = summary.flow.players.P2;
    const p1Delay = p1.averageFirstActionDelaySeconds === null
      ? 'N/A'
      : `${p1.averageFirstActionDelaySeconds.toFixed(2)}s`;
    const p2Delay = p2.averageFirstActionDelaySeconds === null
      ? 'N/A'
      : `${p2.averageFirstActionDelaySeconds.toFixed(2)}s`;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${p1.returnsWithAcceptedAction}/${p1.controlReturns} | ${p1.sustainedResetsAfterControlReturn}/${p1.controlReturnsInPressure} | ${p1Delay} | ${formatPostReturnActionMix(p1)} | ${p2.returnsWithAcceptedAction}/${p2.controlReturns} | ${p2.sustainedResetsAfterControlReturn}/${p2.controlReturnsInPressure} | ${p2Delay} | ${formatPostReturnActionMix(p2)} |`,
    );
  }

  lines.push(
    '',
    '### Representative Exchange Sequences',
    '',
    'These deterministic examples make aggregate failures replayable. Unresolved and brief-exit representatives prioritize longest pressure; contact representatives prioritize the highest round contact ratio, then longest pressure.',
    '',
  );
  for (const summary of report.summaries) {
    const label = `\`${summary.difficulty}/${summary.p1}-vs-${summary.p2}\``;
    const representatives = summary.flow.exchanges.representativeSequences;
    const entries = [
      ['worst unresolved', representatives.worstUnresolved],
      ['worst brief exit', representatives.worstBriefExit],
      ['worst contact', representatives.worstContact],
    ] as const;
    for (const [kind, evidence] of entries) {
      lines.push(
        `- ${label} ${kind}: ${evidence ? formatExchangeSequenceEvidence(evidence) : 'none observed.'}`,
      );
    }
  }

  lines.push(
    '',
    '### Representative Timeout Rounds',
    '',
    'For each directed pairing, the timeout representative prioritizes the round with the strongest pressure-band occupancy, then contact, brief exits, and longest pressure. The replay opens on its final twelve seconds so the missing finish or reset can be inspected directly.',
    '',
  );
  for (const summary of report.summaries) {
    const label = `\`${summary.difficulty}/${summary.p1}-vs-${summary.p2}\``;
    lines.push(
      `- ${label}: ${summary.flow.representativeTimeout ? formatTimeoutRoundEvidence(summary.flow.representativeTimeout) : 'no timeout observed.'}`,
    );
  }

  lines.push(
    '',
    '### Local Review Replays',
    '',
  );
  if (report.reviewReplays.length === 0) {
    lines.push(
      'No review files were emitted. Re-run the batch with `--emit-review-replays` to create checksum-verified local replay JSON for flagged loop stages, representative exchanges, and timeout tails.',
    );
  } else {
    lines.push(
      'Open the game menu, choose Replays, then Open Local Replay JSON. The viewer verifies every frame and seeks directly to the flagged stage-evidence tail, exchange, or timeout tail.',
      '',
      ...report.reviewReplays.map((replay) => (
        `- \`${replay.path}\`: ${replay.label}; focus frame ${replay.focusFrame}${replay.endFrame === null ? '' : `-${replay.endFrame}`}; ${replay.frames} total frames.`
      )),
    );
  }

  lines.push(
    '',
    '### Input Acceptance',
    '',
    'Each entry is accepted starts / distinct button requests. Large gaps identify controller churn rather than weak move balance.',
    '',
    '| P1 | P2 | Difficulty | P1 launch / special / dunk / parry / break | P2 launch / special / dunk / parry / break |',
    '| --- | --- | --- | --- | --- |',
  );
  const formatAcceptance = (player: AiMatchupFlowPlayerSummary): string => ([
    ['L', player.actionAcceptance.launch],
    ['S', player.actionAcceptance.special],
    ['D', player.actionAcceptance.dunk],
    ['P', player.actionAcceptance.parry],
    ['B', player.actionAcceptance.launch_break],
  ] as const).map(([label, action]) => (
    `${label} ${action.starts}/${action.presses} (${(action.acceptanceRatio * 100).toFixed(0)}%)`
  )).join('; ');
  for (const summary of report.summaries) {
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${formatAcceptance(summary.flow.players.P1)} | ${formatAcceptance(summary.flow.players.P2)} |`,
    );
  }

  lines.push(
    '',
    '### Action Detail',
    '',
    '| P1 | P2 | Difficulty | Neutral resets / round | Longest pressure avg / p90 | No dunk-start rounds | Launch-hit rounds with no dunk | P1 dunk start avg / p90 / hit | P1 target / separation speed | P1 finish starts / wins / target / separation | P2 dunk start avg / p90 / hit | P2 target / separation speed | P2 finish starts / wins / target / separation | Breaks/round @ reaction P1 / P2 | Tactical types P1 / P2 | Dominant share P1 / P2 | Entropy P1 / P2 | Repeat p90 P1 / P2 | Launch-to-dunk P1 / P2 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const summary of report.summaries) {
    const flow = summary.flow;
    const launchToDunk = `${formatSeconds(flow.players.P1.averageLaunchToDunkSeconds, 'no launch-to-dunk sequence')} / ${formatSeconds(flow.players.P2.averageLaunchToDunkSeconds, 'no launch-to-dunk sequence')}`;
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${flow.neutralResetsPerRound.toFixed(2)} | ${flow.averageLongestPressureSequenceSeconds.toFixed(2)}s / ${flow.p90LongestPressureSequenceSeconds.toFixed(2)}s | ${flow.roundsWithNoDunkStart}/${flow.rounds} | ${flow.roundsWithLaunchHitsButNoDunkStart}/${flow.rounds} | ${flow.players.P1.averageDunkStartDistance.toFixed(2)} / ${flow.players.P1.p90DunkStartDistance.toFixed(2)} / ${flow.players.P1.averageDunkHitDistance.toFixed(2)} | ${flow.players.P1.averageDunkStartTargetSpeed.toFixed(2)} / ${flow.players.P1.averageDunkStartSeparationSpeed.toFixed(2)} | ${flow.players.P1.finishDunkStarts} / ${flow.players.P1.finishDunkWins} / ${flow.players.P1.averageFinishDunkStartTargetSpeed.toFixed(2)} / ${flow.players.P1.averageFinishDunkStartSeparationSpeed.toFixed(2)} | ${flow.players.P2.averageDunkStartDistance.toFixed(2)} / ${flow.players.P2.p90DunkStartDistance.toFixed(2)} / ${flow.players.P2.averageDunkHitDistance.toFixed(2)} | ${flow.players.P2.averageDunkStartTargetSpeed.toFixed(2)} / ${flow.players.P2.averageDunkStartSeparationSpeed.toFixed(2)} | ${flow.players.P2.finishDunkStarts} / ${flow.players.P2.finishDunkWins} / ${flow.players.P2.averageFinishDunkStartTargetSpeed.toFixed(2)} / ${flow.players.P2.averageFinishDunkStartSeparationSpeed.toFixed(2)} | ${flow.players.P1.breakEscapesPerRound.toFixed(2)} @ ${flow.players.P1.averageBreakReactionSeconds.toFixed(2)}s / ${flow.players.P2.breakEscapesPerRound.toFixed(2)} @ ${flow.players.P2.averageBreakReactionSeconds.toFixed(2)}s | ${flow.players.P1.averageAcceptedTacticalActionTypes.toFixed(2)} / ${flow.players.P2.averageAcceptedTacticalActionTypes.toFixed(2)} | ${(flow.players.P1.averageDominantTacticalActionShare * 100).toFixed(1)}% / ${(flow.players.P2.averageDominantTacticalActionShare * 100).toFixed(1)}% | ${flow.players.P1.averageTacticalActionEntropy.toFixed(2)} / ${flow.players.P2.averageTacticalActionEntropy.toFixed(2)} | ${flow.players.P1.p90LongestRepeatedActionStreak.toFixed(0)} (${flow.players.P1.maximumRepeatedAction ?? '--'} x${flow.players.P1.maximumRepeatedActionStreak}) / ${flow.players.P2.p90LongestRepeatedActionStreak.toFixed(0)} (${flow.players.P2.maximumRepeatedAction ?? '--'} x${flow.players.P2.maximumRepeatedActionStreak}) | ${launchToDunk} |`,
    );
  }

  if (report.comparison) {
    lines.push(
      '',
      '## Candidate vs Baseline',
      '',
      `Baseline: \`${basename(report.comparison.baselinePath)}\` (${report.comparison.baselineGeneratedAt})`,
      `Controlled scenario: \`${report.comparison.controlledScenarioFingerprint}\``,
      `Rule-change policy: \`${report.comparison.ruleChangePolicy}\``,
      '',
      '### Effective Rule Changes',
      '',
      '| Scope | Character | Rule | Baseline | Candidate | Delta |',
      '| --- | --- | --- | ---: | ---: | ---: |',
      ...report.comparison.ruleChanges.map((change) => (
        `| \`${change.scope}\` | ${change.characterId ? `\`${change.characterId}\`` : '--'} | \`${change.path}\` | ${change.baselineValue} | ${change.candidateValue} | ${formatSigned(change.delta)} |`
      )),
      '',
    );

    if (report.comparison.designerFlow) {
      const designerFlow = report.comparison.designerFlow;
      const baselinePrimary = designerFlow.baseline.primaryStageId ?? 'none';
      const candidatePrimary = designerFlow.candidate.primaryStageId ?? 'none';
      lines.push(
        '### Gameplay Loop Stage Deltas',
        '',
        `Primary observed bottleneck: baseline **${baselinePrimary}**; candidate **${candidatePrimary}**.`,
        designerFlow.sampleSizesMatch
          ? `Matched aggregate sample: ${designerFlow.candidate.totalRounds} rounds across ${designerFlow.candidate.pairingCount} pairing profiles.`
          : `Sample-size warning: baseline ${designerFlow.baseline.totalRounds} rounds / ${designerFlow.baseline.pairingCount} profiles; candidate ${designerFlow.candidate.totalRounds} rounds / ${designerFlow.candidate.pairingCount} profiles.`,
        '',
        'Negative flagged and priority-index deltas mean fewer diagnosed failures at that stage in this controlled sample. They are not a class score or an automatic keep/revert verdict; inspect the representative replay and low-level causal metrics before deciding.',
        '',
        '| Stage | Baseline blocked / watch / observed / waiting | Candidate blocked / watch / observed / waiting | Blocked delta | Watch delta | Flagged ratio delta | Priority index delta |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      );
      for (const stage of designerFlow.stages) {
        lines.push(
          `| **${stage.label}** | ${stage.baseline.blockedRounds} / ${stage.baseline.watchRounds} / ${stage.baseline.observedRounds} / ${stage.baseline.waitingRounds} | ${stage.candidate.blockedRounds} / ${stage.candidate.watchRounds} / ${stage.candidate.observedRounds} / ${stage.candidate.waitingRounds} | ${formatSigned(stage.delta.blockedRounds)} | ${formatSigned(stage.delta.watchRounds)} | ${formatSigned(stage.delta.issueRatioPoints, 'pp')} | ${formatSigned(stage.delta.priorityIndexPoints, 'pp')} |`,
        );
      }
      lines.push('');
    } else {
      lines.push(
        '### Gameplay Loop Stage Deltas',
        '',
        'Unavailable because the baseline predates the versioned six-stage designer brief. Re-run the baseline with the current local batch tool before accepting the candidate.',
        '',
      );
    }

    lines.push(
      '### Shared Decision Agency Deltas',
      '',
      'Each value is candidate minus baseline. More shared neutral or sustained decision windows can be useful only when exchanges and finishes still progress; less ready-time contact or pressure is not automatically better. N/A means the baseline predates shared-agency telemetry.',
      '',
      '| P1 | P2 | Difficulty | Shared control pp | Steer contact pp | Steer pressure pp | Action-ready pp | Ready / control pp | Ready contact pp | Ready pressure pp | Ready neutral pp | Shared windows / round | Shared neutral p90 sec | Longest ready contact sec |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.sharedControlRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedControlContactRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedControlPressureRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedActionReadyRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedActionReadyShareOfControlPoints, 'pp')} | ${formatSignedOptional(delta.sharedContactRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedPressureRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedNeutralRatioPoints, 'pp')} | ${formatSignedOptional(delta.sharedSustainedNeutralWindowsPerRound)} | ${formatSignedOptional(delta.sharedP90NeutralEpisodeSeconds, 's')} | ${formatSignedOptional(delta.sharedMaximumContactEpisodeSeconds, 's')} |`,
      );
    }
    lines.push('');

    lines.push(
      '### Control-Return Causal Deltas',
      '',
      'Each value is candidate minus baseline from identical return windows. Returner closure share distinguishes the recovering fighter rushing back in from the opponent erasing the gap. Opponent-closed-more and sustained-exit values are percentage-point changes, not automatic quality scores. N/A means either report predates v21 evidence or had no applicable return window.',
      '',
      '| P1 | P2 | Difficulty | Returner closure share P1 / P2 pp | Opponent closed more P1 / P2 pp | Sustained exit P1 / P2 pp | Granted distance P1 / P2 | Maximum distance P1 / P2 |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.p1ReturnerClosingSharePoints, 'pp')} / ${formatSignedOptional(delta.p2ReturnerClosingSharePoints, 'pp')} | ${formatSignedOptional(delta.p1OpponentClosedMoreRatioPoints, 'pp')} / ${formatSignedOptional(delta.p2OpponentClosedMoreRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1SustainedExitRatioPoints, 'pp')} / ${formatSignedOptional(delta.p2SustainedExitRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1ControlGrantedDistance)} / ${formatSignedOptional(delta.p2ControlGrantedDistance)} | ${formatSignedOptional(delta.p1MaximumControlReturnDistance)} / ${formatSignedOptional(delta.p2MaximumControlReturnDistance)} |`,
      );
    }
    lines.push('');

    lines.push(
      '### Tactical Reposition Deltas',
      '',
      'Each value is candidate minus baseline. It describes how much the candidate mechanism was actually selected and how long it occupied the controller; neither sign is an acceptance score. N/A means the baseline predates deterministic reposition counters.',
      '',
      '| P1 | P2 | Difficulty | P1 selections / round | P2 selections / round | P1 active sec / round | P2 active sec / round |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.p1TacticalRepositionSelectionsPerRound)} | ${formatSignedOptional(delta.p2TacticalRepositionSelectionsPerRound)} | ${formatSignedOptional(delta.p1TacticalRepositionSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2TacticalRepositionSecondsPerRound, 's')} |`,
      );
    }
    lines.push('');

    lines.push(
      '### Post-Control Chase Lock Deltas',
      '',
      'Each value is candidate minus baseline. It proves exposure to the zero-default chase-lock mechanism and distinguishes ordinary-Boost suppression from package-declared movement-dash availability; neither sign is an acceptance score. N/A means the baseline predates decision-flow v4 counters.',
      '',
      '| P1 | P2 | Difficulty | P1 windows / round | P2 windows / round | P1 active sec / round | P2 active sec / round | P1 boost-suppressed sec / round | P2 boost-suppressed sec / round | P1 ready-dash sec / round | P2 ready-dash sec / round | P1 consumptions / round | P2 consumptions / round |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.p1PostControlChaseLockWindowsPerRound)} | ${formatSignedOptional(delta.p2PostControlChaseLockWindowsPerRound)} | ${formatSignedOptional(delta.p1PostControlChaseLockSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2PostControlChaseLockSecondsPerRound, 's')} | ${formatSignedOptional(delta.p1PostControlBoostSuppressionSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2PostControlBoostSuppressionSecondsPerRound, 's')} | ${formatSignedOptional(delta.p1PostControlDashSuppressionSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2PostControlDashSuppressionSecondsPerRound, 's')} | ${formatSignedOptional(delta.p1PostControlChaseLockConsumptionsPerRound)} | ${formatSignedOptional(delta.p2PostControlChaseLockConsumptionsPerRound)} |`,
      );
    }
    lines.push('');

    lines.push(
      '### Post-Control Repeat Dash Deltas',
      '',
      'Each value is candidate minus baseline. The columns separate opportunity creation, applied weighting, resolved windows, and actual repeat-dash selections. N/A means the baseline predates decision-flow v5 counters.',
      '',
      '| P1 | P2 | Difficulty | P1 windows / round | P2 windows / round | P1 weighted sec / round | P2 weighted sec / round | P1 consumptions / round | P2 consumptions / round | P1 selections / round | P2 selections / round |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.p1PostControlRepeatDashWindowsPerRound)} | ${formatSignedOptional(delta.p2PostControlRepeatDashWindowsPerRound)} | ${formatSignedOptional(delta.p1PostControlRepeatDashWeightSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2PostControlRepeatDashWeightSecondsPerRound, 's')} | ${formatSignedOptional(delta.p1PostControlRepeatDashConsumptionsPerRound)} | ${formatSignedOptional(delta.p2PostControlRepeatDashConsumptionsPerRound)} | ${formatSignedOptional(delta.p1PostControlRepeatDashSelectionsPerRound)} | ${formatSignedOptional(delta.p2PostControlRepeatDashSelectionsPerRound)} |`,
      );
    }
    lines.push('');

    lines.push(
      '### Combat Boost Commitment Deltas',
      '',
      'Each value is candidate minus baseline. It proves exposure to the zero-default ordinary-boost lock; it is not a quality score. N/A means the report predates decision-flow v3 counters.',
      '',
      '| P1 | P2 | Difficulty | P1 lock sec / round | P2 lock sec / round | P1 delay sec / round | P2 delay sec / round | P1 held sec / round | P2 held sec / round | P1 cancels / round | P2 cancels / round |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.p1CombatBoostLockSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2CombatBoostLockSecondsPerRound, 's')} | ${formatSignedOptional(delta.p1CombatBoostDelaySecondsPerRound, 's')} | ${formatSignedOptional(delta.p2CombatBoostDelaySecondsPerRound, 's')} | ${formatSignedOptional(delta.p1CombatBoostHeldInputSecondsPerRound, 's')} | ${formatSignedOptional(delta.p2CombatBoostHeldInputSecondsPerRound, 's')} | ${formatSignedOptional(delta.p1CombatBoostCancellationsPerRound)} | ${formatSignedOptional(delta.p2CombatBoostCancellationsPerRound)} |`,
      );
    }
    lines.push('');

    lines.push(
      'Every value is candidate minus baseline using identical seeds and AI settings. Negative timeout, physical-contact, point-blank, pressure, brief-exit, unresolved-pressure, helpless, immediate re-launch, no-dunk, repetition, and timing deltas usually indicate a healthier loop; positive reset conversion, post-return reset, resolved-exchange, exchange-reset, neutral-reset, and control-window deltas usually indicate more breathing room. Received-launch frequency, helpless duration per hit, first-action choice, and return-to-relaunch timing must be inspected independently. N/A means either side lacked the required sequence denominator.',
      '',
      '| P1 | P2 | Difficulty | Round sec | Timeout pp | Contact pp | Point blank pp | Pressure pp | Neutral resets / round | Reset conversion pp | Resolved exchange pp | Exchange reset pp | Brief exit pp | Unresolved avg sec | Parry reset pp | Break reset pp | Breaks/round P1 / P2 | Break reaction P1 / P2 sec | Helpless P1 / P2 pp | Launches received / round P1 / P2 | Helpless / hit P1 / P2 sec | Immediate re-launch P1 / P2 pp | Control window P1 / P2 sec | Control-return reset P1 / P2 pp | First-action reset P1 / P2 pp | First action delay P1 / P2 sec | Pressure p90 sec | No dunk pp | Launch/no dunk pp | Dominant action pp | Repeat streak | Launch-to-dunk sec |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSigned(delta.averageRoundSeconds)} | ${formatSigned(delta.timeoutRoundRatioPoints, 'pp')} | ${formatSigned(delta.contactRatioPoints, 'pp')} | ${formatSigned(delta.pointBlankRatioPoints, 'pp')} | ${formatSigned(delta.pressureBandRatioPoints, 'pp')} | ${formatSigned(delta.neutralResetsPerRound)} | ${formatSignedOptional(delta.resetConversionRatioPoints, 'pp')} | ${formatSignedOptional(delta.resolvedExchangeRatioPoints, 'pp')} | ${formatSignedOptional(delta.exchangeResetRatioPoints, 'pp')} | ${formatSignedOptional(delta.briefExitRatioPoints, 'pp')} | ${formatSignedOptional(delta.averageUnresolvedPressureSeconds)} | ${formatSignedOptional(delta.parryResetConversionRatioPoints, 'pp')} | ${formatSignedOptional(delta.launchBreakResetConversionRatioPoints, 'pp')} | ${formatSigned(delta.p1BreakEscapesPerRound)} / ${formatSigned(delta.p2BreakEscapesPerRound)} | ${formatSigned(delta.p1BreakReactionSeconds)} / ${formatSigned(delta.p2BreakReactionSeconds)} | ${formatSigned(delta.p1HelplessRatioPoints, 'pp')} / ${formatSigned(delta.p2HelplessRatioPoints, 'pp')} | ${formatSigned(delta.p1LaunchHitsReceivedPerRound)} / ${formatSigned(delta.p2LaunchHitsReceivedPerRound)} | ${formatSignedOptional(delta.p1HelplessSecondsPerLaunchReceived, 's')} / ${formatSignedOptional(delta.p2HelplessSecondsPerLaunchReceived, 's')} | ${formatSignedOptional(delta.p1ImmediateRelaunchRatioPoints, 'pp')} / ${formatSignedOptional(delta.p2ImmediateRelaunchRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1AverageControlWindowSeconds, 's')} / ${formatSignedOptional(delta.p2AverageControlWindowSeconds, 's')} | ${formatSignedOptional(delta.p1ControlReturnResetRatioPoints, 'pp')} / ${formatSignedOptional(delta.p2ControlReturnResetRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1PostReturnResetRatioPoints, 'pp')} / ${formatSignedOptional(delta.p2PostReturnResetRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1FirstActionDelaySeconds, 's')} / ${formatSignedOptional(delta.p2FirstActionDelaySeconds, 's')} | ${formatSigned(delta.p90PressureSequenceSeconds)} | ${formatSigned(delta.noDunkStartRoundRatioPoints, 'pp')} | ${formatSigned(delta.launchWithoutDunkRoundRatioPoints, 'pp')} | ${formatSigned(delta.dominantTacticalActionSharePoints, 'pp')} | ${formatSigned(delta.repeatedTacticalActionStreak)} | ${formatSignedOptional(delta.launchToDunkSeconds)} |`,
      );
    }

    lines.push(
      '',
      '### Post-Clash Decision Deltas',
      '',
      'Each value is candidate minus baseline. A lower recurrence or rapid-launch ratio can indicate a less repetitive clash loop, but must still be read beside resets, pressure, accepted action mix, and round completion. N/A means one report predates post-clash evidence or had no applicable sequence.',
      '',
      '| P1 | P2 | Difficulty | Recurrence <=1s pp | Rapid launch P1 / P2 pp | First-action delay P1 / P2 sec |',
      '| --- | --- | --- | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| <code>${delta.pairing.p1}</code> | <code>${delta.pairing.p2}</code> | <code>${delta.pairing.difficulty}</code> | ${formatSignedOptional(delta.repeatClashRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1ClashRapidLaunchRecommitRatioPoints, 'pp')} / ${formatSignedOptional(delta.p2ClashRapidLaunchRecommitRatioPoints, 'pp')} | ${formatSignedOptional(delta.p1ClashFirstActionDelaySeconds, 's')} / ${formatSignedOptional(delta.p2ClashFirstActionDelaySeconds, 's')} |`,
      );
    }

    lines.push(
      '',
      '### Neutral Exit Decision Deltas',
      '',
      'Each value is candidate minus baseline. Lower carried brief re-entry means more failed exits included a newly accepted decision; delay is descriptive and must be read beside sustained resets and timeout behavior. N/A means either report predates causal neutral-exit evidence or had no applicable sequence.',
      '',
      '| P1 | P2 | Difficulty | Carried brief re-entry pp | First neutral action delay sec |',
      '| --- | --- | --- | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSignedOptional(delta.carriedBriefExitRatioPoints, 'pp')} | ${formatSignedOptional(delta.neutralFirstActionDelaySeconds, 's')} |`,
      );
    }

    lines.push(
      '',
      '### Cadence Deltas (Context Only)',
      '',
      'Each value is candidate minus baseline. Neither sign is inherently better: negative cadence can indicate more deliberate spacing, but it can also expose inactivity or one tactical action replacing another.',
      '',
      '| P1 | P2 | Difficulty | Launch clashes / round | Launch clashes / min | Accepted combat starts P1 / P2 per round | Accepted combat starts P1 / P2 per min |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    );
    for (const delta of report.comparison.deltas) {
      lines.push(
        `| \`${delta.pairing.p1}\` | \`${delta.pairing.p2}\` | \`${delta.pairing.difficulty}\` | ${formatSigned(delta.launchClashesPerRound)} | ${formatSigned(delta.launchClashesPerMinute)} | ${formatSigned(delta.p1AcceptedCombatActionStartsPerRound)} / ${formatSigned(delta.p2AcceptedCombatActionStartsPerRound)} | ${formatSigned(delta.p1AcceptedCombatActionStartsPerMinute)} / ${formatSigned(delta.p2AcceptedCombatActionStartsPerMinute)} |`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function run(): void {
  const cli = parseArgs(process.argv.slice(2));
  const balanceRules = resolveBatchBalanceRules(cli.profileId, cli.draftPath);
  const ruleSnapshot = createAiBatchRuleSnapshot(
    balanceRules.tuning,
    balanceRules.characterBalanceOverrides,
    balanceRules.aiBehaviorTuning,
  );
  const comparisonPreflight = cli.compareReportPath
    ? prepareBatchComparison(
      ruleSnapshot,
      cli.compareReportPath,
      cli.allowMultiRuleComparison,
    )
    : null;

  const summaries: MatchSummary[] = [];

  for (const difficulty of cli.difficultyIds) {
    for (const pairing of cli.pairings) {
      let p1SetWins = 0;
      let p2SetWins = 0;
      let drawnSets = 0;
      let totalRoundTimeouts = 0;
      let totalFrames = 0;
      let totalRoundsPlayed = 0;
      const seeds: number[] = [];
      const telemetrySummaries: MatchTelemetrySummary[] = [];
      const flowEvidence: AiMatchupRoundEvidence[] = [];

      for (let game = 0; game < cli.gamesPerPairing; game += 1) {
        const setSeed = deriveStableSetSeed(cli.baseSeed, difficulty, pairing.p1, pairing.p2, game);
        seeds.push(setSeed);
        const result = simulateSet(
          pairing.p1,
          pairing.p2,
          difficulty,
          balanceRules,
          setSeed,
          game + 1,
          cli.maxRoundSeconds,
          cli.recoveryPolicyId,
          cli.clashPolicyId,
          cli.pursuitPolicyId,
        );

        totalFrames += result.totalFrames;
        totalRoundsPlayed += result.roundsPlayed;
        totalRoundTimeouts += result.timeoutRounds;
        telemetrySummaries.push(...result.telemetrySummaries);
        flowEvidence.push(...result.flowEvidence);
        if (result.winner === 'P1') {
          p1SetWins += 1;
        } else if (result.winner === 'P2') {
          p2SetWins += 1;
        } else {
          drawnSets += 1;
        }
      }

      const telemetry = aggregateMatchTelemetrySummaries(telemetrySummaries);
      const flow = buildAiMatchupFlowSummary(
        flowEvidence,
        telemetry.ordinaryBoostCounterplay,
      );
      if (flow.timeoutRounds !== totalRoundTimeouts) {
        throw new Error(
          `Flow timeout count mismatch for ${pairing.p1} vs ${pairing.p2}: simulation=${totalRoundTimeouts}, telemetry=${flow.timeoutRounds}.`,
        );
      }
      summaries.push({
        p1: pairing.p1,
        p2: pairing.p2,
        difficulty,
        profileId: cli.profileId,
        games: cli.gamesPerPairing,
        seeds,
        p1SetWins,
        p2SetWins,
        drawnSets,
        totalRoundTimeouts,
        averageSetSeconds: (totalFrames / cli.gamesPerPairing) * FIXED_DT,
        averageRoundsPerSet: totalRoundsPlayed / cli.gamesPerPairing,
        telemetry,
        flow,
      });
    }
  }

  const thresholds = cli.thresholdsPath
    ? readBalanceThresholds(resolve(process.cwd(), cli.thresholdsPath))
    : null;
  const gate = thresholds ? evaluateBalanceGate(summaries, thresholds) : null;
  const designerBrief = buildAiFlowDesignerBrief(summaries.map((summary) => ({
    p1: summary.p1,
    p2: summary.p2,
    difficulty: summary.difficulty,
    rounds: summary.flow.rounds,
    stages: summary.flow.loopStages,
    representatives: summary.flow.loopStageRepresentatives,
  })));

  const report: BatchReport = {
    schemaVersion: 'gw.ai-matchup-batch.v24',
    generatedAt: new Date().toISOString(),
    characterRegistry: {
      schemaVersion: CHARACTER_REGISTRY_SCHEMA_VERSION,
      fingerprint: CHARACTER_REGISTRY_FINGERPRINT,
      packageVersions: { ...CHARACTER_PACKAGE_VERSION_BY_ID },
    },
    options: {
      gamesPerPairing: cli.gamesPerPairing,
      maxRoundSeconds: cli.maxRoundSeconds,
      baseSeed: cli.baseSeed,
      seedStrategy: 'mirrored_common_scenario_v1',
      aiSeedStrategy: 'character_round_stream_v1',
      profileId: cli.profileId,
      draftPath: cli.draftPath,
      difficultyIds: cli.difficultyIds,
      recoveryPolicyId: cli.recoveryPolicyId,
      clashPolicyId: cli.clashPolicyId,
      pursuitPolicyId: cli.pursuitPolicyId,
      characterIds: cli.characterIds,
      pairings: cli.pairings,
      emitReviewReplays: cli.emitReviewReplays,
      allowMultiRuleComparison: cli.allowMultiRuleComparison,
    },
    simulation: {
      fixedDt: FIXED_DT,
      roundsToWin: ROUNDS_TO_WIN,
      maximumRoundsPerSet: MAX_ROUNDS_PER_SET,
      roundSampling: 'fixed_rounds_v1',
      rules: { allowDunkWin: true },
    },
    balanceProfile: {
      requestedId: cli.profileId,
      resolvedId: balanceRules.profileId,
      tuningFingerprint: balanceRules.tuningFingerprint,
      source: balanceRules.source,
      characterBalanceFingerprint: balanceRules.characterBalanceFingerprint,
      effectiveCharacterRulesFingerprint: balanceRules.effectiveCharacterRulesFingerprint,
      aiBehaviorFingerprint: balanceRules.aiBehaviorFingerprint,
      aiBehaviorTuning: balanceRules.aiBehaviorTuning,
      draft: balanceRules.draft,
    },
    aiBaseProfilesFingerprint: buildAiBaseProfilesFingerprint(
      cli.difficultyIds,
      cli.recoveryPolicyId,
      cli.clashPolicyId,
      cli.pursuitPolicyId,
    ),
    aiProfilesFingerprint: buildAiProfilesFingerprint(
      cli.difficultyIds,
      cli.recoveryPolicyId,
      cli.clashPolicyId,
      cli.pursuitPolicyId,
      balanceRules.aiBehaviorTuning,
    ),
    ruleSnapshot,
    summaries,
    designerBrief,
    reviewReplays: [],
    gate,
    comparison: null,
  };

  if (cli.compareReportPath && comparisonPreflight) {
    report.comparison = buildBatchComparison(
      report,
      cli.compareReportPath,
      comparisonPreflight,
    );
  }

  const outputDir = cli.outputDir;
  mkdirSync(outputDir, { recursive: true });
  const failedLoopStageIds = thresholds && gate
    ? (['commitment', 'chase'] as const).filter((stageId) => {
      const maximumIssueRatio = stageId === 'commitment'
        ? thresholds.maximumCommitmentIssueRatio
        : thresholds.maximumChaseIssueRatio;
      const maximumBlockedRatio = stageId === 'commitment'
        ? thresholds.maximumCommitmentBlockedRatio
        : thresholds.maximumChaseBlockedRatio;
      return gate.observed.pairings.some((pairing) => {
        const issueObservation = pairing.loopStageIssues[stageId];
        const blockedObservation = pairing.loopStageBlocked[stageId];
        return (
          issueObservation.qualified
          && issueObservation.ratio !== null
          && issueObservation.ratio > maximumIssueRatio
        ) || (
          blockedObservation.qualified
          && blockedObservation.ratio !== null
          && blockedObservation.ratio > maximumBlockedRatio
        );
      });
    })
    : [];
  if (cli.emitReviewReplays || failedLoopStageIds.length > 0) {
    report.reviewReplays = emitReviewReplayArtifacts(
      report,
      balanceRules,
      outputDir,
      cli.reportName,
      cli.emitReviewReplays
        ? undefined
        : {
          includeGeneralEvidence: false,
          loopStageIds: failedLoopStageIds,
          oneReplayPerLoopStage: true,
        },
    );
  }
  const jsonPath = join(outputDir, `${cli.reportName}.json`);
  const markdownPath = join(outputDir, `${cli.reportName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, formatSummaryMarkdown(report), 'utf8');

  console.info(`[ai-batch] json written ${jsonPath}`);
  console.info(`[ai-batch] markdown written ${markdownPath}`);
  if (report.reviewReplays.length > 0) {
    console.info(`[ai-batch] review replays written ${report.reviewReplays.length}`);
  }
  console.info(
    `[ai-batch] balance ${balanceRules.source} ${balanceRules.draft?.name ?? balanceRules.profileId} ${balanceRules.tuningFingerprint} / ${balanceRules.effectiveCharacterRulesFingerprint}`,
  );
  if (report.designerBrief.primaryStageId) {
    const priority = report.designerBrief.priorities[0];
    console.info(
      `[ai-batch] designer bottleneck ${priority.label}: ${priority.blockedRounds} blocked / ${priority.watchRounds} watch / ${priority.reachedRounds} reached rounds across ${priority.flaggedPairings.length}/${report.designerBrief.pairingCount} pairing profiles`,
    );
  }
  if (report.comparison) {
    console.info(
      `[ai-batch] compared with ${report.comparison.baselinePath} (${report.comparison.controlledScenarioFingerprint}); ${report.comparison.ruleChanges.length} effective rule change(s), ${report.comparison.ruleChangePolicy}`,
    );
  }
  for (const summary of summaries) {
    const loopSummary = BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
      const stage = summary.flow.loopStages[stageId];
      return `${stageId}=${stage.blockedRounds}B/${stage.watchRounds}W/${stage.observedRounds}O/${stage.waitingRounds} waiting`;
    }).join(', ');
    console.info(
      `[ai-batch] ${summary.difficulty} ${summary.p1} vs ${summary.p2} loop => ${loopSummary}`,
    );
    for (const stageId of BALANCE_LAB_LOOP_STAGE_IDS) {
      const evidence = summary.flow.loopStageRepresentatives[stageId];
      if (evidence) {
        console.info(
          `[ai-batch] ${summary.difficulty} ${summary.p1} vs ${summary.p2} loop-${stageId}: ${formatLoopStageEvidence(evidence)}`,
        );
      }
    }
    console.info(
      `[ai-batch] ${summary.difficulty} ${summary.p1} vs ${summary.p2} set outcome (context) => ${summary.p1SetWins}-${summary.p2SetWins} draws=${summary.drawnSets} avgSet=${summary.averageSetSeconds.toFixed(2)}s`,
    );
    const representatives = summary.flow.exchanges.representativeSequences;
    for (const [kind, evidence] of [
      ['worst-unresolved', representatives.worstUnresolved],
      ['worst-brief-exit', representatives.worstBriefExit],
      ['worst-contact', representatives.worstContact],
    ] as const) {
      if (evidence) {
        console.info(
          `[ai-batch] ${summary.difficulty} ${summary.p1} vs ${summary.p2} ${kind}: ${formatExchangeSequenceEvidence(evidence)}`,
        );
      }
    }
    if (summary.flow.representativeTimeout) {
      console.info(
        `[ai-batch] ${summary.difficulty} ${summary.p1} vs ${summary.p2} worst-timeout: ${formatTimeoutRoundEvidence(summary.flow.representativeTimeout)}`,
      );
    }
  }
  if (gate) {
    console.info(`[ai-batch] balance gate ${gate.pass ? 'passed' : 'failed'} (${gate.thresholdId})`);
    for (const issue of gate.issues) {
      console.error(`[ai-batch] ${issue}`);
    }
    if (!gate.pass && !cli.advisoryGate) {
      process.exitCode = 1;
    } else if (!gate.pass) {
      console.warn(
        '[ai-batch] advisory gate remains closed; exact-SHA Safe Rollout still enforces this report.',
      );
    }
  }
}

run();
