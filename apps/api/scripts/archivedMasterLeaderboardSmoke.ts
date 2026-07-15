import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';
import { assertSafeSmokeTarget } from './smokeTargetGuard';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultReportPath = path.resolve(
  currentDir,
  '../build-artifacts/archived-master-leaderboard-smoke/report.json',
);

interface AccountResponse {
  id?: string;
  accessToken?: string;
}

interface LeaderboardEntry {
  rank: number;
  accountId: string;
  displayName: string | null;
  region: string;
  mrPoints: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
}

interface LeaderboardResponse {
  season?: {
    seasonId?: string;
    state?: string;
  };
  filter?: {
    region?: string | null;
    track?: string;
  };
  page?: {
    total?: number;
  };
  items?: LeaderboardEntry[];
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const body = await response.json() as T;
  return { status: response.status, body };
}

async function createAccount(baseUrl: string): Promise<{ accountId: string; accessToken: string }> {
  const response = await requestJson<AccountResponse>(`${baseUrl}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status !== 201 || !response.body.id || !response.body.accessToken) {
    throw new Error(`Could not create the archived-leaderboard smoke account (status=${response.status}).`);
  }
  return {
    accountId: response.body.id,
    accessToken: response.body.accessToken,
  };
}

async function updateProfile(
  baseUrl: string,
  accessToken: string,
  displayName: string,
  region: string,
): Promise<void> {
  const response = await requestJson<{ account_id?: string }>(`${baseUrl}/profile`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ displayName, settings: { region } }),
  });
  if (response.status !== 200 || !response.body.account_id) {
    throw new Error(`Could not update the archived-leaderboard smoke profile (status=${response.status}).`);
  }
}

async function getMasterLeaderboard(
  baseUrl: string,
  accessToken: string,
  seasonId: string,
  region?: string,
): Promise<{ status: number; body: LeaderboardResponse }> {
  const query = new URLSearchParams({
    seasonId,
    track: 'master',
    limit: '25',
    offset: '0',
  });
  if (region) {
    query.set('region', region);
  }
  return requestJson<LeaderboardResponse>(`${baseUrl}/ranked/leaderboard?${query.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

function assertSnapshotCohort(
  response: { status: number; body: LeaderboardResponse },
  expected: {
    accountId: string;
    displayName: string;
    region: string;
    seasonId: string;
  },
): void {
  const entry = response.body.items?.[0];
  if (
    response.status !== 200
    || response.body.season?.seasonId !== expected.seasonId
    || response.body.season.state !== 'archived'
    || response.body.filter?.track !== 'master'
    || response.body.filter.region !== expected.region
    || response.body.page?.total !== 1
    || response.body.items?.length !== 1
    || entry?.rank !== 1
    || entry.accountId !== expected.accountId
    || entry.displayName !== expected.displayName
    || entry.region !== expected.region
    || entry.mrPoints !== 1_777
    || entry.matchesPlayed !== 12
    || entry.wins !== 8
    || entry.losses !== 4
    || entry.draws !== 0
    || entry.forfeits !== 1
  ) {
    throw new Error(`Archived Master snapshot cohort was not preserved: ${JSON.stringify(response)}.`);
  }
}

async function run(): Promise<void> {
  const baseUrl = String(process.env.API_BASE_URL ?? 'http://127.0.0.1:3000')
    .trim()
    .replace(/\/+$/, '');
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the archived Master leaderboard smoke.');
  }
  assertLocalDatabaseTarget(databaseUrl, 'Archived Master leaderboard smoke');
  await assertSafeSmokeTarget(baseUrl, 'Archived Master leaderboard smoke');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname.toLowerCase())) {
    throw new Error('Archived Master leaderboard smoke only permits an exact loopback API target.');
  }

  const reportPath = path.resolve(
    process.env.ARCHIVED_MASTER_LEADERBOARD_SMOKE_REPORT_PATH ?? defaultReportPath,
  );
  const identity = `${process.pid}-${Date.now().toString(36)}`;
  const seasonId = `archived-master-smoke-${identity}-${randomUUID().slice(0, 8)}`;
  const snapshotRegion = `snapshot-${identity}`;
  const movedRegion = `moved-${identity}`;
  const snapshotDisplayName = `Archived Master ${identity}`;
  const movedDisplayName = `Moved Master ${identity}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  let accountId: string | null = null;
  let failure: string | null = null;
  let result: Record<string, unknown> = {};

  try {
    const account = await createAccount(baseUrl);
    accountId = account.accountId;
    await updateProfile(baseUrl, account.accessToken, snapshotDisplayName, snapshotRegion);

    await pool.query(
      `
        INSERT INTO ranked_seasons(
          season_id, starts_at, ends_at, state, activated_at, archived_at
        )
        VALUES ($1, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', 'archived',
          NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')
      `,
      [seasonId],
    );
    await pool.query(
      `
        INSERT INTO ranked_master_season_standings(
          season_id, account_id, region, rank_position, mr_points,
          matches_played, wins, losses, draws, forfeits, entered_at, captured_at
        )
        VALUES ($1, $2, $3, 1, 1777, 12, 8, 4, 0, 1,
          NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')
      `,
      [seasonId, accountId, snapshotRegion],
    );

    await updateProfile(baseUrl, account.accessToken, movedDisplayName, movedRegion);

    const [snapshotCohort, movedCohort, unfiltered] = await Promise.all([
      getMasterLeaderboard(baseUrl, account.accessToken, seasonId, snapshotRegion),
      getMasterLeaderboard(baseUrl, account.accessToken, seasonId, movedRegion),
      getMasterLeaderboard(baseUrl, account.accessToken, seasonId),
    ]);
    assertSnapshotCohort(snapshotCohort, {
      accountId,
      displayName: movedDisplayName,
      region: snapshotRegion,
      seasonId,
    });
    if (
      movedCohort.status !== 200
      || movedCohort.body.filter?.region !== movedRegion
      || movedCohort.body.page?.total !== 0
      || movedCohort.body.items?.length !== 0
    ) {
      throw new Error(`Current profile region leaked into the archived cohort: ${JSON.stringify(movedCohort)}.`);
    }
    const unfilteredEntry = unfiltered.body.items?.[0];
    if (
      unfiltered.status !== 200
      || unfiltered.body.filter?.region !== null
      || unfiltered.body.page?.total !== 1
      || unfiltered.body.items?.length !== 1
      || unfilteredEntry?.region !== snapshotRegion
    ) {
      throw new Error(`Unfiltered archived Master leaderboard lost its snapshot region: ${JSON.stringify(unfiltered)}.`);
    }

    const persistedSnapshot = await pool.query<{ region: string }>(
      `
        SELECT region
        FROM ranked_master_season_standings
        WHERE season_id = $1 AND account_id = $2
      `,
      [seasonId, accountId],
    );
    if (persistedSnapshot.rows[0]?.region !== snapshotRegion) {
      throw new Error('Archived Master region changed in storage after the profile moved.');
    }

    result = {
      seasonId,
      accountId,
      snapshotRegion,
      currentProfileRegion: movedRegion,
      archivedRegionTotal: snapshotCohort.body.page?.total,
      currentRegionTotal: movedCohort.body.page?.total,
      unfilteredTotal: unfiltered.body.page?.total,
      currentDisplayNameVisible: unfilteredEntry?.displayName === movedDisplayName,
      snapshotRegionFrozen: true,
    };
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    try {
      if (accountId) {
        await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
      }
      await pool.query('DELETE FROM ranked_seasons WHERE season_id = $1', [seasonId]);
    } catch (error) {
      const cleanupError = error instanceof Error ? error.message : String(error);
      failure = failure ? `${failure}\nCleanup failure: ${cleanupError}` : `Cleanup failure: ${cleanupError}`;
    }
    await pool.end().catch(() => undefined);
  }

  const report = {
    schemaVersion: 'gw.archived-master-leaderboard-smoke.v1',
    generatedAt: new Date().toISOString(),
    ok: failure === null,
    localOnly: true,
    hostedServicesContacted: false,
    ...result,
    failure,
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (failure) {
    process.exitCode = 1;
  }
}

void run();
