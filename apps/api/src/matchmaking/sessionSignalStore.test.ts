import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SESSION_SIGNAL_MAX_BYTES,
  DEFAULT_SESSION_SIGNAL_MAX_BYTES_PER_SENDER,
  DEFAULT_SESSION_SIGNAL_MAX_MESSAGES,
  DEFAULT_SESSION_SIGNAL_MAX_MESSAGES_PER_SENDER,
  MAX_EXPIRED_SIGNAL_DELETE_LIMIT,
  MAX_SESSION_SIGNAL_PAYLOAD_BYTES,
  MAX_SESSION_SIGNAL_READ_LIMIT,
  SESSION_SIGNAL_TYPES,
  SessionSignalConflictError,
  SessionSignalQuotaExceededError,
  createSessionSignalStore,
  isSessionSignalType,
  type PublishSessionSignalInput,
  type SessionSignalJson,
  type SessionSignalStoreDatabase,
} from './sessionSignalStore';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRANSPORT_ATTEMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SENDER_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-07-13T10:00:00.000Z';
const EXPIRES_AT = '2026-07-13T10:10:00.000Z';

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

interface FakeQueryResult {
  rowCount: number | null;
  rows: unknown[];
}

class QueryRecorder implements SessionSignalStoreDatabase {
  public readonly queries: RecordedQuery[] = [];

  public constructor(private readonly results: FakeQueryResult[] = []) {}

  public async query(sql: string, values: unknown[] = []): Promise<FakeQueryResult> {
    this.queries.push({ sql: compactSql(sql), values });
    return this.results.shift() ?? { rowCount: 0, rows: [] };
  }
}

test('publishes a JSON signal with serialized per-session idempotency', async () => {
  const payload = {
    sdp: 'v=0\r\na=ice-options:trickle',
    metadata: { revision: 2, codecs: ['opus', 'vp9'] },
  } satisfies SessionSignalJson;
  const database = new QueryRecorder([{ rowCount: 1, rows: [signalRow({ payload_json: payload })] }]);
  const store = createSessionSignalStore(database, { ttlSeconds: 900 });

  const signal = await store.publishSignal({
    sessionId: SESSION_ID,
    transportAttemptId: TRANSPORT_ATTEMPT_ID,
    senderAccountId: SENDER_ACCOUNT_ID,
    recipientAccountId: RECIPIENT_ACCOUNT_ID,
    clientMessageId: 'offer-1',
    type: 'offer',
    payload,
  });

  assert.deepEqual(signal, {
    signalId: '41',
    sessionId: SESSION_ID,
    transportAttemptId: TRANSPORT_ATTEMPT_ID,
    senderAccountId: SENDER_ACCOUNT_ID,
    recipientAccountId: RECIPIENT_ACCOUNT_ID,
    clientMessageId: 'offer-1',
    type: 'offer',
    payload,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  });
  assert.equal(database.queries.length, 1);
  assert.deepEqual(database.queries[0]?.values, [
    SESSION_ID,
    TRANSPORT_ATTEMPT_ID,
    SENDER_ACCOUNT_ID,
    RECIPIENT_ACCOUNT_ID,
    'offer-1',
    'offer',
    JSON.stringify(payload),
    900,
    DEFAULT_SESSION_SIGNAL_MAX_MESSAGES,
    DEFAULT_SESSION_SIGNAL_MAX_BYTES,
    DEFAULT_SESSION_SIGNAL_MAX_MESSAGES_PER_SENDER,
    DEFAULT_SESSION_SIGNAL_MAX_BYTES_PER_SENDER,
  ]);
  const sql = database.queries[0]?.sql ?? '';
  assert.match(sql, /WITH session_lock AS MATERIALIZED/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /ON CONFLICT \(session_id, sender_account_id, client_message_id\)/);
  assert.match(sql, /DO UPDATE SET signal_id = matchmaking_session_signals\.signal_id/);
  assert.doesNotMatch(sql, /DO UPDATE SET (payload_json|signal_type|recipient_account_id)\s*=/);
  assert.match(sql, /payload_json = EXCLUDED\.payload_json/);
  assert.match(sql, /NOW\(\) \+ \(\$8::integer \* INTERVAL '1 second'\)/);
  assert.match(sql, /usage\.session_message_count < \$9/);
  assert.match(sql, /usage\.sender_message_count < \$11/);
});

