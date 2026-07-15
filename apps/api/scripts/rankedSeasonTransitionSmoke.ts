import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';
import { runRankedSeasonReset } from '../src/ranked/seasonService';

const OPERATION = 'Ranked season transition smoke';
const SEASON_DURATION_DAYS = 1;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, '../../..');
const defaultReportPath = path.resolve(
  currentDir,
  '../build-artifacts/ranked-season-transition-smoke/report.json',
);

loadEnv({ path: path.resolve(repositoryRoot, '.env') });

interface SmokePlayer {
  accountId: string;
  displayName: string;
  snapshotRegion: string;
  movedRegion: string;
  rating: number;
  mrPoints: number;
}

interface SeasonRow {
  season_id: string;
  starts_at: Date;
  ends_at: Date;
  state: string;
  activated_at: Date | null;
  archived_at: Date | null;
}

interface ScenarioResult {
  expiredSeasonId: string;
  nextSeasonId: string;
  resetRunId: string;
  ratingSnapshotCount: number;
  masterSnapshotCount: number;
  pairedFrozenSnapshots: number;
  preexistingSeasonCount: number;
}

interface ResidualCounts {
  accounts: number;
  profiles: number;
  ratings: number;
  master_ratings: number;
  rating_snapshots: number;
  master_snapshots: number;
  reset_runs: number;
  seasons: number;
}

