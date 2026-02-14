import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import {
  createMatchmakingQueueService,
  isQueueType,
  isRegionId,
  type SessionActionErrorCode,
  type RegionId,
  type QueueType,
} from './matchmaking/queueService';
import { createMatchmakingNetworkConfigFromEnv } from './matchmaking/networkConfig';
import {
  createConnectivityTelemetryStore,
  type ConnectionPath,
  type ConnectionTransport,
} from './matchmaking/connectivityTelemetry';
import {
  createRoomService,
  isRoomMatchOutcome,
  isRoomPlatform,
  isRoomParticipantRole,
  type RoomActionErrorCode,
  type RoomMatchOutcome,
  type RoomPlatform,
  type RoomParticipantRole,
} from './rooms/roomService';
import { createReplayBlobStoreFromEnv } from './replays/blobStore';
import { validateReplayPayloadForArchive } from './replays/payload';
import {
  buildReplaySearchQuery,
  encodeReplaySearchCursor,
  parseReplaySearchQuery,
  type ReplaySearchQueryInput,
} from './replays/search';
import {
  hashWebPassword,
  normaliseWebEmail,
  validateWebPassword,
  verifyWebPassword,
} from './auth/webAuth';

const app = Fastify({ logger: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(['steam', 'web']);
const matchmakingQueueService = createMatchmakingQueueService({
  ticketTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_TICKET_TTL_SECONDS),
  sessionTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SESSION_TTL_SECONDS),
  sessionTokenTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SESSION_TOKEN_TTL_SECONDS),
  reconnectGraceSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_RECONNECT_GRACE_SECONDS),
  closedTicketRetentionSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_CLOSED_RETENTION_SECONDS),
});
const matchmakingNetworkConfig = createMatchmakingNetworkConfigFromEnv(process.env);
const connectivityTelemetryStore = createConnectivityTelemetryStore({
  retentionMs: parsePositiveIntegerEnv(process.env.MATCHMAKING_TELEMETRY_RETENTION_MS),
});
const roomService = createRoomService({
  idleTimeoutSeconds: parsePositiveIntegerEnv(process.env.ROOM_IDLE_TIMEOUT_SECONDS),
  closedRoomRetentionSeconds: parsePositiveIntegerEnv(process.env.ROOM_CLOSED_RETENTION_SECONDS),
  maxParticipants: parsePositiveIntegerEnv(process.env.ROOM_MAX_PARTICIPANTS),
  maxSpectators: parsePositiveIntegerEnv(process.env.ROOM_MAX_SPECTATORS),
  maxHistoryEntries: parsePositiveIntegerEnv(process.env.ROOM_MAX_HISTORY_ENTRIES),
  webInviteBaseUrl: process.env.ROOM_WEB_INVITE_BASE_URL,
  steamAppId: process.env.STEAM_APP_ID,
});
const replayBlobStore = createReplayBlobStoreFromEnv(process.env);
const rankedReplayRetentionDays = parsePositiveIntegerEnv(process.env.REPLAY_RETENTION_DAYS_RANKED) ?? 365;
const casualReplayRetentionDays = parsePositiveIntegerEnv(process.env.REPLAY_RETENTION_DAYS_CASUAL) ?? 90;

interface LinkIdentityBody {
  provider?: string;
  providerUserId?: string;
  actor?: string;
}

interface UpdateProfileBody {
  displayName?: string | null;
  settings?: Record<string, unknown>;
}

interface WebSignupBody {
  email?: string;
  password?: string;
  displayName?: string | null;
  upgradeAccountId?: string;
}

interface WebSigninBody {
  email?: string;
  password?: string;
}

interface MatchmakingQueueJoinBody {
  queueType?: string;
  regionPreferences?: string[];
  buildVersion?: string;
  platform?: string;
}

interface MatchmakingQueueLeaveBody {
  ticketId?: string;
}

interface MatchmakingSessionDisconnectBody {
  sessionId?: string;
}

interface MatchmakingSessionReconnectBody {
  sessionId?: string;
  sessionToken?: string;
  reconnectAttemptId?: string;
}

interface MatchmakingIceConfigQuery {
  forceRelay?: string;
}

interface MatchmakingConnectionTelemetryBody {
  sessionId?: string;
  queueType?: string;
  region?: string;
  connectionPath?: string;
  transport?: string;
  rttMs?: number;
  packetLossPercent?: number;
}

interface CreateRoomBody {
  platform?: string;
  requiredRegion?: string;
  buildVersion?: string;
  allowSpectators?: boolean;
}

interface JoinRoomBody {
  platform?: string;
  role?: string;
  region?: string;
  buildVersion?: string;
}

interface UpdateRoomSettingsBody {
  locked?: boolean;
  allowSpectators?: boolean;
}

interface RoomInviteQuery {
  platform?: string;
}

interface RoomCharacterSelectBody {
  characterId?: string;
}

interface RoomReadyBody {
  ready?: boolean;
}

interface RoomOutcomeBody {
  outcome?: string;
  winnerAccountId?: string | null;
}

interface ReplayIngestParticipantBody {
  accountId?: string;
  side?: string;
  characterId?: string;
  result?: string;
}

interface ReplayIngestBody {
  matchId?: string;
  queueType?: string;
  matchType?: string;
  region?: string;
  patchVersion?: string;
  rulesetVersion?: string;
  simBuildHash?: string;
  outcome?: string;
  winnerAccountId?: string | null;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  retentionClass?: string;
  payload?: unknown;
  participants?: ReplayIngestParticipantBody[];
}

interface ReplayDeleteBody {
  reason?: string;
}

function isUuid(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return UUID_REGEX.test(value);
}

function normaliseProvider(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const provider = value.toLowerCase();
  return PROVIDERS.has(provider) ? provider : null;
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseConnectionPath(value: unknown): ConnectionPath | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'direct' || normalised === 'relay') {
    return normalised;
  }
  return null;
}

function parseConnectionTransport(value: unknown): ConnectionTransport {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'webrtc' || normalised === 'steam_sockets') {
    return normalised;
  }
  return 'unknown';
}

function assertSettingsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('settings must be a JSON object.');
  }
  const serialised = JSON.stringify(value);
  if (serialised.length > 16_384) {
    throw new Error('settings payload exceeds 16KB limit.');
  }
  return value as Record<string, unknown>;
}

function parseRegionPreferences(value: unknown): RegionId[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const parsed: RegionId[] = [];
  const seen = new Set<RegionId>();
  for (const rawRegion of value) {
    if (typeof rawRegion !== 'string') {
      return null;
    }
    const region = rawRegion.toLowerCase().trim();
    if (!isRegionId(region)) {
      return null;
    }
    if (seen.has(region)) {
      continue;
    }
    seen.add(region);
    parsed.push(region);
  }
  return parsed.length > 0 ? parsed : null;
}

async function getProfileDisplayName(accountId: string): Promise<string | null> {
  const result = await db.query(
    'SELECT display_name FROM profiles WHERE account_id = $1 LIMIT 1',
    [accountId],
  );
  if (!result.rowCount) {
    return null;
  }
  const row = result.rows[0] as { display_name: string | null };
  return row.display_name ?? null;
}

function mapSessionErrorToHttp(errorCode: SessionActionErrorCode): number {
  switch (errorCode) {
    case 'not_found':
      return 404;
    case 'forbidden':
      return 403;
    case 'session_resolved':
      return 409;
    case 'replayed_attempt':
      return 409;
    case 'invalid_token':
    case 'token_expired':
      return 401;
    default:
      return 400;
  }
}

function mapRoomErrorToHttp(errorCode: RoomActionErrorCode): number {
  switch (errorCode) {
    case 'not_found':
      return 404;
    case 'forbidden':
      return 403;
    case 'room_closed':
      return 409;
    case 'room_locked':
      return 409;
    case 'region_mismatch':
      return 409;
    case 'version_mismatch':
      return 409;
    case 'spectators_disabled':
      return 409;
    case 'no_active_session':
      return 409;
    case 'invalid_phase':
      return 409;
    case 'insufficient_players':
      return 409;
    case 'invalid_character':
      return 400;
    case 'invalid_outcome':
      return 400;
    case 'room_full':
      return 409;
    case 'already_active':
      return 409;
    case 'invalid_platform':
      return 400;
    default:
      return 400;
  }
}

function getRoomJoinRecoveryMessage(errorCode: RoomActionErrorCode): string | undefined {
  switch (errorCode) {
    case 'room_locked':
      return 'Ask the host to unlock the room or send a new invite.';
    case 'region_mismatch':
      return 'Switch to the room region and retry join.';
    case 'version_mismatch':
      return 'Update to the same game build as the host and retry.';
    case 'spectators_disabled':
      return 'Ask the host to enable spectators or join as a player slot.';
    case 'room_full':
      return 'Wait for a slot to open or ask host to create another room.';
    case 'room_closed':
      return 'Ask the host to create a new room.';
    default:
      return undefined;
  }
}

async function ensureAccountExists(accountId: string): Promise<boolean> {
  const accountExists = await db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  return Boolean(accountExists.rowCount);
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  return date.toISOString();
}

