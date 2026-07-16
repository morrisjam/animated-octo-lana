import { resolveCharacterBalanceConfig } from './characterBalance';
import { ARENA_RADIUS } from './constants';
import { fingerprintDeterministicValue } from './fingerprint';
import { framesToSeconds } from './moveData';
import { nextRngState, rngStateToUnitFloat, sanitiseSeed } from './rng';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId, PlayerState } from './types';

export type AiDifficultyId = 'rookie' | 'cadet' | 'veteran' | 'ace';

export const AI_POLICY_REVISION = 'flow-v18';
export const AI_RECOVERY_POLICY_IDS = ['legacy', 'spacing', 'evasive'] as const;
export type AiRecoveryPolicyId = (typeof AI_RECOVERY_POLICY_IDS)[number];
export const DEFAULT_AI_RECOVERY_POLICY: AiRecoveryPolicyId = 'legacy';
export const AI_CLASH_POLICY_IDS = ['legacy', 'spacing'] as const;
export type AiClashPolicyId = (typeof AI_CLASH_POLICY_IDS)[number];
export const DEFAULT_AI_CLASH_POLICY: AiClashPolicyId = 'legacy';
export const AI_PURSUIT_POLICY_IDS = ['legacy', 'neutral_hold'] as const;
export type AiPursuitPolicyId = (typeof AI_PURSUIT_POLICY_IDS)[number];
export const DEFAULT_AI_PURSUIT_POLICY: AiPursuitPolicyId = 'legacy';

export const AI_BEHAVIOR_TUNING_SCHEMA_VERSION = 'gw.ai-behavior-tuning.v11';

const LEGACY_FINISH_PURSUIT_REACH_SCALE = 0.25;
const DEFAULT_FINISH_PURSUIT_REACH_SCALE = 0.7;

export interface AiBehaviorTuning {
  schemaVersion: typeof AI_BEHAVIOR_TUNING_SCHEMA_VERSION;
  engagementDistanceScale: number;
  neutralApproachScale: number;
  neutralBoostDistanceOffset: number;
  reactionDelayScale: number;
  postCommitmentDecisionScale: number;
  errorRateScale: number;
  riskAppetiteOffset: number;
  neutralHoldFrames: number;
  neutralHoldDistance: number;
  commitmentObserveFrames: number;
  commitmentPressFrames: number;
  commitmentResetFrames: number;
  opponentControlReturnObserveFrames: number;
  postClashSpacingFrames: number;
  postRecoverySpacingFrames: number;
  postControlSteeringFrames: number;
  postEventRetreatChanceOffset: number;
  postRecoverySuperBoostChance: number;
  postRecoveryDefenseFrames: number;
  postRecoveryDefensiveSpecialChance: number;
  postRecoveryThreatParryChance: number;
  committedLaunchGuardChance: number;
  finishPursuitReachScale: number;
  repositionWeightScale: number;
  launchWeightScale: number;
  specialWeightScale: number;
  dunkWeightScale: number;
  parryWeightScale: number;
  launchBreakWeightScale: number;
}

const DEFAULT_AI_BEHAVIOR_TUNING: AiBehaviorTuning = {
  schemaVersion: AI_BEHAVIOR_TUNING_SCHEMA_VERSION,
  engagementDistanceScale: 1,
  neutralApproachScale: 1,
  neutralBoostDistanceOffset: 0,
  reactionDelayScale: 1,
  postCommitmentDecisionScale: 0,
  errorRateScale: 1,
  riskAppetiteOffset: 0,
  neutralHoldFrames: 0,
  neutralHoldDistance: 30,
  commitmentObserveFrames: 0,
  commitmentPressFrames: 0,
  commitmentResetFrames: 0,
  opponentControlReturnObserveFrames: 0,
  postClashSpacingFrames: 0,
  postRecoverySpacingFrames: 0,
  postControlSteeringFrames: 0,
  postEventRetreatChanceOffset: 0,
  postRecoverySuperBoostChance: 0,
  postRecoveryDefenseFrames: 0,
  postRecoveryDefensiveSpecialChance: 0,
  postRecoveryThreatParryChance: 0,
  committedLaunchGuardChance: 0,
  finishPursuitReachScale: DEFAULT_FINISH_PURSUIT_REACH_SCALE,
  repositionWeightScale: 0,
  launchWeightScale: 1,
  specialWeightScale: 1,
  dunkWeightScale: 1,
  parryWeightScale: 1,
  launchBreakWeightScale: 1,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteTuningValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : fallback;
}

export function createDefaultAiBehaviorTuning(): AiBehaviorTuning {
  return { ...DEFAULT_AI_BEHAVIOR_TUNING };
}

export function sanitiseAiBehaviorTuning(value: unknown): AiBehaviorTuning {
  const inputRecord = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const input = inputRecord as Partial<AiBehaviorTuning>;
  const finishPursuitReachFallback = inputRecord.schemaVersion === 'gw.ai-behavior-tuning.v5'
    || inputRecord.schemaVersion === 'gw.ai-behavior-tuning.v6'
    ? LEGACY_FINISH_PURSUIT_REACH_SCALE
    : DEFAULT_FINISH_PURSUIT_REACH_SCALE;
  return {
    schemaVersion: AI_BEHAVIOR_TUNING_SCHEMA_VERSION,
    engagementDistanceScale: finiteTuningValue(input.engagementDistanceScale, 1, 0.25, 3),
    neutralApproachScale: finiteTuningValue(input.neutralApproachScale, 1, 0, 2),
    neutralBoostDistanceOffset: finiteTuningValue(
      input.neutralBoostDistanceOffset,
      0,
      0,
      60,
    ),
    reactionDelayScale: finiteTuningValue(input.reactionDelayScale, 1, 0.25, 4),
    postCommitmentDecisionScale: finiteTuningValue(
      input.postCommitmentDecisionScale,
      0,
      0,
      4,
    ),
    errorRateScale: finiteTuningValue(input.errorRateScale, 1, 0, 4),
    riskAppetiteOffset: finiteTuningValue(input.riskAppetiteOffset, 0, -0.8, 0.8),
    neutralHoldFrames: Math.round(finiteTuningValue(input.neutralHoldFrames, 0, 0, 240)),
    neutralHoldDistance: finiteTuningValue(input.neutralHoldDistance, 30, 8, 80),
    commitmentObserveFrames: Math.round(
      finiteTuningValue(input.commitmentObserveFrames, 0, 0, 120),
    ),
    commitmentPressFrames: Math.round(
      finiteTuningValue(input.commitmentPressFrames, 0, 0, 180),
    ),
    commitmentResetFrames: Math.round(
      finiteTuningValue(input.commitmentResetFrames, 0, 0, 120),
    ),
    opponentControlReturnObserveFrames: Math.round(
      finiteTuningValue(input.opponentControlReturnObserveFrames, 0, 0, 120),
    ),
    postClashSpacingFrames: Math.round(
      finiteTuningValue(input.postClashSpacingFrames, 0, 0, 240),
    ),
    postRecoverySpacingFrames: Math.round(
      finiteTuningValue(input.postRecoverySpacingFrames, 0, 0, 240),
    ),
    postControlSteeringFrames: Math.round(
      finiteTuningValue(input.postControlSteeringFrames, 0, 0, 120),
    ),
    postEventRetreatChanceOffset: finiteTuningValue(
      input.postEventRetreatChanceOffset,
      0,
      -1,
      1,
    ),
    postRecoverySuperBoostChance: finiteTuningValue(
      input.postRecoverySuperBoostChance,
      0,
      0,
      1,
    ),
    postRecoveryDefenseFrames: Math.round(finiteTuningValue(
      input.postRecoveryDefenseFrames,
      0,
      0,
      120,
    )),
    postRecoveryDefensiveSpecialChance: finiteTuningValue(
      input.postRecoveryDefensiveSpecialChance,
      0,
      0,
      1,
    ),
    postRecoveryThreatParryChance: finiteTuningValue(
      input.postRecoveryThreatParryChance,
      0,
      0,
      1,
    ),
    committedLaunchGuardChance: finiteTuningValue(
      input.committedLaunchGuardChance,
      0,
      0,
      1,
    ),
    finishPursuitReachScale: finiteTuningValue(
      input.finishPursuitReachScale,
      finishPursuitReachFallback,
      0,
      2,
    ),
    repositionWeightScale: finiteTuningValue(input.repositionWeightScale, 0, 0, 4),
    launchWeightScale: finiteTuningValue(input.launchWeightScale, 1, 0, 4),
    specialWeightScale: finiteTuningValue(input.specialWeightScale, 1, 0, 4),
    dunkWeightScale: finiteTuningValue(input.dunkWeightScale, 1, 0, 4),
    parryWeightScale: finiteTuningValue(input.parryWeightScale, 1, 0, 4),
    launchBreakWeightScale: finiteTuningValue(input.launchBreakWeightScale, 1, 0, 4),
  };
}

export function fingerprintAiBehaviorTuning(value: AiBehaviorTuning): string {
  return fingerprintDeterministicValue(sanitiseAiBehaviorTuning(value));
}

export interface AiDifficultyProfile {
  id: AiDifficultyId;
  label: string;
  reactionDelayFrames: number;
  errorRate: number;
  riskAppetite: number;
  approachDistance: number;
  postRecoveryDecisionFrames: number;
  postRecoveryRetreatChance: number;
  postRecoverySuperBoostChance: number;
  actionWeights: {
    launch: number;
    special: number;
    dunk: number;
    parry: number;
    breakLaunch: number;
  };
}

export const AI_DIFFICULTY_ORDER: AiDifficultyId[] = ['rookie', 'cadet', 'veteran', 'ace'];

