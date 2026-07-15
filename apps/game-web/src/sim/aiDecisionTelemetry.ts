import {
  AI_MOVEMENT_INTENTS,
  AI_TACTICAL_ACTIONS,
  type AiDecisionTrace,
  type AiMovementIntent,
  type AiTacticalAction,
} from './ai';
import type { PlayerId, PlayersById } from './types';

export const AI_DECISION_TELEMETRY_SCHEMA_VERSION = 'gw.ai-decision-telemetry.v3';

export interface AiDecisionTelemetryEvent {
  sequence: number;
  frame: number;
  playerId: PlayerId;
  decision: AiDecisionTrace;
}

export interface AiDecisionPlayerTelemetry {
  observedFrames: number;
  movementIntentFrames: Record<AiMovementIntent, number>;
  selectedActionCounts: Record<AiTacticalAction, number>;
  blockedCandidateCounts: Record<AiTacticalAction, Record<string, number>>;
}

export interface AiDecisionTelemetrySummary {
  schemaVersion: typeof AI_DECISION_TELEMETRY_SCHEMA_VERSION;
  framesObserved: number;
  droppedEvents: number;
  players: PlayersById<AiDecisionPlayerTelemetry>;
  latest: PlayersById<AiDecisionTrace | null>;
  events: AiDecisionTelemetryEvent[];
}

function createNumberRecord<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

function createPlayerTelemetry(): AiDecisionPlayerTelemetry {
  return {
    observedFrames: 0,
    movementIntentFrames: createNumberRecord(AI_MOVEMENT_INTENTS),
    selectedActionCounts: createNumberRecord(AI_TACTICAL_ACTIONS),
    blockedCandidateCounts: Object.fromEntries(
      AI_TACTICAL_ACTIONS.map((action) => [action, {}]),
    ) as Record<AiTacticalAction, Record<string, number>>,
  };
}

function cloneDecisionTrace(trace: AiDecisionTrace): AiDecisionTrace {
  return {
    ...trace,
    context: { ...trace.context },
    gates: { ...trace.gates },
    candidates: Object.fromEntries(
      AI_TACTICAL_ACTIONS.map((action) => [action, { ...trace.candidates[action] }]),
    ) as Record<AiTacticalAction, AiDecisionTrace['candidates'][AiTacticalAction]>,
  };
}

function decisionEventSignature(trace: AiDecisionTrace): string {
  const navigationIntent = trace.movementIntent === 'projectile_evade'
    || trace.movementIntent === 'post_event_spacing'
    || trace.movementIntent === 'neutral_hold'
    || trace.movementIntent === 'commitment_observe'
    || trace.movementIntent === 'commitment_press'
    || trace.movementIntent === 'commitment_reset'
    || trace.movementIntent === 'finish_chase'
    || trace.movementIntent === 'recovery_chase'
    || trace.movementIntent === 'depleted_target_pressure'
    || trace.movementIntent === 'low_fuel_retreat'
    || trace.movementIntent === 'projectile_spacing'
    || trace.movementIntent === 'uncontrolled'
    ? trace.movementIntent
    : 'neutral_navigation';
  const controlPosture = !trace.gates.hasControl
    ? 'no_control'
    : trace.gates.neutralHoldActive
      ? 'neutral_hold'
      : trace.gates.postEventSpacingActive
        ? 'post_event_spacing'
        : trace.gates.canChooseTacticalAction
          ? 'choice_available'
          : 'busy';
  return [
    navigationIntent,
    trace.selectedAction ?? 'none',
    trace.selectedAction ? trace.selectedReason : '',
    controlPosture,
  ].join('|');
}

export class AiDecisionTelemetryTracker {
  private readonly maxEvents: number;
  private framesObserved = 0;
  private droppedEvents = 0;
  private nextSequence = 0;
  private players: PlayersById<AiDecisionPlayerTelemetry> = {
    P1: createPlayerTelemetry(),
    P2: createPlayerTelemetry(),
  };
  private latest: PlayersById<AiDecisionTrace | null> = { P1: null, P2: null };
  private previousSignature: PlayersById<string | null> = { P1: null, P2: null };
  private lastEventFrame: PlayersById<number> = { P1: -60, P2: -60 };
  private events: AiDecisionTelemetryEvent[] = [];

  constructor(options: { maxEvents?: number } = {}) {
    this.maxEvents = Math.max(1, Math.floor(options.maxEvents ?? 2_400));
  }

  startRound(): void {
    this.framesObserved = 0;
    this.droppedEvents = 0;
    this.nextSequence = 0;
    this.players = { P1: createPlayerTelemetry(), P2: createPlayerTelemetry() };
    this.latest = { P1: null, P2: null };
    this.previousSignature = { P1: null, P2: null };
    this.lastEventFrame = { P1: -60, P2: -60 };
    this.events = [];
  }

  recordFrame(
    frame: number,
    decisions: Partial<Record<PlayerId, AiDecisionTrace>>,
  ): void {
    const safeFrame = Math.max(0, Math.floor(frame));
    this.framesObserved = Math.max(this.framesObserved, safeFrame + 1);
    for (const playerId of ['P1', 'P2'] as const) {
      const decision = decisions[playerId];
      if (!decision) {
        continue;
      }
      const player = this.players[playerId];
      player.observedFrames += 1;
      player.movementIntentFrames[decision.movementIntent] += 1;
      if (decision.selectedAction) {
        player.selectedActionCounts[decision.selectedAction] += 1;
      }
      for (const action of AI_TACTICAL_ACTIONS) {
        const candidate = decision.candidates[action];
        if (!candidate.eligible) {
          const counts = player.blockedCandidateCounts[action];
          counts[candidate.reason] = (counts[candidate.reason] ?? 0) + 1;
        }
      }

      const cloned = cloneDecisionTrace(decision);
      this.latest[playerId] = cloned;
      const signature = decisionEventSignature(decision);
      const meaningful = decision.selectedAction !== null
        || signature !== this.previousSignature[playerId]
        || safeFrame - this.lastEventFrame[playerId] >= 60;
      this.previousSignature[playerId] = signature;
      if (!meaningful) {
        continue;
      }
      this.lastEventFrame[playerId] = safeFrame;
      this.events.push({
        sequence: this.nextSequence,
        frame: safeFrame,
        playerId,
        decision: cloned,
      });
      this.nextSequence += 1;
      if (this.events.length > this.maxEvents) {
        this.events.shift();
        this.droppedEvents += 1;
      }
    }
  }

  toSummary(): AiDecisionTelemetrySummary {
    return {
      schemaVersion: AI_DECISION_TELEMETRY_SCHEMA_VERSION,
      framesObserved: this.framesObserved,
      droppedEvents: this.droppedEvents,
      players: {
        P1: structuredClone(this.players.P1),
        P2: structuredClone(this.players.P2),
      },
      latest: {
        P1: this.latest.P1 ? cloneDecisionTrace(this.latest.P1) : null,
        P2: this.latest.P2 ? cloneDecisionTrace(this.latest.P2) : null,
      },
      events: this.events.map((event) => ({
        ...event,
        decision: cloneDecisionTrace(event.decision),
      })),
    };
  }
}

export function createAiDecisionTelemetryTracker(
  options?: { maxEvents?: number },
): AiDecisionTelemetryTracker {
  return new AiDecisionTelemetryTracker(options);
}