test('rejects reuse of a client message id with changed signaling content', async () => {
  const database = new QueryRecorder([{
    rowCount: 1,
    rows: [publishRejectedRow({ client_message_exists: true })],
  }]);
  const store = createSessionSignalStore(database);

  await assert.rejects(
    store.publishSignal(validPublishInput()),
    SessionSignalConflictError,
  );
});

test('enforces bounded sender and session message and byte quotas', async () => {
  const cases = [
    {
      row: publishRejectedRow({ sender_message_count: 2 }),
      scope: 'sender_messages',
    },
    {
      row: publishRejectedRow({ sender_payload_bytes: 95, new_payload_bytes: 10 }),
      scope: 'sender_bytes',
    },
    {
      row: publishRejectedRow({ session_message_count: 4 }),
      scope: 'session_messages',
    },
    {
      row: publishRejectedRow({ session_payload_bytes: 195, new_payload_bytes: 10 }),
      scope: 'session_bytes',
    },
  ] as const;

  for (const item of cases) {
    const database = new QueryRecorder([{ rowCount: 1, rows: [item.row] }]);
    const store = createSessionSignalStore(database, {
      maxMessagesPerSession: 4,
      maxBytesPerSession: 200,
      maxMessagesPerSender: 2,
      maxBytesPerSender: 100,
    });
    await assert.rejects(
      store.publishSignal(validPublishInput()),
      (error: unknown) => (
        error instanceof SessionSignalQuotaExceededError
        && error.scope === item.scope
      ),
    );
  }
});

test('accepts and stores exactly the supported WebRTC signal types', async () => {
  const database = new QueryRecorder(SESSION_SIGNAL_TYPES.map((type, index) => ({
    rowCount: 1,
    rows: [signalRow({ signal_id: String(index + 1), signal_type: type, payload_json: null })],
  })));
  const store = createSessionSignalStore(database);

  for (const type of SESSION_SIGNAL_TYPES) {
    assert.equal(isSessionSignalType(type), true);
    const published = await store.publishSignal({
      ...validPublishInput(),
      clientMessageId: `message-${type}`,
      type,
      payload: null,
    });
    assert.equal(published.type, type);
  }

  assert.deepEqual(database.queries.map(({ values }) => values[5]), [...SESSION_SIGNAL_TYPES]);
  assert.equal(isSessionSignalType('candidate'), false);
});

test('validates publish identity, routing, type, message id, and JSON before querying', async () => {
  const database = new QueryRecorder();
  const store = createSessionSignalStore(database);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const nonSerializable = {};
  Object.defineProperty(nonSerializable, 'toJSON', { value: () => undefined });

  const invalidCases: Array<{
    input: PublishSessionSignalInput;
    error: RegExp;
  }> = [
    {
      input: { ...validPublishInput(), sessionId: 'not-a-uuid' },
      error: /sessionId must be a UUID/,
    },
    {
      input: { ...validPublishInput(), recipientAccountId: SENDER_ACCOUNT_ID },
      error: /must identify different accounts/,
    },
    {
      input: { ...validPublishInput(), clientMessageId: ' padded ' },
      error: /clientMessageId must be a trimmed string/,
    },
    {
      input: { ...validPublishInput(), type: 'candidate' as never },
      error: /type must be one of/,
    },
    {
      input: { ...validPublishInput(), payload: { candidate: undefined } as never },
      error: /payload must contain only JSON values/,
    },
    {
      input: { ...validPublishInput(), payload: circular as unknown as SessionSignalJson },
      error: /payload must not contain circular references/,
    },
    {
      input: { ...validPublishInput(), payload: Number.POSITIVE_INFINITY as never },
      error: /payload must contain only finite JSON numbers/,
    },
    {
      input: { ...validPublishInput(), payload: nonSerializable },
      error: /payload must be serializable JSON/,
    },
    {
      input: { ...validPublishInput(), payload: 'x'.repeat(MAX_SESSION_SIGNAL_PAYLOAD_BYTES) },
      error: /payload must not exceed/,
    },
  ];

  for (const { input, error } of invalidCases) {
    await assert.rejects(store.publishSignal(input), error);
  }
  assert.equal(database.queries.length, 0);
  assert.throws(() => createSessionSignalStore(database, { ttlSeconds: 0 }), /ttlSeconds must be a positive integer/);
  assert.throws(() => createSessionSignalStore(database, { ttlSeconds: 86_401 }), /ttlSeconds must be a positive integer/);
  assert.throws(
    () => createSessionSignalStore(database, {
      maxMessagesPerSession: 2,
      maxMessagesPerSender: 3,
    }),
    /maxMessagesPerSender must be a positive integer no greater than 2/,
  );
});

