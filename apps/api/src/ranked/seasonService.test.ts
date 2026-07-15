import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureActiveSeason,
  ensureActiveSeasonForSettlement,
  resolveRankedSeasonDurationDays,
  runRankedSeasonReset,
} from './seasonService';

interface StoredSeasonRow {
  season_id: string;
  starts_at: string;
  ends_at: string;
  state: 'scheduled' | 'active' | 'archived';
  activated_at: string | null;
  archived_at: string | null;
}

class MemorySeasonDatabase {
  readonly commands: string[] = [];
  readonly seasons: StoredSeasonRow[];
  insertAttempts = 0;
  successfulInserts = 0;

  private activeReadCount = 0;
  private readonly activeReadWaiters = new Map<number, () => void>();

  constructor(
    seasons: StoredSeasonRow[] = [],
    private readonly synchronizeConcurrentReads = false,
  ) {
    this.seasons = [...seasons];
  }

  private async synchronizeActiveRead(): Promise<void> {
    if (!this.synchronizeConcurrentReads) {
      return;
    }
    this.activeReadCount += 1;
    if (this.activeReadCount > 4) {
      return;
    }

    const phase = Math.ceil(this.activeReadCount / 2);
    if (this.activeReadCount % 2 === 1) {
      await new Promise<void>((resolve) => {
        this.activeReadWaiters.set(phase, resolve);
      });
      return;
    }
    this.activeReadWaiters.get(phase)?.();
    this.activeReadWaiters.delete(phase);
  }

  async query(text: string, values: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number | null }> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.commands.push(normalized);

    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      return { rows: [], rowCount: null };
    }
    if (normalized.includes('pg_advisory_xact_lock')) {
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.includes('FOR UPDATE SKIP LOCKED')) {
      const at = new Date(String(values[0])).getTime();
      const rows = this.seasons
        .filter((season) => season.state === 'active' && new Date(season.ends_at).getTime() <= at)
        .sort((left, right) => new Date(left.ends_at).getTime() - new Date(right.ends_at).getTime())
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (normalized.includes('INSERT INTO ranked_season_standings')) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes('INSERT INTO ranked_master_season_standings')) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('UPDATE ranked_matches')) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("UPDATE ranked_seasons SET state = 'archived', archived_at = NOW()")) {
      const season = this.seasons.find((candidate) => candidate.season_id === String(values[0]));
      if (!season) {
        return { rows: [], rowCount: 0 };
      }
      season.state = 'archived';
      season.archived_at = '2026-04-15T00:00:00.000Z';
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes('INSERT INTO ranked_season_reset_runs')) {
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes('INSERT INTO ranked_seasons')) {
      this.insertAttempts += 1;
      const [seasonIdValue, startsAtValue, endsAtValue] = values;
      const startsAt = String(startsAtValue);
      const endsAt = String(endsAtValue);
      const overlap = this.seasons.some((season) => (
        season.state === 'active'
        && new Date(season.starts_at).getTime() < new Date(endsAt).getTime()
        && new Date(season.ends_at).getTime() > new Date(startsAt).getTime()
      ));
      if (overlap) {
        assert.match(normalized, /ON CONFLICT DO NOTHING/);
        return { rows: [], rowCount: 0 };
      }

      const row: StoredSeasonRow = {
        season_id: String(seasonIdValue),
        starts_at: startsAt,
        ends_at: endsAt,
        state: 'active',
        activated_at: startsAt,
        archived_at: null,
      };
      this.seasons.push(row);
      this.successfulInserts += 1;
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.includes("SET state = 'archived', archived_at = $2")) {
      const [seasonIdValue, archivedAtValue] = values;
      const season = this.seasons.find((candidate) => candidate.season_id === String(seasonIdValue));
      if (!season || season.state !== 'active') {
        return { rows: [], rowCount: 0 };
      }
      season.state = 'archived';
      season.archived_at = String(archivedAtValue);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("SET state = 'archived', archived_at = COALESCE(archived_at, $1)")) {
      const at = new Date(String(values[0])).getTime();
      let updated = 0;
      for (const season of this.seasons) {
        if (season.state === 'active' && new Date(season.ends_at).getTime() <= at) {
          season.state = 'archived';
          season.archived_at ??= String(values[0]);
          updated += 1;
        }
      }
      return { rows: [], rowCount: updated };
    }
    if (normalized.includes("WHERE state = 'active' AND starts_at <= $1 AND ends_at > $1")) {
      const at = new Date(String(values[0])).getTime();
      const rows = this.seasons
        .filter((season) => (
          season.state === 'active'
          && new Date(season.starts_at).getTime() <= at
          && new Date(season.ends_at).getTime() > at
        ))
        .sort((left, right) => new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime())
        .slice(0, 1);
      await this.synchronizeActiveRead();
      return { rows, rowCount: rows.length };
    }
    if (normalized.includes('WHERE ends_at <= $1')) {
      const at = new Date(String(values[0])).getTime();
      const rows = this.seasons
        .filter((season) => new Date(season.ends_at).getTime() <= at)
        .sort((left, right) => (
          new Date(right.ends_at).getTime() - new Date(left.ends_at).getTime()
          || new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime()
        ))
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  }
}

