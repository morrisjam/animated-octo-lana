import {
  createAiController,
  createDefaultAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  tickAiController,
  type AiClashPolicyId,
  type AiBehaviorTuning,
  type AiDifficultyId,
  type AiDecisionTrace,
  type AiTickResult,
  type AiPursuitPolicyId,
  type AiRecoveryPolicyId,
} from './ai';
import { createDefaultAiControllerRoles } from './aiControllerRoles';
import { deriveStableAiSeed } from './aiBalanceGate';
import { createAiDecisionTelemetryTracker } from './aiDecisionTelemetry';
import type { CharacterId } from './characters';
import type { CharacterBalanceOverrides } from './characterBalance';
import { computeStateChecksum } from './checksum';
import {
  createMatchTelemetryTracker,
  type MatchTelemetrySummary,
} from './matchTelemetry';
import {
  createReplayAiDecisionTrace,
  LOCAL_AI_REPLAY_SCHEMA_VERSION,
  REPLAY_PAYLOAD_VERSION,
  type ReplayAiDecisionTrace,
  type ReplayPayload,
  type ReplayReviewFocus,
} from './replay';
import { deriveOfflineRoundSeed } from './offlineRoundSeed';
import {
  createInitialState,
  step,
  type SimulationActionStart,
  type SimulationCombatBoostLockFrame,
  type SimulationControlReturnReset,
  type SimulationLaunchClash,
} from './sim';
import type { FrameInput, GameRules, GameTuning, PlayerId, PlayersById } from './types';

export const AI_ROUND_FIXED_DT = 1 / 60;
export const AI_ROUND_DECISION_FLOW_SCHEMA_VERSION = 'gw.ai-round-decision-flow.v5';

export interface AiRoundDecisionFlowPlayerSummary {
  tacticalRepositionOpportunityFrames: number;
  tacticalRepositionOpportunityWindows: number;
  tacticalRepositionSelections: number;
  tacticalRepositionFrames: number;
  postControlCounterstepWindows: number;
  postControlCounterstepFrames: number;
  postControlChaseLockWindows: number;
  postControlChaseLockFrames: number;
  postControlBoostSuppressionFrames: number;
  postControlDashSuppressionFrames: number;
  postControlChaseLockConsumptions: number;
  postControlRepeatDashWindows: number;
  postControlRepeatDashWeightFrames: number;
  postControlRepeatDashConsumptions: number;
  postControlRepeatDashSelections: number;
  combatBoostLockFrames: number;
  combatBoostDelayFrames: number;
  combatBoostHeldInputFrames: number;
  combatBoostCancellations: number;
}

export interface AiRoundDecisionFlowSummary {
  schemaVersion: typeof AI_ROUND_DECISION_FLOW_SCHEMA_VERSION;
  players: PlayersById<AiRoundDecisionFlowPlayerSummary>;
}

export interface AiRoundSimulationOptions {
  p1: CharacterId;
  p2: CharacterId;
  difficulty: AiDifficultyId;
  recoveryPolicyId?: AiRecoveryPolicyId;
  clashPolicyId?: AiClashPolicyId;
  pursuitPolicyId?: AiPursuitPolicyId;
  behaviorTuning?: AiBehaviorTuning;
  setSeed: number;
  roundIndex: number;
  maxFrames: number;
  fixedDt?: number;
  rules?: GameRules;
  tuning?: GameTuning;
  characterBalanceOverrides?: CharacterBalanceOverrides;
  captureReplay?: boolean;
}

export interface AiRoundSimulationResult {
  roundSeed: number;
  winner: PlayerId | null;
  framesSimulated: number;
  telemetry: MatchTelemetrySummary;
  decisionFlow: AiRoundDecisionFlowSummary;
  rules: GameRules;
  tuning: GameTuning;
  characterBalanceOverrides: CharacterBalanceOverrides;
  inputTimeline?: FrameInput[];
  expectedChecksums?: number[];
  aiDecisionTrace?: ReplayAiDecisionTrace;
}

export interface CreateAiRoundReplayOptions extends AiRoundSimulationOptions {
  rulesetVersion: string;
  simBuildHash: string;
  reviewFocus: Omit<ReplayReviewFocus, 'schemaVersion'>;
}

export interface AiRoundReplayResult {
  simulation: AiRoundSimulationResult;
  payload: ReplayPayload;
}

