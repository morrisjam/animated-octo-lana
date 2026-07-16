import type { AiDifficultyId } from './ai';
import type { BalanceLabLoopStageAggregates } from './balanceLab';
import type { CharacterId } from './characters';
import type { MatchTelemetryAggregateSummary } from './matchTelemetry';

export const AI_BALANCE_THRESHOLD_SCHEMA_VERSION = 'gw.ai-balance-thresholds.v9';

export interface AiBalanceThresholds {
  schemaVersion: typeof AI_BALANCE_THRESHOLD_SCHEMA_VERSION;
  id: string;
  minimumGamesPerPairing: number;
  minimumCompletedSetRatio: number;
  minimumRoundResolutionRatio: number;
  maximumTimeoutRoundRatio: number;
  maximumAverageRoundSeconds: number;
  maximumContactRatio: number;
  maximumP90ContactEpisodeSeconds: number;
  maximumContactEpisodeSeconds: number;
  maximumPointBlankRatio: number;
  maximumPressureBandRatio: number;
  maximumP90PressureSequenceSeconds: number;
  minimumLoopStageReachedRounds: number;
  maximumCommitmentIssueRatio: number;
  maximumChaseIssueRatio: number;
  maximumCommitmentBlockedRatio: number;
  maximumChaseBlockedRatio: number;
  minimumNeutralResetsPerRound: number;
  minimumResetConversionRatio: number;
  minimumAverageNeutralWindowSeconds: number;
  minimumResolvedExchangeRatio: number;
  minimumExchangeResetRatio: number;
  maximumBriefExitRatio: number;
  maximumAverageUnresolvedPressureSeconds: number;
  minimumRepeatClashOpportunities: number;
  maximumRepeatClashRatio: number;
  minimumPostClashLaunchOpportunities: number;
  maximumRapidPostClashLaunchRatio: number;
  minimumImmediateRelaunchOpportunities: number;
  maximumImmediateRelaunchRatio: number;
  minimumControlReturnResetOpportunities: number;
  minimumControlReturnResetRatio: number;
  minimumBriefReentryOpportunities: number;
  maximumCarriedBriefReentryRatio: number;
  maximumRoundsWithoutDunkStartRatio: number;
  maximumLaunchHitRoundsWithoutDunkStartRatio: number;
  minimumAcceptedActionsPerPlayerPerRound: number;
  minimumAcceptedTacticalActionTypes: number;
  maximumAverageDominantTacticalActionShare: number;
  maximumP90RepeatedTacticalActionStreak: number;
  minimumSpecialStartsPerPlayerPerRound: number;
  minimumDunkStartsPerPlayerPerRound: number;
  minimumFinishDunkStartsPerPlayerPerRound: number;
  minimumFinishDunkConversionOpportunities: number;
  minimumFinishDunkConversionRatio: number;
  minimumAverageLaunchBreakReactionSeconds: number;
  maximumAverageLaunchToDunkSeconds: number;
  maximumLaunchConversionRate: number;
  maximumHelplessRatio: number;
}

export interface AiBalanceFlowPlayerSummary {
  averageAcceptedTacticalActionTypes: number;
  averageDominantTacticalActionShare: number;
  p90LongestRepeatedActionStreak: number;
  finishDunkStarts: number;
  finishDunkWins: number;
  breakEscapesPerRound: number;
  averageBreakReactionSeconds: number;
  averageLaunchToDunkSeconds: number | null;
  helplessRatio: number;
  clashRapidLaunchRecommits: number;
  controlReturns: number;
  relaunchesWithinOneSecond: number;
  controlReturnsInPressure: number;
  sustainedResetsAfterControlReturn: number;
}

