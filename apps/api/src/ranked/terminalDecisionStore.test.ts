import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import {
  MAX_RANKED_TERMINAL_DECISION_CLAIM_LIMIT,
  MAX_RANKED_TERMINAL_DECISION_LAST_ERROR_BYTES,
  RankedTerminalDecisionConflictError,
  createRankedTerminalDecisionStore,
  type EnqueueRankedTerminalDecisionInput,
  type RankedTerminalDecisionQueryClient,
} from './terminalDecisionStore';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P1_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const P2_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CLAIM_TOKEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MATCH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DECIDED_AT = '2026-07-15T10:00:00.000Z';
const DUE_AT = '2026-07-15T10:00:05.000Z';
const LEASE_EXPIRES_AT = '2026-07-15T10:00:35.000Z';

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

interface ScriptedResult {
  rowCount: number | null;
  rows: unknown[];
}

class ScriptedClient implements RankedTerminalDecisionQueryClient {
  public readonly queries: RecordedQuery[] = [];

  public constructor(private readonly results: ScriptedResult[] = []) {}

  public async query(sql: string, values: unknown[] = []): Promise<ScriptedResult> {
    this.queries.push({ sql: compactSql(sql), values });
    const result = this.results.shift();
    if (!result) {
      throw new Error(`Unexpected query: ${compactSql(sql)}`);
    }
    return result;
  }
}

test('enqueues valid forfeit and no-contest shapes through the supplied transaction client', async () => {
  const forfeitClient = new ScriptedClient([{
    rowCount: 1,
    rows: [decisionRow()],
  }]);
  const noContestClient = new ScriptedClient([{
    rowCount: 1,
    rows: [decisionRow({
      decision_type: 'no_contest',
      winner_account_id: null,
      forfeiting_account_id: null,
      reason: 'reconnect_timeout',
    })],
  }]);
  const store = createRankedTerminalDecisionStore(new ScriptedClient());

  const forfeit = await store.enqueue(forfeitClient, forfeitInput());
  const noContestInput: EnqueueRankedTerminalDecisionInput = {
    ...forfeitInput(),
    decisionType: 'no_contest',
    winnerAccountId: null,
    forfeitingAccountId: null,
    reason: 'reconnect_timeout',
  };
  const noContest = await store.enqueue(noContestClient, noContestInput);

  assert.equal(forfeit.decisionType, 'forfeit');
  assert.equal(forfeit.winnerAccountId, P1_ACCOUNT_ID);
  assert.equal(forfeit.forfeitingAccountId, P2_ACCOUNT_ID);
  assert.equal(noContest.decisionType, 'no_contest');
  assert.equal(noContest.winnerAccountId, null);
  assert.equal(noContest.forfeitingAccountId, null);
  assert.deepEqual(forfeitClient.queries[0]?.values, [
    SESSION_ID,
    'forfeit',
    P1_ACCOUNT_ID,
    P2_ACCOUNT_ID,
    P1_ACCOUNT_ID,
    P2_ACCOUNT_ID,
    'reconnect_timeout',
    DUE_AT,
    DECIDED_AT,
  ]);
  assert.deepEqual(noContestClient.queries[0]?.values.slice(0, 7), [
    SESSION_ID,
    'no_contest',
    P1_ACCOUNT_ID,
    P2_ACCOUNT_ID,
    null,
    null,
    'reconnect_timeout',
  ]);
  assert.match(forfeitClient.queries[0]?.sql ?? '', /ON CONFLICT \(session_id\) DO NOTHING/);

  const invalidClient = new ScriptedClient();
  await assert.rejects(
    store.enqueue(invalidClient, {
      ...forfeitInput(),
      winnerAccountId: P2_ACCOUNT_ID,
      forfeitingAccountId: P2_ACCOUNT_ID,
    }),
    /must be opposite session participants/,
  );
  await assert.rejects(
    store.enqueue(invalidClient, {
      ...noContestInput,
      winnerAccountId: P1_ACCOUNT_ID,
    } as EnqueueRankedTerminalDecisionInput),
    /must both be null/,
  );
  assert.equal(invalidClient.queries.length, 0);
});