test('resolveRankedSeasonDurationDays falls back to default when env is missing', () => {
  assert.equal(resolveRankedSeasonDurationDays({} as NodeJS.ProcessEnv), 90);
});

test('resolveRankedSeasonDurationDays uses explicit positive integer env value', () => {
  assert.equal(resolveRankedSeasonDurationDays({
    RANKED_SEASON_DURATION_DAYS: '45',
  } as NodeJS.ProcessEnv), 45);
});

test('ensureActiveSeason catches up missed windows until the returned season contains now', async () => {
  const database = new MemorySeasonDatabase([{
    season_id: 'season-2026-01-01-existing',
    starts_at: '2026-01-01T00:00:00.000Z',
    ends_at: '2026-01-31T00:00:00.000Z',
    state: 'active',
    activated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  }]);
  const now = new Date('2026-04-15T00:00:00.000Z');

  const season = await ensureActiveSeason(database, now, 30);

  assert.equal(season.startsAt, '2026-04-01T00:00:00.000Z');
  assert.equal(season.endsAt, '2026-05-01T00:00:00.000Z');
  assert.ok(new Date(season.startsAt).getTime() <= now.getTime());
  assert.ok(new Date(season.endsAt).getTime() > now.getTime());
  assert.equal(database.successfulInserts, 3);
  assert.equal(database.seasons.filter((candidate) => candidate.state === 'active').length, 1);
  assert.equal(database.seasons.filter((candidate) => candidate.state === 'archived').length, 3);
  assert.equal(
    database.commands.filter((command) => command.includes('INSERT INTO ranked_season_standings')).length,
    3,
  );
  assert.equal(
    database.commands.filter((command) => command.includes('INSERT INTO ranked_season_reset_runs')).length,
    3,
  );
});

test('ensureActiveSeason converges concurrent creation attempts on one active window', async () => {
  const database = new MemorySeasonDatabase([], true);
  const now = new Date('2026-07-14T12:00:00.000Z');

  const [first, second] = await Promise.all([
    ensureActiveSeason(database, now, 90),
    ensureActiveSeason(database, now, 90),
  ]);

  assert.equal(first.seasonId, second.seasonId);
  assert.equal(database.insertAttempts, 2);
  assert.equal(database.successfulInserts, 1);
  assert.equal(database.seasons.filter((season) => season.state === 'active').length, 1);
  assert.ok(new Date(first.startsAt).getTime() <= now.getTime());
  assert.ok(new Date(first.endsAt).getTime() > now.getTime());
});

test('ensureActiveSeason holds its advisory lock on a dedicated pool transaction', async () => {
  const database = new MemorySeasonDatabase();
  let releaseCount = 0;
  const client = {
    query: database.query.bind(database),
    release(): void {
      releaseCount += 1;
    },
  };
  const pool = {
    query: database.query.bind(database),
    async connect(): Promise<typeof client> {
      return client;
    },
  };

  await ensureActiveSeason(pool, new Date('2026-07-14T12:00:00.000Z'), 90);

  assert.ok(database.commands.includes('BEGIN'));
  assert.ok(database.commands.includes('SELECT pg_advisory_xact_lock($1)'));
  assert.ok(database.commands.includes('COMMIT'));
  assert.equal(releaseCount, 1);
});

