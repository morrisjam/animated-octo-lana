import { randomUUID } from 'node:crypto';

export type RankedSeasonState = 'scheduled' | 'active' | 'archived';

export interface RankedSeasonView {
  seasonId: string;
  startsAt: string;
  endsAt: string;
  state: RankedSeasonState;
  activatedAt: string | null;
  archivedAt: string | null;
}

export interface RankedSeasonResetResult {
  status: 'archived' | 'no_expired_season' | 'locked';
  archivedSeasonId?: string;
  nextSeasonId?: string;
  snapshotCount?: number;
  masterSnapshotCount?: number;
}

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

interface ReleasableQueryable extends Queryable {
  release: () => void;
}

interface ConnectableQueryable extends Queryable {
  connect: () => Promise<ReleasableQueryable>;
}

const DEFAULT_RANKED_SEASON_DURATION_DAYS = 90;
const SEASON_LOCK_ID = 903_001;

function isConnectableQueryable(db: Queryable): db is ConnectableQueryable {
  return 'connect' in db && typeof (db as Partial<ConnectableQueryable>).connect === 'function';
}

function toIsoString(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  return date.toISOString();
}

function mapSeasonRow(row: Record<string, unknown>): RankedSeasonView {
  return {
    seasonId: String(row.season_id),
    startsAt: toIsoString(row.starts_at),
    endsAt: toIsoString(row.ends_at),
    state: String(row.state) as RankedSeasonState,
    activatedAt: row.activated_at ? toIsoString(row.activated_at) : null,
    archivedAt: row.archived_at ? toIsoString(row.archived_at) : null,
  };
}