interface FrozenSnapshotRow {
  account_id: string;
  rating_region: string;
  master_region: string;
  live_region: string;
  rating: number;
  mr_points: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function seasonFingerprint(rows: SeasonRow[]): string {
  return JSON.stringify(rows.map((row) => ({
    seasonId: row.season_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    state: row.state,
    activatedAt: row.activated_at?.toISOString() ?? null,
    archivedAt: row.archived_at?.toISOString() ?? null,
  })));
}

async function readSeasonRows(client: PoolClient): Promise<SeasonRow[]> {
  const result = await client.query<SeasonRow>(
    `
      SELECT season_id, starts_at, ends_at, state, activated_at, archived_at
      FROM ranked_seasons
      ORDER BY season_id
    `,
  );
  return result.rows;
}

function chooseIsolatedWindow(preexistingSeasons: SeasonRow[]): {
  startsAt: Date;
  endsAt: Date;
  resetAt: Date;
} {
  const earliestActiveStart = preexistingSeasons
    .filter((season) => season.state === 'active')
    .reduce<number | null>((earliest, season) => {
      const start = season.starts_at.getTime();
      return earliest === null ? start : Math.min(earliest, start);
    }, null);

  if (earliestActiveStart === null) {
    const resetAt = new Date();
    return {
      startsAt: new Date(resetAt.getTime() - 2 * HOUR_MS),
      endsAt: new Date(resetAt.getTime() - HOUR_MS),
      resetAt,
    };
  }

  // The generated next season ends exactly where the earliest existing active
  // window begins, so PostgreSQL's [start, end) exclusion remains untouched.
  const endsAt = new Date(earliestActiveStart - DAY_MS);
  return {
    startsAt: new Date(endsAt.getTime() - HOUR_MS),
    endsAt,
    resetAt: new Date(endsAt.getTime() + HOUR_MS),
  };
}

async function seedPlayers(
  client: PoolClient,
  players: [SmokePlayer, SmokePlayer],
  expiredSeasonId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  await client.query(
    `
      INSERT INTO accounts(id)
      VALUES ($1), ($2)
    `,
    players.map((player) => player.accountId),
  );
  await client.query(
    `
      INSERT INTO profiles(account_id, display_name, settings_json)
      VALUES
        ($1, $2, jsonb_build_object('region', $3::text)),
        ($4, $5, jsonb_build_object('region', $6::text))
    `,
    players.flatMap((player) => [
      player.accountId,
      player.displayName,
      player.snapshotRegion,
    ]),
  );
  await client.query(
    `
      INSERT INTO ranked_player_ratings(
        account_id, rating, matches_played, wins, losses, draws, forfeits
      )
      VALUES
        ($1, $2, 18, 11, 6, 1, 0),
        ($3, $4, 15, 8, 6, 1, 1)
    `,
    [
      players[0].accountId,
      players[0].rating,
      players[1].accountId,
      players[1].rating,
    ],
  );
  await client.query(
    `
      INSERT INTO ranked_seasons(season_id, starts_at, ends_at, state, activated_at)
      VALUES ($1, $2, $3, 'active', $2)
    `,
    [expiredSeasonId, startsAt.toISOString(), endsAt.toISOString()],
  );
  await client.query(
    `
      INSERT INTO ranked_master_ratings(
        season_id, account_id, mr_points,
        matches_played, wins, losses, draws, forfeits, entered_at
      )
      VALUES
        ($1, $2, $3, 12, 8, 3, 1, 0, $4),
        ($1, $5, $6, 10, 6, 3, 1, 1, $4)
    `,
    [
      expiredSeasonId,
      players[0].accountId,
      players[0].mrPoints,
      startsAt.toISOString(),
      players[1].accountId,
      players[1].mrPoints,
    ],
  );
}

async function mutateProfileRegions(
  client: PoolClient,
  players: [SmokePlayer, SmokePlayer],
): Promise<void> {
  await client.query(
    `
      UPDATE profiles AS profile
      SET settings_json = jsonb_set(
        profile.settings_json,
        '{region}',
        to_jsonb(moved.region::text),
        TRUE
      ), updated_at = NOW()
      FROM (
        VALUES ($1::uuid, $2::text), ($3::uuid, $4::text)
      ) AS moved(account_id, region)
      WHERE profile.account_id = moved.account_id
    `,
    players.flatMap((player) => [player.accountId, player.movedRegion]),
  );
}

async function verifyFrozenSnapshots(
  client: PoolClient,
  players: [SmokePlayer, SmokePlayer],
  expiredSeasonId: string,
): Promise<number> {
  const snapshots = await client.query<FrozenSnapshotRow>(
    `
      SELECT
        rating.account_id::text,
        rating.region AS rating_region,
        master.region AS master_region,
        profile.settings_json->>'region' AS live_region,
        rating.rating,
        master.mr_points
      FROM ranked_season_standings AS rating
      INNER JOIN ranked_master_season_standings AS master
        ON master.season_id = rating.season_id
        AND master.account_id = rating.account_id
      INNER JOIN profiles AS profile ON profile.account_id = rating.account_id
      WHERE rating.season_id = $1
        AND rating.account_id = ANY($2::uuid[])
      ORDER BY rating.account_id
    `,
    [expiredSeasonId, players.map((player) => player.accountId)],
  );
  invariant(
    snapshots.rowCount === players.length,
    `Expected ${players.length} paired snapshots, got ${snapshots.rowCount ?? 0}.`,
  );

  const byAccount = new Map<string, FrozenSnapshotRow>(
    snapshots.rows.map((row) => [row.account_id, row]),
  );
  for (const player of players) {
    const snapshot = byAccount.get(player.accountId);
    if (!snapshot) {
      throw new Error(`Snapshots are missing for ${player.displayName}.`);
    }
    invariant(
      snapshot.rating_region === player.snapshotRegion
        && snapshot.master_region === player.snapshotRegion,
      `Rating and Master regions diverged for ${player.displayName}.`,
    );
    invariant(
      snapshot.live_region === player.movedRegion
        && snapshot.live_region !== snapshot.rating_region,
      `Snapshot region followed the live profile mutation for ${player.displayName}.`,
    );
    invariant(
      toNumber(snapshot.rating) === player.rating
        && toNumber(snapshot.mr_points) === player.mrPoints,
      `Rollover changed ranked values for ${player.displayName}.`,
    );
  }
  return snapshots.rowCount ?? 0;
}

async function runRolledBackScenario(
  pool: Pool,
  players: [SmokePlayer, SmokePlayer],
  expiredSeasonId: string,
): Promise<ScenarioResult> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query('LOCK TABLE ranked_seasons IN SHARE ROW EXCLUSIVE MODE');

    const preexistingSeasons = await readSeasonRows(client);
    const preexistingFingerprint = seasonFingerprint(preexistingSeasons);
    const { startsAt, endsAt, resetAt } = chooseIsolatedWindow(preexistingSeasons);
    await seedPlayers(client, players, expiredSeasonId, startsAt, endsAt);

