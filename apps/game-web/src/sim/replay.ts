import type { CharacterId } from './characters';
import {
  AI_CLASH_POLICY_IDS,
  AI_DECISION_CANDIDATES,
  AI_DECISION_TRACE_SCHEMA_VERSION,
  AI_DIFFICULTY_ORDER,
  AI_MOVEMENT_INTENTS,
  AI_PURSUIT_POLICY_IDS,
  AI_RECOVERY_POLICY_IDS,
  AI_TACTICAL_ACTIONS,
  sanitiseAiBehaviorTuning,
  type AiActionCandidateTrace,
  type AiBehaviorTuning,
  type AiClashPolicyId,
  type AiDecisionCandidate,
  type AiDecisionTrace,
  type AiDifficultyId,
  type AiMovementIntent,
  type AiPursuitPolicyId,
  type AiRecoveryPolicyId,
  type AiTacticalAction,
} from './ai';
import {
  AI_CONTROLLER_ROLE_IDS,
  sanitiseAiControllerRoles,
  type AiControllerRoleId,
  type AiControllerRoles,
} from './aiControllerRoles';
import type { AiDecisionTelemetryEvent } from './aiDecisionTelemetry';
import {
  applyBalanceScenario,
  BALANCE_SCENARIO_IDS,
  BALANCE_SCENARIO_SCHEMA_VERSION,
  type BalanceScenarioId,
} from './balanceScenarios';
import {
  sanitiseCharacterBalanceOverrides,
  type CharacterBalanceOverrides,
} from './characterBalance';
import { computeStateChecksum } from './checksum';
import { fingerprintDeterministicValue } from './fingerprint';
import {
  createInitialState,
  nextDeterministicRandom,
  step,
  type SimulationActionStart,
  type SimulationStepObserver,
} from './sim';
import { fingerprintGameTuning, sanitiseTuning } from './tuning';
import type {
  FrameInput,
  GameRules,
  GameTuning,
  PlayerFrameInput,
  PlayerId,
  PlayersById,
} from './types';

export const REPLAY_PAYLOAD_VERSION = 1;
export const REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION = 'gw.replay-ai-decision-trace.v3';
export const ONLINE_MATCH_REPLAY_SCHEMA_VERSION = 'gw.online-match-replay.v1';
export const LOCAL_AI_REPLAY_SCHEMA_VERSION = 'gw.local-ai-replay.v1';
export const REPLAY_INTEGRITY_SCHEMA_VERSION = 'gw.replay-integrity.v1';
export const REPLAY_CANONICAL_DIGEST_ALGORITHM = 'SHA-256';
const PREVIOUS_REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION = 'gw.replay-ai-decision-trace.v2';
const LEGACY_REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION = 'gw.replay-ai-decision-trace.v1';
const PREVIOUS_AI_DECISION_TRACE_SCHEMA_VERSION = 'gw.ai-decision-trace.v3';
const LEGACY_AI_DECISION_TRACE_SCHEMA_VERSION = 'gw.ai-decision-trace.v2';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V11 = 'gw.ai-behavior-tuning.v11';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V10 = 'gw.ai-behavior-tuning.v10';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V9 = 'gw.ai-behavior-tuning.v9';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V8 = 'gw.ai-behavior-tuning.v8';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V7 = 'gw.ai-behavior-tuning.v7';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V6 = 'gw.ai-behavior-tuning.v6';
const AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V5 = 'gw.ai-behavior-tuning.v5';
const DEFAULT_FIXED_DT = 1 / 60;
const ZERO_DEFAULT_TUNING_KEYS = [
  'postControlCounterLaunchClashGraceSeconds',
  'combatBoostReacquireDelaySeconds',
] as const satisfies readonly (keyof GameTuning)[];

export interface ReplayHeader {
  payloadVersion: number;
  rulesetVersion: string;
  simBuildHash: string;
  seed?: number;
  loadout?: {
    P1?: CharacterId;
    P2?: CharacterId;
  };
  fixedDt?: number;
  advanceRngPerFrame?: boolean;
  rules?: GameRules;
  balanceTuning?: GameTuning;
  characterBalanceOverrides?: CharacterBalanceOverrides;
  startingSituation?: ReplayStartingSituation;
  reviewFocus?: ReplayReviewFocus;
  onlineMatch?: ReplayOnlineMatchIdentity;
  localAi?: ReplayLocalAiProvenance;
}

export interface ReplayLocalAiProvenance {
  schemaVersion: typeof LOCAL_AI_REPLAY_SCHEMA_VERSION;
  profileId: AiDifficultyId;
  matchSeed: number;
  roundSeed: number;
  roundIndex: number;
  controllerSeeds: PlayersById<number>;
  controllerRoles: AiControllerRoles;
  behaviorTuning: AiBehaviorTuning;
  recoveryPolicyId: AiRecoveryPolicyId;
  clashPolicyId: AiClashPolicyId;
  pursuitPolicyId: AiPursuitPolicyId;
}

export interface ReplayStageIdentity {
  id: string;
  version?: string;
  fingerprint?: string;
}

export interface ReplayOnlineMatchIdentity {
  schemaVersion: typeof ONLINE_MATCH_REPLAY_SCHEMA_VERSION;
  sessionId: string;
  matchId: string;
  balanceProfileId: string;
  tuningFingerprint: string;
  characterRegistryFingerprint: string;
  characterPackageVersions: {
    P1: string;
    P2: string;
  };
  stage: ReplayStageIdentity;
}

export interface ReplayStartingSituation {
  schemaVersion: typeof BALANCE_SCENARIO_SCHEMA_VERSION;
  id: BalanceScenarioId;
}

export interface ReplayReviewFocus {
  schemaVersion: 'gw.replay-focus.v1';
  source: string;
  label: string;
  focusFrame: number;
  endFrame?: number;
}

export interface ReplayPayload {
  header: ReplayHeader;
  inputTimeline: ReplayFrameInput[];
  rounds?: ReplayRoundDescriptor[];
  expectedChecksums?: number[];
  aiDecisionTrace?: ReplayAiDecisionTrace;
  integrity?: ReplayIntegrity;
}

export interface ReplayIntegrity {
  schemaVersion: typeof REPLAY_INTEGRITY_SCHEMA_VERSION;
  algorithm: typeof REPLAY_CANONICAL_DIGEST_ALGORITHM;
  digest: string;
}

export interface ReplayAiDecisionTrace {
  schemaVersion: typeof REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION;
  events: AiDecisionTelemetryEvent[];
}

export interface ReplayFrameInput {
  p1?: Partial<PlayerFrameInput>;
  p2?: Partial<PlayerFrameInput>;
}