test('reads only unexpired peer signals in ascending id order and caps the batch', async () => {
  const answerPayload = { type: 'answer', sdp: 'v=0' } satisfies SessionSignalJson;
  const candidatePayload = { candidate: 'candidate:1 1 UDP 1 192.0.2.1 5000 typ host' } satisfies SessionSignalJson;
  const database = new QueryRecorder([{
    rowCount: 2,
    rows: [
      signalRow({ signal_id: '42', signal_type: 'answer', client_message_id: 'answer-1', payload_json: answerPayload }),
      signalRow({
        signal_id: '43',
        signal_type: 'ice_candidate',
        client_message_id: 'candidate-1',
        payload_json: candidatePayload,
      }),
    ],
  }]);
  const store = createSessionSignalStore(database);

  const result = await store.readPeerSignals({
    sessionId: SESSION_ID,
    transportAttemptId: TRANSPORT_ATTEMPT_ID,
    recipientAccountId: RECIPIENT_ACCOUNT_ID,
    afterSignalId: '41',
    limit: 10_000,
  });

  assert.deepEqual(result.signals.map(({ signalId, type, payload }) => ({ signalId, type, payload })), [
    { signalId: '42', type: 'answer', payload: answerPayload },
    { signalId: '43', type: 'ice_candidate', payload: candidatePayload },
  ]);
  assert.equal(result.nextAfterSignalId, '43');
  assert.deepEqual(database.queries[0]?.values, [
    SESSION_ID,
    TRANSPORT_ATTEMPT_ID,
    RECIPIENT_ACCOUNT_ID,
    '41',
    MAX_SESSION_SIGNAL_READ_LIMIT,
  ]);
  const sql = database.queries[0]?.sql ?? '';
  assert.match(sql, /transport_attempt_id = \$2/);
  assert.match(sql, /recipient_account_id = \$3/);
  assert.match(sql, /sender_account_id <> \$3/);
  assert.match(sql, /signal_id > \$4::bigint/);
  assert.match(sql, /expires_at > NOW\(\)/);
  assert.match(sql, /ORDER BY signal_id ASC/);
  assert.match(sql, /LIMIT \$5/);
});

test('preserves the polling cursor when no peer signals are available', async () => {
  const database = new QueryRecorder([{ rowCount: 0, rows: [] }]);
  const store = createSessionSignalStore(database);

  const result = await store.readPeerSignals({
    sessionId: SESSION_ID,
    transportAttemptId: TRANSPORT_ATTEMPT_ID,
    recipientAccountId: RECIPIENT_ACCOUNT_ID,
    afterSignalId: '9007199254740993',
  });

  assert.deepEqual(result, { signals: [], nextAfterSignalId: '9007199254740993' });
  assert.deepEqual(database.queries[0]?.values, [
    SESSION_ID,
    TRANSPORT_ATTEMPT_ID,
    RECIPIENT_ACCOUNT_ID,
    '9007199254740993',
    50,
  ]);
});

test('rejects invalid read cursors and limits before querying', async () => {
  const database = new QueryRecorder();
  const store = createSessionSignalStore(database);
  const base = {
    sessionId: SESSION_ID,
    transportAttemptId: TRANSPORT_ATTEMPT_ID,
    recipientAccountId: RECIPIENT_ACCOUNT_ID,
  };

  await assert.rejects(store.readPeerSignals({ ...base, afterSignalId: '-1' }), /afterSignalId must be/);
  await assert.rejects(store.readPeerSignals({ ...base, afterSignalId: '01' }), /afterSignalId must be/);
  await assert.rejects(
    store.readPeerSignals({ ...base, afterSignalId: '9223372036854775808' }),
    /outside the supported PostgreSQL bigint range/,
  );
  await assert.rejects(store.readPeerSignals({ ...base, limit: 0 }), /limit must be a positive integer/);
  await assert.rejects(store.readPeerSignals({ ...base, limit: 1.5 }), /limit must be a positive integer/);
  await assert.rejects(
    store.readPeerSignals({ ...base, recipientAccountId: 'not-a-uuid' }),
    /recipientAccountId must be a UUID/,
  );
  assert.equal(database.queries.length, 0);
});

