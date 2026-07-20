import { createHash, timingSafeEqual } from 'node:crypto';
import type { MatchmakingQueueSnapshot } from './queueService';
import { resolveMatchmakingRuntimeSnapshotKey } from './runtimeStateStore';

interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface MatchmakingSessionAccessDatabase {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
}

export interface MatchmakingSessionAccessStoreOptions {
  snapshotKey?: string;
  now?: () => number;
}

export type MatchmakingSessionAccessErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'session_resolved'
  | 'token_expired'
  | 'invalid_token'
  | 'stale_transport_attempt';

export type MatchmakingSessionSignalAccessResult =
  | {
    ok: true;
    value: {
      peerAccountId: string;
      side: 'P1' | 'P2';
    };
  }
  | {
    ok: false;
    error: {
      code: MatchmakingSessionAccessErrorCode;
      message: string;
    };
  };

export interface ValidateMatchmakingSessionSignalAccessInput {
  sessionId: string;
  accountId: string;
  sessionToken: string;
  transportAttemptId: string;
}

export interface ValidateMatchmakingLiveSessionAccessInput {
  sessionId: string;
  accountId: string;
  sessionToken: string;
}

interface SessionAccessProjection {
  sessionId: string;
  accountId: string;
  peerAccountId: string;
  side: 'P1' | 'P2';
  sessionTokenHashHex: string;
  sessionTokenExpiresAt: string;
  transportAttemptId: string;
  sessionStatus: 'active' | 'resolved';
  sessionExpiresAt: string;
  signalAccessExpiresAt: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MatchmakingSessionAccessStore {
  private readonly snapshotKey: string;

  private readonly now: () => number;

  public constructor(
    private readonly database: MatchmakingSessionAccessDatabase,
    options: MatchmakingSessionAccessStoreOptions = {},
  ) {
    this.snapshotKey = resolveMatchmakingRuntimeSnapshotKey(options.snapshotKey);
    this.now = options.now ?? Date.now;
  }

  public async replaceFromSnapshot(
    snapshot: MatchmakingQueueSnapshot,
    database: MatchmakingSessionAccessDatabase = this.database,
  ): Promise<void> {
    const projections = buildSessionAccessProjections(snapshot);
    const result = await database.query(
      `
      WITH incoming AS MATERIALIZED (
        SELECT *
        FROM jsonb_to_recordset($2::jsonb) AS projected(
          session_id uuid,
          account_id uuid,
          peer_account_id uuid,
          player_side text,
          session_token_hash_hex text,
          session_token_expires_at timestamptz,
          transport_attempt_id uuid,
          session_status text,
          session_expires_at timestamptz,
          signal_access_expires_at timestamptz
        )
      ),
      upserted AS (
        INSERT INTO matchmaking_session_access(
          snapshot_key,
          session_id,
          account_id,
          peer_account_id,
          player_side,
          session_token_hash,
          session_token_expires_at,
          transport_attempt_id,
          session_status,
          session_expires_at,
          signal_access_expires_at,
          updated_at
        )
        SELECT
          $1,
          session_id,
          account_id,
          peer_account_id,
          player_side,
          DECODE(session_token_hash_hex, 'hex'),
          session_token_expires_at,
          transport_attempt_id,
          session_status,
          session_expires_at,
          signal_access_expires_at,
          NOW()
        FROM incoming
        ON CONFLICT (snapshot_key, session_id, account_id)
        DO UPDATE SET
          peer_account_id = EXCLUDED.peer_account_id,
          player_side = EXCLUDED.player_side,
          session_token_hash = EXCLUDED.session_token_hash,
          session_token_expires_at = EXCLUDED.session_token_expires_at,
          transport_attempt_id = EXCLUDED.transport_attempt_id,
          session_status = EXCLUDED.session_status,
          session_expires_at = EXCLUDED.session_expires_at,
          signal_access_expires_at = EXCLUDED.signal_access_expires_at,
          updated_at = NOW()
        RETURNING session_id, account_id
      ),
      deleted AS (
        DELETE FROM matchmaking_session_access AS access
        WHERE access.snapshot_key = $1
          AND NOT EXISTS (
            SELECT 1
            FROM incoming
            WHERE incoming.session_id = access.session_id
              AND incoming.account_id = access.account_id
          )
        RETURNING access.session_id, access.account_id
      )
      SELECT
        (SELECT COUNT(*)::int FROM upserted) AS upserted_count,
        (SELECT COUNT(*)::int FROM deleted) AS deleted_count
      `,
      [this.snapshotKey, JSON.stringify(projections.map(toDatabaseProjection))],
    );
    if (result.rows.length !== 1) {
      throw new Error('Failed to replace the matchmaking session access projection.');
    }
  }

  public async validateSignalAccess(
    input: ValidateMatchmakingSessionSignalAccessInput,
    database: MatchmakingSessionAccessDatabase = this.database,
  ): Promise<MatchmakingSessionSignalAccessResult> {
    assertUuid(input.sessionId, 'sessionId');
    assertUuid(input.accountId, 'accountId');
    assertUuid(input.transportAttemptId, 'transportAttemptId');
    if (typeof input.sessionToken !== 'string' || input.sessionToken.length === 0) {
      throw new TypeError('sessionToken is required.');
    }
    return await this.validateLiveAccess(input, database, input.transportAttemptId);
  }

  public async validateLiveSessionAccess(
    input: ValidateMatchmakingLiveSessionAccessInput,
    database: MatchmakingSessionAccessDatabase = this.database,
  ): Promise<MatchmakingSessionSignalAccessResult> {
    assertUuid(input.sessionId, 'sessionId');
    assertUuid(input.accountId, 'accountId');
    if (typeof input.sessionToken !== 'string' || input.sessionToken.length === 0) {
      throw new TypeError('sessionToken is required.');
    }
    return await this.validateLiveAccess(input, database, null);
  }

  private async validateLiveAccess(
    input: ValidateMatchmakingLiveSessionAccessInput,
    database: MatchmakingSessionAccessDatabase,
    transportAttemptId: string | null,
  ): Promise<MatchmakingSessionSignalAccessResult> {
    const result = await database.query(
      `
      WITH session_rows AS MATERIALIZED (
        SELECT *
        FROM matchmaking_session_access
        WHERE snapshot_key = $1 AND session_id = $2
      )
      SELECT
        EXISTS(SELECT 1 FROM session_rows) AS session_exists,
        access.account_id,
        access.peer_account_id,
        access.player_side,
        access.session_token_hash,
        access.session_token_expires_at,
        access.transport_attempt_id,
        access.session_status,
        access.session_expires_at,
        access.signal_access_expires_at
      FROM (SELECT 1) AS seed
      LEFT JOIN session_rows AS access ON access.account_id = $3
      LIMIT 1
      `,
      [this.snapshotKey, input.sessionId, input.accountId],
    );
    if (result.rows.length !== 1) {
      throw new Error('Matchmaking session access query returned an invalid result.');
    }
    const row = asRecord(result.rows[0]);
    if (row.session_exists !== true) {
      return accessError('not_found', 'Session not found.');
    }
    if (row.account_id === null || row.account_id === undefined) {
      return accessError('forbidden', 'Session does not contain this account.');
    }
    const nowMs = this.now();
    const sessionExpiresAtMs = timestampMs(row.session_expires_at, 'session_expires_at');
    const signalAccessExpiresAtMs = timestampMs(
      row.signal_access_expires_at,
      'signal_access_expires_at',
    );
    if (
      row.session_status !== 'active'
      || nowMs > sessionExpiresAtMs
      || nowMs > signalAccessExpiresAtMs
    ) {
      return accessError('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > timestampMs(row.session_token_expires_at, 'session_token_expires_at')) {
      return accessError('token_expired', 'Session token has expired.');
    }
    const expectedTokenHash = requiredBuffer(row.session_token_hash, 'session_token_hash');
    const providedTokenHash = hashSessionToken(input.sessionToken);
    if (
      expectedTokenHash.length !== providedTokenHash.length
      || !timingSafeEqual(expectedTokenHash, providedTokenHash)
    ) {
      return accessError('invalid_token', 'Session token is invalid.');
    }
    if (
      transportAttemptId !== null
      && requiredString(row.transport_attempt_id, 'transport_attempt_id') !== transportAttemptId
    ) {
      return accessError('stale_transport_attempt', 'Transport attempt is stale.');
    }
    const side = row.player_side;
    if (side !== 'P1' && side !== 'P2') {
      throw new Error('PostgreSQL returned an invalid player_side value.');
    }
    return {
      ok: true,
      value: {
        peerAccountId: requiredString(row.peer_account_id, 'peer_account_id'),
        side,
      },
    };
  }
}

export function createMatchmakingSessionAccessStore(
  database: MatchmakingSessionAccessDatabase,
  options: MatchmakingSessionAccessStoreOptions = {},
): MatchmakingSessionAccessStore {
  return new MatchmakingSessionAccessStore(database, options);
}

export function hashSessionToken(sessionToken: string): Buffer {
  return createHash('sha256')
    .update('gravity-well-match-session-v1\0', 'utf8')
    .update(sessionToken, 'utf8')
    .digest();
}

function buildSessionAccessProjections(snapshot: MatchmakingQueueSnapshot): SessionAccessProjection[] {
  if (snapshot.version !== 1 || !Array.isArray(snapshot.sessions)) {
    throw new TypeError('Matchmaking snapshot version is invalid.');
  }
  const projections: SessionAccessProjection[] = [];
  for (const session of snapshot.sessions) {
    assertUuid(session.sessionId, 'snapshot sessionId');
    assertUuid(session.transportAttemptId, 'snapshot transportAttemptId');
    if (session.status !== 'active' && session.status !== 'resolved') {
      throw new TypeError('Snapshot session status is invalid.');
    }
    if (session.participants.length !== 2) {
      throw new TypeError('Matchmaking session access requires exactly two participants.');
    }
    const signalAccessExpiresAtMs = session.participants.reduce(
      (earliestDeadlineAtMs, participant) => (
        participant.reconnectDeadlineAtMs === undefined
          ? earliestDeadlineAtMs
          : Math.min(earliestDeadlineAtMs, participant.reconnectDeadlineAtMs)
      ),
      session.expiresAtMs,
    );
    const [first, second] = session.participants;
    for (const [participant, peer] of [[first, second], [second, first]] as const) {
      assertUuid(participant.accountId, 'snapshot accountId');
      assertUuid(peer.accountId, 'snapshot peerAccountId');
      if (participant.accountId === peer.accountId) {
        throw new TypeError('Matchmaking session participants must be distinct.');
      }
      if (typeof participant.sessionToken !== 'string' || participant.sessionToken.length === 0) {
        throw new TypeError('Snapshot session token is required.');
      }
      projections.push({
        sessionId: session.sessionId,
        accountId: participant.accountId,
        peerAccountId: peer.accountId,
        side: participant.side,
        sessionTokenHashHex: hashSessionToken(participant.sessionToken).toString('hex'),
        sessionTokenExpiresAt: isoTimestamp(participant.sessionTokenExpiresAtMs, 'sessionTokenExpiresAtMs'),
        transportAttemptId: session.transportAttemptId,
        sessionStatus: session.status,
        sessionExpiresAt: isoTimestamp(session.expiresAtMs, 'session expiresAtMs'),
        signalAccessExpiresAt: isoTimestamp(
          signalAccessExpiresAtMs,
          'signal access expiresAtMs',
        ),
      });
    }
  }
  return projections;
}

function toDatabaseProjection(projection: SessionAccessProjection): Record<string, unknown> {
  return {
    session_id: projection.sessionId,
    account_id: projection.accountId,
    peer_account_id: projection.peerAccountId,
    player_side: projection.side,
    session_token_hash_hex: projection.sessionTokenHashHex,
    session_token_expires_at: projection.sessionTokenExpiresAt,
    transport_attempt_id: projection.transportAttemptId,
    session_status: projection.sessionStatus,
    session_expires_at: projection.sessionExpiresAt,
    signal_access_expires_at: projection.signalAccessExpiresAt,
  };
}

function accessError(
  code: MatchmakingSessionAccessErrorCode,
  message: string,
): MatchmakingSessionSignalAccessResult {
  return { ok: false, error: { code, message } };
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new TypeError(`${field} must be a UUID.`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PostgreSQL returned an invalid matchmaking session access row.');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`PostgreSQL returned an invalid ${field} value.`);
  }
  return value;
}

function requiredBuffer(value: unknown, field: string): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error(`PostgreSQL returned an invalid ${field} value.`);
  }
  return value;
}

function timestampMs(value: unknown, field: string): number {
  const parsed = value instanceof Date
    ? value.getTime()
    : typeof value === 'string'
      ? Date.parse(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`PostgreSQL returned an invalid ${field} timestamp.`);
  }
  return parsed;
}

function isoTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite timestamp.`);
  }
  return new Date(value).toISOString();
}