export interface ReplayRoundDescriptor {
  round?: number;
  label?: string;
  epoch?: number;
  seed?: number;
  startFrame: number;
  endFrame?: number;
  initialChecksum?: number;
  finalChecksum?: number;
  winner?: PlayerId;
}

export interface ReplayResult {
  checksums: number[];
}

export interface ReplayActionStartTrace extends SimulationActionStart {
  frame: number;
}

export interface ChecksumMismatch {
  frame: number;
  actual: number;
  expected: number;
}

export type ReplayValidationErrorCode =
  | 'invalid_payload'
  | 'missing_header'
  | 'unsupported_payload_version'
  | 'invalid_header'
  | 'missing_input_timeline'
  | 'invalid_input_timeline'
  | 'invalid_expected_checksums'
  | 'invalid_rounds'
  | 'invalid_online_identity'
  | 'invalid_integrity'
  | 'invalid_ai_decision_trace';

export interface ReplayValidationError {
  code: ReplayValidationErrorCode;
  message: string;
}

export type ReplayValidationResult =
  | { ok: true; payload: ReplayPayload }
  | { ok: false; error: ReplayValidationError };

function normalisePlayerInput(input: Partial<PlayerFrameInput> | undefined): PlayerFrameInput {
  const legacyShotInput = input as Partial<PlayerFrameInput> & { shot?: boolean };
  return {
    moveX: Number.isFinite(input?.moveX) ? Number(input?.moveX) : 0,
    moveY: Number.isFinite(input?.moveY) ? Number(input?.moveY) : 0,
    boost: Boolean(input?.boost),
    superBoost: Boolean(input?.superBoost),
    special: Boolean(input?.special) || Boolean(legacyShotInput?.shot),
    launch: Boolean(input?.launch),
    dunk: Boolean(input?.dunk),
    parry: Boolean(input?.parry),
    breakLaunch: Boolean(input?.breakLaunch),
  };
}

