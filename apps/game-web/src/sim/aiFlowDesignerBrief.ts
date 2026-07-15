import {
  BALANCE_LAB_LOOP_STAGE_IDS,
  type BalanceLabLoopStageAggregates,
  type BalanceLabLoopStageId,
} from './balanceLab';

export const AI_FLOW_DESIGNER_BRIEF_SCHEMA_VERSION = 'gw.ai-flow-designer-brief.v2';
export const AI_FLOW_DESIGNER_COMPARISON_SCHEMA_VERSION = 'gw.ai-flow-designer-comparison.v1';

const LOOP_STAGE_LABELS: Record<BalanceLabLoopStageId, string> = {
  neutral: 'Neutral',
  commitment: 'Commitment',
  exchange: 'Exchange',
  separation: 'Separation',
  chase: 'Chase',
  finish: 'Finish',
};

export interface AiFlowDesignerBriefRepresentativeInput {
  status: 'watch' | 'blocked';
  detail: string;
  relatedGlobalTuning: readonly string[];
  relatedAiBehavior: readonly string[];
  relatedCharacterControls: readonly string[];
  relatedCharacterTargets: readonly { playerId: string; control: string }[];
}

export interface AiFlowDesignerBriefSummaryInput {
  p1: string;
  p2: string;
  difficulty: string;
  rounds: number;
  stages: BalanceLabLoopStageAggregates;
  representatives: Record<
    BalanceLabLoopStageId,
    AiFlowDesignerBriefRepresentativeInput | null
  >;
}

export interface AiFlowDesignerBriefLever {
  key: string;
  representativeCount: number;
}

export interface AiFlowDesignerBriefRepresentative {
  pairing: string;
  p1: string;
  p2: string;
  difficulty: string;
  status: 'watch' | 'blocked';
  detail: string;
}

export interface AiFlowDesignerStageSummary {
  stageId: BalanceLabLoopStageId;
  label: string;
  blockedRounds: number;
  watchRounds: number;
  observedRounds: number;
  waitingRounds: number;
  reachedRounds: number;
  blockedRatio: number;
  issueRatio: number;
  priorityIndex: number;
}

export interface AiFlowDesignerPriority extends AiFlowDesignerStageSummary {
  rank: number;
  flaggedPairings: string[];
  blockedPairings: string[];
  aiBehaviorLevers: AiFlowDesignerBriefLever[];
  globalTuningLevers: AiFlowDesignerBriefLever[];
  characterControlLevers: AiFlowDesignerBriefLever[];
  representative: AiFlowDesignerBriefRepresentative | null;
}

export interface AiFlowDesignerBrief {
  schemaVersion: typeof AI_FLOW_DESIGNER_BRIEF_SCHEMA_VERSION;
  pairingCount: number;
  totalRounds: number;
  primaryStageId: BalanceLabLoopStageId | null;
  stages: Record<BalanceLabLoopStageId, AiFlowDesignerStageSummary>;
  priorities: AiFlowDesignerPriority[];
}

export interface AiFlowDesignerStageDelta {
  blockedRounds: number;
  watchRounds: number;
  observedRounds: number;
  waitingRounds: number;
  reachedRounds: number;
  blockedRatioPoints: number;
  issueRatioPoints: number;
  priorityIndexPoints: number;
}

export interface AiFlowDesignerStageComparison {
  stageId: BalanceLabLoopStageId;
  label: string;
  baseline: AiFlowDesignerStageSummary;
  candidate: AiFlowDesignerStageSummary;
  delta: AiFlowDesignerStageDelta;
}

export interface AiFlowDesignerBriefComparison {
  schemaVersion: typeof AI_FLOW_DESIGNER_COMPARISON_SCHEMA_VERSION;
  sampleSizesMatch: boolean;
  baseline: {
    pairingCount: number;
    totalRounds: number;
    primaryStageId: BalanceLabLoopStageId | null;
  };
  candidate: {
    pairingCount: number;
    totalRounds: number;
    primaryStageId: BalanceLabLoopStageId | null;
  };
  stages: AiFlowDesignerStageComparison[];
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function pairingLabel(summary: AiFlowDesignerBriefSummaryInput): string {
  return `${summary.difficulty}/${summary.p1}-vs-${summary.p2}`;
}

function countLevers(
  representatives: readonly AiFlowDesignerBriefRepresentativeInput[],
  select: (representative: AiFlowDesignerBriefRepresentativeInput) => readonly string[],
): AiFlowDesignerBriefLever[] {
  const counts = new Map<string, number>();
  for (const representative of representatives) {
    for (const key of new Set(select(representative))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, representativeCount]) => ({ key, representativeCount }))
    .sort((left, right) => (
      right.representativeCount - left.representativeCount
      || left.key.localeCompare(right.key)
    ));
}

function representativePriority(status: 'watch' | 'blocked'): number {
  return status === 'blocked' ? 0 : 1;
}

