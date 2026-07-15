import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMatchmakingRuntimeCoordinator,
  matchmakingRuntimeLockKeyFromNamespace,
  MatchmakingRuntimeLockTimeoutError,
  type MatchmakingRuntimeLockClient,
} from './runtimeCoordinator';

function createClient(acquireResults: boolean[]): {
  client: MatchmakingRuntimeLockClient;
  queries: string[];
  releases: { count: number };
} {
  const queries: string[] = [];
  const releases = { count: 0 };
  let acquireIndex = 0;
  let fenceToken = 0;
  return {
    queries,
    releases,
    client: {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes('pg_try_advisory_lock')) {
          const acquired = acquireResults[Math.min(acquireIndex, acquireResults.length - 1)] ?? false;
          acquireIndex += 1;
          return { rowCount: 1, rows: [{ acquired }] };
        }
        if (sql.includes('INSERT INTO matchmaking_runtime_fences')) {
          fenceToken += 1;
          return { rowCount: 1, rows: [{ fence_token: String(fenceToken) }] };
        }
        return { rowCount: 1, rows: [{ released: true }] };
      },
      release() {
        releases.count += 1;
      },
    },
  };
}

function createConstrainedPool(maxClients: number): {
  database: { connect(): Promise<MatchmakingRuntimeLockClient> };
  query(sql: string): Promise<void>;
  readonly checkedOutCount: number;
  stateQueries: string[];
} {
  const pendingConnections: Array<(client: MatchmakingRuntimeLockClient) => void> = [];
  const stateQueries: string[] = [];
  let checkedOutCount = 0;
  let lockOwner: number | null = null;
  let nextConnectionId = 1;
  let fenceToken = 0;

  const dispatchConnections = (): void => {
    while (checkedOutCount < maxClients) {
      const resolve = pendingConnections.shift();
      if (!resolve) {
        return;
      }
      const connectionId = nextConnectionId;
      nextConnectionId += 1;
      checkedOutCount += 1;
      let released = false;
      resolve({
        async query(sql: string) {
          assert.equal(released, false, 'cannot query a released pool client');
          if (sql.includes('pg_try_advisory_lock')) {
            if (lockOwner === null) {
              lockOwner = connectionId;
            }
            return { rowCount: 1, rows: [{ acquired: lockOwner === connectionId }] };
          }
          if (sql.includes('pg_advisory_unlock')) {
            const releasedLock = lockOwner === connectionId;
            if (releasedLock) {
              lockOwner = null;
            }
            return { rowCount: 1, rows: [{ released: releasedLock }] };
          }
          if (sql.includes('INSERT INTO matchmaking_runtime_fences')) {
            fenceToken += 1;
            return { rowCount: 1, rows: [{ fence_token: String(fenceToken) }] };
          }
          stateQueries.push(sql);
          return { rowCount: 0, rows: [] };
        },
        release() {
          assert.equal(released, false, 'cannot release a pool client twice');
          released = true;
          checkedOutCount -= 1;
          dispatchConnections();
        },
      });
    }
  };

  const database = {
    connect(): Promise<MatchmakingRuntimeLockClient> {
      return new Promise((resolve) => {
        pendingConnections.push(resolve);
        dispatchConnections();
      });
    },
  };

  return {
    database,
    async query(sql: string): Promise<void> {
      const client = await database.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    get checkedOutCount() {
      return checkedOutCount;
    },
    stateQueries,
  };
}

test('acquires and idempotently releases the PostgreSQL advisory lock', async () => {
  const fixture = createClient([true]);
  const coordinator = createMatchmakingRuntimeCoordinator({
    async connect() {
      return fixture.client;
    },
  });

  const lease = await coordinator.acquire();
  assert.equal(lease.fenceToken, '1');
  assert.equal(lease.isActive(), true);
  lease.assertActive();
  await lease.release();
  await lease.release();

  assert.equal(lease.isActive(), false);
  assert.throws(() => lease.assertActive(), /no longer active/);

  assert.equal(fixture.queries.filter((sql) => sql.includes('pg_try_advisory_lock')).length, 1);
  assert.equal(fixture.queries.filter((sql) => sql.includes('pg_advisory_unlock')).length, 1);
  assert.equal(fixture.releases.count, 1);
});

test('retries lock acquisition before succeeding', async () => {
  const fixture = createClient([false, true]);
  let nowMs = 0;
  const coordinator = createMatchmakingRuntimeCoordinator({
    async connect() {
      return fixture.client;
    },
  }, {
    acquireTimeoutMs: 100,
    retryIntervalMs: 10,
    now: () => nowMs,
    sleep: async (milliseconds) => {
      nowMs += milliseconds;
    },
  });

  const lease = await coordinator.acquire();
  await lease.release();

  assert.equal(fixture.queries.filter((sql) => sql.includes('pg_try_advisory_lock')).length, 2);
  assert.equal(fixture.releases.count, 2);
});

test('waiters release constrained-pool clients so the lock owner can run a second query', async () => {
  const pool = createConstrainedPool(3);
  const waitingSleeps: Array<() => void> = [];
  let nowMs = 0;
  let sleepingWaiters = 0;
  let settledWaiters = 0;
  let markWaitersSleeping!: () => void;
  const waitersSleeping = new Promise<void>((resolve) => {
    markWaitersSleeping = resolve;
  });
  const options = {
    acquireTimeoutMs: 100,
    retryIntervalMs: 10,
    now: () => nowMs,
    sleep: () => new Promise<void>((resolve) => {
      waitingSleeps.push(resolve);
      sleepingWaiters += 1;
      if (sleepingWaiters === 2) {
        markWaitersSleeping();
      }
    }),
  };
  const ownerCoordinator = createMatchmakingRuntimeCoordinator(pool.database, options);
  const waiterCoordinators = [
    createMatchmakingRuntimeCoordinator(pool.database, options),
    createMatchmakingRuntimeCoordinator(pool.database, options),
  ];

  await ownerCoordinator.withLease(async () => {
    await pool.query('SELECT owner_state_load');
    const waiterOutcomes = waiterCoordinators.map((coordinator) => coordinator.acquire().then(
      async (lease) => {
        settledWaiters += 1;
        await lease.release();
        return null;
      },
      (error: unknown) => {
        settledWaiters += 1;
        return error;
      },
    ));

    await waitersSleeping;
    try {
      assert.equal(settledWaiters, 0);
      assert.equal(pool.checkedOutCount, 1);
      await pool.query('UPDATE owner_state_save');
      assert.deepEqual(pool.stateQueries, [
        'SELECT owner_state_load',
        'UPDATE owner_state_save',
      ]);
      assert.equal(settledWaiters, 0);
    } finally {
      nowMs = 100;
      for (const wake of waitingSleeps.splice(0)) {
        wake();
      }
      const outcomes = await Promise.all(waiterOutcomes);
      assert.ok(outcomes.every((error) => error instanceof MatchmakingRuntimeLockTimeoutError));
    }
  });

  assert.equal(pool.checkedOutCount, 0);
});

test('times out without leaking the database connection', async () => {
  const fixture = createClient([false]);
  const coordinator = createMatchmakingRuntimeCoordinator({
    async connect() {
      return fixture.client;
    },
  }, { acquireTimeoutMs: 0 });

  await assert.rejects(
    () => coordinator.acquire(),
    MatchmakingRuntimeLockTimeoutError,
  );
  assert.equal(fixture.releases.count, 1);
});

test('releases the advisory lock and client when fence acquisition fails', async () => {
  const queries: string[] = [];
  let releases = 0;
  const coordinator = createMatchmakingRuntimeCoordinator({
    async connect() {
      return {
        async query(sql: string) {
          queries.push(sql);
          if (sql.includes('pg_try_advisory_lock')) {
            return { rowCount: 1, rows: [{ acquired: true }] };
          }
          if (sql.includes('INSERT INTO matchmaking_runtime_fences')) {
            return { rowCount: 0, rows: [] };
          }
          return { rowCount: 1, rows: [{ released: true }] };
        },
        release() {
          releases += 1;
        },
      };
    },
  });

  await assert.rejects(() => coordinator.acquire(), /fence token was not returned/);

  assert.equal(queries.filter((sql) => sql.includes('pg_advisory_unlock')).length, 1);
  assert.equal(releases, 1);
});

test('withLease releases the lock when the operation fails', async () => {
  const fixture = createClient([true]);
  const coordinator = createMatchmakingRuntimeCoordinator({
    async connect() {
      return fixture.client;
    },
  });

  await assert.rejects(
    () => coordinator.withLease(async () => {
      throw new Error('operation failed');
    }),
    /operation failed/,
  );
  assert.equal(fixture.queries.filter((sql) => sql.includes('pg_advisory_unlock')).length, 1);
  assert.equal(fixture.releases.count, 1);
});

test('derives stable, distinct lock keys for isolated runtime namespaces', () => {
  assert.equal(
    matchmakingRuntimeLockKeyFromNamespace('primary'),
    matchmakingRuntimeLockKeyFromNamespace('primary'),
  );
  assert.notEqual(
    matchmakingRuntimeLockKeyFromNamespace('primary'),
    matchmakingRuntimeLockKeyFromNamespace('smoke:pair-1'),
  );
});
