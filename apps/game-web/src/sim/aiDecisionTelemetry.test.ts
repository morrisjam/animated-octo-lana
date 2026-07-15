import { describe, expect, test } from 'vitest';
import {
  AI_DECISION_TRACE_SCHEMA_VERSION,
  AI_TACTICAL_ACTIONS,
  type AiDecisionTrace,
} from './ai';
import {
  AI_DECISION_TELEMETRY_SCHEMA_VERSION,
  createAiDecisionTelemetryTracker,
} from './aiDecisionTelemetry';

function createDecision(overrides: Partial<AiDecisionTrace> = {}): AiDecisionTrace {
  const candidates = Object.fromEntries(AI_TACTICAL_ACTIONS.map((action) => [action, {
    eligible: false,
    weight: 0,
    reason: 'reaction_delay',
  }])) as AiDecisionTrace['candidates'];
  return {
    schemaVersion: AI_DECISION_TRACE_SCHEMA_VERSION,
    playerId: 'P1',
    profileId: 'veteran',
    controllerRoleId: 'adaptive',
    gameTimeSeconds: 0,
    movementIntent: 'long_range_approach',
    selectedAction: null,
    selectedReason: 'reaction_delay',
    selectionRoll: null,
    mistakeRoll: 0.5,
    context: {
      distance: 80,
      fuelRatio: 1,
      opponentFuelRatio: 1,
      incomingProjectileDistance: null,
      finishOpportunity: false,
    },
    gates: {
      hasControl: true,
      canChooseTacticalAction: true,
      decisionLockFrames: 0,
      reactionFramesRemaining: 4,
      neutralHoldActive: false,
      postEventSpacingActive: false,
      deliberateError: false,
    },
    candidates,
    ...overrides,
  };
}

describe('AI decision telemetry', () => {
  test('stores change-only events while retaining per-frame intent and blocker counts', () => {
    const tracker = createAiDecisionTelemetryTracker();
    const decision = createDecision();
    tracker.recordFrame(0, { P1: decision });
    tracker.recordFrame(1, { P1: decision });
    tracker.recordFrame(60, { P1: decision });
    tracker.recordFrame(61, {
      P1: createDecision({
        selectedAction: 'launch',
        selectedReason: 'weighted_pressure_choice',
      }),
    });

    const summary = tracker.toSummary();
    expect(summary.schemaVersion).toBe(AI_DECISION_TELEMETRY_SCHEMA_VERSION);
    expect(summary.framesObserved).toBe(62);
    expect(summary.players.P1.observedFrames).toBe(4);
    expect(summary.players.P1.movementIntentFrames.long_range_approach).toBe(4);
    expect(summary.players.P1.selectedActionCounts.launch).toBe(1);
    expect(summary.players.P1.blockedCandidateCounts.special.reaction_delay).toBe(4);
    expect(summary.events.map((event) => event.frame)).toEqual([0, 60, 61]);
    expect(summary.latest.P1?.selectedAction).toBe('launch');
  });

  test('caps retained events deterministically and reports dropped history', () => {
    const tracker = createAiDecisionTelemetryTracker({ maxEvents: 2 });
    for (let frame = 0; frame < 4; frame += 1) {
      tracker.recordFrame(frame, {
        P1: createDecision({
          movementIntent: frame % 2 === 0 ? 'projectile_evade' : 'neutral_hold',
        }),
      });
    }

    const summary = tracker.toSummary();
    expect(summary.droppedEvents).toBe(2);
    expect(summary.events.map((event) => event.frame)).toEqual([2, 3]);
    expect(summary.events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  test('records each commitment phase as a distinct navigation event', () => {
    const tracker = createAiDecisionTelemetryTracker();
    tracker.recordFrame(0, { P1: createDecision({ movementIntent: 'commitment_observe' }) });
    tracker.recordFrame(1, { P1: createDecision({ movementIntent: 'commitment_press' }) });
    tracker.recordFrame(2, { P1: createDecision({ movementIntent: 'commitment_reset' }) });

    const summary = tracker.toSummary();
    expect(summary.players.P1.movementIntentFrames).toMatchObject({
      commitment_observe: 1,
      commitment_press: 1,
      commitment_reset: 1,
    });
    expect(summary.events.map((event) => event.decision.movementIntent)).toEqual([
      'commitment_observe',
      'commitment_press',
      'commitment_reset',
    ]);
  });

  test('startRound clears prior decisions and returns detached snapshots', () => {
    const tracker = createAiDecisionTelemetryTracker();
    tracker.recordFrame(0, { P1: createDecision() });
    const first = tracker.toSummary();
    first.players.P1.movementIntentFrames.long_range_approach = 999;
    expect(tracker.toSummary().players.P1.movementIntentFrames.long_range_approach).toBe(1);

    tracker.startRound();
    expect(tracker.toSummary()).toMatchObject({
      framesObserved: 0,
      droppedEvents: 0,
      events: [],
      latest: { P1: null, P2: null },
    });
  });
});
