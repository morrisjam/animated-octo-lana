const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_REPLAY_SEARCH_LIMIT = 20;
export const MAX_REPLAY_SEARCH_LIMIT = 50;

export interface ReplayMatchupFilter {
  playerCharacterId: string;
  opponentCharacterId: string;
}

export interface ReplaySearchFilters {
  playerId: string;
  opponentId: string | null;
  characterId: string | null;
  matchup: ReplayMatchupFilter | null;
  queueType: string | null;
  patchVersion: string | null;
  from: string | null;
  to: string | null;
  limit: number;
}

interface ReplaySearchCursorPayload {
  startedAt: string;
  replayId: string;
  filters: {
    playerId: string;
    opponentId: string | null;
    characterId: string | null;
    matchup: ReplayMatchupFilter | null;
    queueType: string | null;
    patchVersion: string | null;
    from: string | null;
    to: string | null;
  };
}

export interface ReplaySearchCursor {
  startedAt: string;
  replayId: string;
  encoded: string;
}

export interface ReplaySearchParams {
  values: unknown[];
  text: string;
}

export interface ReplaySearchQueryBuildResult {
  query: ReplaySearchParams;
  cursor: ReplaySearchCursor | null;
}

export interface ReplaySearchQueryInput {
  playerId?: unknown;
  opponentId?: unknown;
  character?: unknown;
  matchup?: unknown;
  queueType?: unknown;
  patchVersion?: unknown;
  from?: unknown;
  to?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface ReplaySearchParseResultOk {
  ok: true;
  filters: ReplaySearchFilters;
  cursor: ReplaySearchCursor | null;
}

export interface ReplaySearchParseResultError {
  ok: false;
  error: string;
  statusCode: 400 | 403;
}

export type ReplaySearchParseResult = ReplaySearchParseResultOk | ReplaySearchParseResultError;

export function parseReplaySearchQuery(
  raw: ReplaySearchQueryInput,
  authenticatedAccountId: string,
): ReplaySearchParseResult {
  const rawPlayerIdProvided = raw.playerId !== undefined && raw.playerId !== null && raw.playerId !== '';
  const parsedPlayerId = normaliseUuid(raw.playerId);
  if (rawPlayerIdProvided && !parsedPlayerId) {
    return {
      ok: false,
      error: 'playerId must be a UUID when provided.',
      statusCode: 400,
    };
  }
  const playerId = parsedPlayerId ?? authenticatedAccountId;
  if (playerId !== authenticatedAccountId) {
    return {
      ok: false,
      error: 'Replay search is restricted to the authenticated player history.',
      statusCode: 403,
    };
  }

  const opponentId = normaliseUuid(raw.opponentId);
  if (raw.opponentId !== undefined && !opponentId) {
    return {
      ok: false,
      error: 'opponentId must be a UUID when provided.',
      statusCode: 400,
    };
  }

  const characterId = normaliseText(raw.character);
  if (raw.character !== undefined && !characterId) {
    return {
      ok: false,
      error: 'character must be a non-empty string when provided.',
      statusCode: 400,
    };
  }

  const matchup = parseMatchup(raw.matchup);
  if (raw.matchup !== undefined && !matchup) {
    return {
      ok: false,
      error: 'matchup must be in "<playerCharacterId>:<opponentCharacterId>" format.',
      statusCode: 400,
    };
  }

  const queueType = normaliseText(raw.queueType)?.toLowerCase() ?? null;
  const patchVersion = normaliseText(raw.patchVersion);

  const fromIso = parseIsoDateToCanonical(raw.from);
  if (raw.from !== undefined && !fromIso) {
    return { ok: false, error: 'from must be a valid ISO timestamp.', statusCode: 400 };
  }
  const toIso = parseIsoDateToCanonical(raw.to);
  if (raw.to !== undefined && !toIso) {
    return { ok: false, error: 'to must be a valid ISO timestamp.', statusCode: 400 };
  }
  if (fromIso && toIso && new Date(fromIso).getTime() > new Date(toIso).getTime()) {
    return { ok: false, error: 'from must be earlier than or equal to to.', statusCode: 400 };
  }

  const limit = parseLimit(raw.limit);
  if (!limit) {
    return {
      ok: false,
      error: `limit must be a positive integer between 1 and ${MAX_REPLAY_SEARCH_LIMIT}.`,
      statusCode: 400,
    };
  }

  const filters: ReplaySearchFilters = {
    playerId,
    opponentId,
    characterId,
    matchup,
    queueType,
    patchVersion,
    from: fromIso,
    to: toIso,
    limit,
  };

  const cursor = parseCursor(raw.cursor, filters);
  if (raw.cursor !== undefined && raw.cursor !== null && cursor === null) {
    return {
      ok: false,
      error: 'cursor is invalid for this replay search filter set.',
      statusCode: 400,
    };
  }

  return {
    ok: true,
    filters,
    cursor,
  };
}

export function buildReplaySearchQuery(
  filters: ReplaySearchFilters,
  cursor: ReplaySearchCursor | null,
): ReplaySearchQueryBuildResult {
  const values: unknown[] = [];
  const where: string[] = ['r.deleted_at IS NULL'];

  values.push(filters.playerId);
  where.push(`rp_self.account_id = $${values.length}::uuid`);

  if (filters.opponentId) {
    values.push(filters.opponentId);
    where.push(`rp_opp.account_id = $${values.length}::uuid`);
  }
  if (filters.characterId) {
    values.push(filters.characterId);
    where.push(`rp_self.character_id = $${values.length}`);
  }
  if (filters.matchup) {
    values.push(filters.matchup.playerCharacterId);
    where.push(`rp_self.character_id = $${values.length}`);
    values.push(filters.matchup.opponentCharacterId);
    where.push(`rp_opp.character_id = $${values.length}`);
  }
  if (filters.queueType) {
    values.push(filters.queueType);
    where.push(`r.queue_type = $${values.length}`);
  }
  if (filters.patchVersion) {
    values.push(filters.patchVersion);
    where.push(`r.patch_version = $${values.length}`);
  }
  if (filters.from) {
    values.push(filters.from);
    where.push(`r.started_at >= $${values.length}::timestamptz`);
  }
  if (filters.to) {
    values.push(filters.to);
    where.push(`r.started_at <= $${values.length}::timestamptz`);
  }
  if (cursor) {
    values.push(cursor.startedAt);
    values.push(cursor.replayId);
    where.push(`(r.started_at, r.replay_id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }

  values.push(filters.limit + 1);
  const limitParam = `$${values.length}`;

  const text = `
    SELECT
      r.replay_id,
      r.match_id,
      r.queue_type,
      r.match_type,
      r.region,
      r.patch_version,
      r.ruleset_version,
      r.payload_version,
      r.outcome,
      r.winner_account_id,
      r.started_at,
      r.ended_at,
      r.duration_seconds,
      rp_self.account_id AS player_account_id,
      rp_self.side AS player_side,
      rp_self.character_id AS player_character_id,
      rp_self.result AS player_result,
      rp_opp.account_id AS opponent_account_id,
      rp_opp.side AS opponent_side,
      rp_opp.character_id AS opponent_character_id,
      rp_opp.result AS opponent_result
    FROM replays r
    JOIN replay_participants rp_self
      ON rp_self.replay_id = r.replay_id
    JOIN replay_participants rp_opp
      ON rp_opp.replay_id = r.replay_id
      AND rp_opp.account_id <> rp_self.account_id
    WHERE ${where.join('\n      AND ')}
    ORDER BY r.started_at DESC, r.replay_id DESC
    LIMIT ${limitParam}
  `;

  return {
    query: { values, text },
    cursor,
  };
}

export function encodeReplaySearchCursor(
  filters: ReplaySearchFilters,
  startedAtIso: string,
  replayId: string,
): string {
  const payload: ReplaySearchCursorPayload = {
    startedAt: startedAtIso,
    replayId,
    filters: {
      playerId: filters.playerId,
      opponentId: filters.opponentId,
      characterId: filters.characterId,
      matchup: filters.matchup,
      queueType: filters.queueType,
      patchVersion: filters.patchVersion,
      from: filters.from,
      to: filters.to,
    },
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parseCursor(rawCursor: unknown, filters: ReplaySearchFilters): ReplaySearchCursor | null {
  if (rawCursor === undefined || rawCursor === null || rawCursor === '') {
    return null;
  }
  if (typeof rawCursor !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    const decoded = Buffer.from(rawCursor, 'base64url').toString('utf8');
    parsed = JSON.parse(decoded) as ReplaySearchCursorPayload;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const payload = parsed as ReplaySearchCursorPayload;
  if (!isUuid(payload.replayId)) {
    return null;
  }
  const startedAt = parseIsoDateToCanonical(payload.startedAt);
  if (!startedAt) {
    return null;
  }
  if (!payload.filters || typeof payload.filters !== 'object') {
    return null;
  }
  const sameFilters = JSON.stringify(payload.filters) === JSON.stringify({
    playerId: filters.playerId,
    opponentId: filters.opponentId,
    characterId: filters.characterId,
    matchup: filters.matchup,
    queueType: filters.queueType,
    patchVersion: filters.patchVersion,
    from: filters.from,
    to: filters.to,
  });
  if (!sameFilters) {
    return null;
  }
  return {
    startedAt,
    replayId: payload.replayId,
    encoded: rawCursor,
  };
}

function parseMatchup(rawValue: unknown): ReplayMatchupFilter | null {
  const value = normaliseText(rawValue);
  if (!value) {
    return null;
  }
  const separator = value.includes(':') ? ':' : (value.includes('-vs-') ? '-vs-' : null);
  if (!separator) {
    return null;
  }
  const [playerCharacterIdRaw, opponentCharacterIdRaw] = value.split(separator);
  const playerCharacterId = playerCharacterIdRaw?.trim();
  const opponentCharacterId = opponentCharacterIdRaw?.trim();
  if (!playerCharacterId || !opponentCharacterId) {
    return null;
  }
  return {
    playerCharacterId,
    opponentCharacterId,
  };
}

function parseLimit(rawLimit: unknown): number | null {
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return DEFAULT_REPLAY_SEARCH_LIMIT;
  }
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 1 || parsed > MAX_REPLAY_SEARCH_LIMIT) {
    return null;
  }
  return parsed;
}

function parseIsoDateToCanonical(rawValue: unknown): string | null {
  const value = normaliseText(rawValue);
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normaliseUuid(rawValue: unknown): string | null {
  const value = normaliseText(rawValue);
  if (!value) {
    return null;
  }
  return isUuid(value) ? value : null;
}

function normaliseText(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return UUID_REGEX.test(value);
}