function clampFrame(value: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function createDecisionFlowPlayerSummary(): AiRoundDecisionFlowPlayerSummary {
  return {
    tacticalRepositionOpportunityFrames: 0,
    tacticalRepositionOpportunityWindows: 0,
    tacticalRepositionSelections: 0,
    tacticalRepositionFrames: 0,
    postControlCounterstepWindows: 0,
    postControlCounterstepFrames: 0,
    postControlChaseLockWindows: 0,
    postControlChaseLockFrames: 0,
    postControlBoostSuppressionFrames: 0,
    postControlDashSuppressionFrames: 0,
    postControlChaseLockConsumptions: 0,
    postControlRepeatDashWindows: 0,
    postControlRepeatDashWeightFrames: 0,
    postControlRepeatDashConsumptions: 0,
    postControlRepeatDashSelections: 0,
    combatBoostLockFrames: 0,
    combatBoostDelayFrames: 0,
    combatBoostHeldInputFrames: 0,
    combatBoostCancellations: 0,
  };
}

function recordCombatBoostLocks(
  summary: AiRoundDecisionFlowSummary,
  events: readonly SimulationCombatBoostLockFrame[],
): void {
  for (const event of events) {
    const player = summary.players[event.playerId];
    player.combatBoostLockFrames += 1;
    if (event.phase === 'delay') {
      player.combatBoostDelayFrames += 1;
    }
    if (event.inputHeld) {
      player.combatBoostHeldInputFrames += 1;
    }
    if (event.cancelledActiveBoost) {
      player.combatBoostCancellations += 1;
    }
  }
}

function recordDecisionFlow(
  summary: AiRoundDecisionFlowSummary,
  previousRepositionEligibility: PlayersById<boolean>,
  previousCounterstepActive: PlayersById<boolean>,
  previousChaseLockActive: PlayersById<boolean>,
  previousRepeatDashPending: PlayersById<boolean>,
  playerId: PlayerId,
  decision: AiDecisionTrace,
  diagnostics: AiTickResult['diagnostics'],
): void {
  const player = summary.players[playerId];
  const repositionEligible = decision.candidates.reposition.eligible;
  if (repositionEligible) {
    player.tacticalRepositionOpportunityFrames += 1;
    if (!previousRepositionEligibility[playerId]) {
      player.tacticalRepositionOpportunityWindows += 1;
    }
  }
  if (decision.selectedReason === 'weighted_reposition_choice') {
    player.tacticalRepositionSelections += 1;
  }
  if (decision.movementIntent === 'tactical_reposition') {
    player.tacticalRepositionFrames += 1;
  }
  const counterstepActive = decision.movementIntent === 'post_control_counterstep';
  if (counterstepActive) {
    player.postControlCounterstepFrames += 1;
    if (!previousCounterstepActive[playerId]) {
      player.postControlCounterstepWindows += 1;
    }
  }
  if (diagnostics.postControlChaseLockActive) {
    player.postControlChaseLockFrames += 1;
    if (!previousChaseLockActive[playerId]) {
      player.postControlChaseLockWindows += 1;
    }
  }
  if (diagnostics.postControlBoostSuppressed) {
    player.postControlBoostSuppressionFrames += 1;
  }
  if (diagnostics.postControlDashSuppressed) {
    player.postControlDashSuppressionFrames += 1;
  }
  if (diagnostics.postControlChaseLockConsumed) {
    player.postControlChaseLockConsumptions += 1;
  }
  if (
    diagnostics.postControlRepeatDashPending
    && !previousRepeatDashPending[playerId]
  ) {
    player.postControlRepeatDashWindows += 1;
  }
  if (diagnostics.postControlRepeatDashWeightApplied) {
    player.postControlRepeatDashWeightFrames += 1;
  }
  if (diagnostics.postControlRepeatDashConsumed) {
    player.postControlRepeatDashConsumptions += 1;
  }
  if (diagnostics.postControlRepeatDashSelected) {
    player.postControlRepeatDashSelections += 1;
  }
  previousRepositionEligibility[playerId] = repositionEligible;
  previousCounterstepActive[playerId] = counterstepActive;
  previousChaseLockActive[playerId] = diagnostics.postControlChaseLockActive;
  previousRepeatDashPending[playerId] = diagnostics.postControlRepeatDashPending;
}

export function simulateAiRound(options: AiRoundSimulationOptions): AiRoundSimulationResult {
  const setSeed = options.setSeed >>> 0;
  const roundIndex = Math.max(0, Math.floor(options.roundIndex));
  const roundSeed = deriveOfflineRoundSeed(setSeed, roundIndex);
  const maxFrames = Math.max(1, Math.floor(options.maxFrames));
  const fixedDt = Number.isFinite(options.fixedDt) && (options.fixedDt as number) > 0
    ? Number(options.fixedDt)
    : AI_ROUND_FIXED_DT;
  const state = createInitialState({
    loadout: { P1: options.p1, P2: options.p2 },
    seed: roundSeed,
    rules: options.rules ?? { allowDunkWin: true },
    characterBalanceOverrides: options.characterBalanceOverrides,
  });
  if (options.tuning) {
    state.tuning = { ...options.tuning };
  }
  const telemetry = createMatchTelemetryTracker(state);
  const inputTimeline = options.captureReplay ? [] as FrameInput[] : undefined;
  const expectedChecksums = options.captureReplay ? [] as number[] : undefined;
  const aiDecisionTelemetry = options.captureReplay
    ? createAiDecisionTelemetryTracker({ maxEvents: Number.MAX_SAFE_INTEGER })
    : undefined;
  const decisionFlow: AiRoundDecisionFlowSummary = {
    schemaVersion: AI_ROUND_DECISION_FLOW_SCHEMA_VERSION,
    players: {
      P1: createDecisionFlowPlayerSummary(),
      P2: createDecisionFlowPlayerSummary(),
    },
  };
  const previousRepositionEligibility: PlayersById<boolean> = { P1: false, P2: false };
  const previousCounterstepActive: PlayersById<boolean> = { P1: false, P2: false };
  const previousChaseLockActive: PlayersById<boolean> = { P1: false, P2: false };
  const previousRepeatDashPending: PlayersById<boolean> = { P1: false, P2: false };

  let p1Controller = createAiController({
    seed: deriveStableAiSeed(setSeed, options.difficulty, options.p1, roundIndex),
    profileId: options.difficulty,
    recoveryPolicyId: options.recoveryPolicyId,
    clashPolicyId: options.clashPolicyId,
    pursuitPolicyId: options.pursuitPolicyId,
    behaviorTuning: options.behaviorTuning,
  });
  let p2Controller = createAiController({
    seed: deriveStableAiSeed(setSeed, options.difficulty, options.p2, roundIndex),
    profileId: options.difficulty,
    recoveryPolicyId: options.recoveryPolicyId,
    clashPolicyId: options.clashPolicyId,
    pursuitPolicyId: options.pursuitPolicyId,
    behaviorTuning: options.behaviorTuning,
  });

  for (let frame = 0; frame < maxFrames; frame += 1) {
    const p1AiTick = tickAiController(state, 'P1', p1Controller);
    p1Controller = p1AiTick.next;
    const p2AiTick = tickAiController(state, 'P2', p2Controller);
    p2Controller = p2AiTick.next;
    recordDecisionFlow(
      decisionFlow,
      previousRepositionEligibility,
      previousCounterstepActive,
      previousChaseLockActive,
      previousRepeatDashPending,
      'P1',
      p1AiTick.decision,
      p1AiTick.diagnostics,
    );
    recordDecisionFlow(
      decisionFlow,
      previousRepositionEligibility,
      previousCounterstepActive,
      previousChaseLockActive,
      previousRepeatDashPending,
      'P2',
      p2AiTick.decision,
      p2AiTick.diagnostics,
    );
    const frameInput: FrameInput = {
      p1: { ...p1AiTick.input },
      p2: { ...p2AiTick.input },
    };
    const acceptedActionStarts: SimulationActionStart[] = [];
    const launchClashes: SimulationLaunchClash[] = [];
    const combatBoostLocks: SimulationCombatBoostLockFrame[] = [];
    const controlReturnResets: SimulationControlReturnReset[] = [];
    step(state, frameInput, fixedDt, {
      onActionStart: (event) => acceptedActionStarts.push(event),
      onLaunchClash: (event) => launchClashes.push(event),
      onCombatBoostLockFrame: (event) => combatBoostLocks.push(event),
      onControlReturnReset: (event) => controlReturnResets.push(event),
    });
    recordCombatBoostLocks(decisionFlow, combatBoostLocks);
    aiDecisionTelemetry?.recordFrame(frame, {
      P1: p1AiTick.decision,
      P2: p2AiTick.decision,
    });
    telemetry.recordFrame(
      frameInput,
      state,
      fixedDt,
      acceptedActionStarts,
      launchClashes,
      controlReturnResets,
    );
    inputTimeline?.push(frameInput);
    expectedChecksums?.push(computeStateChecksum(state));
    if (state.winner) {
      break;
    }
  }

  const telemetrySummary = telemetry.toSummary();
  return {
    roundSeed,
    winner: state.winner,
    framesSimulated: telemetrySummary.framesSimulated,
    telemetry: telemetrySummary,
    decisionFlow,
    rules: { ...state.rules },
    tuning: { ...state.tuning },
    characterBalanceOverrides: state.characterBalanceOverrides,
    inputTimeline,
    expectedChecksums,
    aiDecisionTrace: aiDecisionTelemetry
      ? createReplayAiDecisionTrace(aiDecisionTelemetry.toSummary().events)
      : undefined,
  };
}

export function createAiRoundReplay(options: CreateAiRoundReplayOptions): AiRoundReplayResult {
  const simulation = simulateAiRound({
    ...options,
    captureReplay: true,
  });
  const inputTimeline = simulation.inputTimeline ?? [];
  const finalFrame = Math.max(0, inputTimeline.length - 1);
  const focusFrame = clampFrame(options.reviewFocus.focusFrame, finalFrame);
  const requestedEndFrame = options.reviewFocus.endFrame;
  const endFrame = requestedEndFrame === undefined
    ? undefined
    : Math.max(focusFrame, clampFrame(requestedEndFrame, finalFrame));
  const aiDecisionTrace = simulation.aiDecisionTrace
    ? createReplayAiDecisionTrace(simulation.aiDecisionTrace.events)
    : undefined;

  return {
    simulation,
    payload: {
      header: {
        payloadVersion: REPLAY_PAYLOAD_VERSION,
        rulesetVersion: options.rulesetVersion,
        simBuildHash: options.simBuildHash,
        seed: simulation.roundSeed,
        loadout: { P1: options.p1, P2: options.p2 },
        fixedDt: options.fixedDt ?? AI_ROUND_FIXED_DT,
        advanceRngPerFrame: false,
        rules: simulation.rules,
        balanceTuning: simulation.tuning,
        characterBalanceOverrides: simulation.characterBalanceOverrides,
        localAi: {
          schemaVersion: LOCAL_AI_REPLAY_SCHEMA_VERSION,
          profileId: options.difficulty,
          matchSeed: options.setSeed >>> 0,
          roundSeed: simulation.roundSeed,
          roundIndex: Math.max(0, Math.floor(options.roundIndex)),
          controllerSeeds: {
            P1: deriveStableAiSeed(
              options.setSeed >>> 0,
              options.difficulty,
              options.p1,
              Math.max(0, Math.floor(options.roundIndex)),
            ),
            P2: deriveStableAiSeed(
              options.setSeed >>> 0,
              options.difficulty,
              options.p2,
              Math.max(0, Math.floor(options.roundIndex)),
            ),
          },
          controllerRoles: createDefaultAiControllerRoles(),
          behaviorTuning: sanitiseAiBehaviorTuning(
            options.behaviorTuning ?? createDefaultAiBehaviorTuning(),
          ),
          recoveryPolicyId: options.recoveryPolicyId ?? 'legacy',
          clashPolicyId: options.clashPolicyId ?? 'legacy',
          pursuitPolicyId: options.pursuitPolicyId ?? 'legacy',
        },
        reviewFocus: {
          schemaVersion: 'gw.replay-focus.v1',
          source: options.reviewFocus.source,
          label: options.reviewFocus.label,
          focusFrame,
          endFrame,
        },
      },
      inputTimeline,
      rounds: [{
        round: Math.max(0, Math.floor(options.roundIndex)) + 1,
        label: `Round ${Math.max(0, Math.floor(options.roundIndex)) + 1}`,
        startFrame: 0,
        endFrame: finalFrame,
      }],
      expectedChecksums: simulation.expectedChecksums,
      ...(aiDecisionTrace ? { aiDecisionTrace } : {}),
    },
  };
}