    const reset = await runRankedSeasonReset(client, resetAt, SEASON_DURATION_DAYS);
    invariant(reset.status === 'archived', `Expected an archived rollover, got ${reset.status}.`);
    invariant(
      reset.archivedSeasonId === expiredSeasonId,
      `Rollover archived ${reset.archivedSeasonId ?? 'no season'} instead of the smoke season.`,
    );
    invariant(reset.nextSeasonId, 'Rollover did not return the next season id.');
    invariant(
      (reset.snapshotCount ?? 0) >= players.length,
      `Rating snapshot count ${reset.snapshotCount ?? 0} omitted smoke players.`,
    );
    invariant(
      reset.masterSnapshotCount === players.length,
      `Expected ${players.length} Master snapshots, got ${reset.masterSnapshotCount ?? 0}.`,
    );

    await mutateProfileRegions(client, players);
    const pairedFrozenSnapshots = await verifyFrozenSnapshots(client, players, expiredSeasonId);

    const transitionedSeasons = await client.query<SeasonRow>(
      `
        SELECT season_id, starts_at, ends_at, state, activated_at, archived_at
        FROM ranked_seasons
        WHERE season_id = ANY($1::text[])
        ORDER BY season_id
      `,
      [[expiredSeasonId, reset.nextSeasonId]],
    );
    invariant(transitionedSeasons.rowCount === 2, 'Rollover did not retain both transition seasons.');
    const expired = transitionedSeasons.rows.find((season) => season.season_id === expiredSeasonId);
    const next = transitionedSeasons.rows.find((season) => season.season_id === reset.nextSeasonId);
    invariant(
      expired?.state === 'archived' && expired.archived_at !== null,
      'Expired season was not archived with a timestamp.',
    );
    invariant(
      next?.state === 'active'
        && next.activated_at !== null
        && next.starts_at.getTime() === endsAt.getTime()
        && next.ends_at.getTime() === endsAt.getTime() + DAY_MS
        && next.ends_at.getTime() > resetAt.getTime(),
      'Next season did not continue the expired window through the reset time.',
    );

    const resetRuns = await client.query<{
      run_id: string;
      snapshot_count: number;
      master_snapshot_count: number;
      completed_at: Date | null;
    }>(
      `
        SELECT run_id::text, snapshot_count, master_snapshot_count, completed_at
        FROM ranked_season_reset_runs
        WHERE archived_season_id = $1 AND next_season_id = $2
      `,
      [expiredSeasonId, reset.nextSeasonId],
    );
    invariant(resetRuns.rowCount === 1, 'Rollover did not write exactly one reset-run record.');
    const resetRun = resetRuns.rows[0];
    invariant(resetRun.completed_at !== null, 'Reset-run record was not marked complete.');
    invariant(
      toNumber(resetRun.snapshot_count) === reset.snapshotCount
        && toNumber(resetRun.master_snapshot_count) === reset.masterSnapshotCount,
      'Reset-run totals do not match the rollover result.',
    );

    const unchangedPreexisting = (await readSeasonRows(client)).filter((season) => (
      season.season_id !== expiredSeasonId && season.season_id !== reset.nextSeasonId
    ));
    invariant(
      seasonFingerprint(unchangedPreexisting) === preexistingFingerprint,
      'The smoke changed a pre-existing ranked season.',
    );

