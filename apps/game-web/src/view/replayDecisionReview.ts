import { AI_TACTICAL_ACTIONS, type AiTacticalAction } from '../sim/ai';
import type {
  ReplayFrameEvent,
  ReplayReviewData,
  ReplayReviewFrame,
} from '../sim/replayReview';
import type { SimulationAction, SimulationActionStart } from '../sim/sim';
import type { PlayerFrameInput, PlayerId, PlayersById } from '../sim/types';

export interface ReplayDecisionCandidateReview {
  action: AiTacticalAction;
  eligible: boolean;
  weight: number;
  reason: string;
}

export interface ReplayDecisionPlayerReview {
  playerId: PlayerId;
  eventFrame: number | null;
  ageFrames: number | null;
  profileId: string | null;
  controllerRoleId: string | null;
  movementIntent: string | null;
  selectedAction: AiTacticalAction | null;
  selectedReason: string | null;
  requestedInput: string;
  acceptedActions: SimulationAction[];
  outcome: string;
  context: string | null;
  candidates: ReplayDecisionCandidateReview[];
}

export interface ReplayDecisionFrameReview {
  hasTrace: boolean;
  selectedFrame: number;
  players: PlayersById<ReplayDecisionPlayerReview>;
}

const ACTION_TO_EVENT_MOVE: Record<AiTacticalAction, ReplayFrameEvent['move']> = {
  launch: 'launch',
  special: 'special',
  dunk: 'dunk',
  parry: 'parry',
  launch_break: 'break',
};

function findLatestDecisionEvent(
  review: ReplayReviewData,
  frameIndex: number,
  playerId: PlayerId,
): ReplayReviewFrame['aiDecisionEvents'][number] | null {
  for (let frame = frameIndex; frame >= 0; frame -= 1) {
    const event = review.frames[frame]?.aiDecisionEvents.find((entry) => entry.playerId === playerId);
    if (event) {
      return event;
    }
  }
  return null;
}

function findNextAcceptedStart(
  review: ReplayReviewData,
  startFrame: number,
  playerId: PlayerId,
  action: SimulationAction,
): number {
  for (let frame = startFrame + 1; frame < review.frames.length; frame += 1) {
    if (review.frames[frame].acceptedActionStarts.some((entry) => (
      entry.playerId === playerId && entry.action === action
    ))) {
      return frame;
    }
  }
  return review.frames.length;
}

function findActionOutcome(
  review: ReplayReviewData,
  startFrame: number,
  playerId: PlayerId,
  action: AiTacticalAction,
): ReplayFrameEvent | null {
  const endFrame = findNextAcceptedStart(review, startFrame, playerId, action);
  const move = ACTION_TO_EVENT_MOVE[action];
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const outcome = review.frames[frame]?.events.find((entry) => (
      entry.playerId === playerId && entry.move === move
    ));
    if (outcome) {
      return outcome;
    }
  }
  return null;
}

function formatOutcome(
  review: ReplayReviewData,
  eventFrame: number,
  playerId: PlayerId,
  selectedAction: AiTacticalAction | null,
  acceptedStarts: SimulationActionStart[],
): string {
  if (!selectedAction) {
    return 'Movement/posture decision; no tactical resolution expected.';
  }
  const accepted = acceptedStarts.some((entry) => (
    entry.playerId === playerId && entry.action === selectedAction
  ));
  if (!accepted) {
    return 'Requested action was not accepted by the simulator.';
  }
  const outcome = findActionOutcome(review, eventFrame, playerId, selectedAction);
  if (!outcome) {
    return 'Action accepted; no matching resolution event was recorded.';
  }
  const advantage = outcome.advantageFrames === null
    ? ''
    : `, ${outcome.advantageFrames >= 0 ? '+' : ''}${outcome.advantageFrames}f advantage`;
  return `${outcome.outcome} at F${outcome.frame + 1}${advantage}`;
}

function buildPlayerReview(
  review: ReplayReviewData,
  selectedFrame: number,
  playerId: PlayerId,
): ReplayDecisionPlayerReview {
  const event = findLatestDecisionEvent(review, selectedFrame, playerId);
  if (!event) {
    return {
      playerId,
      eventFrame: null,
      ageFrames: null,
      profileId: null,
      controllerRoleId: null,
      movementIntent: null,
      selectedAction: null,
      selectedReason: null,
      requestedInput: 'No traced decision at or before this frame.',
      acceptedActions: [],
      outcome: 'No decision correlation is available.',
      context: null,
      candidates: [],
    };
  }

  const eventFrame = Math.max(0, Math.min(review.frames.length - 1, event.frame));
  const frame = review.frames[eventFrame];
  const input = playerId === 'P1' ? frame.input.p1 : frame.input.p2;
  const acceptedStarts = frame.acceptedActionStarts.filter((entry) => entry.playerId === playerId);
  const decision = event.decision;
  const candidates = AI_TACTICAL_ACTIONS
    .map((action) => ({ action, ...decision.candidates[action] }))
    .sort((first, second) => (
      Number(second.eligible) - Number(first.eligible)
      || second.weight - first.weight
      || first.action.localeCompare(second.action)
    ));

  return {
    playerId,
    eventFrame,
    ageFrames: selectedFrame - eventFrame,
    profileId: decision.profileId,
    controllerRoleId: decision.controllerRoleId,
    movementIntent: decision.movementIntent,
    selectedAction: decision.selectedAction,
    selectedReason: decision.selectedReason,
    requestedInput: formatReplayInput(input),
    acceptedActions: acceptedStarts.map((entry) => entry.action),
    outcome: formatOutcome(
      review,
      eventFrame,
      playerId,
      decision.selectedAction,
      acceptedStarts,
    ),
    context: [
      `distance ${decision.context.distance.toFixed(2)}`,
      `fuel ${Math.round(decision.context.fuelRatio * 100)}%`,
      `opponent ${Math.round(decision.context.opponentFuelRatio * 100)}%`,
      decision.context.incomingProjectileDistance === null
        ? 'projectile none'
        : `projectile ${decision.context.incomingProjectileDistance.toFixed(2)}`,
    ].join(' | '),
    candidates,
  };
}

export function buildReplayDecisionFrameReview(
  review: ReplayReviewData,
  frameIndex: number,
): ReplayDecisionFrameReview {
  const selectedFrame = Math.max(0, Math.min(review.frames.length - 1, Math.floor(frameIndex)));
  const hasTrace = review.frames.some((frame) => frame.aiDecisionEvents.length > 0);
  return {
    hasTrace,
    selectedFrame,
    players: {
      P1: buildPlayerReview(review, selectedFrame, 'P1'),
      P2: buildPlayerReview(review, selectedFrame, 'P2'),
    },
  };
}

export function formatReplayInput(input: PlayerFrameInput): string {
  const parts: string[] = [];
  if (input.moveY > 0.1) {
    parts.push('Up');
  } else if (input.moveY < -0.1) {
    parts.push('Down');
  }
  if (input.moveX > 0.1) {
    parts.push('Right');
  } else if (input.moveX < -0.1) {
    parts.push('Left');
  }
  if (input.boost) {
    parts.push('Boost');
  }
  if (input.superBoost) {
    parts.push('Super Boost');
  }
  if (input.special) {
    parts.push('Special');
  }
  if (input.launch) {
    parts.push('Launch');
  }
  if (input.dunk) {
    parts.push('Dunk');
  }
  if (input.parry) {
    parts.push('Parry');
  }
  if (input.breakLaunch) {
    parts.push('Launch Break');
  }
  return parts.length > 0 ? parts.join(' + ') : 'Neutral';
}
