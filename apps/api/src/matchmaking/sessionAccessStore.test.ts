import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchmakingQueueSnapshot } from './queueService';
import {
  createMatchmakingSessionAccessStore,
  hashSessionToken,
  type MatchmakingSessionAccessDatabase,
} from './sessionAccessStore';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-07-15T12:00:00.000Z');

class QueryRecorder implements MatchmakingSessionAccessDatabase {
  public readonly queries: Array<{ sql: string; values: unknown[] }> = [];

  public constructor(private readonly results: Array<{ rowCount: number; rows: unknown[] }>) {}

  public async query(sql: string, values: unknown[] = []): Promise<{ rowCount: number; rows: unknown[] }> {
    this.queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    return this.results.shift() ?? { rowCount: 0, rows: [] };
  }
}

test('atomically replaces the hashed participant projection for one namespace', async () => {
  const database = new QueryRecorder([{ rowCount: 1, rows: [{ upserted_count: 2, deleted_count: 0 }] }]);
  const store = createMatchmakingSessionAccessStore(database, { snapshotKey: 'alpha:test' });

  await store.replaceFromSnapshot(snapshot());

  assert.equal(database.queries.length, 1);
  assert.deepEqual(database.queries[0]?.values.slice(0, 1), ['alpha:test']);
  const projections = JSON.parse(String(database.queries[0]?.values[1])) as Array<Record<string, unknown>>;
  assert.equal(projections.length, 2);
  assert.deepEqual(projections.map((entry) => entry.account_id), [P1, P2]);
  assert.equal(projections[0]?.peer_account_id, P2);
  assert.deepEqual(projections.map((entry) => entry.player_side), ['P1', 'P2']);
  assert.equal(projections[0]?.session_token_hash_hex, hashSessionToken('p1-token').toString('hex'));
  assert.equal(projections[0]?.signal_access_expires_at, new Date(NOW + 60_000).toISOString());
  assert.equal(JSON.stringify(projections).includes('p1-token'), false);
  assert.match(database.queries[0]?.sql ?? '', /ON CONFLICT \(snapshot_key, session_id, account_id\)/);
  assert.match(database.queries[0]?.sql ?? '', /DELETE FROM matchmaking_session_access AS access/);
});

test('uses an explicit transaction client for snapshot projection replacement', async () => {
  const defaultDatabase = new QueryRecorder([]);
  const transaction = new QueryRecorder([{ rowCount: 1, rows: [{ upserted_count: 2, deleted_count: 0 }] }]);
  const store = createMatchmakingSessionAccessStore(defaultDatabase);

  await store.replaceFromSnapshot(snapshot(), transaction);

  assert.equal(defaultDatabase.queries.length, 0);
  assert.equal(transaction.queries.length, 1);
});

test('validates a live participant token and current transport attempt', async () => {
  const database = new QueryRecorder([{ rowCount: 1, rows: [accessRow()] }]);
  const store = createMatchmakingSessionAccessStore(database, { now: () => NOW });

  assert.deepEqual(await store.validateSignalAccess({
    sessionId: SESSION_ID,
    accountId: P1,
    sessionToken: 'p1-token',
    transportAttemptId: ATTEMPT_ID,
  }), {
    ok: true,
    value: { peerAccountId: P2, side: 'P1' },
  });
});

test('validates a live participant token without binding commitment uploads to a transport attempt', async () => {
  const database = new QueryRecorder([{
    rowCount: 1,
    rows: [accessRow({ transport_attempt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })],
  }]);
  const store = createMatchmakingSessionAccessStore(database, { now: () => NOW });

  assert.deepEqual(await store.validateLiveSessionAccess({
    sessionId: SESSION_ID,
    accountId: P1,
    sessionToken: 'p1-token',
  }), {
    ok: true,
    value: { peerAccountId: P2, side: 'P1' },
  });
});

