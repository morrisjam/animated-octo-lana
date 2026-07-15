import assert from 'node:assert/strict';
import test from 'node:test';
import { createMatchmakingQueueService, type MatchmakingQueueSnapshot } from './queueService';
import {
  createMatchmakingRuntimeStateStore,
  fingerprintMatchmakingRuntimeSnapshot,
  resolveMatchmakingRuntimeSnapshotKey,
} from './runtimeStateStore';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

test('persists and loads a matchmaking queue snapshot', async () => {
  let storedSnapshot: MatchmakingQueueSnapshot | null = null;
  const database = {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes('INSERT INTO matchmaking_runtime_snapshots')) {
        storedSnapshot = JSON.parse(String(values?.[2])) as MatchmakingQueueSnapshot;
        return { rowCount: 1, rows: [{ saved: true }] };
      }
      return storedSnapshot
        ? { rowCount: 1, rows: [{ snapshot_version: 1, state_json: storedSnapshot }] }
        : { rowCount: 0, rows: [] };
    },
  };
  const queue = createMatchmakingQueueService({ now: () => 1_000_000 });
  queue.join({
    accountId: ACCOUNT_ID,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-1' },
  });
  const store = createMatchmakingRuntimeStateStore(database);

  await store.save({
    ...queue.exportSnapshot(),
    serviceDraining: true,
  }, '1');
  const loaded = await store.load();

  assert.ok(loaded);
  assert.equal(loaded.tickets.length, 1);
  assert.equal(loaded.tickets[0].accountId, ACCOUNT_ID);
  assert.equal(loaded.tickets[0].playerMetadata.buildVersion, 'alpha-1');
  assert.equal(loaded.serviceDraining, true);
});

test('returns null when no matchmaking snapshot exists', async () => {
  const store = createMatchmakingRuntimeStateStore({
    async query() {
      return { rowCount: 0, rows: [] };
    },
  });
  assert.equal(await store.load(), null);
});

test('can persist through an explicit transaction client', async () => {
  let poolQueries = 0;
  let transactionQueries = 0;
  const store = createMatchmakingRuntimeStateStore({
    async query() {
      poolQueries += 1;
      return { rowCount: 0, rows: [] };
    },
  });
  const queue = createMatchmakingQueueService({ now: () => 1_000_000 });
  const transactionClient = {
    async query(sql: string) {
      transactionQueries += 1;
      assert.match(sql, /INSERT INTO matchmaking_runtime_snapshots/);
      return { rowCount: 1, rows: [{ saved: true }] };
    },
  };

  await store.save(queue.exportSnapshot(), '42', transactionClient);

  assert.equal(transactionQueries, 1);
  assert.equal(poolQueries, 0);
});

test('fails closed when PostgreSQL rejects a superseded fence token', async () => {
  const store = createMatchmakingRuntimeStateStore({
    async query() {
      return { rowCount: 1, rows: [{ saved: false }] };
    },
  });
  const queue = createMatchmakingQueueService({ now: () => 1_000_000 });

  await assert.rejects(
    () => store.save(queue.exportSnapshot(), '41'),
    /lease was superseded/,
  );
  await assert.rejects(
    () => store.save(queue.exportSnapshot(), 'not-a-token'),
    /positive integer string/,
  );
});

test('fingerprints durable state independently of capture time and object key order', () => {
  const first: MatchmakingQueueSnapshot = {
    version: 1,
    capturedAtMs: 1_000,
    serviceDraining: false,
    tickets: [{
      ticketId: 'ticket-1',
      accountId: ACCOUNT_ID,
      queueType: 'unranked',
      regionPreferences: ['eu-west'],
      playerMetadata: { displayName: 'Pilot', buildVersion: 'alpha-1' },
      status: 'queued',
      queuedAtMs: 900,
    }],
    sessions: [],
  };
  const second = {
    sessions: [],
    tickets: [{
      queuedAtMs: 900,
      status: 'queued',
      playerMetadata: { buildVersion: 'alpha-1', displayName: 'Pilot' },
      regionPreferences: ['eu-west'],
      queueType: 'unranked',
      accountId: ACCOUNT_ID,
      ticketId: 'ticket-1',
    }],
    serviceDraining: false,
    capturedAtMs: 2_000,
    version: 1,
  } as MatchmakingQueueSnapshot;

  assert.equal(
    fingerprintMatchmakingRuntimeSnapshot(first),
    fingerprintMatchmakingRuntimeSnapshot(second),
  );
});

test('fingerprints liveness transitions as durable state changes', () => {
  const queue = createMatchmakingQueueService({ now: () => 1_000_000 });
  queue.join({
    accountId: ACCOUNT_ID,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-1' },
  });
  const queued = queue.exportSnapshot();
  const timedOut = structuredClone(queued);
  timedOut.tickets[0].status = 'closed';
  timedOut.tickets[0].closedReason = 'reconnect_timeout';

  assert.notEqual(
    fingerprintMatchmakingRuntimeSnapshot(queued),
    fingerprintMatchmakingRuntimeSnapshot(timedOut),
  );
});

test('rejects incompatible persisted snapshot versions', async () => {
  const store = createMatchmakingRuntimeStateStore({
    async query() {
      return { rowCount: 1, rows: [{ snapshot_version: 2, state_json: { version: 2 } }] };
    },
  });
  await assert.rejects(() => store.load(), /Unsupported persisted matchmaking snapshot version/);
});

test('isolates snapshots by validated runtime namespace', async () => {
  const queryValues: unknown[][] = [];
  const store = createMatchmakingRuntimeStateStore({
    async query(_sql, values = []) {
      queryValues.push(values);
      return { rowCount: 0, rows: [] };
    },
  }, { snapshotKey: 'smoke:instance-pair-1' });

  await store.load();

  assert.equal(queryValues[0]?.[0], 'smoke:instance-pair-1');
  assert.equal(resolveMatchmakingRuntimeSnapshotKey(undefined), 'primary');
  assert.throws(
    () => resolveMatchmakingRuntimeSnapshotKey('unsafe namespace'),
    /MATCHMAKING_RUNTIME_NAMESPACE/,
  );
});
