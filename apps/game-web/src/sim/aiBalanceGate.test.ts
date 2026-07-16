import { describe, expect, test } from 'vitest';
import {
  AI_BALANCE_THRESHOLD_SCHEMA_VERSION,
  deriveStableAiSeed,
  deriveStableSetSeed,
  evaluateBalanceGate,
  type AiBalanceMatchSummary,
  type AiBalanceThresholds,
} from './aiBalanceGate';
import { aggregateMatchTelemetrySummaries, createMatchTelemetryTracker } from './matchTelemetry';
import { createInitialState } from './sim';

const thresholds: AiBalanceThresholds = {
  schemaVersion: AI_BALANCE_THRESHOLD_SCHEMA_VERSION,
  id: 'test-gate',
  minimumGamesPerPairing: 3,
  minimumCompletedSetRatio: 0,
  minimumRoundResolutionRatio: 0.5,
  maximumTimeoutRoundRatio: 0.5,
  maximumAverageRoundSeconds: 90,
  maximumContactRatio: 1,
  maximumP90ContactEpisodeSeconds: 90,
  maximumContactEpisodeSeconds: 90,
  maximumPointBlankRatio: 1,
  maximumPressureBandRatio: 1,
  maximumP90PressureSequenceSeconds: 90,
  minimumLoopStageReachedRounds: 12,
  maximumCommitmentIssueRatio: 1,
  maximumChaseIssueRatio: 1,
  maximumCommitmentBlockedRatio: 1,
  maximumChaseBlockedRatio: 1,
  minimumNeutralResetsPerRound: 0,
  minimumResetConversionRatio: 0,
  minimumAverageNeutralWindowSeconds: 0,
  minimumResolvedExchangeRatio: 0,
  minimumExchangeResetRatio: 0,
  maximumBriefExitRatio: 1,
  maximumAverageUnresolvedPressureSeconds: 90,
  minimumRepeatClashOpportunities: 4,
  maximumRepeatClashRatio: 1,
  minimumPostClashLaunchOpportunities: 4,
  maximumRapidPostClashLaunchRatio: 1,
  minimumImmediateRelaunchOpportunities: 4,
  maximumImmediateRelaunchRatio: 1,
  minimumControlReturnResetOpportunities: 4,
  minimumControlReturnResetRatio: 0,
  minimumBriefReentryOpportunities: 4,
  maximumCarriedBriefReentryRatio: 1,
  maximumRoundsWithoutDunkStartRatio: 1,
  maximumLaunchHitRoundsWithoutDunkStartRatio: 1,
  minimumAcceptedActionsPerPlayerPerRound: 0,
  minimumAcceptedTacticalActionTypes: 0,
  maximumAverageDominantTacticalActionShare: 1,
  maximumP90RepeatedTacticalActionStreak: 100,
  minimumSpecialStartsPerPlayerPerRound: 0,
  minimumDunkStartsPerPlayerPerRound: 0,
  minimumFinishDunkStartsPerPlayerPerRound: 0,
  minimumFinishDunkConversionOpportunities: 2,
  minimumFinishDunkConversionRatio: 0,
  minimumAverageLaunchBreakReactionSeconds: 0,
  maximumAverageLaunchToDunkSeconds: 90,
  maximumLaunchConversionRate: 1,
  maximumHelplessRatio: 1,
};