test('treats an existing byte-equivalent decision as an idempotent enqueue', async () => {
  const client = new ScriptedClient([
    { rowCount: 0, rows: [] },
    {
      rowCount: 1,
      rows: [decisionRow({ status: 'settled', attempt_count: 1, settled_match_id: MATCH_ID })],
    },
  ]);
  const store = createRankedTerminalDecisionStore(client);

  const result = await store.enqueue(client, forfeitInput());

  assert.equal(result.status, 'settled');
  assert.equal(result.settledMatchId, MATCH_ID);
  assert.equal(client.queries.length, 2);
  assert.match(client.queries[0]?.sql ?? '', /ON CONFLICT \(session_id\) DO NOTHING/);
  assert.match(client.queries[1]?.sql ?? '', /WHERE session_id = \$1 LIMIT 1/);
  assert.deepEqual(client.queries[1]?.values, [SESSION_ID]);
});

test('fails closed when an existing session has a conflicting immutable decision', async () => {
  const client = new ScriptedClient([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [decisionRow({ reason: 'peer_left' })] },
  ]);
  const store = createRankedTerminalDecisionStore(client);

  await assert.rejects(
    store.enqueue(client, forfeitInput()),
    (error: unknown) => error instanceof RankedTerminalDecisionConflictError
      && error.sessionId === SESSION_ID,
  );
  assert.equal(client.queries.length, 2);
});

test('claims a hard-capped batch atomically and maps returned lease rows', async () => {
  const client = new ScriptedClient([{
    rowCount: 1,
    rows: [decisionRow({
      status: 'processing',
      attempt_count: '3',
      claim_token: CLAIM_TOKEN,
      lease_expires_at: new Date(LEASE_EXPIRES_AT),
      last_error: 'transient database error',
    })],
  }]);
  const store = createRankedTerminalDecisionStore(client, { leaseSeconds: 45 });

  const claimed = await store.claimBatch({ limit: 50_000 });

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.attemptCount, 3);
  assert.equal(claimed[0]?.claimToken, CLAIM_TOKEN);
  assert.equal(claimed[0]?.leaseExpiresAt, LEASE_EXPIRES_AT);
  assert.deepEqual(client.queries[0]?.values, [
    MAX_RANKED_TERMINAL_DECISION_CLAIM_LIMIT,
    45,
  ]);
  const sql = client.queries[0]?.sql ?? '';
  assert.match(sql, /WITH claimable AS MATERIALIZED/);
  assert.match(sql, /decisions\.status = 'pending'/);
  assert.match(sql, /decisions\.next_attempt_at <= NOW\(\)/);
  assert.match(sql, /decisions\.status = 'processing'/);
  assert.match(sql, /decisions\.lease_expires_at <= NOW\(\)/);
  assert.match(sql, /LIMIT \$1 FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /claim_token = gen_random_uuid\(\)/);
  assert.match(sql, /attempt_count = decisions\.attempt_count \+ 1/);
  assert.match(sql, /ORDER BY decided_at ASC, session_id ASC$/);
});

test('settled and superseded transitions require the current live claim token', async () => {
  const client = new ScriptedClient([
    { rowCount: 1, rows: [] },
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [] },
    { rowCount: 0, rows: [] },
  ]);
  const store = createRankedTerminalDecisionStore(client);

  assert.equal(await store.markSettled({
    sessionId: SESSION_ID,
    claimToken: CLAIM_TOKEN,
    settledMatchId: MATCH_ID,
  }), true);
  assert.equal(await store.markSettled({
    sessionId: SESSION_ID,
    claimToken: CLAIM_TOKEN,
    settledMatchId: MATCH_ID,
  }), false);
  assert.equal(await store.markSuperseded({ sessionId: SESSION_ID, claimToken: CLAIM_TOKEN }), true);
  assert.equal(await store.markSuperseded({ sessionId: SESSION_ID, claimToken: CLAIM_TOKEN }), false);

  assert.deepEqual(client.queries[0]?.values, [SESSION_ID, CLAIM_TOKEN, MATCH_ID]);
  assert.deepEqual(client.queries[2]?.values, [SESSION_ID, CLAIM_TOKEN]);
  for (const query of client.queries) {
    assert.match(query.sql, /status = 'processing'/);
    assert.match(query.sql, /claim_token = \$2/);
    assert.match(query.sql, /lease_expires_at > NOW\(\)/);
    assert.match(query.sql, /claim_token = NULL/);
    assert.match(query.sql, /lease_expires_at = NULL/);
  }
});

