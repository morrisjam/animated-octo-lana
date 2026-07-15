import { describe, expect, test } from 'vitest';
import type { BalanceLabExchangeReview } from '../sim/balanceLab';
import type { ReplayPayload } from '../sim/replay';
import { buildReplayReviewData } from '../sim/replayReview';
import { renderReplayFlowReview, resolveReplayReentrySeekFrame } from './replayViewer';

function createExchange(
  overrides: Partial<BalanceLabExchangeReview> = {},
): BalanceLabExchangeReview {
  return {
    exchangeNumber: 1,
    startSeconds: 1,
    endSeconds: 4,
    pressureSeconds: 3,
    openerActorId: 'P1',
    openerAction: 'launch',
    outcomes: [],
    exitBand: 'mid',
    neutralWindowSeconds: 0.5,
    firstNeutralActionActorId: null,
    firstNeutralAction: null,
    firstNeutralActionDelaySeconds: null,
    carriedReentryCause: 'held_approach',
    reentryContext: null,
    createdReset: false,
    resolved: true,
    status: 'brief_exit',
    ...overrides,
  };
}

describe('replay re-entry review', () => {
  test('resolves the exact global frame where pressure resumes', () => {
    expect(resolveReplayReentrySeekFrame(
      { startFrame: 300, endFrame: 899 },
      createExchange(),
      1 / 60,
    )).toBe(570);
  });

  test('clamps to the round and ignores non-re-entry exchanges', () => {
    expect(resolveReplayReentrySeekFrame(
      { startFrame: 300, endFrame: 500 },
      createExchange(),
      1 / 60,
    )).toBe(500);
    expect(resolveReplayReentrySeekFrame(
      { startFrame: 300, endFrame: 899 },
      createExchange({ status: 'reset' }),
      1 / 60,
    )).toBeNull();
    expect(resolveReplayReentrySeekFrame(
      { startFrame: 300, endFrame: 899 },
      createExchange(),
      0,
    )).toBeNull();
  });
});

describe('replay fight story', () => {
  test('leads with the same deterministic loop finding and a read-only controlled check', () => {
    const payload: ReplayPayload = {
      header: {
        payloadVersion: 1,
        rulesetVersion: 'test-rules',
        simBuildHash: 'test-build',
        seed: 441,
        fixedDt: 1 / 60,
      },
      inputTimeline: new Array(3).fill(null).map(() => ({})),
    };
    const review = buildReplayReviewData(payload);
    const flowReview = review.flowReviews[0];
    flowReview.flow.elapsedSeconds = 30;
    flowReview.flow.loopStages = flowReview.flow.loopStages.map((stage) => ({
      ...stage,
      status: stage.id === 'chase' ? 'blocked' : 'observed',
      detail: stage.id === 'chase'
        ? 'The defender never earned a visible decision after control returned.'
        : stage.detail,
    }));

    const html = renderReplayFlowReview(flowReview, review.fixedDt);

    expect(html).toContain('class="balance-fight-story replay-fight-story blocked"');
    expect(html).toContain('data-story-status="blocked"');
    expect(html).toContain('data-focus-stage="chase"');
    expect(html).toContain('<strong>Chase is blocked</strong>');
    expect(html).toContain('The defender never earned a visible decision after control returned.');
    expect(html).toContain('Suggested controlled check: Post-control agency');
    expect(html).toContain('This replay does not stage or change a rule.');
    expect(html).toContain('not a class win-rate verdict');
  });
});
