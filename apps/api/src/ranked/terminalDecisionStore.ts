import { Buffer } from 'node:buffer';

export const RANKED_TERMINAL_DECISION_TYPES = ['forfeit', 'no_contest'] as const;
export const RANKED_TERMINAL_DECISION_STATUSES = [
  'pending',
  'processing',
  'settled',
  'superseded',
] as const;

export const DEFAULT_RANKED_TERMINAL_DECISION_CLAIM_LIMIT = 25;
export const MAX_RANKED_TERMINAL_DECISION_CLAIM_LIMIT = 100;
export const DEFAULT_RANKED_TERMINAL_DECISION_LEASE_SECONDS = 30;
export const MAX_RANKED_TERMINAL_DECISION_LEASE_SECONDS = 5 * 60;
export const DEFAULT_RANKED_TERMINAL_DECISION_RETRY_BASE_SECONDS = 5;
export const DEFAULT_RANKED_TERMINAL_DECISION_RETRY_MAX_SECONDS = 5 * 60;
export const MAX_RANKED_TERMINAL_DECISION_RETRY_SECONDS = 24 * 60 * 60;
export const MAX_RANKED_TERMINAL_DECISION_REASON_BYTES = 256;
export const MAX_RANKED_TERMINAL_DECISION_LAST_ERROR_BYTES = 2_048;
export const RANKED_SESSION_TRANSACTION_LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtext($1))';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RETRY_EXPONENT = 30;

interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface RankedTerminalDecisionQueryClient {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
}

export type RankedTerminalDecisionType = (typeof RANKED_TERMINAL_DECISION_TYPES)[number];
export type RankedTerminalDecisionStatus = (typeof RANKED_TERMINAL_DECISION_STATUSES)[number];
export type RankedTerminalDecisionReason = 'reconnect_timeout' | 'peer_left' | 'session_expired';

interface RankedTerminalDecisionInputBase {
  sessionId: string;
  participantP1AccountId: string;
  participantP2AccountId: string;
  dueAt: string;
  decidedAt: string;
}

export type EnqueueRankedTerminalDecisionInput = RankedTerminalDecisionInputBase & (
  | {
    decisionType: 'forfeit';
    reason: 'reconnect_timeout' | 'peer_left';
    winnerAccountId: string;
    forfeitingAccountId: string;
  }
  | {
    decisionType: 'no_contest';
    reason: 'reconnect_timeout' | 'session_expired';
    winnerAccountId: null;
    forfeitingAccountId: null;
  }
);

export interface RankedTerminalDecision {
  sessionId: string;
  decisionType: RankedTerminalDecisionType;
  participantP1AccountId: string;
  participantP2AccountId: string;
  winnerAccountId: string | null;
  forfeitingAccountId: string | null;
  reason: RankedTerminalDecisionReason;
  dueAt: string;
  decidedAt: string;
  status: RankedTerminalDecisionStatus;
  attemptCount: number;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string;
  lastError: string | null;
  settledMatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RankedTerminalDecisionStoreOptions {
  defaultClaimLimit?: number;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
  retryMaxSeconds?: number;
}

export interface ClaimRankedTerminalDecisionBatchInput {
  limit?: number;
}

export interface MarkRankedTerminalDecisionSettledInput {
  sessionId: string;
  claimToken: string;
  settledMatchId?: string | null;
}

export interface MarkRankedTerminalDecisionSupersededInput {
  sessionId: string;
  claimToken: string;
}

export interface MarkRankedTerminalDecisionRetryInput {
  sessionId: string;
  claimToken: string;
  error: unknown;
}

export class RankedTerminalDecisionConflictError extends Error {
  public readonly sessionId: string;

  public constructor(sessionId: string) {
    super(`Ranked terminal decision for session ${sessionId} conflicts with the persisted decision.`);
    this.name = 'RankedTerminalDecisionConflictError';
    this.sessionId = sessionId;
  }
}

export class RankedTerminalDecisionStore {
  private readonly defaultClaimLimit: number;
  private readonly leaseSeconds: number;
  private readonly retryBaseSeconds: number;
  private readonly retryMaxSeconds: number;