export const AI_DIFFICULTY_PROFILES: Record<AiDifficultyId, AiDifficultyProfile> = {
  rookie: {
    id: 'rookie',
    label: 'Rookie',
    reactionDelayFrames: 18,
    errorRate: 0.28,
    riskAppetite: 0.28,
    approachDistance: 10.8,
    postRecoveryDecisionFrames: 28,
    postRecoveryRetreatChance: 0.72,
    postRecoverySuperBoostChance: 0.25,
    actionWeights: {
      launch: 0.7,
      special: 0.55,
      dunk: 0.6,
      parry: 0.45,
      breakLaunch: 0.55,
    },
  },
  cadet: {
    id: 'cadet',
    label: 'Cadet',
    reactionDelayFrames: 13,
    errorRate: 0.18,
    riskAppetite: 0.46,
    approachDistance: 9.8,
    postRecoveryDecisionFrames: 22,
    postRecoveryRetreatChance: 0.65,
    postRecoverySuperBoostChance: 0.38,
    actionWeights: {
      launch: 0.9,
      special: 0.8,
      dunk: 0.78,
      parry: 0.72,
      breakLaunch: 0.76,
    },
  },
  veteran: {
    id: 'veteran',
    label: 'Veteran',
    reactionDelayFrames: 9,
    errorRate: 0.1,
    riskAppetite: 0.62,
    approachDistance: 9,
    postRecoveryDecisionFrames: 16,
    postRecoveryRetreatChance: 0.56,
    postRecoverySuperBoostChance: 0.5,
    actionWeights: {
      launch: 1.15,
      special: 1.02,
      dunk: 0.92,
      parry: 0.95,
      breakLaunch: 0.94,
    },
  },
  ace: {
    id: 'ace',
    label: 'Ace',
    reactionDelayFrames: 6,
    errorRate: 0.04,
    riskAppetite: 0.8,
    approachDistance: 8.4,
    postRecoveryDecisionFrames: 12,
    postRecoveryRetreatChance: 0.46,
    postRecoverySuperBoostChance: 0.62,
    actionWeights: {
      launch: 1.35,
      special: 1.2,
      dunk: 1.05,
      parry: 1.2,
      breakLaunch: 1.08,
    },
  },
};

export const DEFAULT_AI_DIFFICULTY: AiDifficultyId = 'cadet';

export interface CreateAiControllerOptions {
  seed?: number;
  profileId?: AiDifficultyId;
  recoveryPolicyId?: AiRecoveryPolicyId;
  clashPolicyId?: AiClashPolicyId;
  pursuitPolicyId?: AiPursuitPolicyId;
  behaviorTuning?: AiBehaviorTuning;
}

export interface AiControllerState {
  rngState: number;
  recoveryRngState: number;
  decisionLockFrames: number;
  reactionFramesRemaining: number;
  postCommitmentDecisionFramesRemaining: number;
  profileId: AiDifficultyId;
  maneuverFramesRemaining: number;
  strafeSign: -1 | 1;
  superBoostRecommitFrames: number;
  superBoostStartsSinceTacticalAction: number;
  wasHelpless: boolean;
  launchBreakDelayFramesRemaining: number;
  launchBreakPlanned: boolean;
  postRecoveryFramesRemaining: number;
  postControlSteeringFramesRemaining: number;
  tacticalRepositionOpportunityFramesRemaining: number;
  tacticalRepositionFramesRemaining: number;
  postRecoveryMode: 'retreat' | 'orbit';
  postRecoveryUseSuperBoost: boolean;
  postRecoveryDefenseFramesRemaining: number;
  postRecoveryThreatParryAttempted: boolean;
  observedOpponentLaunchCommitment: boolean;
  observedClashFlash: boolean;
  recoveryPolicyId: AiRecoveryPolicyId;
  clashPolicyId: AiClashPolicyId;
  neutralHoldFramesRemaining: number;
  neutralHoldPending: boolean;
  wasInPressureBand: boolean;
  commitmentMode: 'legacy' | 'observe' | 'press' | 'reset';
  commitmentFramesRemaining: number;
  commitmentInitiativeOwner: PlayerId | null;
  opponentControlReturnObserveFramesRemaining: number;
  wasStrikeCommitted: boolean;
  wasOpponentStrikeCommitted: boolean;
  wasPlayerWithoutControl: boolean;
  wasOpponentWithoutControl: boolean;
  pursuitPolicyId: AiPursuitPolicyId;
  behaviorTuning: AiBehaviorTuning;
}

export const AI_DECISION_TRACE_SCHEMA_VERSION = 'gw.ai-decision-trace.v4';

export const AI_MOVEMENT_INTENTS = [
  'uncontrolled',
  'projectile_evade',
  'post_event_spacing',
  'tactical_reposition',
  'neutral_hold',
  'commitment_observe',
  'commitment_press',
  'commitment_reset',
  'finish_chase',
  'recovery_chase',
  'depleted_target_pressure',
  'low_fuel_retreat',
  'projectile_spacing',
  'long_range_approach',
  'mid_range_orbit',
  'close_range_orbit',
  'mistake_drift',
  'scripted_passive',
  'scripted_defend',
  'scripted_evade',
] as const;
export type AiMovementIntent = (typeof AI_MOVEMENT_INTENTS)[number];

export const AI_TACTICAL_ACTIONS = [
  'launch',
  'special',
  'dunk',
  'parry',
  'launch_break',
] as const;
export type AiTacticalAction = (typeof AI_TACTICAL_ACTIONS)[number];

export const AI_DECISION_CANDIDATES = [
  ...AI_TACTICAL_ACTIONS,
  'reposition',
] as const;
export type AiDecisionCandidate = (typeof AI_DECISION_CANDIDATES)[number];

export interface AiActionCandidateTrace {
  eligible: boolean;
  weight: number;
  reason: string;
}

export interface AiDecisionTrace {
  schemaVersion: typeof AI_DECISION_TRACE_SCHEMA_VERSION;
  playerId: PlayerId;
  profileId: AiDifficultyId;
  controllerRoleId: 'adaptive' | 'passive' | 'defensive' | 'evasive';
  gameTimeSeconds: number;
  movementIntent: AiMovementIntent;
  selectedAction: AiTacticalAction | null;
  selectedReason: string;
  selectionRoll: number | null;
  mistakeRoll: number;
  context: {
    distance: number;
    fuelRatio: number;
    opponentFuelRatio: number;
    incomingProjectileDistance: number | null;
    finishOpportunity: boolean;
  };
  gates: {
    hasControl: boolean;
    canChooseTacticalAction: boolean;
    decisionLockFrames: number;
    reactionFramesRemaining: number;
    neutralHoldActive: boolean;
    postEventSpacingActive: boolean;
    deliberateError: boolean;
  };
  candidates: Record<AiDecisionCandidate, AiActionCandidateTrace>;
}

export interface AiTickResult {
  input: PlayerFrameInput;
  next: AiControllerState;
  decision: AiDecisionTrace;
}

interface ProjectileThreatSummary {
  friendlyProjectileCount: number;
  incomingProjectileDistance: number;
  incomingDirX: number;
  incomingDirY: number;
}

function createNeutralInput(): PlayerFrameInput {
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

function clampAxis(value: number): number {
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
}

function toOpponent(playerId: PlayerId): PlayerId {
  return playerId === 'P1' ? 'P2' : 'P1';
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function resolveAiDifficultyProfile(
  profileId: AiDifficultyId | undefined,
  behaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning(),
): AiDifficultyProfile {
  const base = profileId
    ? AI_DIFFICULTY_PROFILES[profileId] ?? AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY]
    : AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY];
  const tuning = sanitiseAiBehaviorTuning(behaviorTuning);
  return {
    ...base,
    reactionDelayFrames: Math.max(0, Math.round(base.reactionDelayFrames * tuning.reactionDelayScale)),
    errorRate: clamp01(base.errorRate * tuning.errorRateScale),
    riskAppetite: clamp01(base.riskAppetite + tuning.riskAppetiteOffset),
    approachDistance: base.approachDistance * tuning.engagementDistanceScale,
    actionWeights: {
      launch: base.actionWeights.launch * tuning.launchWeightScale,
      special: base.actionWeights.special * tuning.specialWeightScale,
      dunk: base.actionWeights.dunk * tuning.dunkWeightScale,
      parry: base.actionWeights.parry * tuning.parryWeightScale,
      breakLaunch: base.actionWeights.breakLaunch * tuning.launchBreakWeightScale,
    },
  };
}

function hasAttackCommitment(player: PlayerState): boolean {
  return player.launchStartup > 0
    || player.launchActive > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
    || player.specialStartup > 0
    || player.specialActive > 0;
}

function getCharacterMoves(state: GameState, player: GameState['players']['P1']) {
  return resolveCharacterBalanceConfig(player.characterId, state.characterBalanceOverrides).moves;
}

function nextAiRoll(rngState: number): { rngState: number; roll: number } {
  const nextState = nextRngState(rngState);
  return {
    rngState: nextState,
    roll: rngStateToUnitFloat(nextState),
  };
}

function summariseProjectileThreat(
  state: GameState,
  playerId: PlayerId,
  player: GameState['players']['P1'],
): ProjectileThreatSummary {
  let friendlyProjectileCount = 0;
  let incomingProjectileDistance = Number.POSITIVE_INFINITY;
  let incomingDirX = 0;
  let incomingDirY = 0;

  for (const projectile of state.projectiles) {
    if (projectile.ownerId === playerId) {
      friendlyProjectileCount += 1;
      continue;
    }

    const dx = player.pos.x - projectile.pos.x;
    const dy = player.pos.y - projectile.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= incomingProjectileDistance) {
      continue;
    }

    incomingProjectileDistance = distance;
    const velocityLength = Math.hypot(projectile.vel.x, projectile.vel.y);
    if (velocityLength > 0.001) {
      incomingDirX = projectile.vel.x / velocityLength;
      incomingDirY = projectile.vel.y / velocityLength;
    } else if (distance > 0.001) {
      incomingDirX = -dx / distance;
      incomingDirY = -dy / distance;
    } else {
      incomingDirX = 0;
      incomingDirY = 0;
    }
  }

  return {
    friendlyProjectileCount,
    incomingProjectileDistance,
    incomingDirX,
    incomingDirY,
  };
}

export function listAiDifficultyProfiles(): AiDifficultyProfile[] {
  return AI_DIFFICULTY_ORDER.map((id) => AI_DIFFICULTY_PROFILES[id]);
}

