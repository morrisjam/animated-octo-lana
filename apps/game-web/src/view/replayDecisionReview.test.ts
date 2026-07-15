import { describe, expect, test } from 'vitest';
import { createAiController, tickAiController } from '../sim/ai';
import {
  REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
  type ReplayPayload,
} from '../sim/replay';
import { buildReplayReviewData } from '../sim/replayReview';
import { createInitialState } from '../sim/sim';
import {
  buildReplayDecisionFrameReview,
  formatReplayInput,
} from './replayDecisionReview';

function createPayload(): ReplayPayload {
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'test',
      simBuildHash: 'test',
      seed: 17,
      fixedDt: 1 / 60,
    },
    inputTimeline: [
      { p1: { launch: true, moveX: 1 } },
      ...new Array(80).fill(null).map(() => ({})),
    ],
  };
}

describe('replay decision review', () => {
  test('reports an explicit no-trace state for human and legacy replays', () => {
    const review = buildReplayDecisionFrameReview(
      buildReplayReviewData(createPayload()),
      12,
    );

    expect(review.hasTrace).toBe(false);
    expect(review.players.P1.requestedInput).toContain('No traced decision');
  });

  test('correlates a traced decision with requested input, acceptance, and outcome', () => {
    const payload = createPayload();
    const state = createInitialState({ seed: 17 });
    const tick = tickAiController(state, 'P1', createAiController({
      seed: 22,
      profileId: 'veteran',
    }));
    payload.aiDecisionTrace = {
      schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
      events: [{
        sequence: 0,
        frame: 0,
        playerId: 'P1',
        decision: {
          ...tick.decision,
          selectedAction: 'launch',
          selectedReason: 'test_launch',
        },
      }],
    };

    const review = buildReplayDecisionFrameReview(buildReplayReviewData(payload), 40);
    const p1 = review.players.P1;

    expect(review.hasTrace).toBe(true);
    expect(p1.eventFrame).toBe(0);
    expect(p1.ageFrames).toBe(40);
    expect(p1.requestedInput).toBe('Right + Launch');
    expect(p1.acceptedActions).toContain('launch');
    expect(p1.outcome).toMatch(/whiff at F\d+/);
  });

  test('distinguishes a request rejected by the simulator', () => {
    const payload = createPayload();
    const state = createInitialState({ seed: 17 });
    state.players.P1.endLag = 1;
    const tick = tickAiController(state, 'P1', createAiController({ seed: 23 }));
    payload.inputTimeline = [{ p1: { launch: true } }];
    payload.aiDecisionTrace = {
      schemaVersion: REPLAY_AI_DECISION_TRACE_SCHEMA_VERSION,
      events: [{
        sequence: 0,
        frame: 0,
        playerId: 'P1',
        decision: {
          ...tick.decision,
          selectedAction: 'launch',
          selectedReason: 'test_rejected_launch',
        },
      }],
    };
    payload.header.startingSituation = undefined;
    const replayReview = buildReplayReviewData(payload);
    replayReview.frames[0].acceptedActionStarts = [];

    const review = buildReplayDecisionFrameReview(replayReview, 0);

    expect(review.players.P1.outcome).toBe('Requested action was not accepted by the simulator.');
  });

  test('formats movement and action requests for direct balance review', () => {
    expect(formatReplayInput({
      moveX: -1,
      moveY: 1,
      boost: true,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: true,
      breakLaunch: false,
    })).toBe('Up + Left + Boost + Parry');
  });
});
