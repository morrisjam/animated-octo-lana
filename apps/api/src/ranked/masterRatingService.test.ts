import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMasterRatingProgression } from './masterRatingService';

test('does not enter master track below entry threshold', () => {
  const result = applyMasterRatingProgression({
    state: {
      mrPoints: null,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      forfeits: 0,
      enteredAt: null,
    },
    postRating: 1790,
    ratingDelta: 12,
    result: 'win',
    occurredAtIso: '2026-02-14T00:00:00.000Z',
    entryRatingThreshold: 1800,
    basePoints: 1500,
    queueWeight: 1,
  });

  assert.equal(result.enteredMasterTrack, false);
  assert.equal(result.post.mrPoints, null);
  assert.equal(result.post.matchesPlayed, 0);
});

test('enters master track at threshold and applies weighted MR delta', () => {
  const result = applyMasterRatingProgression({
    state: {
      mrPoints: null,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      forfeits: 0,
      enteredAt: null,
    },
    postRating: 1800,
    ratingDelta: 16,
    result: 'win',
    occurredAtIso: '2026-02-14T00:01:00.000Z',
    entryRatingThreshold: 1800,
    basePoints: 1500,
    queueWeight: 1.2,
  });

  assert.equal(result.enteredMasterTrack, true);
  assert.equal(result.post.enteredAt, '2026-02-14T00:01:00.000Z');
  assert.equal(result.post.matchesPlayed, 1);
  assert.equal(result.post.wins, 1);
  assert.equal(result.post.mrPoints, 1517);
});

test('applies forfeit penalty while in master track', () => {
  const result = applyMasterRatingProgression({
    state: {
      mrPoints: 1520,
      matchesPlayed: 8,
      wins: 4,
      losses: 4,
      draws: 0,
      forfeits: 0,
      enteredAt: '2026-02-01T00:00:00.000Z',
    },
    postRating: 1810,
    ratingDelta: -20,
    result: 'forfeit',
    occurredAtIso: '2026-02-14T00:02:00.000Z',
    entryRatingThreshold: 1800,
    basePoints: 1500,
    queueWeight: 1,
  });

  assert.equal(result.enteredMasterTrack, false);
  assert.equal(result.post.forfeits, 1);
  assert.equal(result.post.losses, 5);
  assert.equal(result.post.mrPoints, 1500);
});
