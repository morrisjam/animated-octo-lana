import {
  AI_DECISION_CANDIDATES,
  AI_DECISION_TRACE_SCHEMA_VERSION,
  tickAiController,
  type AiActionCandidateTrace,
  type AiControllerState,
  type AiDecisionCandidate,
  type AiDecisionTrace,
  type AiTickResult,
  type AiTacticalAction,
} from './ai';
import { ARENA_RADIUS } from './constants';
import { fingerprintDeterministicValue } from './fingerprint';
import type { GameState, PlayerFrameInput, PlayerId, PlayerState, PlayersById } from './types';

export const AI_CONTROLLER_ROLE_SCHEMA_VERSION = 'gw.ai-controller-roles.v1';

export const AI_CONTROLLER_ROLE_IDS = [
  'adaptive',
  'passive',
  'defensive',
  'evasive',
] as const;

export type AiControllerRoleId = (typeof AI_CONTROLLER_ROLE_IDS)[number];

export interface AiControllerRoleDefinition {
  id: AiControllerRoleId;
  label: string;
  description: string;
}

export type AiControllerRoles = PlayersById<AiControllerRoleId>;

export const DEFAULT_AI_CONTROLLER_ROLE_ID: AiControllerRoleId = 'adaptive';

export const AI_CONTROLLER_ROLE_DEFINITIONS: readonly AiControllerRoleDefinition[] = [
  {
    id: 'adaptive',
    label: 'Adaptive',
    description: 'Use the full difficulty profile, movement policy, defensive tools, and character kit.',
  },
  {
    id: 'passive',
    label: 'Passive Dummy',
    description: 'Remain idle and never spend a launch break, exposing raw offense, collision, and finish behavior.',
  },
  {
    id: 'defensive',
    label: 'Defense Dummy',
    description: 'Remain stationary, parry nearby commitments, and immediately launch-break when available.',
  },
  {
    id: 'evasive',
    label: 'Escape Dummy',
    description: 'Retreat or steer inward near the boundary, boost under pressure, and launch-break to test pursuit.',
  },
];

const ROLE_BY_ID = Object.fromEntries(
  AI_CONTROLLER_ROLE_DEFINITIONS.map((role) => [role.id, role]),
) as Record<AiControllerRoleId, AiControllerRoleDefinition>;

export function resolveAiControllerRoleId(value: unknown): AiControllerRoleId {
  return typeof value === 'string' && AI_CONTROLLER_ROLE_IDS.includes(value as AiControllerRoleId)
    ? value as AiControllerRoleId
    : DEFAULT_AI_CONTROLLER_ROLE_ID;
}

export function resolveAiControllerRole(value: unknown): AiControllerRoleDefinition {
  return ROLE_BY_ID[resolveAiControllerRoleId(value)];
}

export function createDefaultAiControllerRoles(): AiControllerRoles {
  return { P1: DEFAULT_AI_CONTROLLER_ROLE_ID, P2: DEFAULT_AI_CONTROLLER_ROLE_ID };
}

export function sanitiseAiControllerRoles(value: unknown): AiControllerRoles {
  const record = typeof value === 'object' && value !== null
    ? value as Partial<Record<PlayerId, unknown>>
    : {};
  return {
    P1: resolveAiControllerRoleId(record.P1),
    P2: resolveAiControllerRoleId(record.P2),
  };
}

export function fingerprintAiControllerRoles(value: unknown): string {
  return fingerprintDeterministicValue({
    schemaVersion: AI_CONTROLLER_ROLE_SCHEMA_VERSION,
    roles: sanitiseAiControllerRoles(value),
  });
}