test('distinguishes missing sessions, outsiders, expiry, invalid tokens, and stale attempts', async () => {
  const cases = [
    { row: { session_exists: false }, code: 'not_found' },
    { row: { session_exists: true, account_id: null }, code: 'forbidden' },
    { row: accessRow({ session_status: 'resolved' }), code: 'session_resolved' },
    {
      row: accessRow({ signal_access_expires_at: new Date(NOW - 1) }),
      code: 'session_resolved',
    },
    {
      row: accessRow({ session_token_expires_at: new Date(NOW - 1) }),
      code: 'token_expired',
    },
    { row: accessRow(), token: 'wrong-token', code: 'invalid_token' },
    {
      row: accessRow({ transport_attempt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
      code: 'stale_transport_attempt',
    },
  ] as const;

  for (const item of cases) {
    const database = new QueryRecorder([{ rowCount: 1, rows: [item.row] }]);
    const store = createMatchmakingSessionAccessStore(database, { now: () => NOW });
    const result = await store.validateSignalAccess({
      sessionId: SESSION_ID,
      accountId: item.code === 'forbidden' ? OUTSIDER : P1,
      sessionToken: 'token' in item ? item.token : 'p1-token',
      transportAttemptId: ATTEMPT_ID,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, item.code);
    }
  }
});

test('rejects malformed validation inputs before querying', async () => {
  const database = new QueryRecorder([]);
  const store = createMatchmakingSessionAccessStore(database);
  await assert.rejects(store.validateSignalAccess({
    sessionId: 'bad',
    accountId: P1,
    sessionToken: 'p1-token',
    transportAttemptId: ATTEMPT_ID,
  }), /sessionId must be a UUID/);
  assert.equal(database.queries.length, 0);
});

function snapshot(): MatchmakingQueueSnapshot {
  return {
    version: 1,
    capturedAtMs: NOW,
    tickets: [],
    sessions: [{
      sessionId: SESSION_ID,
      queueType: 'ranked',
      region: 'eu-west',
      status: 'active',
      createdAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      transportAttemptId: ATTEMPT_ID,
      transportAttemptGeneration: 1,
      transportAttemptCreatedAtMs: NOW - 1_000,
      ticketIds: [
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      ],
      participants: [
        {
          accountId: P1,
          queueTicketId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          side: 'P1',
          sessionToken: 'p1-token',
          sessionTokenExpiresAtMs: NOW + 30_000,
          connectionStatus: 'connected',
          usedReconnectAttemptIds: [],
        },
        {
          accountId: P2,
          queueTicketId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          side: 'P2',
          sessionToken: 'p2-token',
          sessionTokenExpiresAtMs: NOW + 30_000,
          connectionStatus: 'connected',
          usedReconnectAttemptIds: [],
        },
      ],
    }],
  };
}

function accessRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_exists: true,
    account_id: P1,
    peer_account_id: P2,
    player_side: 'P1',
    session_token_hash: hashSessionToken('p1-token'),
    session_token_expires_at: new Date(NOW + 30_000),
    transport_attempt_id: ATTEMPT_ID,
    session_status: 'active',
    session_expires_at: new Date(NOW + 60_000),
    signal_access_expires_at: new Date(NOW + 60_000),
    ...overrides,
  };
}

test('projects the earliest participant reconnect deadline as the signaling cutoff', async () => {
  const database = new QueryRecorder([{ rowCount: 1, rows: [{ upserted_count: 2, deleted_count: 0 }] }]);
  const store = createMatchmakingSessionAccessStore(database);
  const state = snapshot();
  state.sessions[0]!.participants[1]!.reconnectDeadlineAtMs = NOW + 5_000;

  await store.replaceFromSnapshot(state);

  const projections = JSON.parse(String(database.queries[0]?.values[1])) as Array<Record<string, unknown>>;
  assert.deepEqual(
    projections.map((entry) => entry.signal_access_expires_at),
    [new Date(NOW + 5_000).toISOString(), new Date(NOW + 5_000).toISOString()],
  );
});