export function createAiController(seedOrOptions?: number | CreateAiControllerOptions): AiControllerState {
  const options = typeof seedOrOptions === 'number'
    ? { seed: seedOrOptions }
    : (seedOrOptions ?? {});
  const behaviorTuning = sanitiseAiBehaviorTuning(options.behaviorTuning);
  const profile = resolveAiDifficultyProfile(options.profileId, behaviorTuning);
  const rngState = sanitiseSeed(options.seed);
  return {
    rngState,
    recoveryRngState: sanitiseSeed((rngState ^ 0x9e3779b9) >>> 0),
    decisionLockFrames: 0,
    reactionFramesRemaining: profile.reactionDelayFrames,
    postCommitmentDecisionFramesRemaining: 0,
    profileId: profile.id,
    maneuverFramesRemaining: 0,
    strafeSign: 1,
    superBoostRecommitFrames: 0,
    superBoostStartsSinceTacticalAction: 0,
    wasHelpless: false,
    launchBreakDelayFramesRemaining: 0,
    launchBreakPlanned: false,
    postRecoveryFramesRemaining: 0,
    postControlSteeringFramesRemaining: 0,
    tacticalRepositionOpportunityFramesRemaining: 0,
    tacticalRepositionFramesRemaining: 0,
    postRecoveryMode: 'orbit',
    postRecoveryUseSuperBoost: false,
    postRecoveryDefenseFramesRemaining: 0,
    postRecoveryThreatParryAttempted: false,
    observedOpponentLaunchCommitment: false,
    observedClashFlash: false,
    recoveryPolicyId: options.recoveryPolicyId ?? DEFAULT_AI_RECOVERY_POLICY,
    clashPolicyId: options.clashPolicyId ?? DEFAULT_AI_CLASH_POLICY,
    neutralHoldFramesRemaining: 0,
    neutralHoldPending: false,
    wasInPressureBand: false,
    commitmentMode: 'legacy',
    commitmentFramesRemaining: 0,
    commitmentInitiativeOwner: null,
    opponentControlReturnObserveFramesRemaining: 0,
    wasStrikeCommitted: false,
    wasOpponentStrikeCommitted: false,
    wasPlayerWithoutControl: false,
    wasOpponentWithoutControl: false,
    pursuitPolicyId: options.pursuitPolicyId ?? DEFAULT_AI_PURSUIT_POLICY,
    behaviorTuning,
  };
}

