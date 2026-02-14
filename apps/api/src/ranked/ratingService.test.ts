import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRankedRatingUpdate } from './ratingService';

const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';

test('applies Elo-like updates consistently for a win', () => {
  const result = applyRankedRatingUpdate({
    participants: [
      { accountId: ACCOUNT_1, side: 'P1', rating: 1200 },
      { accountId: ACCOUNT_2, side: 'P2', rating: 1200 },
    ],
    outcome: 'p1_win',
    winnerAccountId: ACCOUNT_1,
  });

  assert.equal(result.updates[0].delta, 16);
  assert.equal(result.updates[1].delta, -16);
  assert.equal(result.updates[0].postRating, 1216);
  assert.equal(result.updates[1].postRating, 1184);
});

test('handles draw outcomes with symmetric deltas', () => {
  const result = applyRankedRatingUpdate({
    participants: [
      { accountId: ACCOUNT_1, side: 'P1', rating: 1400 },
      { accountId: ACCOUNT_2, side: 'P2', rating: 1200 },
    ],
    outcome: 'draw',
    winnerAccountId: null,
  });

  assert.equal(result.updates[0].result, 'draw');
  assert.equal(result.updates[1].result, 'draw');
  assert.equal(result.updates[0].delta, -8);
  assert.equal(result.updates[1].delta, 8);
});

test('handles forfeit outcomes and marks forfeiting player result', () => {
  const result = applyRankedRatingUpdate({
    participants: [
      { accountId: ACCOUNT_1, side: 'P1', rating: 1300 },
      { accountId: ACCOUNT_2, side: 'P2', rating: 1300 },
    ],
    outcome: 'forfeit',
    winnerAccountId: ACCOUNT_2,
  });

  assert.equal(result.updates[0].result, 'forfeit');
  assert.equal(result.updates[1].result, 'win');
  assert.equal(result.updates[0].delta, -16);
  assert.equal(result.updates[1].delta, 16);
});
