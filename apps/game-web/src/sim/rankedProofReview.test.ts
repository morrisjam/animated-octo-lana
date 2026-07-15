import { describe, expect, test } from 'vitest';
import { CHARACTER_REGISTRY_FINGERPRINT } from './characters';
import {
  getRankedTuningFingerprint,
  RANKED_FIXED_DT,
  RANKED_MATCH_PROOF_SCHEMA_VERSION,
  RANKED_SIMULATOR_VERSION,
  type RankedMatchProof,
} from './rankedProof';
import {
  buildRankedProofReviewData,
  parseStoredRankedProofReview,
  STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION,
} from './rankedProofReview';

function createReviewProof(): RankedMatchProof {
  const tuningFingerprint = getRankedTuningFingerprint('default');
  if (!tuningFingerprint) {
    throw new Error('Default balance profile is unavailable.');
  }
  return {
    schemaVersion: RANKED_MATCH_PROOF_SCHEMA_VERSION,
    simulatorVersion: RANKED_SIMULATOR_VERSION,
    sessionId: '11111111-1111-4111-8111-111111111111',
    matchId: '11111111-1111-4111-8111-111111111111',
    buildVersion: 'review-test',
    rulesetVersion: 'prototype-2026.02',
    balanceProfileId: 'default',
    tuningFingerprint,
    characterRegistryFingerprint: CHARACTER_REGISTRY_FINGERPRINT,
    seed: 42,
    fixedDt: RANKED_FIXED_DT,
    loadout: { P1: 'vanguard', P2: 'duelist' },
    rounds: [
      {
        epoch: 0,
        winner: 'P1',
        finalChecksum: 0,
        inputs: [
          [0, 0, 1 << 3, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
        ],
      },
      {
        epoch: 1,
        winner: 'P2',
        finalChecksum: 0,
        inputs: [
          [0, 0, 0, 0, 0, 1 << 3],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
        ],
      },
    ],
    claimedOutcome: 'p1_win',
  };
}

describe('ranked proof gameplay-flow review', () => {
  test('rebuilds each round independently with accepted-action telemetry', () => {
    const review = buildRankedProofReviewData(createReviewProof());

    expect(review.totalFrames).toBe(6);
    expect(review.rounds.map((round) => round.label)).toEqual([
      'Round 1 - P1 won',
      'Round 2 - P2 won',
    ]);
    expect(review.flowReviews).toHaveLength(2);
    expect(review.flowReviews[0].telemetry.players.P1.launchStarts).toBe(1);
    expect(review.flowReviews[1].telemetry.players.P2.launchStarts).toBe(1);
    expect(review.frames[0].snapshot.gameTime).toBeCloseTo(RANKED_FIXED_DT);
    expect(review.frames[3].snapshot.gameTime).toBeCloseTo(RANKED_FIXED_DT);
    expect(review.flowReviews[0].flow.elapsedSeconds).toBeCloseTo(3 * RANKED_FIXED_DT, 2);
    expect(review.flowReviews[0].flow.players.P1.acceptedTacticalActions).toContain('launch');
  });

  test('rejects a local record without a server proof receipt', async () => {
    const result = await parseStoredRankedProofReview({
      schemaVersion: STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      proof: createReviewProof(),
      verification: { digest: 'not-a-proof-digest' },
    });

    expect(result).toEqual({
      ok: false,
      message: 'The local ranked proof record is incomplete.',
    });
  });
});
