export interface RankedLeaderboardEntryView {
  rank: number;
  accountId: string;
  displayName: string | null;
  region: string;
  rating: number | null;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  leagueTier: string | null;
  leaguePoints: number | null;
  mrPoints: number | null;
  provisional: boolean | null;
  updatedAt: string | null;
}

export interface RankedLeaderboardView {
  seasonId: string;
  seasonState: 'scheduled' | 'active' | 'archived';
  region: string | null;
  track: 'rating' | 'master';
  limit: number;
  offset: number;
  total: number;
  items: RankedLeaderboardEntryView[];
}

export interface RankedLeaderboardSummary {
  detail: string;
  viewerRank: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = value.trim();
  return parsed || null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredInteger(value: unknown, minimum: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum
    ? value
    : null;
}

function parseEntry(value: unknown): RankedLeaderboardEntryView | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }
  const rank = requiredInteger(entry.rank, 1);
  const accountId = requiredString(entry.accountId);
  const region = requiredString(entry.region);
  const matchesPlayed = requiredInteger(entry.matchesPlayed, 0);
  const wins = requiredInteger(entry.wins, 0);
  const losses = requiredInteger(entry.losses, 0);
  const draws = requiredInteger(entry.draws, 0);
  const forfeits = requiredInteger(entry.forfeits, 0);
  if (
    rank === null
    || !accountId
    || !region
    || matchesPlayed === null
    || wins === null
    || losses === null
    || draws === null
    || forfeits === null
  ) {
    return null;
  }
  return {
    rank,
    accountId,
    displayName: optionalString(entry.displayName),
    region,
    rating: optionalNumber(entry.rating),
    matchesPlayed,
    wins,
    losses,
    draws,
    forfeits,
    leagueTier: optionalString(entry.leagueTier),
    leaguePoints: optionalNumber(entry.leaguePoints),
    mrPoints: optionalNumber(entry.mrPoints),
    provisional: typeof entry.provisional === 'boolean' ? entry.provisional : null,
    updatedAt: optionalString(entry.updatedAt),
  };
}

export function parseRankedLeaderboard(payload: unknown): RankedLeaderboardView | null {
  const root = asRecord(payload);
  const season = asRecord(root?.season);
  const filter = asRecord(root?.filter);
  const page = asRecord(root?.page);
  if (!root || !season || !filter || !page || !Array.isArray(root.items)) {
    return null;
  }
  const seasonId = requiredString(season.seasonId);
  const seasonState = season.state;
  const track = filter.track;
  const limit = requiredInteger(page.limit, 1);
  const offset = requiredInteger(page.offset, 0);
  const total = requiredInteger(page.total, 0);
  if (
    !seasonId
    || (seasonState !== 'scheduled' && seasonState !== 'active' && seasonState !== 'archived')
    || (track !== 'rating' && track !== 'master')
    || limit === null
    || offset === null
    || total === null
  ) {
    return null;
  }
  const items = root.items.map(parseEntry);
  if (items.some((item) => item === null)) {
    return null;
  }
  return {
    seasonId,
    seasonState,
    region: optionalString(filter.region),
    track,
    limit,
    offset,
    total,
    items: items as RankedLeaderboardEntryView[],
  };
}

function formatEntry(entry: RankedLeaderboardEntryView, viewerAccountId: string): string {
  const playerName = entry.displayName ?? `Pilot ${entry.accountId.slice(0, 8)}`;
  const score = entry.rating !== null ? `Rating ${entry.rating}` : `MR ${entry.mrPoints ?? 'n/a'}`;
  const league = entry.leagueTier ?? (entry.provisional ? 'Placement' : 'Unranked');
  const record = `${entry.wins}W-${entry.losses}L-${entry.draws}D-${entry.forfeits}F`;
  const viewerMarker = entry.accountId === viewerAccountId ? '  < YOU' : '';
  return `#${entry.rank} ${playerName} | ${score} | ${league} | ${record}${viewerMarker}`;
}

export function buildRankedLeaderboardSummary(
  leaderboard: RankedLeaderboardView,
  viewerAccountId: string,
  visibleRows = 10,
): RankedLeaderboardSummary {
  const rowLimit = Math.max(1, Math.floor(visibleRows));
  const visible = leaderboard.items.slice(0, rowLimit);
  const viewer = leaderboard.items.find((entry) => entry.accountId === viewerAccountId) ?? null;
  const lines = [
    `Leaderboard: ${leaderboard.total} players | ${leaderboard.region ?? 'global'} | ${leaderboard.track}`,
    ...visible.map((entry) => formatEntry(entry, viewerAccountId)),
  ];
  if (viewer && !visible.includes(viewer)) {
    lines.push('...', formatEntry(viewer, viewerAccountId));
  }
  if (leaderboard.items.length === 0) {
    lines.push('No ranked players have settled a match yet.');
  }
  return {
    detail: lines.join('\n'),
    viewerRank: viewer?.rank ?? null,
  };
}