  public constructor(
    private readonly database: RankedTerminalDecisionQueryClient,
    options: RankedTerminalDecisionStoreOptions = {},
  ) {
    this.defaultClaimLimit = options.defaultClaimLimit
      ?? DEFAULT_RANKED_TERMINAL_DECISION_CLAIM_LIMIT;
    this.leaseSeconds = options.leaseSeconds
      ?? DEFAULT_RANKED_TERMINAL_DECISION_LEASE_SECONDS;
    this.retryBaseSeconds = options.retryBaseSeconds
      ?? DEFAULT_RANKED_TERMINAL_DECISION_RETRY_BASE_SECONDS;
    this.retryMaxSeconds = options.retryMaxSeconds
      ?? DEFAULT_RANKED_TERMINAL_DECISION_RETRY_MAX_SECONDS;

    assertPositiveInteger(this.defaultClaimLimit, 'defaultClaimLimit');
    assertPositiveIntegerAtMost(
      this.leaseSeconds,
      MAX_RANKED_TERMINAL_DECISION_LEASE_SECONDS,
      'leaseSeconds',
    );
    assertPositiveIntegerAtMost(
      this.retryBaseSeconds,
      MAX_RANKED_TERMINAL_DECISION_RETRY_SECONDS,
      'retryBaseSeconds',
    );
    assertPositiveIntegerAtMost(
      this.retryMaxSeconds,
      MAX_RANKED_TERMINAL_DECISION_RETRY_SECONDS,
      'retryMaxSeconds',
    );
    if (this.retryBaseSeconds > this.retryMaxSeconds) {
      throw new TypeError('retryBaseSeconds must not exceed retryMaxSeconds.');
    }
  }

  public async enqueue(
    client: RankedTerminalDecisionQueryClient,
    input: EnqueueRankedTerminalDecisionInput,
  ): Promise<RankedTerminalDecision> {
    return await enqueueRankedTerminalDecision(client, input);
  }

  public async claimBatch(
    input: ClaimRankedTerminalDecisionBatchInput | number = {},
  ): Promise<RankedTerminalDecision[]> {
    const requestedLimit = typeof input === 'number'
      ? input
      : input.limit ?? this.defaultClaimLimit;
    assertPositiveInteger(requestedLimit, 'limit');
    const limit = Math.min(requestedLimit, MAX_RANKED_TERMINAL_DECISION_CLAIM_LIMIT);

    const result = await this.database.query(
      `
      WITH claimable AS MATERIALIZED (
        SELECT decisions.session_id
        FROM ranked_terminal_decisions AS decisions
        WHERE (
          decisions.status = 'pending'
          AND decisions.due_at <= NOW()
          AND decisions.next_attempt_at <= NOW()
        ) OR (
          decisions.status = 'processing'
          AND decisions.lease_expires_at <= NOW()
        )
        ORDER BY
          CASE
            WHEN decisions.status = 'processing' THEN decisions.lease_expires_at
            ELSE GREATEST(decisions.due_at, decisions.next_attempt_at)
          END ASC,
          decisions.decided_at ASC,
          decisions.session_id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      ),
      claimed AS (
        UPDATE ranked_terminal_decisions AS decisions
        SET
          status = 'processing',
          attempt_count = decisions.attempt_count + 1,
          claim_token = gen_random_uuid(),
          lease_expires_at = NOW() + ($2::integer * INTERVAL '1 second'),
          updated_at = NOW()
        FROM claimable
        WHERE decisions.session_id = claimable.session_id
        RETURNING
          decisions.session_id,
          decisions.decision_type,
          decisions.participant_p1_account_id,
          decisions.participant_p2_account_id,
          decisions.winner_account_id,
          decisions.forfeiting_account_id,
          decisions.reason,
          decisions.due_at,
          decisions.decided_at,
          decisions.status,
          decisions.attempt_count,
          decisions.claim_token,
          decisions.lease_expires_at,
          decisions.next_attempt_at,
          decisions.last_error,
          decisions.settled_match_id,
          decisions.created_at,
          decisions.updated_at
      )
      SELECT *
      FROM claimed
      ORDER BY decided_at ASC, session_id ASC
      `,
      [limit, this.leaseSeconds],
    );
    return result.rows.map(mapRankedTerminalDecisionRow);
  }