function normaliseFrameInput(input: ReplayFrameInput | undefined): FrameInput {
  return {
    p1: normalisePlayerInput(input?.p1),
    p2: normalisePlayerInput(input?.p2),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const PLAYER_INPUT_KEYS = [
  'moveX',
  'moveY',
  'boost',
  'superBoost',
  'special',
  'launch',
  'dunk',
  'parry',
  'breakLaunch',
] as const;

function isUnsigned32BitInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 0xffffffff;
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

const LOCAL_AI_PROVENANCE_KEYS = [
  'schemaVersion',
  'profileId',
  'matchSeed',
  'roundSeed',
  'roundIndex',
  'controllerSeeds',
  'controllerRoles',
  'behaviorTuning',
  'recoveryPolicyId',
  'clashPolicyId',
  'pursuitPolicyId',
] as const;

const COMMITMENT_TUNING_KEYS = [
  'commitmentObserveFrames',
  'commitmentPressFrames',
  'commitmentResetFrames',
] as const;

const FINISH_PURSUIT_TUNING_KEYS = ['finishPursuitReachScale'] as const;
const POST_CONTROL_STEERING_TUNING_KEYS = ['postControlSteeringFrames'] as const;
const OPPONENT_CONTROL_RETURN_TUNING_KEYS = ['opponentControlReturnObserveFrames'] as const;
const POST_COMMITMENT_DECISION_TUNING_KEYS = ['postCommitmentDecisionScale'] as const;
const REPOSITION_TUNING_KEYS = ['repositionWeightScale'] as const;
const COUNTERSTEP_TUNING_KEYS = ['postControlCounterstepScale'] as const;

function getLegacyAiBehaviorTuningOmittedKeys(schemaVersion: unknown): readonly string[] | null {
  switch (schemaVersion) {
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V11:
      return COUNTERSTEP_TUNING_KEYS;
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V10:
      return [...REPOSITION_TUNING_KEYS, ...COUNTERSTEP_TUNING_KEYS];
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V9:
      return [
        ...POST_COMMITMENT_DECISION_TUNING_KEYS,
        ...REPOSITION_TUNING_KEYS,
        ...COUNTERSTEP_TUNING_KEYS,
      ];
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V8:
      return [
        ...OPPONENT_CONTROL_RETURN_TUNING_KEYS,
        ...POST_COMMITMENT_DECISION_TUNING_KEYS,
        ...REPOSITION_TUNING_KEYS,
        ...COUNTERSTEP_TUNING_KEYS,
      ];
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V7:
      return [
        ...POST_CONTROL_STEERING_TUNING_KEYS,
        ...OPPONENT_CONTROL_RETURN_TUNING_KEYS,
        ...POST_COMMITMENT_DECISION_TUNING_KEYS,
        ...REPOSITION_TUNING_KEYS,
        ...COUNTERSTEP_TUNING_KEYS,
      ];
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V6:
      return [
        ...FINISH_PURSUIT_TUNING_KEYS,
        ...POST_CONTROL_STEERING_TUNING_KEYS,
        ...OPPONENT_CONTROL_RETURN_TUNING_KEYS,
        ...POST_COMMITMENT_DECISION_TUNING_KEYS,
        ...REPOSITION_TUNING_KEYS,
        ...COUNTERSTEP_TUNING_KEYS,
      ];
    case AI_BEHAVIOR_TUNING_SCHEMA_VERSION_V5:
      return [
        ...COMMITMENT_TUNING_KEYS,
        ...FINISH_PURSUIT_TUNING_KEYS,
        ...POST_CONTROL_STEERING_TUNING_KEYS,
        ...OPPONENT_CONTROL_RETURN_TUNING_KEYS,
        ...POST_COMMITMENT_DECISION_TUNING_KEYS,
        ...REPOSITION_TUNING_KEYS,
        ...COUNTERSTEP_TUNING_KEYS,
      ];
    default:
      return null;
  }
}

function parseReplayAiBehaviorTuning(value: unknown): AiBehaviorTuning | null {
  if (!isObjectRecord(value)) {
    return null;
  }
  const behaviorTuning = sanitiseAiBehaviorTuning(value);
  const currentKeys = Object.keys(behaviorTuning);
  const isCurrent = value.schemaVersion === behaviorTuning.schemaVersion;
  let expectedKeys = currentKeys;
  if (!isCurrent) {
    const omittedKeys = getLegacyAiBehaviorTuningOmittedKeys(value.schemaVersion);
    if (omittedKeys === null) {
      return null;
    }
    expectedKeys = currentKeys.filter((key) => !omittedKeys.includes(key));
  }
  if (!hasExactKeys(value, expectedKeys)) {
    return null;
  }
  for (const key of expectedKeys) {
    if (key !== 'schemaVersion' && value[key] !== behaviorTuning[key as keyof AiBehaviorTuning]) {
      return null;
    }
  }
  return behaviorTuning;
}

export function cloneReplayLocalAiProvenance(
  provenance: ReplayLocalAiProvenance,
): ReplayLocalAiProvenance {
  return {
    schemaVersion: LOCAL_AI_REPLAY_SCHEMA_VERSION,
    profileId: provenance.profileId,
    matchSeed: provenance.matchSeed,
    roundSeed: provenance.roundSeed,
    roundIndex: provenance.roundIndex,
    controllerSeeds: { ...provenance.controllerSeeds },
    controllerRoles: sanitiseAiControllerRoles(provenance.controllerRoles),
    behaviorTuning: sanitiseAiBehaviorTuning(provenance.behaviorTuning),
    recoveryPolicyId: provenance.recoveryPolicyId,
    clashPolicyId: provenance.clashPolicyId,
    pursuitPolicyId: provenance.pursuitPolicyId,
  };
}

function parseReplayLocalAiProvenance(value: unknown): ReplayLocalAiProvenance | null {
  if (
    !isObjectRecord(value)
    || !hasExactKeys(value, LOCAL_AI_PROVENANCE_KEYS)
    || value.schemaVersion !== LOCAL_AI_REPLAY_SCHEMA_VERSION
    || !AI_DIFFICULTY_ORDER.includes(value.profileId as AiDifficultyId)
    || !isUnsigned32BitInteger(value.matchSeed)
    || !isUnsigned32BitInteger(value.roundSeed)
    || !Number.isSafeInteger(value.roundIndex)
    || Number(value.roundIndex) < 0
    || !AI_RECOVERY_POLICY_IDS.includes(value.recoveryPolicyId as AiRecoveryPolicyId)
    || !AI_CLASH_POLICY_IDS.includes(value.clashPolicyId as AiClashPolicyId)
    || !AI_PURSUIT_POLICY_IDS.includes(value.pursuitPolicyId as AiPursuitPolicyId)
  ) {
    return null;
  }

  const controllerSeedsValue = value.controllerSeeds;
  if (
    !isObjectRecord(controllerSeedsValue)
    || !hasExactKeys(controllerSeedsValue, ['P1', 'P2'])
    || !isUnsigned32BitInteger(controllerSeedsValue.P1)
    || !isUnsigned32BitInteger(controllerSeedsValue.P2)
  ) {
    return null;
  }

  const controllerRolesValue = value.controllerRoles;
  if (
    !isObjectRecord(controllerRolesValue)
    || !hasExactKeys(controllerRolesValue, ['P1', 'P2'])
    || !AI_CONTROLLER_ROLE_IDS.includes(controllerRolesValue.P1 as AiControllerRoleId)
    || !AI_CONTROLLER_ROLE_IDS.includes(controllerRolesValue.P2 as AiControllerRoleId)
  ) {
    return null;
  }
  const controllerRoles = sanitiseAiControllerRoles(controllerRolesValue);
  if (
    controllerRolesValue.P1 !== controllerRoles.P1
    || controllerRolesValue.P2 !== controllerRoles.P2
  ) {
    return null;
  }

  const behaviorTuning = parseReplayAiBehaviorTuning(value.behaviorTuning);
  if (!behaviorTuning) {
    return null;
  }

  return {
    schemaVersion: LOCAL_AI_REPLAY_SCHEMA_VERSION,
    profileId: value.profileId as AiDifficultyId,
    matchSeed: value.matchSeed,
    roundSeed: value.roundSeed,
    roundIndex: Number(value.roundIndex),
    controllerSeeds: {
      P1: controllerSeedsValue.P1,
      P2: controllerSeedsValue.P2,
    },
    controllerRoles,
    behaviorTuning,
    recoveryPolicyId: value.recoveryPolicyId as AiRecoveryPolicyId,
    clashPolicyId: value.clashPolicyId as AiClashPolicyId,
    pursuitPolicyId: value.pursuitPolicyId as AiPursuitPolicyId,
  };
}

function parseCanonicalPlayerInput(value: unknown): PlayerFrameInput | null {
  if (!isObjectRecord(value) || !hasExactKeys(value, PLAYER_INPUT_KEYS)) {
    return null;
  }
  if (
    typeof value.moveX !== 'number'
    || !Number.isFinite(value.moveX)
    || value.moveX < -1
    || value.moveX > 1
    || typeof value.moveY !== 'number'
    || !Number.isFinite(value.moveY)
    || value.moveY < -1
    || value.moveY > 1
  ) {
    return null;
  }
  for (const action of PLAYER_INPUT_KEYS.slice(2)) {
    if (typeof value[action] !== 'boolean') {
      return null;
    }
  }
  return {
    moveX: value.moveX,
    moveY: value.moveY,
    boost: value.boost as boolean,
    superBoost: value.superBoost as boolean,
    special: value.special as boolean,
    launch: value.launch as boolean,
    dunk: value.dunk as boolean,
    parry: value.parry as boolean,
    breakLaunch: value.breakLaunch as boolean,
  };
}

function parseCanonicalFrameInput(value: unknown): ReplayFrameInput | null {
  if (!isObjectRecord(value) || !hasExactKeys(value, ['p1', 'p2'])) {
    return null;
  }
  const p1 = parseCanonicalPlayerInput(value.p1);
  const p2 = parseCanonicalPlayerInput(value.p2);
  return p1 && p2 ? { p1, p2 } : null;
}

function parseOnlineMatchIdentity(
  value: unknown,
  tuning: GameTuning,
): ReplayOnlineMatchIdentity | null {
  if (
    !isObjectRecord(value)
    || !hasExactKeys(value, [
      'schemaVersion',
      'sessionId',
      'matchId',
      'balanceProfileId',
      'tuningFingerprint',
      'characterRegistryFingerprint',
      'characterPackageVersions',
      'stage',
    ])
    || value.schemaVersion !== ONLINE_MATCH_REPLAY_SCHEMA_VERSION
    || !isNonEmptyTrimmedString(value.sessionId)
    || !isNonEmptyTrimmedString(value.matchId)
    || !isNonEmptyTrimmedString(value.balanceProfileId)
    || !isNonEmptyTrimmedString(value.tuningFingerprint)
    || value.tuningFingerprint !== fingerprintGameTuning(tuning)
    || !isNonEmptyTrimmedString(value.characterRegistryFingerprint)
    || !isObjectRecord(value.characterPackageVersions)
    || !hasExactKeys(value.characterPackageVersions, ['P1', 'P2'])
    || !isNonEmptyTrimmedString(value.characterPackageVersions.P1)
    || !isNonEmptyTrimmedString(value.characterPackageVersions.P2)
    || !isObjectRecord(value.stage)
  ) {
    return null;
  }

  const stageKeys = Object.keys(value.stage);
  if (
    !stageKeys.every((key) => key === 'id' || key === 'version' || key === 'fingerprint')
    || !isNonEmptyTrimmedString(value.stage.id)
    || (value.stage.version !== undefined && !isNonEmptyTrimmedString(value.stage.version))
    || (value.stage.fingerprint !== undefined && !isNonEmptyTrimmedString(value.stage.fingerprint))
  ) {
    return null;
  }

  return {
    schemaVersion: ONLINE_MATCH_REPLAY_SCHEMA_VERSION,
    sessionId: value.sessionId,
    matchId: value.matchId,
    balanceProfileId: value.balanceProfileId,
    tuningFingerprint: value.tuningFingerprint,
    characterRegistryFingerprint: value.characterRegistryFingerprint,
    characterPackageVersions: {
      P1: value.characterPackageVersions.P1,
      P2: value.characterPackageVersions.P2,
    },
    stage: {
      id: value.stage.id,
      ...(value.stage.version !== undefined ? { version: value.stage.version as string } : {}),
      ...(value.stage.fingerprint !== undefined
        ? { fingerprint: value.stage.fingerprint as string }
        : {}),
    },
  };
}

function matchesCanonicalTuningSnapshot(
  value: unknown,
  tuning: GameTuning,
): boolean {
  if (!isObjectRecord(value)) {
    return false;
  }
  const currentKeys = Object.keys(tuning);
  const snapshotKeys = Object.keys(value);
  const hasSupportedShape = snapshotKeys.every((key) => currentKeys.includes(key))
    && currentKeys.every((key) => (
      snapshotKeys.includes(key)
      || (
        ZERO_DEFAULT_TUNING_KEYS.includes(key as typeof ZERO_DEFAULT_TUNING_KEYS[number])
        && tuning[key as keyof GameTuning] === 0
      )
    ));
  return hasSupportedShape
    && Object.entries(value).every(([key, rawValue]) => (
      rawValue === tuning[key as keyof GameTuning]
    ));
}

function cloneReplayPlayerInput(value: unknown): Partial<PlayerFrameInput> | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const cloned: Partial<PlayerFrameInput> = {};
  if (hasOwn(value, 'moveX')) {
    cloned.moveX = Number.isFinite(value.moveX) ? Number(value.moveX) : 0;
  }
  if (hasOwn(value, 'moveY')) {
    cloned.moveY = Number.isFinite(value.moveY) ? Number(value.moveY) : 0;
  }
  for (const action of [
    'boost',
    'superBoost',
    'launch',
    'dunk',
    'parry',
    'breakLaunch',
  ] as const) {
    if (hasOwn(value, action)) {
      cloned[action] = Boolean(value[action]);
    }
  }
  if (hasOwn(value, 'special') || hasOwn(value, 'shot')) {
    cloned.special = Boolean(value.special) || Boolean(value.shot);
  }
  return cloned;
}

function cloneReplayFrameInput(value: unknown): ReplayFrameInput {
  if (!isObjectRecord(value)) {
    return {};
  }
  const p1 = cloneReplayPlayerInput(value.p1);
  const p2 = cloneReplayPlayerInput(value.p2);
  return {
    ...(p1 ? { p1 } : {}),
    ...(p2 ? { p2 } : {}),
  };
}

function cloneAiDecisionTrace(decision: AiDecisionTrace): AiDecisionTrace {
  return {
    ...decision,
    context: { ...decision.context },
    gates: { ...decision.gates },
    candidates: Object.fromEntries(
      AI_DECISION_CANDIDATES.map((action) => [action, { ...decision.candidates[action] }]),
    ) as AiDecisionTrace['candidates'],
  };
}

function cloneAiDecisionTelemetryEvent(event: AiDecisionTelemetryEvent): AiDecisionTelemetryEvent {
  return {
    sequence: event.sequence,
    frame: event.frame,
    playerId: event.playerId,
    decision: cloneAiDecisionTrace(event.decision),
  };
}

export function createReplayAiDecisionTrace(
  events: readonly AiDecisionTelemetryEvent[],
): ReplayAiDecisionTrace | undefined {
  if (events.length === 0) {
    return undefined;
  }
  return {
    schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
    events: events.map(cloneAiDecisionTelemetryEvent),
  };
}

export function cloneReplayAiDecisionTrace(trace: ReplayAiDecisionTrace): ReplayAiDecisionTrace {
  return {
    schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
    events: trace.events.map(cloneAiDecisionTelemetryEvent),
  };
}

function parseAiActionCandidate(value: unknown): AiActionCandidateTrace | null {
  if (
    !isObjectRecord(value)
    || typeof value.eligible !== 'boolean'
    || typeof value.weight !== 'number'
    || !Number.isFinite(value.weight)
    || typeof value.reason !== 'string'
  ) {
    return null;
  }
  return {
    eligible: value.eligible,
    weight: value.weight,
    reason: value.reason,
  };
}

const PREVIOUS_AI_MOVEMENT_INTENTS = AI_MOVEMENT_INTENTS.filter(
  (intent) => intent !== 'tactical_reposition',
);
const LEGACY_AI_MOVEMENT_INTENTS = PREVIOUS_AI_MOVEMENT_INTENTS.filter(
  (intent) => intent !== 'commitment_observe'
    && intent !== 'commitment_press'
    && intent !== 'commitment_reset',
);

function parseAiDecisionTrace(
  value: unknown,
  playerId: PlayerId,
  expectedSchemaVersion: typeof AI_DECISION_TRACE_SCHEMA_VERSION
    | typeof PREVIOUS_AI_DECISION_TRACE_SCHEMA_VERSION
    | typeof LEGACY_AI_DECISION_TRACE_SCHEMA_VERSION,
): AiDecisionTrace | null {
  const allowedMovementIntents: readonly string[] = expectedSchemaVersion === LEGACY_AI_DECISION_TRACE_SCHEMA_VERSION
    ? LEGACY_AI_MOVEMENT_INTENTS
    : expectedSchemaVersion === PREVIOUS_AI_DECISION_TRACE_SCHEMA_VERSION
      ? PREVIOUS_AI_MOVEMENT_INTENTS
      : AI_MOVEMENT_INTENTS;
  if (
    !isObjectRecord(value)
    || value.schemaVersion !== expectedSchemaVersion
    || value.playerId !== playerId
    || !AI_DIFFICULTY_ORDER.includes(value.profileId as AiDifficultyId)
    || !AI_CONTROLLER_ROLE_IDS.includes(value.controllerRoleId as AiControllerRoleId)
    || typeof value.gameTimeSeconds !== 'number'
    || !Number.isFinite(value.gameTimeSeconds)
    || value.gameTimeSeconds < 0
    || !allowedMovementIntents.includes(value.movementIntent as AiMovementIntent)
    || typeof value.selectedReason !== 'string'
    || typeof value.mistakeRoll !== 'number'
    || !Number.isFinite(value.mistakeRoll)
    || !isObjectRecord(value.context)
    || !isObjectRecord(value.gates)
    || !isObjectRecord(value.candidates)
  ) {
    return null;
  }

  const selectedAction = value.selectedAction === null
    ? null
    : AI_TACTICAL_ACTIONS.includes(value.selectedAction as AiTacticalAction)
      ? value.selectedAction as AiTacticalAction
      : undefined;
  const selectionRoll = value.selectionRoll === null
    ? null
    : typeof value.selectionRoll === 'number' && Number.isFinite(value.selectionRoll)
      ? value.selectionRoll
      : undefined;
  const incomingProjectileDistance = value.context.incomingProjectileDistance === null
    ? null
    : typeof value.context.incomingProjectileDistance === 'number'
      && Number.isFinite(value.context.incomingProjectileDistance)
      ? value.context.incomingProjectileDistance
      : undefined;
  if (
    selectedAction === undefined
    || selectionRoll === undefined
    || incomingProjectileDistance === undefined
    || typeof value.context.distance !== 'number'
    || !Number.isFinite(value.context.distance)
    || typeof value.context.fuelRatio !== 'number'
    || !Number.isFinite(value.context.fuelRatio)
    || typeof value.context.opponentFuelRatio !== 'number'
    || !Number.isFinite(value.context.opponentFuelRatio)
    || typeof value.context.finishOpportunity !== 'boolean'
    || typeof value.gates.hasControl !== 'boolean'
    || typeof value.gates.canChooseTacticalAction !== 'boolean'
    || !Number.isSafeInteger(value.gates.decisionLockFrames)
    || Number(value.gates.decisionLockFrames) < 0
    || !Number.isSafeInteger(value.gates.reactionFramesRemaining)
    || Number(value.gates.reactionFramesRemaining) < 0
    || typeof value.gates.neutralHoldActive !== 'boolean'
    || typeof value.gates.postEventSpacingActive !== 'boolean'
    || typeof value.gates.deliberateError !== 'boolean'
  ) {
    return null;
  }

  const candidates = {} as Record<AiDecisionCandidate, AiActionCandidateTrace>;
  const candidateKeys = expectedSchemaVersion === AI_DECISION_TRACE_SCHEMA_VERSION
    ? AI_DECISION_CANDIDATES
    : AI_TACTICAL_ACTIONS;
  for (const action of candidateKeys) {
    const candidate = parseAiActionCandidate(value.candidates[action]);
    if (!candidate) {
      return null;
    }
    candidates[action] = candidate;
  }
  if (expectedSchemaVersion !== AI_DECISION_TRACE_SCHEMA_VERSION) {
    candidates.reposition = {
      eligible: false,
      weight: 0,
      reason: 'unavailable_in_historical_trace',
    };
  }

  return {
    schemaVersion: AI_DECISION_TRACE_SCHEMA_VERSION,
    playerId,
    profileId: value.profileId as AiDifficultyId,
    controllerRoleId: value.controllerRoleId as AiControllerRoleId,
    gameTimeSeconds: value.gameTimeSeconds,
    movementIntent: value.movementIntent as AiMovementIntent,
    selectedAction,
    selectedReason: value.selectedReason,
    selectionRoll,
    mistakeRoll: value.mistakeRoll,
    context: {
      distance: value.context.distance,
      fuelRatio: value.context.fuelRatio,
      opponentFuelRatio: value.context.opponentFuelRatio,
      incomingProjectileDistance,
      finishOpportunity: value.context.finishOpportunity,
    },
    gates: {
      hasControl: value.gates.hasControl,
      canChooseTacticalAction: value.gates.canChooseTacticalAction,
      decisionLockFrames: Number(value.gates.decisionLockFrames),
      reactionFramesRemaining: Number(value.gates.reactionFramesRemaining),
      neutralHoldActive: value.gates.neutralHoldActive,
      postEventSpacingActive: value.gates.postEventSpacingActive,
      deliberateError: value.gates.deliberateError,
    },
    candidates,
  };
}

function parseReplayAiDecisionTrace(
  value: unknown,
  inputFrameCount: number,
): ReplayAiDecisionTrace | null {
  const isCurrent = isObjectRecord(value)
    && value.schemaVersion === REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION;
  const isPrevious = isObjectRecord(value)
    && value.schemaVersion === PREVIOUS_REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION;
  const isLegacy = isObjectRecord(value)
    && value.schemaVersion === LEGACY_REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION;
  if (
    !isObjectRecord(value)
    || (!isCurrent && !isPrevious && !isLegacy)
    || !Array.isArray(value.events)
  ) {
    return null;
  }
  const decisionSchemaVersion = isLegacy
    ? LEGACY_AI_DECISION_TRACE_SCHEMA_VERSION
    : isPrevious
      ? PREVIOUS_AI_DECISION_TRACE_SCHEMA_VERSION
      : AI_DECISION_TRACE_SCHEMA_VERSION;

  const events: AiDecisionTelemetryEvent[] = [];
  const seenSequences = new Set<number>();
  const seenPlayerFrames = new Set<string>();
  for (const rawEvent of value.events) {
    if (!isObjectRecord(rawEvent)) {
      return null;
    }
    const sequence = rawEvent.sequence;
    const frame = rawEvent.frame;
    const playerId = rawEvent.playerId;
    if (
      !Number.isSafeInteger(sequence)
      || Number(sequence) < 0
      || !Number.isSafeInteger(frame)
      || Number(frame) < 0
      || Number(frame) >= inputFrameCount
      || (playerId !== 'P1' && playerId !== 'P2')
    ) {
      return null;
    }
    const safeSequence = Number(sequence);
    const safeFrame = Number(frame);
    const playerFrameKey = `${safeFrame}:${playerId}`;
    if (seenSequences.has(safeSequence) || seenPlayerFrames.has(playerFrameKey)) {
      return null;
    }
    const decision = parseAiDecisionTrace(rawEvent.decision, playerId, decisionSchemaVersion);
    if (!decision) {
      return null;
    }
    seenSequences.add(safeSequence);
    seenPlayerFrames.add(playerFrameKey);
    events.push({
      sequence: safeSequence,
      frame: safeFrame,
      playerId,
      decision,
    });
  }

  return {
    schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
    events,
  };
}

function parseReviewFocus(value: unknown): ReplayReviewFocus | undefined {
  if (!isObjectRecord(value) || value.schemaVersion !== 'gw.replay-focus.v1') {
    return undefined;
  }
  const source = typeof value.source === 'string' ? value.source.trim() : '';
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  const focusFrame = Math.floor(Number(value.focusFrame));
  const parsedEndFrame = value.endFrame === undefined ? undefined : Math.floor(Number(value.endFrame));
  if (!source || !label || !Number.isFinite(focusFrame) || focusFrame < 0) {
    return undefined;
  }
  return {
    schemaVersion: 'gw.replay-focus.v1',
    source,
    label,
    focusFrame,
    endFrame: parsedEndFrame !== undefined
      && Number.isFinite(parsedEndFrame)
      && parsedEndFrame >= focusFrame
      ? parsedEndFrame
      : undefined,
  };
}

function validateHeader(header: unknown): ReplayValidationResult {
  if (!isObjectRecord(header)) {
    return {
      ok: false,
      error: {
        code: 'missing_header',
        message: 'Replay payload is missing a valid header object.',
      },
    };
  }

  const hasOnlineIdentity = header.onlineMatch !== undefined;
  const payloadVersion = Number(header.payloadVersion);
  if (!Number.isFinite(payloadVersion)) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header payloadVersion must be a number.',
      },
    };
  }
  if (payloadVersion !== REPLAY_PAYLOAD_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported_payload_version',
        message: `Replay payloadVersion ${payloadVersion} is unsupported. Expected ${REPLAY_PAYLOAD_VERSION}.`,
      },
    };
  }

  const rulesetVersion = String(header.rulesetVersion ?? '').trim();
  if (!rulesetVersion) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header rulesetVersion is required.',
      },
    };
  }

  const simBuildHash = String(header.simBuildHash ?? '').trim();
  if (!simBuildHash) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header simBuildHash is required.',
      },
    };
  }

  const fixedDtValue = header.fixedDt;
  if (fixedDtValue !== undefined && (!Number.isFinite(Number(fixedDtValue)) || Number(fixedDtValue) <= 0)) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header fixedDt must be a positive number when provided.',
      },
    };
  }

  const parsedLoadout = isObjectRecord(header.loadout) ? {
    P1: typeof header.loadout.P1 === 'string' ? header.loadout.P1 as CharacterId : undefined,
    P2: typeof header.loadout.P2 === 'string' ? header.loadout.P2 as CharacterId : undefined,
  } : undefined;
  const parsedRules = isObjectRecord(header.rules)
    ? { allowDunkWin: Boolean(header.rules.allowDunkWin) }
    : undefined;
  const parsedTuning = isObjectRecord(header.balanceTuning)
    ? sanitiseTuning(header.balanceTuning as Partial<GameTuning>)
    : undefined;
  const parsedCharacterBalanceOverrides = isObjectRecord(header.characterBalanceOverrides)
    ? sanitiseCharacterBalanceOverrides(header.characterBalanceOverrides)
    : undefined;

  let localAi: ReplayLocalAiProvenance | undefined;
  if (header.localAi !== undefined) {
    localAi = parseReplayLocalAiProvenance(header.localAi) ?? undefined;
    if (!localAi) {
      return {
        ok: false,
        error: {
          code: 'invalid_header',
          message: 'Replay header localAi must contain valid deterministic local AI provenance.',
        },
      };
    }
  }

  let onlineMatch: ReplayOnlineMatchIdentity | undefined;
  if (hasOnlineIdentity) {
    const tuningMatchesExactly = parsedTuning
      && matchesCanonicalTuningSnapshot(header.balanceTuning, parsedTuning);
    const characterOverridesMatchExactly = parsedCharacterBalanceOverrides
      && fingerprintDeterministicValue(parsedCharacterBalanceOverrides)
        === fingerprintDeterministicValue(header.characterBalanceOverrides);
    if (
      typeof header.payloadVersion !== 'number'
      || !isNonEmptyTrimmedString(header.rulesetVersion)
      || !isNonEmptyTrimmedString(header.simBuildHash)
      || !isUnsigned32BitInteger(header.seed)
      || !isObjectRecord(header.loadout)
      || !hasExactKeys(header.loadout, ['P1', 'P2'])
      || !isNonEmptyTrimmedString(header.loadout.P1)
      || !isNonEmptyTrimmedString(header.loadout.P2)
      || typeof fixedDtValue !== 'number'
      || !Number.isFinite(fixedDtValue)
      || fixedDtValue <= 0
      || typeof header.advanceRngPerFrame !== 'boolean'
      || !isObjectRecord(header.rules)
      || !hasExactKeys(header.rules, ['allowDunkWin'])
      || typeof header.rules.allowDunkWin !== 'boolean'
      || !tuningMatchesExactly
      || !isObjectRecord(header.characterBalanceOverrides)
      || !characterOverridesMatchExactly
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_online_identity',
          message: 'Canonical online replay headers require exact seed, loadout, timestep, rules, tuning, and character balance snapshots.',
        },
      };
    }
    const parsedOnlineMatch = parseOnlineMatchIdentity(header.onlineMatch, parsedTuning);
    if (!parsedOnlineMatch) {
      return {
        ok: false,
        error: {
          code: 'invalid_online_identity',
          message: 'Replay onlineMatch identity is malformed or inconsistent with balanceTuning.',
        },
      };
    }
    onlineMatch = parsedOnlineMatch;
  }

  let startingSituation: ReplayStartingSituation | undefined;
  if (header.startingSituation !== undefined) {
    if (!isObjectRecord(header.startingSituation)) {
      return {
        ok: false,
        error: {
          code: 'invalid_header',
          message: 'Replay header startingSituation must be an object when provided.',
        },
      };
    }
    const schemaVersion = String(header.startingSituation.schemaVersion ?? '');
    const id = String(header.startingSituation.id ?? '') as BalanceScenarioId;
    if (
      schemaVersion !== BALANCE_SCENARIO_SCHEMA_VERSION
      || !BALANCE_SCENARIO_IDS.includes(id)
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_header',
          message: 'Replay header startingSituation uses an unsupported schema or scenario.',
        },
      };
    }
    startingSituation = {
      schemaVersion: BALANCE_SCENARIO_SCHEMA_VERSION,
      id,
    };
  }

  return {
    ok: true,
    payload: {
      header: {
        payloadVersion,
        rulesetVersion,
        simBuildHash,
        seed: Number.isFinite(Number(header.seed)) ? Number(header.seed) : undefined,
        loadout: parsedLoadout,
        fixedDt: fixedDtValue !== undefined ? Number(fixedDtValue) : undefined,
        advanceRngPerFrame: Boolean(header.advanceRngPerFrame),
        rules: parsedRules,
        balanceTuning: parsedTuning,
        characterBalanceOverrides: parsedCharacterBalanceOverrides,
        startingSituation,
        reviewFocus: parseReviewFocus(header.reviewFocus),
        onlineMatch,
        localAi,
      },
      inputTimeline: [],
    },
  };
}

