import { describe, expect, it } from 'vitest';
import {
  buildRankedLeaderboardSummary,
  parseRankedLeaderboard,
  type RankedLeaderboardView,
} from './rankedLeaderboardView';

function makePayload() {
  return {
    season: { seasonId: 'season-alpha', state: 'active' },
    filter: { region: null, track: 'rating' },
    page: { limit: 100, offset: 0, total: 2 },
    items: [
      {
        rank: 1,
        accountId: 'account-a',
        displayName: 'Vanguard One',
        region: 'global',
        rating: 1234,
        matchesPlayed: 3,
        wins: 2,
        losses: 1,
        draws: 0,
        forfeits: 0,
        leagueTier: null,
        leaguePoints: null,
        mrPoints: null,
        provisional: true,
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        rank: 2,
        accountId: 'account-b',
        displayName: null,
        region: 'global',
        rating: 1180,
        matchesPlayed: 3,
        wins: 1,
        losses: 2,
        draws: 0,
        forfeits: 1,
        leagueTier: null,
        leaguePoints: null,
        mrPoints: null,
        provisional: true,
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
    ],
  };
}

describe('ranked leaderboard view', () => {
  it('parses the public leaderboard contract', () => {
    const parsed = parseRankedLeaderboard(makePayload());

    expect(parsed).not.toBeNull();
    expect(parsed?.seasonId).toBe('season-alpha');
    expect(parsed?.items.map((item) => item.rank)).toEqual([1, 2]);
    expect(parsed?.items[0]?.displayName).toBe('Vanguard One');
  });

  it('rejects rank strings so the API cannot silently change its numeric contract', () => {
    const payload = makePayload();
    payload.items[0]!.rank = '1' as never;

    expect(parseRankedLeaderboard(payload)).toBeNull();
  });

  it('shows a compact table and keeps the viewer visible beyond the first rows', () => {
    const parsed = parseRankedLeaderboard(makePayload()) as RankedLeaderboardView;
    const summary = buildRankedLeaderboardSummary(parsed, 'account-b', 1);

    expect(summary.viewerRank).toBe(2);
    expect(summary.detail).toContain('#1 Vanguard One | Rating 1234');
    expect(summary.detail).toContain('Pilot account-');
    expect(summary.detail).toContain('< YOU');
  });
});