    const result: ScenarioResult = {
      expiredSeasonId,
      nextSeasonId: reset.nextSeasonId,
      resetRunId: resetRun.run_id,
      ratingSnapshotCount: reset.snapshotCount ?? 0,
      masterSnapshotCount: reset.masterSnapshotCount ?? 0,
      pairedFrozenSnapshots,
      preexistingSeasonCount: preexistingSeasons.length,
    };
    await client.query('ROLLBACK');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the smoke failure if rollback also loses the connection.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function readResidualCounts(
  pool: Pool,
  players: [SmokePlayer, SmokePlayer],
  expiredSeasonId: string,
  nextSeasonId: string | null,
): Promise<ResidualCounts> {
  const accountIds = players.map((player) => player.accountId);
  const seasonIds = [expiredSeasonId, ...(nextSeasonId ? [nextSeasonId] : [])];
  const result = await pool.query<ResidualCounts>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM accounts WHERE id = ANY($1::uuid[])) AS accounts,
        (SELECT COUNT(*)::int FROM profiles WHERE account_id = ANY($1::uuid[])) AS profiles,
        (SELECT COUNT(*)::int FROM ranked_player_ratings
          WHERE account_id = ANY($1::uuid[])) AS ratings,
        (SELECT COUNT(*)::int FROM ranked_master_ratings
          WHERE account_id = ANY($1::uuid[]) OR season_id = ANY($2::text[])) AS master_ratings,
        (SELECT COUNT(*)::int FROM ranked_season_standings
          WHERE account_id = ANY($1::uuid[]) OR season_id = ANY($2::text[])) AS rating_snapshots,
        (SELECT COUNT(*)::int FROM ranked_master_season_standings
          WHERE account_id = ANY($1::uuid[]) OR season_id = ANY($2::text[])) AS master_snapshots,
        (SELECT COUNT(*)::int FROM ranked_season_reset_runs
          WHERE archived_season_id = $3 OR next_season_id = ANY($2::text[])) AS reset_runs,
        (SELECT COUNT(*)::int FROM ranked_seasons
          WHERE season_id = ANY($2::text[])) AS seasons
    `,
    [accountIds, seasonIds, expiredSeasonId],
  );
  return result.rows[0];
}

function noResidualRows(counts: ResidualCounts): boolean {
  return Object.values(counts).every((count) => toNumber(count) === 0);
}

async function run(): Promise<void> {
  const reportPath = path.resolve(
    process.env.RANKED_SEASON_TRANSITION_SMOKE_REPORT_PATH ?? defaultReportPath,
  );
  const identity = `${process.pid}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const prefix = `ranked-season-transition-smoke-${identity}`;
  const players: [SmokePlayer, SmokePlayer] = [
    {
      accountId: randomUUID(),
      displayName: `${prefix}-alpha`,
      snapshotRegion: `${prefix}-eu-west`,
      movedRegion: `${prefix}-moved-na-east`,
      rating: 2_468,
      mrPoints: 1_777,
    },
    {
      accountId: randomUUID(),
      displayName: `${prefix}-beta`,
      snapshotRegion: `${prefix}-ap-south`,
      movedRegion: `${prefix}-moved-eu-north`,
      rating: 1_357,
      mrPoints: 1_321,
    },
  ];
  const expiredSeasonId = `${prefix}-expired`;
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  let pool: Pool | null = null;
  let scenario: ScenarioResult | null = null;
  let residualCounts: ResidualCounts | null = null;
  let failure: string | null = null;

  try {
    invariant(databaseUrl, 'DATABASE_URL is required for the ranked season transition smoke.');
    assertLocalDatabaseTarget(databaseUrl, OPERATION);
    pool = new Pool({
      connectionString: databaseUrl,
      application_name: `gw-ranked-season-transition-smoke-${process.pid}`,
      max: 2,
    });
    scenario = await runRolledBackScenario(pool, players, expiredSeasonId);
    residualCounts = await readResidualCounts(
      pool,
      players,
      expiredSeasonId,
      scenario.nextSeasonId,
    );
    invariant(
      noResidualRows(residualCounts),
      `Rollback left temporary rows: ${JSON.stringify(residualCounts)}.`,
    );
  } catch (error) {
    failure = errorMessage(error);
    if (pool && !residualCounts) {
      try {
        residualCounts = await readResidualCounts(
          pool,
          players,
          expiredSeasonId,
          scenario?.nextSeasonId ?? null,
        );
      } catch (residualError) {
        failure = `${failure}; residual verification failed: ${errorMessage(residualError)}`;
      }
    }
  } finally {
    if (pool) {
      await pool.end().catch((error) => {
        failure = `${failure ? `${failure}; ` : ''}pool shutdown failed: ${errorMessage(error)}`;
      });
    }
  }

  const report = {
    schemaVersion: 'gw.ranked-season-transition-smoke.v1',
    generatedAt: new Date().toISOString(),
    ok: failure === null,
    localOnly: true,
    hostedServicesContacted: false,
    transactionRolledBack: scenario !== null,
    cleanupVerified: residualCounts !== null && noResidualRows(residualCounts),
    ...(scenario ?? {}),
    failure,
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (failure) {
    process.exitCode = 1;
  }
}

void run();
