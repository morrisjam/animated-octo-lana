import { Buffer } from 'node:buffer';

export const SESSION_SIGNAL_TYPES = ['offer', 'answer', 'ice_candidate', 'end_of_candidates'] as const;
export type SessionSignalType = (typeof SESSION_SIGNAL_TYPES)[number];

export type SessionSignalJson =
  | null
  | boolean
  | number
  | string
  | SessionSignalJson[]
  | { [key: string]: SessionSignalJson };

export type SessionSignalId = string;

export const DEFAULT_SESSION_SIGNAL_TTL_SECONDS = 10 * 60;
export const DEFAULT_SESSION_SIGNAL_READ_LIMIT = 50;
export const MAX_SESSION_SIGNAL_READ_LIMIT = 100;
export const DEFAULT_EXPIRED_SIGNAL_DELETE_LIMIT = 500;
export const MAX_EXPIRED_SIGNAL_DELETE_LIMIT = 1_000;
export const MAX_SESSION_SIGNAL_PAYLOAD_BYTES = 64 * 1024;
export const MAX_SESSION_SIGNAL_CLIENT_MESSAGE_ID_LENGTH = 128;
export const DEFAULT_SESSION_SIGNAL_MAX_MESSAGES = 512;
export const DEFAULT_SESSION_SIGNAL_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_SESSION_SIGNAL_MAX_MESSAGES_PER_SENDER = 256;
export const DEFAULT_SESSION_SIGNAL_MAX_BYTES_PER_SENDER = 1024 * 1024;

const MAX_SESSION_SIGNAL_TTL_SECONDS = 24 * 60 * 60;
const MAX_CONFIGURED_SESSION_SIGNAL_MESSAGES = 10_000;
const MAX_CONFIGURED_SESSION_SIGNAL_BYTES = 64 * 1024 * 1024;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface SessionSignalStoreDatabase {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
}

export interface SessionSignalStoreOptions {
  ttlSeconds?: number;
  maxMessagesPerSession?: number;
  maxBytesPerSession?: number;
  maxMessagesPerSender?: number;
  maxBytesPerSender?: number;
}

export interface PublishSessionSignalInput {
  sessionId: string;
  transportAttemptId: string;
  senderAccountId: string;
  recipientAccountId: string;
  clientMessageId: string;
  type: SessionSignalType;
  payload: SessionSignalJson;
}

export interface ReadPeerSessionSignalsInput {
  sessionId: string;
  transportAttemptId: string;
  recipientAccountId: string;
  afterSignalId?: SessionSignalId;
  limit?: number;
}

export interface SessionSignal {
  signalId: SessionSignalId;
  sessionId: string;
  transportAttemptId: string;
  senderAccountId: string;
  recipientAccountId: string;
  clientMessageId: string;
  type: SessionSignalType;
  payload: SessionSignalJson;
  createdAt: string;
  expiresAt: string;
}

export interface ReadPeerSessionSignalsResult {
  signals: SessionSignal[];
  nextAfterSignalId: SessionSignalId;
}

export class SessionSignalConflictError extends Error {
  public constructor() {
    super('clientMessageId was already used for different signaling content.');
    this.name = 'SessionSignalConflictError';
  }
}

export type SessionSignalQuotaScope =
  | 'session_messages'
  | 'session_bytes'
  | 'sender_messages'
  | 'sender_bytes';

export class SessionSignalQuotaExceededError extends Error {
  public constructor(public readonly scope: SessionSignalQuotaScope) {
    super('WebRTC signaling mailbox quota exceeded for this session.');
    this.name = 'SessionSignalQuotaExceededError';
  }
}

export function isSessionSignalType(value: unknown): value is SessionSignalType {
  return typeof value === 'string' && (SESSION_SIGNAL_TYPES as readonly string[]).includes(value);
}

export class SessionSignalStore {
  private readonly ttlSeconds: number;

  private readonly maxMessagesPerSession: number;

  private readonly maxBytesPerSession: number;

  private readonly maxMessagesPerSender: number;

  private readonly maxBytesPerSender: number;