  public async markSettled(input: MarkRankedTerminalDecisionSettledInput): Promise<boolean> {
    const sessionId = normaliseUuid(input.sessionId, 'sessionId');
    const claimToken = normaliseUuid(input.claimToken, 'claimToken');
    const settledMatchId = input.settledMatchId === null || input.settledMatchId === undefined
      ? null
      : normaliseUuid(input.settledMatchId, 'settledMatchId');
    const result = await this.database.query(
      `
      UPDATE ranked_terminal_decisions
      SET
        status = 'settled',
        settled_match_id = $3,
        claim_token = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE session_id = $1
        AND status = 'processing'
        AND claim_token = $2
        AND lease_expires_at > NOW()
      `,
      [sessionId, claimToken, settledMatchId],
    );
    return affectedExactlyOneRow(result);
  }

  public async markSuperseded(input: MarkRankedTerminalDecisionSupersededInput): Promise<boolean> {
    const sessionId = normaliseUuid(input.sessionId, 'sessionId');
    const claimToken = normaliseUuid(input.claimToken, 'claimToken');
    const result = await this.database.query(
      `
      UPDATE ranked_terminal_decisions
      SET
        status = 'superseded',
        claim_token = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE session_id = $1
        AND status = 'processing'
        AND claim_token = $2
        AND lease_expires_at > NOW()
      `,
      [sessionId, claimToken],
    );
    return affectedExactlyOneRow(result);
  }

  public async markRetry(input: MarkRankedTerminalDecisionRetryInput): Promise<boolean> {
    const sessionId = normaliseUuid(input.sessionId, 'sessionId');
    const claimToken = normaliseUuid(input.claimToken, 'claimToken');
    const lastError = normaliseLastError(input.error);
    const result = await this.database.query(
      `
      UPDATE ranked_terminal_decisions
      SET
        status = 'pending',
        claim_token = NULL,
        lease_expires_at = NULL,
        next_attempt_at = NOW() + (
          LEAST(
            $5::numeric,
            $4::numeric * POWER(
              2::numeric,
              LEAST(GREATEST(attempt_count - 1, 0), ${MAX_RETRY_EXPONENT})
            )
          )::double precision * INTERVAL '1 second'
        ),
        last_error = $3,
        updated_at = NOW()
      WHERE session_id = $1
        AND status = 'processing'
        AND claim_token = $2
        AND lease_expires_at > NOW()
      `,
      [sessionId, claimToken, lastError, this.retryBaseSeconds, this.retryMaxSeconds],
    );
    return affectedExactlyOneRow(result);
  }

  public async getNextActionAt(): Promise<string | null> {
    const result = await this.database.query(
      `
      SELECT MIN(
        CASE
          WHEN status = 'pending' THEN GREATEST(due_at, next_attempt_at)
          WHEN status = 'processing' THEN lease_expires_at
          ELSE NULL
        END
      ) AS next_action_at
      FROM ranked_terminal_decisions
      WHERE status IN ('pending', 'processing')
      `,
    );
    if (result.rows.length !== 1) {
      throw new Error('Database did not return one ranked terminal decision wake deadline.');
    }
    const row = result.rows[0];
    if (!row || typeof row !== 'object') {
      throw new Error('Database returned an invalid ranked terminal decision wake deadline.');
    }
    return nullableTimestampFromRow(
      (row as Record<string, unknown>).next_action_at,
      'next_action_at',
    );
  }