function createSummary(
  p1: 'vanguard' | 'duelist',
  p2: 'vanguard' | 'duelist',
  roundEnds: number,
  timeoutRounds: number,
): AiBalanceMatchSummary {
  const state = createInitialState({ seed: 41, loadout: { P1: p1, P2: p2 } });
  const match = createMatchTelemetryTracker(state).toSummary();
  const telemetry = aggregateMatchTelemetrySummaries([match]);
  telemetry.eventCounts.round_end = roundEnds;
  return {
    p1,
    p2,
    difficulty: 'veteran',
    games: 3,
    p1SetWins: 0,
    p2SetWins: 0,
    drawnSets: 3,
    totalRoundTimeouts: timeoutRounds,
    telemetry,
    flow: {
      rounds: telemetry.rounds,
      timeoutRounds,
      launchClashes: 0,
      clashRepeatOpportunities: 0,
      repeatClashesWithinOneSecond: 0,
      neutralResetsPerRound: 1,
      averageNeutralWindowSeconds: 1,
      averageLongestPressureSequenceSeconds: 0,
      p90LongestPressureSequenceSeconds: 0,
      loopStages: {
        commitment: {
          rounds: 12,
          waitingRounds: 0,
          observedRounds: 12,
          watchRounds: 0,
          blockedRounds: 0,
          waitingRatio: 0,
          issueRatio: 0,
        },
        chase: {
          rounds: 12,
          waitingRounds: 0,
          observedRounds: 12,
          watchRounds: 0,
          blockedRounds: 0,
          waitingRatio: 0,
          issueRatio: 0,
        },
      },
      resetOutcomes: {
        all: { attempts: 1, successes: 1, successRatio: 1 },
      },
      exchanges: {
        total: 4,
        resolvedRatio: 1,
        resetRatio: 1,
        briefExits: 0,
        averageUnresolvedPressureSeconds: 0,
      },
      neutralExitFollowUp: {
        briefExits: 0,
        briefExitsWithoutAcceptedAction: 0,
      },
      roundsWithNoDunkStart: 0,
      roundsWithLaunchHitsButNoDunkStart: 0,
      players: {
        P1: {
          averageAcceptedTacticalActionTypes: 6,
          averageDominantTacticalActionShare: 0.3,
          p90LongestRepeatedActionStreak: 3,
          finishDunkStarts: 1,
          finishDunkWins: 1,
          breakEscapesPerRound: 1,
          averageBreakReactionSeconds: 0.3,
          averageLaunchToDunkSeconds: 2,
          helplessRatio: 0,
          clashRapidLaunchRecommits: 0,
          controlReturns: 0,
          relaunchesWithinOneSecond: 0,
          controlReturnsInPressure: 0,
          sustainedResetsAfterControlReturn: 0,
        },
        P2: {
          averageAcceptedTacticalActionTypes: 6,
          averageDominantTacticalActionShare: 0.3,
          p90LongestRepeatedActionStreak: 3,
          finishDunkStarts: 1,
          finishDunkWins: 1,
          breakEscapesPerRound: 1,
          averageBreakReactionSeconds: 0.3,
          averageLaunchToDunkSeconds: 2,
          helplessRatio: 0,
          clashRapidLaunchRecommits: 0,
          controlReturns: 0,
          relaunchesWithinOneSecond: 0,
          controlReturnsInPressure: 0,
          sustainedResetsAfterControlReturn: 0,
        },
      },
    },
  };
}

