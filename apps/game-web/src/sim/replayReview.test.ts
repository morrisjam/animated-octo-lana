import { describe, expect, test } from 'vitest';
import { buildReplayReviewData } from './replayReview';
import type { ReplayPayload } from './replay';

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

  test('captures launch resolution events with advantage markers', () => {
    const payload = createBasePayload();
    payload.inputTimeline = [
      { p1: { launch: true } },
      ...new Array(80).fill(null).map(() => ({})),
    ];

    const review = buildReplayReviewData(payload);
    const launchEvent = review.frames
      .flatMap((frame) => frame.events)
      .find((event) => event.playerId === 'P1' && event.move === 'launch');

    expect(launchEvent).toBeTruthy();
    expect(launchEvent?.outcome).toBe('whiff');
    expect(typeof launchEvent?.advantageFrames).toBe('number');
  });
});