function parseReplayIntegrity(value: unknown): ReplayIntegrity | null {
  if (
    !isObjectRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'algorithm', 'digest'])
    || value.schemaVersion !== REPLAY_INTEGRITY_SCHEMA_VERSION
    || value.algorithm !== REPLAY_CANONICAL_DIGEST_ALGORITHM
    || typeof value.digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.digest)
  ) {
    return null;
  }
  return {
    schemaVersion: REPLAY_INTEGRITY_SCHEMA_VERSION,
    algorithm: REPLAY_CANONICAL_DIGEST_ALGORITHM,
    digest: value.digest,
  };
}

function parseRoundDescriptor(value: unknown): ReplayRoundDescriptor | null {
  if (!isObjectRecord(value)) {
    return null;
  }
  const startFrame = Math.floor(Number(value.startFrame));
  if (!Number.isFinite(startFrame) || startFrame < 0) {
    return null;
  }
  const parsedEnd = value.endFrame === undefined ? undefined : Math.floor(Number(value.endFrame));
  const endFrame = parsedEnd !== undefined && Number.isFinite(parsedEnd) && parsedEnd >= startFrame
    ? parsedEnd
    : undefined;
  const parsedRound = value.round === undefined ? undefined : Math.floor(Number(value.round));
  const round = parsedRound !== undefined && Number.isFinite(parsedRound) && parsedRound > 0
    ? parsedRound
    : undefined;
  const parsedEpoch = value.epoch === undefined ? undefined : Math.floor(Number(value.epoch));
  const epoch = parsedEpoch !== undefined && Number.isFinite(parsedEpoch) && parsedEpoch >= 0
    ? parsedEpoch
    : undefined;
  const seed = isUnsigned32BitInteger(value.seed) ? value.seed : undefined;
  const initialChecksum = isUnsigned32BitInteger(value.initialChecksum)
    ? value.initialChecksum
    : undefined;
  const finalChecksum = isUnsigned32BitInteger(value.finalChecksum)
    ? value.finalChecksum
    : undefined;
  const winner = value.winner === 'P1' || value.winner === 'P2' ? value.winner : undefined;
  const label = typeof value.label === 'string' ? value.label.trim() : undefined;
  return {
    round,
    label: label && label.length > 0 ? label : undefined,
    epoch,
    seed,
    startFrame,
    endFrame,
    initialChecksum,
    finalChecksum,
    winner,
  };
}