test('retry is claim-owned, clears the lease, and bounds UTF-8 errors and exponential backoff', async () => {
  const client = new ScriptedClient([
    { rowCount: 1, rows: [] },
    { rowCount: 0, rows: [] },
  ]);
  const store = createRankedTerminalDecisionStore(client, {
    retryBaseSeconds: 7,
    retryMaxSeconds: 90,
  });
  const oversizedError = `\u0000${'\u00e9'.repeat(MAX_RANKED_TERMINAL_DECISION_LAST_ERROR_BYTES)}`;

  assert.equal(await store.markRetry({
    sessionId: SESSION_ID,
    claimToken: CLAIM_TOKEN,
    error: new Error(oversizedError),
  }), true);
  assert.equal(await store.markRetry({
    sessionId: SESSION_ID,
    claimToken: CLAIM_TOKEN,
    error: 'stale worker',
  }), false);

  const persistedError = client.queries[0]?.values[2];
  assert.equal(typeof persistedError, 'string');
  assert.ok(Buffer.byteLength(persistedError as string, 'utf8') <= MAX_RANKED_TERMINAL_DECISION_LAST_ERROR_BYTES);
  assert.doesNotMatch(persistedError as string, /\u0000/);
  assert.doesNotMatch(persistedError as string, /\uFFFD$/);
  assert.deepEqual(client.queries[0]?.values.slice(3), [7, 90]);
  const sql = client.queries[0]?.sql ?? '';
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /claim_token = NULL/);
  assert.match(sql, /lease_expires_at = NULL/);
  assert.match(sql, /LEAST\( \$5::numeric, \$4::numeric \* POWER/);
  assert.match(sql, /GREATEST\(attempt_count - 1, 0\)/);
  assert.match(sql, /last_error = \$3/);
  assert.match(sql, /claim_token = \$2/);
  assert.match(sql, /lease_expires_at > NOW\(\)/);
});

test('reads durable status by session and returns null when absent', async () => {
  const client = new ScriptedClient([
    {
      rowCount: 1,
      rows: [decisionRow({
        status: 'superseded',
        attempt_count: 2,
        last_error: null,
      })],
    },
    { rowCount: 0, rows: [] },
  ]);
  const store = createRankedTerminalDecisionStore(client);

  const decision = await store.getBySession(SESSION_ID);
  assert.equal(decision?.status, 'superseded');
  assert.equal(decision?.attemptCount, 2);
  assert.equal(await store.getBySession(SESSION_ID), null);
  assert.deepEqual(client.queries.map((query) => query.values), [[SESSION_ID], [SESSION_ID]]);
});

function forfeitInput(): EnqueueRankedTerminalDecisionInput {
  return {
    sessionId: SESSION_ID,
    decisionType: 'forfeit',
    participantP1AccountId: P1_ACCOUNT_ID,
    participantP2AccountId: P2_ACCOUNT_ID,
    winnerAccountId: P1_ACCOUNT_ID,
    forfeitingAccountId: P2_ACCOUNT_ID,
    reason: 'reconnect_timeout',
    dueAt: DUE_AT,
    decidedAt: DECIDED_AT,
  };
}

function decisionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: SESSION_ID,
    decision_type: 'forfeit',
    participant_p1_account_id: P1_ACCOUNT_ID,
    participant_p2_account_id: P2_ACCOUNT_ID,
    winner_account_id: P1_ACCOUNT_ID,
    forfeiting_account_id: P2_ACCOUNT_ID,
    reason: 'reconnect_timeout',
    due_at: new Date(DUE_AT),
    decided_at: DECIDED_AT,
    status: 'pending',
    attempt_count: 0,
    claim_token: null,
    lease_expires_at: null,
    next_attempt_at: DUE_AT,
    last_error: null,
    settled_match_id: null,
    created_at: '2026-07-15T10:00:01.000Z',
    updated_at: '2026-07-15T10:00:01.000Z',
    ...overrides,
  };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