function addDays(baseDate: Date, days: number): Date {
  return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function resolveRankedSeasonDurationDays(env: NodeJS.ProcessEnv): number {
  return parsePositiveInteger(env.RANKED_SEASON_DURATION_DAYS) ?? DEFAULT_RANKED_SEASON_DURATION_DAYS;
}

export async function getSeasonById(db: Queryable, seasonId: string): Promise<RankedSeasonView | null> {
  const result = await db.query(
    `
      SELECT season_id, starts_at, ends_at, state, activated_at, archived_at
      FROM ranked_seasons
      WHERE season_id = $1
      LIMIT 1
    `,
    [seasonId],
  );
  if (!result.rowCount) {
    return null;
  }
  return mapSeasonRow(result.rows[0] as Record<string, unknown>);
}

export async function getActiveSeasonAt(db: Queryable, now: Date): Promise<RankedSeasonView | null> {
  const result = await db.query(
    `
      SELECT season_id, starts_at, ends_at, state, activated_at, archived_at
      FROM ranked_seasons
      WHERE state = 'active' AND starts_at <= $1 AND ends_at > $1
      ORDER BY starts_at DESC
      LIMIT 1
    `,
    [now.toISOString()],
  );
  if (!result.rowCount) {
    return null;
  }
  return mapSeasonRow(result.rows[0] as Record<string, unknown>);
}

export async function createActiveSeason(db: Queryable, startAt: Date, durationDays: number): Promise<RankedSeasonView> {
  const seasonId = `season-${startAt.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const endsAt = addDays(startAt, durationDays);
  const result = await db.query(
    `
      INSERT INTO ranked_seasons(season_id, starts_at, ends_at, state, activated_at)
      VALUES ($1, $2, $3, 'active', NOW())
      ON CONFLICT DO NOTHING
      RETURNING season_id, starts_at, ends_at, state, activated_at, archived_at
    `,
    [seasonId, startAt.toISOString(), endsAt.toISOString()],
  );
  if (result.rows.length > 0) {
    return mapSeasonRow(result.rows[0] as Record<string, unknown>);
  }

  const concurrentSeason = await getActiveSeasonAt(db, startAt);
  if (concurrentSeason) {
    return concurrentSeason;
  }
  throw new Error(`Active ranked season creation conflicted without a season at ${startAt.toISOString()}.`);
}

async function createSeasonContainingNow(
  db: Queryable,
  now: Date,
  durationDays: number,
): Promise<RankedSeasonView> {
  let current = await getActiveSeasonAt(db, now);
  if (current) {
    return current;
  }

  while (true) {
    const transition = await archiveOldestExpiredSeason(db, now, durationDays);
    if (transition.status === 'archived') {
      current = await getActiveSeasonAt(db, now);
      if (current) {
        return current;
      }
      continue;
    }

    const latestSeason = await db.query(
      `
        SELECT season_id, starts_at, ends_at, state, activated_at, archived_at
        FROM ranked_seasons
        WHERE ends_at <= $1
        ORDER BY ends_at DESC, starts_at DESC
        LIMIT 1
      `,
      [now.toISOString()],
    );
    const nextStart = latestSeason.rowCount
      ? new Date(toIsoString((latestSeason.rows[0] as Record<string, unknown>).ends_at))
      : now;
    const nextSeason = await createActiveSeason(db, nextStart, durationDays);
    const nextEnd = new Date(nextSeason.endsAt);
    if (nextEnd.getTime() <= nextStart.getTime()) {
      throw new Error(`Ranked season catch-up did not advance beyond ${nextStart.toISOString()}.`);
    }
    if (nextEnd.getTime() > now.getTime()) {
      return nextSeason;
    }
    // The next loop snapshots this elapsed window before advancing again.
  }
}

async function createSeasonWithLock(
  db: Queryable,
  now: Date,
  durationDays: number,
): Promise<RankedSeasonView> {
  if (!isConnectableQueryable(db)) {
    await db.query('SELECT pg_advisory_xact_lock($1)', [SEASON_LOCK_ID]);
    return createSeasonContainingNow(db, now, durationDays);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEASON_LOCK_ID]);
    const season = await createSeasonContainingNow(client, now, durationDays);
    await client.query('COMMIT');
    return season;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the creation error if the connection also failed during rollback.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureActiveSeason(db: Queryable, now: Date, durationDays: number): Promise<RankedSeasonView> {
  const current = await getActiveSeasonAt(db, now);
  if (current) {
    return current;
  }
  return createSeasonWithLock(db, now, durationDays);
}

export async function ensureActiveSeasonForSettlement(
  db: Queryable,
  now: Date,
  durationDays: number,
): Promise<RankedSeasonView> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [SEASON_LOCK_ID]);
  return createSeasonContainingNow(db, now, durationDays);
}

async function archiveOldestExpiredSeason(
  db: Queryable,
  now: Date,
  durationDays: number,
): Promise<RankedSeasonResetResult> {
  const expired = await db.query(
    `
      SELECT season_id, starts_at, ends_at, state, activated_at, archived_at
      FROM ranked_seasons
      WHERE state = 'active' AND ends_at <= $1
      ORDER BY ends_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `,
    [now.toISOString()],
  );
  if (!expired.rowCount) {
    return { status: 'no_expired_season' };
  }

  const expiredSeason = mapSeasonRow(expired.rows[0] as Record<string, unknown>);
  const nextSeason = await createActiveSeason(db, new Date(expiredSeason.endsAt), durationDays);

  const snapshot = await db.query(
    `
      INSERT INTO ranked_season_standings(
        season_id, account_id, region, rank_position,
        rating, matches_played, wins, losses, draws, forfeits,
        league_tier, league_points, mr_points, provisional, captured_at
      )
      SELECT
        $1 AS season_id,
        r.account_id,
        COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') AS region,
        ROW_NUMBER() OVER (
          ORDER BY r.rating DESC, r.wins DESC, r.matches_played DESC, r.account_id ASC
        ) AS rank_position,
        r.rating,
        r.matches_played,
        r.wins,
        r.losses,
        r.draws,
        r.forfeits,
        l.league_tier,
        l.league_points,
        m.mr_points,
        CASE WHEN l.placed_at IS NULL THEN TRUE ELSE FALSE END AS provisional,
        NOW() AS captured_at
      FROM ranked_player_ratings r
      LEFT JOIN profiles p ON p.account_id = r.account_id
      LEFT JOIN ranked_league_progression l ON l.account_id = r.account_id
      LEFT JOIN ranked_master_ratings m ON m.season_id = $1 AND m.account_id = r.account_id
      ON CONFLICT (season_id, account_id) DO UPDATE SET
        region = EXCLUDED.region,
        rank_position = EXCLUDED.rank_position,
        rating = EXCLUDED.rating,
        matches_played = EXCLUDED.matches_played,
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        draws = EXCLUDED.draws,
        forfeits = EXCLUDED.forfeits,
        league_tier = EXCLUDED.league_tier,
        league_points = EXCLUDED.league_points,
        mr_points = EXCLUDED.mr_points,
        provisional = EXCLUDED.provisional,
        captured_at = EXCLUDED.captured_at
    `,
    [expiredSeason.seasonId],
  );
  const snapshotCount = snapshot.rowCount ?? 0;
  const masterSnapshot = await db.query(
    `
      INSERT INTO ranked_master_season_standings(
        season_id, account_id, region, rank_position, mr_points,
        matches_played, wins, losses, draws, forfeits, entered_at, captured_at
      )
      SELECT
        m.season_id,
        m.account_id,
        COALESCE(s.region, 'global') AS region,
        ROW_NUMBER() OVER (
          ORDER BY m.mr_points DESC, m.wins DESC, m.matches_played DESC, m.account_id ASC
        ) AS rank_position,
        m.mr_points,
        m.matches_played,
        m.wins,
        m.losses,
        m.draws,
        m.forfeits,
        m.entered_at,
        NOW() AS captured_at
      FROM ranked_master_ratings m
      LEFT JOIN ranked_season_standings s
        ON s.season_id = m.season_id AND s.account_id = m.account_id
      WHERE m.season_id = $1
      ON CONFLICT (season_id, account_id) DO UPDATE SET
        region = EXCLUDED.region,
        rank_position = EXCLUDED.rank_position,
        mr_points = EXCLUDED.mr_points,
        matches_played = EXCLUDED.matches_played,
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        draws = EXCLUDED.draws,
        forfeits = EXCLUDED.forfeits,
        entered_at = EXCLUDED.entered_at,
        captured_at = EXCLUDED.captured_at
    `,
    [expiredSeason.seasonId],
  );
  const masterSnapshotCount = masterSnapshot.rowCount ?? 0;

  await db.query(
    `
      UPDATE ranked_matches
      SET season_id = $1
      WHERE season_id IS NULL
        AND created_at >= $2
        AND created_at < $3
    `,
    [expiredSeason.seasonId, expiredSeason.startsAt, expiredSeason.endsAt],
  );

  await db.query(
    `
      UPDATE ranked_seasons
      SET state = 'archived', archived_at = NOW()
      WHERE season_id = $1
    `,
    [expiredSeason.seasonId],
  );

  await db.query(
    `
      INSERT INTO ranked_season_reset_runs(
        archived_season_id, next_season_id, snapshot_count, master_snapshot_count, completed_at
      )
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [expiredSeason.seasonId, nextSeason.seasonId, snapshotCount, masterSnapshotCount],
  );

  return {
    status: 'archived',
    archivedSeasonId: expiredSeason.seasonId,
    nextSeasonId: nextSeason.seasonId,
    snapshotCount,
    masterSnapshotCount,
  };
}

export async function runRankedSeasonReset(
  db: Queryable,
  now: Date,
  durationDays: number,
): Promise<RankedSeasonResetResult> {
  const lockResult = await db.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [SEASON_LOCK_ID]);
  const lockRow = lockResult.rows[0] as { locked?: boolean } | undefined;
  if (!lockRow?.locked) {
    return { status: 'locked' };
  }
  return archiveOldestExpiredSeason(db, now, durationDays);
}