test('ensureActiveSeasonForSettlement locks before resolving an existing season', async () => {
  const database = new MemorySeasonDatabase([{
    season_id: 'season-current',
    starts_at: '2026-07-01T00:00:00.000Z',
    ends_at: '2026-08-01T00:00:00.000Z',
    state: 'active',
    activated_at: '2026-07-01T00:00:00.000Z',
    archived_at: null,
  }]);

  const season = await ensureActiveSeasonForSettlement(
    database,
    new Date('2026-07-15T00:00:00.000Z'),
    30,
  );

  assert.equal(season.seasonId, 'season-current');
  assert.equal(database.commands[0], 'SELECT pg_advisory_xact_lock($1)');
});

test('runRankedSeasonReset returns locked when advisory lock cannot be acquired', async () => {
  const result = await runRankedSeasonReset(
    {
      async query(): Promise<{ rows: unknown[]; rowCount: number | null }> {
        return {
          rows: [{ locked: false }],
          rowCount: 1,
        };
      },
    },
    new Date('2026-02-14T00:00:00.000Z'),
    90,
  );
  assert.deepEqual(result, { status: 'locked' });
});

test('runRankedSeasonReset no-ops when there is no expired active season', async () => {
  let callCount = 0;
  const result = await runRankedSeasonReset(
    {
      async query(): Promise<{ rows: unknown[]; rowCount: number | null }> {
        callCount += 1;
        if (callCount === 1) {
          return {
            rows: [{ locked: true }],
            rowCount: 1,
          };
        }
        return {
          rows: [],
          rowCount: 0,
        };
      },
    },
    new Date('2026-02-14T00:00:00.000Z'),
    90,
  );
  assert.deepEqual(result, { status: 'no_expired_season' });
});

test('runRankedSeasonReset reuses the Rating snapshot region for Master standings', async () => {
  const commands: string[] = [];
  const result = await runRankedSeasonReset(
    {
      async query(text: string): Promise<{ rows: unknown[]; rowCount: number | null }> {
        const normalized = text.replace(/\s+/g, ' ').trim();
        commands.push(normalized);

        if (normalized.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (normalized.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rows: [{
              season_id: 'season-expired',
              starts_at: '2026-01-01T00:00:00.000Z',
              ends_at: '2026-04-01T00:00:00.000Z',
              state: 'active',
              activated_at: '2026-01-01T00:00:00.000Z',
              archived_at: null,
            }],
            rowCount: 1,
          };
        }
        if (normalized.includes('INSERT INTO ranked_seasons')) {
          return {
            rows: [{
              season_id: 'season-next',
              starts_at: '2026-04-01T00:00:00.000Z',
              ends_at: '2026-06-30T00:00:00.000Z',
              state: 'active',
              activated_at: '2026-04-01T00:00:00.000Z',
              archived_at: null,
            }],
            rowCount: 1,
          };
        }
        if (normalized.includes('INSERT INTO ranked_season_standings')) {
          return { rows: [], rowCount: 2 };
        }
        if (normalized.includes('INSERT INTO ranked_master_season_standings')) {
          return { rows: [], rowCount: 1 };
        }
        if (
          normalized.startsWith('UPDATE ranked_matches')
          || normalized.startsWith('UPDATE ranked_seasons')
          || normalized.startsWith('INSERT INTO ranked_season_reset_runs')
        ) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${normalized}`);
      },
    },
    new Date('2026-04-02T00:00:00.000Z'),
    90,
  );

  assert.equal(result.status, 'archived');
  const masterSnapshotSql = commands.find((command) => (
    command.includes('INSERT INTO ranked_master_season_standings')
  ));
  assert.ok(masterSnapshotSql);
  assert.match(masterSnapshotSql, /season_id, account_id, region, rank_position/);
  assert.match(masterSnapshotSql, /COALESCE\(s\.region, 'global'\) AS region/);
  assert.match(masterSnapshotSql, /LEFT JOIN ranked_season_standings s/);
  assert.match(masterSnapshotSql, /s\.season_id = m\.season_id AND s\.account_id = m\.account_id/);
  assert.match(masterSnapshotSql, /region = EXCLUDED\.region/);
});
