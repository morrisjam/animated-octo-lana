import { createDefaultTuning, sanitiseTuning } from '../sim/tuning';
import {
  AI_DECISION_CANDIDATES,
  createDefaultAiBehaviorTuning,
  fingerprintAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
} from '../sim/ai';
import type { AiDecisionTelemetrySummary } from '../sim/aiDecisionTelemetry';
import {
  AI_CONTROLLER_ROLE_DEFINITIONS,
  createDefaultAiControllerRoles,
  fingerprintAiControllerRoles,
  resolveAiControllerRole,
  sanitiseAiControllerRoles,
  type AiControllerRoleId,
  type AiControllerRoles,
} from '../sim/aiControllerRoles';
import type { BalanceProfile } from '../sim/balanceProfiles';
import type {
  BalanceCandidatePreset,
  BalanceCandidatePresetId,
} from '../sim/balanceCandidatePresets';
import {
  resolveBalanceScenario,
  type BalanceScenario,
  type BalanceScenarioId,
} from '../sim/balanceScenarios';
import {
  getBalanceTestRecipeSelectionId,
  resolveBalanceTestRecipe,
  type BalanceTestRecipe,
  type BalanceTestRecipeId,
} from '../sim/balanceTestRecipes';
import {
  BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS,
  BALANCE_LAB_CONTROL_RETURN_ACTIONS,
  BALANCE_LAB_LOOP_STAGE_IDS,
  BALANCE_LAB_PLAYTEST_VERDICT_IDS,
  buildBalanceLabFightStory,
  buildBalanceLabFlowModel,
  buildBalanceLabRuleChanges,
  compareBalanceLabFlows,
  compareBalanceLabLoopStages,
  createBalanceLabDraft,
  createBalanceLabExperimentBundle,
  describeBalanceLabReentryContext,
  fingerprintBalanceTuning,
  parseBalanceLabDraft,
  parseFirstStoredBalanceLabDraft,
  resolveBalanceLabControlReturnReviewRange,
  resolveBalanceLabExchangeReviewFrame,
  resolveBalanceLabReentryReviewRange,
  selectLongestBalanceLabPressureExchange,
  selectMostConstrainedBalanceLabControlReturn,
  type BalanceLabCharacterControlFocus,
  type BalanceLabDiagnostic,
  type BalanceLabFlowModel,
  type BalanceLabLoopStageId,
  type BalanceLabPlaytestSampleReview,
  type BalanceLabPlaytestVerdict,
  type BalanceLabRuleChange,
  type BalanceLabScenarioIdentity,
} from '../sim/balanceLab';
import type { MatchTelemetrySummary } from '../sim/matchTelemetry';
import {
  attachBalanceReplayCandidate,
  createBalanceReplayComparison,
  selectBalanceReplaySample,
  type BalanceReplayComparison,
  type BalanceReplayVariant,
} from '../sim/balanceReplayComparison';
import type { ReplayPayload } from '../sim/replay';
import {
  cloneCharacterBalanceOverrides,
  createCharacterBalanceConfig,
  fingerprintCharacterBalanceConfig,
  fingerprintCharacterBalanceOverrides,
  sanitiseCharacterBalanceConfig,
  type CharacterBalanceConfig,
  type CharacterBalanceOverrides,
} from '../sim/characterBalance';
import { CHARACTER_BY_ID, type CharacterId } from '../sim/characters';
import type { GameTuning, PlayerId, PlayersById } from '../sim/types';
import type { AudioSettings, DynamicRangeMode } from './audio/settings';

export interface PauseMenuOptions {
  getTuning(): GameTuning;
  setTuning(tuning: GameTuning): void;
  getAudioSettings(): AudioSettings;
  setAudioSettings(settings: AudioSettings): void;
  enableDebugTab?: boolean;
  canExportTrainingTelemetry?(): boolean;
  onExportTrainingTelemetry?(): Promise<string> | string;
  canExportAiMatchTelemetry?(): boolean;
  onExportAiMatchTelemetry?(): Promise<string> | string;
  canReviewAiRound?(): boolean;
  onReviewAiRound?(request?: AiRoundReviewRequest): void;
  getAiRoundReplay?(): ReplayPayload | null;
  getBalanceSampleSequence?(): number;
  onReviewAiReplaySample?(
    payload: ReplayPayload,
    request: AiRoundReviewRequest,
    label: string,
  ): void;
  onRestartTraining?(): void;
  balanceProfiles?: readonly BalanceProfile[];
  balanceCandidatePresets?: readonly BalanceCandidatePreset[];
  balanceScenarios?: readonly BalanceScenario[];
  balanceTestRecipes?: readonly BalanceTestRecipe[];
  getBalanceProfileId?(): string;
  isBalanceTuningDirty?(): boolean;
  getActiveBalanceTuning?(): GameTuning;
  getActiveBalanceTuningFingerprint?(): string;
  onApplyBalanceProfile?(profileId: string): void;
  onApplyBalanceCandidatePreset?(presetId: BalanceCandidatePresetId): void;
  getBalanceTelemetry?(): MatchTelemetrySummary;
  getAiDecisionTelemetry?(): AiDecisionTelemetrySummary;
  getBalanceScenarioIdentity?(): BalanceLabScenarioIdentity;
  getBalanceScenarioId?(): BalanceScenarioId;
  getActiveBalanceScenarioId?(): BalanceScenarioId;
  setBalanceScenarioId?(scenarioId: BalanceScenarioId): void;
  onApplyBalanceTestRecipe?(recipeId: BalanceTestRecipeId): void;
  canRestartBalanceLab?(): boolean;
  onRestartBalanceLab?(targetFrames?: number): void;
  getBalanceLoadout?(): PlayersById<CharacterId>;
  getCharacterBalanceOverrides?(): CharacterBalanceOverrides;
  getActiveCharacterBalanceOverrides?(): CharacterBalanceOverrides;
  setCharacterBalanceOverrides?(overrides: CharacterBalanceOverrides): void;
  getActiveCharacterBalanceFingerprint?(): string;
  isCharacterBalanceDirty?(): boolean;
  canTuneAiBehavior?(): boolean;
  getAiBehaviorTuning?(): AiBehaviorTuning;
  getActiveAiBehaviorTuning?(): AiBehaviorTuning;
  setAiBehaviorTuning?(tuning: AiBehaviorTuning): void;
  getActiveAiBehaviorFingerprint?(): string;
  isAiBehaviorDirty?(): boolean;
  getAiControllerRoles?(): AiControllerRoles;
  getActiveAiControllerRoles?(): AiControllerRoles;
  getBalanceHumanPlayerId?(): PlayerId | null;
  setAiControllerRole?(playerId: PlayerId, roleId: AiControllerRoleId): void;
  isAiControllerRolesDirty?(): boolean;
}

export interface AiRoundReviewRequest {
  focusFrame: number;
  endFrame?: number;
  label: string;
}

interface TuningField {
  key: keyof GameTuning;
  label: string;
  step: number;
  min: number;
  max: number;
}

interface AudioVolumeField {
  key: keyof Pick<AudioSettings, 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'voiceVolume'>;
  label: string;
}

function bindBalanceNumberInput(
  input: HTMLInputElement,
  onValue: (value: number) => void,
): void {
  input.addEventListener('input', () => {
    const value = input.valueAsNumber;
    if (Number.isFinite(value)) {
      onValue(value);
    }
  });
  input.addEventListener('blur', () => {
    if (!Number.isFinite(input.valueAsNumber)) {
      onValue(Number.NaN);
    }
  });
}

export type AiBehaviorTuningKey = Exclude<keyof AiBehaviorTuning, 'schemaVersion'>;

interface AiBehaviorTuningField {
  key: AiBehaviorTuningKey;
  section: 'Pursuit and spacing' | 'Commitment and defense';
  label: string;
  step: number;
  min: number;
  max: number;
}

export const AI_BEHAVIOR_TUNING_FIELDS: readonly AiBehaviorTuningField[] = [
  { key: 'engagementDistanceScale', section: 'Pursuit and spacing', label: 'Engagement Distance Scale', step: 0.05, min: 0.25, max: 3 },
  { key: 'neutralApproachScale', section: 'Pursuit and spacing', label: 'Neutral Inward Drive Scale', step: 0.05, min: 0, max: 2 },
  { key: 'neutralBoostDistanceOffset', section: 'Pursuit and spacing', label: 'Neutral Boost Distance Offset', step: 1, min: 0, max: 60 },
  { key: 'neutralHoldFrames', section: 'Pursuit and spacing', label: 'Pressure-Exit Hold Frames', step: 1, min: 0, max: 240 },
  { key: 'neutralHoldDistance', section: 'Pursuit and spacing', label: 'Pressure-Exit Hold Distance', step: 1, min: 8, max: 80 },
  { key: 'commitmentObserveFrames', section: 'Commitment and defense', label: 'Commitment Observe Base Frames', step: 1, min: 0, max: 120 },
  { key: 'commitmentPressFrames', section: 'Commitment and defense', label: 'Commitment Press Frames', step: 1, min: 0, max: 180 },
  { key: 'commitmentResetFrames', section: 'Commitment and defense', label: 'Commitment Reset Frames', step: 1, min: 0, max: 120 },
  { key: 'opponentControlReturnObserveFrames', section: 'Commitment and defense', label: 'Opponent Recovery Respect Frames', step: 1, min: 0, max: 120 },
  { key: 'postClashSpacingFrames', section: 'Pursuit and spacing', label: 'Post-Clash Spacing Frames', step: 1, min: 0, max: 240 },
  { key: 'postRecoverySpacingFrames', section: 'Pursuit and spacing', label: 'Post-Recovery Spacing Frames', step: 1, min: 0, max: 240 },
  { key: 'postControlSteeringFrames', section: 'Pursuit and spacing', label: 'Post-Control Steering Frames', step: 1, min: 0, max: 120 },
  { key: 'postEventRetreatChanceOffset', section: 'Pursuit and spacing', label: 'Post-Event Retreat Chance Offset', step: 0.05, min: -1, max: 1 },
  { key: 'postRecoverySuperBoostChance', section: 'Pursuit and spacing', label: 'Recovery Escape Super Boost Chance', step: 0.05, min: 0, max: 1 },
  { key: 'reactionDelayScale', section: 'Commitment and defense', label: 'Reaction Delay Scale', step: 0.05, min: 0.25, max: 4 },
  { key: 'postCommitmentDecisionScale', section: 'Commitment and defense', label: 'Post-Commitment Read Scale', step: 0.1, min: 0, max: 4 },
  { key: 'errorRateScale', section: 'Commitment and defense', label: 'Error Rate Scale', step: 0.05, min: 0, max: 4 },
  { key: 'riskAppetiteOffset', section: 'Commitment and defense', label: 'Risk Appetite Offset', step: 0.05, min: -0.8, max: 0.8 },
  { key: 'postRecoveryDefenseFrames', section: 'Commitment and defense', label: 'Post-Control Disadvantage Defense Frames', step: 1, min: 0, max: 120 },
  { key: 'postRecoveryDefensiveSpecialChance', section: 'Commitment and defense', label: 'Post-Control Defensive Special Chance', step: 0.05, min: 0, max: 1 },
  { key: 'postRecoveryThreatParryChance', section: 'Commitment and defense', label: 'Post-Control Threat Parry Chance', step: 0.05, min: 0, max: 1 },
  { key: 'committedLaunchGuardChance', section: 'Commitment and defense', label: 'Committed Launch Guard Chance', step: 0.05, min: 0, max: 1 },
  { key: 'finishPursuitReachScale', section: 'Pursuit and spacing', label: 'Finish Dunk Pursuit Reach Scale', step: 0.05, min: 0, max: 2 },
  { key: 'repositionWeightScale', section: 'Pursuit and spacing', label: 'Tactical Reposition Weight', step: 0.05, min: 0, max: 4 },
  { key: 'launchWeightScale', section: 'Commitment and defense', label: 'Launch Commitment Weight', step: 0.05, min: 0, max: 4 },
  { key: 'specialWeightScale', section: 'Commitment and defense', label: 'Special Commitment Weight', step: 0.05, min: 0, max: 4 },
  { key: 'dunkWeightScale', section: 'Commitment and defense', label: 'Dunk Commitment Weight', step: 0.05, min: 0, max: 4 },
  { key: 'parryWeightScale', section: 'Commitment and defense', label: 'Parry Commitment Weight', step: 0.05, min: 0, max: 4 },
  { key: 'launchBreakWeightScale', section: 'Commitment and defense', label: 'Launch-Break Spend Weight', step: 0.05, min: 0, max: 4 },
];

const AI_BEHAVIOR_FIELD_BY_KEY = new Map(
  AI_BEHAVIOR_TUNING_FIELDS.map((field) => [field.key, field]),
);

interface CharacterTuningField {
  id: string;
  section: 'Archetype' | 'Launch and finish' | 'Defense and movement' | 'Special';
  label: string;
  step: number;
  min: number;
  max: number;
  path: readonly string[];
}

const TUNING_FIELDS: TuningField[] = [
  { key: 'playerMoveAccel', label: 'Movement Speed', step: 1, min: 1, max: 400 },
  { key: 'boostHoldSpeed', label: 'Boost Speed', step: 1, min: 1, max: 300 },
  { key: 'superBoostHoldSpeed', label: 'Super Boost Speed', step: 1, min: 1, max: 300 },
  { key: 'launchBasePower', label: 'Launch Base Speed', step: 1, min: 1, max: 400 },
  { key: 'launchChainBonus', label: 'Launch Chain Bonus', step: 1, min: 0, max: 100 },
  { key: 'launchHelplessSeconds', label: 'Launch Duration', step: 0.05, min: 0.1, max: 60 },
  { key: 'helplessReleaseSpeedRatio', label: 'Launch Release Speed Ratio', step: 0.01, min: 0.05, max: 2 },
  { key: 'startupClashGraceSeconds', label: 'Startup Clash Grace', step: 0.005, min: 0, max: 0.25 },
  {
    key: 'postControlCounterLaunchClashGraceSeconds',
    label: 'Recovery Counter-Launch Grace',
    step: 1 / 60,
    min: 0,
    max: 0.1,
  },
  { key: 'launchClashSeparationPadding', label: 'Clash Separation Padding', step: 0.2, min: 0, max: 40 },
  { key: 'launchClashRecoilMultiplier', label: 'Clash Recoil Scale', step: 0.02, min: 0, max: 2 },
  { key: 'chainWindowSeconds', label: 'Chain Window', step: 0.05, min: 0.1, max: 6 },
  { key: 'launchInputInfluence', label: 'Launch DI Influence', step: 0.01, min: 0, max: 1 },
  { key: 'playerVelocityDamping', label: 'Normal Damping', step: 0.001, min: 0.5, max: 0.9995 },
  { key: 'actionRecoveryControlMultiplier', label: 'Action Recovery Control', step: 0.05, min: 0, max: 1 },
  { key: 'helplessVelocityDamping', label: 'Launch Damping', step: 0.0005, min: 0.5, max: 0.9999 },
  { key: 'closeRangeSeparationPadding', label: 'Body Separation Padding', step: 0.1, min: 0, max: 30 },
  { key: 'closeRangeSeparationImpulse', label: 'Body Separation Impulse', step: 0.5, min: 0, max: 100 },
  { key: 'closeRangeCommitSeparationMultiplier', label: 'Commit Separation Multiplier', step: 0.05, min: 0, max: 1 },
  { key: 'defensiveResetDistance', label: 'Defense Reset Distance', step: 0.5, min: 0, max: 50 },
  { key: 'defensiveResetImpulse', label: 'Defense Reset Impulse', step: 0.5, min: 0, max: 150 },
  { key: 'launchBreakResetMultiplier', label: 'Launch Break Reset Scale', step: 0.05, min: 0, max: 2 },
  { key: 'naturalRecoveryResetMultiplier', label: 'Natural Recovery Reset Scale', step: 0.05, min: 0, max: 2 },
  { key: 'superBoostSteerLerp', label: 'Super Steer Lerp', step: 0.01, min: 0.01, max: 1 },
  { key: 'superBoostVelocityBlend', label: 'Super Velocity Blend', step: 0.01, min: 0.01, max: 1 },
  { key: 'superBoostWaveAmplitude', label: 'Super Zigzag Amplitude', step: 0.1, min: 0, max: 30 },
  { key: 'superBoostFuelMultiplier', label: 'Super Fuel Multiplier', step: 0.01, min: 0.01, max: 3 },
  { key: 'dunkRecoveryFuelFraction', label: 'Dunk Recovery Fuel Fraction', step: 0.01, min: 0, max: 1 },
  { key: 'dunkRecoveryDurationSeconds', label: 'Dunk Recovery Duration', step: 0.01, min: 0.1, max: 8 },
  { key: 'dunkRecoveryMoveSpeed', label: 'Dunk Recovery Move Speed', step: 0.5, min: 1, max: 300 },
];

const TUNING_FIELD_BY_KEY = new Map(TUNING_FIELDS.map((field) => [field.key, field]));