describe('AI balance gate', () => {
  test('evaluates every directed pairing instead of allowing aggregate masking', () => {
    const healthy = createSummary('vanguard', 'duelist', 1, 0);
    const dead = createSummary('duelist', 'vanguard', 0, 1);

    const result = evaluateBalanceGate([healthy, dead], thresholds);

    expect(result.pass).toBe(false);
    expect(result.observed.pairings).toHaveLength(2);
    expect(result.issues).toContain(
      'veteran/duelist-vs-vanguard round resolution ratio 0.000 is below 0.5.',
    );
  });

  test('derives stable seeds independent of traversal order', () => {
    const first = deriveStableSetSeed(2026, 'veteran', 'vanguard', 'duelist', 0);
    const repeated = deriveStableSetSeed(2026, 'veteran', 'vanguard', 'duelist', 0);
    const nextGame = deriveStableSetSeed(2026, 'veteran', 'vanguard', 'duelist', 1);
    const mirrored = deriveStableSetSeed(2026, 'veteran', 'duelist', 'vanguard', 0);

    expect(repeated).toBe(first);
    expect(nextGame).not.toBe(first);
    expect(mirrored).toBe(first);
    expect(deriveStableAiSeed(first, 'veteran', 'vanguard', 0)).toBe(
      deriveStableAiSeed(mirrored, 'veteran', 'vanguard', 0),
    );
  });

  test('reports character outcomes without treating AI parity as a flow failure', () => {
    const first = createSummary('vanguard', 'duelist', 1, 0);
    first.p2SetWins = 3;
    first.drawnSets = 0;
    const mirrored = createSummary('duelist', 'vanguard', 1, 0);
    mirrored.p1SetWins = 3;
    mirrored.drawnSets = 0;

    const result = evaluateBalanceGate([first, mirrored], {
      ...thresholds,
      minimumRoundResolutionRatio: 0,
    });

    expect(result.pass).toBe(true);
    expect(result.target).toBe('flow_quality');
    expect(result.observed.characters.duelist.winRate).toBe(1);
  });

  test('reports sparse recurrence evidence without gating unqualified denominators', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.launchClashes = 3;
    summary.flow.clashRepeatOpportunities = 3;
    summary.flow.repeatClashesWithinOneSecond = 3;
    summary.flow.players.P1.clashRapidLaunchRecommits = 3;
    summary.flow.players.P1.controlReturns = 3;
    summary.flow.players.P1.relaunchesWithinOneSecond = 3;
    summary.flow.players.P1.controlReturnsInPressure = 3;
    summary.flow.neutralExitFollowUp = {
      briefExits: 3,
      briefExitsWithoutAcceptedAction: 3,
    };

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumRepeatClashRatio: 0.5,
      maximumRapidPostClashLaunchRatio: 0.5,
      maximumImmediateRelaunchRatio: 0.5,
      minimumControlReturnResetRatio: 0.5,
      maximumCarriedBriefReentryRatio: 0.5,
    });

    expect(result.pass).toBe(true);
    expect(result.observed.pairings[0]?.recurrenceCollapse).toMatchObject({
      repeatClashes: {
        numerator: 3,
        denominator: 3,
        ratio: 1,
        minimumDenominator: 4,
        qualified: false,
      },
      carriedBriefReentry: {
        numerator: 3,
        denominator: 3,
        ratio: 1,
        minimumDenominator: 4,
        qualified: false,
      },
      players: {
        P1: {
          rapidPostClashLaunch: { ratio: 1, qualified: false },
          immediateRelaunch: { ratio: 1, qualified: false },
          controlReturnReset: { ratio: 0, qualified: false },
        },
      },
    });
  });

  test('rejects recurrence collapse once each metric denominator qualifies', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.launchClashes = 4;
    summary.flow.clashRepeatOpportunities = 4;
    summary.flow.repeatClashesWithinOneSecond = 3;
    summary.flow.players.P1.clashRapidLaunchRecommits = 3;
    summary.flow.players.P1.controlReturns = 4;
    summary.flow.players.P1.relaunchesWithinOneSecond = 3;
    summary.flow.players.P1.controlReturnsInPressure = 4;
    summary.flow.players.P1.sustainedResetsAfterControlReturn = 1;
    summary.flow.neutralExitFollowUp = {
      briefExits: 4,
      briefExitsWithoutAcceptedAction: 3,
    };

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumRepeatClashRatio: 0.5,
      maximumRapidPostClashLaunchRatio: 0.5,
      maximumImmediateRelaunchRatio: 0.5,
      minimumControlReturnResetRatio: 0.5,
      maximumCarriedBriefReentryRatio: 0.5,
    });

    expect(result.pass).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'veteran/vanguard-vs-duelist repeat-clash recurrence ratio 0.750 (3/4; qualified minimum 4) exceeds 0.5.',
      'veteran/vanguard-vs-duelist/P1 rapid post-clash launch ratio 0.750 (3/4; qualified minimum 4) exceeds 0.5.',
      'veteran/vanguard-vs-duelist/P1 immediate relaunch ratio 0.750 (3/4; qualified minimum 4) exceeds 0.5.',
      'veteran/vanguard-vs-duelist/P1 control-return reset ratio 0.250 (1/4; qualified minimum 4) is below 0.5.',
      'veteran/vanguard-vs-duelist carried brief re-entry ratio 0.750 (3/4; qualified minimum 4) exceeds 0.5.',
    ]));
    expect(result.issues).toHaveLength(5);
  });

  test('keeps missing launch-to-dunk sequence evidence explicit instead of treating it as zero seconds', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.players.P1.averageLaunchToDunkSeconds = null;

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumAverageLaunchToDunkSeconds: 1,
    });

    expect(result.pass).toBe(false);
    expect(result.observed.pairings[0]?.launchToDunkSeconds).toEqual({
      P1: null,
      P2: 2,
    });
    expect(result.issues).not.toContain(
      'veteran/vanguard-vs-duelist/P1 launch-to-dunk delay 0.00s exceeds 1s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P2 launch-to-dunk delay 2.00s exceeds 1s.',
    );
  });

  test('rejects zero-denominator reset and exchange evidence when ratio guards are active', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.resetOutcomes.all = { attempts: 0, successes: 0, successRatio: 0 };
    summary.flow.exchanges = {
      total: 0,
      resolvedRatio: 0,
      resetRatio: 0,
      briefExits: 0,
      averageUnresolvedPressureSeconds: 0,
    };

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      minimumResetConversionRatio: 0.2,
      minimumResolvedExchangeRatio: 0.6,
      minimumExchangeResetRatio: 0.4,
      maximumBriefExitRatio: 0.5,
    });

    expect(result.pass).toBe(false);
    expect(result.observed.pairings[0]).toMatchObject({
      resetAttempts: 0,
      resetConversionRatio: null,
      exchangeCount: 0,
      resolvedExchangeRatio: null,
      exchangeResetRatio: null,
      briefExitRatio: null,
      averageUnresolvedPressureSeconds: null,
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      'veteran/vanguard-vs-duelist reset conversion is unavailable (0 reset attempts); configured minimum is 0.2.',
      'veteran/vanguard-vs-duelist resolved exchange ratio is unavailable (0 exchanges); configured minimum is 0.6.',
      'veteran/vanguard-vs-duelist exchange reset ratio is unavailable (0 exchanges); configured minimum is 0.4.',
      'veteran/vanguard-vs-duelist brief-exit ratio is unavailable (0 exchanges); configured maximum is 0.5.',
    ]));
  });

  test('rejects stalled or repetitive flow even when aggregate spacing passes', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.p90LongestPressureSequenceSeconds = 24;
    summary.flow.roundsWithLaunchHitsButNoDunkStart = 1;
    summary.flow.players.P1.averageAcceptedTacticalActionTypes = 2;
    summary.flow.players.P1.averageDominantTacticalActionShare = 0.8;
    summary.flow.players.P1.p90LongestRepeatedActionStreak = 12;

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumP90PressureSequenceSeconds: 20,
      maximumLaunchHitRoundsWithoutDunkStartRatio: 0.5,
      minimumAcceptedTacticalActionTypes: 3,
      maximumAverageDominantTacticalActionShare: 0.7,
      maximumP90RepeatedTacticalActionStreak: 10,
    });

    expect(result.pass).toBe(false);
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist p90 pressure sequence 24.00s exceeds 20s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist launch-hit-without-dunk-start round ratio 1.000 exceeds 0.5.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 tactical action variety 2.00 is below 3.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 dominant tactical action share 0.800 exceeds 0.7.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 p90 repeated tactical action streak 12 exceeds 10.',
    );
  });

  test('rejects qualified Commitment and Chase loops without using class outcomes', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.loopStages.commitment = {
      rounds: 20,
      waitingRounds: 0,
      observedRounds: 2,
      watchRounds: 16,
      blockedRounds: 2,
      waitingRatio: 0,
      issueRatio: 0.9,
    };
    summary.flow.loopStages.chase = {
      rounds: 20,
      waitingRounds: 0,
      observedRounds: 0,
      watchRounds: 16,
      blockedRounds: 4,
      waitingRatio: 0,
      issueRatio: 1,
    };

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumCommitmentIssueRatio: 0.75,
      maximumChaseIssueRatio: 0.75,
    });

    expect(result.pass).toBe(false);
    expect(result.observed.pairings[0]?.loopStageIssues).toEqual({
      commitment: {
        numerator: 18,
        denominator: 20,
        ratio: 0.9,
        minimumDenominator: 12,
        qualified: true,
      },
      chase: {
        numerator: 20,
        denominator: 20,
        ratio: 1,
        minimumDenominator: 12,
        qualified: true,
      },
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      'veteran/vanguard-vs-duelist flagged Commitment round ratio 0.900 (18/20; qualified minimum 12) exceeds 0.75.',
      'veteran/vanguard-vs-duelist flagged Chase round ratio 1.000 (20/20; qualified minimum 12) exceeds 0.75.',
    ]));
  });

  test('rejects blocked Commitment and Chase ratios once reached-round evidence qualifies', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.loopStages.commitment = {
      rounds: 12,
      waitingRounds: 0,
      observedRounds: 10,
      watchRounds: 0,
      blockedRounds: 2,
      waitingRatio: 0,
      issueRatio: 0.1667,
    };
    summary.flow.loopStages.chase = {
      rounds: 12,
      waitingRounds: 0,
      observedRounds: 8,
      watchRounds: 0,
      blockedRounds: 4,
      waitingRatio: 0,
      issueRatio: 0.3333,
    };

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumCommitmentBlockedRatio: 0.12,
      maximumChaseBlockedRatio: 0.25,
    });

    expect(result.pass).toBe(false);
    expect(result.observed.pairings[0]?.loopStageBlocked).toEqual({
      commitment: {
        numerator: 2,
        denominator: 12,
        ratio: 0.1667,
        minimumDenominator: 12,
        qualified: true,
      },
      chase: {
        numerator: 4,
        denominator: 12,
        ratio: 0.3333,
        minimumDenominator: 12,
        qualified: true,
      },
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      'veteran/vanguard-vs-duelist blocked Commitment round ratio 0.167 (2/12; qualified minimum 12) exceeds 0.12.',
      'veteran/vanguard-vs-duelist blocked Chase round ratio 0.333 (4/12; qualified minimum 12) exceeds 0.25.',
    ]));
  });

  test('reports sparse loop-stage issues without failing before the evidence minimum', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.loopStages.chase = {
      rounds: 6,
      waitingRounds: 0,
      observedRounds: 0,
      watchRounds: 5,
      blockedRounds: 1,
      waitingRatio: 0,
      issueRatio: 1,
    };

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumChaseIssueRatio: 0.25,
      maximumChaseBlockedRatio: 0.1,
    });

    expect(result.pass).toBe(true);
    expect(result.observed.pairings[0]?.loopStageIssues.chase).toEqual({
      numerator: 6,
      denominator: 6,
      ratio: 1,
      minimumDenominator: 12,
      qualified: false,
    });
    expect(result.observed.pairings[0]?.loopStageBlocked.chase).toEqual({
      numerator: 1,
      denominator: 6,
      ratio: 0.1667,
      minimumDenominator: 12,
      qualified: false,
    });
  });

  test('rejects body-contact lock and failed neutral resets without using win rate', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.telemetry.spacing.contactRatio = 0.42;
    summary.telemetry.spacing.p90ContactEpisodeSeconds = 1.8;
    summary.telemetry.spacing.maximumContactEpisodeSeconds = 3.4;
    summary.flow.neutralResetsPerRound = 0.25;
    summary.flow.resetOutcomes.all = { attempts: 8, successes: 1, successRatio: 0.125 };
    summary.flow.players.P2.helplessRatio = 0.62;

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      maximumContactRatio: 0.3,
      maximumP90ContactEpisodeSeconds: 1.5,
      maximumContactEpisodeSeconds: 3,
      minimumNeutralResetsPerRound: 1,
      minimumResetConversionRatio: 0.2,
      maximumHelplessRatio: 0.5,
    });

    expect(result.pass).toBe(false);
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist physical-contact ratio 0.420 exceeds 0.3.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist p90 contact episode 1.80s exceeds 1.5s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist longest contact episode 3.40s exceeds 3s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist neutral resets per round 0.25 is below 1.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist reset conversion 0.125 is below 0.2.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P2 helpless ratio 0.620 exceeds 0.5.',
    );
  });

  test('rejects fake separation, unresolved exchanges, automatic brakes, and missing finishes', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.averageNeutralWindowSeconds = 0.2;
    summary.flow.exchanges = {
      total: 10,
      resolvedRatio: 0.4,
      resetRatio: 0.2,
      briefExits: 8,
      averageUnresolvedPressureSeconds: 5,
    };
    summary.flow.players.P1.finishDunkStarts = 0;
    summary.flow.players.P1.averageBreakReactionSeconds = 0.04;
    summary.flow.players.P1.averageLaunchToDunkSeconds = 14;

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      minimumAverageNeutralWindowSeconds: 0.5,
      minimumResolvedExchangeRatio: 0.6,
      minimumExchangeResetRatio: 0.4,
      maximumBriefExitRatio: 0.5,
      maximumAverageUnresolvedPressureSeconds: 3,
      minimumFinishDunkStartsPerPlayerPerRound: 0.5,
      minimumAverageLaunchBreakReactionSeconds: 0.1,
      maximumAverageLaunchToDunkSeconds: 10,
    });

    expect(result.pass).toBe(false);
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist average neutral window 0.20s is below 0.5s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist resolved exchange ratio 0.400 is below 0.6.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist exchange reset ratio 0.200 is below 0.4.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist brief-exit ratio 0.800 exceeds 0.5.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist average unresolved pressure 5.00s exceeds 3s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 zero-fuel finish-start rate 0.000 is below 0.5.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 launch-break reaction 0.040s is below 0.1s.',
    );
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 launch-to-dunk delay 14.00s exceeds 10s.',
    );
  });

  test('rejects finish attempts that never convert once the evidence is qualified', () => {
    const summary = createSummary('vanguard', 'duelist', 1, 0);
    summary.flow.players.P1.finishDunkStarts = 4;
    summary.flow.players.P1.finishDunkWins = 0;

    const result = evaluateBalanceGate([summary], {
      ...thresholds,
      minimumFinishDunkConversionOpportunities: 4,
      minimumFinishDunkConversionRatio: 0.2,
    });

    expect(result.pass).toBe(false);
    expect(result.observed.pairings[0]?.finishDunkConversion.P1).toEqual({
      numerator: 0,
      denominator: 4,
      ratio: 0,
      minimumDenominator: 4,
      qualified: true,
    });
    expect(result.observed.pairings[0]?.finishDunkConversion.P2.qualified).toBe(false);
    expect(result.issues).toContain(
      'veteran/vanguard-vs-duelist/P1 zero-fuel finish conversion 0.000 (0/4; qualified minimum 4) is below 0.2.',
    );
  });
});