function computeReplayRetentionUntil(queueType: string, retentionClass: string | undefined, now: Date): Date {
  const classValue = (retentionClass ?? '').trim().toLowerCase();
  const isRanked = queueType === 'ranked' || classValue === 'ranked_long';
  const retentionDays = isRanked ? rankedReplayRetentionDays : casualReplayRetentionDays;
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

function normaliseReplayOutcome(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  return normalised.length > 0 ? normalised : null;
}

function normaliseDisplayName(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalised = String(value).trim();
  if (!normalised) {
    return null;
  }
  return normalised.slice(0, 32);
}

async function logAccountAuthEvent(
  event: {
    accountId: string | null;
    provider: 'web' | 'steam';
    eventType: 'signup' | 'signin' | 'upgrade' | 'signup_failed' | 'signin_failed';
    emailNormalised: string;
    reason?: string | null;
  },
): Promise<void> {
  try {
    await db.query(
      `
        INSERT INTO account_auth_events(account_id, provider, event_type, email_normalised, reason)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        event.accountId,
        event.provider,
        event.eventType,
        event.emailNormalised,
        event.reason ?? null,
      ],
    );
  } catch {
    // Auth event logging must not fail request handling in prototype stage.
  }
}

app.get('/health', async () => ({ ok: true }));

app.post('/accounts', async (request, reply) => {
  const body = request.body as { status?: string } | undefined;
  const status = body?.status === 'disabled' ? 'disabled' : 'active';
  const result = await db.query(
    `INSERT INTO accounts(status) VALUES ($1) RETURNING id, status, created_at, updated_at`,
    [status],
  );
  reply.code(201);
  return result.rows[0];
});

app.get('/accounts/:accountId', async (request, reply) => {
  const params = request.params as { accountId?: string };
  if (!isUuid(params.accountId)) {
    reply.code(400);
    return { error: 'Invalid account id.' };
  }

  const accountResult = await db.query(
    `SELECT id, status, created_at, updated_at FROM accounts WHERE id = $1`,
    [params.accountId],
  );
  if (!accountResult.rowCount) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const identitiesResult = await db.query(
    `SELECT provider, provider_user_id, created_at FROM identities WHERE account_id = $1 ORDER BY id`,
    [params.accountId],
  );

  return {
    ...accountResult.rows[0],
    identities: identitiesResult.rows,
  };
});

app.post('/accounts/:accountId/identities', async (request, reply) => {
  const params = request.params as { accountId?: string };
  if (!isUuid(params.accountId)) {
    reply.code(400);
    return { error: 'Invalid account id.' };
  }

  const body = (request.body ?? {}) as LinkIdentityBody;
  const provider = normaliseProvider(body.provider);
  if (!provider) {
    reply.code(400);
    return { error: 'provider must be one of: steam, web.' };
  }
  const providerUserId = String(body.providerUserId ?? '').trim();
  if (!providerUserId) {
    reply.code(400);
    return { error: 'providerUserId is required.' };
  }
  const actor = String(body.actor ?? 'system').trim() || 'system';

  const accountExists = await db.query(`SELECT 1 FROM accounts WHERE id = $1`, [params.accountId]);
  if (!accountExists.rowCount) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const linked = await client.query(
      `
        INSERT INTO identities(account_id, provider, provider_user_id)
        VALUES ($1, $2, $3)
        RETURNING id, account_id, provider, provider_user_id, created_at
      `,
      [params.accountId, provider, providerUserId],
    );
    await client.query(
      `
        INSERT INTO identity_link_events(account_id, provider, provider_user_id, event_type, actor, metadata)
        VALUES ($1, $2, $3, 'linked', $4, '{}'::jsonb)
      `,
      [params.accountId, provider, providerUserId, actor],
    );
    await client.query('COMMIT');
    reply.code(201);
    return linked.rows[0];
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Unknown database error.';
    await db.query(
      `
        INSERT INTO identity_link_events(account_id, provider, provider_user_id, event_type, actor, metadata)
        VALUES ($1, $2, $3, 'link_failed', $4, jsonb_build_object('reason', $5))
      `,
      [params.accountId, provider, providerUserId, actor, message],
    );

    if (message.includes('identities_provider_provider_user_id_key')) {
      reply.code(409);
      return { error: 'This provider identity is already linked to another account.' };
    }
    if (message.includes('identities_account_id_provider_key')) {
      reply.code(409);
      return { error: 'This account already has a linked identity for this provider.' };
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/identities/:provider/:providerUserId', async (request, reply) => {
  const params = request.params as { provider?: string; providerUserId?: string };
  const provider = normaliseProvider(params.provider);
  if (!provider) {
    reply.code(400);
    return { error: 'Invalid provider.' };
  }

  const providerUserId = String(params.providerUserId ?? '').trim();
  if (!providerUserId) {
    reply.code(400);
    return { error: 'providerUserId is required.' };
  }

  const result = await db.query(
    `
      SELECT i.account_id, i.provider, i.provider_user_id, i.created_at, a.status
      FROM identities i
      JOIN accounts a ON a.id = i.account_id
      WHERE i.provider = $1 AND i.provider_user_id = $2
      LIMIT 1
    `,
    [provider, providerUserId],
  );

  if (!result.rowCount) {
    reply.code(404);
    return { error: 'Identity not found.' };
  }

  return result.rows[0];
});

app.post('/auth/web/signup', async (request, reply) => {
  const body = (request.body ?? {}) as WebSignupBody;
  const email = normaliseWebEmail(body.email);
  if (!email) {
    reply.code(400);
    return { error: 'email must be a valid address.' };
  }
  const passwordValidation = validateWebPassword(body.password);
  if (!passwordValidation.ok) {
    reply.code(400);
    return { error: passwordValidation.error };
  }
  const password = body.password as string;
  const displayName = normaliseDisplayName(body.displayName);
  const upgradeAccountIdRaw = String(body.upgradeAccountId ?? '').trim();
  const upgradeAccountId = upgradeAccountIdRaw || null;
  if (upgradeAccountId && !isUuid(upgradeAccountId)) {
    reply.code(400);
    return { error: 'upgradeAccountId must be a UUID when provided.' };
  }

  const authenticatedAccountId = getAuthenticatedAccountId(request);
  if (upgradeAccountId && authenticatedAccountId !== upgradeAccountId) {
    reply.code(403);
    return { error: 'upgradeAccountId must match authenticated x-account-id header.' };
  }

  const passwordRecord = await hashWebPassword(password);
  let accountId: string | null = upgradeAccountId;
  let upgradedFromGuest = false;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (upgradeAccountId) {
      const accountResult = await client.query(
        'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE',
        [upgradeAccountId],
      );
      if (!accountResult.rowCount) {
        await client.query('ROLLBACK');
        await logAccountAuthEvent({
          accountId: null,
          provider: 'web',
          eventType: 'signup_failed',
          emailNormalised: email,
          reason: 'upgrade_account_not_found',
        });
        reply.code(404);
        return { error: 'Upgrade account not found.' };
      }
      const accountRow = accountResult.rows[0] as { id: string; status: string };
      if (accountRow.status !== 'active') {
        await client.query('ROLLBACK');
        await logAccountAuthEvent({
          accountId: accountRow.id,
          provider: 'web',
          eventType: 'signup_failed',
          emailNormalised: email,
          reason: 'account_disabled',
        });
        reply.code(409);
        return {
          error: 'Account is disabled.',
          recovery: 'Contact support to re-enable account access.',
        };
      }
      const existingCredential = await client.query(
        'SELECT 1 FROM web_auth_credentials WHERE account_id = $1 LIMIT 1',
        [upgradeAccountId],
      );
      if (existingCredential.rowCount) {
        await client.query('ROLLBACK');
        await logAccountAuthEvent({
          accountId: accountRow.id,
          provider: 'web',
          eventType: 'signup_failed',
          emailNormalised: email,
          reason: 'already_upgraded',
        });
        reply.code(409);
        return { error: 'Account already has web sign-in credentials.' };
      }
      accountId = accountRow.id;
      upgradedFromGuest = true;
    } else {
      const created = await client.query(
        'INSERT INTO accounts(status) VALUES ($1) RETURNING id',
        ['active'],
      );
      accountId = (created.rows[0] as { id: string }).id;
    }

    await client.query(
      `
        INSERT INTO web_auth_credentials(account_id, email_normalised, password_hash, password_salt)
        VALUES ($1, $2, $3, $4)
      `,
      [accountId, email, passwordRecord.hash, passwordRecord.salt],
    );
    await client.query(
      `
        INSERT INTO identities(account_id, provider, provider_user_id)
        VALUES ($1, 'web', $2)
      `,
      [accountId, email],
    );
    if (displayName) {
      await client.query(
        `
          INSERT INTO profiles(account_id, display_name, settings_json)
          VALUES ($1, $2, '{}'::jsonb)
          ON CONFLICT (account_id)
          DO UPDATE SET
            display_name = EXCLUDED.display_name,
            updated_at = NOW()
        `,
        [accountId, displayName],
      );
    }

    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Web sign-up failed.';
    await logAccountAuthEvent({
      accountId,
      provider: 'web',
      eventType: 'signup_failed',
      emailNormalised: email,
      reason: message,
    });
    if (
      message.includes('web_auth_credentials_email_normalised_key')
      || message.includes('identities_provider_provider_user_id_key')
    ) {
      reply.code(409);
      return {
        error: 'A web account with this email already exists.',
        recovery: 'Use /auth/web/signin or account recovery flow.',
      };
    }
    if (
      message.includes('web_auth_credentials_pkey')
      || message.includes('identities_account_id_provider_key')
    ) {
      reply.code(409);
      return { error: 'This account already has web sign-in credentials.' };
    }
    throw error;
  } finally {
    client.release();
  }

  await logAccountAuthEvent({
    accountId,
    provider: 'web',
    eventType: upgradedFromGuest ? 'upgrade' : 'signup',
    emailNormalised: email,
  });
  reply.code(201);
  return {
    accountId,
    email,
    upgradedFromGuest,
    provider: 'web',
    nextAction: 'Use /auth/web/signin to restore sessions on another device.',
  };
});

app.post('/auth/web/signin', async (request, reply) => {
  const body = (request.body ?? {}) as WebSigninBody;
  const email = normaliseWebEmail(body.email);
  if (!email) {
    reply.code(400);
    return { error: 'email must be a valid address.' };
  }
  const passwordValidation = validateWebPassword(body.password);
  if (!passwordValidation.ok) {
    reply.code(400);
    return { error: passwordValidation.error };
  }
  const password = body.password as string;

  const credentialsResult = await db.query(
    `
      SELECT
        c.account_id,
        c.password_hash,
        c.password_salt,
        a.status,
        p.display_name
      FROM web_auth_credentials c
      JOIN accounts a ON a.id = c.account_id
      LEFT JOIN profiles p ON p.account_id = c.account_id
      WHERE c.email_normalised = $1
      LIMIT 1
    `,
    [email],
  );
  if (!credentialsResult.rowCount) {
    await logAccountAuthEvent({
      accountId: null,
      provider: 'web',
      eventType: 'signin_failed',
      emailNormalised: email,
      reason: 'invalid_credentials',
    });
    reply.code(401);
    return {
      error: 'Invalid email or password.',
      recovery: 'Check credentials or sign up with /auth/web/signup.',
    };
  }

  const row = credentialsResult.rows[0] as {
    account_id: string;
    password_hash: string;
    password_salt: string;
    status: string;
    display_name: string | null;
  };
  if (row.status !== 'active') {
    await logAccountAuthEvent({
      accountId: row.account_id,
      provider: 'web',
      eventType: 'signin_failed',
      emailNormalised: email,
      reason: 'account_disabled',
    });
    reply.code(403);
    return {
      error: 'Account is disabled.',
      recovery: 'Contact support to restore account access.',
    };
  }

  const passwordOk = await verifyWebPassword(password, {
    hash: row.password_hash,
    salt: row.password_salt,
  });
  if (!passwordOk) {
    await logAccountAuthEvent({
      accountId: row.account_id,
      provider: 'web',
      eventType: 'signin_failed',
      emailNormalised: email,
      reason: 'invalid_credentials',
    });
    reply.code(401);
    return {
      error: 'Invalid email or password.',
      recovery: 'Check credentials or run account recovery flow.',
    };
  }

  await logAccountAuthEvent({
    accountId: row.account_id,
    provider: 'web',
    eventType: 'signin',
    emailNormalised: email,
  });

  return {
    accountId: row.account_id,
    displayName: row.display_name,
    provider: 'web',
    isAuthenticated: true,
  };
});

app.get('/matchmaking/queue/config', async () => matchmakingQueueService.getConfig());

app.get('/matchmaking/network/ice-config', async (request) => {
  const query = (request.query ?? {}) as MatchmakingIceConfigQuery;
  const forceRelay = query.forceRelay?.toLowerCase() === 'true' || query.forceRelay === '1';
  return {
    ...matchmakingNetworkConfig,
    iceTransportPolicy: forceRelay ? 'relay' : matchmakingNetworkConfig.iceTransportPolicy,
  };
});

app.post('/matchmaking/queue/join', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const accountExists = await db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  if (!accountExists.rowCount) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const body = (request.body ?? {}) as MatchmakingQueueJoinBody;
  const queueType = typeof body.queueType === 'string' ? body.queueType.toLowerCase().trim() : '';
  if (!isQueueType(queueType)) {
    reply.code(400);
    return { error: 'queueType must be one of: unranked, ranked.' };
  }

  const regionPreferences = parseRegionPreferences(body.regionPreferences);
  if (!regionPreferences) {
    reply.code(400);
    return { error: 'regionPreferences must be a non-empty array of supported regions.' };
  }

  const displayName = await getProfileDisplayName(accountId);
  const ticket = matchmakingQueueService.join({
    accountId,
    queueType,
    regionPreferences,
    playerMetadata: {
      displayName,
      buildVersion: typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null,
      platform: body.platform === 'steam' || body.platform === 'web' ? body.platform : null,
    },
  });

  reply.code(201);
  return ticket;
});

app.get('/matchmaking/queue/tickets/:ticketId', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { ticketId?: string };
  if (!isUuid(params.ticketId)) {
    reply.code(400);
    return { error: 'Invalid ticket id.' };
  }

  const ticket = matchmakingQueueService.getTicketForAccount(params.ticketId, accountId);
  if (!ticket) {
    reply.code(404);
    return { error: 'Ticket not found.' };
  }

  return ticket;
});

app.post('/matchmaking/queue/leave', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as MatchmakingQueueLeaveBody;
  if (!isUuid(body.ticketId)) {
    reply.code(400);
    return { error: 'ticketId is required and must be a UUID.' };
  }

  const ticket = matchmakingQueueService.leaveTicket(body.ticketId, accountId);
  if (!ticket) {
    reply.code(404);
    return { error: 'Ticket not found.' };
  }

  return ticket;
});

app.get('/matchmaking/sessions/:sessionId', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'Invalid session id.' };
  }

  const session = matchmakingQueueService.getSessionForAccount(params.sessionId, accountId);
  if (!session) {
    reply.code(404);
    return { error: 'Session not found.' };
  }
  return session;
});

app.post('/matchmaking/sessions/disconnect', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as MatchmakingSessionDisconnectBody;
  if (!isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }

  const result = matchmakingQueueService.markSessionDisconnected(body.sessionId, accountId);
  if (!result.ok) {
    reply.code(mapSessionErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/matchmaking/sessions/reconnect', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as MatchmakingSessionReconnectBody;
  if (!isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }
  const reconnectAttemptId = String(body.reconnectAttemptId ?? '').trim();
  if (!reconnectAttemptId || reconnectAttemptId.length > 128) {
    reply.code(400);
    return { error: 'reconnectAttemptId is required and must be 1-128 characters.' };
  }

  const result = matchmakingQueueService.reconnectSession({
    sessionId: body.sessionId,
    accountId,
    sessionToken,
    reconnectAttemptId,
  });
  if (!result.ok) {
    reply.code(mapSessionErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/matchmaking/network/connection-telemetry', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as MatchmakingConnectionTelemetryBody;
  const queueType = typeof body.queueType === 'string' ? body.queueType.toLowerCase().trim() : '';
  if (!isQueueType(queueType)) {
    reply.code(400);
    return { error: 'queueType must be one of: unranked, ranked.' };
  }

  const region = typeof body.region === 'string' ? body.region.toLowerCase().trim() : '';
  if (!isRegionId(region)) {
    reply.code(400);
    return { error: 'region must be one of the supported matchmaking regions.' };
  }

  const connectionPath = parseConnectionPath(body.connectionPath);
  if (!connectionPath) {
    reply.code(400);
    return { error: 'connectionPath must be direct or relay.' };
  }

  if (body.sessionId && !isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId must be a UUID when provided.' };
  }

  connectivityTelemetryStore.record({
    accountId,
    queueType: queueType as QueueType,
    region,
    connectionPath,
    transport: parseConnectionTransport(body.transport),
    sessionId: body.sessionId,
    rttMs: typeof body.rttMs === 'number' && Number.isFinite(body.rttMs) ? body.rttMs : undefined,
    packetLossPercent: typeof body.packetLossPercent === 'number' && Number.isFinite(body.packetLossPercent)
      ? body.packetLossPercent
      : undefined,
  });

  reply.code(202);
  return { accepted: true };
});

app.get('/matchmaking/network/connection-telemetry/summary', async (request, reply) => {
  const query = (request.query ?? {}) as { region?: string; queueType?: string };
  let region: RegionId | undefined;
  if (query.region !== undefined) {
    const parsedRegion = query.region.toLowerCase().trim();
    if (!isRegionId(parsedRegion)) {
      reply.code(400);
      return { error: 'region filter is invalid.' };
    }
    region = parsedRegion;
  }

  let queueType: QueueType | undefined;
  if (query.queueType !== undefined) {
    const parsedQueueType = query.queueType.toLowerCase().trim();
    if (!isQueueType(parsedQueueType)) {
      reply.code(400);
      return { error: 'queueType filter is invalid.' };
    }
    queueType = parsedQueueType;
  }

  return connectivityTelemetryStore.getSummary({ region, queueType });
});

app.get('/rooms/config', async () => roomService.getConfig());

app.post('/rooms', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const body = (request.body ?? {}) as CreateRoomBody;
  const platform = (body.platform ?? 'web').toLowerCase().trim();
  if (!isRoomPlatform(platform)) {
    reply.code(400);
    return { error: 'platform must be web or steam.' };
  }
  if (body.allowSpectators !== undefined && typeof body.allowSpectators !== 'boolean') {
    reply.code(400);
    return { error: 'allowSpectators must be a boolean when provided.' };
  }
  const requiredRegion = typeof body.requiredRegion === 'string' ? body.requiredRegion.trim().toLowerCase() : null;
  const buildVersion = typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null;

  const room = roomService.createRoom({
    hostAccountId: accountId,
    hostPlatform: platform,
    requiredRegion,
    requiredBuildVersion: buildVersion,
    allowSpectators: body.allowSpectators,
  });
  reply.code(201);
  return room;
});

app.get('/rooms/:roomCode', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }
  const room = roomService.getRoomForAccount(roomCode, accountId);
  if (!room) {
    reply.code(404);
    return { error: 'Room not found.' };
  }
  return room;
});

app.post('/rooms/:roomCode/join', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }
  const body = (request.body ?? {}) as JoinRoomBody;
  const platform = (body.platform ?? 'web').toLowerCase().trim();
  if (!isRoomPlatform(platform)) {
    reply.code(400);
    return { error: 'platform must be web or steam.' };
  }
  const roleRaw = (body.role ?? 'player').toLowerCase().trim();
  if (!isRoomParticipantRole(roleRaw)) {
    reply.code(400);
    return { error: 'role must be player or spectator.' };
  }
  const role = roleRaw as RoomParticipantRole;
  const region = typeof body.region === 'string' ? body.region.trim().toLowerCase() : null;
  const buildVersion = typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null;

  const result = roomService.joinRoom({
    roomCode,
    accountId,
    platform,
    role,
    region,
    buildVersion,
  });
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return {
      error: result.error.message,
      code: result.error.code,
      recovery: getRoomJoinRecoveryMessage(result.error.code),
    };
  }
  return result.value;
});

app.post('/rooms/:roomCode/settings', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const body = (request.body ?? {}) as UpdateRoomSettingsBody;
  const hasLocked = typeof body.locked === 'boolean';
  const hasAllowSpectators = typeof body.allowSpectators === 'boolean';
  if (!hasLocked && !hasAllowSpectators) {
    reply.code(400);
    return { error: 'At least one setting is required: locked or allowSpectators.' };
  }

  const result = roomService.updateRoomSettings({
    roomCode,
    accountId,
    locked: hasLocked ? body.locked : undefined,
    allowSpectators: hasAllowSpectators ? body.allowSpectators : undefined,
  });
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/rooms/:roomCode/character-select', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const body = (request.body ?? {}) as RoomCharacterSelectBody;
  const characterId = String(body.characterId ?? '').trim();
  if (!characterId) {
    reply.code(400);
    return { error: 'characterId is required.' };
  }

  const result = roomService.setCharacterSelection({
    roomCode,
    accountId,
    characterId,
  });
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/rooms/:roomCode/ready', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const body = (request.body ?? {}) as RoomReadyBody;
  const ready = body.ready ?? true;
  if (typeof ready !== 'boolean') {
    reply.code(400);
    return { error: 'ready must be a boolean when provided.' };
  }

  const result = roomService.setReadyState({
    roomCode,
    accountId,
    ready,
  });
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/rooms/:roomCode/outcome', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const body = (request.body ?? {}) as RoomOutcomeBody;
  const outcomeRaw = typeof body.outcome === 'string' ? body.outcome.toLowerCase().trim() : '';
  if (!isRoomMatchOutcome(outcomeRaw)) {
    reply.code(400);
    return { error: 'outcome must be one of: win, draw, forfeit.' };
  }

  const winnerAccountId = body.winnerAccountId === undefined || body.winnerAccountId === null
    ? null
    : String(body.winnerAccountId).trim();
  if (winnerAccountId !== null && !isUuid(winnerAccountId)) {
    reply.code(400);
    return { error: 'winnerAccountId must be a UUID when provided.' };
  }

  const result = roomService.recordMatchOutcome({
    roomCode,
    accountId,
    outcome: outcomeRaw as RoomMatchOutcome,
    winnerAccountId,
  });
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/rooms/:roomCode/rematch', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const result = roomService.startRematch(roomCode, accountId);
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/rooms/:roomCode/start', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const result = roomService.startRoomSession(roomCode, accountId);
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/rooms/:roomCode/close', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }

  const result = roomService.closeRoom(roomCode, accountId);
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.get('/rooms/:roomCode/invite', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { roomCode?: string };
  const roomCode = String(params.roomCode ?? '').trim();
  if (!roomCode) {
    reply.code(400);
    return { error: 'roomCode is required.' };
  }
  const query = (request.query ?? {}) as RoomInviteQuery;
  const platform = (query.platform ?? 'web').toLowerCase().trim();
  if (!isRoomPlatform(platform)) {
    reply.code(400);
    return { error: 'platform query must be web or steam.' };
  }

  const result = roomService.getInvite(roomCode, accountId, platform as RoomPlatform);
  if (!result.ok) {
    reply.code(mapRoomErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/replays/ingest', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const body = (request.body ?? {}) as ReplayIngestBody;
  const queueType = String(body.queueType ?? '').trim().toLowerCase();
  if (!queueType) {
    reply.code(400);
    return { error: 'queueType is required.' };
  }
  const matchType = String(body.matchType ?? queueType).trim().toLowerCase();
  const region = String(body.region ?? '').trim().toLowerCase();
  if (!region) {
    reply.code(400);
    return { error: 'region is required.' };
  }
  const patchVersion = String(body.patchVersion ?? '').trim();
  if (!patchVersion) {
    reply.code(400);
    return { error: 'patchVersion is required.' };
  }
  const startedAt = parseIsoDate(body.startedAt);
  const endedAt = parseIsoDate(body.endedAt);
  if (!startedAt || !endedAt || endedAt.getTime() < startedAt.getTime()) {
    reply.code(400);
    return { error: 'startedAt and endedAt must be valid ISO timestamps and endedAt must be >= startedAt.' };
  }
  const durationSeconds = Number.isFinite(body.durationSeconds)
    ? Math.max(0, Math.floor(Number(body.durationSeconds)))
    : Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  const outcome = normaliseReplayOutcome(body.outcome);
  if (!outcome) {
    reply.code(400);
    return { error: 'outcome is required.' };
  }

  const validation = validateReplayPayloadForArchive(body.payload);
  if (!validation.ok) {
    reply.code(400);
    return { error: validation.errorMessage, code: validation.errorCode };
  }
  const payload = validation.payload;

  const rulesetVersion = String(body.rulesetVersion ?? payload.header.rulesetVersion).trim();
  const simBuildHash = String(body.simBuildHash ?? payload.header.simBuildHash).trim();
  if (rulesetVersion !== payload.header.rulesetVersion || simBuildHash !== payload.header.simBuildHash) {
    reply.code(400);
    return { error: 'rulesetVersion and simBuildHash must match replay payload header values.' };
  }

  const participants = Array.isArray(body.participants) ? body.participants : [];
  if (participants.length !== 2) {
    reply.code(400);
    return { error: 'participants must contain exactly 2 player entries.' };
  }

  const normalisedParticipants = participants.map((participant) => ({
    accountId: String(participant.accountId ?? '').trim(),
    side: String(participant.side ?? '').trim().toUpperCase(),
    characterId: String(participant.characterId ?? '').trim(),
    result: String(participant.result ?? '').trim().toLowerCase(),
  }));

  for (const participant of normalisedParticipants) {
    if (!isUuid(participant.accountId)) {
      reply.code(400);
      return { error: 'Each participant accountId must be a UUID.' };
    }
    if (participant.side !== 'P1' && participant.side !== 'P2') {
      reply.code(400);
      return { error: 'Participant side must be P1 or P2.' };
    }
    if (!participant.characterId) {
      reply.code(400);
      return { error: 'Participant characterId is required.' };
    }
    if (!['win', 'loss', 'draw', 'forfeit'].includes(participant.result)) {
      reply.code(400);
      return { error: 'Participant result must be one of: win, loss, draw, forfeit.' };
    }
  }
  if (new Set(normalisedParticipants.map((participant) => participant.side)).size !== 2) {
    reply.code(400);
    return { error: 'participants must include one P1 and one P2 entry.' };
  }
  if (!normalisedParticipants.some((participant) => participant.accountId === accountId)) {
    reply.code(403);
    return { error: 'Authenticated account must be one of the replay participants.' };
  }

  const winnerAccountId = body.winnerAccountId === undefined || body.winnerAccountId === null
    ? null
    : String(body.winnerAccountId).trim();
  if (winnerAccountId !== null && !isUuid(winnerAccountId)) {
    reply.code(400);
    return { error: 'winnerAccountId must be a UUID when provided.' };
  }
  if (winnerAccountId && !normalisedParticipants.some((participant) => participant.accountId === winnerAccountId)) {
    reply.code(400);
    return { error: 'winnerAccountId must reference one of the replay participants.' };
  }

  const participantIds = normalisedParticipants.map((participant) => participant.accountId);
  const participantAccounts = await db.query(
    'SELECT id FROM accounts WHERE id = ANY($1::uuid[])',
    [participantIds],
  );
  if ((participantAccounts.rowCount ?? 0) !== participantIds.length) {
    reply.code(400);
    return { error: 'One or more replay participants do not exist.' };
  }

  const replayId = randomUUID();
  const matchId = isUuid(body.matchId) ? body.matchId : randomUUID();
  const retentionUntil = computeReplayRetentionUntil(queueType, body.retentionClass, new Date());
  const blobRecord = await replayBlobStore.putReplayPayload(replayId, payload);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO replays(
          replay_id, match_id, queue_type, match_type, region, patch_version,
          ruleset_version, sim_build_hash, payload_version, outcome, winner_account_id,
          started_at, ended_at, duration_seconds, storage_key, compressed_bytes, sha256, retention_until
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17, $18
        )
      `,
      [
        replayId,
        matchId,
        queueType,
        matchType,
        region,
        patchVersion,
        rulesetVersion,
        simBuildHash,
        payload.header.payloadVersion,
        outcome,
        winnerAccountId,
        startedAt.toISOString(),
        endedAt.toISOString(),
        durationSeconds,
        blobRecord.storageKey,
        blobRecord.compressedBytes,
        blobRecord.sha256,
        retentionUntil.toISOString(),
      ],
    );

    for (const participant of normalisedParticipants) {
      await client.query(
        `
          INSERT INTO replay_participants(replay_id, account_id, side, character_id, result)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          replayId,
          participant.accountId,
          participant.side,
          participant.characterId,
          participant.result,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    await replayBlobStore.deleteReplayPayload(blobRecord.storageKey);
    const message = error instanceof Error ? error.message : 'Replay ingest failed.';
    if (message.includes('replays_match_id_key')) {
      reply.code(409);
      return { error: 'Replay already exists for this matchId.' };
    }
    throw error;
  } finally {
    client.release();
  }

  reply.code(201);
  return {
    replayId,
    matchId,
    storageKey: blobRecord.storageKey,
    compressedBytes: blobRecord.compressedBytes,
    sha256: blobRecord.sha256,
    payloadVersion: payload.header.payloadVersion,
    retentionUntil: retentionUntil.toISOString(),
  };
});

app.get('/replays/search', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const parseResult = parseReplaySearchQuery((request.query ?? {}) as ReplaySearchQueryInput, accountId);
  if (!parseResult.ok) {
    reply.code(parseResult.statusCode);
    return { error: parseResult.error };
  }

  const built = buildReplaySearchQuery(parseResult.filters, parseResult.cursor);
  const searchResult = await db.query(built.query.text, built.query.values);
  const rows = searchResult.rows as Array<{
    replay_id: string;
    match_id: string;
    queue_type: string;
    match_type: string;
    region: string;
    patch_version: string;
    ruleset_version: string;
    payload_version: number;
    outcome: string;
    winner_account_id: string | null;
    started_at: unknown;
    ended_at: unknown;
    duration_seconds: number;
    player_account_id: string;
    player_side: string;
    player_character_id: string;
    player_result: string;
    opponent_account_id: string;
    opponent_side: string;
    opponent_character_id: string;
    opponent_result: string;
  }>;

  const pageRows = rows.slice(0, parseResult.filters.limit);
  const items = pageRows.map((row) => ({
    replayId: row.replay_id,
    matchId: row.match_id,
    queueType: row.queue_type,
    matchType: row.match_type,
    region: row.region,
    patchVersion: row.patch_version,
    rulesetVersion: row.ruleset_version,
    payloadVersion: row.payload_version,
    outcome: row.outcome,
    winnerAccountId: row.winner_account_id,
    startedAt: toIsoString(row.started_at),
    endedAt: toIsoString(row.ended_at),
    durationSeconds: row.duration_seconds,
    player: {
      accountId: row.player_account_id,
      side: row.player_side,
      characterId: row.player_character_id,
      result: row.player_result,
    },
    opponent: {
      accountId: row.opponent_account_id,
      side: row.opponent_side,
      characterId: row.opponent_character_id,
      result: row.opponent_result,
    },
  }));

  const nextCursor = rows.length > parseResult.filters.limit && pageRows.length > 0
    ? encodeReplaySearchCursor(
      parseResult.filters,
      toIsoString(pageRows[pageRows.length - 1].started_at),
      pageRows[pageRows.length - 1].replay_id,
    )
    : null;

  return {
    items,
    nextCursor,
    page: {
      limit: parseResult.filters.limit,
      returned: items.length,
    },
  };
});

app.get('/replays/:replayId', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { replayId?: string };
  if (!isUuid(params.replayId)) {
    reply.code(400);
    return { error: 'Invalid replay id.' };
  }

  const metadata = await db.query(
    `
      SELECT
        r.replay_id, r.match_id, r.queue_type, r.match_type, r.region, r.patch_version,
        r.ruleset_version, r.sim_build_hash, r.payload_version, r.outcome, r.winner_account_id,
        r.started_at, r.ended_at, r.duration_seconds, r.storage_key, r.compressed_bytes,
        r.sha256, r.retention_until, r.deleted_at, r.delete_reason, r.created_at
      FROM replays r
      WHERE r.replay_id = $1
      LIMIT 1
    `,
    [params.replayId],
  );
  if (!metadata.rowCount) {
    reply.code(404);
    return { error: 'Replay not found.' };
  }
  const row = metadata.rows[0] as Record<string, unknown>;
  if (row.deleted_at) {
    reply.code(410);
    return { error: 'Replay has been deleted.' };
  }

  const participantAccess = await db.query(
    'SELECT 1 FROM replay_participants WHERE replay_id = $1 AND account_id = $2 LIMIT 1',
    [params.replayId, accountId],
  );
  if (!participantAccess.rowCount) {
    reply.code(403);
    return { error: 'Replay access is restricted to match participants.' };
  }

  const participants = await db.query(
    `
      SELECT account_id, side, character_id, result
      FROM replay_participants
      WHERE replay_id = $1
      ORDER BY side
    `,
    [params.replayId],
  );

  return {
    replayId: row.replay_id,
    matchId: row.match_id,
    queueType: row.queue_type,
    matchType: row.match_type,
    region: row.region,
    patchVersion: row.patch_version,
    rulesetVersion: row.ruleset_version,
    simBuildHash: row.sim_build_hash,
    payloadVersion: row.payload_version,
    outcome: row.outcome,
    winnerAccountId: row.winner_account_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    compressedBytes: row.compressed_bytes,
    sha256: row.sha256,
    retentionUntil: row.retention_until,
    createdAt: row.created_at,
    participants: participants.rows,
  };
});

app.get('/replays/:replayId/payload', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { replayId?: string };
  if (!isUuid(params.replayId)) {
    reply.code(400);
    return { error: 'Invalid replay id.' };
  }

  const replayResult = await db.query(
    `
      SELECT replay_id, storage_key, deleted_at
      FROM replays
      WHERE replay_id = $1
      LIMIT 1
    `,
    [params.replayId],
  );
  if (!replayResult.rowCount) {
    reply.code(404);
    return { error: 'Replay not found.' };
  }
  const replayRow = replayResult.rows[0] as { storage_key: string; deleted_at: string | null };
  if (replayRow.deleted_at) {
    reply.code(410);
    return { error: 'Replay has been deleted.' };
  }

  const participantAccess = await db.query(
    'SELECT 1 FROM replay_participants WHERE replay_id = $1 AND account_id = $2 LIMIT 1',
    [params.replayId, accountId],
  );
  if (!participantAccess.rowCount) {
    reply.code(403);
    return { error: 'Replay access is restricted to match participants.' };
  }

  let payload: unknown;
  try {
    payload = await replayBlobStore.getReplayPayload(replayRow.storage_key);
  } catch (error: unknown) {
    const errorCode = (error as { code?: string } | undefined)?.code;
    if (errorCode === 'ENOENT') {
      reply.code(404);
      return { error: 'Replay payload blob not found.' };
    }
    throw error;
  }
  return {
    replayId: params.replayId,
    payload,
  };
});

app.delete('/replays/:replayId', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { replayId?: string };
  if (!isUuid(params.replayId)) {
    reply.code(400);
    return { error: 'Invalid replay id.' };
  }
  const body = (request.body ?? {}) as ReplayDeleteBody;
  const deleteReason = String(body.reason ?? 'user_request').trim() || 'user_request';

  const client = await db.connect();
  let storageKey: string | null = null;
  let alreadyDeleted = false;
  let deletedAtIso = new Date().toISOString();
  try {
    await client.query('BEGIN');
    const replayResult = await client.query(
      `
        SELECT replay_id, storage_key, deleted_at
        FROM replays
        WHERE replay_id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [params.replayId],
    );
    if (!replayResult.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { error: 'Replay not found.' };
    }

    const replayRow = replayResult.rows[0] as { storage_key: string; deleted_at: string | null };
    storageKey = replayRow.storage_key;
    alreadyDeleted = Boolean(replayRow.deleted_at);

    const participantAccess = await client.query(
      'SELECT 1 FROM replay_participants WHERE replay_id = $1 AND account_id = $2 LIMIT 1',
      [params.replayId, accountId],
    );
    if (!participantAccess.rowCount) {
      await client.query('ROLLBACK');
      reply.code(403);
      return { error: 'Replay delete is restricted to match participants.' };
    }

    if (!alreadyDeleted) {
      const updateResult = await client.query(
        `
          UPDATE replays
          SET deleted_at = NOW(), delete_reason = $2
          WHERE replay_id = $1
          RETURNING deleted_at
        `,
        [params.replayId, deleteReason],
      );
      deletedAtIso = (updateResult.rows[0] as { deleted_at: string }).deleted_at;
      await client.query(
        `
          INSERT INTO replay_deletion_events(replay_id, actor_account_id, reason)
          VALUES ($1, $2, $3)
        `,
        [params.replayId, accountId, deleteReason],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (storageKey) {
    await replayBlobStore.deleteReplayPayload(storageKey);
  }

  return {
    replayId: params.replayId,
    deleted: true,
    alreadyDeleted,
    deletedAt: deletedAtIso,
  };
});

function getAuthenticatedAccountId(request: { headers: Record<string, unknown> }): string | null {
  const headerValue = request.headers['x-account-id'] as string | string[] | undefined;
  const accountId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!isUuid(accountId)) {
    return null;
  }
  return accountId as string;
}

app.get('/profile', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const accountExists = await db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  if (!accountExists.rowCount) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const profile = await db.query(
    `
      INSERT INTO profiles(account_id)
      VALUES ($1)
      ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
      RETURNING account_id, display_name, settings_json, created_at, updated_at
    `,
    [accountId],
  );

  return profile.rows[0];
});

app.put('/profile', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as UpdateProfileBody;
  const displayName = body.displayName === null ? null : String(body.displayName ?? '').trim() || null;
  if (displayName && displayName.length > 32) {
    reply.code(400);
    return { error: 'displayName must be 32 characters or fewer.' };
  }

  let settings: Record<string, unknown> = {};
  if (body.settings !== undefined) {
    try {
      settings = assertSettingsObject(body.settings);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Invalid settings payload.' };
    }
  }

  const accountExists = await db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  if (!accountExists.rowCount) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const result = await db.query(
    `
      INSERT INTO profiles(account_id, display_name, settings_json)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (account_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        settings_json = EXCLUDED.settings_json,
        updated_at = NOW()
      RETURNING account_id, display_name, settings_json, created_at, updated_at
    `,
    [accountId, displayName, JSON.stringify(settings)],
  );

  return result.rows[0];
});

const port = Number(process.env.API_PORT ?? 8787);
app.listen({ port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
