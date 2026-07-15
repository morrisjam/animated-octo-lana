import { describe, expect, test } from 'vitest';
import {
  BALANCE_LAB_LOOP_STAGE_IDS,
  type BalanceLabLoopStageAggregates,
  type BalanceLabLoopStageId,
} from './balanceLab';
import {
  AI_FLOW_DESIGNER_BRIEF_SCHEMA_VERSION,
  AI_FLOW_DESIGNER_COMPARISON_SCHEMA_VERSION,
  buildAiFlowDesignerBrief,
  compareAiFlowDesignerBriefs,
  type AiFlowDesignerBriefRepresentativeInput,
  type AiFlowDesignerBriefSummaryInput,
} from './aiFlowDesignerBrief';

function aggregate(
  rounds: number,
  blockedRounds = 0,
  watchRounds = 0,
  waitingRounds = 0,
) {
  const observedRounds = rounds - blockedRounds - watchRounds - waitingRounds;
  const reachedRounds = rounds - waitingRounds;
  return {
    rounds,
    waitingRounds,
    observedRounds,
    watchRounds,
    blockedRounds,
    waitingRatio: waitingRounds / Math.max(1, rounds),
    issueRatio: (blockedRounds + watchRounds) / Math.max(1, reachedRounds),
  };
}

function emptyStages(rounds: number): BalanceLabLoopStageAggregates {
  return Object.fromEntries(
    BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => [stageId, aggregate(rounds)]),
  ) as BalanceLabLoopStageAggregates;
}

function emptyRepresentatives(): Record<
  BalanceLabLoopStageId,
  AiFlowDesignerBriefRepresentativeInput | null
> {
  return Object.fromEntries(
    BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => [stageId, null]),
  ) as Record<BalanceLabLoopStageId, AiFlowDesignerBriefRepresentativeInput | null>;
}

function representative(
  status: 'watch' | 'blocked',
  detail: string,
  aiBehavior: string[] = [],
): AiFlowDesignerBriefRepresentativeInput {
  return {
    status,
    detail,
    relatedGlobalTuning: ['closeRangeSeparationImpulse'],
    relatedAiBehavior: aiBehavior,
    relatedCharacterControls: ['movement'],
    relatedCharacterTargets: [{ playerId: 'P2', control: 'launch_break' }],
  };
}

function summary(
  difficulty: string,
  p1: string,
  p2: string,
  rounds: number,
): AiFlowDesignerBriefSummaryInput {
  return {
    difficulty,
    p1,
    p2,
    rounds,
    stages: emptyStages(rounds),
    representatives: emptyRepresentatives(),
  };
}