export interface AiBalanceFlowSummary {
  rounds: number;
  timeoutRounds: number;
  launchClashes: number;
  clashRepeatOpportunities: number;
  repeatClashesWithinOneSecond: number;
  neutralResetsPerRound: number;
  averageNeutralWindowSeconds: number;
  averageLongestPressureSequenceSeconds: number;
  p90LongestPressureSequenceSeconds: number;
  loopStages: Pick<BalanceLabLoopStageAggregates, 'commitment' | 'chase'>;
  resetOutcomes: {
    all: {
      attempts: number;
      successes: number;
      successRatio: number | null;
    };
  };
  exchanges: {
    total: number;
    resolvedRatio: number | null;
    resetRatio: number | null;
    briefExits: number;
    averageUnresolvedPressureSeconds: number | null;
  };
  neutralExitFollowUp: {
    briefExits: number;
    briefExitsWithoutAcceptedAction: number;
  };
  roundsWithNoDunkStart: number;
  roundsWithLaunchHitsButNoDunkStart: number;
  players: {
    P1: AiBalanceFlowPlayerSummary;
    P2: AiBalanceFlowPlayerSummary;
  };
}

export interface AiBalanceMatchSummary {
  p1: CharacterId;
  p2: CharacterId;
  difficulty: AiDifficultyId;
  games: number;
  p1SetWins: number;
  p2SetWins: number;
  drawnSets: number;
  totalRoundTimeouts: number;
  telemetry: MatchTelemetryAggregateSummary;
  flow: AiBalanceFlowSummary;
}

export interface AiBalanceQualifiedRatioObservation {
  numerator: number;
  denominator: number;
  ratio: number | null;
  minimumDenominator: number;
  qualified: boolean;
}

export interface AiBalanceRecurrenceCollapseObservation {
  repeatClashes: AiBalanceQualifiedRatioObservation;
  carriedBriefReentry: AiBalanceQualifiedRatioObservation;
  players: {
    P1: {
      rapidPostClashLaunch: AiBalanceQualifiedRatioObservation;
      immediateRelaunch: AiBalanceQualifiedRatioObservation;
      controlReturnReset: AiBalanceQualifiedRatioObservation;
    };
    P2: {
      rapidPostClashLaunch: AiBalanceQualifiedRatioObservation;
      immediateRelaunch: AiBalanceQualifiedRatioObservation;
      controlReturnReset: AiBalanceQualifiedRatioObservation;
    };
  };
}

export interface AiBalancePairingObservation {
  pairing: string;
  games: number;
  rounds: number;
  completedSetRatio: number;
  roundResolutionRatio: number;
  timeoutRoundRatio: number;
  averageRoundSeconds: number;
  contactRatio: number;
  p90ContactEpisodeSeconds: number;
  maximumContactEpisodeSeconds: number;
  pointBlankRatio: number;
  pressureBandRatio: number;
  p90PressureSequenceSeconds: number;
  loopStageIssues: {
    commitment: AiBalanceQualifiedRatioObservation;
    chase: AiBalanceQualifiedRatioObservation;
  };
  loopStageBlocked: {
    commitment: AiBalanceQualifiedRatioObservation;
    chase: AiBalanceQualifiedRatioObservation;
  };
  neutralResetsPerRound: number;
  resetAttempts: number;
  resetConversionRatio: number | null;
  averageNeutralWindowSeconds: number;
  exchangeCount: number;
  resolvedExchangeRatio: number | null;
  exchangeResetRatio: number | null;
  briefExitRatio: number | null;
  averageUnresolvedPressureSeconds: number | null;
  roundsWithoutDunkStartRatio: number;
  launchHitRoundsWithoutDunkStartRatio: number;
  launchToDunkSeconds: {
    P1: number | null;
    P2: number | null;
  };
  finishDunkConversion: {
    P1: AiBalanceQualifiedRatioObservation;
    P2: AiBalanceQualifiedRatioObservation;
  };
  recurrenceCollapse: AiBalanceRecurrenceCollapseObservation;
}

