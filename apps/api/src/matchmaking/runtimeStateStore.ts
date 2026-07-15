import type { MatchmakingQueueSnapshot } from './queueService';

interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface MatchmakingRuntimeStateDatabase {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
}

const DEFAULT_SNAPSHOT_KEY = 'primary';
const SNAPSHOT_VERSION = 1;
const SNAPSHOT_KEY_PATTERN = /^[a-zA-Z0-9._:-]{1,96}$/;

export interface MatchmakingRuntimeStateStoreOptions {
  snapshotKey?: string;
}

export class MatchmakingRuntimeLeaseFencedError extends Error {
  public constructor() {
    super('Matchmaking runtime snapshot write was rejected because its lease was superseded.');
    this.name = 'MatchmakingRuntimeLeaseFencedError';
  }
}

function canonicalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeSnapshotValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeSnapshotValue(entry)]),
    );
  }
  return value;
}

export function fingerprintMatchmakingRuntimeSnapshot(snapshot: MatchmakingQueueSnapshot): string {
  const { capturedAtMs: _capturedAtMs, ...durableState } = snapshot;
  return JSON.stringify(canonicalizeSnapshotValue(durableState));
}

export function resolveMatchmakingRuntimeSnapshotKey(value: string | undefined): string {
  const snapshotKey = value?.trim() || DEFAULT_SNAPSHOT_KEY;
  if (!SNAPSHOT_KEY_PATTERN.test(snapshotKey)) {
    throw new Error('MATCHMAKING_RUNTIME_NAMESPACE must use 1-96 letters, numbers, dot, underscore, colon, or dash characters.');
  }
  return snapshotKey;
}

export class MatchmakingRuntimeStateStore {
  private readonly snapshotKey: string;

  public constructor(
    private readonly database: MatchmakingRuntimeStateDatabase,
    options: MatchmakingRuntimeStateStoreOptions = {},
  ) {
    this.snapshotKey = resolveMatchmakingRuntimeSnapshotKey(options.snapshotKey);
  }

  public async load(
    database: MatchmakingRuntimeStateDatabase = this.database,
  ): Promise<MatchmakingQueueSnapshot | null> {
    const result = await database.query(
      `
      SELECT snapshot_version, state_json
      FROM matchmaking_runtime_snapshots
      WHERE snapshot_key = $1
      LIMIT 1
      `,
      [this.snapshotKey],
    );
    if (!result.rowCount) {
      return null;
    }
    const row = result.rows[0] as { snapshot_version?: number; state_json?: unknown };
    if (Number(row.snapshot_version) !== SNAPSHOT_VERSION) {
      throw new Error(`Unsupported persisted matchmaking snapshot version: ${row.snapshot_version}`);
    }
    const snapshot = row.state_json as Partial<MatchmakingQueueSnapshot> | null;
    if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error('Persisted matchmaking snapshot payload is invalid.');
    }
    return snapshot as MatchmakingQueueSnapshot;
  }

  public async save(
    snapshot: MatchmakingQueueSnapshot,
    fenceToken: string,
    database: MatchmakingRuntimeStateDatabase = this.database,
  ): Promise<void> {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(`Cannot persist matchmaking snapshot version ${snapshot.version}.`);
    }
    if (!/^[1-9][0-9]*$/.test(fenceToken)) {
      throw new TypeError('Matchmaking runtime fence token must be a positive integer string.');
    }
    const result = await database.query(
      `
      WITH current_lease AS MATERIALIZED (
        SELECT fence_token
        FROM matchmaking_runtime_fences
        WHERE snapshot_key = $1
          AND fence_token = $4::bigint
        FOR SHARE
      ),
      saved AS (
        INSERT INTO matchmaking_runtime_snapshots(snapshot_key, snapshot_version, state_json, updated_at)
        SELECT $1, $2, $3::jsonb, NOW()
        FROM current_lease
        ON CONFLICT (snapshot_key)
        DO UPDATE SET
          snapshot_version = EXCLUDED.snapshot_version,
          state_json = EXCLUDED.state_json,
          updated_at = NOW()
        RETURNING 1
      )
      SELECT EXISTS(SELECT 1 FROM saved) AS saved
      `,
      [this.snapshotKey, SNAPSHOT_VERSION, JSON.stringify(snapshot), fenceToken],
    );
    const row = result.rows[0] as { saved?: unknown } | undefined;
    if (row?.saved !== true) {
      throw new MatchmakingRuntimeLeaseFencedError();
    }
  }
}

export function createMatchmakingRuntimeStateStore(
  database: MatchmakingRuntimeStateDatabase,
  options: MatchmakingRuntimeStateStoreOptions = {},
): MatchmakingRuntimeStateStore {
  return new MatchmakingRuntimeStateStore(database, options);
}