const GLOBAL_TUNING_SECTIONS: ReadonlyArray<{
  label: string;
  keys: readonly (keyof GameTuning)[];
}> = [
  {
    label: 'Pace and movement',
    keys: [
      'playerMoveAccel',
      'boostHoldSpeed',
      'superBoostHoldSpeed',
      'playerVelocityDamping',
      'actionRecoveryControlMultiplier',
      'superBoostSteerLerp',
      'superBoostVelocityBlend',
      'superBoostWaveAmplitude',
      'superBoostFuelMultiplier',
    ],
  },
  {
    label: 'Launch and control',
    keys: [
      'launchBasePower',
      'launchChainBonus',
      'launchHelplessSeconds',
      'helplessReleaseSpeedRatio',
      'startupClashGraceSeconds',
      'postControlCounterLaunchClashGraceSeconds',
      'chainWindowSeconds',
      'launchInputInfluence',
      'helplessVelocityDamping',
    ],
  },
  {
    label: 'Spacing and resets',
    keys: [
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
  },
  {
    label: 'Finish and recovery',
    keys: [
      'dunkRecoveryFuelFraction',
      'dunkRecoveryDurationSeconds',
      'dunkRecoveryMoveSpeed',
    ],
  },
];

const AUDIO_VOLUME_FIELDS: AudioVolumeField[] = [
  { key: 'masterVolume', label: 'Master Volume' },
  { key: 'musicVolume', label: 'Music Volume' },
  { key: 'sfxVolume', label: 'SFX Volume' },
  { key: 'voiceVolume', label: 'Voice Volume' },
];

const CHARACTER_TUNING_FIELDS: CharacterTuningField[] = [
  { id: 'fuel-capacity', section: 'Archetype', label: 'Fuel Capacity Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'fuelCapacityMultiplier'] },
  { id: 'move-accel', section: 'Archetype', label: 'Movement Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'moveAccelMultiplier'] },
  { id: 'boost-speed', section: 'Archetype', label: 'Boost Speed Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'boostSpeedMultiplier'] },
  { id: 'super-speed', section: 'Archetype', label: 'Super Boost Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'superBoostSpeedMultiplier'] },
  { id: 'launch-power', section: 'Archetype', label: 'Launch Power Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'launchBasePowerMultiplier'] },
  { id: 'launch-chain', section: 'Archetype', label: 'Chain Bonus Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'launchChainBonusMultiplier'] },
  { id: 'launch-duration', section: 'Archetype', label: 'Launch Duration Taken', step: 0.05, min: 0.1, max: 5, path: ['stats', 'launchDurationTakenMultiplier'] },
  { id: 'natural-recovery-reset', section: 'Archetype', label: 'Natural Recovery Reset Multiplier', step: 0.05, min: 0, max: 3, path: ['stats', 'naturalRecoveryResetMultiplier'] },
  { id: 'special-fuel-multiplier', section: 'Archetype', label: 'Special Fuel Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'specialFuelCostMultiplier'] },
  { id: 'super-fuel-multiplier', section: 'Archetype', label: 'Super Fuel Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'superFuelMultiplier'] },
  { id: 'dunk-recovery-multiplier', section: 'Archetype', label: 'Dunk Recovery Fuel Multiplier', step: 0.05, min: 0.1, max: 5, path: ['stats', 'dunkRecoveryFuelMultiplier'] },
  { id: 'launch-startup', section: 'Launch and finish', label: 'Launch Startup Frames', step: 1, min: 0, max: 600, path: ['moves', 'launch', 'startupFrames'] },
  { id: 'launch-active', section: 'Launch and finish', label: 'Launch Active Frames', step: 1, min: 1, max: 600, path: ['moves', 'launch', 'activeFrames'] },
  { id: 'launch-hit-recovery', section: 'Launch and finish', label: 'Launch Hit Recovery', step: 1, min: 0, max: 1200, path: ['moves', 'launch', 'recoveryOnHitFrames'] },
  { id: 'launch-whiff-recovery', section: 'Launch and finish', label: 'Launch Whiff Recovery', step: 1, min: 0, max: 1200, path: ['moves', 'launch', 'recoveryOnWhiffFrames'] },
  { id: 'dunk-startup', section: 'Launch and finish', label: 'Dunk Startup Frames', step: 1, min: 0, max: 600, path: ['moves', 'dunk', 'startupFrames'] },
  { id: 'dunk-active', section: 'Launch and finish', label: 'Dunk Active Frames', step: 1, min: 1, max: 600, path: ['moves', 'dunk', 'activeFrames'] },
  { id: 'dunk-range', section: 'Launch and finish', label: 'Dunk Hit Range', step: 0.25, min: 0.5, max: 100, path: ['moves', 'dunk', 'hitRange'] },
  { id: 'dunk-pursuit-speed', section: 'Launch and finish', label: 'Dunk Pursuit Speed', step: 1, min: 0, max: 500, path: ['moves', 'dunk', 'startupPursuitSpeed'] },
  { id: 'dunk-tracking', section: 'Launch and finish', label: 'Dunk Tracking Strength', step: 0.01, min: 0, max: 1, path: ['moves', 'dunk', 'startupTracking'] },
  { id: 'dunk-hit-recovery', section: 'Launch and finish', label: 'Dunk Hit Recovery', step: 1, min: 0, max: 1200, path: ['moves', 'dunk', 'recoveryOnHitFrames'] },
  { id: 'dunk-whiff-recovery', section: 'Launch and finish', label: 'Dunk Whiff Recovery', step: 1, min: 0, max: 1200, path: ['moves', 'dunk', 'recoveryOnWhiffFrames'] },
  { id: 'parry-startup', section: 'Defense and movement', label: 'Parry Startup Frames', step: 1, min: 0, max: 600, path: ['moves', 'parry', 'startupFrames'] },
  { id: 'parry-active', section: 'Defense and movement', label: 'Parry Active Frames', step: 1, min: 1, max: 600, path: ['moves', 'parry', 'activeFrames'] },
  { id: 'parry-recovery', section: 'Defense and movement', label: 'Parry Recovery Frames', step: 1, min: 0, max: 1200, path: ['moves', 'parry', 'recoveryFrames'] },
  { id: 'parry-stun', section: 'Defense and movement', label: 'Parry Counter Stun', step: 1, min: 0, max: 1200, path: ['moves', 'parry', 'counterStunFrames'] },
  { id: 'break-recovery', section: 'Defense and movement', label: 'Launch Break Recovery', step: 1, min: 0, max: 1200, path: ['moves', 'break', 'recoveryFrames'] },
  { id: 'break-retain', section: 'Defense and movement', label: 'Launch Break Velocity Retain', step: 0.05, min: 0, max: 1, path: ['moves', 'break', 'velocityRetain'] },
  { id: 'movement-fuel', section: 'Defense and movement', label: 'Movement Fuel / Second', step: 0.05, min: 0, max: 100, path: ['moves', 'movement', 'fuelPerSecond'] },
  { id: 'boost-speed-move', section: 'Defense and movement', label: 'Boost Move Multiplier', step: 0.05, min: 0.1, max: 5, path: ['moves', 'boost', 'holdSpeedMultiplier'] },
  { id: 'boost-fuel', section: 'Defense and movement', label: 'Boost Fuel / Second', step: 0.05, min: 0, max: 100, path: ['moves', 'boost', 'holdFuelPerSecond'] },
  { id: 'super-hold-speed', section: 'Defense and movement', label: 'Super Hold Speed Multiplier', step: 0.05, min: 0.1, max: 5, path: ['moves', 'superBoost', 'holdSpeedMultiplier'] },
  { id: 'super-steer', section: 'Defense and movement', label: 'Super Steering Multiplier', step: 0.05, min: 0.1, max: 5, path: ['moves', 'superBoost', 'steerLerpMultiplier'] },
  { id: 'super-velocity-blend', section: 'Defense and movement', label: 'Super Velocity Blend', step: 0.05, min: 0.1, max: 5, path: ['moves', 'superBoost', 'velocityBlendMultiplier'] },
  { id: 'super-start-fuel', section: 'Defense and movement', label: 'Super Start Fuel', step: 0.25, min: 0, max: 1000, path: ['moves', 'superBoost', 'startFuelCost'] },
  { id: 'super-travel-fuel', section: 'Defense and movement', label: 'Super Travel Fuel / Distance', step: 0.01, min: 0, max: 100, path: ['moves', 'superBoost', 'travelFuelPerDistance'] },
  { id: 'super-noncommit', section: 'Defense and movement', label: 'Super Non-commit Penalty', step: 0.25, min: 0, max: 1000, path: ['moves', 'superBoost', 'nonCommitPenalty'] },
  { id: 'super-turn-penalty', section: 'Defense and movement', label: 'Super Turn Penalty Gain', step: 0.05, min: 0.1, max: 5, path: ['moves', 'superBoost', 'turnPenaltyGainMultiplier'] },
  { id: 'special-fuel', section: 'Special', label: 'Special Base Fuel', step: 0.25, min: 0, max: 1000, path: ['moves', 'special', 'fuelCost'] },
  { id: 'special-startup', section: 'Special', label: 'Special Startup Frames', step: 1, min: 0, max: 600, path: ['moves', 'special', 'timing', 'startupFrames'] },
  { id: 'special-active', section: 'Special', label: 'Special Active Frames', step: 1, min: 1, max: 600, path: ['moves', 'special', 'timing', 'activeFrames'] },
  { id: 'special-recovery', section: 'Special', label: 'Special Recovery Frames', step: 1, min: 0, max: 1200, path: ['moves', 'special', 'timing', 'recoveryFrames'] },
  { id: 'special-cooldown', section: 'Special', label: 'Special Cooldown Frames', step: 1, min: 0, max: 2400, path: ['moves', 'special', 'timing', 'cooldownFrames'] },
  { id: 'special-range', section: 'Special', label: 'Special Range', step: 0.25, min: 0, max: 1000, path: ['moves', 'special', 'size', 'range'] },
  { id: 'special-radius', section: 'Special', label: 'Special Radius', step: 0.25, min: 0, max: 1000, path: ['moves', 'special', 'size', 'radius'] },
  { id: 'special-width', section: 'Special', label: 'Special Width', step: 0.25, min: 0, max: 1000, path: ['moves', 'special', 'size', 'width'] },
  { id: 'special-length', section: 'Special', label: 'Special Length', step: 0.25, min: 0, max: 1000, path: ['moves', 'special', 'size', 'length'] },
  { id: 'projectile-speed', section: 'Special', label: 'Projectile Speed', step: 0.5, min: 0.1, max: 500, path: ['moves', 'special', 'projectile', 'speed'] },
  { id: 'projectile-life', section: 'Special', label: 'Projectile Lifetime', step: 0.05, min: 0.05, max: 30, path: ['moves', 'special', 'projectile', 'lifeSeconds'] },
  { id: 'projectile-radius', section: 'Special', label: 'Projectile Hit Radius', step: 0.05, min: 0.05, max: 50, path: ['moves', 'special', 'projectile', 'hitRadius'] },
  { id: 'projectile-stun', section: 'Special', label: 'Projectile Stun Seconds', step: 0.05, min: 0, max: 30, path: ['moves', 'special', 'projectile', 'stunSeconds'] },
  { id: 'projectile-fuel-damage', section: 'Special', label: 'Projectile Fuel Damage', step: 0.25, min: 0, max: 1000, path: ['moves', 'special', 'projectile', 'fuelDamage'] },
  { id: 'command-grab-stun', section: 'Special', label: 'Command Grab Stun Frames', step: 1, min: 0, max: 1200, path: ['moves', 'special', 'commandGrab', 'stunFrames'] },
  { id: 'special-dash-speed', section: 'Special', label: 'Special Dash Speed', step: 0.5, min: 0.1, max: 500, path: ['moves', 'special', 'movement', 'dashSpeed'] },
  { id: 'special-guard-frames', section: 'Special', label: 'Special Guard Frames', step: 1, min: 1, max: 1200, path: ['moves', 'special', 'block', 'guardFrames'] },
];

export const CHARACTER_TUNING_FIELD_IDS: readonly string[] = CHARACTER_TUNING_FIELDS.map(
  (field) => field.id,
);

const CHARACTER_TUNING_SECTIONS: CharacterTuningField['section'][] = [
  'Archetype',
  'Launch and finish',
  'Defense and movement',
  'Special',
];

const CHARACTER_TUNING_FIELD_BY_PATH = new Map(
  CHARACTER_TUNING_FIELDS.map((field) => [field.path.join('.'), field]),
);

function formatRuleValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(6)));
}

function formatBalanceRuleChangeLabel(change: BalanceLabRuleChange): string {
  if (change.scope === 'global') {
    return TUNING_FIELD_BY_KEY.get(change.path as keyof GameTuning)?.label ?? change.path;
  }
  if (change.scope === 'ai') {
    return AI_BEHAVIOR_FIELD_BY_KEY.get(change.path as AiBehaviorTuningKey)?.label
      ?? `AI | ${change.path}`;
  }
  const characterName = change.characterId
    ? CHARACTER_BY_ID[change.characterId]?.displayName ?? change.characterId
    : 'Character';
  const fieldName = CHARACTER_TUNING_FIELD_BY_PATH.get(change.path)?.label ?? change.path;
  return `${characterName} | ${fieldName}`;
}

const CHARACTER_CONTROL_FOCUS_FIELDS: Record<
  BalanceLabCharacterControlFocus,
  readonly string[]
> = {
  launch: ['launch-startup', 'launch-active', 'launch-hit-recovery', 'launch-whiff-recovery'],
  dunk: [
    'dunk-startup',
    'dunk-active',
    'dunk-range',
    'dunk-pursuit-speed',
    'dunk-tracking',
    'dunk-hit-recovery',
    'dunk-whiff-recovery',
  ],
  parry: ['parry-startup', 'parry-active', 'parry-recovery', 'parry-stun'],
  launch_break: ['break-recovery', 'break-retain'],
  special: [
    'special-fuel',
    'special-startup',
    'special-active',
    'special-recovery',
    'special-cooldown',
    'special-range',
    'special-radius',
    'special-width',
    'special-length',
    'projectile-speed',
    'command-grab-stun',
    'special-dash-speed',
    'special-guard-frames',
  ],
  movement: [
    'natural-recovery-reset',
    'movement-fuel',
    'boost-speed-move',
    'boost-fuel',
    'super-hold-speed',
    'super-steer',
    'super-velocity-blend',
    'super-start-fuel',
    'super-travel-fuel',
    'super-noncommit',
    'super-turn-penalty',
  ],
};

const CHARACTER_CONTROL_FOCUS_LABELS: Record<BalanceLabCharacterControlFocus, string> = {
  launch: 'Launch kit',
  dunk: 'Dunk / finish kit',
  parry: 'Parry kit',
  launch_break: 'Launch break kit',
  special: 'Special kit',
  movement: 'Movement kit',
};

const BALANCE_LAB_DRAFT_STORAGE_KEY = 'gravity_well.balance_lab.draft.v3';
const PREVIOUS_BALANCE_LAB_DRAFT_STORAGE_KEY = 'gravity_well.balance_lab.draft.v2';
const LEGACY_BALANCE_LAB_DRAFT_STORAGE_KEY = 'gravity_well.balance_lab.draft.v1';

function readCharacterTuningValue(
  config: CharacterBalanceConfig,
  field: CharacterTuningField,
): number | null {
  let cursor: unknown = config;
  for (const segment of field.path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null;
}

function writeCharacterTuningValue(
  config: CharacterBalanceConfig,
  field: CharacterTuningField,
  value: number,
): boolean {
  let cursor = config as unknown as Record<string, unknown>;
  for (const segment of field.path.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return false;
    }
    cursor = next as Record<string, unknown>;
  }
  const finalSegment = field.path[field.path.length - 1];
  if (!finalSegment || typeof cursor[finalSegment] !== 'number') {
    return false;
  }
  cursor[finalSegment] = value;
  return true;
}

type PauseTabId = 'pause' | 'audio' | 'bindings' | 'debug';

interface BalanceLabPendingState {
  tuningDirty: boolean;
  characterDirty: boolean;
  aiBehaviorDirty: boolean;
  aiControllerRolesDirty: boolean;
  scenarioDirty: boolean;
  any: boolean;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private copyStatus: HTMLDivElement | null = null;
  private readonly tabButtons: Record<PauseTabId, HTMLButtonElement>;
  private readonly debugTabEnabled: boolean;
  private balanceLabAvailable: boolean;
  private openBalanceLabButton!: HTMLButtonElement;
  private restartTrainingButton!: HTMLButtonElement;
  private reviewAiRoundButton!: HTMLButtonElement;
  private exportTrainingTelemetryButton: HTMLButtonElement | null = null;
  private exportAiMatchTelemetryButton: HTMLButtonElement | null = null;
  private exportBalanceExperimentButton: HTMLButtonElement | null = null;
  private restoreBalanceBaselineButton: HTMLButtonElement | null = null;
  private reviewBalanceBaselineButton: HTMLButtonElement | null = null;
  private reviewBalanceCandidateButton: HTMLButtonElement | null = null;
  private balancePendingChangesPanel: HTMLElement | null = null;
  private discardBalanceDraftButton: HTMLButtonElement | null = null;
  private balanceProfileSelect: HTMLSelectElement | null = null;
  private balanceTestRecipeSelect: HTMLSelectElement | null = null;
  private balanceTestRecipeDescription: HTMLParagraphElement | null = null;
  private balanceScenarioSelect: HTMLSelectElement | null = null;
  private balanceScenarioDescription: HTMLParagraphElement | null = null;
  private readonly aiControllerRoleSelects: Partial<Record<PlayerId, HTMLSelectElement>> = {};
  private readonly aiControllerRoleRows: Partial<Record<PlayerId, HTMLLabelElement>> = {};
  private aiControllerRolesIntro: HTMLParagraphElement | null = null;
  private aiControllerRoleDescription: HTMLParagraphElement | null = null;
  private balanceIdentity: HTMLDivElement | null = null;
  private balanceFlowPanel: HTMLDivElement | null = null;
  private aiDecisionPanel: HTMLDivElement | null = null;
  private restartBalanceLabButton: HTMLButtonElement | null = null;
  private matchedBalanceLabButton: HTMLButtonElement | null = null;
  private balanceHypothesisInput: HTMLTextAreaElement | null = null;
  private balanceBaselineNotesInput: HTMLTextAreaElement | null = null;
  private balanceCandidateNotesInput: HTMLTextAreaElement | null = null;
  private balanceObservationsInput: HTMLTextAreaElement | null = null;
  private balanceDecisionSelect: HTMLSelectElement | null = null;
  private readonly balancePlaytestVerdictSelects: Record<
    'baseline' | 'candidate',
    Partial<Record<BalanceLabLoopStageId, HTMLSelectElement>>
  > = { baseline: {}, candidate: {} };
  private characterBalanceEditor: HTMLDivElement | null = null;
  private characterBalanceSelect: HTMLSelectElement | null = null;
  private characterBalanceIdentity: HTMLDivElement | null = null;
  private aiBehaviorEditor: HTMLDivElement | null = null;
  private readonly tabPanels: Record<PauseTabId, HTMLDivElement>;
  private readonly fieldInputs = new Map<keyof GameTuning, HTMLInputElement>();
  private readonly characterFieldInputs = new Map<string, {
    field: CharacterTuningField;
    input: HTMLInputElement;
    row: HTMLLabelElement;
  }>();
  private readonly aiBehaviorFieldInputs = new Map<AiBehaviorTuningKey, HTMLInputElement>();
  private readonly audioVolumeInputs = new Map<AudioVolumeField['key'], HTMLInputElement>();
  private audioToggleInputs!: {
    voiceDuckingEnabled: HTMLInputElement;
    subtitlesEnabled: HTMLInputElement;
    dynamicRangeMode: HTMLSelectElement;
  };
  private paused = false;
  private canRestartTraining = false;
  private exportingTrainingTelemetry = false;
  private exportingAiMatchTelemetry = false;
  private activeTab: PauseTabId = 'pause';
  private balanceReplayComparison: BalanceReplayComparison | null = null;
  private balanceReplayCandidateSequence: number | null = null;
  private balanceReplayCandidateError: string | null = null;
  private lastAiRoundReviewRequest: AiRoundReviewRequest | null = null;
  private lastAiRoundReviewSequence: number | null = null;
  private balanceBaseline: {
    fingerprint: string;
    flow: BalanceLabFlowModel;
    framesSimulated: number;
    tuning: GameTuning;
    characterBalanceOverrides: CharacterBalanceOverrides;
    aiBehaviorTuning: AiBehaviorTuning;
    characters: MatchTelemetrySummary['characters'];
    scenario: BalanceLabScenarioIdentity | null;
    scenarioId: BalanceScenarioId;
    aiControllerRoles: AiControllerRoles;
    sampleSequence: number;
    capturedAt: string;
    telemetry: MatchTelemetrySummary;
    review: BalanceLabPlaytestSampleReview;
  } | null = null;
  private selectedCharacterBalanceId: CharacterId | null = null;

  constructor(private readonly options: PauseMenuOptions) {
    this.debugTabEnabled = options.enableDebugTab ?? true;
    this.balanceLabAvailable = this.debugTabEnabled;
    this.root = document.createElement('div');
    this.root.className = 'pause-menu';
    this.root.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'pause-panel';
    this.root.appendChild(panel);

    const header = document.createElement('div');
    header.className = 'pause-header';
    header.innerHTML = '<h2>Paused</h2><span>Esc or Start to resume</span>';
    panel.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'pause-tabs';
    panel.appendChild(tabs);

    const pausePanel = this.createPauseTab();
    const audioPanel = this.createAudioTab();
    const bindingsPanel = this.createBindingsTab();
    const debugPanel = this.createDebugTab();
    this.tabPanels = {
      pause: pausePanel,
      audio: audioPanel,
      bindings: bindingsPanel,
      debug: debugPanel,
    };
    panel.append(pausePanel, audioPanel, bindingsPanel, debugPanel);

    const pauseButton = this.createTabButton('Pause', 'pause');
    const audioButton = this.createTabButton('Audio', 'audio');
    const bindingsButton = this.createTabButton('Controller Bindings', 'bindings');
    const debugButton = this.createTabButton('Balance Lab', 'debug');
    if (!this.balanceLabAvailable) {
      debugButton.hidden = true;
    }
    tabs.append(pauseButton, audioButton, bindingsButton, debugButton);
    this.tabButtons = {
      pause: pauseButton,
      audio: audioButton,
      bindings: bindingsButton,
      debug: debugButton,
    };

    document.body.appendChild(this.root);
    this.setActiveTab('pause');
    this.syncInputsFromTuning();
    this.syncInputsFromAudioSettings();
  }

  isPaused(): boolean {
    return this.paused;
  }

  toggle(): void {
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.root.hidden = !paused;
    if (paused) {
      this.setActiveTab('pause');
      this.syncInputsFromTuning();
      this.syncInputsFromAudioSettings();
      this.refreshExportControls();
      this.reviewAiRoundButton.hidden = !(this.options.canReviewAiRound?.() ?? false);
      this.syncBalanceLab();
      if (this.copyStatus) {
        this.copyStatus.textContent = '';
      }
    }
  }

  openBalanceLab(status?: string): void {
    this.setPaused(true);
    this.setActiveTab('debug');
    if (status && this.copyStatus) {
      this.copyStatus.textContent = status;
    }
  }

  setCanRestartTraining(enabled: boolean): void {
    this.canRestartTraining = enabled;
    this.restartTrainingButton.hidden = !enabled;
    this.refreshExportControls();
  }

  setBalanceLabAvailable(enabled: boolean): void {
    this.balanceLabAvailable = this.debugTabEnabled || enabled;
    this.tabButtons.debug.hidden = !this.balanceLabAvailable;
    this.openBalanceLabButton.hidden = !this.balanceLabAvailable;
    if (!this.balanceLabAvailable && this.activeTab === 'debug') {
      this.setActiveTab('pause');
    }
  }

  private createTabButton(label: string, tabId: PauseTabId): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pause-tab-btn';
    button.textContent = label;
    button.addEventListener('click', () => this.setActiveTab(tabId));
    return button;
  }

  private setActiveTab(tabId: PauseTabId): void {
    if (tabId === 'debug' && !this.balanceLabAvailable) {
      tabId = 'pause';
    }
    this.activeTab = tabId;
    this.tabPanels.pause.hidden = tabId !== 'pause';
    this.tabPanels.audio.hidden = tabId !== 'audio';
    this.tabPanels.bindings.hidden = tabId !== 'bindings';
    this.tabPanels.debug.hidden = tabId !== 'debug' || !this.balanceLabAvailable;

    this.tabButtons.pause.classList.toggle('active', tabId === 'pause');
    this.tabButtons.audio.classList.toggle('active', tabId === 'audio');
    this.tabButtons.bindings.classList.toggle('active', tabId === 'bindings');
    this.tabButtons.debug.classList.toggle('active', tabId === 'debug' && this.balanceLabAvailable);
    if (tabId === 'debug') {
      this.syncBalanceLab();
    }
  }

  private createPauseTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'pause-action';
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => this.setPaused(false));

    const toAudio = document.createElement('button');
    toAudio.type = 'button';
    toAudio.className = 'pause-action';
    toAudio.textContent = 'Audio Settings';
    toAudio.addEventListener('click', () => this.setActiveTab('audio'));

    const toBindings = document.createElement('button');
    toBindings.type = 'button';
    toBindings.className = 'pause-action';
    toBindings.textContent = 'Controller Bindings';
    toBindings.addEventListener('click', () => this.setActiveTab('bindings'));

    const toDebug = document.createElement('button');
    toDebug.type = 'button';
    toDebug.className = 'pause-action';
    toDebug.textContent = 'Balance Lab';
    toDebug.addEventListener('click', () => this.setActiveTab('debug'));
    toDebug.hidden = !this.balanceLabAvailable;
    this.openBalanceLabButton = toDebug;

    const restartTraining = document.createElement('button');
    restartTraining.type = 'button';
    restartTraining.className = 'pause-action';
    restartTraining.textContent = 'Restart Training';
    restartTraining.hidden = true;
    restartTraining.addEventListener('click', () => {
      if (!this.canRestartTraining) {
        return;
      }
      this.options.onRestartTraining?.();
      this.setPaused(false);
    });
    this.restartTrainingButton = restartTraining;

    const reviewAiRound = document.createElement('button');
    reviewAiRound.type = 'button';
    reviewAiRound.className = 'pause-action';
    reviewAiRound.textContent = 'Review Latest Local Round';
    reviewAiRound.hidden = true;
    reviewAiRound.addEventListener('click', () => {
      if (!(this.options.canReviewAiRound?.() ?? false)) {
        return;
      }
      this.requestAiRoundReview();
    });
    this.reviewAiRoundButton = reviewAiRound;

    tab.append(resume, reviewAiRound, restartTraining, toAudio, toBindings, toDebug);
    return tab;
  }

  private createAudioTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const title = document.createElement('h3');
    title.textContent = 'Audio And Accessibility';
    tab.appendChild(title);

    const volumeGrid = document.createElement('div');
    volumeGrid.className = 'tuning-grid';
    tab.appendChild(volumeGrid);

    for (const field of AUDIO_VOLUME_FIELDS) {
      const row = document.createElement('label');
      row.className = 'tuning-row';
      const text = document.createElement('span');
      text.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.addEventListener('input', () => {
        const ratio = Number(input.value) / 100;
        this.updateAudioSetting(field.key, ratio);
      });
      row.append(text, input);
      volumeGrid.appendChild(row);
      this.audioVolumeInputs.set(field.key, input);
    }

    const dynamicRangeRow = document.createElement('label');
    dynamicRangeRow.className = 'tuning-row';
    const dynamicRangeText = document.createElement('span');
    dynamicRangeText.textContent = 'Dynamic Range';
    const dynamicRangeSelect = document.createElement('select');
    const optionWide = document.createElement('option');
    optionWide.value = 'wide';
    optionWide.textContent = 'Wide';
    const optionReduced = document.createElement('option');
    optionReduced.value = 'reduced';
    optionReduced.textContent = 'Reduced';
    dynamicRangeSelect.append(optionWide, optionReduced);
    dynamicRangeSelect.addEventListener('change', () => {
      this.updateAudioSetting('dynamicRangeMode', dynamicRangeSelect.value as DynamicRangeMode);
    });
    dynamicRangeRow.append(dynamicRangeText, dynamicRangeSelect);
    tab.appendChild(dynamicRangeRow);

    const duckingRow = document.createElement('label');
    duckingRow.className = 'binding-row';
    const duckingToggle = document.createElement('input');
    duckingToggle.type = 'checkbox';
    duckingToggle.addEventListener('change', () => {
      this.updateAudioSetting('voiceDuckingEnabled', duckingToggle.checked);
    });
    duckingRow.append(duckingToggle, document.createTextNode(' Voice ducking during callouts'));
    tab.appendChild(duckingRow);

    const subtitlesRow = document.createElement('label');
    subtitlesRow.className = 'binding-row';
    const subtitlesToggle = document.createElement('input');
    subtitlesToggle.type = 'checkbox';
    subtitlesToggle.addEventListener('change', () => {
      this.updateAudioSetting('subtitlesEnabled', subtitlesToggle.checked);
    });
    subtitlesRow.append(subtitlesToggle, document.createTextNode(' Voice subtitles'));
    tab.appendChild(subtitlesRow);

    this.audioToggleInputs = {
      voiceDuckingEnabled: duckingToggle,
      subtitlesEnabled: subtitlesToggle,
      dynamicRangeMode: dynamicRangeSelect,
    };
    return tab;
  }

  private createBindingsTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const title = document.createElement('h3');
    title.textContent = 'Xbox Controller Bindings';
    tab.appendChild(title);

    const lines = [
      'Move: Left Stick or D-pad',
      'RT: Boost',
      'LT: Super boost',
      'X: Special',
      'Y: Launch',
      'B: Dunk',
      'LB: Parry',
      'A: Break',
      'Pad assignment: first connected pad is P1, second is P2.',
    ];

    for (const line of lines) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      row.textContent = line;
      tab.appendChild(row);
    }

    return tab;
  }

  private createDebugTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const title = document.createElement('h3');
    title.textContent = 'Balance Lab';
    tab.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'balance-lab-intro';
    intro.textContent = 'Run locally, inspect the gameplay loop, capture a baseline, edit tuning, then restart the same matchup for comparison.';
    tab.appendChild(intro);

    const testRecipeRow = document.createElement('label');
    testRecipeRow.className = 'balance-lab-profile balance-test-recipe-picker';
    const testRecipeLabel = document.createElement('span');
    testRecipeLabel.textContent = 'Gameplay probe';
    const testRecipeSelect = document.createElement('select');
    for (const recipe of this.options.balanceTestRecipes ?? []) {
      const option = document.createElement('option');
      option.value = recipe.id;
      option.textContent = `${recipe.label} (${recipe.suggestedDurationSeconds}s)`;
      testRecipeSelect.appendChild(option);
    }
    const customRecipeOption = document.createElement('option');
    customRecipeOption.value = 'custom';
    customRecipeOption.textContent = 'Custom setup';
    testRecipeSelect.appendChild(customRecipeOption);
    testRecipeSelect.addEventListener('change', () => {
      if (testRecipeSelect.value === 'custom') {
        return;
      }
      const recipe = resolveBalanceTestRecipe(testRecipeSelect.value);
      this.options.onApplyBalanceTestRecipe?.(recipe.id);
      this.syncBalanceLab();
      if (this.copyStatus) {
        const activeRecipeId = getBalanceTestRecipeSelectionId(
          this.options.getActiveBalanceScenarioId?.(),
          this.options.getActiveAiControllerRoles?.(),
        );
        this.copyStatus.textContent = activeRecipeId === recipe.id
          ? `${recipe.label} selected and already active.`
          : `${recipe.label} staged. Restart to begin the probe from frame zero.`;
      }
    });
    testRecipeRow.append(testRecipeLabel, testRecipeSelect);
    tab.appendChild(testRecipeRow);
    const testRecipeDescription = document.createElement('p');
    testRecipeDescription.className = 'balance-test-recipe-description';
    tab.appendChild(testRecipeDescription);
    this.balanceTestRecipeSelect = testRecipeSelect;
    this.balanceTestRecipeDescription = testRecipeDescription;

    const candidatePresets = this.options.balanceCandidatePresets ?? [];
    if (candidatePresets.length > 0 && this.options.onApplyBalanceCandidatePreset) {
      const candidateLibrary = document.createElement('section');
      candidateLibrary.className = 'balance-candidate-library';
      const candidateHeading = document.createElement('h4');
      candidateHeading.textContent = 'Local candidate library';
      const candidateIntro = document.createElement('p');
      candidateIntro.textContent = 'Stage an evidence-backed experiment without changing package defaults, Arcade, Online, or Ranked.';
      candidateLibrary.append(candidateHeading, candidateIntro);

      for (const preset of candidatePresets) {
        const card = document.createElement('article');
        card.className = 'balance-candidate-card';
        card.dataset.balanceCandidatePresetId = preset.id;
        const title = document.createElement('strong');
        title.textContent = preset.label;
        const description = document.createElement('p');
        description.textContent = preset.description;
        const evidence = document.createElement('p');
        evidence.className = 'balance-candidate-evidence';
        evidence.textContent = preset.evidence;
        const rules = document.createElement('ul');
        for (const rule of preset.rules) {
          const item = document.createElement('li');
          item.textContent = rule.label;
          rules.appendChild(item);
        }
        const question = document.createElement('p');
        question.className = 'balance-candidate-question';
        question.textContent = preset.designerQuestion;
        const applyButton = document.createElement('button');
        applyButton.type = 'button';
        applyButton.className = 'pause-action balance-candidate-apply';
        applyButton.textContent = `Stage ${preset.label}`;
        applyButton.addEventListener('click', () => {
          this.options.onApplyBalanceCandidatePreset?.(preset.id);
          this.syncInputsFromTuning();
          this.syncBalanceLab();
          if (this.copyStatus) {
            this.copyStatus.textContent = `${preset.label} staged locally. Apply + Restart to test it from frame zero.`;
          }
        });
        card.append(title, description, evidence, rules, question, applyButton);
        candidateLibrary.appendChild(card);
      }
      tab.appendChild(candidateLibrary);
    }

    const profileRow = document.createElement('label');
    profileRow.className = 'balance-lab-profile';
    const profileLabel = document.createElement('span');
    profileLabel.textContent = 'Rules preset';
    const profileSelect = document.createElement('select');
    for (const profile of this.options.balanceProfiles ?? []) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label;
      profileSelect.appendChild(option);
    }
    const customOption = document.createElement('option');
    customOption.value = '__custom_local__';
    customOption.textContent = 'Custom Local';
    profileSelect.appendChild(customOption);
    profileSelect.addEventListener('change', () => {
      if (profileSelect.value === '__custom_local__') {
        return;
      }
      this.options.onApplyBalanceProfile?.(profileSelect.value);
      this.syncInputsFromTuning();
      this.syncBalanceLab();
      if (this.copyStatus) {
        this.copyStatus.textContent = `Applied ${profileSelect.selectedOptions[0]?.textContent ?? profileSelect.value}. Restart to compare from frame zero.`;
      }
    });
    profileRow.append(profileLabel, profileSelect);
    tab.appendChild(profileRow);
    this.balanceProfileSelect = profileSelect;

    const scenarioRow = document.createElement('label');
    scenarioRow.className = 'balance-lab-profile balance-scenario-picker';
    const scenarioLabel = document.createElement('span');
    scenarioLabel.textContent = 'Starting situation';
    const scenarioSelect = document.createElement('select');
    for (const scenario of this.options.balanceScenarios ?? []) {
      const option = document.createElement('option');
      option.value = scenario.id;
      option.textContent = scenario.label;
      scenarioSelect.appendChild(option);
    }
    scenarioSelect.addEventListener('change', () => {
      const scenario = resolveBalanceScenario(scenarioSelect.value);
      this.options.setBalanceScenarioId?.(scenario.id);
      this.syncBalanceLab();
      if (this.copyStatus) {
        this.copyStatus.textContent = `${scenario.label} staged. Restart to run this exact starting situation from frame zero.`;
      }
    });
    scenarioRow.append(scenarioLabel, scenarioSelect);
    tab.appendChild(scenarioRow);
    const scenarioDescription = document.createElement('p');
    scenarioDescription.className = 'balance-scenario-description';
    tab.appendChild(scenarioDescription);
    this.balanceScenarioSelect = scenarioSelect;
    this.balanceScenarioDescription = scenarioDescription;

    const controllerRoles = document.createElement('section');
    controllerRoles.className = 'balance-controller-roles';
    const controllerRolesHeading = document.createElement('h4');
    controllerRolesHeading.textContent = 'Controller setup';
    const controllerRolesIntro = document.createElement('p');
    controllerRolesIntro.textContent = 'Assign a full AI or a deterministic test dummy to each side. Changes apply only after a clean local AI vs AI restart.';
    const controllerRolesGrid = document.createElement('div');
    controllerRolesGrid.className = 'balance-controller-role-grid';
    for (const playerId of ['P1', 'P2'] as const) {
      const row = document.createElement('label');
      row.className = 'balance-controller-role';
      const label = document.createElement('span');
      label.textContent = `${playerId} controller`;
      const select = document.createElement('select');
      select.dataset.playerId = playerId;
      for (const role of AI_CONTROLLER_ROLE_DEFINITIONS) {
        const option = document.createElement('option');
        option.value = role.id;
        option.textContent = role.label;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        const role = resolveAiControllerRole(select.value);
        this.options.setAiControllerRole?.(playerId, role.id);
        this.syncBalanceLab();
        if (this.copyStatus) {
          this.copyStatus.textContent = `${playerId} ${role.label} staged. Restart to apply the controller setup from frame zero.`;
        }
      });
      row.append(label, select);
      controllerRolesGrid.appendChild(row);
      this.aiControllerRoleRows[playerId] = row;
      this.aiControllerRoleSelects[playerId] = select;
    }
    const controllerRoleDescription = document.createElement('p');
    controllerRoleDescription.className = 'balance-controller-role-description';
    controllerRoles.append(
      controllerRolesHeading,
      controllerRolesIntro,
      controllerRolesGrid,
      controllerRoleDescription,
    );
    tab.appendChild(controllerRoles);
    this.aiControllerRolesIntro = controllerRolesIntro;
    this.aiControllerRoleDescription = controllerRoleDescription;

    const identity = document.createElement('div');
    identity.className = 'balance-lab-identity';
    tab.appendChild(identity);
    this.balanceIdentity = identity;

    const flowPanel = document.createElement('div');
    flowPanel.className = 'balance-lab-flow';
    tab.appendChild(flowPanel);
    this.balanceFlowPanel = flowPanel;

    const aiDecisionDetails = document.createElement('details');
    aiDecisionDetails.className = 'balance-ai-decisions';
    aiDecisionDetails.open = true;
    const aiDecisionSummary = document.createElement('summary');
    aiDecisionSummary.textContent = 'AI Decision Inspector';
    const aiDecisionPanel = document.createElement('div');
    aiDecisionPanel.className = 'balance-ai-decision-panel';
    aiDecisionDetails.append(aiDecisionSummary, aiDecisionPanel);
    tab.appendChild(aiDecisionDetails);
    this.aiDecisionPanel = aiDecisionPanel;

    const comparisonActions = document.createElement('div');
    comparisonActions.className = 'tuning-actions';
    const captureBaselineButton = document.createElement('button');
    captureBaselineButton.type = 'button';
    captureBaselineButton.className = 'pause-action';
    captureBaselineButton.textContent = 'Capture Run As Baseline';
    captureBaselineButton.addEventListener('click', () => this.captureBalanceBaseline());
    const restoreBaselineButton = document.createElement('button');
    restoreBaselineButton.type = 'button';
    restoreBaselineButton.className = 'pause-action';
    restoreBaselineButton.textContent = 'Restore Captured Baseline';
    restoreBaselineButton.disabled = true;
    restoreBaselineButton.title = 'Capture a baseline before restoring its exact local rules and probe setup.';
    restoreBaselineButton.addEventListener('click', () => this.restoreCapturedBalanceBaseline());
    const clearBaselineButton = document.createElement('button');
    clearBaselineButton.type = 'button';
    clearBaselineButton.className = 'pause-action';
    clearBaselineButton.textContent = 'Clear Baseline';
    clearBaselineButton.addEventListener('click', () => {
      this.balanceBaseline = null;
      this.balanceReplayComparison = null;
      this.balanceReplayCandidateSequence = null;
      this.balanceReplayCandidateError = null;
      this.syncBalanceLab();
    });
    const exportExperimentButton = document.createElement('button');
    exportExperimentButton.type = 'button';
    exportExperimentButton.className = 'pause-action';
    exportExperimentButton.textContent = 'Export Experiment JSON';
    exportExperimentButton.disabled = true;
    exportExperimentButton.title = 'Capture a baseline before exporting a reproducible comparison.';
    exportExperimentButton.addEventListener('click', () => this.downloadBalanceExperiment());
    const reviewBaselineButton = document.createElement('button');
    reviewBaselineButton.type = 'button';
    reviewBaselineButton.className = 'pause-action';
    reviewBaselineButton.textContent = 'Review Baseline Incident';
    reviewBaselineButton.disabled = true;
    reviewBaselineButton.addEventListener('click', () => this.reviewBalanceReplaySample('baseline'));
    const reviewCandidateButton = document.createElement('button');
    reviewCandidateButton.type = 'button';
    reviewCandidateButton.className = 'pause-action';
    reviewCandidateButton.textContent = 'Review Candidate Incident';
    reviewCandidateButton.disabled = true;
    reviewCandidateButton.addEventListener('click', () => this.reviewBalanceReplaySample('candidate'));
    comparisonActions.append(
      captureBaselineButton,
      reviewBaselineButton,
      reviewCandidateButton,
      restoreBaselineButton,
      clearBaselineButton,
      exportExperimentButton,
    );
    tab.appendChild(comparisonActions);
    this.exportBalanceExperimentButton = exportExperimentButton;
    this.restoreBalanceBaselineButton = restoreBaselineButton;
    this.reviewBalanceBaselineButton = reviewBaselineButton;
    this.reviewBalanceCandidateButton = reviewCandidateButton;

    const experimentReview = document.createElement('details');
    experimentReview.className = 'balance-experiment-review';
    const experimentReviewSummary = document.createElement('summary');
    experimentReviewSummary.textContent = 'Human playtest scorecard and decision';
    const experimentReviewGrid = document.createElement('div');
    experimentReviewGrid.className = 'balance-experiment-review-grid';

    const reviewIntro = document.createElement('p');
    reviewIntro.className = 'balance-playtest-intro';
    reviewIntro.textContent = 'Rate what you could actually read and choose during each sample. These subjective ratings are exported beside telemetry but never change a rule or automated gate.';

    const hypothesisLabel = document.createElement('label');
    hypothesisLabel.textContent = 'What are you trying to change?';
    const hypothesisInput = document.createElement('textarea');
    hypothesisInput.rows = 2;
    hypothesisInput.maxLength = 1_200;
    hypothesisInput.placeholder = 'Example: More clash separation should create a readable neutral reset.';
    hypothesisLabel.appendChild(hypothesisInput);

    const scorecard = document.createElement('div');
    scorecard.className = 'balance-playtest-scorecard';
    const scorecardHeader = document.createElement('div');
    scorecardHeader.className = 'balance-playtest-scorecard-row header';
    for (const text of ['Loop stage', 'Baseline', 'Candidate']) {
      const cell = document.createElement('span');
      cell.textContent = text;
      scorecardHeader.appendChild(cell);
    }
    scorecard.appendChild(scorecardHeader);
    const verdictOptions: readonly [BalanceLabPlaytestVerdict, string][] = [
      ['unrated', 'Not rated'],
      ['clear', 'Clear / playable'],
      ['mixed', 'Mixed / inconsistent'],
      ['blocked', 'Blocked / unclear'],
    ];
    for (const stageId of BALANCE_LAB_LOOP_STAGE_IDS) {
      const row = document.createElement('div');
      row.className = 'balance-playtest-scorecard-row';
      const stage = document.createElement('span');
      stage.textContent = stageId.charAt(0).toUpperCase() + stageId.slice(1);
      row.appendChild(stage);
      for (const variant of ['baseline', 'candidate'] as const) {
        const select = document.createElement('select');
        select.dataset.playtestVariant = variant;
        select.dataset.loopStage = stageId;
        select.setAttribute('aria-label', `${variant} ${stageId} playtest rating`);
        for (const [value, label] of verdictOptions) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
        this.balancePlaytestVerdictSelects[variant][stageId] = select;
        row.appendChild(select);
      }
      scorecard.appendChild(row);
    }

    const baselineNotesLabel = document.createElement('label');
    baselineNotesLabel.textContent = 'Baseline notes';
    const baselineNotesInput = document.createElement('textarea');
    baselineNotesInput.rows = 2;
    baselineNotesInput.maxLength = 2_000;
    baselineNotesInput.placeholder = 'What choices, spacing, loops, and finish opportunities did the original rules create?';
    baselineNotesLabel.appendChild(baselineNotesInput);

    const candidateNotesLabel = document.createElement('label');
    candidateNotesLabel.textContent = 'Candidate notes';
    const candidateNotesInput = document.createElement('textarea');
    candidateNotesInput.rows = 2;
    candidateNotesInput.maxLength = 2_000;
    candidateNotesInput.placeholder = 'What became clearer, worse, or merely different after the restart?';
    candidateNotesLabel.appendChild(candidateNotesInput);

    const observationsLabel = document.createElement('label');
    observationsLabel.textContent = 'Comparison conclusion';
    const observationsInput = document.createElement('textarea');
    observationsInput.rows = 3;
    observationsInput.maxLength = 3_000;
    observationsInput.placeholder = 'Explain the trade-off using the visible rhythm, decisions, resets, pressure, and finish attempts.';
    observationsLabel.appendChild(observationsInput);

    const decisionLabel = document.createElement('label');
    decisionLabel.textContent = 'Decision';
    const decisionSelect = document.createElement('select');
    for (const [value, label] of [
      ['undecided', 'Undecided'],
      ['keep', 'Keep candidate'],
      ['iterate', 'Iterate again'],
      ['revert', 'Revert candidate'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      decisionSelect.appendChild(option);
    }
    decisionLabel.appendChild(decisionSelect);
    experimentReviewGrid.append(
      reviewIntro,
      hypothesisLabel,
      scorecard,
      baselineNotesLabel,
      candidateNotesLabel,
      observationsLabel,
      decisionLabel,
    );
    experimentReview.append(experimentReviewSummary, experimentReviewGrid);
    tab.appendChild(experimentReview);
    this.balanceHypothesisInput = hypothesisInput;
    this.balanceBaselineNotesInput = baselineNotesInput;
    this.balanceCandidateNotesInput = candidateNotesInput;
    this.balanceObservationsInput = observationsInput;
    this.balanceDecisionSelect = decisionSelect;

    const globalHeading = document.createElement('h4');
    globalHeading.className = 'balance-lab-section-heading';
    globalHeading.textContent = 'Global rules';
    tab.appendChild(globalHeading);

    const globalGroups = document.createElement('div');
    globalGroups.className = 'balance-global-groups';
    for (const section of GLOBAL_TUNING_SECTIONS) {
      const details = document.createElement('details');
      details.className = 'balance-global-group';
      details.open = section.label === 'Spacing and resets';
      const summary = document.createElement('summary');
      summary.textContent = section.label;
      const grid = document.createElement('div');
      grid.className = 'tuning-grid';

      for (const key of section.keys) {
        const field = TUNING_FIELD_BY_KEY.get(key);
        if (!field) {
          continue;
        }
        const row = document.createElement('label');
        row.className = 'tuning-row';
        row.dataset.tuningKey = field.key;

        const text = document.createElement('span');
        text.textContent = field.label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = String(field.step);
        input.min = String(field.min);
        input.max = String(field.max);
        bindBalanceNumberInput(input, (value) => this.updateTuningField(field.key, value));

        row.append(text, input);
        grid.appendChild(row);
        this.fieldInputs.set(field.key, input);
      }
      details.append(summary, grid);
      globalGroups.appendChild(details);
    }
    tab.appendChild(globalGroups);

    const aiBehaviorEditor = this.createAiBehaviorEditor();
    tab.appendChild(aiBehaviorEditor);
    this.aiBehaviorEditor = aiBehaviorEditor;

    const characterEditor = this.createCharacterBalanceEditor();
    tab.appendChild(characterEditor);
    this.characterBalanceEditor = characterEditor;

    const pendingChangesPanel = document.createElement('section');
    pendingChangesPanel.className = 'balance-pending-changes';
    tab.appendChild(pendingChangesPanel);
    this.balancePendingChangesPanel = pendingChangesPanel;

    const actions = document.createElement('div');
    actions.className = 'tuning-actions';

    let restartBalanceLabButton: HTMLButtonElement | null = null;
    let matchedBalanceLabButton: HTMLButtonElement | null = null;
    if (this.options.onRestartBalanceLab) {
      restartBalanceLabButton = document.createElement('button');
      restartBalanceLabButton.type = 'button';
      restartBalanceLabButton.className = 'pause-action balance-lab-primary';
      restartBalanceLabButton.textContent = 'Apply + Restart Manually';
      restartBalanceLabButton.addEventListener('click', () => {
        if (this.options.canRestartBalanceLab && !this.options.canRestartBalanceLab()) {
          return;
        }
        this.options.onRestartBalanceLab?.();
        this.setPaused(false);
      });

      matchedBalanceLabButton = document.createElement('button');
      matchedBalanceLabButton.type = 'button';
      matchedBalanceLabButton.className = 'pause-action balance-lab-primary balance-lab-matched-sample';
      matchedBalanceLabButton.textContent = 'Apply + Run Baseline Length';
      matchedBalanceLabButton.hidden = true;
      matchedBalanceLabButton.addEventListener('click', () => {
        if (this.options.canRestartBalanceLab && !this.options.canRestartBalanceLab()) {
          return;
        }
        const targetFrames = this.balanceBaseline?.framesSimulated ?? 0;
        if (targetFrames < 1) {
          return;
        }
        this.options.onRestartBalanceLab?.(targetFrames);
        this.setPaused(false);
      });
    }

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'pause-action';
    resetButton.textContent = 'Reset Global Defaults';
    resetButton.addEventListener('click', () => {
      this.options.setTuning(createDefaultTuning());
      this.syncInputsFromTuning();
      this.syncBalanceLab();
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Defaults restored.';
      }
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'pause-action';
    copyButton.textContent = 'Copy Balance JSON';
    copyButton.addEventListener('click', () => {
      this.copyTuningToClipboard();
    });

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'pause-action';
    downloadButton.textContent = 'Download Balance JSON';
    downloadButton.addEventListener('click', () => this.downloadBalanceDraft());

    const saveDraftButton = document.createElement('button');
    saveDraftButton.type = 'button';
    saveDraftButton.className = 'pause-action';
    saveDraftButton.textContent = 'Save Local Draft';
    saveDraftButton.addEventListener('click', () => this.saveBalanceDraft());

    const loadDraftButton = document.createElement('button');
    loadDraftButton.type = 'button';
    loadDraftButton.className = 'pause-action';
    loadDraftButton.textContent = 'Load Local Draft';
    loadDraftButton.addEventListener('click', () => this.loadBalanceDraft());

    const importDraftInput = document.createElement('input');
    importDraftInput.type = 'file';
    importDraftInput.accept = 'application/json,.json';
    importDraftInput.hidden = true;
    importDraftInput.addEventListener('change', () => {
      const file = importDraftInput.files?.[0];
      importDraftInput.value = '';
      if (file) {
        void this.importBalanceDraft(file);
      }
    });

    const discardDraftButton = document.createElement('button');
    discardDraftButton.type = 'button';
    discardDraftButton.className = 'pause-action';
    discardDraftButton.textContent = 'Discard Staged Changes';
    discardDraftButton.disabled = true;
    discardDraftButton.addEventListener('click', () => this.discardStagedBalanceChanges());
    const importDraftButton = document.createElement('button');
    importDraftButton.type = 'button';
    importDraftButton.className = 'pause-action';
    importDraftButton.textContent = 'Import Balance JSON';
    importDraftButton.addEventListener('click', () => importDraftInput.click());

    let exportTrainingTelemetryButton: HTMLButtonElement | null = null;
    if (this.options.onExportTrainingTelemetry) {
      exportTrainingTelemetryButton = document.createElement('button');
      exportTrainingTelemetryButton.type = 'button';
      exportTrainingTelemetryButton.className = 'pause-action';
      exportTrainingTelemetryButton.textContent = 'Export Training Telemetry';
      exportTrainingTelemetryButton.addEventListener('click', () => {
        void this.exportTrainingTelemetry();
      });
    }

    let exportAiMatchTelemetryButton: HTMLButtonElement | null = null;
    if (this.options.onExportAiMatchTelemetry) {
      exportAiMatchTelemetryButton = document.createElement('button');
      exportAiMatchTelemetryButton.type = 'button';
      exportAiMatchTelemetryButton.className = 'pause-action';
      exportAiMatchTelemetryButton.textContent = 'Export AI Match Telemetry';
      exportAiMatchTelemetryButton.addEventListener('click', () => {
        void this.exportAiMatchTelemetry();
      });
    }

    if (restartBalanceLabButton) {
      actions.append(restartBalanceLabButton);
    }
    if (matchedBalanceLabButton) {
      actions.append(matchedBalanceLabButton);
    }
    actions.append(
      discardDraftButton,
      resetButton,
      saveDraftButton,
      loadDraftButton,
      importDraftButton,
      importDraftInput,
      copyButton,
      downloadButton,
    );
    if (exportTrainingTelemetryButton) {
      actions.append(exportTrainingTelemetryButton);
    }
    if (exportAiMatchTelemetryButton) {
      actions.append(exportAiMatchTelemetryButton);
    }
    tab.appendChild(actions);
    this.exportTrainingTelemetryButton = exportTrainingTelemetryButton;
    this.exportAiMatchTelemetryButton = exportAiMatchTelemetryButton;
    this.restartBalanceLabButton = restartBalanceLabButton;
    this.matchedBalanceLabButton = matchedBalanceLabButton;
    this.discardBalanceDraftButton = discardDraftButton;

    this.copyStatus = document.createElement('div');
    this.copyStatus.className = 'copy-status';
    this.copyStatus.textContent = '';
    tab.appendChild(this.copyStatus);

    return tab;
  }

  private createAiBehaviorEditor(): HTMLDivElement {
    const editor = document.createElement('div');
    editor.className = 'balance-ai-editor';

    const heading = document.createElement('h4');
    heading.className = 'balance-lab-section-heading';
    heading.textContent = 'AI flow behavior';

    const intro = document.createElement('p');
    intro.className = 'balance-lab-intro';
    intro.textContent = 'Stage local AI-vs-AI or Balance Sparring pursuit, spacing, and commitment changes. Zero spacing frames and scale 1 preserve shipped behavior.';

    const groups = document.createElement('div');
    groups.className = 'balance-global-groups';
    for (const section of ['Pursuit and spacing', 'Commitment and defense'] as const) {
      const details = document.createElement('details');
      details.className = 'balance-global-group';
      details.open = section === 'Pursuit and spacing';
      const summary = document.createElement('summary');
      summary.textContent = section;
      const grid = document.createElement('div');
      grid.className = 'tuning-grid';
      for (const field of AI_BEHAVIOR_TUNING_FIELDS.filter((entry) => entry.section === section)) {
        const row = document.createElement('label');
        row.className = 'tuning-row';
        row.dataset.aiBehaviorKey = field.key;
        const text = document.createElement('span');
        text.textContent = field.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = String(field.step);
        input.min = String(field.min);
        input.max = String(field.max);
        bindBalanceNumberInput(input, (value) => this.updateAiBehaviorField(field.key, value));
        row.append(text, input);
        grid.appendChild(row);
        this.aiBehaviorFieldInputs.set(field.key, input);
      }
      details.append(summary, grid);
      groups.appendChild(details);
    }

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'pause-action';
    reset.textContent = 'Reset AI Behavior Defaults';
    reset.addEventListener('click', () => {
      this.options.setAiBehaviorTuning?.(createDefaultAiBehaviorTuning());
      this.syncAiBehaviorEditor();
      this.syncBalanceLab();
      if (this.copyStatus) {
        this.copyStatus.textContent = 'AI behavior restored to shipped defaults.';
      }
    });

    editor.append(heading, intro, groups, reset);
    return editor;
  }

  private createCharacterBalanceEditor(): HTMLDivElement {
    const editor = document.createElement('div');
    editor.className = 'balance-character-editor';

    const heading = document.createElement('h4');
    heading.className = 'balance-lab-section-heading';
    heading.textContent = 'Character rules';

    const intro = document.createElement('p');
    intro.className = 'balance-lab-intro';
    intro.textContent = 'Edit one fighter package at a time. Changes are staged locally until the current seed is restarted.';

    const controls = document.createElement('div');
    controls.className = 'balance-character-controls';
    const selectLabel = document.createElement('label');
    selectLabel.className = 'balance-lab-profile';
    const selectText = document.createElement('span');
    selectText.textContent = 'Match character';
    const select = document.createElement('select');
    select.addEventListener('change', () => {
      this.selectedCharacterBalanceId = select.value || null;
      this.syncCharacterBalanceEditor();
    });
    selectLabel.append(selectText, select);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'pause-action';
    resetButton.textContent = 'Reset Selected Character';
    resetButton.addEventListener('click', () => this.resetSelectedCharacterBalance());
    controls.append(selectLabel, resetButton);

    const identity = document.createElement('div');
    identity.className = 'balance-character-identity';

    const fieldGroups = document.createElement('div');
    fieldGroups.className = 'balance-character-groups';
    for (const section of CHARACTER_TUNING_SECTIONS) {
      const details = document.createElement('details');
      details.className = 'balance-character-group';
      details.open = section === 'Archetype' || section === 'Launch and finish';
      const summary = document.createElement('summary');
      summary.textContent = section;
      const grid = document.createElement('div');
      grid.className = 'tuning-grid';

      for (const field of CHARACTER_TUNING_FIELDS.filter((candidate) => candidate.section === section)) {
        const row = document.createElement('label');
        row.className = 'tuning-row';
        row.dataset.characterTuningId = field.id;
        const text = document.createElement('span');
        text.textContent = field.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = String(field.step);
        input.min = String(field.min);
        input.max = String(field.max);
        bindBalanceNumberInput(input, (value) => this.updateCharacterTuningField(field, value));
        row.append(text, input);
        grid.appendChild(row);
        this.characterFieldInputs.set(field.id, { field, input, row });
      }

      details.append(summary, grid);
      fieldGroups.appendChild(details);
    }

    editor.append(heading, intro, controls, identity, fieldGroups);
    this.characterBalanceSelect = select;
    this.characterBalanceIdentity = identity;
    editor.hidden = !this.options.getBalanceLoadout
      || !this.options.getCharacterBalanceOverrides
      || !this.options.setCharacterBalanceOverrides;
    return editor;
  }

  private syncCharacterBalanceEditor(): void {
    if (!this.characterBalanceEditor || this.characterBalanceEditor.hidden || !this.characterBalanceSelect) {
      return;
    }
    const loadout = this.options.getBalanceLoadout?.();
    if (!loadout) {
      return;
    }

    const sidesByCharacter = new Map<CharacterId, string[]>();
    for (const playerId of ['P1', 'P2'] as const) {
      const characterId = loadout[playerId];
      const sides = sidesByCharacter.get(characterId) ?? [];
      sides.push(playerId);
      sidesByCharacter.set(characterId, sides);
    }
    const characterIds = [...sidesByCharacter.keys()];
    const actualIds = Array.from(this.characterBalanceSelect.options).map((option) => option.value);
    if (actualIds.join('|') !== characterIds.join('|')) {
      this.characterBalanceSelect.replaceChildren();
      for (const characterId of characterIds) {
        const option = document.createElement('option');
        option.value = characterId;
        const displayName = CHARACTER_BY_ID[characterId]?.displayName ?? characterId;
        option.textContent = `${displayName} (${sidesByCharacter.get(characterId)?.join(' / ')})`;
        this.characterBalanceSelect.appendChild(option);
      }
    }

    if (!this.selectedCharacterBalanceId || !characterIds.includes(this.selectedCharacterBalanceId)) {
      this.selectedCharacterBalanceId = characterIds[0] ?? null;
    }
    if (!this.selectedCharacterBalanceId) {
      return;
    }
    this.characterBalanceSelect.value = this.selectedCharacterBalanceId;

    const overrides = cloneCharacterBalanceOverrides(this.options.getCharacterBalanceOverrides?.());
    const customConfig = overrides[this.selectedCharacterBalanceId];
    const config = customConfig ?? createCharacterBalanceConfig(this.selectedCharacterBalanceId);
    for (const { field, input, row } of this.characterFieldInputs.values()) {
      const value = readCharacterTuningValue(config, field);
      row.hidden = value === null;
      if (value !== null) {
        input.value = String(value);
      }
    }
    if (this.characterBalanceIdentity) {
      const displayName = CHARACTER_BY_ID[this.selectedCharacterBalanceId]?.displayName
        ?? this.selectedCharacterBalanceId;
      const source = customConfig ? 'custom local override' : 'package defaults';
      this.characterBalanceIdentity.textContent = `${displayName} | ${source} | ${fingerprintCharacterBalanceConfig(config)}`;
    }
  }

  private updateCharacterTuningField(field: CharacterTuningField, rawValue: number): void {
    const characterId = this.selectedCharacterBalanceId;
    if (!characterId || !Number.isFinite(rawValue) || !this.options.setCharacterBalanceOverrides) {
      this.syncCharacterBalanceEditor();
      return;
    }
    const overrides = cloneCharacterBalanceOverrides(this.options.getCharacterBalanceOverrides?.());
    const config = overrides[characterId] ?? createCharacterBalanceConfig(characterId);
    if (!writeCharacterTuningValue(config, field, rawValue)) {
      this.syncCharacterBalanceEditor();
      return;
    }
    overrides[characterId] = sanitiseCharacterBalanceConfig(characterId, config);
    this.options.setCharacterBalanceOverrides(overrides);
    this.syncBalanceLab();
    if (this.copyStatus) {
      this.copyStatus.textContent = `${CHARACTER_BY_ID[characterId]?.displayName ?? characterId} change staged. Restart to test from frame zero.`;
    }
  }

  private resetSelectedCharacterBalance(): void {
    const characterId = this.selectedCharacterBalanceId;
    if (!characterId || !this.options.setCharacterBalanceOverrides) {
      return;
    }
    const overrides = cloneCharacterBalanceOverrides(this.options.getCharacterBalanceOverrides?.());
    delete overrides[characterId];
    this.options.setCharacterBalanceOverrides(overrides);
    this.syncBalanceLab();
    if (this.copyStatus) {
      this.copyStatus.textContent = `${CHARACTER_BY_ID[characterId]?.displayName ?? characterId} restored to package defaults.`;
    }
  }

  private updateAiBehaviorField(key: AiBehaviorTuningKey, rawValue: number): void {
    if (!Number.isFinite(rawValue) || !this.options.setAiBehaviorTuning) {
      this.syncAiBehaviorEditor();
      return;
    }
    const current = this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning();
    this.options.setAiBehaviorTuning(sanitiseAiBehaviorTuning({
      ...current,
      [key]: rawValue,
    }));
    this.syncAiBehaviorEditor();
    this.syncBalanceLab();
    if (this.copyStatus) {
      this.copyStatus.textContent = 'AI behavior change staged. Restart the same seed to apply it.';
    }
  }

  private syncAiBehaviorEditor(): void {
    const canTune = this.options.canTuneAiBehavior?.() ?? false;
    if (this.aiBehaviorEditor) {
      this.aiBehaviorEditor.hidden = !canTune;
    }
    const tuning = sanitiseAiBehaviorTuning(
      this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning(),
    );
    for (const [key, input] of this.aiBehaviorFieldInputs) {
      input.value = String(tuning[key]);
      input.disabled = !canTune;
    }
  }

  private updateTuningField(key: keyof GameTuning, rawValue: number): void {
    if (!Number.isFinite(rawValue)) {
      this.syncInputsFromTuning();
      return;
    }
    const nextTuning = sanitiseTuning({
      ...this.options.getTuning(),
      [key]: rawValue,
    });
    this.options.setTuning(nextTuning);
    this.syncInputsFromTuning();
    this.syncBalanceLab();
  }

  private syncInputsFromTuning(): void {
    const tuning = this.options.getTuning();
    for (const [key, input] of this.fieldInputs.entries()) {
      input.value = String(tuning[key]);
    }
  }

  private getBalanceLabPendingState(): BalanceLabPendingState {
    const scenarioId = this.options.getBalanceScenarioId?.() ?? 'standard';
    const activeScenarioId = this.options.getActiveBalanceScenarioId?.() ?? scenarioId;
    const state = {
      tuningDirty: Boolean(this.options.isBalanceTuningDirty?.()),
      characterDirty: Boolean(this.options.isCharacterBalanceDirty?.()),
      aiBehaviorDirty: Boolean(this.options.isAiBehaviorDirty?.()),
      aiControllerRolesDirty: Boolean(this.options.isAiControllerRolesDirty?.()),
      scenarioDirty: scenarioId !== activeScenarioId,
    };
    return {
      ...state,
      any: Object.values(state).some(Boolean),
    };
  }

  private requestAiRoundReview(request?: AiRoundReviewRequest): void {
    this.lastAiRoundReviewRequest = request
      ? {
          focusFrame: Math.max(0, Math.floor(request.focusFrame)),
          endFrame: request.endFrame === undefined
            ? undefined
            : Math.max(0, Math.floor(request.endFrame)),
          label: request.label,
        }
      : null;
    this.lastAiRoundReviewSequence = this.options.getBalanceSampleSequence?.() ?? null;
    this.options.onReviewAiRound?.(request);
  }

  private reviewBalanceReplaySample(variant: BalanceReplayVariant): void {
    const comparison = this.balanceReplayComparison;
    if (!comparison || !this.options.onReviewAiReplaySample) {
      return;
    }
    try {
      const selected = selectBalanceReplaySample(comparison, variant);
      const label = variant === 'baseline' ? 'Baseline incident' : 'Candidate incident';
      this.options.onReviewAiReplaySample(
        selected.payload,
        {
          focusFrame: selected.focus.focusFrame,
          endFrame: selected.focus.endFrame,
          label: selected.focus.label,
        },
        label,
      );
    } catch (error) {
      if (this.copyStatus) {
        this.copyStatus.textContent = error instanceof Error
          ? error.message
          : 'The selected incident replay is unavailable.';
      }
    }
  }

  private syncBalanceReplayCandidate(): void {
    const baseline = this.balanceBaseline;
    const existing = this.balanceReplayComparison;
    if (!baseline || !existing) {
      return;
    }
    const sequence = this.options.getBalanceSampleSequence?.() ?? baseline.sampleSequence;
    if (sequence === baseline.sampleSequence) {
      return;
    }
    if (this.balanceReplayCandidateSequence === sequence) {
      return;
    }
    if (existing.candidate) {
      this.balanceReplayComparison = createBalanceReplayComparison(
        existing.baseline.payload,
        existing.baseline.focus,
      );
      this.balanceReplayCandidateSequence = null;
      this.balanceReplayCandidateError = null;
    }

    const telemetry = this.options.getBalanceTelemetry?.();
    const replay = this.options.getAiRoundReplay?.();
    if (
      !telemetry
      || telemetry.framesSimulated !== baseline.framesSimulated
      || !replay
      || replay.inputTimeline.length !== baseline.framesSimulated
    ) {
      return;
    }

    const activeTuning = sanitiseTuning(
      this.options.getActiveBalanceTuning?.() ?? this.options.getTuning(),
    );
    const activeCharacterBalanceOverrides = cloneCharacterBalanceOverrides(
      this.options.getActiveCharacterBalanceOverrides?.()
        ?? this.options.getCharacterBalanceOverrides?.(),
    );
    const activeAiBehavior = sanitiseAiBehaviorTuning(
      this.options.getActiveAiBehaviorTuning?.()
        ?? this.options.getAiBehaviorTuning?.()
        ?? createDefaultAiBehaviorTuning(),
    );
    const ruleChanges = buildBalanceLabRuleChanges(
      baseline.tuning,
      activeTuning,
      baseline.characterBalanceOverrides,
      activeCharacterBalanceOverrides,
      [baseline.characters.P1.characterId, baseline.characters.P2.characterId],
      baseline.aiBehaviorTuning,
      activeAiBehavior,
    );

    try {
      this.balanceReplayComparison = attachBalanceReplayCandidate(
        this.balanceReplayComparison ?? existing,
        replay,
        ruleChanges,
      );
      this.balanceReplayCandidateError = null;
    } catch (error) {
      this.balanceReplayCandidateError = error instanceof Error
        ? error.message
        : 'Candidate replay could not be paired with the baseline.';
    }
    this.balanceReplayCandidateSequence = sequence;
  }

  private syncBalanceLab(): void {
    const tuning = this.options.getTuning();
    const profileId = this.options.getBalanceProfileId?.() ?? '__custom_local__';
    this.syncCharacterBalanceEditor();
    this.syncAiBehaviorEditor();
    if (this.balanceProfileSelect) {
      const hasProfile = Array.from(this.balanceProfileSelect.options)
        .some((option) => option.value === profileId);
      this.balanceProfileSelect.value = hasProfile ? profileId : '__custom_local__';
    }
    const scenarioId = this.options.getBalanceScenarioId?.() ?? 'standard';
    const activeScenarioId = this.options.getActiveBalanceScenarioId?.() ?? scenarioId;
    const pendingState = this.getBalanceLabPendingState();
    this.syncBalanceReplayCandidate();
    const scenarioDirty = pendingState.scenarioDirty;
    if (this.balanceScenarioSelect) {
      this.balanceScenarioSelect.value = scenarioId;
    }
    if (this.balanceScenarioDescription) {
      const scenario = resolveBalanceScenario(scenarioId);
      this.balanceScenarioDescription.textContent = `${scenario.description}${scenarioDirty ? ` Active run: ${resolveBalanceScenario(activeScenarioId).label}.` : ''}`;
    }
    const canTuneAiControllers = this.options.canTuneAiBehavior?.() ?? false;
    const humanPlayerId = this.options.getBalanceHumanPlayerId?.() ?? null;
    const aiPlayerIds = (['P1', 'P2'] as const).filter((playerId) => playerId !== humanPlayerId);
    const aiControllerRoles = sanitiseAiControllerRoles(
      this.options.getAiControllerRoles?.() ?? createDefaultAiControllerRoles(),
    );
    const activeAiControllerRoles = sanitiseAiControllerRoles(
      this.options.getActiveAiControllerRoles?.() ?? createDefaultAiControllerRoles(),
    );
    const aiControllerRolesDirty = pendingState.aiControllerRolesDirty;
    for (const playerId of ['P1', 'P2'] as const) {
      const row = this.aiControllerRoleRows[playerId];
      const select = this.aiControllerRoleSelects[playerId];
      if (row) {
        row.hidden = playerId === humanPlayerId;
      }
      if (select) {
        select.value = aiControllerRoles[playerId];
        select.disabled = !canTuneAiControllers || playerId === humanPlayerId;
      }
    }
    if (this.aiControllerRolesIntro) {
      this.aiControllerRolesIntro.textContent = humanPlayerId
        ? `${humanPlayerId} is controlled by you. Assign the AI opponent a full controller or deterministic test role; changes apply after a clean local restart.`
        : 'Assign a full AI or a deterministic test dummy to each side. Changes apply only after a clean local AI vs AI restart.';
    }
    if (this.aiControllerRoleDescription) {
      if (!canTuneAiControllers) {
        this.aiControllerRoleDescription.textContent = 'Controller roles are available only in local AI vs AI or Balance Sparring.';
      } else {
        const draftDescription = aiPlayerIds
          .map((playerId) => {
            const role = resolveAiControllerRole(aiControllerRoles[playerId]);
            return `${playerId} ${role.label}: ${role.description}`;
          })
          .join(' ');
        const activeDescription = aiControllerRolesDirty
          ? ` Active run: ${aiPlayerIds.map((playerId) => `${playerId} ${resolveAiControllerRole(activeAiControllerRoles[playerId]).label}`).join('; ')}.`
          : '';
        const humanDescription = humanPlayerId ? `${humanPlayerId} Human: direct player input. ` : '';
        this.aiControllerRoleDescription.textContent = `${humanDescription}${draftDescription}${activeDescription}`;
      }
    }
    const testRecipeId = getBalanceTestRecipeSelectionId(scenarioId, aiControllerRoles);
    const activeTestRecipeId = getBalanceTestRecipeSelectionId(
      activeScenarioId,
      activeAiControllerRoles,
    );
    if (this.balanceTestRecipeSelect) {
      this.balanceTestRecipeSelect.value = testRecipeId;
      this.balanceTestRecipeSelect.disabled = !canTuneAiControllers;
    }
    if (this.balanceTestRecipeDescription) {
      if (!canTuneAiControllers) {
        this.balanceTestRecipeDescription.textContent = 'Gameplay probes are available only in local AI vs AI or Balance Sparring.';
      } else if (testRecipeId === 'custom') {
        const activeLabel = activeTestRecipeId === 'custom'
          ? 'Custom setup'
          : resolveBalanceTestRecipe(activeTestRecipeId).label;
        const controllerCopy = humanPlayerId ? 'P2 AI controller' : 'per-side controllers';
        this.balanceTestRecipeDescription.textContent = `Custom setup: choose the exact starting situation and ${controllerCopy} below.${scenarioDirty || aiControllerRolesDirty ? ` Active run: ${activeLabel}.` : ''}`;
      } else {
        const recipe = resolveBalanceTestRecipe(testRecipeId);
        const activeLabel = activeTestRecipeId === 'custom'
          ? 'Custom setup'
          : resolveBalanceTestRecipe(activeTestRecipeId).label;
        const activeDescription = testRecipeId !== activeTestRecipeId
          ? ` Active run: ${activeLabel}.`
          : '';
        const humanDescription = humanPlayerId
          ? `${humanPlayerId} remains under your control; this probe stages the situation and P2 AI role. `
          : '';
        this.balanceTestRecipeDescription.textContent = `${humanDescription}${recipe.description} Question: ${recipe.designerQuestion} Suggested observation: ${recipe.suggestedDurationSeconds}s.${activeDescription}`;
      }
    }
    if (this.balanceIdentity) {
      const pendingRestart = pendingState.any ? ' | pending clean restart' : '';
      const draftTuningFingerprint = fingerprintBalanceTuning(tuning);
      const activeTuningFingerprint = this.options.getActiveBalanceTuningFingerprint?.()
        ?? draftTuningFingerprint;
      const tuningIdentity = draftTuningFingerprint === activeTuningFingerprint
        ? `global ${activeTuningFingerprint}`
        : `active global ${activeTuningFingerprint} | draft ${draftTuningFingerprint}`;
      const characterFingerprint = fingerprintCharacterBalanceOverrides(
        this.options.getCharacterBalanceOverrides?.(),
      );
      const activeCharacterFingerprint = this.options.getActiveCharacterBalanceFingerprint?.()
        ?? characterFingerprint;
      const characterIdentity = characterFingerprint === activeCharacterFingerprint
        ? `characters ${activeCharacterFingerprint}`
        : `active characters ${activeCharacterFingerprint} | draft ${characterFingerprint}`;
      const aiBehavior = sanitiseAiBehaviorTuning(
        this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning(),
      );
      const aiBehaviorFingerprint = fingerprintAiBehaviorTuning(aiBehavior);
      const activeAiBehaviorFingerprint = this.options.getActiveAiBehaviorFingerprint?.()
        ?? aiBehaviorFingerprint;
      const aiBehaviorIdentity = aiBehaviorFingerprint === activeAiBehaviorFingerprint
        ? `AI ${activeAiBehaviorFingerprint}`
        : `active AI ${activeAiBehaviorFingerprint} | draft ${aiBehaviorFingerprint}`;
      const scenarioIdentity = scenarioDirty
        ? `active situation ${activeScenarioId} | draft ${scenarioId}`
        : `situation ${scenarioId}`;
      const draftRoleFingerprint = fingerprintAiControllerRoles(aiControllerRoles);
      const activeRoleFingerprint = fingerprintAiControllerRoles(activeAiControllerRoles);
      const draftRoleLabels = `P1 ${resolveAiControllerRole(aiControllerRoles.P1).label} / P2 ${resolveAiControllerRole(aiControllerRoles.P2).label}`;
      const activeRoleLabels = `P1 ${resolveAiControllerRole(activeAiControllerRoles.P1).label} / P2 ${resolveAiControllerRole(activeAiControllerRoles.P2).label}`;
      const controllerIdentity = draftRoleFingerprint === activeRoleFingerprint
        ? `controllers ${draftRoleLabels}`
        : `active controllers ${activeRoleLabels} | draft ${draftRoleLabels}`;
      const recipeIdentity = testRecipeId === activeTestRecipeId
        ? `probe ${testRecipeId}`
        : `active probe ${activeTestRecipeId} | draft ${testRecipeId}`;
      this.balanceIdentity.textContent = `Draft: ${profileId} | ${recipeIdentity} | ${scenarioIdentity} | ${controllerIdentity} | ${tuningIdentity} | ${characterIdentity} | ${aiBehaviorIdentity}${pendingRestart}`;
      this.balanceIdentity.classList.toggle(
        'dirty',
        pendingState.any,
      );
    }
    if (this.restartBalanceLabButton) {
      const canRestart = this.options.canRestartBalanceLab?.() ?? false;
      this.restartBalanceLabButton.hidden = !canRestart;
      this.restartBalanceLabButton.disabled = !canRestart;
    }
    if (this.matchedBalanceLabButton) {
      const canRestart = this.options.canRestartBalanceLab?.() ?? false;
      const baselineSeconds = this.balanceBaseline?.flow.elapsedSeconds ?? 0;
      const hasBaseline = this.balanceBaseline !== null;
      const meaningfulSample = baselineSeconds >= 10;
      this.matchedBalanceLabButton.hidden = !canRestart || !hasBaseline;
      this.matchedBalanceLabButton.disabled = !canRestart || !meaningfulSample;
      this.matchedBalanceLabButton.textContent = hasBaseline
        ? `Apply + Run ${baselineSeconds.toFixed(1)}s Matched Sample`
        : 'Apply + Run Baseline Length';
      this.matchedBalanceLabButton.title = meaningfulSample
        ? 'Restart this seed and auto-open Balance Lab at the exact baseline frame count.'
        : 'Capture at least 10 seconds before running a matched sample.';
    }
    if (this.exportBalanceExperimentButton) {
      const telemetry = this.options.getBalanceTelemetry?.();
      const canExport = this.balanceBaseline !== null
        && telemetry !== undefined
        && telemetry.framesSimulated > 0;
      this.exportBalanceExperimentButton.disabled = !canExport;
      this.exportBalanceExperimentButton.title = canExport
        ? 'Download baseline and candidate rules, raw telemetry, flow models, diagnostics, and deltas.'
        : 'Capture a baseline before exporting a reproducible comparison.';
    }
    const baselineReviewLocked = this.balanceBaseline !== null;
    if (this.balanceBaselineNotesInput) {
      this.balanceBaselineNotesInput.disabled = baselineReviewLocked;
      this.balanceBaselineNotesInput.title = baselineReviewLocked
        ? 'This note was frozen with the captured baseline. Clear the baseline to edit it.'
        : 'Describe the baseline before capturing it.';
    }
    for (const stageId of BALANCE_LAB_LOOP_STAGE_IDS) {
      const select = this.balancePlaytestVerdictSelects.baseline[stageId];
      if (select) {
        select.disabled = baselineReviewLocked;
        select.title = baselineReviewLocked
          ? 'This rating was frozen with the captured baseline.'
          : 'Rate this stage before capturing the baseline.';
      }
    }
    if (this.restoreBalanceBaselineButton) {
      const canRestore = this.balanceBaseline !== null;
      this.restoreBalanceBaselineButton.disabled = !canRestore;
      this.restoreBalanceBaselineButton.title = canRestore
        ? 'Stage the captured global rules, character overrides, AI behavior, starting situation, and controller roles. Restart to apply them.'
        : 'Capture a baseline before restoring its exact local rules and probe setup.';
    }
    if (this.reviewBalanceBaselineButton) {
      const canReview = this.balanceReplayComparison !== null
        && this.options.onReviewAiReplaySample !== undefined;
      this.reviewBalanceBaselineButton.disabled = !canReview;
      this.reviewBalanceBaselineButton.title = canReview
        ? 'Open the checksum-verified baseline at the captured incident window.'
        : 'Capture a replay-backed AI baseline before reviewing it.';
    }
    if (this.reviewBalanceCandidateButton) {
      const canReview = this.balanceReplayComparison?.candidate !== null
        && this.balanceReplayComparison?.candidate !== undefined
        && this.options.onReviewAiReplaySample !== undefined;
      this.reviewBalanceCandidateButton.disabled = !canReview;
      this.reviewBalanceCandidateButton.title = canReview
        ? 'Open the checksum-verified candidate at the same incident window.'
        : this.balanceReplayCandidateError
          ?? 'Run a matched sample with zero or one effective rule change to create a candidate replay.';
    }
    if (this.discardBalanceDraftButton) {
      this.discardBalanceDraftButton.disabled = !pendingState.any;
      this.discardBalanceDraftButton.title = pendingState.any
        ? 'Replace the pending draft with the exact rules and probe setup used by the current active run.'
        : 'No staged changes to discard.';
    }
    this.renderPendingBalanceChanges(pendingState);
    this.renderAiDecisionInspector();
    this.renderBalanceFlow();
  }

  private renderPendingBalanceChanges(pendingState: BalanceLabPendingState): void {
    const panel = this.balancePendingChangesPanel;
    if (!panel) {
      return;
    }
    panel.replaceChildren();
    panel.classList.toggle('dirty', pendingState.any);

    const header = document.createElement('div');
    header.className = 'balance-pending-changes-header';
    const title = document.createElement('strong');
    title.textContent = 'Next Run Changes';
    const status = document.createElement('span');
    status.textContent = pendingState.any
      ? 'Staged only; current telemetry is unchanged'
      : 'Next restart matches the current active run';
    header.append(title, status);
    panel.appendChild(header);

    if (!pendingState.any) {
      const empty = document.createElement('p');
      empty.textContent = 'No pending global, AI, character, starting-situation, or controller changes.';
      panel.appendChild(empty);
      return;
    }

    const activeTuning = sanitiseTuning(
      this.options.getActiveBalanceTuning?.() ?? this.options.getTuning(),
    );
    const draftTuning = sanitiseTuning(this.options.getTuning());
    const activeCharacterOverrides = cloneCharacterBalanceOverrides(
      this.options.getActiveCharacterBalanceOverrides?.()
        ?? this.options.getCharacterBalanceOverrides?.(),
    );
    const draftCharacterOverrides = cloneCharacterBalanceOverrides(
      this.options.getCharacterBalanceOverrides?.(),
    );
    const activeAiBehavior = sanitiseAiBehaviorTuning(
      this.options.getActiveAiBehaviorTuning?.()
        ?? this.options.getAiBehaviorTuning?.()
        ?? createDefaultAiBehaviorTuning(),
    );
    const draftAiBehavior = sanitiseAiBehaviorTuning(
      this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning(),
    );
    const loadout = this.options.getBalanceLoadout?.();
    const characterIds = Array.from(new Set<CharacterId>([
      ...(loadout ? [loadout.P1, loadout.P2] : []),
      ...(Object.keys(activeCharacterOverrides) as CharacterId[]),
      ...(Object.keys(draftCharacterOverrides) as CharacterId[]),
    ]));
    const ruleChanges = buildBalanceLabRuleChanges(
      activeTuning,
      draftTuning,
      activeCharacterOverrides,
      draftCharacterOverrides,
      characterIds,
      activeAiBehavior,
      draftAiBehavior,
    );
    const list = document.createElement('div');
    list.className = 'balance-pending-change-list';
    const appendChange = (label: string, value: string, scope: string): void => {
      const row = document.createElement('div');
      row.className = `balance-pending-change ${scope}`;
      const changeLabel = document.createElement('strong');
      changeLabel.textContent = label;
      const changeValue = document.createElement('span');
      changeValue.textContent = value;
      row.append(changeLabel, changeValue);
      list.appendChild(row);
    };

    const visibleRuleChanges = ruleChanges.slice(0, 12);
    for (const change of visibleRuleChanges) {
      const signedDelta = `${change.delta >= 0 ? '+' : ''}${formatRuleValue(change.delta)}`;
      appendChange(
        formatBalanceRuleChangeLabel(change),
        `${formatRuleValue(change.baselineValue)} to ${formatRuleValue(change.candidateValue)} (${signedDelta})`,
        change.scope,
      );
    }
    if (visibleRuleChanges.length < ruleChanges.length) {
      appendChange(
        'Additional numeric changes',
        `${ruleChanges.length - visibleRuleChanges.length} more in exported Balance JSON`,
        'more',
      );
    }

    const scenarioId = this.options.getBalanceScenarioId?.() ?? 'standard';
    const activeScenarioId = this.options.getActiveBalanceScenarioId?.() ?? scenarioId;
    if (scenarioId !== activeScenarioId) {
      appendChange(
        'Starting situation',
        `${resolveBalanceScenario(activeScenarioId).label} to ${resolveBalanceScenario(scenarioId).label}`,
        'scenario',
      );
    }
    const roles = sanitiseAiControllerRoles(
      this.options.getAiControllerRoles?.() ?? createDefaultAiControllerRoles(),
    );
    const activeRoles = sanitiseAiControllerRoles(
      this.options.getActiveAiControllerRoles?.() ?? createDefaultAiControllerRoles(),
    );
    const humanPlayerId = this.options.getBalanceHumanPlayerId?.() ?? null;
    for (const playerId of ['P1', 'P2'] as const) {
      if (playerId === humanPlayerId) {
        continue;
      }
      if (roles[playerId] !== activeRoles[playerId]) {
        appendChange(
          `${playerId} controller`,
          `${resolveAiControllerRole(activeRoles[playerId]).label} to ${resolveAiControllerRole(roles[playerId]).label}`,
          'controller',
        );
      }
    }
    panel.appendChild(list);
  }

  private renderAiDecisionInspector(): void {
    if (!this.aiDecisionPanel) {
      return;
    }
    this.aiDecisionPanel.replaceChildren();
    const telemetry = this.options.getAiDecisionTelemetry?.();
    const formatLabel = (value: string): string => value.replace(/_/g, ' ');
    if (!telemetry || (!telemetry.latest.P1 && !telemetry.latest.P2)) {
      const empty = document.createElement('p');
      empty.className = 'balance-lab-empty';
      empty.textContent = 'No AI decisions yet. Run AI vs AI, then pause to inspect intent, action gates, and weighted choices.';
      this.aiDecisionPanel.appendChild(empty);
      return;
    }

    const summary = document.createElement('p');
    summary.className = 'balance-ai-decision-summary';
    summary.textContent = `${telemetry.framesObserved} frames observed | ${telemetry.events.length} change/action events retained${telemetry.droppedEvents > 0 ? ` | ${telemetry.droppedEvents} older events dropped` : ''}`;
    this.aiDecisionPanel.appendChild(summary);

    const latestGrid = document.createElement('div');
    latestGrid.className = 'balance-ai-decision-grid';
    for (const playerId of ['P1', 'P2'] as const) {
      const decision = telemetry.latest[playerId];
      if (!decision) {
        continue;
      }
      const card = document.createElement('article');
      card.className = 'balance-ai-decision-card';
      const heading = document.createElement('h5');
      heading.textContent = `${playerId} | ${resolveAiControllerRole(decision.controllerRoleId).label} | ${decision.profileId} | ${formatLabel(decision.movementIntent)}`;
      const choice = document.createElement('p');
      choice.textContent = decision.selectedAction
        ? `Selected ${formatLabel(decision.selectedAction)}: ${formatLabel(decision.selectedReason)}`
        : `No tactical action: ${formatLabel(decision.selectedReason)}`;
      const context = document.createElement('p');
      context.textContent = `Distance ${decision.context.distance.toFixed(1)} | fuel ${(decision.context.fuelRatio * 100).toFixed(0)}% | reaction ${decision.gates.reactionFramesRemaining}f | lock ${decision.gates.decisionLockFrames}f${decision.selectionRoll === null ? '' : ` | roll ${decision.selectionRoll.toFixed(3)}`}`;
      const candidates = document.createElement('div');
      candidates.className = 'balance-ai-candidates';
      for (const action of AI_DECISION_CANDIDATES) {
        const candidate = decision.candidates[action];
        const row = document.createElement('div');
        row.className = candidate.eligible ? 'ready' : 'blocked';
        const status = candidate.eligible ? 'ready' : formatLabel(candidate.reason);
        row.textContent = `${formatLabel(action)} | ${status} | weight ${candidate.weight.toFixed(2)}`;
        candidates.appendChild(row);
      }
      card.append(heading, choice, context, candidates);
      latestGrid.appendChild(card);
    }
    this.aiDecisionPanel.appendChild(latestGrid);

    const recentHeading = document.createElement('h5');
    recentHeading.textContent = 'Recent intent changes and tactical choices';
    this.aiDecisionPanel.appendChild(recentHeading);
    const recent = document.createElement('div');
    recent.className = 'balance-ai-decision-events';
    for (const event of telemetry.events.slice(-12).reverse()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'balance-ai-decision-event';
      const action = event.decision.selectedAction
        ? formatLabel(event.decision.selectedAction)
        : formatLabel(event.decision.movementIntent);
      button.textContent = `f${event.frame} ${event.playerId} | ${action} | ${formatLabel(event.decision.selectedReason)}`;
      button.title = 'Open the exact local replay around this AI decision.';
      button.disabled = !(this.options.canReviewAiRound?.() ?? false);
      button.addEventListener('click', () => {
        this.requestAiRoundReview({
          focusFrame: Math.max(0, event.frame - 30),
          endFrame: event.frame + 30,
          label: `${event.playerId} AI decision at frame ${event.frame}`,
        });
      });
      recent.appendChild(button);
    }
    this.aiDecisionPanel.appendChild(recent);
  }

  private renderBalanceFlow(): void {
    if (!this.balanceFlowPanel) {
      return;
    }
    this.balanceFlowPanel.replaceChildren();
    const telemetry = this.options.getBalanceTelemetry?.();
    if (!telemetry || telemetry.framesSimulated <= 0) {
      const empty = document.createElement('p');
      empty.className = 'balance-lab-empty';
      empty.textContent = 'No local round data yet. Resume AI vs AI or Training, then pause again to inspect the flow.';
      this.balanceFlowPanel.appendChild(empty);
      return;
    }

    const flow = buildBalanceLabFlowModel(telemetry);
    const heading = document.createElement('div');
    heading.className = 'balance-lab-flow-heading';
    heading.textContent = `Current run | ${flow.elapsedSeconds.toFixed(1)}s | average distance ${flow.averageDistance.toFixed(1)}`;
    this.balanceFlowPanel.appendChild(heading);
    const readingOrder = document.createElement('p');
    readingOrder.className = 'balance-flow-reading-order';
    readingOrder.textContent = 'Start with the fight story, then inspect its exact exchange or probe. Diagnostics identify loops worth inspecting; detailed counters are collapsed below.';
    this.balanceFlowPanel.appendChild(readingOrder);

    const story = buildBalanceLabFightStory(flow);
    const fightStory = document.createElement('section');
    fightStory.className = `balance-fight-story ${story.status}`;
    if (story.focusStageId) {
      fightStory.dataset.focusStage = story.focusStageId;
    }
    const storyHeader = document.createElement('div');
    storyHeader.className = 'balance-fight-story-header';
    const storyLabel = document.createElement('span');
    storyLabel.textContent = 'Fight story';
    const storyHeadline = document.createElement('strong');
    storyHeadline.textContent = story.headline;
    storyHeader.append(storyLabel, storyHeadline);
    const storyOverview = document.createElement('p');
    storyOverview.className = 'balance-fight-story-overview';
    storyOverview.textContent = story.overview;
    const storyFinding = document.createElement('p');
    storyFinding.className = 'balance-fight-story-finding';
    storyFinding.textContent = story.finding;
    fightStory.append(storyHeader, storyOverview, storyFinding);

    if (story.suggestedRecipeId && story.suggestedReason) {
      const recipe = resolveBalanceTestRecipe(story.suggestedRecipeId);
      const recommendation = document.createElement('div');
      recommendation.className = 'balance-fight-story-next';
      const recommendationCopy = document.createElement('div');
      const recommendationLabel = document.createElement('strong');
      recommendationLabel.textContent = `Suggested controlled check: ${recipe.label}`;
      const recommendationReason = document.createElement('span');
      recommendationReason.textContent = `${story.suggestedReason} Observe for ${recipe.suggestedDurationSeconds}s; this does not change any rule.`;
      recommendationCopy.append(recommendationLabel, recommendationReason);
      const stagedRecipeId = getBalanceTestRecipeSelectionId(
        this.options.getBalanceScenarioId?.(),
        this.options.getAiControllerRoles?.(),
      );
      const recipeAlreadyStaged = stagedRecipeId === recipe.id;
      const stageButton = document.createElement('button');
      stageButton.type = 'button';
      stageButton.className = 'balance-fight-story-action';
      stageButton.textContent = recipeAlreadyStaged
        ? `${recipe.label} already selected`
        : `Stage ${recipe.label}`;
      stageButton.disabled = recipeAlreadyStaged
        || !(this.options.canTuneAiBehavior?.() ?? false)
        || !this.options.onApplyBalanceTestRecipe;
      stageButton.addEventListener('click', () => {
        this.options.onApplyBalanceTestRecipe?.(recipe.id);
        this.syncBalanceLab();
        if (this.copyStatus) {
          this.copyStatus.textContent = `${recipe.label} staged. Restart to run the controlled check from frame zero; active rules are unchanged.`;
        }
      });
      recommendation.append(recommendationCopy, stageButton);
      fightStory.appendChild(recommendation);
    }
    this.balanceFlowPanel.appendChild(fightStory);

    const loopChain = document.createElement('section');
    loopChain.className = 'balance-loop-chain';
    const loopChainHeader = document.createElement('div');
    loopChainHeader.className = 'balance-loop-chain-header';
    const loopChainTitle = document.createElement('strong');
    loopChainTitle.textContent = 'Gameplay loop chain';
    const loopChainHint = document.createElement('span');
    loopChainHint.textContent = 'Flow evidence only; no class win-rate scoring';
    loopChainHeader.append(loopChainTitle, loopChainHint);
    const loopChainGrid = document.createElement('div');
    loopChainGrid.className = 'balance-loop-chain-grid';
    for (const [index, stage] of flow.loopStages.entries()) {
      const item = document.createElement('article');
      item.className = `balance-loop-stage ${stage.status}`;
      const itemHeader = document.createElement('div');
      itemHeader.className = 'balance-loop-stage-header';
      const label = document.createElement('strong');
      label.textContent = `${String(index + 1).padStart(2, '0')} ${stage.label}`;
      const status = document.createElement('span');
      status.className = 'balance-loop-stage-status';
      status.textContent = stage.status;
      itemHeader.append(label, status);
      const detail = document.createElement('p');
      detail.textContent = stage.detail;
      item.append(itemHeader, detail);
      if (stage.status === 'watch' || stage.status === 'blocked') {
        const tuningHints = this.createDiagnosticTuningHints(stage, 3);
        if (tuningHints) {
          item.appendChild(tuningHints);
        }
      }
      loopChainGrid.appendChild(item);
    }
    loopChain.append(loopChainHeader, loopChainGrid);
    this.balanceFlowPanel.appendChild(loopChain);

    const metrics = document.createElement('div');
    metrics.className = 'balance-lab-metrics';
    const appendMetric = (label: string, value: string): void => {
      const metric = document.createElement('div');
      metric.className = 'balance-lab-metric';
      const metricLabel = document.createElement('span');
      metricLabel.textContent = label;
      const metricValue = document.createElement('strong');
      metricValue.textContent = value;
      metric.append(metricLabel, metricValue);
      metrics.appendChild(metric);
    };
    appendMetric('Contact / overlap', `${Math.round(flow.contactRatio * 100)}%`);
    appendMetric(
      'Contact episodes',
      `${flow.contactEpisodes} | avg ${flow.averageContactEpisodeSeconds.toFixed(2)}s | p90 ${flow.p90ContactEpisodeSeconds.toFixed(2)}s | max ${flow.maximumContactEpisodeSeconds.toFixed(2)}s`,
    );
    appendMetric('Point blank', `${Math.round(flow.pointBlankRatio * 100)}%`);
    appendMetric('Pressure band', `${Math.round(flow.pressureBandRatio * 100)}%`);
    appendMetric(
      'Shared movement control',
      `${Math.round(flow.sharedAgency.controlRatio * 100)}% | ${flow.sharedAgency.controlSeconds.toFixed(1)}s`,
    );
    appendMetric(
      'Contact / pressure while both steer',
      `${Math.round(flow.sharedAgency.controlContactRatio * 100)}% / ${Math.round(flow.sharedAgency.controlPressureRatio * 100)}%`,
    );
    appendMetric(
      'Shared action-ready time',
      `${Math.round(flow.sharedAgency.actionReadyRatio * 100)}% round | ${Math.round(flow.sharedAgency.actionReadyShareOfControlFrames * 100)}% of shared control | ${flow.sharedAgency.actionReadySeconds.toFixed(1)}s`,
    );
    appendMetric(
      'Contact while both can act',
      `${Math.round(flow.sharedAgency.contactRatio * 100)}% | p90 ${flow.sharedAgency.p90ContactEpisodeSeconds.toFixed(2)}s | max ${flow.sharedAgency.maximumContactEpisodeSeconds.toFixed(2)}s`,
    );
    appendMetric(
      'Pressure / neutral while both can act',
      `${Math.round(flow.sharedAgency.pressureRatio * 100)}% / ${Math.round(flow.sharedAgency.neutralRatio * 100)}%`,
    );
    appendMetric(
      'Shared decision windows',
      `${flow.sharedAgency.sustainedNeutralWindows} >=${flow.sharedAgency.sustainedWindowThresholdSeconds.toFixed(2)}s | p90 ${flow.sharedAgency.p90NeutralEpisodeSeconds.toFixed(2)}s | max ${flow.sharedAgency.maximumNeutralEpisodeSeconds.toFixed(2)}s`,
    );
    appendMetric('Launch clashes', `${flow.launchClashes} | ${flow.clashesPerMinute.toFixed(1)}/min`);
    const clashRecurrenceOpportunities = Math.max(0, flow.clashFollowUp.clashes - 1);
    appendMetric(
      'Clash recurrence <=1s',
      clashRecurrenceOpportunities > 0
        ? `${flow.clashFollowUp.repeatClashesWithinOneSecond}/${clashRecurrenceOpportunities} (${Math.round(flow.clashFollowUp.repeatClashRatio * 100)}%)`
        : '--',
    );
    const clashFollowUp = (playerId: PlayerId): string => {
      const player = flow.clashFollowUp.players[playerId];
      if (flow.clashFollowUp.clashes === 0) {
        return '--';
      }
      const actionLabels: Record<(typeof BALANCE_LAB_CONTROL_RETURN_ACTIONS)[number], string> = {
        boost: 'B',
        super_boost: 'SB',
        special: 'SP',
        launch: 'LN',
        dunk: 'DK',
        parry: 'PR',
        launch_break: 'BR',
      };
      const mix = BALANCE_LAB_CONTROL_RETURN_ACTIONS
        .map((action) => ({ action, starts: player.firstAcceptedActions[action].starts }))
        .filter(({ starts }) => starts > 0)
        .sort((first, second) => second.starts - first.starts || first.action.localeCompare(second.action))
        .map(({ action, starts }) => `${actionLabels[action]} ${starts}`)
        .join(' | ');
      const delay = player.averageFirstActionDelaySeconds === null
        ? '-- delay'
        : `${player.averageFirstActionDelaySeconds.toFixed(2)}s delay`;
      return `${mix || 'none'} | acted ${player.firstActions}/${flow.clashFollowUp.clashes} | <=1s ${player.firstActionsWithinOneSecond} | rapid LN ${player.rapidLaunchRecommits} | pressure ${player.firstActionsInPressure} | ${delay}`;
    };
    appendMetric('P1 first action after clash', clashFollowUp('P1'));
    appendMetric('P2 first action after clash', clashFollowUp('P2'));
    appendMetric('First pressure', flow.firstPressureSeconds === null ? '--' : `${flow.firstPressureSeconds.toFixed(1)}s`);
    appendMetric('Spacing resets', `${flow.neutralResets} | ${flow.neutralResetsPerMinute.toFixed(1)}/min`);
    appendMetric('Pressure avg / p90', `${flow.averagePressureSequenceSeconds.toFixed(1)}s / ${flow.p90PressureSequenceSeconds.toFixed(1)}s`);
    appendMetric('Longest pressure', `${flow.longestPressureSequenceSeconds.toFixed(1)}s`);
    appendMetric('Distance-only neutral avg / max', `${flow.averageNeutralWindowSeconds.toFixed(1)}s / ${flow.longestNeutralWindowSeconds.toFixed(1)}s`);
    const resetConversion = (outcome: BalanceLabFlowModel['resetOutcomes']['all']): string => (
      outcome.attempts > 0
        ? `${outcome.successes}/${outcome.attempts} (${Math.round(outcome.successRatio * 100)}%)`
        : '--'
    );
    appendMetric('All reset conversion', resetConversion(flow.resetOutcomes.all));
    appendMetric('Clash reset conversion', resetConversion(flow.resetOutcomes.clashes));
    appendMetric('Parry reset conversion', resetConversion(flow.resetOutcomes.parries));
    appendMetric('Launch break reset conversion', resetConversion(flow.resetOutcomes.launchBreaks));
    appendMetric('P1 empty', `${Math.round(flow.players.P1.zeroFuelRatio * 100)}%`);
    appendMetric('P2 empty', `${Math.round(flow.players.P2.zeroFuelRatio * 100)}%`);
    appendMetric('P1 helpless', `${Math.round(flow.players.P1.helplessRatio * 100)}%`);
    appendMetric('P2 helpless', `${Math.round(flow.players.P2.helplessRatio * 100)}%`);
    const launchPressure = (player: BalanceLabFlowModel['players']['P1']): string => (
      player.helplessSecondsPerLaunchReceived === null
        ? `${player.launchHitsReceived} received | -- per hit`
        : `${player.launchHitsReceived} received | ${player.helplessSecondsPerLaunchReceived.toFixed(2)}s per hit`
    );
    appendMetric('P1 launch pressure', launchPressure(flow.players.P1));
    appendMetric('P2 launch pressure', launchPressure(flow.players.P2));
    const launchDefense = (player: BalanceLabFlowModel['players']['P1']): string => {
      const defense = player.launchDefense;
      if (defense.incomingPressureLaunches === 0) {
        return '--';
      }
      const answers = defense.preemptiveResponses + defense.reactiveResponses;
      const delay = defense.averageReactiveResponseSeconds === null
        ? '-- reactive delay'
        : `${defense.averageReactiveResponseSeconds.toFixed(3)}s reactive delay`;
      const unattributed = defense.unattributedParrySuccesses > 0
        ? ` | ${defense.unattributedParrySuccesses} unattributed`
        : '';
      return `${defense.incomingPressureLaunches} incoming | answered ${answers} (${Math.round(defense.responseCoverageRatio * 100)}%; pre ${defense.preemptiveResponses} / react ${defense.reactiveResponses}) | answers PR ${defense.parryResponses} / GD ${defense.guardResponses} / LN ${defense.counterLaunchResponses} | success PR ${defense.successfulParries} / GD ${defense.successfulGuards} / clash ${defense.launchClashes} / counter ${defense.counterLaunchHits}${unattributed} | hit ${defense.launchHits} (unanswered ${defense.unansweredLaunchHits}) | reset ${defense.sustainedResetsAfterSuccessfulDefense}/${defense.successfulDefenses} | ${delay}`;
    };
    appendMetric('P1 launch-defense reads', launchDefense(flow.players.P1));
    appendMetric('P2 launch-defense reads', launchDefense(flow.players.P2));
    const controlReturn = (player: BalanceLabFlowModel['players']['P1']): string => {
      const control = player.controlReturn;
      if (control.controlReturns === 0) {
        return '--';
      }
      const averageWindow = control.averageControlWindowSeconds === null
        ? '-- avg'
        : `${control.averageControlWindowSeconds.toFixed(2)}s avg`;
      return `${control.controlReturns} returns | <=1s ${control.relaunchesWithinOneSecond} (${Math.round(control.immediateRelaunchRatio * 100)}%) | ${averageWindow} | acted ${control.relaunchesWithAcceptedAction}/${control.relaunchesAfterControlReturn} | return reset ${control.sustainedResetsAfterControlReturn}/${control.controlReturnsInPressure} | action reset ${control.sustainedResetsAfterFirstAction}/${control.firstActionsInPressure}`;
    };
    appendMetric('P1 return -> re-launch', controlReturn(flow.players.P1));
    appendMetric('P2 return -> re-launch', controlReturn(flow.players.P2));
    const postReturnActions = (player: BalanceLabFlowModel['players']['P1']): string => {
      const control = player.controlReturn;
      const actionLabels: Record<(typeof BALANCE_LAB_CONTROL_RETURN_ACTIONS)[number], string> = {
        boost: 'B',
        super_boost: 'SB',
        special: 'SP',
        launch: 'LN',
        dunk: 'DK',
        parry: 'PR',
        launch_break: 'BR',
      };
      const mix = BALANCE_LAB_CONTROL_RETURN_ACTIONS
        .map((action) => ({ action, starts: control.firstAcceptedActions[action].starts }))
        .filter(({ starts }) => starts > 0)
        .sort((first, second) => second.starts - first.starts || first.action.localeCompare(second.action))
        .map(({ action, starts }) => `${actionLabels[action]} ${starts}`)
        .join(' | ');
      const delay = control.averageFirstActionDelaySeconds === null
        ? '-- delay'
        : `${control.averageFirstActionDelaySeconds.toFixed(2)}s delay`;
      return `${mix || 'none'} | ${delay}`;
    };
    appendMetric('P1 first action after return', postReturnActions(flow.players.P1));
    appendMetric('P2 first action after return', postReturnActions(flow.players.P2));
    const breakTiming = (player: BalanceLabFlowModel['players']['P1']): string => (
      player.breakEscapes > 0
        ? `${player.breakEscapes} | ${player.averageBreakReactionSeconds.toFixed(2)}s avg`
        : '--'
    );
    appendMetric('P1 launch breaks', breakTiming(flow.players.P1));
    appendMetric('P2 launch breaks', breakTiming(flow.players.P2));
    appendMetric('P1 accepted', `${Math.round(flow.players.P1.inputAcceptanceRatio * 100)}%`);
    appendMetric('P2 accepted', `${Math.round(flow.players.P2.inputAcceptanceRatio * 100)}%`);
    const actionAcceptance = (player: BalanceLabFlowModel['players']['P1']): string => ([
      ['L', player.actionAcceptance.launch],
      ['S', player.actionAcceptance.special],
      ['D', player.actionAcceptance.dunk],
      ['P', player.actionAcceptance.parry],
      ['B', player.actionAcceptance.launch_break],
    ] as const).map(([label, action]) => (
      `${label} ${action.starts}/${action.presses}`
    )).join(' | ');
    appendMetric('P1 accepted / requests', actionAcceptance(flow.players.P1));
    appendMetric('P2 accepted / requests', actionAcceptance(flow.players.P2));
    appendMetric('Accepted combat starts / min', `${flow.players.P1.acceptedActionsPerMinute.toFixed(1)} / ${flow.players.P2.acceptedActionsPerMinute.toFixed(1)}`);
    appendMetric('P1 tactical kit', `${flow.players.P1.acceptedTacticalActions.length}/6`);
    appendMetric('P2 tactical kit', `${flow.players.P2.acceptedTacticalActions.length}/6`);
    const movementRatios = (player: BalanceLabFlowModel['players']['P1']): string => {
      const movement = player.movementIntent;
      return [
        movement.approachRatio,
        movement.orbitRatio,
        movement.retreatRatio,
        movement.idleRatio,
      ].map((ratio) => `${Math.round(ratio * 100)}%`).join(' / ');
    };
    const closeMovementRatios = (
      player: BalanceLabFlowModel['players']['P1'],
      band: 'pressure' | 'point_blank',
    ): string => {
      const movement = player.movementIntent;
      const approach = band === 'pressure'
        ? movement.contestedPressureApproachRatio
        : movement.contestedPointBlankApproachRatio;
      const retreat = band === 'pressure'
        ? movement.contestedPressureRetreatRatio
        : movement.contestedPointBlankRetreatRatio;
      return `${Math.round(approach * 100)}% / ${Math.round(retreat * 100)}%`;
    };
    appendMetric('P1 movement A / O / D / I', movementRatios(flow.players.P1));
    appendMetric('P2 movement A / O / D / I', movementRatios(flow.players.P2));
    appendMetric('Both-active pressure A / D', `${closeMovementRatios(flow.players.P1, 'pressure')} | ${closeMovementRatios(flow.players.P2, 'pressure')}`);
    appendMetric('Both-active point-blank A / D', `${closeMovementRatios(flow.players.P1, 'point_blank')} | ${closeMovementRatios(flow.players.P2, 'point_blank')}`);
    const contactMovementRatios = (player: BalanceLabFlowModel['players']['P1']): string => {
      const movement = player.movementIntent;
      return `${Math.round(movement.contestedContactApproachRatio * 100)}% / ${Math.round(movement.contestedContactOrbitRatio * 100)}% / ${Math.round(movement.contestedContactRetreatRatio * 100)}% / ${Math.round(movement.contestedContactIdleRatio * 100)}%`;
    };
    appendMetric('Both-active contact A / O / D / I', `${contactMovementRatios(flow.players.P1)} | ${contactMovementRatios(flow.players.P2)}`);
    const dominantAction = (player: BalanceLabFlowModel['players']['P1']): string => (
      player.dominantTacticalAction
        ? `${player.dominantTacticalAction} ${Math.round(player.dominantTacticalActionShare * 100)}%`
        : '--'
    );
    appendMetric('Dominant action', `${dominantAction(flow.players.P1)} / ${dominantAction(flow.players.P2)}`);
    appendMetric('Action entropy', `${flow.players.P1.tacticalActionEntropy.toFixed(2)} / ${flow.players.P2.tacticalActionEntropy.toFixed(2)}`);
    const repeatStreak = (player: BalanceLabFlowModel['players']['P1']): string => (
      player.longestRepeatedAction
        ? `${player.longestRepeatedAction} x${player.longestRepeatedActionStreak}`
        : '--'
    );
    appendMetric('Repeat streak', `${repeatStreak(flow.players.P1)} / ${repeatStreak(flow.players.P2)}`);
    appendMetric('Dunk starts / min', `${flow.players.P1.dunkStartsPerMinute.toFixed(1)} / ${flow.players.P2.dunkStartsPerMinute.toFixed(1)}`);
    const finishFunnel = (player: BalanceLabFlowModel['players']['P1']): string => (
      `${player.zeroFuelTargetLaunchHits} launch | ${player.finishDunkStarts} dunk | ${player.finishDunkWins} win`
    );
    appendMetric('P1 zero-fuel finish funnel', finishFunnel(flow.players.P1));
    appendMetric('P2 zero-fuel finish funnel', finishFunnel(flow.players.P2));
    const launchToDunk = (value: number | null): string => value === null ? '--' : `${value.toFixed(2)}s`;
    appendMetric('Launch to dunk', `${launchToDunk(flow.players.P1.averageLaunchToDunkSeconds)} / ${launchToDunk(flow.players.P2.averageLaunchToDunkSeconds)}`);
    const firstDunk = (value: number | null): string => value === null ? '--' : `${value.toFixed(1)}s`;
    appendMetric('First dunk attempt', `${firstDunk(flow.players.P1.firstDunkAttemptSeconds)} / ${firstDunk(flow.players.P2.firstDunkAttemptSeconds)}`);
    const measurements = document.createElement('details');
    measurements.className = 'balance-flow-measurements';
    const measurementsSummary = document.createElement('summary');
    measurementsSummary.textContent = 'Detailed flow measurements';
    measurements.append(measurementsSummary, metrics);

    const timeline = document.createElement('section');
    timeline.className = 'balance-flow-timeline';
    const timelineHeader = document.createElement('div');
    timelineHeader.className = 'balance-flow-timeline-header';
    const timelineTitle = document.createElement('strong');
    timelineTitle.textContent = 'Round flow timeline';
    const timelineHint = document.createElement('span');
    timelineHint.textContent = 'P1 markers above | P2 below';
    timelineHeader.append(timelineTitle, timelineHint);

    const track = document.createElement('div');
    track.className = 'balance-flow-track';
    track.setAttribute('role', 'img');
    track.setAttribute(
      'aria-label',
      `Spacing and major combat events across ${flow.elapsedSeconds.toFixed(1)} seconds`,
    );
    const elapsedForLayout = Math.max(0.001, flow.elapsedSeconds);
    for (const segment of flow.spacingTimeline) {
      const segmentElement = document.createElement('span');
      segmentElement.className = `balance-flow-segment ${segment.band}`;
      segmentElement.style.left = `${segment.startSeconds / elapsedForLayout * 100}%`;
      segmentElement.style.width = `${segment.durationSeconds / elapsedForLayout * 100}%`;
      segmentElement.title = `${segment.band.replace('_', ' ')} | ${segment.startSeconds.toFixed(1)}-${segment.endSeconds.toFixed(1)}s`;
      track.appendChild(segmentElement);
    }
    for (const moment of flow.moments) {
      const marker = document.createElement('span');
      const actorClass = moment.actorId ? moment.actorId.toLowerCase() : 'shared';
      marker.className = `balance-flow-marker ${actorClass} ${moment.kind}`;
      marker.style.left = `${Math.min(100, Math.max(0, moment.timeSeconds / elapsedForLayout * 100))}%`;
      marker.title = `${moment.timeSeconds.toFixed(2)}s | ${moment.label}`;
      marker.setAttribute('aria-label', marker.title);
      track.appendChild(marker);
    }

    const scale = document.createElement('div');
    scale.className = 'balance-flow-scale';
    scale.innerHTML = `<span>0s</span><span>${(flow.elapsedSeconds / 2).toFixed(1)}s</span><span>${flow.elapsedSeconds.toFixed(1)}s</span>`;
    const legend = document.createElement('div');
    legend.className = 'balance-flow-legend';
    for (const [band, label] of [
      ['long', 'Long'],
      ['mid', 'Mid'],
      ['pressure', 'Pressure'],
      ['point_blank', 'Point blank'],
    ] as const) {
      const item = document.createElement('span');
      item.className = `balance-flow-legend-item ${band}`;
      item.textContent = label;
      legend.appendChild(item);
    }
    timeline.append(timelineHeader, track, scale, legend);

    if (flow.moments.length > 0) {
      const recentMoments = document.createElement('div');
      recentMoments.className = 'balance-flow-moments';
      for (const moment of flow.moments.slice(-10)) {
        const item = document.createElement('span');
        item.className = `balance-flow-moment ${moment.actorId?.toLowerCase() ?? 'shared'}`;
        item.textContent = `${moment.timeSeconds.toFixed(1)} ${moment.label}`;
        recentMoments.appendChild(item);
      }
      timeline.appendChild(recentMoments);
    }
    this.balanceFlowPanel.appendChild(timeline);

    const movementReview = document.createElement('section');
    movementReview.className = 'balance-movement-review';
    const movementHeader = document.createElement('div');
    movementHeader.className = 'balance-movement-header';
    const movementTitle = document.createElement('strong');
    movementTitle.textContent = 'Movement decisions';
    const movementHint = document.createElement('span');
    movementHint.textContent = 'Approach / orbit / disengage / idle while the fighter can act';
    movementHeader.append(movementTitle, movementHint);
    movementReview.appendChild(movementHeader);
    for (const playerId of ['P1', 'P2'] as const) {
      const movement = flow.players[playerId].movementIntent;
      const row = document.createElement('div');
      row.className = `balance-movement-row ${playerId.toLowerCase()}`;
      const label = document.createElement('strong');
      const character = telemetry.characters[playerId].characterId;
      label.textContent = `${playerId} ${CHARACTER_BY_ID[character]?.displayName ?? character}`;
      const bar = document.createElement('div');
      bar.className = 'balance-movement-bar';
      const ratios = [
        ['approach', movement.approachRatio],
        ['orbit', movement.orbitRatio],
        ['disengage', movement.retreatRatio],
        ['idle', movement.idleRatio],
      ] as const;
      bar.setAttribute(
        'aria-label',
        ratios.map(([kind, ratio]) => `${kind} ${Math.round(ratio * 100)}%`).join(', '),
      );
      for (const [kind, ratio] of ratios) {
        const segment = document.createElement('span');
        segment.className = `balance-movement-segment ${kind}`;
        segment.style.width = `${Math.max(0, ratio * 100)}%`;
        segment.title = `${kind}: ${Math.round(ratio * 100)}%`;
        bar.appendChild(segment);
      }
      const copy = document.createElement('span');
      copy.className = 'balance-movement-copy';
      copy.textContent = `Overall A ${Math.round(movement.approachRatio * 100)}% / O ${Math.round(movement.orbitRatio * 100)}% / D ${Math.round(movement.retreatRatio * 100)}% / I ${Math.round(movement.idleRatio * 100)}% | both-active contact A/O/D/I ${Math.round(movement.contestedContactApproachRatio * 100)}%/${Math.round(movement.contestedContactOrbitRatio * 100)}%/${Math.round(movement.contestedContactRetreatRatio * 100)}%/${Math.round(movement.contestedContactIdleRatio * 100)}% (${movement.contestedContactFrames}f) | pressure A/D ${Math.round(movement.contestedPressureApproachRatio * 100)}%/${Math.round(movement.contestedPressureRetreatRatio * 100)}% | point blank A/D ${Math.round(movement.contestedPointBlankApproachRatio * 100)}%/${Math.round(movement.contestedPointBlankRetreatRatio * 100)}%`;
      row.append(label, bar, copy);
      movementReview.appendChild(row);
    }
    this.balanceFlowPanel.appendChild(movementReview);

    const exchangeReview = document.createElement('section');
    exchangeReview.className = 'balance-exchange-review';
    const exchangeHeader = document.createElement('div');
    exchangeHeader.className = 'balance-exchange-header';
    const exchangeTitle = document.createElement('strong');
    exchangeTitle.textContent = 'Exchange review';
    const resolvedExchanges = flow.exchanges.filter((exchange) => exchange.resolved).length;
    const resetExchanges = flow.exchanges.filter((exchange) => exchange.createdReset).length;
    const briefExitExchanges = flow.exchanges.filter((exchange) => exchange.status === 'brief_exit').length;
    const unresolvedExchanges = flow.exchanges.length - resolvedExchanges;
    const neutralActionMix = Object.entries(flow.neutralExitFollowUp.firstAcceptedActions)
      .filter(([, starts]) => starts > 0)
      .map(([action, starts]) => `${action.replace(/_/g, ' ')} ${starts}`)
      .join(', ') || 'none';
    const carriedCauseMix = Object.entries(flow.neutralExitFollowUp.carriedBriefExitCauses)
      .filter(([, count]) => count > 0)
      .map(([cause, count]) => (
        `${BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[cause as keyof typeof BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS]} ${count}`
      ))
      .join(', ') || 'none';
    const exchangeHint = document.createElement('span');
    exchangeHint.textContent = `${flow.exchanges.length} engagements | ${resolvedExchanges} outcomes | ${resetExchanges} resets | ${briefExitExchanges} brief exits | ${flow.neutralExitFollowUp.briefExitsWithoutAcceptedAction} carried (${carriedCauseMix}) | first neutral actions: ${neutralActionMix} | ${unresolvedExchanges} unresolved`;
    exchangeHeader.append(exchangeTitle, exchangeHint);
    exchangeReview.appendChild(exchangeHeader);

    const constrainedControlReturn = selectMostConstrainedBalanceLabControlReturn([
      ...flow.players.P1.controlReturn.reviews,
      ...flow.players.P2.controlReturn.reviews,
    ]);
    if (constrainedControlReturn) {
      const controlFocus = document.createElement('article');
      controlFocus.className = 'balance-pressure-focus control-return';
      const focusCopy = document.createElement('div');
      const focusTitle = document.createElement('strong');
      focusTitle.textContent = `Most constrained control return | ${constrainedControlReturn.playerId} at ${constrainedControlReturn.returnSeconds.toFixed(2)}s`;
      const focusDetail = document.createElement('span');
      const recovery = constrainedControlReturn.returnKind === 'launch_break'
        ? 'launch-break recovery'
        : 'natural recovery';
      const distance = constrainedControlReturn.returnDistance === null
        ? 'distance unavailable'
        : `${constrainedControlReturn.returnDistance.toFixed(1)} units`;
      const pressureContext = constrainedControlReturn.startedInPressure
        ? 'inside pressure'
        : 'outside pressure';
      const firstAction = constrainedControlReturn.firstAcceptedAction
        ? `first action ${constrainedControlReturn.firstAcceptedAction.replace(/_/g, ' ')} +${constrainedControlReturn.firstActionDelaySeconds?.toFixed(2) ?? '0.00'}s`
        : 'no accepted action before the next launch/sample boundary';
      const relaunch = constrainedControlReturn.controlWindowSeconds === null
        ? 'no later launch in this sample'
        : `re-launched after ${constrainedControlReturn.controlWindowSeconds.toFixed(2)}s`;
      const reset = constrainedControlReturn.sustainedResetAfterReturn
        ? 'durable reset created'
        : 'no durable reset';
      focusDetail.textContent = `${recovery} at ${distance} (${pressureContext}) | ${firstAction} | ${relaunch} | ${reset}`;
      focusCopy.append(focusTitle, focusDetail);
      controlFocus.appendChild(focusCopy);
      const reviewRange = resolveBalanceLabControlReturnReviewRange(
        telemetry,
        constrainedControlReturn,
      );
      if ((this.options.canReviewAiRound?.() ?? false) && reviewRange) {
        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'balance-exchange-review-button control-return';
        reviewButton.textContent = 'Review Control Return';
        reviewButton.title = 'Open the checksum-verified replay before control returns and through the next action, re-launch, or reset window.';
        reviewButton.addEventListener('click', () => {
          this.requestAiRoundReview({
            focusFrame: reviewRange.focusFrame,
            endFrame: reviewRange.endFrame,
            label: `${constrainedControlReturn.playerId} control return | ${constrainedControlReturn.returnSeconds.toFixed(2)}s | ${relaunch}`,
          });
        });
        controlFocus.appendChild(reviewButton);
      }
      exchangeReview.appendChild(controlFocus);
    }

    const longestPressureExchange = selectLongestBalanceLabPressureExchange(flow.exchanges);
    if (longestPressureExchange) {
      const focus = document.createElement('article');
      focus.className = `balance-pressure-focus ${longestPressureExchange.status}`;
      const focusCopy = document.createElement('div');
      const focusTitle = document.createElement('strong');
      focusTitle.textContent = `Longest sustained pressure | exchange #${longestPressureExchange.exchangeNumber}`;
      const focusDetail = document.createElement('span');
      const exitDescription = longestPressureExchange.status === 'ongoing'
        ? 'still unresolved'
        : longestPressureExchange.status === 'finished'
          ? 'ended with the round'
          : longestPressureExchange.status === 'reset'
            ? `created ${longestPressureExchange.neutralWindowSeconds.toFixed(1)}s of neutral`
            : `briefly exited for ${longestPressureExchange.neutralWindowSeconds.toFixed(1)}s`;
      focusDetail.textContent = `${longestPressureExchange.startSeconds.toFixed(1)}-${longestPressureExchange.endSeconds.toFixed(1)}s | ${longestPressureExchange.pressureSeconds.toFixed(1)}s under pressure | ${exitDescription}`;
      focusCopy.append(focusTitle, focusDetail);
      focus.appendChild(focusCopy);
      if (this.options.canReviewAiRound?.() ?? false) {
        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'balance-exchange-review-button';
        reviewButton.textContent = 'Review Longest Loop';
        reviewButton.title = 'Open the checksum-verified replay around the round\'s longest sustained pressure sequence.';
        reviewButton.addEventListener('click', () => {
          const focusFrame = resolveBalanceLabExchangeReviewFrame(
            telemetry,
            longestPressureExchange.startSeconds,
          );
          const endFrame = resolveBalanceLabExchangeReviewFrame(
            telemetry,
            longestPressureExchange.endSeconds,
            0,
          );
          this.requestAiRoundReview({
            focusFrame,
            endFrame: Math.max(focusFrame, endFrame),
            label: `Longest pressure loop | exchange #${longestPressureExchange.exchangeNumber} | ${longestPressureExchange.startSeconds.toFixed(1)}-${longestPressureExchange.endSeconds.toFixed(1)}s`,
          });
        });
        focus.appendChild(reviewButton);
      }
      exchangeReview.appendChild(focus);
    }

    if (flow.exchanges.length === 0) {
      const emptyExchanges = document.createElement('p');
      emptyExchanges.className = 'balance-exchange-empty';
      emptyExchanges.textContent = 'No pressure engagement has occurred yet.';
      exchangeReview.appendChild(emptyExchanges);
    } else {
      const exchangeList = document.createElement('div');
      exchangeList.className = 'balance-exchange-list';
      const visibleExchanges = flow.exchanges.slice(-12);
      if (visibleExchanges.length < flow.exchanges.length) {
        const omitted = document.createElement('div');
        omitted.className = 'balance-exchange-omitted';
        omitted.textContent = `${flow.exchanges.length - visibleExchanges.length} earlier exchanges remain in the telemetry export.`;
        exchangeList.appendChild(omitted);
      }
      for (const exchange of visibleExchanges) {
        const item = document.createElement('article');
        item.className = `balance-exchange ${exchange.status}${exchange.resolved ? '' : ' unresolved'}`;
        const itemHeader = document.createElement('div');
        itemHeader.className = 'balance-exchange-item-header';
        const timing = document.createElement('strong');
        timing.textContent = `#${exchange.exchangeNumber} | ${exchange.startSeconds.toFixed(1)}-${exchange.endSeconds.toFixed(1)}s`;
        const status = document.createElement('span');
        status.className = 'balance-exchange-status';
        status.textContent = exchange.status === 'finished'
          ? 'round finished'
          : exchange.status === 'ongoing'
            ? 'still in pressure'
            : exchange.status === 'reset'
              ? `neutral reset ${exchange.neutralWindowSeconds.toFixed(1)}s`
              : `brief exit ${exchange.neutralWindowSeconds.toFixed(1)}s`;
        const itemActions = document.createElement('div');
        itemActions.className = 'balance-exchange-actions';
        itemActions.appendChild(status);
        const reentryReviewRange = resolveBalanceLabReentryReviewRange(telemetry, exchange);
        if (this.options.canReviewAiRound?.() ?? false) {
          const reviewButton = document.createElement('button');
          reviewButton.type = 'button';
          reviewButton.className = 'balance-exchange-review-button';
          reviewButton.textContent = 'Review';
          reviewButton.setAttribute('aria-label', `Review exchange ${exchange.exchangeNumber}`);
          reviewButton.title = 'Open the checksum-verified AI replay 0.75 seconds before this exchange.';
          reviewButton.addEventListener('click', () => {
            const focusFrame = resolveBalanceLabExchangeReviewFrame(
              telemetry,
              exchange.startSeconds,
            );
            const endFrame = resolveBalanceLabExchangeReviewFrame(
              telemetry,
              exchange.endSeconds,
              0,
            );
            this.requestAiRoundReview({
              focusFrame,
              endFrame: Math.max(focusFrame, endFrame),
              label: `Exchange #${exchange.exchangeNumber} | ${exchange.startSeconds.toFixed(1)}-${exchange.endSeconds.toFixed(1)}s`,
            });
          });
          itemActions.appendChild(reviewButton);
          if (reentryReviewRange) {
            const reentryButton = document.createElement('button');
            reentryButton.type = 'button';
            reentryButton.className = 'balance-exchange-review-button reentry';
            reentryButton.textContent = 'Review Re-entry';
            reentryButton.setAttribute('aria-label', `Review exchange ${exchange.exchangeNumber} re-entry`);
            reentryButton.title = 'Open the replay immediately before this brief exit collapses back into pressure.';
            reentryButton.addEventListener('click', () => {
              this.requestAiRoundReview({
                focusFrame: reentryReviewRange.focusFrame,
                endFrame: reentryReviewRange.endFrame,
                label: `Exchange #${exchange.exchangeNumber} re-entry | ${reentryReviewRange.reentrySeconds.toFixed(2)}s | ${exchange.carriedReentryCause
                  ? BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[exchange.carriedReentryCause]
                  : 'unattributed carry'}`,
              });
            });
            itemActions.appendChild(reentryButton);
          }
        }
        itemHeader.append(timing, itemActions);

        const opener = exchange.openerActorId && exchange.openerAction
          ? `${exchange.openerActorId} ${exchange.openerAction.replace(/_/g, ' ')}`
          : 'no accepted opener detected';
        const exit = exchange.exitBand?.replace(/_/g, ' ') ?? 'pressure ongoing';
        const neutralDecision = exchange.firstNeutralActionActorId && exchange.firstNeutralAction
          ? `${exchange.firstNeutralActionActorId} ${exchange.firstNeutralAction.replace(/_/g, ' ')} +${exchange.firstNeutralActionDelaySeconds?.toFixed(2) ?? '0.00'}s`
          : exchange.status === 'brief_exit'
            ? `carried re-entry via ${exchange.carriedReentryCause
              ? BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[exchange.carriedReentryCause]
              : 'unattributed carry'}; no newly accepted action`
            : 'no accepted action before sample/re-entry';
        const itemMeta = document.createElement('div');
        itemMeta.className = 'balance-exchange-meta';
        itemMeta.textContent = `${exchange.pressureSeconds.toFixed(1)}s pressure | opener: ${opener} | exit: ${exit} | first neutral: ${neutralDecision}`;

        const reentryContext = document.createElement('div');
        reentryContext.className = 'balance-exchange-reentry-context';
        reentryContext.textContent = `Re-entry context: ${describeBalanceLabReentryContext(exchange)}`;

        const outcomeLine = document.createElement('div');
        outcomeLine.className = 'balance-exchange-outcomes';
        if (exchange.outcomes.length === 0) {
          outcomeLine.textContent = 'No clash, hit, defense, special resolution, or finish recorded.';
        } else {
          const visibleOutcomes = exchange.outcomes.slice(0, 6);
          outcomeLine.textContent = visibleOutcomes
            .map((outcome) => `${outcome.timeSeconds.toFixed(1)}s ${outcome.label}`)
            .join(' -> ');
          if (visibleOutcomes.length < exchange.outcomes.length) {
            outcomeLine.textContent += ` -> +${exchange.outcomes.length - visibleOutcomes.length} more`;
          }
        }
        item.append(itemHeader, itemMeta);
        if (exchange.status === 'brief_exit') {
          item.appendChild(reentryContext);
        }
        item.appendChild(outcomeLine);
        exchangeList.appendChild(item);
      }
      exchangeReview.appendChild(exchangeList);
    }
    this.balanceFlowPanel.appendChild(exchangeReview);

    if (this.balanceBaseline) {
      const baseline = this.balanceBaseline.flow;
      const model = compareBalanceLabFlows(baseline, flow);
      const section = document.createElement('section');
      section.className = 'balance-lab-comparison';
      const header = document.createElement('div');
      header.className = 'balance-comparison-header';
      const title = document.createElement('strong');
      title.textContent = 'Candidate minus baseline';
      const identity = document.createElement('span');
      identity.textContent = `rules ${this.balanceBaseline.fingerprint} | scenario ${this.balanceBaseline.scenario?.fingerprint ?? 'unavailable'}`;
      header.append(title, identity);

      const currentScenario = this.options.getBalanceScenarioIdentity?.() ?? null;
      const sameScenario = this.balanceBaseline.scenario !== null
        && currentScenario !== null
        && this.balanceBaseline.scenario.fingerprint === currentScenario.fingerprint;
      const independentSamples = this.balanceBaseline.scenario !== null
        && currentScenario !== null
        && this.balanceBaseline.scenario.sampleId !== currentScenario.sampleId;
      const sameLoadout = (['P1', 'P2'] as const).every((playerId) => {
        const captured = this.balanceBaseline?.characters[playerId];
        const current = telemetry.characters[playerId];
        return captured?.characterId === current.characterId
          && captured.packageVersion === current.packageVersion;
      });
      const sampleStatus = document.createElement('div');
      sampleStatus.className = 'balance-comparison-status';
      if (!sameScenario) {
        sampleStatus.classList.add('invalid');
        sampleStatus.textContent = `Invalid comparison: scenario changed. Baseline ${this.balanceBaseline.scenario?.label ?? 'unknown'}; current ${currentScenario?.label ?? 'unknown'}.`;
      } else if (!sameLoadout) {
        sampleStatus.classList.add('invalid');
        sampleStatus.textContent = 'Invalid comparison: character loadout or package version changed after baseline capture.';
      } else if (!independentSamples) {
        sampleStatus.classList.add('warning');
        sampleStatus.textContent = 'Provisional comparison: baseline and candidate are the same active run. Apply + Restart before treating the deltas as repeatability evidence.';
      } else if (!model.sampleDurationComparable) {
        sampleStatus.classList.add('warning');
        sampleStatus.textContent = `Provisional comparison: baseline ran ${baseline.elapsedSeconds.toFixed(1)}s and candidate ran ${flow.elapsedSeconds.toFixed(1)}s. Run both within 25% duration before accepting a change.`;
      } else {
        sampleStatus.classList.add('comparable');
        sampleStatus.textContent = `Comparable samples: ${baseline.elapsedSeconds.toFixed(1)}s baseline / ${flow.elapsedSeconds.toFixed(1)}s candidate. Read direction in context; this is evidence, not an automatic balance score.`;
      }

      const activeTuning = sanitiseTuning(
        this.options.getActiveBalanceTuning?.() ?? this.options.getTuning(),
      );
      const activeCharacterOverrides = cloneCharacterBalanceOverrides(
        this.options.getActiveCharacterBalanceOverrides?.()
          ?? this.options.getCharacterBalanceOverrides?.(),
      );
      const activeAiBehavior = sanitiseAiBehaviorTuning(
        this.options.getActiveAiBehaviorTuning?.()
          ?? this.options.getAiBehaviorTuning?.()
          ?? createDefaultAiBehaviorTuning(),
      );
      const comparedCharacterIds = [
        this.balanceBaseline.characters.P1.characterId,
        this.balanceBaseline.characters.P2.characterId,
        telemetry.characters.P1.characterId,
        telemetry.characters.P2.characterId,
      ];
      const ruleChangeSet = buildBalanceLabRuleChanges(
        this.balanceBaseline.tuning,
        activeTuning,
        this.balanceBaseline.characterBalanceOverrides,
        activeCharacterOverrides,
        comparedCharacterIds,
        this.balanceBaseline.aiBehaviorTuning,
        activeAiBehavior,
      );
      const ruleChanges = document.createElement('details');
      ruleChanges.className = 'balance-comparison-changes';
      ruleChanges.open = ruleChangeSet.length > 0 && ruleChangeSet.length <= 8;
      const ruleChangesSummary = document.createElement('summary');
      ruleChangesSummary.textContent = ruleChangeSet.length === 0
        ? '0 active rule changes: repeatability control'
        : `${ruleChangeSet.length} active rule ${ruleChangeSet.length === 1 ? 'change' : 'changes'} behind this sample`;
      ruleChanges.appendChild(ruleChangesSummary);
      if (ruleChangeSet.length === 0) {
        const unchanged = document.createElement('p');
        unchanged.textContent = 'The baseline and candidate used the same effective global, AI, and character rules.';
        ruleChanges.appendChild(unchanged);
      } else {
        const ruleChangeList = document.createElement('div');
        ruleChangeList.className = 'balance-comparison-change-list';
        for (const change of ruleChangeSet) {
          const item = document.createElement('div');
          item.className = `balance-comparison-change ${change.scope}`;
          const label = document.createElement('strong');
          label.textContent = formatBalanceRuleChangeLabel(change);
          const values = document.createElement('span');
          const signedDelta = `${change.delta >= 0 ? '+' : ''}${formatRuleValue(change.delta)}`;
          values.textContent = `${formatRuleValue(change.baselineValue)} to ${formatRuleValue(change.candidateValue)} (${signedDelta})`;
          item.append(label, values);
          ruleChangeList.appendChild(item);
        }
        ruleChanges.appendChild(ruleChangeList);
      }
      if (this.getBalanceLabPendingState().any) {
        const pending = document.createElement('p');
        pending.className = 'balance-comparison-pending';
        pending.textContent = 'Pending editor or probe changes are excluded from this list until a clean restart applies them.';
        ruleChanges.appendChild(pending);
      }

      const stageComparison = document.createElement('section');
      stageComparison.className = 'balance-stage-comparison';
      const stageComparisonHeader = document.createElement('div');
      stageComparisonHeader.className = 'balance-stage-comparison-header';
      const stageComparisonTitle = document.createElement('strong');
      stageComparisonTitle.textContent = 'Gameplay loop before -> after';
      const stageComparisonHint = document.createElement('span');
      stageComparisonHint.textContent = 'Categorical evidence; Waiting is not failure';
      stageComparisonHeader.append(stageComparisonTitle, stageComparisonHint);
      const stageComparisonGrid = document.createElement('div');
      stageComparisonGrid.className = 'balance-stage-comparison-grid';
      for (const stage of compareBalanceLabLoopStages(baseline, flow)) {
        const item = document.createElement('article');
        item.className = `balance-stage-transition ${stage.candidate.status}${stage.statusChanged ? ' changed' : ''}`;
        const itemHeader = document.createElement('div');
        itemHeader.className = 'balance-stage-transition-header';
        const label = document.createElement('strong');
        label.textContent = stage.label;
        const statuses = document.createElement('div');
        statuses.className = 'balance-stage-transition-statuses';
        const baselineStatus = document.createElement('span');
        baselineStatus.className = `balance-stage-status ${stage.baseline.status}`;
        baselineStatus.textContent = stage.baseline.status;
        const arrow = document.createElement('b');
        arrow.textContent = '->';
        const candidateStatus = document.createElement('span');
        candidateStatus.className = `balance-stage-status ${stage.candidate.status}`;
        candidateStatus.textContent = stage.candidate.status;
        statuses.append(baselineStatus, arrow, candidateStatus);
        itemHeader.append(label, statuses);

        const candidateDetail = document.createElement('p');
        candidateDetail.textContent = stage.candidate.detail;
        item.append(itemHeader, candidateDetail);
        if (stage.statusChanged) {
          const baselineDetail = document.createElement('small');
          baselineDetail.textContent = `Baseline: ${stage.baseline.detail}`;
          item.appendChild(baselineDetail);
        }
        if (stage.candidate.status === 'watch' || stage.candidate.status === 'blocked') {
          const tuningHints = this.createDiagnosticTuningHints(stage.candidate, 2);
          if (tuningHints) {
            item.appendChild(tuningHints);
          }
        }
        stageComparisonGrid.appendChild(item);
      }
      stageComparison.append(stageComparisonHeader, stageComparisonGrid);

      const metrics = document.createElement('div');
      metrics.className = 'balance-comparison-metrics';
      const appendDelta = (label: string, value: string): void => {
        const item = document.createElement('div');
        item.className = 'balance-comparison-metric';
        const metricLabel = document.createElement('span');
        metricLabel.textContent = label;
        const metricValue = document.createElement('strong');
        metricValue.textContent = value;
        item.append(metricLabel, metricValue);
        metrics.appendChild(item);
      };
      const signed = (value: number, suffix = ''): string => (
        `${value >= 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
      );
      const signedPair = (first: number, second: number, suffix = ''): string => (
        `P1 ${signed(first, suffix)} / P2 ${signed(second, suffix)}`
      );
      const signedOptionalPair = (
        first: number | null,
        second: number | null,
        suffix = '',
      ): string => (
        `P1 ${first === null ? '--' : signed(first, suffix)} / P2 ${second === null ? '--' : signed(second, suffix)}`
      );
      const deltas = model.deltas;
      appendDelta('Physical contact', signed(deltas.contactRatioPoints, 'pp'));
      appendDelta('Shared movement control', signed(deltas.sharedControlRatioPoints, 'pp'));
      appendDelta(
        'Contact while both steer',
        signed(deltas.sharedControlContactRatioPoints, 'pp'),
      );
      appendDelta(
        'Pressure while both steer',
        signed(deltas.sharedControlPressureRatioPoints, 'pp'),
      );
      appendDelta('Shared action-ready time', signed(deltas.sharedActionReadyRatioPoints, 'pp'));
      appendDelta(
        'Action-ready share of control',
        signed(deltas.sharedActionReadyShareOfControlPoints, 'pp'),
      );
      appendDelta('Contact while both can act', signed(deltas.sharedContactRatioPoints, 'pp'));
      appendDelta('Pressure while both can act', signed(deltas.sharedPressureRatioPoints, 'pp'));
      appendDelta('Neutral while both can act', signed(deltas.sharedNeutralRatioPoints, 'pp'));
      appendDelta('Shared decision windows', signed(deltas.sharedSustainedNeutralWindows));
      appendDelta('Shared neutral p90', signed(deltas.sharedP90NeutralEpisodeSeconds, 's'));
      appendDelta('Longest ready contact', signed(deltas.sharedMaximumContactEpisodeSeconds, 's'));
      appendDelta('Contact p90', signed(deltas.p90ContactEpisodeSeconds, 's'));
      appendDelta('Longest contact', signed(deltas.maximumContactEpisodeSeconds, 's'));
      appendDelta('Point blank', signed(deltas.pointBlankRatioPoints, 'pp'));
      appendDelta('Pressure band', signed(deltas.pressureBandRatioPoints, 'pp'));
      appendDelta('Launch clashes / min', signed(deltas.launchClashesPerMinute));
      appendDelta('Clash recurrence <=1s', signed(deltas.repeatClashRatioPoints, 'pp'));
      appendDelta('Rapid launch after clash', signedPair(
        deltas.p1ClashRapidLaunchRecommitRatioPoints,
        deltas.p2ClashRapidLaunchRecommitRatioPoints,
        'pp',
      ));
      appendDelta('First action after clash', signedOptionalPair(
        deltas.p1ClashFirstActionDelaySeconds,
        deltas.p2ClashFirstActionDelaySeconds,
        's',
      ));
      appendDelta('Neutral resets / min', signed(deltas.neutralResetsPerMinute));
      appendDelta('Reset conversion', signed(deltas.resetConversionRatioPoints, 'pp'));
      appendDelta('Resolved exchanges', signed(deltas.exchangeResolvedRatioPoints, 'pp'));
      appendDelta('Exchange resets', signed(deltas.exchangeResetRatioPoints, 'pp'));
      appendDelta('Brief exits', signed(deltas.briefExitRatioPoints, 'pp'));
      appendDelta('Carried brief re-entry', signed(deltas.carriedBriefExitRatioPoints, 'pp'));
      appendDelta(
        'First neutral action delay',
        deltas.neutralFirstActionDelaySeconds === null
          ? '--'
          : signed(deltas.neutralFirstActionDelaySeconds, 's'),
      );
      appendDelta('Pressure p90', signed(deltas.p90PressureSequenceSeconds, 's'));
      appendDelta('Longest unresolved', signed(deltas.longestUnresolvedPressureSeconds, 's'));
      appendDelta('Break uses / min', signedPair(
        deltas.p1BreakEscapesPerMinute,
        deltas.p2BreakEscapesPerMinute,
      ));
      appendDelta('Accepted combat starts / min', signedPair(
        deltas.p1AcceptedActionsPerMinute,
        deltas.p2AcceptedActionsPerMinute,
      ));
      appendDelta('Break reaction', signedPair(
        deltas.p1BreakReactionSeconds,
        deltas.p2BreakReactionSeconds,
        's',
      ));
      appendDelta('Helpless time', signedPair(
        deltas.p1HelplessRatioPoints,
        deltas.p2HelplessRatioPoints,
        'pp',
      ));
      appendDelta('Launches received / min', signedPair(
        deltas.p1LaunchHitsReceivedPerMinute,
        deltas.p2LaunchHitsReceivedPerMinute,
      ));
      appendDelta('Helpless / received hit', signedOptionalPair(
        deltas.p1HelplessSecondsPerLaunchReceived,
        deltas.p2HelplessSecondsPerLaunchReceived,
        's',
      ));
      appendDelta('Re-launched <=1s after return', signedPair(
        deltas.p1ImmediateRelaunchRatioPoints,
        deltas.p2ImmediateRelaunchRatioPoints,
        'pp',
      ));
      appendDelta('Control window before re-launch', signedOptionalPair(
        deltas.p1AverageControlWindowSeconds,
        deltas.p2AverageControlWindowSeconds,
        's',
      ));
      appendDelta('Control-return sustained reset', signedPair(
        deltas.p1ControlReturnResetRatioPoints,
        deltas.p2ControlReturnResetRatioPoints,
        'pp',
      ));
      appendDelta('First-action sustained reset', signedPair(
        deltas.p1PostReturnResetRatioPoints,
        deltas.p2PostReturnResetRatioPoints,
        'pp',
      ));
      appendDelta('First action after return', signedOptionalPair(
        deltas.p1FirstActionDelaySeconds,
        deltas.p2FirstActionDelaySeconds,
        's',
      ));
      appendDelta('Zero-fuel time', signedPair(
        deltas.p1ZeroFuelRatioPoints,
        deltas.p2ZeroFuelRatioPoints,
        'pp',
      ));
      appendDelta('Point-blank approach', signedPair(
        deltas.p1PointBlankApproachRatioPoints,
        deltas.p2PointBlankApproachRatioPoints,
        'pp',
      ));
      appendDelta('Pressure disengage', signedPair(
        deltas.p1PressureRetreatRatioPoints,
        deltas.p2PressureRetreatRatioPoints,
        'pp',
      ));
      appendDelta('Dominant action share', signed(deltas.dominantTacticalActionSharePoints, 'pp'));
      appendDelta('Longest repeat streak', signed(deltas.repeatedTacticalActionStreak));
      appendDelta('Launch to dunk', deltas.launchToDunkSeconds === null
        ? '-- pipeline missing in one sample'
        : signed(deltas.launchToDunkSeconds, 's'));

      section.append(header, sampleStatus, ruleChanges, stageComparison, metrics);
      this.balanceFlowPanel.appendChild(section);
    }

    const diagnostics = document.createElement('div');
    diagnostics.className = 'balance-lab-diagnostics';
    for (const diagnostic of flow.diagnostics) {
      const item = document.createElement('div');
      item.className = `balance-lab-diagnostic ${diagnostic.severity}`;
      const diagnosticTitle = document.createElement('strong');
      diagnosticTitle.textContent = diagnostic.title;
      const diagnosticCopy = document.createElement('div');
      diagnosticCopy.className = 'balance-lab-diagnostic-copy';
      const detail = document.createElement('span');
      detail.textContent = diagnostic.detail;
      diagnosticCopy.appendChild(detail);
      const tuningHints = this.createDiagnosticTuningHints(diagnostic);
      if (tuningHints) {
        diagnosticCopy.appendChild(tuningHints);
      }
      item.append(diagnosticTitle, diagnosticCopy);
      diagnostics.appendChild(item);
    }
    this.balanceFlowPanel.appendChild(diagnostics);
    this.balanceFlowPanel.appendChild(measurements);
  }

  private createDiagnosticTuningHints(
    source: Pick<
      BalanceLabDiagnostic,
      | 'relatedGlobalTuning'
      | 'relatedAiBehavior'
      | 'relatedCharacterControls'
      | 'relatedCharacterTargets'
      | 'relatedPlayerIds'
    >,
    maxButtons = Number.POSITIVE_INFINITY,
  ): HTMLDivElement | null {
    const aiBehaviorKeys = this.options.canTuneAiBehavior?.()
      ? source.relatedAiBehavior ?? []
      : [];
    const globalKeys = source.relatedGlobalTuning ?? [];
    const characterControls = source.relatedCharacterControls ?? [];
    const characterTargets = source.relatedCharacterTargets ?? [];
    if (
      aiBehaviorKeys.length === 0
      && globalKeys.length === 0
      && characterControls.length === 0
      && characterTargets.length === 0
    ) {
      return null;
    }
    const hints = document.createElement('div');
    hints.className = 'balance-lab-tuning-hints';
    const label = document.createElement('span');
    label.className = 'balance-lab-tuning-hints-label';
    label.textContent = 'Inspect levers:';
    hints.appendChild(label);

    let buttonCount = 0;
    for (const key of aiBehaviorKeys) {
      if (buttonCount >= maxButtons) {
        break;
      }
      const field = AI_BEHAVIOR_FIELD_BY_KEY.get(key);
      if (!field) {
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'balance-lab-tuning-hint ai';
      button.textContent = `AI | ${field.label}`;
      button.addEventListener('click', () => this.focusAiBehaviorField(key));
      hints.appendChild(button);
      buttonCount += 1;
    }
    for (const key of globalKeys) {
      if (buttonCount >= maxButtons) {
        break;
      }
      const field = TUNING_FIELD_BY_KEY.get(key);
      if (!field) {
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'balance-lab-tuning-hint';
      button.textContent = field.label;
      button.addEventListener('click', () => this.focusGlobalTuningField(key));
      hints.appendChild(button);
      buttonCount += 1;
    }
    const loadout = this.options.getBalanceLoadout?.();
    const renderedCharacterTargets = new Set<string>();
    const appendCharacterButton = (
      focus: BalanceLabCharacterControlFocus,
      playerId: PlayerId | null,
    ): boolean => {
      if (buttonCount >= maxButtons) {
        return false;
      }
      const targetKey = `${playerId ?? 'selected'}:${focus}`;
      if (renderedCharacterTargets.has(targetKey)) {
        return true;
      }
      renderedCharacterTargets.add(targetKey);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'balance-lab-tuning-hint character';
      const characterId = playerId ? loadout?.[playerId] : null;
      const targetLabel = playerId
        ? `${playerId} ${characterId ? CHARACTER_BY_ID[characterId]?.displayName ?? characterId : 'fighter'}`
        : 'selected fighter';
      button.textContent = `${CHARACTER_CONTROL_FOCUS_LABELS[focus]} (${targetLabel})`;
      button.addEventListener('click', () => this.focusCharacterControl(focus, playerId ?? undefined));
      hints.appendChild(button);
      buttonCount += 1;
      return true;
    };
    for (const target of characterTargets) {
      if (!appendCharacterButton(target.control, target.playerId)) {
        break;
      }
    }
    const targetPlayerIds: readonly (PlayerId | null)[] = source.relatedPlayerIds?.length
      ? source.relatedPlayerIds
      : [null];
    for (const focus of characterControls) {
      for (const playerId of targetPlayerIds) {
        if (!appendCharacterButton(focus, playerId)) {
          break;
        }
      }
      if (buttonCount >= maxButtons) {
        break;
      }
    }
    return hints;
  }

  private focusGlobalTuningField(key: keyof GameTuning): void {
    const input = this.fieldInputs.get(key);
    if (input) {
      this.focusTuningInput(input);
    }
  }

  private focusAiBehaviorField(key: AiBehaviorTuningKey): void {
    const input = this.aiBehaviorFieldInputs.get(key);
    if (input) {
      this.focusTuningInput(input);
    }
  }

  private focusCharacterControl(focus: BalanceLabCharacterControlFocus, playerId?: PlayerId): void {
    const targetCharacterId = playerId ? this.options.getBalanceLoadout?.()[playerId] : null;
    if (targetCharacterId && targetCharacterId !== this.selectedCharacterBalanceId) {
      this.selectedCharacterBalanceId = targetCharacterId;
      this.syncCharacterBalanceEditor();
    }
    for (const fieldId of CHARACTER_CONTROL_FOCUS_FIELDS[focus]) {
      const entry = this.characterFieldInputs.get(fieldId);
      if (entry && !entry.row.hidden) {
        this.focusTuningInput(entry.input);
        return;
      }
    }
    if (this.copyStatus) {
      this.copyStatus.textContent = `${CHARACTER_CONTROL_FOCUS_LABELS[focus]} controls do not apply to the selected fighter package.`;
    }
  }

  private focusTuningInput(input: HTMLInputElement): void {
    const group = input.closest('details');
    if (group instanceof HTMLDetailsElement) {
      group.open = true;
    }
    const row = input.closest('.tuning-row');
    if (row instanceof HTMLElement) {
      row.classList.remove('balance-focus');
      void row.offsetWidth;
      row.classList.add('balance-focus');
      window.setTimeout(() => row.classList.remove('balance-focus'), 1_600);
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    input.focus({ preventScroll: true });
  }

  private readBalancePlaytestReview(
    variant: 'baseline' | 'candidate',
  ): BalanceLabPlaytestSampleReview {
    const stages = Object.fromEntries(BALANCE_LAB_LOOP_STAGE_IDS.map((stageId) => {
      const value = this.balancePlaytestVerdictSelects[variant][stageId]?.value;
      const verdict = BALANCE_LAB_PLAYTEST_VERDICT_IDS.includes(
        value as BalanceLabPlaytestVerdict,
      )
        ? value as BalanceLabPlaytestVerdict
        : 'unrated';
      return [stageId, verdict];
    })) as Record<BalanceLabLoopStageId, BalanceLabPlaytestVerdict>;
    return {
      notes: variant === 'baseline'
        ? this.balanceBaselineNotesInput?.value ?? ''
        : this.balanceCandidateNotesInput?.value ?? '',
      stages,
    };
  }

  private captureBalanceBaseline(): void {
    if (this.getBalanceLabPendingState().any) {
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Apply + Restart Match before capturing a baseline; staged rules or probe setup cannot label an active run.';
      }
      return;
    }
    const telemetry = this.options.getBalanceTelemetry?.();
    if (!telemetry || telemetry.framesSimulated <= 0) {
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Run a local round before capturing a baseline.';
      }
      return;
    }
    const activeTuning = sanitiseTuning(
      this.options.getActiveBalanceTuning?.() ?? this.options.getTuning(),
    );
    const activeCharacterBalanceOverrides = cloneCharacterBalanceOverrides(
      this.options.getActiveCharacterBalanceOverrides?.()
        ?? this.options.getCharacterBalanceOverrides?.(),
    );
    const activeAiBehavior = sanitiseAiBehaviorTuning(
      this.options.getActiveAiBehaviorTuning?.()
        ?? this.options.getAiBehaviorTuning?.()
        ?? createDefaultAiBehaviorTuning(),
    );
    const fingerprint = [
      fingerprintBalanceTuning(activeTuning),
      fingerprintCharacterBalanceOverrides(activeCharacterBalanceOverrides),
      fingerprintAiBehaviorTuning(activeAiBehavior),
    ].join('/');
    const sampleSequence = this.options.getBalanceSampleSequence?.() ?? 0;
    const incidentRequest = this.lastAiRoundReviewSequence === sampleSequence
      ? this.lastAiRoundReviewRequest
      : null;
    const replay = this.options.getAiRoundReplay?.() ?? null;
    let replayComparison: BalanceReplayComparison | null = null;
    let replayCaptureError: string | null = null;
    if (replay) {
      try {
        replayComparison = createBalanceReplayComparison(
          replay,
          incidentRequest
            ? {
                schemaVersion: 'gw.replay-focus.v1',
                source: 'balance_lab_incident',
                label: incidentRequest.label,
                focusFrame: incidentRequest.focusFrame,
                endFrame: incidentRequest.endFrame,
              }
            : undefined,
        );
      } catch (error) {
        replayCaptureError = error instanceof Error
          ? error.message
          : 'The current AI replay could not be captured.';
      }
    }
    this.balanceBaseline = {
      fingerprint,
      flow: buildBalanceLabFlowModel(telemetry),
      framesSimulated: telemetry.framesSimulated,
      tuning: activeTuning,
      characterBalanceOverrides: activeCharacterBalanceOverrides,
      aiBehaviorTuning: activeAiBehavior,
      characters: {
        P1: { ...telemetry.characters.P1 },
        P2: { ...telemetry.characters.P2 },
      },
      scenario: this.options.getBalanceScenarioIdentity?.() ?? null,
      scenarioId: resolveBalanceScenario(
        this.options.getActiveBalanceScenarioId?.()
          ?? this.options.getBalanceScenarioId?.(),
      ).id,
      aiControllerRoles: sanitiseAiControllerRoles(
        this.options.getActiveAiControllerRoles?.()
          ?? this.options.getAiControllerRoles?.()
          ?? createDefaultAiControllerRoles(),
      ),
      sampleSequence,
      capturedAt: new Date().toISOString(),
      telemetry: structuredClone(telemetry),
      review: this.readBalancePlaytestReview('baseline'),
    };
    this.balanceReplayComparison = replayComparison;
    this.balanceReplayCandidateSequence = null;
    this.balanceReplayCandidateError = replayCaptureError;
    this.syncBalanceLab();
    if (this.copyStatus) {
      const sampleHint = telemetry.elapsedSeconds >= 10
        ? 'Matched-sample rerun is ready.'
        : 'Run at least 10 seconds for automatic matched-sample reruns.';
      const replayHint = replayComparison
        ? ` Incident replay captured${incidentRequest ? ` at "${incidentRequest.label}"` : ''}.`
        : replayCaptureError
          ? ` Metrics captured, but replay pairing failed: ${replayCaptureError}`
          : ' Metrics captured; no local AI replay was available.';
      this.copyStatus.textContent = `Baseline captured (${fingerprint}). ${sampleHint}${replayHint}`;
    }
  }

  private restoreCapturedBalanceBaseline(): void {
    const baseline = this.balanceBaseline;
    if (!baseline) {
      return;
    }
    this.options.setTuning(sanitiseTuning(baseline.tuning));
    this.options.setCharacterBalanceOverrides?.(
      cloneCharacterBalanceOverrides(baseline.characterBalanceOverrides),
    );
    this.options.setAiBehaviorTuning?.(
      sanitiseAiBehaviorTuning(baseline.aiBehaviorTuning),
    );
    this.options.setBalanceScenarioId?.(baseline.scenarioId);
    for (const playerId of ['P1', 'P2'] as const) {
      this.options.setAiControllerRole?.(playerId, baseline.aiControllerRoles[playerId]);
    }
    if (this.balanceDecisionSelect) {
      this.balanceDecisionSelect.value = 'revert';
    }
    this.syncInputsFromTuning();
    this.syncBalanceLab();
    if (this.copyStatus) {
      this.copyStatus.textContent = 'Captured baseline rules and probe setup staged. Apply + Restart to run them from frame zero.';
    }
  }

  private discardStagedBalanceChanges(): void {
    const pendingState = this.getBalanceLabPendingState();
    if (!pendingState.any) {
      return;
    }
    if (pendingState.tuningDirty) {
      this.options.setTuning(sanitiseTuning(
        this.options.getActiveBalanceTuning?.() ?? this.options.getTuning(),
      ));
    }
    if (pendingState.characterDirty) {
      this.options.setCharacterBalanceOverrides?.(
        cloneCharacterBalanceOverrides(
          this.options.getActiveCharacterBalanceOverrides?.()
            ?? this.options.getCharacterBalanceOverrides?.(),
        ),
      );
    }
    if (pendingState.aiBehaviorDirty) {
      this.options.setAiBehaviorTuning?.(
        sanitiseAiBehaviorTuning(
          this.options.getActiveAiBehaviorTuning?.()
            ?? this.options.getAiBehaviorTuning?.()
            ?? createDefaultAiBehaviorTuning(),
        ),
      );
    }
    if (pendingState.scenarioDirty) {
      this.options.setBalanceScenarioId?.(
        this.options.getActiveBalanceScenarioId?.()
          ?? this.options.getBalanceScenarioId?.()
          ?? 'standard',
      );
    }
    if (pendingState.aiControllerRolesDirty) {
      const activeRoles = sanitiseAiControllerRoles(
        this.options.getActiveAiControllerRoles?.() ?? createDefaultAiControllerRoles(),
      );
      for (const playerId of ['P1', 'P2'] as const) {
        this.options.setAiControllerRole?.(playerId, activeRoles[playerId]);
      }
    }
    this.syncInputsFromTuning();
    this.syncBalanceLab();
    if (this.copyStatus) {
      this.copyStatus.textContent = 'Staged changes discarded. The next restart now matches the current active run.';
    }
  }

  private saveBalanceDraft(): void {
    try {
      const profileId = this.options.getBalanceProfileId?.() ?? 'custom_local';
      const draft = createBalanceLabDraft(
        `${profileId} local draft`,
        this.options.getTuning(),
        this.options.getCharacterBalanceOverrides?.() ?? {},
        new Date().toISOString(),
        this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning(),
      );
      window.localStorage.setItem(BALANCE_LAB_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      if (this.copyStatus) {
        this.copyStatus.textContent = `Local draft saved (${draft.tuningFingerprint} / ${draft.characterBalanceFingerprint} / ${draft.aiBehaviorFingerprint}).`;
      }
    } catch (error) {
      if (this.copyStatus) {
        this.copyStatus.textContent = error instanceof Error
          ? `Local draft save failed: ${error.message}`
          : 'Local draft save failed.';
      }
    }
  }

  private loadBalanceDraft(): void {
    try {
      const draft = parseFirstStoredBalanceLabDraft(
        window.localStorage.getItem(BALANCE_LAB_DRAFT_STORAGE_KEY),
        window.localStorage.getItem(PREVIOUS_BALANCE_LAB_DRAFT_STORAGE_KEY),
        window.localStorage.getItem(LEGACY_BALANCE_LAB_DRAFT_STORAGE_KEY),
      );
      if (!draft) {
        throw new Error('No valid saved draft was found.');
      }
      this.stageBalanceDraft(draft);
      if (this.copyStatus) {
        this.copyStatus.textContent = `Loaded ${draft.name} (${draft.tuningFingerprint} / ${draft.characterBalanceFingerprint} / ${draft.aiBehaviorFingerprint}). Restart to compare from frame zero.`;
      }
    } catch (error) {
      if (this.copyStatus) {
        this.copyStatus.textContent = error instanceof Error
          ? `Local draft load failed: ${error.message}`
          : 'Local draft load failed.';
      }
    }
  }

  private async importBalanceDraft(file: File): Promise<void> {
    try {
      if (file.size > 2 * 1024 * 1024) {
        throw new Error('Balance JSON must be smaller than 2 MB.');
      }
      const draft = parseBalanceLabDraft(JSON.parse(await file.text()));
      if (!draft) {
        throw new Error('The selected file is not a valid versioned Balance Lab draft.');
      }
      this.stageBalanceDraft(draft);
      if (this.copyStatus) {
        this.copyStatus.textContent = `Imported ${draft.name} (${draft.tuningFingerprint} / ${draft.characterBalanceFingerprint} / ${draft.aiBehaviorFingerprint}). Restart to compare from frame zero.`;
      }
    } catch (error) {
      if (this.copyStatus) {
        this.copyStatus.textContent = error instanceof Error
          ? `Balance JSON import failed: ${error.message}`
          : 'Balance JSON import failed.';
      }
    }
  }

  private stageBalanceDraft(draft: ReturnType<typeof createBalanceLabDraft>): void {
    this.options.setTuning(sanitiseTuning(draft.tuning));
    this.options.setCharacterBalanceOverrides?.(
      cloneCharacterBalanceOverrides(draft.characterBalanceOverrides),
    );
    this.options.setAiBehaviorTuning?.(
      sanitiseAiBehaviorTuning(draft.aiBehaviorTuning),
    );
    this.syncInputsFromTuning();
    this.syncBalanceLab();
  }

  private updateAudioSetting(key: keyof AudioSettings, value: AudioSettings[keyof AudioSettings]): void {
    const current = this.options.getAudioSettings();
    const next = {
      ...current,
      [key]: value,
    } as AudioSettings;
    this.options.setAudioSettings(next);
    this.syncInputsFromAudioSettings();
  }

  private syncInputsFromAudioSettings(): void {
    const settings = this.options.getAudioSettings();
    for (const field of AUDIO_VOLUME_FIELDS) {
      const input = this.audioVolumeInputs.get(field.key);
      if (!input) {
        continue;
      }
      input.value = String(Math.round(settings[field.key] * 100));
    }
    this.audioToggleInputs.voiceDuckingEnabled.checked = settings.voiceDuckingEnabled;
    this.audioToggleInputs.subtitlesEnabled.checked = settings.subtitlesEnabled;
    this.audioToggleInputs.dynamicRangeMode.value = settings.dynamicRangeMode;
  }

  private async copyTuningToClipboard(): Promise<void> {
    const draft = createBalanceLabDraft(
      'Clipboard export',
      this.options.getTuning(),
      this.options.getCharacterBalanceOverrides?.() ?? {},
      new Date().toISOString(),
      this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning(),
    );
    const payload = JSON.stringify(draft, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Balance Lab draft copied to clipboard.';
      }
      return;
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = payload;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Balance Lab draft copied to clipboard.';
      }
    }
  }

  private downloadBalanceDraft(): void {
    const profileId = this.options.getBalanceProfileId?.() ?? 'custom_local';
    const draft = createBalanceLabDraft(
      `${profileId} batch candidate`,
      this.options.getTuning(),
      this.options.getCharacterBalanceOverrides?.() ?? {},
      new Date().toISOString(),
      this.options.getAiBehaviorTuning?.() ?? createDefaultAiBehaviorTuning(),
    );
    const payload = `${JSON.stringify(draft, null, 2)}\n`;
    const timestamp = draft.savedAt.replace(/[:.]/g, '-');
    const fileName = `gravity-well-balance-${timestamp}.json`;
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    if (this.copyStatus) {
      this.copyStatus.textContent = `Balance Lab draft downloaded as ${fileName}.`;
    }
  }

  private downloadBalanceExperiment(): void {
    const baseline = this.balanceBaseline;
    const telemetry = this.options.getBalanceTelemetry?.();
    if (!baseline || !telemetry || telemetry.framesSimulated <= 0) {
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Capture a baseline and run a candidate before exporting an experiment.';
      }
      return;
    }
    const exportedAt = new Date().toISOString();
    const activeTuning = sanitiseTuning(
      this.options.getActiveBalanceTuning?.() ?? this.options.getTuning(),
    );
    const activeCharacterOverrides = cloneCharacterBalanceOverrides(
      this.options.getActiveCharacterBalanceOverrides?.()
        ?? this.options.getCharacterBalanceOverrides?.(),
    );
    const activeAiBehavior = sanitiseAiBehaviorTuning(
      this.options.getActiveAiBehaviorTuning?.()
        ?? this.options.getAiBehaviorTuning?.()
        ?? createDefaultAiBehaviorTuning(),
    );
    const selectedDecision = this.balanceDecisionSelect?.value;
    const bundle = createBalanceLabExperimentBundle({
      exportedAt,
      pendingDraftExcluded: this.getBalanceLabPendingState().any,
      review: {
        hypothesis: this.balanceHypothesisInput?.value ?? '',
        baseline: baseline.review,
        candidate: this.readBalancePlaytestReview('candidate'),
        observations: this.balanceObservationsInput?.value ?? '',
        decision: selectedDecision === 'keep'
          || selectedDecision === 'revert'
          || selectedDecision === 'iterate'
          ? selectedDecision
          : 'undecided',
      },
      baseline: {
        capturedAt: baseline.capturedAt,
        scenario: baseline.scenario,
        tuning: baseline.tuning,
        characterBalanceOverrides: baseline.characterBalanceOverrides,
        aiBehaviorTuning: baseline.aiBehaviorTuning,
        telemetry: baseline.telemetry,
      },
      candidate: {
        capturedAt: exportedAt,
        scenario: this.options.getBalanceScenarioIdentity?.() ?? null,
        tuning: activeTuning,
        characterBalanceOverrides: activeCharacterOverrides,
        aiBehaviorTuning: activeAiBehavior,
        telemetry,
      },
    });
    const timestamp = exportedAt.replace(/[:.]/g, '-');
    const fileName = `gravity-well-balance-experiment-${timestamp}.json`;
    const payload = `${JSON.stringify(bundle, null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    if (this.copyStatus) {
      const issueSummary = bundle.issues.length > 0
        ? ` Issues: ${bundle.issues.join(', ')}.`
        : '';
      this.copyStatus.textContent = `Balance experiment exported as ${fileName} (${bundle.status}).${issueSummary}`;
    }
  }

  private refreshExportControls(): void {
    if (this.exportTrainingTelemetryButton) {
      const canExportTraining = this.options.canExportTrainingTelemetry
        ? this.options.canExportTrainingTelemetry()
        : this.canRestartTraining;
      this.exportTrainingTelemetryButton.hidden = !canExportTraining;
      this.exportTrainingTelemetryButton.disabled = !canExportTraining || this.exportingTrainingTelemetry;
    }
    if (this.exportAiMatchTelemetryButton) {
      const canExportAiMatch = this.options.canExportAiMatchTelemetry
        ? this.options.canExportAiMatchTelemetry()
        : false;
      this.exportAiMatchTelemetryButton.hidden = !canExportAiMatch;
      this.exportAiMatchTelemetryButton.disabled = !canExportAiMatch || this.exportingAiMatchTelemetry;
    }
  }

  private async exportTrainingTelemetry(): Promise<void> {
    if (!this.options.onExportTrainingTelemetry) {
      return;
    }
    this.exportingTrainingTelemetry = true;
    this.refreshExportControls();
    if (this.copyStatus) {
      this.copyStatus.textContent = 'Exporting training telemetry...';
    }
    try {
      const result = await this.options.onExportTrainingTelemetry();
      if (this.copyStatus) {
        this.copyStatus.textContent = result || 'Training telemetry exported.';
      }
    } catch (error) {
      if (this.copyStatus) {
        this.copyStatus.textContent = error instanceof Error
          ? `Training telemetry export failed: ${error.message}`
          : 'Training telemetry export failed.';
      }
    } finally {
      this.exportingTrainingTelemetry = false;
      this.refreshExportControls();
    }
  }

  private async exportAiMatchTelemetry(): Promise<void> {
    if (!this.options.onExportAiMatchTelemetry) {
      return;
    }
    this.exportingAiMatchTelemetry = true;
    this.refreshExportControls();
    if (this.copyStatus) {
      this.copyStatus.textContent = 'Exporting AI match telemetry...';
    }
    try {
      const result = await this.options.onExportAiMatchTelemetry();
      if (this.copyStatus) {
        this.copyStatus.textContent = result || 'AI match telemetry exported.';
      }
    } catch (error) {
      if (this.copyStatus) {
        this.copyStatus.textContent = error instanceof Error
          ? `AI match telemetry export failed: ${error.message}`
          : 'AI match telemetry export failed.';
      }
    } finally {
      this.exportingAiMatchTelemetry = false;
      this.refreshExportControls();
    }
  }
}

export function createPauseMenu(options: PauseMenuOptions): PauseMenu {
  return new PauseMenu(options);
}