export interface AiBalanceGateResult {
  target: 'flow_quality';
  thresholdId: string;
  pass: boolean;
  issues: string[];
  observed: {
    pairings: AiBalancePairingObservation[];
    characters: Record<string, {
      setWins: number;
      completedSets: number;
      winRate: number;
    }>;
  };
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function roundNullableMetric(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : roundMetric(value);
}

function qualifiedRatio(
  numerator: number,
  denominator: number,
  minimumDenominator: number,
): AiBalanceQualifiedRatioObservation {
  return {
    numerator,
    denominator,
    ratio: denominator > 0 ? roundMetric(numerator / denominator) : null,
    minimumDenominator,
    qualified: denominator >= minimumDenominator,
  };
}

function addQualifiedMaximumIssue(
  issues: string[],
  label: string,
  metric: string,
  observation: AiBalanceQualifiedRatioObservation,
  maximum: number,
): void {
  if (!observation.qualified || observation.ratio === null || observation.ratio <= maximum) {
    return;
  }
  issues.push(
    `${label} ${metric} ${observation.ratio.toFixed(3)} (${observation.numerator}/${observation.denominator}; qualified minimum ${observation.minimumDenominator}) exceeds ${maximum}.`,
  );
}

function addQualifiedMinimumIssue(
  issues: string[],
  label: string,
  metric: string,
  observation: AiBalanceQualifiedRatioObservation,
  minimum: number,
): void {
  if (!observation.qualified || observation.ratio === null || observation.ratio >= minimum) {
    return;
  }
  issues.push(
    `${label} ${metric} ${observation.ratio.toFixed(3)} (${observation.numerator}/${observation.denominator}; qualified minimum ${observation.minimumDenominator}) is below ${minimum}.`,
  );
}

function pairingLabel(summary: AiBalanceMatchSummary): string {
  return `${summary.difficulty}/${summary.p1}-vs-${summary.p2}`;
}

export function evaluateBalanceGate(
  summaries: readonly AiBalanceMatchSummary[],
  thresholds: AiBalanceThresholds,
): AiBalanceGateResult {
  const issues: string[] = [];
  const pairings: AiBalancePairingObservation[] = [];
  const characterResults = new Map<string, { setWins: number; completedSets: number }>();

  for (const summary of summaries) {
    const telemetry = summary.telemetry;
    const label = pairingLabel(summary);
    const rounds = telemetry.rounds;
    const completedSets = summary.p1SetWins + summary.p2SetWins;
    const p1Results = characterResults.get(summary.p1) ?? { setWins: 0, completedSets: 0 };
    p1Results.setWins += summary.p1SetWins;
    p1Results.completedSets += completedSets;
    characterResults.set(summary.p1, p1Results);
    const p2Results = characterResults.get(summary.p2) ?? { setWins: 0, completedSets: 0 };
    p2Results.setWins += summary.p2SetWins;
    p2Results.completedSets += completedSets;
    characterResults.set(summary.p2, p2Results);
    const recurrencePlayers = Object.fromEntries((['P1', 'P2'] as const).map((playerId) => {
      const player = summary.flow.players[playerId];
      return [playerId, {
        rapidPostClashLaunch: qualifiedRatio(
          player.clashRapidLaunchRecommits,
          summary.flow.launchClashes,
          thresholds.minimumPostClashLaunchOpportunities,
        ),
        immediateRelaunch: qualifiedRatio(
          player.relaunchesWithinOneSecond,
          player.controlReturns,
          thresholds.minimumImmediateRelaunchOpportunities,
        ),
        controlReturnReset: qualifiedRatio(
          player.sustainedResetsAfterControlReturn,
          player.controlReturnsInPressure,
          thresholds.minimumControlReturnResetOpportunities,
        ),
      }];
    })) as AiBalanceRecurrenceCollapseObservation['players'];
    const recurrenceCollapse: AiBalanceRecurrenceCollapseObservation = {
      repeatClashes: qualifiedRatio(
        summary.flow.repeatClashesWithinOneSecond,
        summary.flow.clashRepeatOpportunities,
        thresholds.minimumRepeatClashOpportunities,
      ),
      carriedBriefReentry: qualifiedRatio(
        summary.flow.neutralExitFollowUp.briefExitsWithoutAcceptedAction,
        summary.flow.neutralExitFollowUp.briefExits,
        thresholds.minimumBriefReentryOpportunities,
      ),
      players: recurrencePlayers,
    };
    const loopStageRatios = Object.fromEntries((['commitment', 'chase'] as const).map((stageId) => {
      const stage = summary.flow.loopStages[stageId];
      const reachedRounds = stage.blockedRounds + stage.watchRounds + stage.observedRounds;
      return [stageId, {
        issues: qualifiedRatio(
          stage.blockedRounds + stage.watchRounds,
          reachedRounds,
          thresholds.minimumLoopStageReachedRounds,
        ),
        blocked: qualifiedRatio(
          stage.blockedRounds,
          reachedRounds,
          thresholds.minimumLoopStageReachedRounds,
        ),
      }];
    })) as Record<'commitment' | 'chase', {
      issues: AiBalanceQualifiedRatioObservation;
      blocked: AiBalanceQualifiedRatioObservation;
    }>;
    const loopStageIssues: AiBalancePairingObservation['loopStageIssues'] = {
      commitment: loopStageRatios.commitment.issues,
      chase: loopStageRatios.chase.issues,
    };
    const loopStageBlocked: AiBalancePairingObservation['loopStageBlocked'] = {
      commitment: loopStageRatios.commitment.blocked,
      chase: loopStageRatios.chase.blocked,
    };
    const observation: AiBalancePairingObservation = {
      pairing: label,
      games: summary.games,
      rounds,
      completedSetRatio: roundMetric(completedSets / Math.max(1, summary.games)),
      roundResolutionRatio: roundMetric(telemetry.eventCounts.round_end / Math.max(1, rounds)),
      timeoutRoundRatio: roundMetric(summary.totalRoundTimeouts / Math.max(1, rounds)),
      averageRoundSeconds: roundMetric(telemetry.elapsedSeconds / Math.max(1, rounds)),
      contactRatio: roundMetric(telemetry.spacing.contactRatio),
      p90ContactEpisodeSeconds: roundMetric(telemetry.spacing.p90ContactEpisodeSeconds),
      maximumContactEpisodeSeconds: roundMetric(telemetry.spacing.maximumContactEpisodeSeconds),
      pointBlankRatio: roundMetric(telemetry.spacing.pointBlankRatio),
      pressureBandRatio: roundMetric(telemetry.spacing.pressureBandRatio),
      p90PressureSequenceSeconds: roundMetric(summary.flow.p90LongestPressureSequenceSeconds),
      loopStageIssues,
      loopStageBlocked,
      neutralResetsPerRound: roundMetric(summary.flow.neutralResetsPerRound),
      resetAttempts: summary.flow.resetOutcomes.all.attempts,
      resetConversionRatio: summary.flow.resetOutcomes.all.attempts > 0
        ? roundNullableMetric(summary.flow.resetOutcomes.all.successRatio)
        : null,
      averageNeutralWindowSeconds: roundMetric(summary.flow.averageNeutralWindowSeconds),
      exchangeCount: summary.flow.exchanges.total,
      resolvedExchangeRatio: summary.flow.exchanges.total > 0
        ? roundNullableMetric(summary.flow.exchanges.resolvedRatio)
        : null,
      exchangeResetRatio: summary.flow.exchanges.total > 0
        ? roundNullableMetric(summary.flow.exchanges.resetRatio)
        : null,
      briefExitRatio: summary.flow.exchanges.total > 0
        ? roundMetric(summary.flow.exchanges.briefExits / summary.flow.exchanges.total)
        : null,
      averageUnresolvedPressureSeconds: summary.flow.exchanges.total > 0
        ? roundNullableMetric(summary.flow.exchanges.averageUnresolvedPressureSeconds)
        : null,
      roundsWithoutDunkStartRatio: roundMetric(summary.flow.roundsWithNoDunkStart / Math.max(1, rounds)),
      launchHitRoundsWithoutDunkStartRatio: roundMetric(
        summary.flow.roundsWithLaunchHitsButNoDunkStart / Math.max(1, rounds),
      ),
      launchToDunkSeconds: {
        P1: roundNullableMetric(summary.flow.players.P1.averageLaunchToDunkSeconds),
        P2: roundNullableMetric(summary.flow.players.P2.averageLaunchToDunkSeconds),
      },
      finishDunkConversion: {
        P1: qualifiedRatio(
          summary.flow.players.P1.finishDunkWins,
          summary.flow.players.P1.finishDunkStarts,
          thresholds.minimumFinishDunkConversionOpportunities,
        ),
        P2: qualifiedRatio(
          summary.flow.players.P2.finishDunkWins,
          summary.flow.players.P2.finishDunkStarts,
          thresholds.minimumFinishDunkConversionOpportunities,
        ),
      },
      recurrenceCollapse,
    };
    pairings.push(observation);

    if (summary.games < thresholds.minimumGamesPerPairing) {
      issues.push(`${label} ran ${summary.games} games; minimum is ${thresholds.minimumGamesPerPairing}.`);
    }
    if (observation.completedSetRatio < thresholds.minimumCompletedSetRatio) {
      issues.push(
        `${label} completed-set ratio ${observation.completedSetRatio.toFixed(3)} is below ${thresholds.minimumCompletedSetRatio}.`,
      );
    }
    if (observation.roundResolutionRatio < thresholds.minimumRoundResolutionRatio) {
      issues.push(
        `${label} round resolution ratio ${observation.roundResolutionRatio.toFixed(3)} is below ${thresholds.minimumRoundResolutionRatio}.`,
      );
    }
    if (observation.timeoutRoundRatio > thresholds.maximumTimeoutRoundRatio) {
      issues.push(
        `${label} timeout round ratio ${observation.timeoutRoundRatio.toFixed(3)} exceeds ${thresholds.maximumTimeoutRoundRatio}.`,
      );
    }
    if (observation.averageRoundSeconds > thresholds.maximumAverageRoundSeconds) {
      issues.push(
        `${label} average round duration ${observation.averageRoundSeconds.toFixed(2)}s exceeds ${thresholds.maximumAverageRoundSeconds}s.`,
      );
    }
    if (observation.contactRatio > thresholds.maximumContactRatio) {
      issues.push(
        `${label} physical-contact ratio ${observation.contactRatio.toFixed(3)} exceeds ${thresholds.maximumContactRatio}.`,
      );
    }
    if (observation.p90ContactEpisodeSeconds > thresholds.maximumP90ContactEpisodeSeconds) {
      issues.push(
        `${label} p90 contact episode ${observation.p90ContactEpisodeSeconds.toFixed(2)}s exceeds ${thresholds.maximumP90ContactEpisodeSeconds}s.`,
      );
    }
    if (observation.maximumContactEpisodeSeconds > thresholds.maximumContactEpisodeSeconds) {
      issues.push(
        `${label} longest contact episode ${observation.maximumContactEpisodeSeconds.toFixed(2)}s exceeds ${thresholds.maximumContactEpisodeSeconds}s.`,
      );
    }
    if (observation.pointBlankRatio > thresholds.maximumPointBlankRatio) {
      issues.push(
        `${label} point-blank ratio ${observation.pointBlankRatio.toFixed(3)} exceeds ${thresholds.maximumPointBlankRatio}.`,
      );
    }
    if (observation.pressureBandRatio > thresholds.maximumPressureBandRatio) {
      issues.push(
        `${label} pressure-band ratio ${observation.pressureBandRatio.toFixed(3)} exceeds ${thresholds.maximumPressureBandRatio}.`,
      );
    }
    if (observation.p90PressureSequenceSeconds > thresholds.maximumP90PressureSequenceSeconds) {
      issues.push(
        `${label} p90 pressure sequence ${observation.p90PressureSequenceSeconds.toFixed(2)}s exceeds ${thresholds.maximumP90PressureSequenceSeconds}s.`,
      );
    }
    addQualifiedMaximumIssue(
      issues,
      label,
      'flagged Commitment round ratio',
      observation.loopStageIssues.commitment,
      thresholds.maximumCommitmentIssueRatio,
    );
    addQualifiedMaximumIssue(
      issues,
      label,
      'flagged Chase round ratio',
      observation.loopStageIssues.chase,
      thresholds.maximumChaseIssueRatio,
    );
    addQualifiedMaximumIssue(
      issues,
      label,
      'blocked Commitment round ratio',
      observation.loopStageBlocked.commitment,
      thresholds.maximumCommitmentBlockedRatio,
    );
    addQualifiedMaximumIssue(
      issues,
      label,
      'blocked Chase round ratio',
      observation.loopStageBlocked.chase,
      thresholds.maximumChaseBlockedRatio,
    );
    if (observation.neutralResetsPerRound < thresholds.minimumNeutralResetsPerRound) {
      issues.push(
        `${label} neutral resets per round ${observation.neutralResetsPerRound.toFixed(2)} is below ${thresholds.minimumNeutralResetsPerRound}.`,
      );
    }
    if (observation.resetConversionRatio === null && thresholds.minimumResetConversionRatio > 0) {
      issues.push(
        `${label} reset conversion is unavailable (0 reset attempts); configured minimum is ${thresholds.minimumResetConversionRatio}.`,
      );
    } else if (
      observation.resetConversionRatio !== null
      && observation.resetConversionRatio < thresholds.minimumResetConversionRatio
    ) {
      issues.push(
        `${label} reset conversion ${observation.resetConversionRatio.toFixed(3)} is below ${thresholds.minimumResetConversionRatio}.`,
      );
    }
    if (observation.averageNeutralWindowSeconds < thresholds.minimumAverageNeutralWindowSeconds) {
      issues.push(
        `${label} average neutral window ${observation.averageNeutralWindowSeconds.toFixed(2)}s is below ${thresholds.minimumAverageNeutralWindowSeconds}s.`,
      );
    }
    if (observation.resolvedExchangeRatio === null && thresholds.minimumResolvedExchangeRatio > 0) {
      issues.push(
        `${label} resolved exchange ratio is unavailable (0 exchanges); configured minimum is ${thresholds.minimumResolvedExchangeRatio}.`,
      );
    } else if (
      observation.resolvedExchangeRatio !== null
      && observation.resolvedExchangeRatio < thresholds.minimumResolvedExchangeRatio
    ) {
      issues.push(
        `${label} resolved exchange ratio ${observation.resolvedExchangeRatio.toFixed(3)} is below ${thresholds.minimumResolvedExchangeRatio}.`,
      );
    }
    if (observation.exchangeResetRatio === null && thresholds.minimumExchangeResetRatio > 0) {
      issues.push(
        `${label} exchange reset ratio is unavailable (0 exchanges); configured minimum is ${thresholds.minimumExchangeResetRatio}.`,
      );
    } else if (
      observation.exchangeResetRatio !== null
      && observation.exchangeResetRatio < thresholds.minimumExchangeResetRatio
    ) {
      issues.push(
        `${label} exchange reset ratio ${observation.exchangeResetRatio.toFixed(3)} is below ${thresholds.minimumExchangeResetRatio}.`,
      );
    }
    if (observation.briefExitRatio === null && thresholds.maximumBriefExitRatio < 1) {
      issues.push(
        `${label} brief-exit ratio is unavailable (0 exchanges); configured maximum is ${thresholds.maximumBriefExitRatio}.`,
      );
    } else if (
      observation.briefExitRatio !== null
      && observation.briefExitRatio > thresholds.maximumBriefExitRatio
    ) {
      issues.push(
        `${label} brief-exit ratio ${observation.briefExitRatio.toFixed(3)} exceeds ${thresholds.maximumBriefExitRatio}.`,
      );
    }
    if (
      observation.averageUnresolvedPressureSeconds !== null
      && observation.averageUnresolvedPressureSeconds > thresholds.maximumAverageUnresolvedPressureSeconds
    ) {
      issues.push(
        `${label} average unresolved pressure ${observation.averageUnresolvedPressureSeconds.toFixed(2)}s exceeds ${thresholds.maximumAverageUnresolvedPressureSeconds}s.`,
      );
    }
    addQualifiedMaximumIssue(
      issues,
      label,
      'repeat-clash recurrence ratio',
      observation.recurrenceCollapse.repeatClashes,
      thresholds.maximumRepeatClashRatio,
    );
    for (const playerId of ['P1', 'P2'] as const) {
      const playerLabel = `${label}/${playerId}`;
      const recurrence = observation.recurrenceCollapse.players[playerId];
      addQualifiedMaximumIssue(
        issues,
        playerLabel,
        'rapid post-clash launch ratio',
        recurrence.rapidPostClashLaunch,
        thresholds.maximumRapidPostClashLaunchRatio,
      );
      addQualifiedMaximumIssue(
        issues,
        playerLabel,
        'immediate relaunch ratio',
        recurrence.immediateRelaunch,
        thresholds.maximumImmediateRelaunchRatio,
      );
      addQualifiedMinimumIssue(
        issues,
        playerLabel,
        'control-return reset ratio',
        recurrence.controlReturnReset,
        thresholds.minimumControlReturnResetRatio,
      );
    }
    addQualifiedMaximumIssue(
      issues,
      label,
      'carried brief re-entry ratio',
      observation.recurrenceCollapse.carriedBriefReentry,
      thresholds.maximumCarriedBriefReentryRatio,
    );
    if (observation.roundsWithoutDunkStartRatio > thresholds.maximumRoundsWithoutDunkStartRatio) {
      issues.push(
        `${label} no-dunk-start round ratio ${observation.roundsWithoutDunkStartRatio.toFixed(3)} exceeds ${thresholds.maximumRoundsWithoutDunkStartRatio}.`,
      );
    }
    if (
      observation.launchHitRoundsWithoutDunkStartRatio
      > thresholds.maximumLaunchHitRoundsWithoutDunkStartRatio
    ) {
      issues.push(
        `${label} launch-hit-without-dunk-start round ratio ${observation.launchHitRoundsWithoutDunkStartRatio.toFixed(3)} exceeds ${thresholds.maximumLaunchHitRoundsWithoutDunkStartRatio}.`,
      );
    }

    for (const playerId of ['P1', 'P2'] as const) {
      const player = telemetry.players[playerId];
      const playerLabel = `${label}/${playerId}`;
      const acceptedActionRate = player.acceptedActionStarts / Math.max(1, rounds);
      const specialStartRate = player.specialStarts / Math.max(1, rounds);
      const dunkStartRate = player.dunkStarts / Math.max(1, rounds);
      const tacticalActionTypes = summary.flow.players[playerId].averageAcceptedTacticalActionTypes;
      const dominantTacticalActionShare = summary.flow.players[playerId].averageDominantTacticalActionShare;
      const p90RepeatedTacticalActionStreak = summary.flow.players[playerId].p90LongestRepeatedActionStreak;
      const finishDunkStartRate = summary.flow.players[playerId].finishDunkStarts / Math.max(1, rounds);
      const breakEscapesPerRound = summary.flow.players[playerId].breakEscapesPerRound;
      const averageBreakReactionSeconds = summary.flow.players[playerId].averageBreakReactionSeconds;
      const averageLaunchToDunkSeconds = observation.launchToDunkSeconds[playerId];
      if (acceptedActionRate < thresholds.minimumAcceptedActionsPerPlayerPerRound) {
        issues.push(
          `${playerLabel} accepted-action rate ${acceptedActionRate.toFixed(3)} is below ${thresholds.minimumAcceptedActionsPerPlayerPerRound}.`,
        );
      }
      if (specialStartRate < thresholds.minimumSpecialStartsPerPlayerPerRound) {
        issues.push(
          `${playerLabel} special-start rate ${specialStartRate.toFixed(3)} is below ${thresholds.minimumSpecialStartsPerPlayerPerRound}.`,
        );
      }
      if (tacticalActionTypes < thresholds.minimumAcceptedTacticalActionTypes) {
        issues.push(
          `${playerLabel} tactical action variety ${tacticalActionTypes.toFixed(2)} is below ${thresholds.minimumAcceptedTacticalActionTypes}.`,
        );
      }
      if (dominantTacticalActionShare > thresholds.maximumAverageDominantTacticalActionShare) {
        issues.push(
          `${playerLabel} dominant tactical action share ${dominantTacticalActionShare.toFixed(3)} exceeds ${thresholds.maximumAverageDominantTacticalActionShare}.`,
        );
      }
      if (p90RepeatedTacticalActionStreak > thresholds.maximumP90RepeatedTacticalActionStreak) {
        issues.push(
          `${playerLabel} p90 repeated tactical action streak ${p90RepeatedTacticalActionStreak.toFixed(0)} exceeds ${thresholds.maximumP90RepeatedTacticalActionStreak}.`,
        );
      }
      if (dunkStartRate < thresholds.minimumDunkStartsPerPlayerPerRound) {
        issues.push(
          `${playerLabel} dunk-start rate ${dunkStartRate.toFixed(3)} is below ${thresholds.minimumDunkStartsPerPlayerPerRound}.`,
        );
      }
      if (finishDunkStartRate < thresholds.minimumFinishDunkStartsPerPlayerPerRound) {
        issues.push(
          `${playerLabel} zero-fuel finish-start rate ${finishDunkStartRate.toFixed(3)} is below ${thresholds.minimumFinishDunkStartsPerPlayerPerRound}.`,
        );
      }
      addQualifiedMinimumIssue(
        issues,
        playerLabel,
        'zero-fuel finish conversion',
        observation.finishDunkConversion[playerId],
        thresholds.minimumFinishDunkConversionRatio,
      );
      if (
        breakEscapesPerRound > 0
        && averageBreakReactionSeconds < thresholds.minimumAverageLaunchBreakReactionSeconds
      ) {
        issues.push(
          `${playerLabel} launch-break reaction ${averageBreakReactionSeconds.toFixed(3)}s is below ${thresholds.minimumAverageLaunchBreakReactionSeconds}s.`,
        );
      }
      if (
        averageLaunchToDunkSeconds !== null
        && averageLaunchToDunkSeconds > thresholds.maximumAverageLaunchToDunkSeconds
      ) {
        issues.push(
          `${playerLabel} launch-to-dunk delay ${averageLaunchToDunkSeconds.toFixed(2)}s exceeds ${thresholds.maximumAverageLaunchToDunkSeconds}s.`,
        );
      }
      if (player.launchConversionRate > thresholds.maximumLaunchConversionRate) {
        issues.push(
          `${playerLabel} launch conversion ${player.launchConversionRate.toFixed(3)} exceeds ${thresholds.maximumLaunchConversionRate}.`,
        );
      }
      if (summary.flow.players[playerId].helplessRatio > thresholds.maximumHelplessRatio) {
        issues.push(
          `${playerLabel} helpless ratio ${summary.flow.players[playerId].helplessRatio.toFixed(3)} exceeds ${thresholds.maximumHelplessRatio}.`,
        );
      }
    }
  }

  const characters = Object.fromEntries([...characterResults.entries()].map(([characterId, result]) => {
    const winRate = roundMetric(result.setWins / Math.max(1, result.completedSets));
    return [characterId, { ...result, winRate }];
  }));

  return {
    target: 'flow_quality',
    thresholdId: thresholds.id,
    pass: issues.length === 0,
    issues,
    observed: { pairings, characters },
  };
}

export function deriveStableSetSeed(
  baseSeed: number,
  difficulty: AiDifficultyId,
  p1: CharacterId,
  p2: CharacterId,
  gameIndex: number,
): number {
  const [firstCharacter, secondCharacter] = [p1, p2].sort((first, second) => first.localeCompare(second));
  const value = `${baseSeed >>> 0}|${difficulty}|${firstCharacter}|${secondCharacter}|${gameIndex}`;
  return hashSeed(value);
}

export function deriveStableAiSeed(
  setSeed: number,
  difficulty: AiDifficultyId,
  characterId: CharacterId,
  roundIndex: number,
): number {
  return hashSeed(`${setSeed >>> 0}|${difficulty}|${characterId}|${roundIndex}|ai`);
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