function validateCanonicalRoundStructure(
  rawRounds: unknown,
  rounds: ReplayRoundDescriptor[] | undefined,
  header: ReplayHeader,
  inputTimeline: ReplayFrameInput[],
  expectedChecksums: number[] | undefined,
): ReplayValidationError | null {
  if (
    !Array.isArray(rawRounds)
    || rawRounds.length === 0
    || !rounds
    || rounds.length !== rawRounds.length
    || !expectedChecksums
    || expectedChecksums.length !== inputTimeline.length
    || inputTimeline.length === 0
  ) {
    return {
      code: 'invalid_rounds',
      message: 'Canonical online replays require non-empty rounds and one checksum per input frame.',
    };
  }

  let expectedStartFrame = 0;
  for (let index = 0; index < rounds.length; index += 1) {
    const rawRound = rawRounds[index];
    const round = rounds[index];
    const endFrame = round.endFrame;
    if (
      !isObjectRecord(rawRound)
      || !Object.keys(rawRound).every((key) => [
        'round',
        'label',
        'epoch',
        'seed',
        'startFrame',
        'endFrame',
        'initialChecksum',
        'finalChecksum',
        'winner',
      ].includes(key))
      || rawRound.round !== index + 1
      || rawRound.epoch !== index
      || rawRound.seed !== header.seed
      || rawRound.startFrame !== expectedStartFrame
      || typeof endFrame !== 'number'
      || rawRound.endFrame !== endFrame
      || endFrame >= inputTimeline.length
      || !isUnsigned32BitInteger(rawRound.initialChecksum)
      || !isUnsigned32BitInteger(rawRound.finalChecksum)
      || rawRound.finalChecksum !== expectedChecksums[endFrame]
      || (rawRound.label !== undefined && !isNonEmptyTrimmedString(rawRound.label))
      || (rawRound.winner !== undefined && rawRound.winner !== 'P1' && rawRound.winner !== 'P2')
    ) {
      return {
        code: 'invalid_rounds',
        message: `Canonical online replay round ${index + 1} has malformed or inconsistent boundaries.`,
      };
    }
    expectedStartFrame = endFrame + 1;
  }
  if (expectedStartFrame !== inputTimeline.length) {
    return {
      code: 'invalid_rounds',
      message: 'Canonical online replay rounds must cover the complete input timeline without gaps.',
    };
  }
  return null;
}