  public async getBySession(
    sessionId: string,
    client: RankedTerminalDecisionQueryClient = this.database,
  ): Promise<RankedTerminalDecision | null> {
    const normalisedSessionId = normaliseUuid(sessionId, 'sessionId');
    const result = await client.query(
      `
      SELECT
        session_id,
        decision_type,
        participant_p1_account_id,
        participant_p2_account_id,
        winner_account_id,
        forfeiting_account_id,
        reason,
        due_at,
        decided_at,
        status,
        attempt_count,
        claim_token,
        lease_expires_at,
        next_attempt_at,
        last_error,
        settled_match_id,
        created_at,
        updated_at
      FROM ranked_terminal_decisions
      WHERE session_id = $1
      LIMIT 1
      `,
      [normalisedSessionId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    if (result.rows.length !== 1) {
      throw new Error(`Database returned multiple ranked terminal decisions for session ${normalisedSessionId}.`);
    }
    return mapRankedTerminalDecisionRow(result.rows[0]);
  }
}

export function createRankedTerminalDecisionStore(
  database: RankedTerminalDecisionQueryClient,
  options: RankedTerminalDecisionStoreOptions = {},
): RankedTerminalDecisionStore {
  return new RankedTerminalDecisionStore(database, options);
}

export async function enqueueRankedTerminalDecision(
  client: RankedTerminalDecisionQueryClient,
  input: EnqueueRankedTerminalDecisionInput,
): Promise<RankedTerminalDecision> {
  const decision = normaliseEnqueueInput(input);
  await client.query(RANKED_SESSION_TRANSACTION_LOCK_SQL, [decision.sessionId]);
  const insertResult = await client.query(
    `
    INSERT INTO ranked_terminal_decisions(
      session_id,
      decision_type,
      participant_p1_account_id,
      participant_p2_account_id,
      winner_account_id,
      forfeiting_account_id,
      reason,
      due_at,
      decided_at,
      next_attempt_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8)
    ON CONFLICT (session_id) DO NOTHING
    RETURNING
      session_id,
      decision_type,
      participant_p1_account_id,
      participant_p2_account_id,
      winner_account_id,
      forfeiting_account_id,
      reason,
      due_at,
      decided_at,
      status,
      attempt_count,
      claim_token,
      lease_expires_at,
      next_attempt_at,
      last_error,
      settled_match_id,
      created_at,
      updated_at
    `,
    decisionInputValues(decision),
  );

  if (insertResult.rows.length > 1) {
    throw new Error(`Database returned multiple inserted decisions for session ${decision.sessionId}.`);
  }
  if (insertResult.rows.length === 1) {
    const inserted = mapRankedTerminalDecisionRow(insertResult.rows[0]);
    if (!hasSameImmutableDecision(inserted, decision)) {
      throw new RankedTerminalDecisionConflictError(decision.sessionId);
    }
    return inserted;
  }

  const existingResult = await client.query(
    `
    SELECT
      session_id,
      decision_type,
      participant_p1_account_id,
      participant_p2_account_id,
      winner_account_id,
      forfeiting_account_id,
      reason,
      due_at,
      decided_at,
      status,
      attempt_count,
      claim_token,
      lease_expires_at,
      next_attempt_at,
      last_error,
      settled_match_id,
      created_at,
      updated_at
    FROM ranked_terminal_decisions
    WHERE session_id = $1
    LIMIT 1
    `,
    [decision.sessionId],
  );
  if (existingResult.rows.length !== 1) {
    throw new RankedTerminalDecisionConflictError(decision.sessionId);
  }
  const existing = mapRankedTerminalDecisionRow(existingResult.rows[0]);
  if (!hasSameImmutableDecision(existing, decision)) {
    throw new RankedTerminalDecisionConflictError(decision.sessionId);
  }
  return existing;
}

function normaliseEnqueueInput(
  input: EnqueueRankedTerminalDecisionInput,
): EnqueueRankedTerminalDecisionInput {
  const sessionId = normaliseUuid(input.sessionId, 'sessionId');
  const participantP1AccountId = normaliseUuid(
    input.participantP1AccountId,
    'participantP1AccountId',
  );
  const participantP2AccountId = normaliseUuid(
    input.participantP2AccountId,
    'participantP2AccountId',
  );
  if (participantP1AccountId === participantP2AccountId) {
    throw new TypeError('participantP1AccountId and participantP2AccountId must identify different accounts.');
  }
  const dueAt = normaliseTimestamp(input.dueAt, 'dueAt');
  const decidedAt = normaliseTimestamp(input.decidedAt, 'decidedAt');

  if (input.decisionType === 'forfeit') {
    if (input.reason !== 'reconnect_timeout' && input.reason !== 'peer_left') {
      throw new TypeError('Forfeit reason must be reconnect_timeout or peer_left.');
    }
    const winnerAccountId = normaliseUuid(input.winnerAccountId, 'winnerAccountId');
    const forfeitingAccountId = normaliseUuid(input.forfeitingAccountId, 'forfeitingAccountId');
    const hasValidAttribution = (
      winnerAccountId === participantP1AccountId
      && forfeitingAccountId === participantP2AccountId
    ) || (
      winnerAccountId === participantP2AccountId
      && forfeitingAccountId === participantP1AccountId
    );
    if (!hasValidAttribution) {
      throw new TypeError('Forfeit winner and forfeiting accounts must be opposite session participants.');
    }
    return {
      sessionId,
      decisionType: input.decisionType,
      participantP1AccountId,
      participantP2AccountId,
      winnerAccountId,
      forfeitingAccountId,
      reason: input.reason,
      dueAt,
      decidedAt,
    };
  }
  if (input.decisionType !== 'no_contest') {
    throw new TypeError(`decisionType must be one of: ${RANKED_TERMINAL_DECISION_TYPES.join(', ')}.`);
  }
  if (input.winnerAccountId !== null || input.forfeitingAccountId !== null) {
    throw new TypeError('No-contest winner and forfeiting accounts must both be null.');
  }
  if (input.reason !== 'reconnect_timeout' && input.reason !== 'session_expired') {
    throw new TypeError('No-contest reason must be reconnect_timeout or session_expired.');
  }
  return {
    sessionId,
    decisionType: input.decisionType,
    participantP1AccountId,
    participantP2AccountId,
    winnerAccountId: null,
    forfeitingAccountId: null,
    reason: input.reason,
    dueAt,
    decidedAt,
  };
}

function decisionInputValues(input: EnqueueRankedTerminalDecisionInput): unknown[] {
  return [
    input.sessionId,
    input.decisionType,
    input.participantP1AccountId,
    input.participantP2AccountId,
    input.winnerAccountId,
    input.forfeitingAccountId,
    input.reason,
    input.dueAt,
    input.decidedAt,
  ];
}

function hasSameImmutableDecision(
  stored: RankedTerminalDecision,
  expected: EnqueueRankedTerminalDecisionInput,
): boolean {
  return stored.sessionId === expected.sessionId
    && stored.decisionType === expected.decisionType
    && stored.participantP1AccountId === expected.participantP1AccountId
    && stored.participantP2AccountId === expected.participantP2AccountId
    && stored.winnerAccountId === expected.winnerAccountId
    && stored.forfeitingAccountId === expected.forfeitingAccountId
    && stored.reason === expected.reason
    && stored.dueAt === expected.dueAt
    && stored.decidedAt === expected.decidedAt;
}

function mapRankedTerminalDecisionRow(rawRow: unknown): RankedTerminalDecision {
  if (!rawRow || typeof rawRow !== 'object') {
    throw new Error('Database returned an invalid ranked terminal decision row.');
  }
  const row = rawRow as Record<string, unknown>;
  const sessionId = uuidFromRow(row.session_id, 'session_id');
  const decisionType = row.decision_type;
  if (!isDecisionType(decisionType)) {
    throw new Error(`Database returned invalid decision_type for session ${sessionId}.`);
  }
  const participantP1AccountId = uuidFromRow(
    row.participant_p1_account_id,
    'participant_p1_account_id',
  );
  const participantP2AccountId = uuidFromRow(
    row.participant_p2_account_id,
    'participant_p2_account_id',
  );
  const winnerAccountId = nullableUuidFromRow(row.winner_account_id, 'winner_account_id');
  const forfeitingAccountId = nullableUuidFromRow(
    row.forfeiting_account_id,
    'forfeiting_account_id',
  );
  if (participantP1AccountId === participantP2AccountId) {
    throw new Error(`Database returned duplicate participants for session ${sessionId}.`);
  }
  if (decisionType === 'forfeit') {
    const validForfeit = winnerAccountId !== null
      && forfeitingAccountId !== null
      && (
        (
          winnerAccountId === participantP1AccountId
          && forfeitingAccountId === participantP2AccountId
        )
        || (
          winnerAccountId === participantP2AccountId
          && forfeitingAccountId === participantP1AccountId
        )
      );
    if (!validForfeit) {
      throw new Error(`Database returned invalid forfeit attribution for session ${sessionId}.`);
    }
  } else if (winnerAccountId !== null || forfeitingAccountId !== null) {
    throw new Error(`Database returned attributed no-contest decision for session ${sessionId}.`);
  }

  const status = row.status;
  if (!isDecisionStatus(status)) {
    throw new Error(`Database returned invalid status for session ${sessionId}.`);
  }
  const attemptCount = integerFromRow(row.attempt_count, 'attempt_count');
  const claimToken = nullableUuidFromRow(row.claim_token, 'claim_token');
  const leaseExpiresAt = nullableTimestampFromRow(row.lease_expires_at, 'lease_expires_at');
  if (
    (status === 'processing' && (claimToken === null || leaseExpiresAt === null))
    || (status !== 'processing' && (claimToken !== null || leaseExpiresAt !== null))
  ) {
    throw new Error(`Database returned inconsistent lease state for session ${sessionId}.`);
  }
  const reason = stringFromRow(row.reason, 'reason');
  if (
    reason.trim() !== reason
    || Buffer.byteLength(reason, 'utf8') === 0
    || Buffer.byteLength(reason, 'utf8') > MAX_RANKED_TERMINAL_DECISION_REASON_BYTES
  ) {
    throw new Error(`Database returned invalid reason for session ${sessionId}.`);
  }
  const validReason = decisionType === 'forfeit'
    ? reason === 'reconnect_timeout' || reason === 'peer_left'
    : reason === 'reconnect_timeout' || reason === 'session_expired';
  if (!validReason) {
    throw new Error(`Database returned incompatible reason for session ${sessionId}.`);
  }
  const lastError = nullableStringFromRow(row.last_error, 'last_error');
  if (
    lastError !== null
    && Buffer.byteLength(lastError, 'utf8') > MAX_RANKED_TERMINAL_DECISION_LAST_ERROR_BYTES
  ) {
    throw new Error(`Database returned oversized last_error for session ${sessionId}.`);
  }

  return {
    sessionId,
    decisionType,
    participantP1AccountId,
    participantP2AccountId,
    winnerAccountId,
    forfeitingAccountId,
    reason: reason as RankedTerminalDecisionReason,
    dueAt: timestampFromRow(row.due_at, 'due_at'),
    decidedAt: timestampFromRow(row.decided_at, 'decided_at'),
    status,
    attemptCount,
    claimToken,
    leaseExpiresAt,
    nextAttemptAt: timestampFromRow(row.next_attempt_at, 'next_attempt_at'),
    lastError,
    settledMatchId: nullableUuidFromRow(row.settled_match_id, 'settled_match_id'),
    createdAt: timestampFromRow(row.created_at, 'created_at'),
    updatedAt: timestampFromRow(row.updated_at, 'updated_at'),
  };
}

function normaliseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new TypeError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function uuidFromRow(value: unknown, field: string): string {
  try {
    return normaliseUuid(value, field);
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function nullableUuidFromRow(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return uuidFromRow(value, field);
}

function normaliseTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be an ISO-8601 timestamp.`);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601 timestamp.`);
  }
  return timestamp.toISOString();
}

function timestampFromRow(value: unknown, field: string): string {
  const timestamp = value instanceof Date ? value : new Date(String(value ?? ''));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`Database returned invalid ${field}.`);
  }
  return timestamp.toISOString();
}