  public constructor(
    private readonly database: SessionSignalStoreDatabase,
    options: SessionSignalStoreOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_SIGNAL_TTL_SECONDS;
    assertPositiveIntegerAtMost(
      this.ttlSeconds,
      MAX_SESSION_SIGNAL_TTL_SECONDS,
      'ttlSeconds',
    );
    this.maxMessagesPerSession = options.maxMessagesPerSession
      ?? DEFAULT_SESSION_SIGNAL_MAX_MESSAGES;
    this.maxBytesPerSession = options.maxBytesPerSession
      ?? DEFAULT_SESSION_SIGNAL_MAX_BYTES;
    this.maxMessagesPerSender = options.maxMessagesPerSender
      ?? DEFAULT_SESSION_SIGNAL_MAX_MESSAGES_PER_SENDER;
    this.maxBytesPerSender = options.maxBytesPerSender
      ?? DEFAULT_SESSION_SIGNAL_MAX_BYTES_PER_SENDER;
    assertPositiveIntegerAtMost(
      this.maxMessagesPerSession,
      MAX_CONFIGURED_SESSION_SIGNAL_MESSAGES,
      'maxMessagesPerSession',
    );
    assertPositiveIntegerAtMost(
      this.maxBytesPerSession,
      MAX_CONFIGURED_SESSION_SIGNAL_BYTES,
      'maxBytesPerSession',
    );
    assertPositiveIntegerAtMost(
      this.maxMessagesPerSender,
      this.maxMessagesPerSession,
      'maxMessagesPerSender',
    );
    assertPositiveIntegerAtMost(
      this.maxBytesPerSender,
      this.maxBytesPerSession,
      'maxBytesPerSender',
    );
  }

  public async publishSignal(input: PublishSessionSignalInput): Promise<SessionSignal> {
    assertUuid(input.sessionId, 'sessionId');
    assertUuid(input.transportAttemptId, 'transportAttemptId');
    assertUuid(input.senderAccountId, 'senderAccountId');
    assertUuid(input.recipientAccountId, 'recipientAccountId');
    if (input.senderAccountId.toLowerCase() === input.recipientAccountId.toLowerCase()) {
      throw new TypeError('senderAccountId and recipientAccountId must identify different accounts.');
    }
    assertClientMessageId(input.clientMessageId);
    if (!isSessionSignalType(input.type)) {
      throw new TypeError(`type must be one of: ${SESSION_SIGNAL_TYPES.join(', ')}.`);
    }
    const payloadJson = serializePayload(input.payload);

    const result = await this.database.query(
      `
      WITH session_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(
          hashtext('matchmaking_session_signals:' || $1::uuid::text)
        )
      ),
      existing AS MATERIALIZED (
        SELECT signals.signal_id
        FROM matchmaking_session_signals AS signals, session_lock
        WHERE signals.session_id = $1
          AND signals.sender_account_id = $3
          AND signals.client_message_id = $5
        LIMIT 1
      ),
      usage AS MATERIALIZED (
        SELECT
          COUNT(*)::int AS session_message_count,
          COALESCE(SUM(OCTET_LENGTH(signals.payload_json::text)), 0)::bigint
            AS session_payload_bytes,
          COUNT(*) FILTER (WHERE signals.sender_account_id = $3)::int
            AS sender_message_count,
          COALESCE(
            SUM(OCTET_LENGTH(signals.payload_json::text))
              FILTER (WHERE signals.sender_account_id = $3),
            0
          )::bigint AS sender_payload_bytes
        FROM matchmaking_session_signals AS signals, session_lock
        WHERE signals.session_id = $1
          AND signals.expires_at > NOW()
      ),
      published AS (
        INSERT INTO matchmaking_session_signals(
          session_id,
          transport_attempt_id,
          sender_account_id,
          recipient_account_id,
          client_message_id,
          signal_type,
          payload_json,
          expires_at
        )
        SELECT
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          NOW() + ($8::integer * INTERVAL '1 second')
        FROM usage
        WHERE EXISTS (SELECT 1 FROM existing)
          OR (
            usage.session_message_count < $9
            AND usage.session_payload_bytes + OCTET_LENGTH($7::jsonb::text) <= $10
            AND usage.sender_message_count < $11
            AND usage.sender_payload_bytes + OCTET_LENGTH($7::jsonb::text) <= $12
          )
        ON CONFLICT (session_id, sender_account_id, client_message_id)
        DO UPDATE SET signal_id = matchmaking_session_signals.signal_id
        WHERE matchmaking_session_signals.recipient_account_id = EXCLUDED.recipient_account_id
          AND matchmaking_session_signals.transport_attempt_id = EXCLUDED.transport_attempt_id
          AND matchmaking_session_signals.signal_type = EXCLUDED.signal_type
          AND matchmaking_session_signals.payload_json = EXCLUDED.payload_json
        RETURNING
          signal_id,
          session_id,
          transport_attempt_id,
          sender_account_id,
          recipient_account_id,
          client_message_id,
          signal_type,
          payload_json,
          created_at,
          expires_at
      )
      SELECT
        published.*,
        usage.session_message_count,
        usage.session_payload_bytes,
        usage.sender_message_count,
        usage.sender_payload_bytes,
        EXISTS(SELECT 1 FROM existing) AS client_message_exists,
        OCTET_LENGTH($7::jsonb::text)::int AS new_payload_bytes
      FROM usage
      LEFT JOIN published ON TRUE
      `,
      [
        input.sessionId,
        input.transportAttemptId,
        input.senderAccountId,
        input.recipientAccountId,
        input.clientMessageId,
        input.type,
        payloadJson,
        this.ttlSeconds,
        this.maxMessagesPerSession,
        this.maxBytesPerSession,
        this.maxMessagesPerSender,
        this.maxBytesPerSender,
      ],
    );

    if (result.rows.length !== 1) {
      throw new Error('WebRTC signaling publish query returned an invalid result.');
    }
    const row = asRecord(result.rows[0]);
    if (row.signal_id !== null && row.signal_id !== undefined) {
      return mapSignalRow(row);
    }
    if (row.client_message_exists === true) {
      throw new SessionSignalConflictError();
    }
    const newPayloadBytes = nonNegativeInteger(row.new_payload_bytes, 'new_payload_bytes');
    const senderMessages = nonNegativeInteger(row.sender_message_count, 'sender_message_count');
    const senderBytes = nonNegativeInteger(row.sender_payload_bytes, 'sender_payload_bytes');
    const sessionMessages = nonNegativeInteger(row.session_message_count, 'session_message_count');
    const sessionBytes = nonNegativeInteger(row.session_payload_bytes, 'session_payload_bytes');
    if (senderMessages >= this.maxMessagesPerSender) {
      throw new SessionSignalQuotaExceededError('sender_messages');
    }
    if (senderBytes + newPayloadBytes > this.maxBytesPerSender) {
      throw new SessionSignalQuotaExceededError('sender_bytes');
    }
    if (sessionMessages >= this.maxMessagesPerSession) {
      throw new SessionSignalQuotaExceededError('session_messages');
    }
    if (sessionBytes + newPayloadBytes > this.maxBytesPerSession) {
      throw new SessionSignalQuotaExceededError('session_bytes');
    }
    throw new Error('WebRTC signaling publish was rejected without a conflict or quota reason.');
  }