export function validateReplayPayload(rawPayload: unknown): ReplayValidationResult {
  if (!isObjectRecord(rawPayload)) {
    return {
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Replay payload must be a JSON object.',
      },
    };
  }

  const headerValidation = validateHeader(rawPayload.header);
  if (!headerValidation.ok) {
    return headerValidation;
  }
  const isCanonicalOnlineReplay = headerValidation.payload.header.onlineMatch !== undefined;

  if (!Array.isArray(rawPayload.inputTimeline)) {
    return {
      ok: false,
      error: {
        code: 'missing_input_timeline',
        message: 'Replay payload must include inputTimeline array.',
      },
    };
  }
  const canonicalInputs = isCanonicalOnlineReplay
    ? rawPayload.inputTimeline.map(parseCanonicalFrameInput)
    : null;
  if (canonicalInputs?.some((input) => input === null)) {
    return {
      ok: false,
      error: {
        code: 'invalid_input_timeline',
        message: 'Canonical online replay frames require complete authoritative P1 and P2 inputs.',
      },
    };
  }
  const inputTimeline = canonicalInputs
    ? canonicalInputs as ReplayFrameInput[]
    : rawPayload.inputTimeline.map(cloneReplayFrameInput);

  let expectedChecksums: number[] | undefined;
  if (rawPayload.expectedChecksums !== undefined) {
    if (!Array.isArray(rawPayload.expectedChecksums)) {
      return {
        ok: false,
        error: {
          code: 'invalid_expected_checksums',
          message: 'Replay expectedChecksums must be an array when provided.',
        },
      };
    }
    expectedChecksums = rawPayload.expectedChecksums.map((value) => (
      isCanonicalOnlineReplay && typeof value !== 'number' ? Number.NaN : Number(value)
    ));
    if (expectedChecksums.some((value) => (
      !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff
    ))) {
      return {
        ok: false,
        error: {
          code: 'invalid_expected_checksums',
          message: 'Replay expectedChecksums must contain unsigned 32-bit integers.',
        },
      };
    }
  }
  const rounds = Array.isArray(rawPayload.rounds)
    ? rawPayload.rounds
      .map(parseRoundDescriptor)
      .filter((value): value is ReplayRoundDescriptor => value !== null)
    : undefined;

  let integrity: ReplayIntegrity | undefined;
  if (rawPayload.integrity !== undefined) {
    integrity = parseReplayIntegrity(rawPayload.integrity) ?? undefined;
    if (!integrity) {
      return {
        ok: false,
        error: {
          code: 'invalid_integrity',
          message: 'Replay integrity must contain a supported canonical SHA-256 digest.',
        },
      };
    }
  }
  if (isCanonicalOnlineReplay !== Boolean(integrity)) {
    return {
      ok: false,
      error: {
        code: 'invalid_integrity',
        message: 'Canonical online replay identity and integrity must be provided together.',
      },
    };
  }

  if (isCanonicalOnlineReplay) {
    const roundError = validateCanonicalRoundStructure(
      rawPayload.rounds,
      rounds,
      headerValidation.payload.header,
      inputTimeline,
      expectedChecksums,
    );
    if (roundError) {
      return { ok: false, error: roundError };
    }
  }

  let aiDecisionTrace: ReplayAiDecisionTrace | undefined;
  if (rawPayload.aiDecisionTrace !== undefined) {
    const parsedAiDecisionTrace = parseReplayAiDecisionTrace(
      rawPayload.aiDecisionTrace,
      inputTimeline.length,
    );
    if (!parsedAiDecisionTrace) {
      return {
        ok: false,
        error: {
          code: 'invalid_ai_decision_trace',
          message: 'Replay aiDecisionTrace must use a supported schema with valid frame-correlated AI decisions.',
        },
      };
    }
    aiDecisionTrace = parsedAiDecisionTrace;
  }

  const payload: ReplayPayload = {
    ...headerValidation.payload,
    inputTimeline,
    rounds,
    expectedChecksums,
    aiDecisionTrace,
    integrity,
  };

  if (isCanonicalOnlineReplay && rounds && expectedChecksums) {
    for (const round of rounds) {
      const initialState = createReplayInitialState(payload.header, round.seed);
      if (computeStateChecksum(initialState) !== round.initialChecksum) {
        return {
          ok: false,
          error: {
            code: 'invalid_rounds',
            message: `Canonical online replay round ${round.round} initial checksum is inconsistent with its deterministic identity.`,
          },
        };
      }
    }
    const actualChecksums = runReplay(payload).checksums;
    if (findFirstChecksumMismatch(actualChecksums, expectedChecksums)) {
      return {
        ok: false,
        error: {
          code: 'invalid_expected_checksums',
          message: 'Canonical online replay checksums do not match the recorded authoritative inputs.',
        },
      };
    }
  }

  return { ok: true, payload };
}