function nullableTimestampFromRow(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return timestampFromRow(value, field);
}

function normaliseLastError(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    try {
      message = String(error);
    } catch {
      message = '';
    }
  }
  message = message.replaceAll('\u0000', '\uFFFD');
  if (message.trim().length === 0) {
    message = 'Unknown ranked terminal decision processing error.';
  }
  return truncateUtf8(message, MAX_RANKED_TERMINAL_DECISION_LAST_ERROR_BYTES);
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
    return value;
  }
  let bytes = 0;
  let truncated = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) {
      break;
    }
    truncated += character;
    bytes += characterBytes;
  }
  return truncated;
}

function stringFromRow(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Database returned invalid ${field}.`);
  }
  return value;
}

function nullableStringFromRow(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return stringFromRow(value, field);
}

function integerFromRow(value: unknown, field: string): number {
  const integer = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new Error(`Database returned invalid ${field}.`);
  }
  return integer;
}

function isDecisionType(value: unknown): value is RankedTerminalDecisionType {
  return typeof value === 'string'
    && (RANKED_TERMINAL_DECISION_TYPES as readonly string[]).includes(value);
}

function isDecisionStatus(value: unknown): value is RankedTerminalDecisionStatus {
  return typeof value === 'string'
    && (RANKED_TERMINAL_DECISION_STATUSES as readonly string[]).includes(value);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
}

function assertPositiveIntegerAtMost(value: number, maximum: number, field: string): void {
  assertPositiveInteger(value, field);
  if (value > maximum) {
    throw new TypeError(`${field} must not exceed ${maximum}.`);
  }
}

function affectedExactlyOneRow(result: QueryResultLike): boolean {
  const affected = result.rowCount ?? result.rows.length;
  if (affected > 1) {
    throw new Error('Ranked terminal decision transition affected multiple rows.');
  }
  return affected === 1;
}
