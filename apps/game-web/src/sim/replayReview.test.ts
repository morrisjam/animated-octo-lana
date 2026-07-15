import { describe, expect, test } from 'vitest';
import { createAiController, tickAiController } from './ai';
import { buildReplayReviewData, buildReplayReviewDataFromRounds } from './replayReview';
import {
  REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
  type ReplayPayload,
} from './replay';
import { createInitialState } from './sim';
import type { FrameInput, PlayerFrameInput } from './types';

function neutralPlayerInput(): PlayerFrameInput {
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

function neutralFrameInput(): FrameInput {
  return { p1: neutralPlayerInput(), p2: neutralPlayerInput() };
}

function createBasePayload(): ReplayPayload {
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
      seed: 123,
      fixedDt: 1 / 60,
    },
    inputTimeline: [
      { p1: { moveX: 1 }, p2: { moveX: -1 } },
      { p1: { moveY: 1, boost: true }, p2: { moveY: -1 } },
      { p1: { special: true }, p2: { parry: true } },
    ],
  };
}

describe('replay review data', () => {
  test('builds frame review data with default round marker', () => {
    const review = buildReplayReviewData(createBasePayload());
    expect(review.totalFrames).toBe(3);
    expect(review.rounds).toHaveLength(1);
    expect(review.rounds[0].label).toBe('Round 1');
    expect(review.frames[0].frameData.P1.launch.phase).toBeDefined();
    expect(review.frames[0].aiDecisionEvents).toEqual([]);
    expect(review.flowReviews).toHaveLength(1);
    expect(review.flowReviews[0].flow.loopStages.map((stage) => stage.id)).toEqual([
      'neutral',
      'commitment',
      'exchange',
      'separation',
      'chase',
      'finish',
    ]);
  });

  test('uses explicit round descriptors when provided', () => {
    const payload = createBasePayload();
    payload.inputTimeline = new Array(20).fill(null).map(() => ({}));
    payload.rounds = [
      { round: 1, startFrame: 0, endFrame: 9 },
      { round: 2, startFrame: 10, endFrame: 19, label: 'Final Round' },
    ];
    const review = buildReplayReviewData(payload);
    expect(review.rounds).toHaveLength(2);
    expect(review.rounds[0].startFrame).toBe(0);
    expect(review.rounds[1].label).toBe('Final Round');
  });

  test('builds a focused flow review without diluting it with the full replay', () => {
    const payload = createBasePayload();
    payload.header.reviewFocus = {
      schemaVersion: 'gw.replay-focus.v1',
      source: 'balance-lab-test',
      label: 'pressure loop',
      focusFrame: 30,
      endFrame: 59,
    };
    payload.inputTimeline = new Array(120).fill(null).map(() => ({}));

    const review = buildReplayReviewData(payload);

    expect(review.flowReviews).toHaveLength(2);
    expect(review.flowReviews[0]).toMatchObject({
      label: 'Focused window: pressure loop',
      startFrame: 30,
      endFrame: 59,
    });
    expect(review.flowReviews[0].telemetry.framesSimulated).toBe(30);
    expect(review.flowReviews[0].telemetry.elapsedSeconds).toBe(0.5);
    expect(review.flowReviews[1].telemetry.framesSimulated).toBe(120);
  });

  test('captures launch resolution events with advantage markers', () => {
    const payload = createBasePayload();
    payload.inputTimeline = [
      { p1: { launch: true } },
      ...new Array(80).fill(null).map(() => ({})),
    ];

    const review = buildReplayReviewData(payload);
    const launchEvents = review.frames
      .flatMap((frame) => frame.events)
      .filter((event) => event.playerId === 'P1' && event.move === 'launch');
    const launchEvent = launchEvents[0];

    expect(launchEvents).toHaveLength(1);
    expect(launchEvent).toBeTruthy();
    expect(launchEvent?.outcome).toBe('whiff');
    expect(typeof launchEvent?.advantageFrames).toBe('number');
  });

  test('emits one special resolution instead of one event per phase boundary', () => {
    const payload = createBasePayload();
    payload.inputTimeline = [
      { p1: { special: true } },
      ...new Array(80).fill(null).map(() => ({})),
    ];

    const events = buildReplayReviewData(payload).frames
      .flatMap((frame) => frame.events)
      .filter((event) => event.playerId === 'P1' && event.move === 'special');

    expect(events).toHaveLength(1);
  });

  test('preserves exact decision, emitted input, accepted start, and outcome correlation', () => {
    const payload = createBasePayload();
    const decisionState = createInitialState({ seed: payload.header.seed });
    const aiTick = tickAiController(decisionState, 'P1', createAiController({
      seed: 303,
      profileId: 'veteran',
    }));
    const decision = {
      ...aiTick.decision,
      selectedAction: 'launch' as const,
      selectedReason: 'weighted_pressure_choice',
      candidates: {
        ...aiTick.decision.candidates,
        launch: {
          eligible: true,
          weight: 1,
          reason: 'weighted_pressure_choice',
        },
      },
    };
    payload.inputTimeline = [
      { p1: { launch: true } },
      ...new Array(80).fill(null).map(() => ({})),
    ];
    payload.aiDecisionTrace = {
      schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
      events: [{
        sequence: 0,
        frame: 0,
        playerId: 'P1',
        decision,
      }],
    };

    const review = buildReplayReviewData(payload);
    const decisionFrame = review.frames[0];
    expect(decisionFrame.aiDecisionEvents).toHaveLength(1);
    expect(decisionFrame.aiDecisionEvents[0].decision.selectedAction).toBe('launch');
    expect(decisionFrame.input.p1.launch).toBe(true);
    expect(decisionFrame.acceptedActionStarts).toContainEqual({
      playerId: 'P1',
      action: 'launch',
    });
    expect(review.frames
      .flatMap((frame) => frame.events)
      .some((event) => event.playerId === 'P1' && event.move === 'launch'))
      .toBe(true);

    decision.context.distance = 999;
    expect(decisionFrame.aiDecisionEvents[0].decision.context.distance).not.toBe(999);
  });

  test('groups exact telemetry contact frames into seekable contact episodes', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -2, y: 0 };
    state.players.P2.pos = { x: 2, y: 0 };
    state.tuning.closeRangeSeparationPadding = 0;
    state.tuning.closeRangeSeparationImpulse = 0;
    const review = buildReplayReviewDataFromRounds([{
      label: 'Contact audit',
      initialState: state,
      inputs: new Array(6).fill(null).map(() => neutralFrameInput()),
    }]);
    const flowReview = review.flowReviews[0];
    const windowFrames = flowReview.contactWindows.reduce(
      (total, window) => total + window.endFrame - window.startFrame + 1,
      0,
    );

    expect(flowReview.contactWindows.length).toBeGreaterThan(0);
    expect(windowFrames).toBe(flowReview.telemetry.spacing.contactFrames);
  });
});