function createReplayInitialState(header: ReplayHeader, seed = header.seed) {
  const state = createInitialState({
    seed,
    loadout: header.loadout,
    rules: header.rules,
    characterBalanceOverrides: header.characterBalanceOverrides,
  });
  if (header.balanceTuning) {
    state.tuning = { ...header.balanceTuning };
  }
  if (header.startingSituation) {
    applyBalanceScenario(state, header.startingSituation.id);
  }
  return state;
}

function replayFrame(
  payload: ReplayPayload,
  state: ReturnType<typeof createReplayInitialState>,
  frame: number,
  fixedDt: number,
  observer?: SimulationStepObserver,
): number {
  step(state, normaliseFrameInput(payload.inputTimeline[frame]), fixedDt, observer);
  if (payload.header.advanceRngPerFrame) {
    nextDeterministicRandom(state);
  }
  return computeStateChecksum(state);
}

export function runReplay(payload: ReplayPayload): ReplayResult {
  const fixedDt = Number.isFinite(payload.header.fixedDt) && (payload.header.fixedDt as number) > 0
    ? (payload.header.fixedDt as number)
    : DEFAULT_FIXED_DT;
  const checksums: number[] = [];

  if (payload.header.onlineMatch && payload.rounds && payload.rounds.length > 0) {
    for (const round of payload.rounds) {
      if (round.endFrame === undefined) {
        throw new Error('Canonical online replay rounds require an endFrame.');
      }
      const state = createReplayInitialState(payload.header, round.seed);
      for (let frame = round.startFrame; frame <= round.endFrame; frame += 1) {
        checksums.push(replayFrame(payload, state, frame, fixedDt));
      }
    }
    return { checksums };
  }

  const state = createReplayInitialState(payload.header);
  for (let frame = 0; frame < payload.inputTimeline.length; frame += 1) {
    checksums.push(replayFrame(payload, state, frame, fixedDt));
  }

  return { checksums };
}