describe('AI flow designer brief', () => {
  test('ranks the shared blocked loop stage without receiving outcome data', () => {
    const first = summary('cadet', 'vanguard', 'duelist', 10);
    first.stages.commitment = aggregate(10, 0, 8);
    first.representatives.commitment = representative('watch', 'Commitments repeat.', ['launchWeightScale']);
    first.stages.chase = aggregate(10, 1, 7);
    first.representatives.chase = representative('blocked', 'Control returns become launches.', ['neutralApproachScale']);
    const second = summary('cadet', 'duelist', 'vanguard', 10);
    second.stages.chase = aggregate(10, 1, 8);
    second.representatives.chase = representative('blocked', 'Chase never creates agency.', ['neutralApproachScale']);

    const brief = buildAiFlowDesignerBrief([first, second]);

    expect(AI_FLOW_DESIGNER_BRIEF_SCHEMA_VERSION).toBe('gw.ai-flow-designer-brief.v2');
    expect(brief.schemaVersion).toBe(AI_FLOW_DESIGNER_BRIEF_SCHEMA_VERSION);
    expect(brief.totalRounds).toBe(20);
    expect(brief.primaryStageId).toBe('chase');
    expect(brief.priorities[0]).toMatchObject({
      rank: 1,
      stageId: 'chase',
      blockedRounds: 2,
      watchRounds: 15,
      reachedRounds: 20,
      issueRatio: 0.85,
      blockedRatio: 0.1,
      priorityIndex: 0.475,
      representative: {
        status: 'blocked',
        pairing: 'cadet/duelist-vs-vanguard',
      },
    });
    expect(brief.priorities[0].aiBehaviorLevers).toEqual([
      { key: 'neutralApproachScale', representativeCount: 2 },
    ]);
    expect(brief.stages.chase).toMatchObject({
      blockedRounds: 2,
      watchRounds: 15,
      observedRounds: 3,
      reachedRounds: 20,
    });
  });

  test('keeps waiting rounds out of the reached-stage issue ratio', () => {
    const input = summary('veteran', 'vanguard', 'duelist', 10);
    input.stages.finish = aggregate(10, 0, 2, 8);
    input.representatives.finish = representative('watch', 'Finish was reached twice and failed.');

    const priority = buildAiFlowDesignerBrief([input]).priorities[0];

    expect(priority).toMatchObject({
      stageId: 'finish',
      watchRounds: 2,
      waitingRounds: 8,
      reachedRounds: 2,
      issueRatio: 1,
      priorityIndex: 0.5,
    });
  });

  test('deduplicates levers within a representative and keeps stable stage ordering', () => {
    const input = summary('veteran', 'vanguard', 'duelist', 4);
    input.stages.neutral = aggregate(4, 0, 1);
    input.stages.commitment = aggregate(4, 0, 1);
    input.representatives.neutral = representative(
      'watch',
      'Neutral repeats.',
      ['neutralApproachScale', 'neutralApproachScale'],
    );
    input.representatives.commitment = representative('watch', 'Commitment repeats.');

    const brief = buildAiFlowDesignerBrief([input]);

    expect(brief.priorities.map((entry) => entry.stageId)).toEqual(['neutral', 'commitment']);
    expect(brief.priorities[0].aiBehaviorLevers).toEqual([
      { key: 'neutralApproachScale', representativeCount: 1 },
    ]);
    expect(brief.priorities[0].characterControlLevers).toEqual([
      { key: 'movement', representativeCount: 1 },
      { key: 'P2 launch_break', representativeCount: 1 },
    ]);
  });

  test('returns no bottleneck when every reached stage is observed', () => {
    const brief = buildAiFlowDesignerBrief([
      summary('cadet', 'vanguard', 'duelist', 6),
    ]);

    expect(brief.primaryStageId).toBeNull();
    expect(brief.priorities).toEqual([]);
    expect(brief.stages.finish).toMatchObject({
      observedRounds: 6,
      reachedRounds: 6,
      issueRatio: 0,
    });
  });

  test('compares every gameplay-loop stage without using match outcomes', () => {
    const baselineInput = summary('veteran', 'vanguard', 'duelist', 10);
    baselineInput.stages.separation = aggregate(10, 3, 3, 0);
    baselineInput.stages.chase = aggregate(10, 3, 5, 0);
    baselineInput.representatives.separation = representative('blocked', 'Resets collapse.');
    baselineInput.representatives.chase = representative('blocked', 'Control returns are re-launched.');
    const candidateInput = summary('veteran', 'vanguard', 'duelist', 10);
    candidateInput.stages.separation = aggregate(10, 1, 2, 0);
    candidateInput.stages.chase = aggregate(10, 1, 4, 0);
    candidateInput.representatives.separation = representative('blocked', 'Some resets collapse.');
    candidateInput.representatives.chase = representative('blocked', 'Some returns are re-launched.');

    const comparison = compareAiFlowDesignerBriefs(
      buildAiFlowDesignerBrief([baselineInput]),
      buildAiFlowDesignerBrief([candidateInput]),
    );

    expect(comparison.schemaVersion).toBe(AI_FLOW_DESIGNER_COMPARISON_SCHEMA_VERSION);
    expect(comparison.sampleSizesMatch).toBe(true);
    expect(comparison.baseline.primaryStageId).toBe('chase');
    expect(comparison.candidate.primaryStageId).toBe('chase');
    expect(comparison.stages.find((stage) => stage.stageId === 'separation')).toMatchObject({
      delta: {
        blockedRounds: -2,
        watchRounds: -1,
        observedRounds: 3,
        issueRatioPoints: -30,
        priorityIndexPoints: -25,
      },
    });
    expect(comparison.stages.find((stage) => stage.stageId === 'chase')).toMatchObject({
      delta: {
        blockedRounds: -2,
        watchRounds: -1,
        observedRounds: 3,
        issueRatioPoints: -30,
        priorityIndexPoints: -25,
      },
    });
  });
});
