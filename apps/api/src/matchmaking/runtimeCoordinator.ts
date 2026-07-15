interface RuntimeLockQueryResult {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
}

export interface MatchmakingRuntimeLockClient {
  query(sql: string, values?: unknown[]): Promise<RuntimeLockQueryResult>;
  release(): void;
}

export interface MatchmakingRuntimeLockDatabase {
  connect(): Promise<MatchmakingRuntimeLockClient>;
}

export interface MatchmakingRuntimeLease {
  readonly database: MatchmakingRuntimeLockClient;
  readonly fenceToken: string;
  assertActive(): void;
  isActive(): boolean;
  release(): Promise<void>;
}

export interface MatchmakingRuntimeCoordinatorOptions {
  acquireTimeoutMs?: number;
  retryIntervalMs?: number;
  lockKey?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  fenceKey?: string;
}

const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 20;
// ASCII "GWMM" encoded as a signed-safe 32-bit advisory lock key.
const DEFAULT_LOCK_KEY = 0x47574d4d;

export const MATCHMAKING_RUNTIME_COORDINATION_MODE = 'postgres_advisory_lock_fenced_v2';

export class MatchmakingRuntimeLeaseLostError extends Error {
  public constructor() {
    super('Matchmaking runtime lease is no longer active.');
    this.name = 'MatchmakingRuntimeLeaseLostError';
  }
}

export function matchmakingRuntimeLockKeyFromNamespace(namespace: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < namespace.length; index += 1) {
    hash ^= namespace.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash & 0x7fffffff) || DEFAULT_LOCK_KEY;
}

export class MatchmakingRuntimeLockTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`Matchmaking runtime lock was not acquired within ${timeoutMs}ms.`);
    this.name = 'MatchmakingRuntimeLockTimeoutError';
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Matchmaking runtime coordinator timing values must be non-negative.');
  }
  return Math.floor(value);
}

export class MatchmakingRuntimeCoordinator {
  private readonly acquireTimeoutMs: number;

  private readonly retryIntervalMs: number;

  private readonly lockKey: number;

  private readonly now: () => number;

  private readonly sleep: (milliseconds: number) => Promise<void>;

  private readonly fenceKey: string;

  public constructor(
    private readonly database: MatchmakingRuntimeLockDatabase,
    options: MatchmakingRuntimeCoordinatorOptions = {},
  ) {
    this.acquireTimeoutMs = normalizeNonNegativeInteger(
      options.acquireTimeoutMs,
      DEFAULT_ACQUIRE_TIMEOUT_MS,
    );
    this.retryIntervalMs = Math.max(1, normalizeNonNegativeInteger(
      options.retryIntervalMs,
      DEFAULT_RETRY_INTERVAL_MS,
    ));
    this.lockKey = options.lockKey ?? DEFAULT_LOCK_KEY;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.fenceKey = normalizeFenceKey(options.fenceKey);
  }

  public async acquire(): Promise<MatchmakingRuntimeLease> {
    const startedAt = this.now();
    while (true) {
      const client = await this.database.connect();
      let acquired = false;
      try {
        const result = await client.query(
          'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
          [this.lockKey],
        );
        acquired = result.rows[0]?.acquired === true;
        if (acquired) {
          let fenceToken: string;
          try {
            fenceToken = await acquireFenceToken(client, this.fenceKey);
          } catch (error) {
            try {
              await client.query('SELECT pg_advisory_unlock($1::bigint)', [this.lockKey]);
            } finally {
              client.release();
            }
            throw error;
          }
          let released = false;
          return {
            database: client,
            fenceToken,
            assertActive: (): void => {
              if (released) {
                throw new MatchmakingRuntimeLeaseLostError();
              }
            },
            isActive: (): boolean => !released,
            release: async (): Promise<void> => {
              if (released) {
                return;
              }
              released = true;
              try {
                const unlockResult = await client.query(
                  'SELECT pg_advisory_unlock($1::bigint) AS released',
                  [this.lockKey],
                );
                if (unlockResult.rows[0]?.released !== true) {
                  throw new Error('Matchmaking runtime advisory lock was not owned by this connection.');
                }
              } finally {
                client.release();
              }
            },
          };
        }
      } finally {
        // Only the lock owner retains its session; contenders return scarce pool
        // capacity before timing out or sleeping between acquisition attempts.
        if (!acquired) {
          client.release();
        }
      }
      if (this.now() - startedAt >= this.acquireTimeoutMs) {
        throw new MatchmakingRuntimeLockTimeoutError(this.acquireTimeoutMs);
      }
      await this.sleep(this.retryIntervalMs);
    }
  }

  public async withLease<T>(operation: (lease: MatchmakingRuntimeLease) => Promise<T>): Promise<T> {
    const lease = await this.acquire();
    try {
      return await operation(lease);
    } finally {
      await lease.release();
    }
  }
}

function normalizeFenceKey(value: string | undefined): string {
  const normalized = value?.trim() || 'primary';
  if (!/^[a-zA-Z0-9._:-]{1,96}$/.test(normalized)) {
    throw new Error('Matchmaking runtime fence key is invalid.');
  }
  return normalized;
}

async function acquireFenceToken(
  client: MatchmakingRuntimeLockClient,
  fenceKey: string,
): Promise<string> {
  const result = await client.query(
    `
    INSERT INTO matchmaking_runtime_fences(snapshot_key, fence_token, updated_at)
    VALUES ($1, 1, NOW())
    ON CONFLICT (snapshot_key)
    DO UPDATE SET
      fence_token = matchmaking_runtime_fences.fence_token + 1,
      updated_at = NOW()
    RETURNING fence_token::text AS fence_token
    `,
    [fenceKey],
  );
  const fenceToken = result.rows[0]?.fence_token;
  if (typeof fenceToken !== 'string' || !/^[1-9][0-9]*$/.test(fenceToken)) {
    throw new Error('Matchmaking runtime fence token was not returned by PostgreSQL.');
  }
  return fenceToken;
}

export function createMatchmakingRuntimeCoordinator(
  database: MatchmakingRuntimeLockDatabase,
  options: MatchmakingRuntimeCoordinatorOptions = {},
): MatchmakingRuntimeCoordinator {
  return new MatchmakingRuntimeCoordinator(database, options);
}
