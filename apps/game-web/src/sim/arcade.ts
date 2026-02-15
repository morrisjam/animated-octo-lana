import type { AiDifficultyId } from './ai';
import type { CharacterId } from './characters';

export interface ArcadeStageDefinition {
  id: string;
  label: string;
  opponentCharacterId: CharacterId;
  aiDifficulty: AiDifficultyId;
  finalEncounter?: boolean;
}

export interface ArcadeRules {
  roundsToWin: number;
  maxContinues: number;
  allowContinueAfterLoss: boolean;
  allowRetryStage: boolean;
}

export interface ArcadeMatchRecord {
  stageId: string;
  stageLabel: string;
  opponentCharacterId: CharacterId;
  finalEncounter: boolean;
  winner: 'P1' | 'P2';
  p1Wins: number;
  p2Wins: number;
  durationSeconds: number;
  result: 'clear' | 'loss';
}

export interface ArcadeRunState {
  stages: ArcadeStageDefinition[];
  rules: ArcadeRules;
  stageIndex: number;
  continuesUsed: number;
  retriesUsed: number;
  startedAtMs: number;
  stageStartedAtMs: number;
  records: ArcadeMatchRecord[];
}

export type ArcadeLossAction = 'continue' | 'retry_stage';

export interface ArcadeRunSummary {
  outcome: 'completed' | 'failed';
  stagesCleared: number;
  totalStages: number;
  continuesUsed: number;
  retriesUsed: number;
  durationSeconds: number;
  finalStageLabel: string | null;
}

export type ArcadeMatchResolution =
  | {
    type: 'advance_stage';
    state: ArcadeRunState;
    clearedStage: ArcadeStageDefinition;
    nextStage: ArcadeStageDefinition;
  }
  | {
    type: 'run_complete';
    state: ArcadeRunState;
    summary: ArcadeRunSummary;
  }
  | {
    type: 'stage_loss';
    state: ArcadeRunState;
    stage: ArcadeStageDefinition;
    allowedActions: ArcadeLossAction[];
  }
  | {
    type: 'run_failed';
    state: ArcadeRunState;
    summary: ArcadeRunSummary;
  };

export const DEFAULT_ARCADE_STAGES: ArcadeStageDefinition[] = [
  {
    id: 'orbital-qualifier',
    label: 'Orbital Qualifier',
    opponentCharacterId: 'duelist',
    aiDifficulty: 'cadet',
  },
  {
    id: 'gravity-semis',
    label: 'Gravity Semifinal',
    opponentCharacterId: 'warden',
    aiDifficulty: 'veteran',
  },
  {
    id: 'core-finals',
    label: 'Core Finals',
    opponentCharacterId: 'vanguard',
    aiDifficulty: 'veteran',
  },
  {
    id: 'well-guardian',
    label: 'Final Encounter: Well Guardian',
    opponentCharacterId: 'ace',
    aiDifficulty: 'ace',
    finalEncounter: true,
  },
];

export const DEFAULT_ARCADE_RULES: ArcadeRules = {
  roundsToWin: 2,
  maxContinues: 2,
  allowContinueAfterLoss: true,
  allowRetryStage: true,
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function sanitiseArcadeRules(rules: ArcadeRules): ArcadeRules {
  return {
    roundsToWin: clampInt(rules.roundsToWin, 1, 5),
    maxContinues: clampInt(rules.maxContinues, 0, 5),
    allowContinueAfterLoss: Boolean(rules.allowContinueAfterLoss),
    allowRetryStage: Boolean(rules.allowRetryStage),
  };
}

export function createArcadeRun(
  options: {
    stages?: ArcadeStageDefinition[];
    rules?: ArcadeRules;
    startedAtMs?: number;
  } = {},
): ArcadeRunState {
  const stages = options.stages && options.stages.length > 0
    ? options.stages.map((stage) => ({ ...stage }))
    : DEFAULT_ARCADE_STAGES.map((stage) => ({ ...stage }));
  const rules = sanitiseArcadeRules(options.rules ?? DEFAULT_ARCADE_RULES);
  const startedAtMs = Number.isFinite(options.startedAtMs) ? (options.startedAtMs as number) : Date.now();

  if (stages.length === 0) {
    throw new Error('Arcade run requires at least one stage.');
  }

  return {
    stages,
    rules,
    stageIndex: 0,
    continuesUsed: 0,
    retriesUsed: 0,
    startedAtMs,
    stageStartedAtMs: startedAtMs,
    records: [],
  };
}

export function getCurrentArcadeStage(state: ArcadeRunState): ArcadeStageDefinition {
  const stage = state.stages[state.stageIndex];
  if (!stage) {
    throw new Error(`Arcade stage index out of bounds: ${state.stageIndex}`);
  }
  return stage;
}

function buildRunSummary(state: ArcadeRunState, outcome: 'completed' | 'failed', completedAtMs: number): ArcadeRunSummary {
  const durationMs = Math.max(0, completedAtMs - state.startedAtMs);
  const lastRecord = state.records[state.records.length - 1] ?? null;
  const stagesCleared = state.records.filter((record) => record.result === 'clear').length;
  return {
    outcome,
    stagesCleared,
    totalStages: state.stages.length,
    continuesUsed: state.continuesUsed,
    retriesUsed: state.retriesUsed,
    durationSeconds: durationMs / 1000,
    finalStageLabel: lastRecord?.stageLabel ?? null,
  };
}

export function resolveArcadeMatch(state: ArcadeRunState, winner: 'P1' | 'P2', p1Wins: number, p2Wins: number, completedAtMs: number): ArcadeMatchResolution {
  const stage = getCurrentArcadeStage(state);
  const durationSeconds = Math.max(0, completedAtMs - state.stageStartedAtMs) / 1000;
  const record: ArcadeMatchRecord = {
    stageId: stage.id,
    stageLabel: stage.label,
    opponentCharacterId: stage.opponentCharacterId,
    finalEncounter: Boolean(stage.finalEncounter),
    winner,
    p1Wins,
    p2Wins,
    durationSeconds,
    result: winner === 'P1' ? 'clear' : 'loss',
  };
  state.records.push(record);

  if (winner === 'P1') {
    const hasNextStage = state.stageIndex + 1 < state.stages.length;
    if (!hasNextStage) {
      return {
        type: 'run_complete',
        state,
        summary: buildRunSummary(state, 'completed', completedAtMs),
      };
    }
    state.stageIndex += 1;
    state.stageStartedAtMs = completedAtMs;
    return {
      type: 'advance_stage',
      state,
      clearedStage: stage,
      nextStage: getCurrentArcadeStage(state),
    };
  }

  const allowedActions: ArcadeLossAction[] = [];
  if (state.rules.allowContinueAfterLoss && state.continuesUsed < state.rules.maxContinues) {
    allowedActions.push('continue');
  }
  if (state.rules.allowRetryStage) {
    allowedActions.push('retry_stage');
  }
  if (allowedActions.length === 0) {
    return {
      type: 'run_failed',
      state,
      summary: buildRunSummary(state, 'failed', completedAtMs),
    };
  }
  return {
    type: 'stage_loss',
    state,
    stage,
    allowedActions,
  };
}

export function applyArcadeLossAction(state: ArcadeRunState, action: ArcadeLossAction, restartedAtMs: number): ArcadeRunState {
  if (action === 'continue') {
    state.continuesUsed += 1;
  } else {
    state.retriesUsed += 1;
  }
  state.stageStartedAtMs = restartedAtMs;
  return state;
}