  public async readPeerSignals(input: ReadPeerSessionSignalsInput): Promise<ReadPeerSessionSignalsResult> {
    assertUuid(input.sessionId, 'sessionId');
    assertUuid(input.transportAttemptId, 'transportAttemptId');
    assertUuid(input.recipientAccountId, 'recipientAccountId');
    const afterSignalId = normaliseSignalId(input.afterSignalId ?? '0', true, 'afterSignalId');
    const requestedLimit = input.limit ?? DEFAULT_SESSION_SIGNAL_READ_LIMIT;
    assertPositiveIntegerAtMost(requestedLimit, Number.MAX_SAFE_INTEGER, 'limit');
    const limit = Math.min(requestedLimit, MAX_SESSION_SIGNAL_READ_LIMIT);

    const result = await this.database.query(
      `
      SELECT
        signal_id,
        session_id,
        transport_attempt_id,
        sender_account_id,
        recipient_account_id,
        client_message_id,
        signal_type,
        payload_json,
        created_at,
        expires_at
      FROM matchmaking_session_signals
      WHERE session_id = $1
        AND transport_attempt_id = $2
        AND recipient_account_id = $3
        AND sender_account_id <> $3
        AND signal_id > $4::bigint
        AND expires_at > NOW()
      ORDER BY signal_id ASC
      LIMIT $5
      `,
      [
        input.sessionId,
        input.transportAttemptId,
        input.recipientAccountId,
        afterSignalId,
        limit,
      ],
    );

    const signals = result.rows.map(mapSignalRow);
    return {
      signals,
      nextAfterSignalId: signals.at(-1)?.signalId ?? afterSignalId,
    };
  }

  public async deleteExpiredSignals(limit = DEFAULT_EXPIRED_SIGNAL_DELETE_LIMIT): Promise<number> {
    assertPositiveIntegerAtMost(limit, Number.MAX_SAFE_INTEGER, 'limit');
    const deleteLimit = Math.min(limit, MAX_EXPIRED_SIGNAL_DELETE_LIMIT);
    const result = await this.database.query(
      `
      WITH expired AS MATERIALIZED (
        SELECT signal_id
        FROM matchmaking_session_signals
        WHERE expires_at <= NOW()
        ORDER BY expires_at ASC, signal_id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM matchmaking_session_signals AS signals
      USING expired
      WHERE signals.signal_id = expired.signal_id
      `,
      [deleteLimit],
    );
    return result.rowCount ?? 0;
  }