export function buildAiFlowDesignerBrief(
  summaries: readonly AiFlowDesignerBriefSummaryInput[],
): AiFlowDesignerBrief {
  const stages = {} as Record<BalanceLabLoopStageId, AiFlowDesignerStageSummary>;
  const priorities = BALANCE_LAB_LOOP_STAGE_IDS.flatMap((stageId) => {
    let blockedRounds = 0;
    let watchRounds = 0;
    let observedRounds = 0;
    let waitingRounds = 0;
    const flaggedPairings: string[] = [];
    const blockedPairings: string[] = [];
    const representativeInputs: AiFlowDesignerBriefRepresentativeInput[] = [];
    const representativeCandidates: AiFlowDesignerBriefRepresentative[] = [];

    for (const summary of summaries) {
      const stage = summary.stages[stageId];
      const pairing = pairingLabel(summary);
      blockedRounds += stage.blockedRounds;
      watchRounds += stage.watchRounds;
      observedRounds += stage.observedRounds;
      waitingRounds += stage.waitingRounds;
      if (stage.blockedRounds + stage.watchRounds > 0) {
        flaggedPairings.push(pairing);
      }
      if (stage.blockedRounds > 0) {
        blockedPairings.push(pairing);
      }

      const representative = summary.representatives[stageId];
      if (representative) {
        representativeInputs.push(representative);
        representativeCandidates.push({
          pairing,
          p1: summary.p1,
          p2: summary.p2,
          difficulty: summary.difficulty,
          status: representative.status,
          detail: representative.detail,
        });
      }
    }

    const reachedRounds = blockedRounds + watchRounds + observedRounds;
    const stageSummary: AiFlowDesignerStageSummary = {
      stageId,
      label: LOOP_STAGE_LABELS[stageId],
      blockedRounds,
      watchRounds,
      observedRounds,
      waitingRounds,
      reachedRounds,
      blockedRatio: roundRatio(blockedRounds / Math.max(1, reachedRounds)),
      issueRatio: roundRatio((blockedRounds + watchRounds) / Math.max(1, reachedRounds)),
      priorityIndex: roundRatio(
        (blockedRounds * 2 + watchRounds) / Math.max(1, reachedRounds * 2),
      ),
    };
    stages[stageId] = stageSummary;
    if (blockedRounds + watchRounds === 0) {
      return [];
    }

    const characterControlRepresentatives = representativeInputs.map((representative) => ({
      ...representative,
      relatedCharacterControls: [
        ...representative.relatedCharacterControls,
        ...representative.relatedCharacterTargets.map((target) => `${target.playerId} ${target.control}`),
      ],
    }));
    const representative = representativeCandidates.sort((left, right) => (
      representativePriority(left.status) - representativePriority(right.status)
      || left.pairing.localeCompare(right.pairing)
    ))[0] ?? null;

    return [{
      ...stageSummary,
      rank: 0,
      flaggedPairings: flaggedPairings.sort((left, right) => left.localeCompare(right)),
      blockedPairings: blockedPairings.sort((left, right) => left.localeCompare(right)),
      aiBehaviorLevers: countLevers(
        representativeInputs,
        (entry) => entry.relatedAiBehavior,
      ),
      globalTuningLevers: countLevers(
        representativeInputs,
        (entry) => entry.relatedGlobalTuning,
      ),
      characterControlLevers: countLevers(
        characterControlRepresentatives,
        (entry) => entry.relatedCharacterControls,
      ),
      representative,
    }];
  }).sort((left, right) => (
    right.priorityIndex - left.priorityIndex
    || right.blockedRatio - left.blockedRatio
    || right.issueRatio - left.issueRatio
    || right.blockedRounds - left.blockedRounds
    || right.flaggedPairings.length - left.flaggedPairings.length
    || BALANCE_LAB_LOOP_STAGE_IDS.indexOf(left.stageId)
      - BALANCE_LAB_LOOP_STAGE_IDS.indexOf(right.stageId)
  )).map((priority, index) => ({ ...priority, rank: index + 1 }));

  return {
    schemaVersion: AI_FLOW_DESIGNER_BRIEF_SCHEMA_VERSION,
    pairingCount: summaries.length,
    totalRounds: summaries.reduce((sum, summary) => sum + summary.rounds, 0),
    primaryStageId: priorities[0]?.stageId ?? null,
    stages,
    priorities,
  };
}

function roundPoints(value: number): number {
  return Number((value * 100).toFixed(2));
}

export function compareAiFlowDesignerBriefs(
  baseline: AiFlowDesignerBrief,
  candidate: AiFlowDesignerBrief,
): AiFlowDesignerBriefComparison {
  return {
    schemaVersion: AI_FLOW_DESIGNER_COMPARISON_SCHEMA_VERSION,
    sampleSizesMatch: baseline.pairingCount === candidate.pairingCount
      && baseline.totalRounds === candidate.totalRounds,
    baseline: {
      pairingCount: baseline.pairingCount,
      totalRounds: baseline.totalRounds,
      primaryStageId: baseline.primaryStageId,
    },
    candidate: {
      pairingCount: candidate.pairingCount,
      totalRounds: candidate.totalRounds,
      primaryStageId: candidate.primaryStageId,
    },
    stages: BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
      const baselineStage = baseline.stages[stageId];
      const candidateStage = candidate.stages[stageId];
      return {
        stageId,
        label: LOOP_STAGE_LABELS[stageId],
        baseline: baselineStage,
        candidate: candidateStage,
        delta: {
          blockedRounds: candidateStage.blockedRounds - baselineStage.blockedRounds,
          watchRounds: candidateStage.watchRounds - baselineStage.watchRounds,
          observedRounds: candidateStage.observedRounds - baselineStage.observedRounds,
          waitingRounds: candidateStage.waitingRounds - baselineStage.waitingRounds,
          reachedRounds: candidateStage.reachedRounds - baselineStage.reachedRounds,
          blockedRatioPoints: roundPoints(candidateStage.blockedRatio - baselineStage.blockedRatio),
          issueRatioPoints: roundPoints(candidateStage.issueRatio - baselineStage.issueRatio),
          priorityIndexPoints: roundPoints(
            candidateStage.priorityIndex - baselineStage.priorityIndex,
          ),
        },
      };
    }),
  };
}