export function tickAiController(state: GameState, playerId: PlayerId, controller: AiControllerState): AiTickResult {
  const player = state.players[playerId];
  const opponent = state.players[toOpponent(playerId)];
  const behaviorTuning = sanitiseAiBehaviorTuning(controller.behaviorTuning);
  const profile = resolveAiDifficultyProfile(controller.profileId, behaviorTuning);
  const playerStats = resolveCharacterBalanceConfig(player.characterId, state.characterBalanceOverrides).stats;
  const playerMoves = getCharacterMoves(state, player);
  const opponentMoves = getCharacterMoves(state, opponent);
  const specialMove = playerMoves.special;
  const specialCreatesStrikeCommitment = specialMove.behaviorId === 'special.projectile.v1'
    || specialMove.behaviorId === 'special.command_grab.v1';
  const specialFuelCost = specialMove.fuelCost * playerStats.specialFuelCostMultiplier;
  let rngState = controller.rngState;
  let recoveryRngState = controller.recoveryRngState
    ?? sanitiseSeed((controller.rngState ^ 0x9e3779b9) >>> 0);
  const recoveryPolicyId = controller.recoveryPolicyId ?? DEFAULT_AI_RECOVERY_POLICY;
  const clashPolicyId = controller.clashPolicyId ?? DEFAULT_AI_CLASH_POLICY;
  const pursuitPolicyId = controller.pursuitPolicyId ?? DEFAULT_AI_PURSUIT_POLICY;
  let decisionLockFrames = Math.max(0, controller.decisionLockFrames - 1);
  let reactionFramesRemaining = Math.max(0, controller.reactionFramesRemaining - 1);
  let postCommitmentDecisionFramesRemaining = Math.max(
    0,
    Math.floor(controller.postCommitmentDecisionFramesRemaining ?? 0),
  );
  let maneuverFramesRemaining = Math.max(0, controller.maneuverFramesRemaining - 1);
  let strafeSign = controller.strafeSign;
  let superBoostRecommitFrames = Math.max(0, (controller.superBoostRecommitFrames ?? 0) - 1);
  let superBoostStartsSinceTacticalAction = Math.max(
    0,
    Math.floor(controller.superBoostStartsSinceTacticalAction ?? 0),
  );
  let wasHelpless = controller.wasHelpless ?? false;
  let launchBreakDelayFramesRemaining = Math.max(
    0,
    Math.floor(controller.launchBreakDelayFramesRemaining ?? 0),
  );
  let launchBreakPlanned = controller.launchBreakPlanned ?? false;
  let postRecoveryFramesRemaining = Math.max(
    0,
    Math.floor(controller.postRecoveryFramesRemaining ?? 0) - 1,
  );
  let postControlSteeringFramesRemaining = Math.max(
    0,
    Math.floor(controller.postControlSteeringFramesRemaining ?? 0) - 1,
  );
  let tacticalRepositionOpportunityFramesRemaining = Math.max(
    0,
    Math.floor(controller.tacticalRepositionOpportunityFramesRemaining ?? 0) - 1,
  );
  let tacticalRepositionFramesRemaining = Math.max(
    0,
    Math.floor(controller.tacticalRepositionFramesRemaining ?? 0) - 1,
  );
  let postRecoveryMode = controller.postRecoveryMode ?? 'orbit';
  let postRecoveryUseSuperBoost = controller.postRecoveryUseSuperBoost ?? false;
  let postRecoveryDefenseFramesRemaining = Math.max(
    0,
    Math.floor(controller.postRecoveryDefenseFramesRemaining ?? 0) - 1,
  );
  let postRecoveryThreatParryAttempted = controller.postRecoveryThreatParryAttempted ?? false;
  let observedOpponentLaunchCommitment = controller.observedOpponentLaunchCommitment ?? false;
  let neutralHoldFramesRemaining = Math.max(
    0,
    Math.floor(controller.neutralHoldFramesRemaining ?? 0) - 1,
  );
  let neutralHoldPending = controller.neutralHoldPending ?? false;
  let wasInPressureBand = controller.wasInPressureBand ?? false;
  let commitmentMode = controller.commitmentMode ?? 'legacy';
  let commitmentFramesRemaining = Math.max(
    0,
    Math.floor(controller.commitmentFramesRemaining ?? 0),
  );
  let commitmentInitiativeOwner = controller.commitmentInitiativeOwner ?? null;
  let opponentControlReturnObserveFramesRemaining = Math.max(
    0,
    Math.floor(controller.opponentControlReturnObserveFramesRemaining ?? 0) - 1,
  );
  let wasStrikeCommitted = controller.wasStrikeCommitted ?? false;
  let wasOpponentStrikeCommitted = controller.wasOpponentStrikeCommitted ?? false;
  let wasPlayerWithoutControl = controller.wasPlayerWithoutControl ?? false;
  let wasOpponentWithoutControl = controller.wasOpponentWithoutControl ?? false;
  const clashFlashVisible = state.players.P1.launchFlash > 0
    && state.players.P2.launchFlash > 0
    && state.players.P1.helpless <= 0
    && state.players.P2.helpless <= 0;
  const clashStartedThisFrame = clashFlashVisible && !(controller.observedClashFlash ?? false);
  const observedClashFlash = clashFlashVisible;
  const input = createNeutralInput();
  let movementIntent: AiMovementIntent = 'mid_range_orbit';
  let controlReturnedThisFrame = false;

  if (!state.winner && player.helpless > 0) {
    if (!wasHelpless) {
      const delayRoll = nextAiRoll(rngState);
      rngState = delayRoll.rngState;
      const minimumDelayFrames = Math.round(6 + (1 - profile.riskAppetite) * 6);
      const variableDelayFrames = Math.round(12 + (1 - profile.riskAppetite) * 18);
      launchBreakDelayFramesRemaining = minimumDelayFrames
        + Math.floor(delayRoll.roll * (variableDelayFrames + 1));
      const planRoll = nextAiRoll(rngState);
      rngState = planRoll.rngState;
      const fuelRisk = clamp01(1 - player.fuel / Math.max(1, player.maxFuel));
      const reserveMultiplier = player.launchBreaks >= 3
        ? 1
        : player.launchBreaks === 2
          ? 0.72
          : 0.42;
      const planChance = clamp01(
        (0.28 + profile.riskAppetite * 0.18 + fuelRisk * 0.34) * reserveMultiplier,
      );
      launchBreakPlanned = planRoll.roll < planChance;
    } else {
      launchBreakDelayFramesRemaining = Math.max(0, launchBreakDelayFramesRemaining - 1);
    }
    wasHelpless = true;
  } else {
    if (player.recovering > 0) {
      wasHelpless = false;
    } else if (player.stunned <= 0) {
      controlReturnedThisFrame = wasHelpless;
      wasHelpless = false;
    }
    launchBreakDelayFramesRemaining = 0;
    launchBreakPlanned = false;
  }

  const deltaX = opponent.pos.x - player.pos.x;
  const deltaY = opponent.pos.y - player.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const dirX = distance > 0.001 ? deltaX / distance : 0;
  const dirY = distance > 0.001 ? deltaY / distance : 0;
  const tangentX = -dirY * strafeSign;
  const tangentY = dirX * strafeSign;
  const centerDistance = Math.hypot(player.pos.x, player.pos.y);
  const toCenterX = centerDistance > 0.001 ? -player.pos.x / centerDistance : 0;
  const toCenterY = centerDistance > 0.001 ? -player.pos.y / centerDistance : 0;
  const pressureDistance = profile.approachDistance;
  const neutralApproachReduction = clamp01(1 - behaviorTuning.neutralApproachScale);
  const neutralBoostDistance = pressureDistance
    + 5.5
    + behaviorTuning.neutralBoostDistanceOffset;
  const opponentNearDepleted = opponent.fuel <= opponent.maxFuel * 0.08;
  const finishOpportunity = opponent.helpless > 0 && opponent.fuel <= 0;
  const targetSpeed = Math.hypot(opponent.vel.x, opponent.vel.y);
  const separationSpeed = distance > 0.001
    ? ((opponent.vel.x - player.vel.x) * deltaX + (opponent.vel.y - player.vel.y) * deltaY) / distance
    : 0;
  const maximumDunkClosingSpeed = 36 + profile.riskAppetite * 12;
  const maximumDunkTargetSpeed = 72 + profile.riskAppetite * 10;
  const dunkStartupSeconds = framesToSeconds(playerMoves.dunk.startupFrames);
  const authoredPursuitReach = playerMoves.dunk.startupPursuitSpeed * dunkStartupSeconds;
  const standardPursuitReach = Math.min(8, authoredPursuitReach * 0.25);
  const finishPursuitReach = behaviorTuning.finishPursuitReachScale >= 0.25
    ? standardPursuitReach
      + authoredPursuitReach * (behaviorTuning.finishPursuitReachScale - 0.25)
    : standardPursuitReach * (behaviorTuning.finishPursuitReachScale / 0.25);
  const dunkCommitRange = playerMoves.dunk.hitRange + 0.8 + (
    finishOpportunity ? finishPursuitReach : standardPursuitReach
  );
  const playerHasControl = player.helpless <= 0
    && player.stunned <= 0
    && player.recovering <= 0
    && !state.winner;
  const canChooseTacticalAction = playerHasControl
    && player.endLag <= 0
    && !hasAttackCommitment(player);
  const dunkCommitReady = canChooseTacticalAction
    && player.cool.dunk <= 0
    && opponent.helpless > 0
    && distance < dunkCommitRange
    && (
      finishOpportunity
      || (
        separationSpeed >= -maximumDunkClosingSpeed
        && targetSpeed <= maximumDunkTargetSpeed
      )
    );
  const dunkStartupLead = player.dunkStartup > 0 ? player.dunkStartup + 0.08 : 0;
  const leadSeconds = finishOpportunity
    ? Math.min(0.65, Math.max(0.08, distance / 110, dunkStartupLead))
    : 0;
  const chaseDeltaX = opponent.pos.x + opponent.vel.x * leadSeconds - player.pos.x;
  const chaseDeltaY = opponent.pos.y + opponent.vel.y * leadSeconds - player.pos.y;
  const chaseDistance = Math.hypot(chaseDeltaX, chaseDeltaY);
  const chaseDirX = chaseDistance > 0.001 ? chaseDeltaX / chaseDistance : dirX;
  const chaseDirY = chaseDistance > 0.001 ? chaseDeltaY / chaseDistance : dirY;
  const projectileThreat = summariseProjectileThreat(state, playerId, player);
  const hasIncomingProjectile = Number.isFinite(projectileThreat.incomingProjectileDistance);
  const incomingProjectileClose = hasIncomingProjectile && projectileThreat.incomingProjectileDistance < 16;
  const incomingProjectileUrgent = hasIncomingProjectile && projectileThreat.incomingProjectileDistance < 9;
  const friendlyProjectileCount = projectileThreat.friendlyProjectileCount;
  const lowFuel = player.fuel < player.maxFuel * (0.22 + (1 - profile.riskAppetite) * 0.08);
  const opponentOpen = opponent.endLag > 0
    || opponent.stunned > 0
    || opponent.recovering > 0
    || opponent.helpless > 0
    || opponent.launchStartup > 0
    || opponent.dunkStartup > 0
    || opponent.specialStartup > 0;
  const opponentCommittedAttack = opponent.launchStartup > 0
    || opponent.launchActive > 0
    || opponent.dunkStartup > 0
    || opponent.dunkActive > 0
    || opponent.specialStartup > 0
    || opponent.specialActive > 0;
  const opponentHasNeutralControl = opponent.helpless <= 0
    && opponent.stunned <= 0
    && opponent.recovering <= 0
    && opponent.endLag <= 0
    && !opponentCommittedAttack;
  const opponentThreatRange = Math.max(10, opponentMoves.dunk.hitRange + 2.5);
  const opponentThreatening = opponentCommittedAttack && distance < opponentThreatRange;
  const opponentLaunchCommitted = opponent.launchStartup > 0 || opponent.launchActive > 0;
  const opponentLaunchStartedThisFrame = opponent.launchStartup > 0
    && !observedOpponentLaunchCommitment;
  const opponentLaunchThreatening = opponent.launchStartup > 0 && distance < opponentThreatRange;
  const opponentParryableThreatening = opponentLaunchCommitted && distance < opponentThreatRange;
  observedOpponentLaunchCommitment = opponentLaunchCommitted;
  const strikeCommittedNow = player.launchStartup > 0
    || player.launchActive > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
    || (specialCreatesStrikeCommitment && (
      player.specialStartup > 0 || player.specialActive > 0
    ));
  const ownStrikeEndedThisFrame = wasStrikeCommitted && !strikeCommittedNow;
  wasStrikeCommitted = strikeCommittedNow;
  const opponentStrikeCommittedNow = opponent.launchStartup > 0
    || opponent.launchActive > 0
    || opponent.dunkStartup > 0
    || opponent.dunkActive > 0
    || ((
      opponentMoves.special.behaviorId === 'special.projectile.v1'
      || opponentMoves.special.behaviorId === 'special.command_grab.v1'
    ) && (
      opponent.specialStartup > 0 || opponent.specialActive > 0
    ));
  const opponentStrikeEndedThisFrame = wasOpponentStrikeCommitted
    && !opponentStrikeCommittedNow;
  wasOpponentStrikeCommitted = opponentStrikeCommittedNow;
  const playerWithoutControl = player.helpless > 0
    || player.stunned > 0
    || player.recovering > 0;
  const playerControlReturnedForCommitment = wasPlayerWithoutControl && !playerWithoutControl;
  wasPlayerWithoutControl = playerWithoutControl;
  const opponentWithoutControl = opponent.helpless > 0
    || opponent.stunned > 0
    || opponent.recovering > 0;
  const opponentControlReturnedThisFrame = wasOpponentWithoutControl && !opponentWithoutControl;
  wasOpponentWithoutControl = opponentWithoutControl;
  if (
    controlReturnedThisFrame
    && behaviorTuning.repositionWeightScale > 0
    && playerHasControl
    && !state.winner
  ) {
    tacticalRepositionOpportunityFramesRemaining = Math.max(
      18,
      profile.reactionDelayFrames + 12,
    );
  }
  if (state.winner || playerWithoutControl || opponentWithoutControl) {
    postCommitmentDecisionFramesRemaining = 0;
  } else if (
    ownStrikeEndedThisFrame
    && behaviorTuning.postCommitmentDecisionScale > 0
    && opponentHasNeutralControl
  ) {
    postCommitmentDecisionFramesRemaining = Math.max(
      postCommitmentDecisionFramesRemaining,
      Math.round(profile.reactionDelayFrames * behaviorTuning.postCommitmentDecisionScale),
    );
  }
  const postCommitmentDecisionActive = postCommitmentDecisionFramesRemaining > 0
    && canChooseTacticalAction;
  if (postCommitmentDecisionActive) {
    postCommitmentDecisionFramesRemaining -= 1;
  }
  const radialSpeed = centerDistance > 0.001
    ? (player.vel.x * player.pos.x + player.vel.y * player.pos.y) / centerDistance
    : 0;
  const lowFuelDanger = player.fuel <= player.maxFuel * 0.2;
  const boundaryRisk = lowFuelDanger
    && centerDistance > ARENA_RADIUS * 0.8
    && radialSpeed > 20;
  const committedFinishThreat = lowFuelDanger
    && (opponent.dunkStartup > 0 || opponent.dunkActive > 0)
    && distance < opponentMoves.dunk.hitRange + 4.5;
  const projectileLane = specialMove.behaviorId === 'special.projectile.v1'
    && distance > 10
    && distance < specialMove.size.range * 0.82;

  const inPressureBand = distance <= 24;
  const pressureExitThisFrame = wasInPressureBand && !inPressureBand && !state.winner;
  wasInPressureBand = inPressureBand;
  if (inPressureBand) {
    neutralHoldFramesRemaining = 0;
    neutralHoldPending = false;
  } else if (
    pressureExitThisFrame
    && (pursuitPolicyId === 'neutral_hold' || behaviorTuning.neutralHoldFrames > 0)
    && player.helpless <= 0
    && player.recovering <= 0
    && opponent.helpless <= 0
    && opponent.recovering <= 0
  ) {
    neutralHoldPending = true;
  }
  const playerHasNeutralControl = playerHasControl
    && player.endLag <= 0
    && !hasAttackCommitment(player);
  if (neutralHoldPending && playerHasNeutralControl && opponentHasNeutralControl) {
    neutralHoldFramesRemaining = behaviorTuning.neutralHoldFrames > 0
      ? behaviorTuning.neutralHoldFrames
      : Math.max(
        12,
        Math.round(profile.reactionDelayFrames + profile.postRecoveryDecisionFrames * 0.75),
      );
    neutralHoldPending = false;
  }
  const neutralHoldActive = neutralHoldFramesRemaining > 0
    && playerHasControl
    && opponentHasNeutralControl
    && !state.winner;

  const commitmentCycleEnabled = behaviorTuning.commitmentObserveFrames > 0
    || behaviorTuning.commitmentPressFrames > 0
    || behaviorTuning.commitmentResetFrames > 0;
  let commitmentPhaseStartedThisFrame = false;
  const seededInitiativeOwner: PlayerId = (state.seed & 1) === 0 ? 'P1' : 'P2';
  const oppositeInitiativeOwner = (owner: PlayerId): PlayerId => (
    owner === 'P1' ? 'P2' : 'P1'
  );
  const beginCommitmentRoles = (owner: PlayerId, resetFirst: boolean): void => {
    commitmentInitiativeOwner = owner;
    commitmentPhaseStartedThisFrame = true;
    if (resetFirst && behaviorTuning.commitmentResetFrames > 0) {
      commitmentMode = 'reset';
      commitmentFramesRemaining = behaviorTuning.commitmentResetFrames;
      return;
    }
    const ownsInitiative = playerId === owner;
    const phaseFrames = ownsInitiative
      ? behaviorTuning.commitmentPressFrames
      : behaviorTuning.commitmentObserveFrames;
    commitmentMode = phaseFrames > 0
      ? ownsInitiative ? 'press' : 'observe'
      : 'legacy';
    commitmentFramesRemaining = phaseFrames;
  };
  if (!commitmentCycleEnabled) {
    commitmentMode = 'legacy';
    commitmentFramesRemaining = 0;
    commitmentInitiativeOwner = null;
  } else if (
    state.winner
  ) {
    commitmentMode = 'legacy';
    commitmentFramesRemaining = 0;
  } else if (playerWithoutControl || opponentWithoutControl) {
    commitmentInitiativeOwner = playerWithoutControl && !opponentWithoutControl
      ? toOpponent(playerId)
      : opponentWithoutControl && !playerWithoutControl
        ? playerId
        : commitmentInitiativeOwner ?? seededInitiativeOwner;
    commitmentMode = 'legacy';
    commitmentFramesRemaining = 0;
  } else {
    const p1ControlReturned = playerId === 'P1'
      ? playerControlReturnedForCommitment
      : opponentControlReturnedThisFrame;
    const p2ControlReturned = playerId === 'P2'
      ? playerControlReturnedForCommitment
      : opponentControlReturnedThisFrame;
    const p1StrikeEnded = playerId === 'P1'
      ? ownStrikeEndedThisFrame
      : opponentStrikeEndedThisFrame;
    const p2StrikeEnded = playerId === 'P2'
      ? ownStrikeEndedThisFrame
      : opponentStrikeEndedThisFrame;
    const p1TargetRetainedControl = state.players.P2.helpless <= 0
      && state.players.P2.stunned <= 0
      && state.players.P2.recovering <= 0;
    const p2TargetRetainedControl = state.players.P1.helpless <= 0
      && state.players.P1.stunned <= 0
      && state.players.P1.recovering <= 0;
    const p1WhiffEnded = p1StrikeEnded && p1TargetRetainedControl;
    const p2WhiffEnded = p2StrikeEnded && p2TargetRetainedControl;
    const currentOwner = commitmentInitiativeOwner ?? seededInitiativeOwner;

    if (p1ControlReturned !== p2ControlReturned) {
      beginCommitmentRoles(p1ControlReturned ? 'P1' : 'P2', true);
    } else if (p1ControlReturned && p2ControlReturned) {
      beginCommitmentRoles(oppositeInitiativeOwner(currentOwner), true);
    } else if (clashStartedThisFrame) {
      beginCommitmentRoles(oppositeInitiativeOwner(currentOwner), true);
    } else if (p1WhiffEnded && p2WhiffEnded) {
      beginCommitmentRoles(oppositeInitiativeOwner(currentOwner), false);
    } else if (p1WhiffEnded !== p2WhiffEnded) {
      beginCommitmentRoles(p1WhiffEnded ? 'P2' : 'P1', false);
    } else if (commitmentMode === 'reset' && commitmentFramesRemaining <= 0) {
      beginCommitmentRoles(currentOwner, false);
    } else if (
      (commitmentMode === 'observe' || commitmentMode === 'press')
      && commitmentFramesRemaining <= 0
    ) {
      commitmentMode = 'legacy';
      commitmentFramesRemaining = 0;
    } else if (
      commitmentMode === 'legacy'
      && (commitmentInitiativeOwner === null || pressureExitThisFrame)
      && playerHasNeutralControl
      && opponentHasNeutralControl
    ) {
      beginCommitmentRoles(currentOwner, false);
    }
  }
  const commitmentObserveActive = commitmentMode === 'observe'
    && playerHasNeutralControl
    && !state.winner;
  const commitmentPressActive = commitmentMode === 'press'
    && playerHasControl
    && opponentHasNeutralControl
    && !state.winner;
  const commitmentResetActive = commitmentMode === 'reset'
    && playerHasControl
    && opponent.helpless <= 0
    && opponent.recovering <= 0
    && !state.winner;
  const sharedCommitmentResetDecisionFrame = commitmentResetActive
    && playerHasNeutralControl
    && opponentHasNeutralControl
    && player.parry <= 0
    && opponent.parry <= 0;
  if (
    opponentControlReturnedThisFrame
    && behaviorTuning.opponentControlReturnObserveFrames > 0
    && playerHasControl
    && !state.winner
  ) {
    opponentControlReturnObserveFramesRemaining = behaviorTuning.opponentControlReturnObserveFrames;
  }
  const opponentControlReturnObserveActive = opponentControlReturnObserveFramesRemaining > 0
    && playerHasNeutralControl
    && opponentHasNeutralControl
    && !state.winner;
  const commitmentOffenseSuppressed = commitmentObserveActive
    || commitmentResetActive
    || opponentControlReturnObserveActive;
  if (
    !commitmentPhaseStartedThisFrame
    && commitmentFramesRemaining > 0
    && (
      commitmentObserveActive
      || commitmentPressActive
      || sharedCommitmentResetDecisionFrame
    )
  ) {
    commitmentFramesRemaining -= 1;
  }

  const hasLaunchStartupDisadvantage = playerMoves.launch.startupFrames
    > opponentMoves.launch.startupFrames;
  if (
    controlReturnedThisFrame
    && behaviorTuning.postRecoveryDefenseFrames > 0
    && playerHasControl
    && opponent.helpless <= 0
    && opponent.recovering <= 0
    && distance <= 24
    && hasLaunchStartupDisadvantage
  ) {
    postRecoveryDefenseFramesRemaining = behaviorTuning.postRecoveryDefenseFrames;
    postRecoveryThreatParryAttempted = false;
  }
  const postRecoveryDefenseActive = postRecoveryDefenseFramesRemaining > 0
    && playerHasControl
    && opponent.helpless <= 0
    && opponent.recovering <= 0
    && !state.winner;

  if (
    controlReturnedThisFrame
    && behaviorTuning.postControlSteeringFrames > 0
    && playerHasControl
    && opponent.helpless <= 0
    && opponent.recovering <= 0
    && distance <= 24
    && !state.winner
  ) {
    postControlSteeringFramesRemaining = behaviorTuning.postControlSteeringFrames;
  }

  const recoveryPostureTriggered = controlReturnedThisFrame
    && (recoveryPolicyId !== 'legacy' || behaviorTuning.postRecoverySpacingFrames > 0);
  const clashPostureTriggered = clashStartedThisFrame
    && (clashPolicyId !== 'legacy' || behaviorTuning.postClashSpacingFrames > 0);
  if (
    (recoveryPostureTriggered || clashPostureTriggered)
    && playerHasControl
    && !state.winner
  ) {
    const durationRoll = nextAiRoll(recoveryRngState);
    recoveryRngState = durationRoll.rngState;
    const modeRoll = nextAiRoll(recoveryRngState);
    recoveryRngState = modeRoll.rngState;
    const escapeRoll = nextAiRoll(recoveryRngState);
    recoveryRngState = escapeRoll.rngState;
    const configuredPostureFrames = recoveryPostureTriggered
      ? behaviorTuning.postRecoverySpacingFrames
      : behaviorTuning.postClashSpacingFrames;
    postRecoveryFramesRemaining = configuredPostureFrames > 0
      ? configuredPostureFrames
      : Math.max(
        1,
        Math.round(profile.postRecoveryDecisionFrames * (0.75 + durationRoll.roll * 0.5)),
      );
    const retreatChance = clamp01(
      profile.postRecoveryRetreatChance + behaviorTuning.postEventRetreatChanceOffset,
    );
    postRecoveryMode = distance <= 24 || modeRoll.roll < retreatChance
      ? 'retreat'
      : 'orbit';
    const escapeRangeMultiplier = distance <= 12 ? 1 : distance <= 24 ? 0.55 : 0;
    const configuredRecoveryEscape = behaviorTuning.postRecoverySpacingFrames > 0
      && behaviorTuning.postRecoverySuperBoostChance > 0;
    const recoveryEscapeChance = recoveryPolicyId === 'evasive'
      ? clamp01(
        profile.postRecoverySuperBoostChance + behaviorTuning.postRecoverySuperBoostChance,
      )
      : behaviorTuning.postRecoverySuperBoostChance;
    postRecoveryUseSuperBoost = recoveryPostureTriggered
      && (recoveryPolicyId === 'evasive' || configuredRecoveryEscape)
      && escapeRoll.roll < recoveryEscapeChance * escapeRangeMultiplier;
    reactionFramesRemaining = Math.max(reactionFramesRemaining, postRecoveryFramesRemaining);
  }
  const postRecoveryDecisionActive = postRecoveryFramesRemaining > 0
    && playerHasControl
    && opponent.helpless <= 0
    && opponent.recovering <= 0;
  const postControlSteeringActive = postControlSteeringFramesRemaining > 0
    && !postRecoveryDecisionActive
    && playerHasControl
    && opponent.helpless <= 0
    && opponent.recovering <= 0
    && !state.winner;
  const tacticalRepositionActive = tacticalRepositionFramesRemaining > 0
    && playerHasNeutralControl
    && opponentHasNeutralControl
    && !incomingProjectileClose
    && !opponentOpen
    && !state.winner;
  if (tacticalRepositionFramesRemaining > 0 && !tacticalRepositionActive) {
    tacticalRepositionFramesRemaining = 0;
    // Reposition owns both locks while active. Cancelling for a threat or finish
    // must not leave the fighter unable to take the action that caused the cancel.
    decisionLockFrames = 0;
    reactionFramesRemaining = 0;
  }

  if (maneuverFramesRemaining <= 0) {
    const maneuverRoll = nextAiRoll(rngState);
    rngState = maneuverRoll.rngState;
    strafeSign = maneuverRoll.roll < 0.5 ? -1 : 1;
    maneuverFramesRemaining = Math.round(18 + (1 - profile.errorRate) * 18 + maneuverRoll.roll * 12);
  }

  const applyTacticalRepositionMovement = (): void => {
    movementIntent = 'tactical_reposition';
    const targetDistance = Math.max(28, pressureDistance + 17);
    const rangeBias = clampAxis((distance - targetDistance) / 10) * 0.52;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 0.82 : 0.16;
    input.moveX = clampAxis(
      dirX * rangeBias + tangentX * 0.9 + toCenterX * centerBias,
    );
    input.moveY = clampAxis(
      dirY * rangeBias + tangentY * 0.9 + toCenterY * centerBias,
    );
    input.boost = false;
    input.superBoost = false;
  };

  if (incomingProjectileClose) {
    movementIntent = 'projectile_evade';
    input.moveX = clampAxis(-projectileThreat.incomingDirY * strafeSign + toCenterX * 0.55);
    input.moveY = clampAxis(projectileThreat.incomingDirX * strafeSign + toCenterY * 0.55);
    input.boost = incomingProjectileUrgent && player.fuel > player.maxFuel * 0.08;
  } else if (postRecoveryDecisionActive) {
    movementIntent = 'post_event_spacing';
    const retreatBias = postRecoveryMode === 'retreat' ? -1 : -0.18;
    const orbitBias = postRecoveryMode === 'retreat' ? 0.28 : 0.94;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 0.72 : 0.28;
    input.moveX = clampAxis(
      dirX * retreatBias + tangentX * orbitBias + toCenterX * centerBias,
    );
    input.moveY = clampAxis(
      dirY * retreatBias + tangentY * orbitBias + toCenterY * centerBias,
    );
    input.superBoost = postRecoveryUseSuperBoost
      && player.superBoost <= 0
      && player.fuel > player.maxFuel * 0.3;
  } else if (postControlSteeringActive) {
    movementIntent = 'post_event_spacing';
    const retreatBias = distance < 18 ? -0.92 : -0.62;
    const orbitBias = distance < 18 ? 0.46 : 0.7;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 1.05 : 0.24;
    input.moveX = clampAxis(
      dirX * retreatBias + tangentX * orbitBias + toCenterX * centerBias,
    );
    input.moveY = clampAxis(
      dirY * retreatBias + tangentY * orbitBias + toCenterY * centerBias,
    );
  } else if (tacticalRepositionActive) {
    applyTacticalRepositionMovement();
  } else if (neutralHoldActive) {
    movementIntent = 'neutral_hold';
    const rangeBias = clampAxis((distance - behaviorTuning.neutralHoldDistance) / 12) * 0.34;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 0.72 : 0;
    input.moveX = clampAxis(dirX * rangeBias + tangentX * 0.94 + toCenterX * centerBias);
    input.moveY = clampAxis(dirY * rangeBias + tangentY * 0.94 + toCenterY * centerBias);
  } else if (opponent.helpless > 0) {
    movementIntent = 'finish_chase';
    input.moveX = clampAxis(chaseDirX * 0.96 + toCenterX * 0.08);
    input.moveY = clampAxis(chaseDirY * 0.96 + toCenterY * 0.08);
    input.boost = distance > playerMoves.dunk.hitRange + 1.5
      && player.fuel > player.maxFuel * (finishOpportunity ? 0.03 : 0.1);
    input.superBoost = distance > playerMoves.dunk.hitRange + (finishOpportunity ? 3 : 7)
      && player.fuel > player.maxFuel * (finishOpportunity ? 0.12 : 0.34)
      && (finishOpportunity || !lowFuel);
  } else if (opponent.recovering > 0) {
    movementIntent = 'recovery_chase';
    input.moveX = clampAxis(dirX * 0.92 + toCenterX * 0.15);
    input.moveY = clampAxis(dirY * 0.92 + toCenterY * 0.15);
    input.boost = distance > playerMoves.dunk.hitRange + 2 && player.fuel > player.maxFuel * 0.1;
  } else if (opponentNearDepleted) {
    movementIntent = 'depleted_target_pressure';
    input.moveX = clampAxis(dirX * 0.9 + tangentX * 0.18 + toCenterX * 0.12);
    input.moveY = clampAxis(dirY * 0.9 + tangentY * 0.18 + toCenterY * 0.12);
    input.boost = distance > pressureDistance * 0.78 && player.fuel > player.maxFuel * 0.04;
    input.superBoost = distance > pressureDistance + 8
      && player.fuel > player.maxFuel * 0.16;
  } else if (lowFuel && distance < pressureDistance + 4.5) {
    movementIntent = 'low_fuel_retreat';
    input.moveX = clampAxis(-dirX * 0.82 + tangentX * 0.45 + toCenterX * 0.3);
    input.moveY = clampAxis(-dirY * 0.82 + tangentY * 0.45 + toCenterY * 0.3);
    input.boost = player.fuel > player.maxFuel * 0.07;
  } else if (opponentControlReturnObserveActive) {
    movementIntent = 'commitment_observe';
    const targetDistance = Math.max(24, pressureDistance + 12);
    const retreatBias = distance < targetDistance
      ? -clamp01((targetDistance - distance) / 12) * 0.55
      : 0;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 0.72 : 0.18;
    input.moveX = clampAxis(
      dirX * retreatBias + tangentX * 0.88 + toCenterX * centerBias,
    );
    input.moveY = clampAxis(
      dirY * retreatBias + tangentY * 0.88 + toCenterY * centerBias,
    );
  } else if (commitmentResetActive) {
    movementIntent = 'commitment_reset';
    const resetDistance = Math.max(27, pressureDistance + 17);
    const retreatBias = distance < resetDistance || separationSpeed < 0 ? -0.82 : 0;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 0.72 : 0;
    input.moveX = clampAxis(
      dirX * retreatBias + tangentX * 0.72 + toCenterX * centerBias,
    );
    input.moveY = clampAxis(
      dirY * retreatBias + tangentY * 0.72 + toCenterY * centerBias,
    );
  } else if (commitmentObserveActive) {
    movementIntent = 'commitment_observe';
    const targetDistance = Math.max(27, pressureDistance + 17);
    const deepPressure = distance < 24;
    const rangeBias = clampAxis((distance - targetDistance) / 10) * (deepPressure ? 0.82 : 0.34);
    const orbitBias = deepPressure ? 0.58 : 0.9;
    const centerBias = centerDistance > ARENA_RADIUS * 0.72 ? 0.72 : 0;
    input.moveX = clampAxis(
      dirX * rangeBias + tangentX * orbitBias + toCenterX * centerBias,
    );
    input.moveY = clampAxis(
      dirY * rangeBias + tangentY * orbitBias + toCenterY * centerBias,
    );
  } else if (commitmentPressActive) {
    movementIntent = 'commitment_press';
    input.moveX = clampAxis(dirX * 0.82 + tangentX * 0.34 + toCenterX * 0.12);
    input.moveY = clampAxis(dirY * 0.82 + tangentY * 0.34 + toCenterY * 0.12);
    input.boost = distance > pressureDistance + 8
      && player.fuel > player.maxFuel * (0.12 - profile.riskAppetite * 0.05);
  } else if (specialMove.behaviorId === 'special.projectile.v1' && friendlyProjectileCount > 0) {
    movementIntent = 'projectile_spacing';
    input.moveX = clampAxis(-dirX * 0.28 + tangentX * 0.82 + toCenterX * 0.25);
    input.moveY = clampAxis(-dirY * 0.28 + tangentY * 0.82 + toCenterY * 0.25);
  } else if (distance > pressureDistance + 5.5) {
    movementIntent = 'long_range_approach';
    const inwardBias = 0.92 * behaviorTuning.neutralApproachScale;
    const orbitBias = 0.16 + neutralApproachReduction * 0.76;
    input.moveX = clampAxis(dirX * inwardBias + tangentX * orbitBias);
    input.moveY = clampAxis(dirY * inwardBias + tangentY * orbitBias);
    input.boost = distance > neutralBoostDistance
      && player.fuel > player.maxFuel * (0.12 - profile.riskAppetite * 0.05);
    input.superBoost = distance > pressureDistance + 11
      && player.fuel > player.maxFuel * 0.3
      && !lowFuel
      && (profile.riskAppetite > 0.55 || opponentOpen);
  } else if (distance > pressureDistance * 0.64) {
    movementIntent = 'mid_range_orbit';
    const inwardBias = 0.55 * behaviorTuning.neutralApproachScale;
    const orbitBias = 0.6 + neutralApproachReduction * 0.32;
    input.moveX = clampAxis(dirX * inwardBias + tangentX * orbitBias + toCenterX * 0.15);
    input.moveY = clampAxis(dirY * inwardBias + tangentY * orbitBias + toCenterY * 0.15);
  } else {
    movementIntent = 'close_range_orbit';
    const closeRangeRetreat = specialMove.behaviorId === 'special.projectile.v1' || lowFuel || opponent.parry > 0;
    const closeRangeBias = closeRangeRetreat
      ? -0.42
      : 0.1 * behaviorTuning.neutralApproachScale;
    input.moveX = clampAxis(dirX * closeRangeBias + tangentX * 0.92 + toCenterX * 0.22);
    input.moveY = clampAxis(dirY * closeRangeBias + tangentY * 0.92 + toCenterY * 0.22);
  }

  const mistakeSample = nextAiRoll(rngState);
  rngState = mistakeSample.rngState;
  const shouldMakeMistake = !finishOpportunity && mistakeSample.roll < profile.errorRate;
  if (shouldMakeMistake) {
    movementIntent = 'mistake_drift';
    const driftSample = nextAiRoll(rngState);
    rngState = driftSample.rngState;
    const drift = driftSample.roll < 0.5 ? -1 : 1;
    input.moveX = clampAxis(input.moveX * 0.3 + tangentX * drift * 0.7 - dirX * 0.25);
    input.moveY = clampAxis(input.moveY * 0.3 + tangentY * drift * 0.7 - dirY * 0.25);
    input.boost = false;
    input.superBoost = false;
  }

  if (!playerHasControl) {
    movementIntent = 'uncontrolled';
    input.moveX = 0;
    input.moveY = 0;
    input.boost = false;
    input.superBoost = false;
  }

  let naturalRecoveryImminent = false;
  let urgentBreak = false;
  let plannedBreak = false;
  let breakSelectionRoll: number | null = null;
  let breakWeight = 0;
  if (!state.winner && player.helpless > 0 && player.launchBreaks > 0) {
    const helplessSpeed = Math.hypot(player.vel.x, player.vel.y);
    const naturalReleaseSpeed = state.tuning.boostHoldSpeed
      * playerStats.boostSpeedMultiplier
      * playerMoves.boost.holdSpeedMultiplier
      * state.tuning.helplessReleaseSpeedRatio;
    naturalRecoveryImminent = player.helpless <= 0.45
      || helplessSpeed <= naturalReleaseSpeed * 1.12;
    urgentBreak = boundaryRisk || committedFinishThreat;
    plannedBreak = launchBreakPlanned
      && launchBreakDelayFramesRemaining <= 0
      && !naturalRecoveryImminent;
    if (urgentBreak || plannedBreak) {
      const breakRoll = nextAiRoll(rngState);
      rngState = breakRoll.rngState;
      breakSelectionRoll = breakRoll.roll;
      const urgencyMultiplier = boundaryRisk
        ? 1.1
        : committedFinishThreat
          ? 1
          : 0.72 + profile.riskAppetite * 0.18;
      breakWeight = clamp01(profile.actionWeights.breakLaunch * urgencyMultiplier);
      if (breakRoll.roll < breakWeight) {
        input.breakLaunch = true;
      }
    }
  }

  if (dunkCommitReady) {
    input.dunk = true;
  }

  const decisionLockAtDecision = decisionLockFrames;
  const reactionFramesAtDecision = reactionFramesRemaining;
  let committedLaunchGuardRoll: number | null = null;
  let committedLaunchGuardTriggered = false;
  if (
    opponentLaunchStartedThisFrame
    && opponentLaunchThreatening
    && behaviorTuning.committedLaunchGuardChance > 0
    && opponent.launchStartup + Number.EPSILON >= framesToSeconds(specialMove.timing.startupFrames)
    && !shouldMakeMistake
    && !input.dunk
    && canChooseTacticalAction
    && specialMove.behaviorId === 'special.block_guard.v1'
    && player.cool.special <= 0
    && player.fuel >= specialFuelCost
  ) {
    const guardSample = nextAiRoll(recoveryRngState);
    recoveryRngState = guardSample.rngState;
    committedLaunchGuardRoll = guardSample.roll;
    committedLaunchGuardTriggered = guardSample.roll < behaviorTuning.committedLaunchGuardChance;
    if (committedLaunchGuardTriggered) {
      input.special = true;
      input.launch = false;
      input.dunk = false;
      input.parry = false;
      decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 3));
      reactionFramesRemaining = profile.reactionDelayFrames;
    }
  }
  let postRecoveryDefensiveSpecialRoll: number | null = null;
  let postRecoveryDefensiveSpecialTriggered = false;
  if (
    controlReturnedThisFrame
    && postRecoveryDefenseActive
    && behaviorTuning.postRecoveryDefensiveSpecialChance > 0
    && !shouldMakeMistake
    && !input.dunk
    && !input.special
    && canChooseTacticalAction
    && decisionLockFrames <= 0
    && reactionFramesRemaining <= 0
    && specialMove.behaviorId === 'special.block_guard.v1'
    && player.cool.special <= 0
    && player.fuel >= specialFuelCost
    && !opponentThreatening
  ) {
    const defensiveSpecialSample = nextAiRoll(recoveryRngState);
    recoveryRngState = defensiveSpecialSample.rngState;
    postRecoveryDefensiveSpecialRoll = defensiveSpecialSample.roll;
    postRecoveryDefensiveSpecialTriggered = defensiveSpecialSample.roll
      < behaviorTuning.postRecoveryDefensiveSpecialChance;
    if (postRecoveryDefensiveSpecialTriggered) {
      input.special = true;
      decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 3));
      reactionFramesRemaining = profile.reactionDelayFrames;
    }
  }
  let postRecoveryThreatParryRoll: number | null = null;
  let postRecoveryThreatParryTriggered = false;
  if (
    postRecoveryDefenseActive
    && !postRecoveryThreatParryAttempted
    && behaviorTuning.postRecoveryThreatParryChance > 0
    && !shouldMakeMistake
    && !input.dunk
    && !input.special
    && canChooseTacticalAction
    && decisionLockFrames <= 0
    && reactionFramesRemaining <= 0
    && player.parry <= 0
    && (opponentParryableThreatening || incomingProjectileUrgent)
  ) {
    const threatParrySample = nextAiRoll(recoveryRngState);
    recoveryRngState = threatParrySample.rngState;
    postRecoveryThreatParryAttempted = true;
    postRecoveryThreatParryRoll = threatParrySample.roll;
    postRecoveryThreatParryTriggered = threatParrySample.roll
      < behaviorTuning.postRecoveryThreatParryChance;
    if (postRecoveryThreatParryTriggered) {
      input.parry = true;
      decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 3));
      reactionFramesRemaining = profile.reactionDelayFrames;
    }
  }

  let launchReady = false;
  let specialReady = false;
  let dunkReady = dunkCommitReady;
  let parryReady = false;
  let repositionReady = false;
  let launchWeight = 0;
  let specialWeight = 0;
  let dunkWeight = dunkCommitReady
    ? profile.actionWeights.dunk * (0.9 + profile.riskAppetite * 0.45)
    : 0;
  let parryWeight = 0;
  let repositionWeight = 0;
  let repositionSelected = false;
  let selectionRoll: number | null = null;

  if (
    !shouldMakeMistake
    && !input.dunk
    && !input.parry
    && !input.special
    && decisionLockFrames <= 0
    && reactionFramesRemaining <= 0
    && canChooseTacticalAction
    && !postCommitmentDecisionActive
    && !postRecoveryDecisionActive
    && !neutralHoldActive
    && !commitmentOffenseSuppressed
  ) {
    launchReady = player.cool.launch <= 0
      && opponent.helpless <= 0
      && distance < pressureDistance + profile.riskAppetite * 1.4
      && opponent.parry <= 0
      && !incomingProjectileUrgent
      && !postRecoveryDefenseActive;
    const movementDashSuppressed = postControlSteeringActive
      && specialMove.behaviorId === 'special.movement_dash.v1';
    specialReady = player.cool.special <= 0
      && player.fuel >= specialFuelCost
      && !movementDashSuppressed;
    dunkReady = dunkCommitReady;
    parryReady = player.parry <= 0
      && (opponentParryableThreatening || incomingProjectileUrgent);
    const repositionTargetDistance = Math.max(28, pressureDistance + 17);
    repositionReady = behaviorTuning.repositionWeightScale > 0
      && tacticalRepositionOpportunityFramesRemaining > 0
      && opponentHasNeutralControl
      && !opponentOpen
      && !incomingProjectileClose
      && !finishOpportunity
      && distance <= repositionTargetDistance + 12;

    if (parryReady && incomingProjectileUrgent && specialMove.behaviorId !== 'special.block_guard.v1') {
      input.parry = true;
      decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 3));
      reactionFramesRemaining = profile.reactionDelayFrames;
    } else {
      const distancePressure = clamp01(1 - distance / (pressureDistance + 4));
      launchWeight = launchReady
        ? profile.actionWeights.launch
          * (0.28 + distancePressure + profile.riskAppetite * 0.22)
          * (opponentOpen ? 1.18 : 1)
          * (opponentNearDepleted ? 2.4 : 1)
        : 0;

      specialWeight = 0;
      if (specialReady) {
        switch (specialMove.behaviorId) {
          case 'special.projectile.v1':
            specialWeight = profile.actionWeights.special
              * (projectileLane ? 1.15 : 0.2)
              * (friendlyProjectileCount === 0 ? 1 : 0.18)
              * (incomingProjectileClose ? 0.25 : 1);
            break;
          case 'special.movement_dash.v1':
            specialWeight = profile.actionWeights.special
              * ((distance > 7 && distance < specialMove.size.range + 4) ? 0.82 : 0.18)
              * (opponentOpen ? 1.35 : 1)
              * (lowFuel ? 0.45 : 1)
              * (commitmentPressActive && launchReady ? 0.18 : 1);
            break;
          case 'special.block_guard.v1':
            if (opponent.helpless <= 0 && !opponentNearDepleted) {
              const guardReadMultiplier = opponentParryableThreatening || incomingProjectileClose
                ? 1.28
                : !commitmentPressActive && distance < pressureDistance + 2
                  ? 0.38
                  : 0;
              specialWeight = profile.actionWeights.special * guardReadMultiplier;
            }
            break;
          case 'special.command_grab.v1':
            specialWeight = profile.actionWeights.special
              * ((distance < specialMove.size.range) ? 1.1 : 0.1)
              * (opponentOpen ? 1.25 : 0.7);
            break;
          default:
            specialWeight = 0;
            break;
        }
        if (opponentNearDepleted && opponent.helpless <= 0) {
          specialWeight *= 0.2;
        }
      }

      dunkWeight = dunkReady
        ? profile.actionWeights.dunk * (0.9 + profile.riskAppetite * 0.45)
        : 0;
      parryWeight = parryReady
        ? profile.actionWeights.parry
          * ((incomingProjectileUrgent || opponentParryableThreatening) ? 1.2 : 0.65)
          * (specialMove.behaviorId === 'special.block_guard.v1' ? 0.7 : 1)
        : 0;
      if (repositionReady) {
        const crowding = clamp01((repositionTargetDistance - distance) / 18);
        const closingPressure = clamp01(-separationSpeed / 36);
        repositionWeight = behaviorTuning.repositionWeightScale
          * (0.42 + crowding * 0.9 + closingPressure * 0.28)
          * (1.12 - profile.riskAppetite * 0.28)
          * (controlReturnedThisFrame ? 1.25 : 1)
          * (lowFuel ? 1.18 : 1)
          * (opponentNearDepleted ? 0.45 : 1);
      }
      const totalWeight = launchWeight
        + specialWeight
        + dunkWeight
        + parryWeight
        + repositionWeight;

      if (totalWeight > 0) {
        const pickSample = nextAiRoll(rngState);
        rngState = pickSample.rngState;
        selectionRoll = pickSample.roll;
        let pick = pickSample.roll * totalWeight;
        if (pick < launchWeight) {
          input.launch = true;
        } else {
          pick -= launchWeight;
          if (pick < specialWeight) {
            input.special = true;
          } else {
            pick -= specialWeight;
            if (pick < dunkWeight) {
              input.dunk = true;
            } else {
              pick -= dunkWeight;
              if (pick < parryWeight) {
                input.parry = true;
              } else if (repositionWeight > 0) {
                repositionSelected = true;
              }
            }
          }
        }
        if (repositionSelected) {
          const repositionFrames = Math.max(
            8,
            Math.round(10 + (1 - profile.riskAppetite) * 12),
          );
          tacticalRepositionFramesRemaining = repositionFrames;
          tacticalRepositionOpportunityFramesRemaining = 0;
          decisionLockFrames = repositionFrames;
          reactionFramesRemaining = Math.max(profile.reactionDelayFrames, repositionFrames);
          applyTacticalRepositionMovement();
        } else {
          decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 4));
          reactionFramesRemaining = profile.reactionDelayFrames;
        }
      }
    }
  }

  if (
    !shouldMakeMistake
    && !committedLaunchGuardTriggered
    && opponentParryableThreatening
    && player.parry <= 0
    && canChooseTacticalAction
    && !input.special
  ) {
    const parrySample = nextAiRoll(rngState);
    rngState = parrySample.rngState;
    const parryRoll = parrySample.roll;
    if (!input.parry && parryRoll > 1 - clamp01(profile.actionWeights.parry * 0.45)) {
      selectionRoll = parryRoll;
      input.parry = true;
      input.launch = false;
      input.special = false;
      input.dunk = false;
      if (player.superBoost <= 0) {
        input.superBoost = false;
      }
    }
  }

  const superBoostStartCost = playerMoves.superBoost.startFuelCost
    * state.tuning.superBoostFuelMultiplier
    * playerStats.superFuelMultiplier;
  const hasMovementIntent = input.moveX * input.moveX + input.moveY * input.moveY > 0;
  if (
    input.superBoost
    && player.superBoost <= 0
    && (
      !playerHasControl
      || player.endLag > 0
      || !hasMovementIntent
      || player.fuel < superBoostStartCost
    )
  ) {
    input.superBoost = false;
  }
  const requestedTacticalAction = input.launch
    || input.special
    || input.dunk
    || input.parry
    || input.breakLaunch;
  if (requestedTacticalAction) {
    superBoostStartsSinceTacticalAction = 0;
    tacticalRepositionOpportunityFramesRemaining = 0;
  }
  const startingSuperBoost = input.superBoost && player.superBoost <= 0;
  if (
    startingSuperBoost
    && (superBoostRecommitFrames > 0 || superBoostStartsSinceTacticalAction >= 2)
  ) {
    input.superBoost = false;
  }
  if (input.superBoost && player.superBoost <= 0) {
    superBoostStartsSinceTacticalAction += 1;
    superBoostRecommitFrames = Math.max(
      superBoostRecommitFrames,
      Math.round(18 + (1 - profile.riskAppetite) * 18),
    );
  }
  if (input.superBoost) {
    input.boost = false;
  } else if (input.boost && !player.boostActive && player.cool.boost > 0) {
    input.boost = false;
  }

  const tacticalGateReason = state.winner
    ? 'match_complete'
    : !playerHasControl
      ? player.helpless > 0
        ? 'helpless'
        : player.stunned > 0
          ? 'stunned'
          : 'recovering'
      : player.endLag > 0
        ? 'end_lag'
        : hasAttackCommitment(player)
          ? 'action_committed'
          : shouldMakeMistake
            ? 'deliberate_error'
            : decisionLockAtDecision > 0
              ? 'decision_lock'
              : postCommitmentDecisionActive
                ? 'post_commitment_read'
              : reactionFramesAtDecision > 0
                ? 'reaction_delay'
                : commitmentOffenseSuppressed
                  ? opponentControlReturnObserveActive
                    ? 'opponent_control_return_observe'
                    : commitmentMode === 'reset'
                      ? 'commitment_reset'
                      : 'commitment_observe'
                : postRecoveryDecisionActive
                  ? 'post_event_spacing'
                  : neutralHoldActive
                    ? 'neutral_hold'
                    : postRecoveryThreatParryTriggered
                      ? 'post_control_threat_parry_priority'
                      : postRecoveryDefensiveSpecialTriggered
                        ? 'post_control_defensive_special_priority'
                      : input.dunk
                        ? 'finish_dunk_priority'
                        : null;
  const intrinsicLaunchReady = player.cool.launch <= 0
    && opponent.helpless <= 0
    && distance < pressureDistance + profile.riskAppetite * 1.4
    && opponent.parry <= 0
    && !incomingProjectileUrgent
    && !postRecoveryDefenseActive;
  const intrinsicSpecialReady = player.cool.special <= 0
    && player.fuel >= specialFuelCost
    && !(postControlSteeringActive && specialMove.behaviorId === 'special.movement_dash.v1');
  const intrinsicParryReady = player.parry <= 0
    && (opponentParryableThreatening || incomingProjectileUrgent);
  const roundTraceNumber = (value: number): number => Math.round(value * 1_000) / 1_000;
  const tacticalCandidate = (
    ready: boolean,
    weight: number,
    unavailableReason: string,
  ): AiActionCandidateTrace => ({
    eligible: tacticalGateReason === null && ready,
    weight: roundTraceNumber(weight),
    reason: tacticalGateReason ?? (ready ? 'ready' : unavailableReason),
  });
  const launchUnavailableReason = player.cool.launch > 0
    ? 'cooldown'
    : opponent.helpless > 0
      ? 'target_helpless'
      : postRecoveryDefenseActive
        ? 'post_control_defense'
      : distance >= pressureDistance + profile.riskAppetite * 1.4
        ? 'out_of_range'
        : opponent.parry > 0
          ? 'target_parry_active'
          : 'projectile_threat';
  const specialUnavailableReason = player.cool.special > 0
    ? 'cooldown'
    : player.fuel < specialFuelCost
      ? 'insufficient_fuel'
      : postControlSteeringActive && specialMove.behaviorId === 'special.movement_dash.v1'
        ? 'post_control_dash_suppressed'
      : 'unsupported_context';
  const dunkUnavailableReason = player.cool.dunk > 0
    ? 'cooldown'
    : opponent.helpless <= 0
      ? 'target_not_helpless'
      : distance >= dunkCommitRange
        ? 'out_of_range'
        : 'target_moving_too_fast';
  const parryUnavailableReason = player.parry > 0 ? 'already_active' : 'no_immediate_threat';
  const repositionUnavailableReason = behaviorTuning.repositionWeightScale <= 0
    ? 'disabled'
    : tacticalRepositionOpportunityFramesRemaining <= 0
      ? 'no_post_control_opportunity'
    : finishOpportunity
      ? 'finish_opportunity'
      : !opponentHasNeutralControl || opponentOpen
        ? 'opponent_not_neutral'
        : incomingProjectileClose
          ? 'projectile_threat'
          : 'outside_reposition_range';
  const breakEligible = !state.winner
    && player.helpless > 0
    && player.launchBreaks > 0
    && (urgentBreak || plannedBreak);
  const breakReason = state.winner
    ? 'match_complete'
    : player.helpless <= 0
      ? 'not_launched'
      : player.launchBreaks <= 0
        ? 'no_breaks_remaining'
        : breakEligible
          ? 'ready'
          : naturalRecoveryImminent
            ? 'natural_recovery_imminent'
            : launchBreakDelayFramesRemaining > 0
              ? 'bait_delay'
              : !urgentBreak && !launchBreakPlanned
                ? 'not_planned'
                : 'held_for_later';
  const selectedAction: AiTacticalAction | null = input.breakLaunch
    ? 'launch_break'
    : input.dunk
      ? 'dunk'
      : input.parry
        ? 'parry'
        : input.special
          ? 'special'
          : input.launch
            ? 'launch'
            : null;
  const selectedReason = selectedAction === 'launch_break'
    ? urgentBreak ? 'urgent_survival_break' : 'planned_delayed_break'
    : selectedAction === 'dunk'
      ? finishOpportunity ? 'zero_fuel_finish_window' : 'helpless_follow_up'
      : selectedAction === 'parry'
        ? postRecoveryThreatParryTriggered
          ? 'post_control_threat_parry'
          : incomingProjectileUrgent
            ? 'incoming_projectile'
            : 'opponent_commitment'
        : selectedAction === 'special'
          ? committedLaunchGuardTriggered
            ? 'committed_launch_guard'
            : postRecoveryDefensiveSpecialTriggered
              ? 'post_control_defensive_special'
              : specialMove.behaviorId
          : selectedAction === 'launch'
            ? opponentOpen ? 'punish_opening' : 'weighted_pressure_choice'
            : repositionSelected
              ? 'weighted_reposition_choice'
            : breakEligible && breakSelectionRoll !== null
              ? 'launch_break_roll_failed'
              : tacticalGateReason
                ?? (postControlSteeringActive ? 'post_control_steering' : 'movement_only');
  const decision: AiDecisionTrace = {
    schemaVersion: AI_DECISION_TRACE_SCHEMA_VERSION,
    playerId,
    profileId: profile.id,
    controllerRoleId: 'adaptive',
    gameTimeSeconds: roundTraceNumber(state.gameTime),
    movementIntent,
    selectedAction,
    selectedReason,
    selectionRoll: selectionRoll
      ?? breakSelectionRoll
      ?? committedLaunchGuardRoll
      ?? postRecoveryThreatParryRoll
      ?? postRecoveryDefensiveSpecialRoll,
    mistakeRoll: roundTraceNumber(mistakeSample.roll),
    context: {
      distance: roundTraceNumber(distance),
      fuelRatio: roundTraceNumber(player.fuel / Math.max(1, player.maxFuel)),
      opponentFuelRatio: roundTraceNumber(opponent.fuel / Math.max(1, opponent.maxFuel)),
      incomingProjectileDistance: Number.isFinite(projectileThreat.incomingProjectileDistance)
        ? roundTraceNumber(projectileThreat.incomingProjectileDistance)
        : null,
      finishOpportunity,
    },
    gates: {
      hasControl: playerHasControl,
      canChooseTacticalAction,
      decisionLockFrames: decisionLockAtDecision,
      reactionFramesRemaining: reactionFramesAtDecision,
      neutralHoldActive,
      postEventSpacingActive: postRecoveryDecisionActive
        || postControlSteeringActive
        || opponentControlReturnObserveActive,
      deliberateError: shouldMakeMistake,
    },
    candidates: {
      launch: tacticalCandidate(intrinsicLaunchReady, launchWeight, launchUnavailableReason),
      special: committedLaunchGuardRoll !== null
        ? {
          eligible: true,
          weight: roundTraceNumber(behaviorTuning.committedLaunchGuardChance),
          reason: committedLaunchGuardTriggered
            ? 'committed_launch_guard'
            : 'committed_launch_guard_roll_failed',
        }
        : postRecoveryDefensiveSpecialTriggered
        ? {
          eligible: true,
          weight: roundTraceNumber(behaviorTuning.postRecoveryDefensiveSpecialChance),
          reason: 'post_control_defensive_special',
        }
        : tacticalCandidate(intrinsicSpecialReady, specialWeight, specialUnavailableReason),
      dunk: dunkCommitReady
        ? { eligible: true, weight: roundTraceNumber(dunkWeight), reason: 'finish_window' }
        : tacticalCandidate(false, dunkWeight, dunkUnavailableReason),
      parry: postRecoveryThreatParryTriggered
        ? {
          eligible: true,
          weight: roundTraceNumber(behaviorTuning.postRecoveryThreatParryChance),
          reason: 'post_control_threat_parry',
        }
        : tacticalCandidate(intrinsicParryReady, parryWeight, parryUnavailableReason),
      launch_break: {
        eligible: breakEligible,
        weight: roundTraceNumber(breakWeight),
        reason: breakReason,
      },
      reposition: tacticalCandidate(
        repositionReady,
        repositionWeight,
        repositionUnavailableReason,
      ),
    },
  };

  return {
    input,
    decision,
    next: {
      rngState,
      recoveryRngState,
      decisionLockFrames,
      reactionFramesRemaining,
      postCommitmentDecisionFramesRemaining,
      profileId: profile.id,
      maneuverFramesRemaining,
      strafeSign,
      superBoostRecommitFrames,
      superBoostStartsSinceTacticalAction,
      wasHelpless,
      launchBreakDelayFramesRemaining,
      launchBreakPlanned,
      postRecoveryFramesRemaining,
      postControlSteeringFramesRemaining,
      tacticalRepositionOpportunityFramesRemaining,
      tacticalRepositionFramesRemaining,
      postRecoveryMode,
      postRecoveryUseSuperBoost,
      postRecoveryDefenseFramesRemaining,
      postRecoveryThreatParryAttempted,
      observedOpponentLaunchCommitment,
      observedClashFlash,
      recoveryPolicyId,
      clashPolicyId,
      neutralHoldFramesRemaining,
      neutralHoldPending,
      wasInPressureBand,
      commitmentMode,
      commitmentFramesRemaining,
      commitmentInitiativeOwner,
      opponentControlReturnObserveFramesRemaining,
      wasStrikeCommitted,
      wasOpponentStrikeCommitted,
      wasPlayerWithoutControl,
      wasOpponentWithoutControl,
      pursuitPolicyId,
      behaviorTuning,
    },
  };
}

export function buildFrameInputWithAi(
  localInput: PlayerFrameInput,
  aiInput: PlayerFrameInput,
  aiPlayerId: PlayerId,
): FrameInput {
  if (aiPlayerId === 'P1') {
    return {
      p1: aiInput,
      p2: localInput,
    };
  }
  return {
    p1: localInput,
    p2: aiInput,
  };
}