  public async clearSession(sessionId: string): Promise<number> {
    assertUuid(sessionId, 'sessionId');
    const result = await this.database.query(
      'DELETE FROM matchmaking_session_signals WHERE session_id = $1',
      [sessionId],
    );
    return result.rowCount ?? 0;
  }

  public async clearSupersededAttempts(
    sessionId: string,
    currentTransportAttemptId: string,
  ): Promise<number> {
    assertUuid(sessionId, 'sessionId');
    assertUuid(currentTransportAttemptId, 'currentTransportAttemptId');
    const result = await this.database.query(
      `
      DELETE FROM matchmaking_session_signals
      WHERE session_id = $1
        AND transport_attempt_id <> $2
      `,
      [sessionId, currentTransportAttemptId],
    );
    return result.rowCount ?? 0;
  }
}

export function createSessionSignalStore(
  database: SessionSignalStoreDatabase,
  options: SessionSignalStoreOptions = {},
): SessionSignalStore {
  return new SessionSignalStore(database, options);
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new TypeError(`${field} must be a UUID.`);
  }
}

function assertClientMessageId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SESSION_SIGNAL_CLIENT_MESSAGE_ID_LENGTH
    || value.trim() !== value
  ) {
    throw new TypeError(
      `clientMessageId must be a trimmed string between 1 and ${MAX_SESSION_SIGNAL_CLIENT_MESSAGE_ID_LENGTH} characters.`,
    );
  }
}

function assertPositiveIntegerAtMost(value: number, maximum: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${field} must be a positive integer no greater than ${maximum}.`);
  }
}

function normaliseSignalId(value: unknown, allowZero: boolean, field: string): SessionSignalId {
  const asString = typeof value === 'bigint'
    ? value.toString()
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof asString !== 'string' || !/^(0|[1-9][0-9]*)$/.test(asString)) {
    throw new TypeError(`${field} must be a non-negative PostgreSQL bigint string.`);
  }
  const parsed = BigInt(asString);
  if ((!allowZero && parsed === 0n) || parsed > POSTGRES_BIGINT_MAX) {
    throw new TypeError(`${field} is outside the supported PostgreSQL bigint range.`);
  }
  return asString;
}

function serializePayload(payload: SessionSignalJson): string {
  assertJsonValue(payload, new Set<object>());
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new TypeError('payload must be serializable JSON.');
  }
  if (serialized === undefined) {
    throw new TypeError('payload must be serializable JSON.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SESSION_SIGNAL_PAYLOAD_BYTES) {
    throw new TypeError(`payload must not exceed ${MAX_SESSION_SIGNAL_PAYLOAD_BYTES} UTF-8 bytes.`);
  }
  return serialized;
}

function assertJsonValue(value: unknown, ancestors: Set<object>): asserts value is SessionSignalJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('payload must contain only finite JSON numbers.');
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError('payload must contain only JSON values.');
  }
  if (ancestors.has(value)) {
    throw new TypeError('payload must not contain circular references.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        assertJsonValue(item, ancestors);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('payload objects must use a plain object prototype.');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('payload objects must not contain symbol keys.');
    }
    for (const item of Object.values(value)) {
      assertJsonValue(item, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function mapSignalRow(value: unknown): SessionSignal {
  const row = asRecord(value);
  const type = row.signal_type;
  if (!isSessionSignalType(type)) {
    throw new Error(`PostgreSQL returned an invalid session signal type: ${String(type)}.`);
  }
  try {
    assertJsonValue(row.payload_json, new Set<object>());
  } catch {
    throw new Error('PostgreSQL returned an invalid session signal JSON payload.');
  }

  return {
    signalId: normaliseSignalId(row.signal_id, false, 'signal_id'),
    sessionId: requiredString(row.session_id, 'session_id'),
    transportAttemptId: requiredString(row.transport_attempt_id, 'transport_attempt_id'),
    senderAccountId: requiredString(row.sender_account_id, 'sender_account_id'),
    recipientAccountId: requiredString(row.recipient_account_id, 'recipient_account_id'),
    clientMessageId: requiredString(row.client_message_id, 'client_message_id'),
    type,
    payload: row.payload_json,
    createdAt: normaliseTimestamp(row.created_at, 'created_at'),
    expiresAt: normaliseTimestamp(row.expires_at, 'expires_at'),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PostgreSQL returned an invalid session signal row.');
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`PostgreSQL returned an invalid ${field} value.`);
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`PostgreSQL returned an invalid ${field} value.`);
  }
  return value;
}

function normaliseTimestamp(value: unknown, field: string): string {
  const timestamp = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    throw new Error(`PostgreSQL returned an invalid ${field} timestamp.`);
  }
  return timestamp.toISOString();
}