export function traceReplayActionStarts(payload: ReplayPayload): ReplayActionStartTrace[] {
  const fixedDt = Number.isFinite(payload.header.fixedDt) && (payload.header.fixedDt as number) > 0
    ? (payload.header.fixedDt as number)
    : DEFAULT_FIXED_DT;
  const actionStarts: ReplayActionStartTrace[] = [];

  const replayRange = (
    state: ReturnType<typeof createReplayInitialState>,
    startFrame: number,
    endFrame: number,
  ): void => {
    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      replayFrame(payload, state, frame, fixedDt, {
        onActionStart(event) {
          actionStarts.push({ frame, ...event });
        },
      });
    }
  };

  if (payload.header.onlineMatch && payload.rounds && payload.rounds.length > 0) {
    for (const round of payload.rounds) {
      if (round.endFrame === undefined) {
        throw new Error('Canonical online replay rounds require an endFrame.');
      }
      replayRange(
        createReplayInitialState(payload.header, round.seed),
        round.startFrame,
        round.endFrame,
      );
    }
    return actionStarts;
  }

  replayRange(
    createReplayInitialState(payload.header),
    0,
    payload.inputTimeline.length - 1,
  );
  return actionStarts;
}

export function estimateReplayPayloadBytes(payload: ReplayPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function findFirstChecksumMismatch(actual: number[], expected: number[]): ChecksumMismatch | null {
  const maxLength = Math.max(actual.length, expected.length);
  for (let frame = 0; frame < maxLength; frame += 1) {
    const actualValue = actual[frame];
    const expectedValue = expected[frame];
    if (actualValue !== expectedValue) {
      return {
        frame,
        actual: actualValue ?? -1,
        expected: expectedValue ?? -1,
      };
    }
  }
  return null;
}