test('deletes expired rows and clears sessions or superseded attempts', async () => {
  const database = new QueryRecorder([
    { rowCount: 7, rows: [] },
    { rowCount: 3, rows: [] },
    { rowCount: 2, rows: [] },
  ]);
  const store = createSessionSignalStore(database);

  assert.equal(await store.deleteExpiredSignals(50_000), 7);
  assert.equal(await store.clearSession(SESSION_ID), 3);
  assert.equal(await store.clearSupersededAttempts(SESSION_ID, TRANSPORT_ATTEMPT_ID), 2);

  assert.deepEqual(database.queries[0]?.values, [MAX_EXPIRED_SIGNAL_DELETE_LIMIT]);
  assert.match(database.queries[0]?.sql ?? '', /WHERE expires_at <= NOW\(\)/);
  assert.match(database.queries[0]?.sql ?? '', /FOR UPDATE SKIP LOCKED/);
  assert.match(database.queries[0]?.sql ?? '', /DELETE FROM matchmaking_session_signals AS signals/);
  assert.deepEqual(database.queries[1]?.values, [SESSION_ID]);
  assert.equal(
    database.queries[1]?.sql,
    'DELETE FROM matchmaking_session_signals WHERE session_id = $1',
  );
  assert.deepEqual(database.queries[2]?.values, [SESSION_ID, TRANSPORT_ATTEMPT_ID]);
  assert.match(database.queries[2]?.sql ?? '', /transport_attempt_id <> \$2/);

  await assert.rejects(store.deleteExpiredSignals(0), /limit must be a positive integer/);
  await assert.rejects(store.clearSession('bad-session-id'), /sessionId must be a UUID/);
  await assert.rejects(
    store.clearSupersededAttempts(SESSION_ID, 'bad-attempt-id'),
    /currentTransportAttemptId must be a UUID/,
  );
  assert.equal(database.queries.length, 3);
});

test('rejects corrupt signal rows returned by the database', async () => {
  const database = new QueryRecorder([{
    rowCount: 1,
    rows: [signalRow({ signal_type: 'candidate' })],
  }]);
  const store = createSessionSignalStore(database);

  await assert.rejects(
    store.readPeerSignals({
      sessionId: SESSION_ID,
      transportAttemptId: TRANSPORT_ATTEMPT_ID,
      recipientAccountId: RECIPIENT_ACCOUNT_ID,
    }),
    /invalid session signal type/,
  );
});

function validPublishInput(): PublishSessionSignalInput {
  return {
    sessionId: SESSION_ID,
    transportAttemptId: TRANSPORT_ATTEMPT_ID,
    senderAccountId: SENDER_ACCOUNT_ID,
    recipientAccountId: RECIPIENT_ACCOUNT_ID,
    clientMessageId: 'offer-1',
    type: 'offer',
    payload: { sdp: 'v=0' },
  };
}

function signalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signal_id: '41',
    session_id: SESSION_ID,
    transport_attempt_id: TRANSPORT_ATTEMPT_ID,
    sender_account_id: SENDER_ACCOUNT_ID,
    recipient_account_id: RECIPIENT_ACCOUNT_ID,
    client_message_id: 'offer-1',
    signal_type: 'offer',
    payload_json: { sdp: 'v=0' },
    created_at: new Date(CREATED_AT),
    expires_at: EXPIRES_AT,
    ...overrides,
  };
}

function publishRejectedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signal_id: null,
    client_message_exists: false,
    session_message_count: 0,
    session_payload_bytes: 0,
    sender_message_count: 0,
    sender_payload_bytes: 0,
    new_payload_bytes: 10,
    ...overrides,
  };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