function neutralInput(): PlayerFrameInput {
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

function hasAttackCommitment(player: PlayerState): boolean {
  return player.launchStartup > 0
    || player.launchActive > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
    || player.specialStartup > 0
    || player.specialActive > 0;
}

function scriptedCandidate(
  selected: boolean,
  selectedReason: string,
  blockedReason: string,
): AiActionCandidateTrace {
  return {
    eligible: selected,
    weight: selected ? 1 : 0,
    reason: selected ? selectedReason : blockedReason,
  };
}

function buildScriptedDecision(
  base: AiDecisionTrace,
  roleId: Exclude<AiControllerRoleId, 'adaptive'>,
  movementIntent: AiDecisionTrace['movementIntent'],
  selectedAction: AiTacticalAction | null,
  selectedReason: string,
  canAct: boolean,
  roleCooldownFrames: number,
): AiDecisionTrace {
  const roleBlocker = `scripted_${roleId}_role`;
  const candidates = Object.fromEntries(AI_DECISION_CANDIDATES.map((action) => [
    action,
    scriptedCandidate(action === selectedAction, selectedReason, roleBlocker),
  ])) as Record<AiDecisionCandidate, AiActionCandidateTrace>;

  return {
    ...base,
    schemaVersion: AI_DECISION_TRACE_SCHEMA_VERSION,
    controllerRoleId: roleId,
    movementIntent,
    selectedAction,
    selectedReason,
    selectionRoll: null,
    gates: {
      ...base.gates,
      canChooseTacticalAction: canAct,
      decisionLockFrames: roleCooldownFrames,
      reactionFramesRemaining: 0,
      neutralHoldActive: false,
      postEventSpacingActive: false,
      deliberateError: false,
    },
    candidates,
  };
}

export function tickAiControllerWithRole(
  state: GameState,
  playerId: PlayerId,
  controller: AiControllerState,
  roleValue: unknown,
): AiTickResult {
  const roleId = resolveAiControllerRoleId(roleValue);
  const base = tickAiController(state, playerId, controller);
  if (roleId === 'adaptive') {
    return {
      ...base,
      decision: { ...base.decision, controllerRoleId: roleId },
    };
  }

  const player = state.players[playerId];
  const opponent = state.players[playerId === 'P1' ? 'P2' : 'P1'];
  const deltaX = player.pos.x - opponent.pos.x;
  const deltaY = player.pos.y - opponent.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const playerHasControl = player.helpless <= 0
    && player.stunned <= 0
    && player.recovering <= 0
    && !state.winner;
  const canAct = playerHasControl && player.endLag <= 0 && !hasAttackCommitment(player);
  const roleCooldownFrames = Math.max(0, controller.decisionLockFrames - 1);
  const input = neutralInput();
  let movementIntent: AiDecisionTrace['movementIntent'] = roleId === 'passive'
    ? 'scripted_passive'
    : roleId === 'defensive'
      ? 'scripted_defend'
      : 'scripted_evade';
  let selectedAction: AiTacticalAction | null = null;
  let selectedReason = `scripted_${roleId}_hold`;
  let nextDecisionLockFrames = roleCooldownFrames;

  if (!playerHasControl) {
    movementIntent = 'uncontrolled';
    selectedReason = 'scripted_wait_for_control';
    if (roleId !== 'passive' && player.helpless > 0 && player.launchBreaks > 0 && roleCooldownFrames <= 0) {
      input.breakLaunch = true;
      selectedAction = 'launch_break';
      selectedReason = `scripted_${roleId}_launch_break`;
      nextDecisionLockFrames = 12;
    }
  } else if (roleId === 'defensive') {
    const opponentCommitted = hasAttackCommitment(opponent);
    if (canAct && roleCooldownFrames <= 0 && opponentCommitted && distance <= 18) {
      input.parry = true;
      selectedAction = 'parry';
      selectedReason = 'scripted_defensive_parry';
      nextDecisionLockFrames = 18;
    } else {
      selectedReason = opponentCommitted ? 'scripted_defensive_out_of_range' : 'scripted_defensive_wait';
    }
  } else if (roleId === 'evasive' && canAct) {
    const centerDistance = Math.hypot(player.pos.x, player.pos.y);
    const useCenterDirection = centerDistance > ARENA_RADIUS * 0.72;
    const directionX = useCenterDirection ? -player.pos.x : deltaX;
    const directionY = useCenterDirection ? -player.pos.y : deltaY;
    const directionLength = Math.hypot(directionX, directionY);
    input.moveX = directionLength > 0.001 ? directionX / directionLength : 0;
    input.moveY = directionLength > 0.001 ? directionY / directionLength : 0;
    if (distance < 18 && player.fuel >= player.maxFuel * 0.2) {
      input.superBoost = true;
      selectedReason = useCenterDirection
        ? 'scripted_escape_super_boost_inward'
        : 'scripted_escape_super_boost';
    } else if (distance < 32) {
      input.boost = true;
      selectedReason = useCenterDirection ? 'scripted_escape_boost_inward' : 'scripted_escape_boost';
    } else {
      selectedReason = useCenterDirection ? 'scripted_escape_steer_inward' : 'scripted_escape_retreat';
    }
  } else if (roleId === 'evasive') {
    selectedReason = 'scripted_escape_wait_for_recovery';
  }

  return {
    input,
    diagnostics: {
      postControlChaseLockPending: false,
      postControlChaseLockActive: false,
      postControlBoostSuppressed: false,
      postControlDashSuppressed: false,
      postControlChaseLockConsumed: false,
      postControlRepeatDashPending: false,
      postControlRepeatDashWeightApplied: false,
      postControlRepeatDashConsumed: false,
      postControlRepeatDashSelected: false,
    },
    decision: buildScriptedDecision(
      base.decision,
      roleId,
      movementIntent,
      selectedAction,
      selectedReason,
      canAct,
      roleCooldownFrames,
    ),
    next: {
      ...base.next,
      decisionLockFrames: nextDecisionLockFrames,
      reactionFramesRemaining: 0,
      maneuverFramesRemaining: 0,
      neutralHoldFramesRemaining: 0,
      neutralHoldPending: false,
      postRecoveryFramesRemaining: 0,
      tacticalRepositionOpportunityFramesRemaining: 0,
      tacticalRepositionFramesRemaining: 0,
      postControlCounterstepOpportunityFramesRemaining: 0,
      postControlCounterstepFramesRemaining: 0,
      postControlCounterstepSeparatedFrames: 0,
      postControlCounterstepActionRequested: false,
      postControlChaseLockPending: false,
      postControlChaseLockFramesRemaining: 0,
      postRecoveryUseSuperBoost: false,
    },
  };
}
