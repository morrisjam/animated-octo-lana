import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLeagueProgression, leagueTierFromRating } from './leagueService';

test('leagueTierFromRating maps ratings into Iron->Platinum tiers', () => {
  assert.equal(leagueTierFromRating(1100), 'Iron');
  assert.equal(leagueTierFromRating(1300), 'Bronze');
  assert.equal(leagueTierFromRating(1500), 'Silver');
  assert.equal(leagueTierFromRating(1700), 'Gold');
  assert.equal(leagueTierFromRating(1900), 'Platinum');
});

test('placement flow assigns league after calibration matches complete', () => {
  const beforePlacement = applyLeagueProgression({
    state: {
      leagueTier: null,
      leaguePoints: null,
      calibrationMatchesRequired: 5,
      calibrationMatchesPlayed: 3,
      placedAt: null,
    },
    postRating: 1460,
    ratingDelta: 12,
    occurredAtIso: '2026-02-14T00:00:00.000Z',
  });
  assert.equal(beforePlacement.post.leagueTier, null);
  assert.equal(beforePlacement.post.leaguePoints, null);
  assert.equal(beforePlacement.post.calibrationMatchesPlayed, 4);
  assert.equal(beforePlacement.provisional, true);

  const finalPlacement = applyLeagueProgression({
    state: beforePlacement.post,
    postRating: 1472,
    ratingDelta: 12,
    occurredAtIso: '2026-02-14T00:10:00.000Z',
  });
  assert.equal(finalPlacement.post.leagueTier, 'Silver');
  assert.equal(finalPlacement.post.leaguePoints, 72);
  assert.equal(finalPlacement.post.placedAt, '2026-02-14T00:10:00.000Z');
});

test('league points promote and demote across tier thresholds', () => {
  const promoted = applyLeagueProgression({
    state: {
      leagueTier: 'Bronze',
      leaguePoints: 95,
      calibrationMatchesRequired: 5,
      calibrationMatchesPlayed: 5,
      placedAt: '2026-02-01T00:00:00.000Z',
    },
    postRating: 1330,
    ratingDelta: 12,
    occurredAtIso: '2026-02-14T01:00:00.000Z',
  });
  assert.equal(promoted.post.leagueTier, 'Silver');
  assert.equal(promoted.post.leaguePoints, 7);
  assert.equal(promoted.provisional, false);

  const demoted = applyLeagueProgression({
    state: {
      leagueTier: 'Silver',
      leaguePoints: 3,
      calibrationMatchesRequired: 5,
      calibrationMatchesPlayed: 5,
      placedAt: '2026-02-01T00:00:00.000Z',
    },
    postRating: 1380,
    ratingDelta: -10,
    occurredAtIso: '2026-02-14T01:10:00.000Z',
  });
  assert.equal(demoted.post.leagueTier, 'Bronze');
  assert.equal(demoted.post.leaguePoints, 93);
});
