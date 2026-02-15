import Fastify from 'fastify';
import cors from '@fastify/cors';
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
import { validateSteamExchangeTicket } from './auth/steamAuth';
import { logIdentityLinkEvent, mergeAccountIntoTarget } from './auth/steamLinkService';
import {
  createPresenceInviteService,
  type PresenceActivityInput,
  type PresenceStatus,
} from './social/presenceInviteService';
import {
  getEnforcementActionState,
  type EnforcementActionType,
} from './social/enforcementPolicy';
import { deriveSloSummary, evaluateSloAlerts } from './ops/sloPolicy';
import {
  evaluateRankedResultSubmission,
  type RankedResultSuspiciousReason,
} from './ranked/resultValidation';
import { applyRankedRatingUpdate } from './ranked/ratingService';
import {
  detectRankedAnomalies,
  type RankedAnomalyType,
} from './ranked/anomalyDetection';
import {
  ensureActiveSeason,
  getSeasonById,
  resolveRankedSeasonDurationDays,
  runRankedSeasonReset,
} from './ranked/seasonService';
import {
  applyLeagueProgression,
  type LeagueTier,
} from './ranked/leagueService';
import { applyMasterRatingProgression } from './ranked/masterRatingService';

const app = Fastify({ logger: true });
const allowedCorsOrigins = parseCorsOrigins(process.env.API_CORS_ORIGINS);
app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.includes('*') || allowedCorsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-account-id', 'x-admin-key', 'x-admin-actor'],
});

app.addHook('onRequest', async (request) => {
  (request as { _sloRequestStartAt?: bigint })._sloRequestStartAt = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  const startedAt = (request as { _sloRequestStartAt?: bigint })._sloRequestStartAt;
  if (!startedAt) {
    return;
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const routePath = String(
    (request as { routeOptions?: { url?: string } }).routeOptions?.url
    ?? request.url.split('?')[0]
    ?? 'unknown',
  ).slice(0, 160);
  try {
    await db.query(
      `
      INSERT INTO service_slo_request_samples(method, route, status_code, latency_ms)
      VALUES ($1, $2, $3, $4)
      `,
      [
        request.method.toUpperCase(),
        routePath,
        reply.statusCode,
        Math.max(0, Math.round(elapsedMs)),
      ],
    );
  } catch (error) {
    request.log.warn({ err: error }, 'Failed to record SLO request sample.');
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(['steam', 'web']);
const matchmakingQueueService = createMatchmakingQueueService({
  ticketTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_TICKET_TTL_SECONDS),
  sessionTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SESSION_TTL_SECONDS),
  sessionTokenTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SESSION_TOKEN_TTL_SECONDS),
  reconnectGraceSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_RECONNECT_GRACE_SECONDS),
  closedTicketRetentionSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_CLOSED_RETENTION_SECONDS),
  rankedRatingInitialGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_RANKED_INITIAL_GAP),
  rankedRatingExpansionPerSecond: parsePositiveNumberEnv(process.env.MATCHMAKING_RANKED_GAP_EXPANSION_PER_SECOND),
  rankedRatingMaxGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_RANKED_MAX_GAP),
  rankedMasterInitialGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_MASTER_INITIAL_GAP),
  rankedMasterExpansionPerSecond: parsePositiveNumberEnv(process.env.MATCHMAKING_MASTER_GAP_EXPANSION_PER_SECOND),
  rankedMasterMaxGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_MASTER_MAX_GAP),
  rankedMasterStrictRegionSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_MASTER_STRICT_REGION_SECONDS),
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
const presenceInviteService = createPresenceInviteService({
  presenceTtlMs: parsePositiveIntegerEnv(process.env.PRESENCE_TTL_MS),
  inviteTtlMs: parsePositiveIntegerEnv(process.env.FRIEND_INVITE_TTL_MS),
  inviteRateWindowMs: parsePositiveIntegerEnv(process.env.FRIEND_INVITE_RATE_WINDOW_MS),
  maxInvitesPerWindow: parsePositiveIntegerEnv(process.env.FRIEND_INVITE_MAX_PER_WINDOW),
  presenceRateWindowMs: parsePositiveIntegerEnv(process.env.PRESENCE_RATE_WINDOW_MS),
  maxPresenceUpdatesPerWindow: parsePositiveIntegerEnv(process.env.PRESENCE_MAX_UPDATES_PER_WINDOW),
  webInviteBaseUrl: process.env.ROOM_WEB_INVITE_BASE_URL,
  steamAppId: process.env.STEAM_APP_ID,
});
const replayBlobStore = createReplayBlobStoreFromEnv(process.env);
const rankedReplayRetentionDays = parsePositiveIntegerEnv(process.env.REPLAY_RETENTION_DAYS_RANKED) ?? 365;
const casualReplayRetentionDays = parsePositiveIntegerEnv(process.env.REPLAY_RETENTION_DAYS_CASUAL) ?? 90;
const rankedSeasonDurationDays = resolveRankedSeasonDurationDays(process.env);
const rankedCalibrationMatchesRequired = parsePositiveIntegerEnv(process.env.RANKED_CALIBRATION_MATCHES) ?? 5;
const rankedMasterEntryRating = parsePositiveIntegerEnv(process.env.RANKED_MASTER_ENTRY_RATING) ?? 1900;
const rankedMasterBasePoints = parsePositiveIntegerEnv(process.env.RANKED_MASTER_BASE_POINTS) ?? 1500;
const rankedMasterQueueWeight = parsePositiveNumberEnv(process.env.RANKED_MR_WEIGHT_RANKED) ?? 1;
const rankedAnomalyMinMatchIntervalSeconds = parsePositiveIntegerEnv(
  process.env.RANKED_ANOMALY_MIN_MATCH_INTERVAL_SECONDS,
) ?? 30;
const rankedAnomalyRatingJumpThreshold = parsePositiveIntegerEnv(process.env.RANKED_ANOMALY_RATING_JUMP_THRESHOLD) ?? 60;
const rankedAnomalyMrJumpThreshold = parsePositiveIntegerEnv(process.env.RANKED_ANOMALY_MR_JUMP_THRESHOLD) ?? 80;
const rankedAnomalyAdminKey = process.env.RANKED_ANOMALY_ADMIN_KEY;
const enforcementAdminKey = process.env.ENFORCEMENT_ADMIN_KEY;
const sloAdminKey = process.env.SLO_ADMIN_KEY;
const sloAvailabilityTargetPercent = parsePercentageEnv(process.env.SLO_AVAILABILITY_TARGET_PERCENT) ?? 99.5;
const sloErrorRateTargetPercent = parsePercentageEnv(process.env.SLO_ERROR_RATE_TARGET_PERCENT) ?? 1;
const sloLatencyP95TargetMs = parsePositiveIntegerEnv(process.env.SLO_LATENCY_P95_TARGET_MS) ?? 350;

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

interface SteamExchangeBody {
  steamTicket?: string;
  mergeAccountId?: string;
  displayName?: string | null;
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

interface SendFriendRequestBody {
  targetAccountId?: string;
}

interface FriendBlockBody {
  targetAccountId?: string;
  reason?: string;
}

interface FriendRemoveBody {
  targetAccountId?: string;
}

interface FriendRequestsQuery {
  status?: string;
}

interface SocialPrivacyUpdateBody {
  presenceVisibility?: string;
  invitePermissions?: string;
}

interface SocialModerationTargetBody {
  targetAccountId?: string;
  reason?: string;
}

interface PresenceUpdateBody {
  status?: string;
  activityType?: string;
  queueType?: string;
  roomCode?: string;
}

interface SendFriendInviteBody {
  targetAccountId?: string;
  contextType?: string;
  queueType?: string;
  roomCode?: string;
}

interface RankedResultSubmitBody {
  sessionId?: string;
  sessionToken?: string;
  matchId?: string;
  participantAccountIds?: string[];
  winnerAccountId?: string | null;
  outcome?: string;
}

type RankedResultOutcome = 'p1_win' | 'p2_win' | 'draw' | 'forfeit';

interface RankedProgressionQuery {
  seasonId?: string;
}

interface RankedLeaderboardQuery {
  seasonId?: string;
  region?: string;
  limit?: string;
  offset?: string;
  track?: string;
}

interface RankedAnomalyAlertsQuery {
  status?: string;
  type?: string;
  accountId?: string;
  matchId?: string;
  limit?: string;
  offset?: string;
}

interface RankedAnomalyAlertParams {
  alertId?: string;
}

interface RankedAnomalyAlertReviewBody {
  status?: string;
  note?: string;
}

type RankedAnomalyStatus = 'open' | 'false_positive' | 'confirmed';
type EnforcementAppealStatus = 'submitted' | 'under_review' | 'accepted' | 'rejected';

interface AdminCreateEnforcementActionBody {
  targetAccountId?: string;
  actionType?: string;
  reason?: string;
  durationHours?: number;
  startsAt?: string;
  sourceAlertId?: string | null;
  metadata?: Record<string, unknown>;
}

interface AdminListEnforcementActionsQuery {
  targetAccountId?: string;
  actionType?: string;
  activeOnly?: string;
  limit?: string;
  offset?: string;
}

interface AdminReviewAppealParams {
  appealId?: string;
}

interface AdminReviewAppealBody {
  status?: string;
  reviewerNote?: string;
  revokeAction?: boolean;
}

interface PlayerCreateEnforcementAppealBody {
  actionId?: string;
  note?: string;
}

interface SloSummaryQuery {
  windowHours?: string;
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

function parsePositiveNumberEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parsePercentageEnv(value: string | undefined): number | undefined {
  const parsed = parsePositiveNumberEnv(value);
  if (parsed === undefined || parsed > 100) {
    return undefined;
  }
  return parsed;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) {
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
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

async function areFriends(accountId: string, targetAccountId: string): Promise<boolean> {
  const pair = orderAccountPair(accountId, targetAccountId);
  const friendship = await db.query(
    `
      SELECT 1
      FROM friendships
      WHERE account_id_low = $1 AND account_id_high = $2
      LIMIT 1
    `,
    [pair.low, pair.high],
  );
  return Boolean(friendship.rowCount);
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

function parseRankedOutcome(value: string | undefined): RankedResultOutcome | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'p1_win' || normalised === 'p2_win' || normalised === 'draw' || normalised === 'forfeit') {
    return normalised;
  }
  return null;
}

function parseRankedAnomalyStatus(value: string | undefined): RankedAnomalyStatus | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'open' || normalised === 'false_positive' || normalised === 'confirmed') {
    return normalised;
  }
  return null;
}

function parseRankedAnomalyType(value: string | undefined): RankedAnomalyType | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'impossible_cadence' || normalised === 'rating_jump' || normalised === 'mr_jump') {
    return normalised;
  }
  return null;
}

function parseEnforcementActionType(value: string | undefined): EnforcementActionType | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'warning' || normalised === 'suspension' || normalised === 'ban') {
    return normalised;
  }
  return null;
}

function parseEnforcementAppealStatus(value: string | undefined): EnforcementAppealStatus | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'submitted' || normalised === 'under_review' || normalised === 'accepted' || normalised === 'rejected') {
    return normalised;
  }
  return null;
}

function parseQueryBoolean(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'true' || normalised === '1') {
    return true;
  }
  if (normalised === 'false' || normalised === '0') {
    return false;
  }
  return null;
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

function orderAccountPair(firstAccountId: string, secondAccountId: string): { low: string; high: string } {
  return firstAccountId < secondAccountId
    ? { low: firstAccountId, high: secondAccountId }
    : { low: secondAccountId, high: firstAccountId };
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseLeaderboardRegion(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const region = value.trim().toLowerCase();
  if (!region) {
    return null;
  }
  return region;
}

function parseLeaderboardTrack(value: string | undefined): 'rating' | 'master' {
  if (!value) {
    return 'rating';
  }
  const parsed = value.trim().toLowerCase();
  return parsed === 'master' ? 'master' : 'rating';
}

function getHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function getAdminActorIdentity(headers: Record<string, unknown>): string {
  const actor = getHeaderValue(headers['x-admin-actor'] as string | string[] | undefined).trim();
  return actor ? actor.slice(0, 64) : 'ops';
}

function parseObjectPayload(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object when provided.`);
  }
  const serialised = JSON.stringify(value);
  if (serialised.length > 16_384) {
    throw new Error(`${fieldName} payload exceeds 16KB limit.`);
  }
  return value as Record<string, unknown>;
}

interface BlockingEnforcementAction {
  actionId: string;
  actionType: EnforcementActionType;
  reason: string;
  startsAt: string;
  endsAt: string | null;
}

async function getBlockingEnforcementAction(accountId: string): Promise<BlockingEnforcementAction | null> {
  const result = await db.query(
    `
      SELECT
        action_id,
        action_type,
        reason,
        starts_at,
        ends_at
      FROM enforcement_actions
      WHERE target_account_id = $1
        AND revoked_at IS NULL
        AND starts_at <= NOW()
        AND (
          action_type = 'ban'
          OR (action_type = 'suspension' AND ends_at > NOW())
        )
      ORDER BY
        CASE WHEN action_type = 'ban' THEN 0 ELSE 1 END,
        starts_at DESC
      LIMIT 1
    `,
    [accountId],
  );
  if (!result.rowCount) {
    return null;
  }
  const row = result.rows[0] as {
    action_id: string;
    action_type: EnforcementActionType;
    reason: string;
    starts_at: string;
    ends_at: string | null;
  };
  return {
    actionId: row.action_id,
    actionType: row.action_type,
    reason: row.reason,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

type SocialPresenceVisibility = 'friends' | 'private';
type SocialInvitePermissions = 'friends' | 'none';

interface SocialPrivacySettings {
  presenceVisibility: SocialPresenceVisibility;
  invitePermissions: SocialInvitePermissions;
  updatedAt: string | null;
  updatedByAccountId: string | null;
}

interface SocialModerationControl {
  blocked: boolean;
  muted: boolean;
  reason: string | null;
}

const DEFAULT_SOCIAL_PRIVACY_SETTINGS: SocialPrivacySettings = {
  presenceVisibility: 'friends',
  invitePermissions: 'friends',
  updatedAt: null,
  updatedByAccountId: null,
};

function parseSocialPresenceVisibility(value: string | undefined): SocialPresenceVisibility | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'friends' || normalised === 'private') {
    return normalised;
  }
  return null;
}

function parseSocialInvitePermissions(value: string | undefined): SocialInvitePermissions | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'friends' || normalised === 'none') {
    return normalised;
  }
  return null;
}

async function getSocialPrivacySettings(accountId: string): Promise<SocialPrivacySettings> {
  const result = await db.query(
    `
      SELECT presence_visibility, invite_permissions, updated_at, updated_by_account_id
      FROM social_privacy_settings
      WHERE account_id = $1
      LIMIT 1
    `,
    [accountId],
  );
  if (!result.rowCount) {
    return DEFAULT_SOCIAL_PRIVACY_SETTINGS;
  }
  const row = result.rows[0] as {
    presence_visibility: SocialPresenceVisibility;
    invite_permissions: SocialInvitePermissions;
    updated_at: unknown;
    updated_by_account_id: string | null;
  };
  return {
    presenceVisibility: row.presence_visibility,
    invitePermissions: row.invite_permissions,
    updatedAt: row.updated_at ? toIsoString(row.updated_at) : null,
    updatedByAccountId: row.updated_by_account_id ?? null,
  };
}

async function getSocialModerationControl(ownerAccountId: string, targetAccountId: string): Promise<SocialModerationControl> {
  const result = await db.query(
    `
      SELECT blocked, muted, reason
      FROM social_moderation_controls
      WHERE owner_account_id = $1 AND target_account_id = $2
      LIMIT 1
    `,
    [ownerAccountId, targetAccountId],
  );
  if (!result.rowCount) {
    return {
      blocked: false,
      muted: false,
      reason: null,
    };
  }
  const row = result.rows[0] as { blocked: boolean; muted: boolean; reason: string | null };
  return {
    blocked: row.blocked,
    muted: row.muted,
    reason: row.reason ?? null,
  };
}

async function upsertSocialModerationControl(
  ownerAccountId: string,
  targetAccountId: string,
  values: { blocked?: boolean; muted?: boolean; reason?: string | null },
): Promise<SocialModerationControl> {
  const result = await db.query(
    `
      INSERT INTO social_moderation_controls(owner_account_id, target_account_id, blocked, muted, reason, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (owner_account_id, target_account_id)
      DO UPDATE SET
        blocked = COALESCE($3, social_moderation_controls.blocked),
        muted = COALESCE($4, social_moderation_controls.muted),
        reason = COALESCE($5, social_moderation_controls.reason),
        updated_at = NOW()
      RETURNING blocked, muted, reason
    `,
    [
      ownerAccountId,
      targetAccountId,
      values.blocked ?? null,
      values.muted ?? null,
      values.reason ?? null,
    ],
  );
  const row = result.rows[0] as { blocked: boolean; muted: boolean; reason: string | null };
  return {
    blocked: row.blocked,
    muted: row.muted,
    reason: row.reason ?? null,
  };
}

function parsePresenceStatus(value: string | undefined): PresenceStatus | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'online' || normalised === 'away' || normalised === 'offline') {
    return normalised;
  }
  return null;
}

function parsePresenceActivity(
  activityType: string | undefined,
  queueTypeRaw: string | undefined,
  roomCodeRaw: string | undefined,
): PresenceActivityInput | null {
  if (!activityType) {
    return null;
  }
  const type = activityType.trim().toLowerCase();
  if (type === 'queue') {
    const queueType = queueTypeRaw?.trim().toLowerCase();
    if (queueType !== 'ranked' && queueType !== 'unranked') {
      return null;
    }
    return {
      type: 'queue',
      queueType,
    };
  }
  if (type === 'room') {
    const roomCode = roomCodeRaw?.trim().toUpperCase();
    if (!roomCode || roomCode.length < 4 || roomCode.length > 12) {
      return null;
    }
    return {
      type: 'room',
      roomCode,
    };
  }
  if (type === 'home' || type === 'match' || type === 'offline') {
    return { type };
  }
  return null;
}

async function logPresenceInviteEvent(
  event: {
    accountId: string | null;
    targetAccountId?: string | null;
    eventType:
      | 'presence_updated'
      | 'presence_rate_limited'
      | 'invite_sent'
      | 'invite_cancelled'
      | 'invite_rate_limited'
      | 'invite_rejected';
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.query(
      `
        INSERT INTO presence_invite_events(account_id, target_account_id, event_type, metadata)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        event.accountId,
        event.targetAccountId ?? null,
        event.eventType,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  } catch {
    // Presence/invite audit logging must not fail request handling in prototype stage.
  }
}

async function logSocialModerationEvent(
  event: {
    actorAccountId: string | null;
    targetAccountId?: string | null;
    action: 'mute' | 'unmute' | 'block' | 'unblock' | 'privacy_updated' | 'friend_request_blocked' | 'invite_blocked';
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.query(
      `
        INSERT INTO social_moderation_events(actor_account_id, target_account_id, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        event.actorAccountId,
        event.targetAccountId ?? null,
        event.action,
        event.reason ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  } catch {
    // Moderation event logging must not fail request handling in prototype stage.
  }
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

app.delete('/accounts/:accountId/identities/:provider', async (request, reply) => {
  const params = request.params as { accountId?: string; provider?: string };
  if (!isUuid(params.accountId)) {
    reply.code(400);
    return { error: 'Invalid account id.' };
  }
  const provider = normaliseProvider(params.provider);
  if (!provider) {
    reply.code(400);
    return { error: 'provider must be one of: steam, web.' };
  }

  const actorAccountId = getAuthenticatedAccountId(request);
  if (!actorAccountId || actorAccountId !== params.accountId) {
    reply.code(403);
    return { error: 'Only the authenticated account can unlink its own identities.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `
        SELECT id, provider, provider_user_id
        FROM identities
        WHERE account_id = $1 AND provider = $2
        LIMIT 1
        FOR UPDATE
      `,
      [params.accountId, provider],
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { error: 'Identity not found for account.' };
    }
    const row = existing.rows[0] as { id: number; provider: 'steam' | 'web'; provider_user_id: string };
    await client.query('DELETE FROM identities WHERE id = $1', [row.id]);
    if (provider === 'web') {
      await client.query('DELETE FROM web_auth_credentials WHERE account_id = $1', [params.accountId]);
    }
    await logIdentityLinkEvent(client, {
      accountId: params.accountId,
      provider: row.provider,
      providerUserId: row.provider_user_id,
      eventType: 'unlinked',
      actor: actorAccountId,
      metadata: {
        reason: 'user_request',
      },
    });
    await client.query('COMMIT');
    return {
      accountId: params.accountId,
      provider,
      unlinked: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
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

app.post('/auth/steam/exchange', async (request, reply) => {
  const body = (request.body ?? {}) as SteamExchangeBody;
  const ticketValidation = validateSteamExchangeTicket(body.steamTicket);
  if (!ticketValidation.ok) {
    reply.code(401);
    return {
      error: ticketValidation.error,
      recovery: 'Retry Steam sign-in and submit a fresh ticket.',
    };
  }
  const steamUserId = ticketValidation.steamUserId;

  const mergeAccountIdRaw = String(body.mergeAccountId ?? '').trim();
  const mergeAccountId = mergeAccountIdRaw || null;
  if (mergeAccountId && !isUuid(mergeAccountId)) {
    reply.code(400);
    return { error: 'mergeAccountId must be a UUID when provided.' };
  }

  const authenticatedAccountId = getAuthenticatedAccountId(request);
  if (mergeAccountId && authenticatedAccountId !== mergeAccountId) {
    reply.code(403);
    return { error: 'mergeAccountId must match authenticated x-account-id header.' };
  }

  const preferredLinkAccountId = mergeAccountId ?? authenticatedAccountId ?? null;
  const displayName = normaliseDisplayName(body.displayName);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existingSteamIdentity = await client.query(
      `
        SELECT i.account_id, a.status
        FROM identities i
        JOIN accounts a ON a.id = i.account_id
        WHERE i.provider = 'steam' AND i.provider_user_id = $1
        LIMIT 1
      `,
      [steamUserId],
    );

    let accountId: string;
    let createdAccount = false;
    let mergedFromAccountId: string | null = null;

    if (existingSteamIdentity.rowCount) {
      const existing = existingSteamIdentity.rows[0] as { account_id: string; status: string };
      if (existing.status !== 'active') {
        await client.query('ROLLBACK');
        reply.code(403);
        return {
          error: 'Steam-linked account is disabled.',
          recovery: 'Contact support to restore account access.',
        };
      }
      accountId = existing.account_id;
      if (preferredLinkAccountId && preferredLinkAccountId !== accountId) {
        await mergeAccountIntoTarget(client, preferredLinkAccountId, accountId, authenticatedAccountId);
        mergedFromAccountId = preferredLinkAccountId;
      }
    } else if (preferredLinkAccountId) {
      const accountResult = await client.query(
        'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE',
        [preferredLinkAccountId],
      );
      if (!accountResult.rowCount) {
        await client.query('ROLLBACK');
        reply.code(404);
        return { error: 'Merge account not found.' };
      }
      const accountRow = accountResult.rows[0] as { id: string; status: string };
      if (accountRow.status !== 'active') {
        await client.query('ROLLBACK');
        reply.code(409);
        return {
          error: 'Merge account is disabled.',
          recovery: 'Contact support to re-enable account access.',
        };
      }
      accountId = accountRow.id;
    } else {
      const createdAccountResult = await client.query(
        'INSERT INTO accounts(status) VALUES ($1) RETURNING id',
        ['active'],
      );
      accountId = (createdAccountResult.rows[0] as { id: string }).id;
      createdAccount = true;
    }

    if (!existingSteamIdentity.rowCount) {
      await client.query(
        `
          INSERT INTO identities(account_id, provider, provider_user_id)
          VALUES ($1, 'steam', $2)
        `,
        [accountId, steamUserId],
      );
      await logIdentityLinkEvent(client, {
        accountId,
        provider: 'steam',
        providerUserId: steamUserId,
        eventType: 'linked',
        actor: authenticatedAccountId ?? 'steam_exchange',
        metadata: {
          reason: preferredLinkAccountId ? 'steam_link_existing_account' : 'steam_first_signin_create_account',
        },
      });
    }

    if (displayName) {
      await client.query(
        `
          INSERT INTO profiles(account_id, display_name, settings_json)
          VALUES ($1, $2, '{}'::jsonb)
          ON CONFLICT (account_id)
          DO UPDATE SET
            display_name = COALESCE(NULLIF(profiles.display_name, ''), EXCLUDED.display_name),
            updated_at = NOW()
        `,
        [accountId, displayName],
      );
    }

    await client.query('COMMIT');

    await logAccountAuthEvent({
      accountId,
      provider: 'steam',
      eventType: mergedFromAccountId ? 'upgrade' : (createdAccount ? 'signup' : 'signin'),
      emailNormalised: `steam:${steamUserId}`,
      reason: mergedFromAccountId ? `merged_from:${mergedFromAccountId}` : null,
    });

    return {
      accountId,
      provider: 'steam',
      steamUserId,
      createdAccount,
      mergedFromAccountId,
      isAuthenticated: true,
    };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Steam token exchange failed.';
    await logAccountAuthEvent({
      accountId: preferredLinkAccountId,
      provider: 'steam',
      eventType: 'signin_failed',
      emailNormalised: `steam:${steamUserId}`,
      reason: message,
    });
    if (message.includes('identities_provider_provider_user_id_key')) {
      reply.code(409);
      return {
        error: 'Steam identity is already linked to another account.',
        recovery: 'Retry sign-in and allow merge with your authenticated account if prompted.',
      };
    }
    if (message.includes('identities_account_id_provider_key')) {
      reply.code(409);
      return { error: 'This account already has a linked steam identity.' };
    }
    if (message === 'Merge source account not found.') {
      reply.code(404);
      return { error: 'Merge account not found.' };
    }
    if (message === 'Merge source account is disabled.') {
      reply.code(409);
      return {
        error: 'Merge account is disabled.',
        recovery: 'Contact support to re-enable account access.',
      };
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/social/privacy', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const privacy = await getSocialPrivacySettings(accountId);
  return {
    accountId,
    presenceVisibility: privacy.presenceVisibility,
    invitePermissions: privacy.invitePermissions,
    updatedAt: privacy.updatedAt,
    updatedByAccountId: privacy.updatedByAccountId,
  };
});

app.put('/social/privacy', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const body = (request.body ?? {}) as SocialPrivacyUpdateBody;
  const providedPresenceVisibility = body.presenceVisibility !== undefined
    ? parseSocialPresenceVisibility(body.presenceVisibility)
    : null;
  const providedInvitePermissions = body.invitePermissions !== undefined
    ? parseSocialInvitePermissions(body.invitePermissions)
    : null;

  if (body.presenceVisibility !== undefined && !providedPresenceVisibility) {
    reply.code(400);
    return { error: 'presenceVisibility must be friends or private.' };
  }
  if (body.invitePermissions !== undefined && !providedInvitePermissions) {
    reply.code(400);
    return { error: 'invitePermissions must be friends or none.' };
  }
  if (body.presenceVisibility === undefined && body.invitePermissions === undefined) {
    reply.code(400);
    return { error: 'At least one privacy setting must be provided.' };
  }

  await db.query(
    `
      INSERT INTO social_privacy_settings(account_id, presence_visibility, invite_permissions, updated_at, updated_by_account_id)
      VALUES (
        $1,
        COALESCE($2, $3),
        COALESCE($4, $5),
        NOW(),
        $1
      )
      ON CONFLICT (account_id)
      DO UPDATE SET
        presence_visibility = COALESCE($2, social_privacy_settings.presence_visibility),
        invite_permissions = COALESCE($4, social_privacy_settings.invite_permissions),
        updated_at = NOW(),
        updated_by_account_id = $1
    `,
    [
      accountId,
      providedPresenceVisibility,
      DEFAULT_SOCIAL_PRIVACY_SETTINGS.presenceVisibility,
      providedInvitePermissions,
      DEFAULT_SOCIAL_PRIVACY_SETTINGS.invitePermissions,
    ],
  );

  const updated = await getSocialPrivacySettings(accountId);
  await logSocialModerationEvent({
    actorAccountId: accountId,
    action: 'privacy_updated',
    metadata: {
      presenceVisibility: updated.presenceVisibility,
      invitePermissions: updated.invitePermissions,
    },
  });
  return {
    accountId,
    presenceVisibility: updated.presenceVisibility,
    invitePermissions: updated.invitePermissions,
    updatedAt: updated.updatedAt,
    updatedByAccountId: updated.updatedByAccountId,
  };
});

app.get('/social/moderation/controls', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const rows = await db.query(
    `
      SELECT smc.target_account_id, smc.blocked, smc.muted, smc.reason, smc.updated_at, p.display_name
      FROM social_moderation_controls smc
      LEFT JOIN profiles p ON p.account_id = smc.target_account_id
      WHERE smc.owner_account_id = $1
        AND (smc.blocked = TRUE OR smc.muted = TRUE)
      ORDER BY smc.updated_at DESC
    `,
    [accountId],
  );

  return {
    controls: rows.rows,
    count: rows.rowCount ?? 0,
  };
});

app.post('/social/moderation/mute', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const body = (request.body ?? {}) as SocialModerationTargetBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot mute yourself.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }
  const reason = String(body.reason ?? '').trim() || null;
  const control = await upsertSocialModerationControl(accountId, targetAccountId, {
    muted: true,
    reason,
  });
  await logSocialModerationEvent({
    actorAccountId: accountId,
    targetAccountId,
    action: 'mute',
    reason,
  });
  return {
    targetAccountId,
    ...control,
  };
});

app.post('/social/moderation/unmute', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const body = (request.body ?? {}) as SocialModerationTargetBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot unmute yourself.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }
  const reason = String(body.reason ?? '').trim() || null;
  const control = await upsertSocialModerationControl(accountId, targetAccountId, {
    muted: false,
    reason,
  });
  await logSocialModerationEvent({
    actorAccountId: accountId,
    targetAccountId,
    action: 'unmute',
    reason,
  });
  return {
    targetAccountId,
    ...control,
  };
});

app.post('/social/moderation/unblock', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const body = (request.body ?? {}) as SocialModerationTargetBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot unblock yourself.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }
  const reason = String(body.reason ?? '').trim() || null;
  const control = await upsertSocialModerationControl(accountId, targetAccountId, {
    blocked: false,
    reason,
  });
  await logSocialModerationEvent({
    actorAccountId: accountId,
    targetAccountId,
    action: 'unblock',
    reason,
  });
  return {
    targetAccountId,
    ...control,
  };
});

app.post('/presence', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const body = (request.body ?? {}) as PresenceUpdateBody;
  const rawStatus = typeof body.status === 'string' ? body.status : undefined;
  const explicitStatus = parsePresenceStatus(rawStatus);
  if (rawStatus && !explicitStatus) {
    reply.code(400);
    return { error: 'status must be online, away, or offline when provided.' };
  }
  const status = explicitStatus ?? 'online';
  const activity = parsePresenceActivity(
    typeof body.activityType === 'string' ? body.activityType : (status === 'offline' ? 'offline' : 'home'),
    typeof body.queueType === 'string' ? body.queueType : undefined,
    typeof body.roomCode === 'string' ? body.roomCode : undefined,
  );
  if (!activity) {
    reply.code(400);
    return { error: 'Presence activity is invalid for the requested context.' };
  }

  const updateResult = presenceInviteService.setPresence(accountId, status, activity);
  if (!updateResult.ok) {
    if (updateResult.code === 'rate_limited') {
      await logPresenceInviteEvent({
        accountId,
        eventType: 'presence_rate_limited',
        metadata: {
          status,
          activityType: activity.type,
          reason: updateResult.message,
        },
      });
    }
    reply.code(updateResult.code === 'rate_limited' ? 429 : 400);
    return { error: updateResult.message, code: updateResult.code };
  }

  await logPresenceInviteEvent({
    accountId,
    eventType: 'presence_updated',
    metadata: {
      status,
      activityType: activity.type,
      queueType: activity.type === 'queue' ? activity.queueType : null,
      hasRoomContext: activity.type === 'room',
    },
  });

  return updateResult.presence;
});

app.get('/friends/presence', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const rows = await db.query(
    `
      SELECT
        CASE
          WHEN f.account_id_low = $1 THEN f.account_id_high
          ELSE f.account_id_low
        END AS friend_account_id,
        p.display_name,
        f.created_at
      FROM friendships f
      LEFT JOIN profiles p ON p.account_id = (
        CASE
          WHEN f.account_id_low = $1 THEN f.account_id_high
          ELSE f.account_id_low
        END
      )
      WHERE f.account_id_low = $1 OR f.account_id_high = $1
      ORDER BY f.created_at DESC
    `,
    [accountId],
  );

  const friendRows = rows.rows as Array<{
    friend_account_id: string;
    display_name: string | null;
    created_at: unknown;
  }>;
  const friendAccountIds = friendRows.map((row) => row.friend_account_id);
  const presenceEntries = presenceInviteService.listPresence(friendAccountIds);
  const presenceByAccountId = new Map(presenceEntries.map((entry) => [entry.accountId, entry]));
  const privacyByAccountId = new Map<string, SocialPresenceVisibility>();
  if (friendAccountIds.length > 0) {
    const privacyRows = await db.query(
      `
        SELECT account_id, presence_visibility
        FROM social_privacy_settings
        WHERE account_id = ANY($1::uuid[])
      `,
      [friendAccountIds],
    );
    for (const row of privacyRows.rows as Array<{ account_id: string; presence_visibility: SocialPresenceVisibility }>) {
      privacyByAccountId.set(row.account_id, row.presence_visibility);
    }
  }

  return {
    friends: friendRows.map((row) => {
      const presence = presenceByAccountId.get(row.friend_account_id);
      const visibility = privacyByAccountId.get(row.friend_account_id) ?? DEFAULT_SOCIAL_PRIVACY_SETTINGS.presenceVisibility;
      const hiddenByPrivacy = visibility === 'private';
      const status = hiddenByPrivacy ? 'offline' : (presence?.status ?? 'offline');
      const activity = hiddenByPrivacy ? { type: 'offline' } : (presence?.activity ?? { type: 'offline' });
      return {
        accountId: row.friend_account_id,
        displayName: row.display_name,
        status,
        activity,
        updatedAt: hiddenByPrivacy ? null : (presence?.updatedAt ?? null),
        isOnline: status !== 'offline',
      };
    }),
    count: friendRows.length,
  };
});

app.post('/friends/invites/send', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as SendFriendInviteBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot invite yourself.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }
  const actorControl = await getSocialModerationControl(accountId, targetAccountId);
  if (actorControl.blocked || actorControl.muted) {
    const reason = actorControl.blocked
      ? 'sender_blocked_target'
      : 'sender_muted_target';
    await logSocialModerationEvent({
      actorAccountId: accountId,
      targetAccountId,
      action: 'invite_blocked',
      reason,
      metadata: {
        source: 'sender_control',
      },
    });
    reply.code(409);
    return {
      error: actorControl.blocked
        ? 'You have blocked this account. Unblock before sending invites.'
        : 'You have muted this account. Unmute before sending invites.',
    };
  }
  const targetControl = await getSocialModerationControl(targetAccountId, accountId);
  if (targetControl.blocked || targetControl.muted) {
    const reason = targetControl.blocked
      ? 'target_blocked_sender'
      : 'target_muted_sender';
    await logSocialModerationEvent({
      actorAccountId: accountId,
      targetAccountId,
      action: 'invite_blocked',
      reason,
      metadata: {
        source: 'target_control',
      },
    });
    reply.code(403);
    return {
      error: targetControl.blocked
        ? 'This account has blocked you.'
        : 'This account has muted you and is not accepting invites.',
    };
  }
  const targetPrivacy = await getSocialPrivacySettings(targetAccountId);
  if (targetPrivacy.invitePermissions === 'none') {
    await logSocialModerationEvent({
      actorAccountId: accountId,
      targetAccountId,
      action: 'invite_blocked',
      reason: 'invite_permissions_none',
      metadata: {
        invitePermissions: targetPrivacy.invitePermissions,
      },
    });
    reply.code(403);
    return { error: 'This account is not accepting friend invites.' };
  }
  if (!await areFriends(accountId, targetAccountId)) {
    await logPresenceInviteEvent({
      accountId,
      targetAccountId,
      eventType: 'invite_rejected',
      metadata: { reason: 'not_friends' },
    });
    reply.code(403);
    return { error: 'Invites are only allowed between friends.' };
  }

  const contextType = String(body.contextType ?? '').trim().toLowerCase();
  let inviteContext: { type: 'queue'; queueType: 'ranked' | 'unranked' } | { type: 'room'; roomCode: string };
  if (contextType === 'queue') {
    const queueType = String(body.queueType ?? '').trim().toLowerCase();
    if (queueType !== 'ranked' && queueType !== 'unranked') {
      reply.code(400);
      return { error: 'queueType must be ranked or unranked for queue invites.' };
    }
    inviteContext = {
      type: 'queue',
      queueType,
    };
  } else if (contextType === 'room') {
    const roomCode = String(body.roomCode ?? '').trim().toUpperCase();
    if (!roomCode) {
      reply.code(400);
      return { error: 'roomCode is required for room invites.' };
    }
    const accessCheck = roomService.getInvite(roomCode, accountId, 'web');
    if (!accessCheck.ok) {
      reply.code(mapRoomErrorToHttp(accessCheck.error.code));
      return { error: accessCheck.error.message, code: accessCheck.error.code };
    }
    inviteContext = {
      type: 'room',
      roomCode,
    };
  } else {
    reply.code(400);
    return { error: 'contextType must be queue or room.' };
  }

  const inviteResult = presenceInviteService.sendInvite({
    fromAccountId: accountId,
    toAccountId: targetAccountId,
    context: inviteContext,
  });
  if (!inviteResult.ok) {
    await logPresenceInviteEvent({
      accountId,
      targetAccountId,
      eventType: inviteResult.code === 'rate_limited' ? 'invite_rate_limited' : 'invite_rejected',
      metadata: {
        contextType,
        code: inviteResult.code,
        reason: inviteResult.message,
      },
    });
    reply.code(inviteResult.code === 'rate_limited' ? 429 : 400);
    return { error: inviteResult.message, code: inviteResult.code };
  }

  await logPresenceInviteEvent({
    accountId,
    targetAccountId,
    eventType: 'invite_sent',
    metadata: {
      inviteId: inviteResult.invite.inviteId,
      contextType: inviteResult.invite.context.type,
      roomCode: inviteResult.invite.payload.roomCode,
      queueType: inviteResult.invite.payload.queueType,
    },
  });

  reply.code(201);
  return inviteResult.invite;
});

app.get('/friends/invites', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const invites = presenceInviteService.listInvitesForTarget(accountId);
  if (invites.length === 0) {
    return {
      invites: [],
      count: 0,
    };
  }

  const fromAccountIds = [...new Set(invites.map((invite) => invite.fromAccountId))];
  const visibleRows = await db.query(
    `
      SELECT
        CASE
          WHEN f.account_id_low = $1 THEN f.account_id_high
          ELSE f.account_id_low
        END AS friend_account_id,
        p.display_name
      FROM friendships f
      LEFT JOIN profiles p ON p.account_id = (
        CASE
          WHEN f.account_id_low = $1 THEN f.account_id_high
          ELSE f.account_id_low
        END
      )
      WHERE (
        f.account_id_low = $1 AND f.account_id_high = ANY($2::uuid[])
      )
      OR (
        f.account_id_high = $1 AND f.account_id_low = ANY($2::uuid[])
      )
    `,
    [accountId, fromAccountIds],
  );

  const visibleByAccountId = new Map(
    (visibleRows.rows as Array<{ friend_account_id: string; display_name: string | null }>).map((row) => [
      row.friend_account_id,
      row.display_name,
    ]),
  );
  const filtered = invites.filter((invite) => visibleByAccountId.has(invite.fromAccountId));

  return {
    invites: filtered.map((invite) => ({
      ...invite,
      fromDisplayName: visibleByAccountId.get(invite.fromAccountId) ?? null,
    })),
    count: filtered.length,
  };
});

app.post('/friends/invites/:inviteId/cancel', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { inviteId?: string };
  const inviteId = String(params.inviteId ?? '').trim();
  if (!isUuid(inviteId)) {
    reply.code(400);
    return { error: 'inviteId must be a UUID.' };
  }

  const cancelled = presenceInviteService.cancelInvite(inviteId, accountId);
  if (!cancelled) {
    reply.code(404);
    return { error: 'Invite not found or cannot be cancelled by this account.' };
  }

  await logPresenceInviteEvent({
    accountId,
    eventType: 'invite_cancelled',
    metadata: { inviteId },
  });

  return {
    inviteId,
    cancelled: true,
  };
});

app.post('/friends/requests/send', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as SendFriendRequestBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot send friend request to yourself.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }
  const actorControl = await getSocialModerationControl(accountId, targetAccountId);
  if (actorControl.blocked || actorControl.muted) {
    const reason = actorControl.blocked
      ? 'sender_blocked_target'
      : 'sender_muted_target';
    await logSocialModerationEvent({
      actorAccountId: accountId,
      targetAccountId,
      action: 'friend_request_blocked',
      reason,
      metadata: {
        source: 'sender_control',
      },
    });
    reply.code(409);
    return {
      error: actorControl.blocked
        ? 'You have blocked this account. Unblock before sending friend requests.'
        : 'You have muted this account. Unmute before sending friend requests.',
    };
  }
  const targetControl = await getSocialModerationControl(targetAccountId, accountId);
  if (targetControl.blocked || targetControl.muted) {
    const reason = targetControl.blocked
      ? 'target_blocked_sender'
      : 'target_muted_sender';
    await logSocialModerationEvent({
      actorAccountId: accountId,
      targetAccountId,
      action: 'friend_request_blocked',
      reason,
      metadata: {
        source: 'target_control',
      },
    });
    reply.code(403);
    return {
      error: targetControl.blocked
        ? 'This account has blocked you.'
        : 'This account has muted you and is not accepting friend requests.',
    };
  }

  const pair = orderAccountPair(accountId, targetAccountId);
  const existingFriendship = await db.query(
    `
      SELECT 1
      FROM friendships
      WHERE account_id_low = $1 AND account_id_high = $2
      LIMIT 1
    `,
    [pair.low, pair.high],
  );
  if (existingFriendship.rowCount) {
    reply.code(409);
    return { error: 'You are already friends with this account.' };
  }

  const existingOutgoing = await db.query(
    `
      SELECT request_id
      FROM friend_requests
      WHERE requester_account_id = $1 AND target_account_id = $2 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [accountId, targetAccountId],
  );
  if (existingOutgoing.rowCount) {
    reply.code(409);
    return { error: 'Friend request already pending.' };
  }

  const existingIncoming = await db.query(
    `
      SELECT request_id
      FROM friend_requests
      WHERE requester_account_id = $1 AND target_account_id = $2 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [targetAccountId, accountId],
  );
  if (existingIncoming.rowCount) {
    reply.code(409);
    return {
      error: 'Incoming friend request already exists from this account.',
      recovery: `Accept request ${String((existingIncoming.rows[0] as { request_id: number }).request_id)} instead.`,
    };
  }

  const created = await db.query(
    `
      INSERT INTO friend_requests(
        requester_account_id,
        target_account_id,
        status,
        actor_account_id,
        reason
      )
      VALUES ($1, $2, 'pending', $1, NULL)
      RETURNING request_id, requester_account_id, target_account_id, status, created_at, updated_at
    `,
    [accountId, targetAccountId],
  );
  reply.code(201);
  return created.rows[0];
});

app.post('/friends/requests/:requestId/accept', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { requestId?: string };
  const requestId = parsePositiveInteger(params.requestId);
  if (!requestId) {
    reply.code(400);
    return { error: 'requestId must be a positive integer.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const requestRowResult = await client.query(
      `
        SELECT request_id, requester_account_id, target_account_id, status
        FROM friend_requests
        WHERE request_id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [requestId],
    );
    if (!requestRowResult.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { error: 'Friend request not found.' };
    }
    const row = requestRowResult.rows[0] as {
      request_id: number;
      requester_account_id: string;
      target_account_id: string;
      status: string;
    };
    if (row.target_account_id !== accountId) {
      await client.query('ROLLBACK');
      reply.code(403);
      return { error: 'Only the request target can accept this request.' };
    }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      reply.code(409);
      return { error: `Cannot accept request in ${row.status} state.` };
    }

    await client.query(
      `
        UPDATE friend_requests
        SET
          status = 'accepted',
          actor_account_id = $2,
          updated_at = NOW(),
          responded_at = NOW()
        WHERE request_id = $1
      `,
      [requestId, accountId],
    );
    const pair = orderAccountPair(row.requester_account_id, row.target_account_id);
    await client.query(
      `
        INSERT INTO friendships(account_id_low, account_id_high, source_request_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (account_id_low, account_id_high) DO NOTHING
      `,
      [pair.low, pair.high, requestId],
    );
    await client.query('COMMIT');
    return {
      requestId,
      status: 'accepted',
      friendship: {
        accountIdLow: pair.low,
        accountIdHigh: pair.high,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/friends/requests/:requestId/decline', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { requestId?: string };
  const requestId = parsePositiveInteger(params.requestId);
  if (!requestId) {
    reply.code(400);
    return { error: 'requestId must be a positive integer.' };
  }

  const updated = await db.query(
    `
      UPDATE friend_requests
      SET
        status = 'declined',
        actor_account_id = $2,
        updated_at = NOW(),
        responded_at = NOW()
      WHERE request_id = $1
        AND target_account_id = $2
        AND status = 'pending'
      RETURNING request_id, status, updated_at
    `,
    [requestId, accountId],
  );
  if (!updated.rowCount) {
    reply.code(409);
    return { error: 'Request cannot be declined (missing, unauthorized, or not pending).' };
  }
  return updated.rows[0];
});

app.post('/friends/requests/:requestId/cancel', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { requestId?: string };
  const requestId = parsePositiveInteger(params.requestId);
  if (!requestId) {
    reply.code(400);
    return { error: 'requestId must be a positive integer.' };
  }

  const updated = await db.query(
    `
      UPDATE friend_requests
      SET
        status = 'cancelled',
        actor_account_id = $2,
        updated_at = NOW(),
        responded_at = NOW(),
        reason = 'requester_cancelled'
      WHERE request_id = $1
        AND requester_account_id = $2
        AND status = 'pending'
      RETURNING request_id, status, updated_at
    `,
    [requestId, accountId],
  );
  if (!updated.rowCount) {
    reply.code(409);
    return { error: 'Request cannot be cancelled (missing, unauthorized, or not pending).' };
  }
  return updated.rows[0];
});

app.post('/friends/remove', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const body = (request.body ?? {}) as FriendRemoveBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot remove yourself from friends.' };
  }

  const pair = orderAccountPair(accountId, targetAccountId);
  const removed = await db.query(
    `
      DELETE FROM friendships
      WHERE account_id_low = $1 AND account_id_high = $2
      RETURNING account_id_low, account_id_high
    `,
    [pair.low, pair.high],
  );
  if (!removed.rowCount) {
    return { removed: false };
  }

  await db.query(
    `
      INSERT INTO friend_requests(
        requester_account_id,
        target_account_id,
        status,
        actor_account_id,
        reason,
        responded_at
      )
      VALUES ($1, $2, 'cancelled', $1, 'friend_removed', NOW())
    `,
    [accountId, targetAccountId],
  );
  return {
    removed: true,
    friendship: {
      accountIdLow: pair.low,
      accountIdHigh: pair.high,
    },
  };
});

app.post('/friends/block', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const body = (request.body ?? {}) as FriendBlockBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (targetAccountId === accountId) {
    reply.code(400);
    return { error: 'Cannot block yourself.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }

  const pair = orderAccountPair(accountId, targetAccountId);
  const blockReason = String(body.reason ?? '').trim() || null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const removedFriendship = await client.query(
      `
        DELETE FROM friendships
        WHERE account_id_low = $1 AND account_id_high = $2
        RETURNING 1
      `,
      [pair.low, pair.high],
    );
    const cancelledPending = await client.query(
      `
        UPDATE friend_requests
        SET
          status = 'cancelled',
          actor_account_id = $1,
          updated_at = NOW(),
          responded_at = NOW(),
          reason = 'blocked_by_peer'
        WHERE (
          (requester_account_id = $1 AND target_account_id = $2)
          OR (requester_account_id = $2 AND target_account_id = $1)
        )
        AND status = 'pending'
        RETURNING request_id
      `,
      [accountId, targetAccountId],
    );
    const blockInsert = await client.query(
      `
        INSERT INTO friend_requests(
          requester_account_id,
          target_account_id,
          status,
          actor_account_id,
          reason,
          responded_at
        )
        VALUES ($1, $2, 'blocked', $1, $3, NOW())
        RETURNING request_id, status, updated_at
      `,
      [accountId, targetAccountId, blockReason],
    );
    await client.query(
      `
        INSERT INTO social_moderation_controls(owner_account_id, target_account_id, blocked, muted, reason, updated_at)
        VALUES ($1, $2, TRUE, COALESCE((
          SELECT muted
          FROM social_moderation_controls
          WHERE owner_account_id = $1 AND target_account_id = $2
          LIMIT 1
        ), FALSE), $3, NOW())
        ON CONFLICT (owner_account_id, target_account_id)
        DO UPDATE SET
          blocked = TRUE,
          reason = COALESCE($3, social_moderation_controls.reason),
          updated_at = NOW()
      `,
      [accountId, targetAccountId, blockReason],
    );

    await client.query('COMMIT');
    await logSocialModerationEvent({
      actorAccountId: accountId,
      targetAccountId,
      action: 'block',
      reason: blockReason,
    });
    return {
      blocked: true,
      request: blockInsert.rows[0],
      removedFriendship: Boolean(removedFriendship.rowCount),
      cancelledPendingRequests: cancelledPending.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/friends/list', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const rows = await db.query(
    `
      SELECT
        CASE
          WHEN f.account_id_low = $1 THEN f.account_id_high
          ELSE f.account_id_low
        END AS friend_account_id,
        p.display_name,
        f.created_at
      FROM friendships f
      LEFT JOIN profiles p ON p.account_id = (
        CASE
          WHEN f.account_id_low = $1 THEN f.account_id_high
          ELSE f.account_id_low
        END
      )
      WHERE f.account_id_low = $1 OR f.account_id_high = $1
      ORDER BY f.created_at DESC
    `,
    [accountId],
  );
  return {
    friends: rows.rows,
    count: rows.rowCount ?? 0,
  };
});

app.get('/friends/requests', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const query = (request.query ?? {}) as FriendRequestsQuery;
  const statusFilter = String(query.status ?? '').trim().toLowerCase();
  const validStatuses = new Set(['pending', 'accepted', 'declined', 'cancelled', 'blocked']);
  if (statusFilter && !validStatuses.has(statusFilter)) {
    reply.code(400);
    return { error: 'status must be one of pending, accepted, declined, cancelled, blocked.' };
  }

  const values: unknown[] = [accountId];
  let statusClause = '';
  if (statusFilter) {
    values.push(statusFilter);
    statusClause = `AND fr.status = $${values.length}`;
  }

  const rows = await db.query(
    `
      SELECT
        fr.request_id,
        fr.requester_account_id,
        fr.target_account_id,
        fr.status,
        fr.reason,
        fr.created_at,
        fr.updated_at,
        fr.responded_at,
        CASE
          WHEN fr.requester_account_id = $1 THEN 'outgoing'
          ELSE 'incoming'
        END AS direction
      FROM friend_requests fr
      WHERE (fr.requester_account_id = $1 OR fr.target_account_id = $1)
      ${statusClause}
      ORDER BY fr.updated_at DESC
      LIMIT 200
    `,
    values,
  );
  return {
    requests: rows.rows,
    count: rows.rowCount ?? 0,
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
  const blockingAction = await getBlockingEnforcementAction(accountId);
  if (blockingAction) {
    reply.code(403);
    return {
      error: 'Account is currently restricted from online queue access.',
      enforcement: {
        actionId: blockingAction.actionId,
        actionType: blockingAction.actionType,
        reason: blockingAction.reason,
        startsAt: blockingAction.startsAt,
        endsAt: blockingAction.endsAt,
      },
    };
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
  let rankedSnapshot: { rating: number | null; leagueTier: string | null; mrPoints: number | null } | undefined;
  if (queueType === 'ranked') {
    const activeSeason = await ensureActiveSeason(db, new Date(), rankedSeasonDurationDays);
    const rankedResult = await db.query(
      `
        SELECT
          r.rating,
          l.league_tier,
          m.mr_points
        FROM ranked_player_ratings r
        LEFT JOIN ranked_league_progression l ON l.account_id = r.account_id
        LEFT JOIN ranked_master_ratings m ON m.account_id = r.account_id AND m.season_id = $2
        WHERE r.account_id = $1
        LIMIT 1
      `,
      [accountId, activeSeason.seasonId],
    );
    if (rankedResult.rowCount) {
      const row = rankedResult.rows[0] as {
        rating: number | null;
        league_tier: string | null;
        mr_points: number | null;
      };
      rankedSnapshot = {
        rating: row.rating ?? 1200,
        leagueTier: row.league_tier ?? null,
        mrPoints: row.mr_points ?? null,
      };
    } else {
      rankedSnapshot = {
        rating: 1200,
        leagueTier: null,
        mrPoints: null,
      };
    }
  }
  const ticket = matchmakingQueueService.join({
    accountId,
    queueType,
    regionPreferences,
    playerMetadata: {
      displayName,
      buildVersion: typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null,
      platform: body.platform === 'steam' || body.platform === 'web' ? body.platform : null,
      rankedSnapshot,
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

app.post('/ranked/results', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }
  const blockingAction = await getBlockingEnforcementAction(accountId);
  if (blockingAction) {
    reply.code(403);
    return {
      error: 'Account is currently restricted from ranked submission.',
      enforcement: {
        actionId: blockingAction.actionId,
        actionType: blockingAction.actionType,
        reason: blockingAction.reason,
        startsAt: blockingAction.startsAt,
        endsAt: blockingAction.endsAt,
      },
    };
  }

  const body = (request.body ?? {}) as RankedResultSubmitBody;
  if (!isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  if (!isUuid(body.matchId)) {
    reply.code(400);
    return { error: 'matchId is required and must be a UUID.' };
  }
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }
  const outcome = parseRankedOutcome(body.outcome);
  if (!outcome) {
    reply.code(400);
    return { error: 'outcome must be one of: p1_win, p2_win, draw, forfeit.' };
  }
  const submittedParticipantsRaw = Array.isArray(body.participantAccountIds) ? body.participantAccountIds : [];
  const submittedParticipants = [...new Set(submittedParticipantsRaw.map((value) => String(value).trim()))].sort();
  if (submittedParticipants.length !== 2 || !submittedParticipants.every((participantAccountId) => isUuid(participantAccountId))) {
    reply.code(400);
    return { error: 'participantAccountIds must contain exactly two distinct UUID values.' };
  }
  const winnerAccountIdRaw = body.winnerAccountId === undefined || body.winnerAccountId === null
    ? null
    : String(body.winnerAccountId).trim();
  if (winnerAccountIdRaw !== null && !isUuid(winnerAccountIdRaw)) {
    reply.code(400);
    return { error: 'winnerAccountId must be a UUID when provided.' };
  }
  if (outcome === 'forfeit' && !winnerAccountIdRaw) {
    reply.code(400);
    return { error: 'winnerAccountId is required for forfeit outcomes.' };
  }

  const sessionValidation = matchmakingQueueService.validateSessionToken(body.sessionId, accountId, sessionToken);
  if (!sessionValidation.ok) {
    reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
    return { error: sessionValidation.error.message, code: sessionValidation.error.code };
  }
  if (sessionValidation.value.queueType !== 'ranked') {
    reply.code(409);
    return { error: 'Session is not a ranked queue session.' };
  }

  const p1Participant = sessionValidation.value.participants.find((participant) => participant.side === 'P1');
  const p2Participant = sessionValidation.value.participants.find((participant) => participant.side === 'P2');
  if (!p1Participant || !p2Participant) {
    reply.code(409);
    return { error: 'Session participants are invalid for ranked processing.' };
  }

  const expectedParticipants = [...new Set(sessionValidation.value.participants.map((participant) => participant.accountId))].sort();
  const evaluation = evaluateRankedResultSubmission(
    {
      sessionId: body.sessionId,
      participantAccountIds: expectedParticipants,
    },
    {
      submittedByAccountId: accountId,
      matchId: body.matchId,
      participantAccountIds: submittedParticipants,
      winnerAccountId: winnerAccountIdRaw,
    },
  );
  const suspiciousReasons: RankedResultSuspiciousReason[] = [...evaluation.reasons];
  let winnerAccountId: string | null = null;
  if (outcome === 'p1_win') {
    winnerAccountId = p1Participant.accountId;
  } else if (outcome === 'p2_win') {
    winnerAccountId = p2Participant.accountId;
  } else if (outcome === 'forfeit') {
    winnerAccountId = winnerAccountIdRaw && expectedParticipants.includes(winnerAccountIdRaw) ? winnerAccountIdRaw : null;
  }
  const reviewStatus = evaluation.suspicious ? 'pending' : 'none';
  const participantByAccountId = new Map(sessionValidation.value.participants.map((participant) => [participant.accountId, participant]));

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const submission = await client.query(
      `
      INSERT INTO ranked_result_submissions(
        session_id, match_id, queue_type, submitted_by_account_id,
        session_participants, submitted_participants, winner_account_id,
        outcome, valid_session_token, suspicious, suspicious_reasons,
        review_status, payload_json
      )
      VALUES (
        $1, $2, 'ranked', $3,
        $4::uuid[], $5::uuid[], $6,
        $7, TRUE, $8, $9::text[],
        $10, $11::jsonb
      )
      RETURNING submission_id, created_at
      `,
      [
        body.sessionId,
        body.matchId,
        accountId,
        expectedParticipants,
        submittedParticipants,
        winnerAccountId,
        outcome,
        evaluation.suspicious,
        suspiciousReasons,
        reviewStatus,
        JSON.stringify({
          outcome,
          winnerAccountIdSubmitted: winnerAccountIdRaw,
        }),
      ],
    );

    const row = submission.rows[0] as { submission_id: string; created_at: string };
    if (evaluation.suspicious) {
      await client.query('COMMIT');
      reply.code(202);
      return {
        submissionId: row.submission_id,
        createdAt: row.created_at,
        status: 'flagged_for_review',
        suspicious: true,
        suspiciousReasons,
        reviewStatus,
      };
    }

    const existingMatch = await client.query(
      'SELECT 1 FROM ranked_matches WHERE match_id = $1 LIMIT 1',
      [body.matchId],
    );
    if (existingMatch.rowCount) {
      await client.query('ROLLBACK');
      reply.code(409);
      return { error: 'Ranked match has already been processed.' };
    }

    await client.query(
      `
      INSERT INTO ranked_player_ratings(account_id)
      VALUES ($1), ($2)
      ON CONFLICT (account_id) DO NOTHING
      `,
      [p1Participant.accountId, p2Participant.accountId],
    );
    const ratingRows = await client.query(
      `
      SELECT account_id, rating
      FROM ranked_player_ratings
      WHERE account_id = ANY($1::uuid[])
      FOR UPDATE
      `,
      [[p1Participant.accountId, p2Participant.accountId]],
    );
    const ratingMap = new Map<string, number>();
    for (const rawRow of ratingRows.rows as Array<{ account_id: string; rating: number }>) {
      ratingMap.set(rawRow.account_id, Number(rawRow.rating));
    }
    const p1Rating = ratingMap.get(p1Participant.accountId);
    const p2Rating = ratingMap.get(p2Participant.accountId);
    if (!Number.isFinite(p1Rating) || !Number.isFinite(p2Rating)) {
      await client.query('ROLLBACK');
      reply.code(500);
      return { error: 'Failed to resolve ranked ratings for session participants.' };
    }
    await client.query(
      `
      INSERT INTO ranked_league_progression(account_id, calibration_matches_required)
      VALUES ($1, $3), ($2, $3)
      ON CONFLICT (account_id) DO NOTHING
      `,
      [p1Participant.accountId, p2Participant.accountId, rankedCalibrationMatchesRequired],
    );
    const leagueRows = await client.query(
      `
      SELECT
        account_id,
        league_tier,
        league_points,
        calibration_matches_required,
        calibration_matches_played,
        placed_at
      FROM ranked_league_progression
      WHERE account_id = ANY($1::uuid[])
      FOR UPDATE
      `,
      [[p1Participant.accountId, p2Participant.accountId]],
    );
    const leagueStateByAccount = new Map<string, {
      leagueTier: LeagueTier | null;
      leaguePoints: number | null;
      calibrationMatchesRequired: number;
      calibrationMatchesPlayed: number;
      placedAt: string | null;
    }>();
    for (const rawRow of leagueRows.rows as Array<{
      account_id: string;
      league_tier: LeagueTier | null;
      league_points: number | null;
      calibration_matches_required: number;
      calibration_matches_played: number;
      placed_at: string | null;
    }>) {
      leagueStateByAccount.set(rawRow.account_id, {
        leagueTier: rawRow.league_tier,
        leaguePoints: rawRow.league_points,
        calibrationMatchesRequired: Number(rawRow.calibration_matches_required),
        calibrationMatchesPlayed: Number(rawRow.calibration_matches_played),
        placedAt: rawRow.placed_at,
      });
    }
    const activeSeason = await ensureActiveSeason(client, new Date(), rankedSeasonDurationDays);
    const masterRows = await client.query(
      `
      SELECT
        account_id,
        mr_points,
        matches_played,
        wins,
        losses,
        draws,
        forfeits,
        entered_at
      FROM ranked_master_ratings
      WHERE season_id = $1
        AND account_id = ANY($2::uuid[])
      FOR UPDATE
      `,
      [
        activeSeason.seasonId,
        [p1Participant.accountId, p2Participant.accountId],
      ],
    );
    const masterStateByAccount = new Map<string, {
      mrPoints: number | null;
      matchesPlayed: number;
      wins: number;
      losses: number;
      draws: number;
      forfeits: number;
      enteredAt: string | null;
    }>();
    for (const rawRow of masterRows.rows as Array<{
      account_id: string;
      mr_points: number;
      matches_played: number;
      wins: number;
      losses: number;
      draws: number;
      forfeits: number;
      entered_at: string;
    }>) {
      masterStateByAccount.set(rawRow.account_id, {
        mrPoints: Number(rawRow.mr_points),
        matchesPlayed: Number(rawRow.matches_played),
        wins: Number(rawRow.wins),
        losses: Number(rawRow.losses),
        draws: Number(rawRow.draws),
        forfeits: Number(rawRow.forfeits),
        enteredAt: rawRow.entered_at,
      });
    }
    const previousMatchRows = await client.query(
      `
      SELECT account_id, MAX(created_at) AS previous_match_at
      FROM ranked_match_rating_deltas
      WHERE account_id = ANY($1::uuid[])
      GROUP BY account_id
      `,
      [[p1Participant.accountId, p2Participant.accountId]],
    );
    const previousMatchAtByAccount = new Map<string, string | null>();
    for (const rawRow of previousMatchRows.rows as Array<{ account_id: string; previous_match_at: string | null }>) {
      previousMatchAtByAccount.set(rawRow.account_id, rawRow.previous_match_at);
    }

    const ratingResult = applyRankedRatingUpdate({
      participants: [
        { accountId: p1Participant.accountId, side: 'P1', rating: p1Rating as number },
        { accountId: p2Participant.accountId, side: 'P2', rating: p2Rating as number },
      ],
      outcome,
      winnerAccountId,
    });

    await client.query(
      `
      INSERT INTO ranked_matches(
        match_id, session_id, season_id, queue_type, outcome, winner_account_id,
        processed_submission_id, participant_p1_account_id, participant_p2_account_id
      )
      VALUES ($1, $2, $3, 'ranked', $4, $5, $6, $7, $8)
      `,
      [
        body.matchId,
        body.sessionId,
        activeSeason.seasonId,
        outcome,
        winnerAccountId,
        row.submission_id,
        p1Participant.accountId,
        p2Participant.accountId,
      ],
    );

    const leagueDeltaViews: Array<{
      accountId: string;
      preLeagueTier: LeagueTier | null;
      postLeagueTier: LeagueTier | null;
      preLeaguePoints: number | null;
      postLeaguePoints: number | null;
      provisional: boolean;
    }> = [];
    const masterDeltaViews: Array<{
      accountId: string;
      preMrPoints: number | null;
      postMrPoints: number | null;
      enteredMasterTrack: boolean;
    }> = [];
    for (const update of ratingResult.updates) {
      const currentLeagueState = leagueStateByAccount.get(update.accountId) ?? {
        leagueTier: null,
        leaguePoints: null,
        calibrationMatchesRequired: 5,
        calibrationMatchesPlayed: 0,
        placedAt: null,
      };
      const leagueProgress = applyLeagueProgression({
        state: currentLeagueState,
        postRating: update.postRating,
        ratingDelta: update.delta,
        occurredAtIso: row.created_at,
      });
      leagueDeltaViews.push({
        accountId: update.accountId,
        preLeagueTier: leagueProgress.pre.leagueTier,
        postLeagueTier: leagueProgress.post.leagueTier,
        preLeaguePoints: leagueProgress.pre.leaguePoints,
        postLeaguePoints: leagueProgress.post.leaguePoints,
        provisional: leagueProgress.provisional,
      });
      leagueStateByAccount.set(update.accountId, leagueProgress.post);
      const currentMasterState = masterStateByAccount.get(update.accountId) ?? {
        mrPoints: null,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        forfeits: 0,
        enteredAt: null,
      };
      const masterProgress = applyMasterRatingProgression({
        state: currentMasterState,
        postRating: update.postRating,
        ratingDelta: update.delta,
        result: update.result,
        occurredAtIso: row.created_at,
        entryRatingThreshold: rankedMasterEntryRating,
        basePoints: rankedMasterBasePoints,
        queueWeight: rankedMasterQueueWeight,
      });
      masterDeltaViews.push({
        accountId: update.accountId,
        preMrPoints: masterProgress.pre.mrPoints,
        postMrPoints: masterProgress.post.mrPoints,
        enteredMasterTrack: masterProgress.enteredMasterTrack,
      });
      masterStateByAccount.set(update.accountId, masterProgress.post);
      const mrDelta = masterProgress.pre.mrPoints !== null && masterProgress.post.mrPoints !== null
        ? masterProgress.post.mrPoints - masterProgress.pre.mrPoints
        : null;
      const anomalyAlerts = detectRankedAnomalies({
        occurredAtIso: row.created_at,
        previousMatchAtIso: previousMatchAtByAccount.get(update.accountId) ?? null,
        ratingDelta: update.delta,
        mrDelta,
        minMatchIntervalSeconds: rankedAnomalyMinMatchIntervalSeconds,
        ratingJumpThreshold: rankedAnomalyRatingJumpThreshold,
        mrJumpThreshold: rankedAnomalyMrJumpThreshold,
      });

      await client.query(
        `
        INSERT INTO ranked_match_rating_deltas(
          match_id, account_id, side, pre_rating, post_rating, rating_delta, result,
          pre_league_tier, post_league_tier, pre_league_points, post_league_points,
          pre_mr_points, post_mr_points
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          body.matchId,
          update.accountId,
          update.side,
          update.preRating,
          update.postRating,
          update.delta,
          update.result,
          leagueProgress.pre.leagueTier,
          leagueProgress.post.leagueTier,
          leagueProgress.pre.leaguePoints,
          leagueProgress.post.leaguePoints,
          masterProgress.pre.mrPoints,
          masterProgress.post.mrPoints,
        ],
      );
      for (const alert of anomalyAlerts) {
        await client.query(
          `
          INSERT INTO ranked_anomaly_alerts(
            alert_type, severity, status, account_id, match_id, message, metadata, detected_at
          )
          VALUES ($1, $2, 'open', $3, $4, $5, $6::jsonb, $7)
          `,
          [
            alert.type,
            alert.severity,
            update.accountId,
            body.matchId,
            alert.message,
            JSON.stringify({
              ...alert.metadata,
              outcome,
              side: update.side,
              result: update.result,
              preRating: update.preRating,
              postRating: update.postRating,
              ratingDelta: update.delta,
              preMrPoints: masterProgress.pre.mrPoints,
              postMrPoints: masterProgress.post.mrPoints,
            }),
            row.created_at,
          ],
        );
      }
      previousMatchAtByAccount.set(update.accountId, row.created_at);

      const isForfeitLoss = outcome === 'forfeit' && update.result === 'forfeit';
      await client.query(
        `
        UPDATE ranked_player_ratings
        SET
          rating = $2,
          matches_played = matches_played + 1,
          wins = wins + $3,
          losses = losses + $4,
          draws = draws + $5,
          forfeits = forfeits + $6,
          updated_at = NOW()
        WHERE account_id = $1
        `,
        [
          update.accountId,
          update.postRating,
          update.result === 'win' ? 1 : 0,
          update.result === 'loss' ? 1 : 0,
          update.result === 'draw' ? 1 : 0,
          isForfeitLoss ? 1 : 0,
        ],
      );
      await client.query(
        `
        UPDATE ranked_league_progression
        SET
          league_tier = $2,
          league_points = $3,
          calibration_matches_required = $4,
          calibration_matches_played = $5,
          placed_at = $6,
          updated_at = NOW()
        WHERE account_id = $1
        `,
        [
          update.accountId,
          leagueProgress.post.leagueTier,
          leagueProgress.post.leaguePoints,
          leagueProgress.post.calibrationMatchesRequired,
          leagueProgress.post.calibrationMatchesPlayed,
          leagueProgress.post.placedAt,
        ],
      );
      if (masterProgress.post.enteredAt) {
        await client.query(
          `
          INSERT INTO ranked_master_ratings(
            season_id, account_id, mr_points, matches_played,
            wins, losses, draws, forfeits, entered_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (season_id, account_id)
          DO UPDATE SET
            mr_points = EXCLUDED.mr_points,
            matches_played = EXCLUDED.matches_played,
            wins = EXCLUDED.wins,
            losses = EXCLUDED.losses,
            draws = EXCLUDED.draws,
            forfeits = EXCLUDED.forfeits,
            entered_at = LEAST(ranked_master_ratings.entered_at, EXCLUDED.entered_at),
            updated_at = NOW()
          `,
          [
            activeSeason.seasonId,
            update.accountId,
            masterProgress.post.mrPoints,
            masterProgress.post.matchesPlayed,
            masterProgress.post.wins,
            masterProgress.post.losses,
            masterProgress.post.draws,
            masterProgress.post.forfeits,
            masterProgress.post.enteredAt,
          ],
        );
      }
    }

    await client.query('COMMIT');
    const leagueDeltaByAccount = new Map(leagueDeltaViews.map((entry) => [entry.accountId, entry]));
    const masterDeltaByAccount = new Map(masterDeltaViews.map((entry) => [entry.accountId, entry]));
    reply.code(201);
    return {
      submissionId: row.submission_id,
      createdAt: row.created_at,
      status: 'accepted',
      suspicious: false,
      suspiciousReasons: [],
      reviewStatus,
      ratingDeltas: ratingResult.updates.map((update) => ({
        ...leagueDeltaByAccount.get(update.accountId),
        ...masterDeltaByAccount.get(update.accountId),
        accountId: update.accountId,
        side: participantByAccountId.get(update.accountId)?.side ?? update.side,
        preRating: update.preRating,
        postRating: update.postRating,
        ratingDelta: update.delta,
        result: update.result,
      })),
    };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const code = (error as { code?: string } | undefined)?.code;
    const message = error instanceof Error ? error.message : '';
    if (code === '23505' && message.includes('ranked_result_submissions_session_id_submitted_by_account_id_key')) {
      reply.code(409);
      return { error: 'Ranked result was already submitted for this session by this account.' };
    }
    if (code === '23505' && message.includes('ranked_matches_pkey')) {
      reply.code(409);
      return { error: 'Ranked match has already been processed.' };
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/ranked/progression', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const query = (request.query ?? {}) as RankedProgressionQuery;
  const requestedSeasonId = typeof query.seasonId === 'string' ? query.seasonId.trim() : '';
  const season = requestedSeasonId
    ? await getSeasonById(db, requestedSeasonId)
    : await ensureActiveSeason(db, new Date(), rankedSeasonDurationDays);
  if (!season) {
    reply.code(404);
    return { error: 'Ranked season not found.' };
  }

  let ratingRow: {
    rating: number | null;
    matches_played: number | null;
    league_tier: LeagueTier | null;
    league_points: number | null;
    mr_points: number | null;
    provisional: boolean;
    calibration_matches_played: number;
    calibration_matches_required: number;
    updated_at: string | null;
  } | null = null;
  if (season.state === 'archived') {
    const archived = await db.query(
      `
        SELECT
          rating,
          matches_played,
          league_tier,
          league_points,
          mr_points,
          provisional,
          NULL::integer AS calibration_matches_played,
          NULL::integer AS calibration_matches_required,
          captured_at AS updated_at
        FROM ranked_season_standings
        WHERE season_id = $1 AND account_id = $2
        LIMIT 1
      `,
      [season.seasonId, accountId],
    );
    ratingRow = archived.rowCount
      ? archived.rows[0] as {
        rating: number;
        matches_played: number;
        league_tier: LeagueTier | null;
        league_points: number | null;
        mr_points: number | null;
        provisional: boolean;
        calibration_matches_played: number;
        calibration_matches_required: number;
        updated_at: string;
      }
      : null;
  } else {
    const live = await db.query(
      `
        SELECT
          r.rating,
          r.matches_played,
          l.league_tier,
          l.league_points,
          m.mr_points,
          CASE WHEN l.placed_at IS NULL THEN TRUE ELSE FALSE END AS provisional,
          COALESCE(l.calibration_matches_played, 0) AS calibration_matches_played,
          COALESCE(l.calibration_matches_required, 5) AS calibration_matches_required,
          GREATEST(r.updated_at, COALESCE(l.updated_at, r.updated_at), COALESCE(m.updated_at, r.updated_at)) AS updated_at
        FROM ranked_player_ratings r
        LEFT JOIN ranked_league_progression l ON l.account_id = r.account_id
        LEFT JOIN ranked_master_ratings m ON m.season_id = $2 AND m.account_id = r.account_id
        WHERE r.account_id = $1
        LIMIT 1
      `,
      [accountId, season.seasonId],
    );
    ratingRow = live.rowCount
      ? live.rows[0] as {
        rating: number;
        matches_played: number;
        league_tier: LeagueTier | null;
        league_points: number | null;
        mr_points: number | null;
        provisional: boolean;
        calibration_matches_played: number;
        calibration_matches_required: number;
        updated_at: string;
      }
      : null;
  }

  const deltas = await db.query(
    `
      SELECT
        d.match_id,
        d.result,
        d.pre_rating,
        d.post_rating,
        d.pre_league_tier,
        d.post_league_tier,
        d.pre_league_points,
        d.post_league_points,
        d.pre_mr_points,
        d.post_mr_points,
        d.created_at
      FROM ranked_match_rating_deltas d
      INNER JOIN ranked_matches m ON m.match_id = d.match_id
      WHERE d.account_id = $1
        AND ($2::text IS NULL OR m.season_id = $2)
      ORDER BY d.created_at DESC
      LIMIT 10
    `,
    [accountId, season.seasonId],
  );

  const rating = ratingRow?.rating ?? null;
  const leagueTier = ratingRow?.league_tier ?? null;
  const leaguePoints = ratingRow?.league_points ?? null;
  const mrPoints = ratingRow?.mr_points ?? null;
  const calibrationMatchesPlayed = ratingRow?.calibration_matches_played ?? 0;
  const calibrationMatchesRequired = ratingRow?.calibration_matches_required ?? 5;
  const provisional = ratingRow ? Boolean(ratingRow.provisional) : true;

  return {
    seasonId: season.seasonId,
    season: {
      seasonId: season.seasonId,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      state: season.state,
    },
    current: {
      seasonId: season.seasonId,
      rating,
      leagueTier,
      leaguePoints,
      mrPoints,
      provisional,
      placement: {
        calibrationMatchesPlayed,
        calibrationMatchesRequired,
        calibrationMatchesRemaining: Math.max(0, calibrationMatchesRequired - calibrationMatchesPlayed),
      },
      updatedAt: ratingRow?.updated_at ?? season.activatedAt ?? season.startsAt,
    },
    recentDeltas: deltas.rows.map((row) => {
      const entry = row as {
        match_id: string;
        result: string;
        pre_rating: number;
        post_rating: number;
        pre_league_tier: LeagueTier | null;
        post_league_tier: LeagueTier | null;
        pre_league_points: number | null;
        post_league_points: number | null;
        pre_mr_points: number | null;
        post_mr_points: number | null;
        created_at: string;
      };
      return {
        matchId: entry.match_id,
        queueType: 'ranked',
        result: entry.result,
        preRating: entry.pre_rating,
        postRating: entry.post_rating,
        preLeagueTier: entry.pre_league_tier,
        postLeagueTier: entry.post_league_tier,
        preLeaguePoints: entry.pre_league_points,
        postLeaguePoints: entry.post_league_points,
        preMrPoints: entry.pre_mr_points,
        postMrPoints: entry.post_mr_points,
        occurredAt: entry.created_at,
      };
    }),
  };
});

app.get('/ranked/leaderboard', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const query = (request.query ?? {}) as RankedLeaderboardQuery;
  const requestedSeasonId = typeof query.seasonId === 'string' ? query.seasonId.trim() : '';
  const season = requestedSeasonId
    ? await getSeasonById(db, requestedSeasonId)
    : await ensureActiveSeason(db, new Date(), rankedSeasonDurationDays);
  if (!season) {
    reply.code(404);
    return { error: 'Ranked season not found.' };
  }

  const parsedLimit = parsePositiveInteger(query.limit);
  const limit = parsedLimit ? Math.min(parsedLimit, 100) : 25;
  const parsedOffset = parseNonNegativeInteger(query.offset);
  const offset = parsedOffset ?? 0;
  const region = parseLeaderboardRegion(query.region);
  const track = parseLeaderboardTrack(query.track);

  if (track === 'master') {
    if (season.state === 'archived') {
      const totalResult = await db.query(
        `
          SELECT COUNT(*) AS count
          FROM ranked_master_season_standings s
          LEFT JOIN profiles p ON p.account_id = s.account_id
          WHERE s.season_id = $1
            AND (
              $2::text IS NULL
              OR COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') = $2
            )
        `,
        [season.seasonId, region],
      );
      const total = Number((totalResult.rows[0] as { count: string }).count);
      const rows = await db.query(
        `
          SELECT
            s.rank_position,
            s.account_id,
            COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') AS region,
            s.mr_points,
            s.matches_played,
            s.wins,
            s.losses,
            s.draws,
            s.forfeits,
            s.entered_at,
            s.captured_at
          FROM ranked_master_season_standings s
          LEFT JOIN profiles p ON p.account_id = s.account_id
          WHERE s.season_id = $1
            AND (
              $2::text IS NULL
              OR COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') = $2
            )
          ORDER BY s.rank_position ASC, s.account_id ASC
          LIMIT $3 OFFSET $4
        `,
        [season.seasonId, region, limit, offset],
      );
      return {
        season: {
          seasonId: season.seasonId,
          startsAt: season.startsAt,
          endsAt: season.endsAt,
          state: season.state,
        },
        filter: {
          region,
          track,
        },
        page: {
          limit,
          offset,
          total,
        },
        items: rows.rows.map((row) => {
          const entry = row as {
            rank_position: number;
            account_id: string;
            region: string;
            mr_points: number;
            matches_played: number;
            wins: number;
            losses: number;
            draws: number;
            forfeits: number;
            entered_at: string;
            captured_at: string;
          };
          return {
            rank: entry.rank_position,
            accountId: entry.account_id,
            region: entry.region,
            mrPoints: entry.mr_points,
            matchesPlayed: entry.matches_played,
            wins: entry.wins,
            losses: entry.losses,
            draws: entry.draws,
            forfeits: entry.forfeits,
            enteredAt: entry.entered_at,
            updatedAt: entry.captured_at,
          };
        }),
      };
    }

    const totalResult = await db.query(
      `
        SELECT COUNT(*) AS count
        FROM ranked_master_ratings m
        LEFT JOIN profiles p ON p.account_id = m.account_id
        WHERE m.season_id = $1
          AND (
            $2::text IS NULL
            OR COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') = $2
          )
      `,
      [season.seasonId, region],
    );
    const total = Number((totalResult.rows[0] as { count: string }).count);
    const rows = await db.query(
      `
        WITH ranked_rows AS (
          SELECT
            ROW_NUMBER() OVER (
              ORDER BY m.mr_points DESC, m.wins DESC, m.matches_played DESC, m.account_id ASC
            ) AS rank_position,
            m.account_id,
            COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') AS region,
            m.mr_points,
            m.matches_played,
            m.wins,
            m.losses,
            m.draws,
            m.forfeits,
            m.entered_at,
            m.updated_at
          FROM ranked_master_ratings m
          LEFT JOIN profiles p ON p.account_id = m.account_id
          WHERE m.season_id = $1
        )
        SELECT *
        FROM ranked_rows
        WHERE ($2::text IS NULL OR region = $2)
        ORDER BY rank_position ASC, account_id ASC
        LIMIT $3 OFFSET $4
      `,
      [season.seasonId, region, limit, offset],
    );
    return {
      season: {
        seasonId: season.seasonId,
        startsAt: season.startsAt,
        endsAt: season.endsAt,
        state: season.state,
      },
      filter: {
        region,
        track,
      },
      page: {
        limit,
        offset,
        total,
      },
      items: rows.rows.map((row) => {
        const entry = row as {
          rank_position: number;
          account_id: string;
          region: string;
          mr_points: number;
          matches_played: number;
          wins: number;
          losses: number;
          draws: number;
          forfeits: number;
          entered_at: string;
          updated_at: string;
        };
        return {
          rank: entry.rank_position,
          accountId: entry.account_id,
          region: entry.region,
          mrPoints: entry.mr_points,
          matchesPlayed: entry.matches_played,
          wins: entry.wins,
          losses: entry.losses,
          draws: entry.draws,
          forfeits: entry.forfeits,
          enteredAt: entry.entered_at,
          updatedAt: entry.updated_at,
        };
      }),
    };
  }

  if (season.state === 'archived') {
    const totalResult = await db.query(
      `
        SELECT COUNT(*) AS count
        FROM ranked_season_standings
        WHERE season_id = $1
          AND ($2::text IS NULL OR region = $2)
      `,
      [season.seasonId, region],
    );
    const total = Number((totalResult.rows[0] as { count: string }).count);
    const rows = await db.query(
      `
        SELECT
          rank_position,
          account_id,
          region,
          rating,
          matches_played,
          wins,
          losses,
          draws,
          forfeits,
          league_tier,
          league_points,
          mr_points,
          provisional,
          captured_at
        FROM ranked_season_standings
        WHERE season_id = $1
          AND ($2::text IS NULL OR region = $2)
        ORDER BY rank_position ASC, account_id ASC
        LIMIT $3 OFFSET $4
      `,
      [season.seasonId, region, limit, offset],
    );
    return {
      season: {
        seasonId: season.seasonId,
        startsAt: season.startsAt,
        endsAt: season.endsAt,
        state: season.state,
      },
      filter: {
        region,
        track,
      },
      page: {
        limit,
        offset,
        total,
      },
      items: rows.rows.map((row) => {
        const entry = row as {
          rank_position: number;
          account_id: string;
          region: string;
          rating: number;
          matches_played: number;
          wins: number;
          losses: number;
          draws: number;
          forfeits: number;
          league_tier: LeagueTier | null;
          league_points: number | null;
          mr_points: number | null;
          provisional: boolean;
          captured_at: string;
        };
        return {
          rank: entry.rank_position,
          accountId: entry.account_id,
          region: entry.region,
          rating: entry.rating,
          matchesPlayed: entry.matches_played,
          wins: entry.wins,
          losses: entry.losses,
          draws: entry.draws,
          forfeits: entry.forfeits,
          leagueTier: entry.league_tier,
          leaguePoints: entry.league_points,
          mrPoints: entry.mr_points,
          provisional: entry.provisional,
          updatedAt: entry.captured_at,
        };
      }),
    };
  }

  const totalResult = await db.query(
    `
      SELECT COUNT(*) AS count
      FROM ranked_player_ratings r
      LEFT JOIN profiles p ON p.account_id = r.account_id
      WHERE (
        $1::text IS NULL
        OR COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') = $1
      )
    `,
    [region],
  );
  const total = Number((totalResult.rows[0] as { count: string }).count);
  const rows = await db.query(
    `
      WITH ranked_rows AS (
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY r.rating DESC, r.wins DESC, r.matches_played DESC, r.account_id ASC
          ) AS rank_position,
          r.account_id,
          COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') AS region,
          r.rating,
          r.matches_played,
          r.wins,
          r.losses,
          r.draws,
          r.forfeits,
          l.league_tier,
          l.league_points,
          m.mr_points,
          CASE WHEN l.placed_at IS NULL THEN TRUE ELSE FALSE END AS provisional,
          r.updated_at
        FROM ranked_player_ratings r
        LEFT JOIN profiles p ON p.account_id = r.account_id
        LEFT JOIN ranked_league_progression l ON l.account_id = r.account_id
        LEFT JOIN ranked_master_ratings m ON m.season_id = $2 AND m.account_id = r.account_id
      )
      SELECT *
      FROM ranked_rows
      WHERE ($1::text IS NULL OR region = $1)
      ORDER BY rank_position ASC, account_id ASC
      LIMIT $2 OFFSET $3
    `,
    [region, season.seasonId, limit, offset],
  );

  return {
    season: {
      seasonId: season.seasonId,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      state: season.state,
    },
    filter: {
      region,
      track,
    },
    page: {
      limit,
      offset,
      total,
    },
    items: rows.rows.map((row) => {
      const entry = row as {
        rank_position: number;
        account_id: string;
        region: string;
        rating: number;
        matches_played: number;
        wins: number;
        losses: number;
        draws: number;
        forfeits: number;
        league_tier: LeagueTier | null;
        league_points: number | null;
        mr_points: number | null;
        provisional: boolean;
        updated_at: string;
      };
      return {
        rank: entry.rank_position,
        accountId: entry.account_id,
        region: entry.region,
        rating: entry.rating,
        matchesPlayed: entry.matches_played,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        forfeits: entry.forfeits,
        leagueTier: entry.league_tier,
        leaguePoints: entry.league_points,
        mrPoints: entry.mr_points,
        provisional: entry.provisional,
        updatedAt: entry.updated_at,
      };
    }),
  };
});

app.get('/ops/slo/summary', async (request, reply) => {
  if (!sloAdminKey) {
    reply.code(501);
    return { error: 'SLO summary is not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== sloAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const query = (request.query ?? {}) as SloSummaryQuery;
  const windowHours = parsePositiveInteger(query.windowHours) ?? (24 * 7);
  if (windowHours > 24 * 30) {
    reply.code(400);
    return { error: 'windowHours must be 720 or less.' };
  }
  const summaryResult = await db.query(
    `
    SELECT
      COUNT(*)::bigint AS total_requests,
      COUNT(*) FILTER (WHERE status_code < 500)::bigint AS success_requests,
      COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS error_requests,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS latency_p95_ms
    FROM service_slo_request_samples
    WHERE sampled_at >= NOW() - make_interval(hours => $1::int)
    `,
    [windowHours],
  );
  const summaryRow = summaryResult.rows[0] as {
    total_requests: string;
    success_requests: string;
    error_requests: string;
    latency_p95_ms: number | string | null;
  };
  const summary = deriveSloSummary(
    Number(summaryRow.total_requests ?? '0'),
    Number(summaryRow.success_requests ?? '0'),
    Number(summaryRow.error_requests ?? '0'),
    summaryRow.latency_p95_ms === null ? null : Number(summaryRow.latency_p95_ms),
  );
  const targets = {
    availabilityPercent: sloAvailabilityTargetPercent,
    errorRatePercent: sloErrorRateTargetPercent,
    latencyP95Ms: sloLatencyP95TargetMs,
  };
  const alerts = evaluateSloAlerts(summary, targets);
  const routeRows = await db.query(
    `
    SELECT
      method,
      route,
      COUNT(*)::bigint AS total_requests,
      COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS error_requests,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS latency_p95_ms
    FROM service_slo_request_samples
    WHERE sampled_at >= NOW() - make_interval(hours => $1::int)
    GROUP BY method, route
    ORDER BY total_requests DESC
    LIMIT 10
    `,
    [windowHours],
  );

  return {
    windowHours,
    sampledSince: new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString(),
    targets,
    summary,
    alerts,
    escalationPolicy: {
      on_call_immediate: 'Page primary on-call and incident channel immediately.',
      business_hours: 'Create ops ticket and review in next operations standup.',
    },
    topRoutes: routeRows.rows.map((row) => {
      const entry = row as {
        method: string;
        route: string;
        total_requests: string;
        error_requests: string;
        latency_p95_ms: number | string | null;
      };
      return {
        method: entry.method,
        route: entry.route,
        totalRequests: Number(entry.total_requests ?? '0'),
        errorRequests: Number(entry.error_requests ?? '0'),
        latencyP95Ms: entry.latency_p95_ms === null ? null : Math.round(Number(entry.latency_p95_ms)),
      };
    }),
  };
});

app.post('/admin/enforcement/actions', async (request, reply) => {
  if (!enforcementAdminKey) {
    reply.code(501);
    return { error: 'Enforcement tooling is not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== enforcementAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const body = (request.body ?? {}) as AdminCreateEnforcementActionBody;
  const targetAccountId = String(body.targetAccountId ?? '').trim();
  if (!isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID.' };
  }
  if (!await ensureAccountExists(targetAccountId)) {
    reply.code(404);
    return { error: 'Target account not found.' };
  }
  const actionType = parseEnforcementActionType(body.actionType);
  if (!actionType) {
    reply.code(400);
    return { error: 'actionType must be one of: warning, suspension, ban.' };
  }
  const reason = String(body.reason ?? '').trim();
  if (!reason || reason.length > 1024) {
    reply.code(400);
    return { error: 'reason is required and must be 1024 characters or fewer.' };
  }
  const sourceAlertId = body.sourceAlertId === undefined || body.sourceAlertId === null
    ? null
    : String(body.sourceAlertId).trim();
  if (sourceAlertId !== null && !isUuid(sourceAlertId)) {
    reply.code(400);
    return { error: 'sourceAlertId must be a UUID when provided.' };
  }
  const startsAt = body.startsAt ? parseIsoDate(body.startsAt) : new Date();
  if (!startsAt) {
    reply.code(400);
    return { error: 'startsAt must be a valid ISO timestamp when provided.' };
  }
  const durationHours = typeof body.durationHours === 'number' && Number.isFinite(body.durationHours)
    ? body.durationHours
    : null;
  if (actionType === 'suspension') {
    if (durationHours === null || durationHours <= 0 || durationHours > 24 * 365) {
      reply.code(400);
      return { error: 'durationHours is required for suspension and must be > 0 and <= 8760.' };
    }
  } else if (durationHours !== null) {
    reply.code(400);
    return { error: 'durationHours is only allowed for suspension actions.' };
  }
  let metadata: Record<string, unknown>;
  try {
    metadata = parseObjectPayload(body.metadata, 'metadata');
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : 'metadata is invalid.' };
  }
  const endsAt = actionType === 'suspension'
    ? new Date(startsAt.getTime() + (durationHours as number) * 60 * 60 * 1000)
    : null;
  const actorIdentity = getAdminActorIdentity(request.headers as Record<string, unknown>);

  try {
    const created = await db.query(
      `
      INSERT INTO enforcement_actions(
        target_account_id, actor_identity, source_alert_id, action_type, reason, metadata, starts_at, ends_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW())
      RETURNING
        action_id,
        target_account_id,
        actor_identity,
        source_alert_id,
        action_type,
        reason,
        metadata,
        starts_at,
        ends_at,
        revoked_at,
        revoked_by,
        revoked_reason,
        created_at,
        updated_at
      `,
      [
        targetAccountId,
        actorIdentity,
        sourceAlertId,
        actionType,
        reason,
        JSON.stringify(metadata),
        startsAt.toISOString(),
        endsAt?.toISOString() ?? null,
      ],
    );
    const row = created.rows[0] as {
      action_id: string;
      target_account_id: string;
      actor_identity: string;
      source_alert_id: string | null;
      action_type: EnforcementActionType;
      reason: string;
      metadata: unknown;
      starts_at: string;
      ends_at: string | null;
      revoked_at: string | null;
      revoked_by: string | null;
      revoked_reason: string | null;
      created_at: string;
      updated_at: string;
    };
    return {
      actionId: row.action_id,
      targetAccountId: row.target_account_id,
      actorIdentity: row.actor_identity,
      sourceAlertId: row.source_alert_id,
      actionType: row.action_type,
      actionState: getEnforcementActionState({
        actionType: row.action_type,
        startsAtIso: row.starts_at,
        endsAtIso: row.ends_at,
        revokedAtIso: row.revoked_at,
      }),
      reason: row.reason,
      metadata: row.metadata,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      revokedReason: row.revoked_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error: unknown) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === '23503') {
      reply.code(400);
      return { error: 'sourceAlertId does not reference an existing ranked anomaly alert.' };
    }
    throw error;
  }
});

app.get('/admin/enforcement/actions', async (request, reply) => {
  if (!enforcementAdminKey) {
    reply.code(501);
    return { error: 'Enforcement tooling is not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== enforcementAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const query = (request.query ?? {}) as AdminListEnforcementActionsQuery;
  const targetAccountId = query.targetAccountId === undefined ? null : query.targetAccountId.trim();
  if (targetAccountId !== null && !isUuid(targetAccountId)) {
    reply.code(400);
    return { error: 'targetAccountId must be a UUID when provided.' };
  }
  const actionType = query.actionType === undefined ? null : parseEnforcementActionType(query.actionType);
  if (query.actionType !== undefined && !actionType) {
    reply.code(400);
    return { error: 'actionType must be one of: warning, suspension, ban.' };
  }
  const activeOnly = query.activeOnly === undefined ? false : parseQueryBoolean(query.activeOnly);
  if (activeOnly === null) {
    reply.code(400);
    return { error: 'activeOnly must be true/false (or 1/0) when provided.' };
  }
  const limit = parsePositiveInteger(query.limit) ?? 50;
  const offset = parseNonNegativeInteger(query.offset) ?? 0;
  if (limit > 200) {
    reply.code(400);
    return { error: 'limit must be 200 or less.' };
  }

  const totalResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM enforcement_actions a
    WHERE ($1::uuid IS NULL OR a.target_account_id = $1)
      AND ($2::text IS NULL OR a.action_type = $2)
      AND (
        $3::boolean = FALSE
        OR (
          a.revoked_at IS NULL
          AND a.starts_at <= NOW()
          AND (a.action_type = 'ban' OR (a.action_type = 'suspension' AND a.ends_at > NOW()))
        )
      )
    `,
    [targetAccountId, actionType, activeOnly],
  );
  const total = Number((totalResult.rows[0] as { total: string }).total ?? '0');
  const rows = await db.query(
    `
    SELECT
      a.action_id,
      a.target_account_id,
      a.actor_identity,
      a.source_alert_id,
      a.action_type,
      a.reason,
      a.metadata,
      a.starts_at,
      a.ends_at,
      a.revoked_at,
      a.revoked_by,
      a.revoked_reason,
      a.created_at,
      a.updated_at,
      p.display_name,
      appeal.status AS appeal_status,
      appeal.updated_at AS appeal_updated_at
    FROM enforcement_actions a
    LEFT JOIN profiles p ON p.account_id = a.target_account_id
    LEFT JOIN LATERAL (
      SELECT status, updated_at
      FROM enforcement_appeals e
      WHERE e.action_id = a.action_id
      ORDER BY e.updated_at DESC
      LIMIT 1
    ) appeal ON TRUE
    WHERE ($1::uuid IS NULL OR a.target_account_id = $1)
      AND ($2::text IS NULL OR a.action_type = $2)
      AND (
        $3::boolean = FALSE
        OR (
          a.revoked_at IS NULL
          AND a.starts_at <= NOW()
          AND (a.action_type = 'ban' OR (a.action_type = 'suspension' AND a.ends_at > NOW()))
        )
      )
    ORDER BY a.created_at DESC
    LIMIT $4 OFFSET $5
    `,
    [targetAccountId, actionType, activeOnly, limit, offset],
  );

  return {
    filters: {
      targetAccountId,
      actionType,
      activeOnly,
    },
    pagination: {
      limit,
      offset,
      total,
    },
    items: rows.rows.map((row) => {
      const entry = row as {
        action_id: string;
        target_account_id: string;
        actor_identity: string;
        source_alert_id: string | null;
        action_type: EnforcementActionType;
        reason: string;
        metadata: unknown;
        starts_at: string;
        ends_at: string | null;
        revoked_at: string | null;
        revoked_by: string | null;
        revoked_reason: string | null;
        created_at: string;
        updated_at: string;
        display_name: string | null;
        appeal_status: EnforcementAppealStatus | null;
        appeal_updated_at: string | null;
      };
      return {
        actionId: entry.action_id,
        targetAccountId: entry.target_account_id,
        targetDisplayName: entry.display_name,
        actorIdentity: entry.actor_identity,
        sourceAlertId: entry.source_alert_id,
        actionType: entry.action_type,
        actionState: getEnforcementActionState({
          actionType: entry.action_type,
          startsAtIso: entry.starts_at,
          endsAtIso: entry.ends_at,
          revokedAtIso: entry.revoked_at,
        }),
        reason: entry.reason,
        metadata: entry.metadata,
        startsAt: entry.starts_at,
        endsAt: entry.ends_at,
        revokedAt: entry.revoked_at,
        revokedBy: entry.revoked_by,
        revokedReason: entry.revoked_reason,
        appealStatus: entry.appeal_status,
        appealUpdatedAt: entry.appeal_updated_at,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      };
    }),
  };
});

app.get('/enforcement/me', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const rows = await db.query(
    `
    SELECT
      a.action_id,
      a.action_type,
      a.reason,
      a.metadata,
      a.starts_at,
      a.ends_at,
      a.revoked_at,
      a.revoked_reason,
      a.created_at,
      appeal.appeal_id,
      appeal.status AS appeal_status,
      appeal.player_note,
      appeal.reviewer_note,
      appeal.reviewed_by,
      appeal.reviewed_at,
      appeal.updated_at AS appeal_updated_at
    FROM enforcement_actions a
    LEFT JOIN LATERAL (
      SELECT
        e.appeal_id,
        e.status,
        e.player_note,
        e.reviewer_note,
        e.reviewed_by,
        e.reviewed_at,
        e.updated_at
      FROM enforcement_appeals e
      WHERE e.action_id = a.action_id
        AND e.submitted_by_account_id = $1
      ORDER BY e.updated_at DESC
      LIMIT 1
    ) appeal ON TRUE
    WHERE a.target_account_id = $1
    ORDER BY a.created_at DESC
    LIMIT 100
    `,
    [accountId],
  );

  return {
    items: rows.rows.map((row) => {
      const entry = row as {
        action_id: string;
        action_type: EnforcementActionType;
        reason: string;
        metadata: unknown;
        starts_at: string;
        ends_at: string | null;
        revoked_at: string | null;
        revoked_reason: string | null;
        created_at: string;
        appeal_id: string | null;
        appeal_status: EnforcementAppealStatus | null;
        player_note: string | null;
        reviewer_note: string | null;
        reviewed_by: string | null;
        reviewed_at: string | null;
        appeal_updated_at: string | null;
      };
      return {
        actionId: entry.action_id,
        actionType: entry.action_type,
        actionState: getEnforcementActionState({
          actionType: entry.action_type,
          startsAtIso: entry.starts_at,
          endsAtIso: entry.ends_at,
          revokedAtIso: entry.revoked_at,
        }),
        reason: entry.reason,
        metadata: entry.metadata,
        startsAt: entry.starts_at,
        endsAt: entry.ends_at,
        revokedAt: entry.revoked_at,
        revokedReason: entry.revoked_reason,
        createdAt: entry.created_at,
        appeal: entry.appeal_id
          ? {
            appealId: entry.appeal_id,
            status: entry.appeal_status,
            playerNote: entry.player_note,
            reviewerNote: entry.reviewer_note,
            reviewedBy: entry.reviewed_by,
            reviewedAt: entry.reviewed_at,
            updatedAt: entry.appeal_updated_at,
          }
          : null,
      };
    }),
  };
});

app.post('/enforcement/appeals', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

  const body = (request.body ?? {}) as PlayerCreateEnforcementAppealBody;
  const actionId = String(body.actionId ?? '').trim();
  if (!isUuid(actionId)) {
    reply.code(400);
    return { error: 'actionId must be a UUID.' };
  }
  const note = String(body.note ?? '').trim();
  if (!note || note.length > 1024) {
    reply.code(400);
    return { error: 'note is required and must be 1024 characters or fewer.' };
  }

  try {
    const created = await db.query(
      `
      INSERT INTO enforcement_appeals(
        action_id, target_account_id, submitted_by_account_id, status, player_note, updated_at
      )
      SELECT action_id, target_account_id, $2, 'submitted', $3, NOW()
      FROM enforcement_actions
      WHERE action_id = $1
        AND target_account_id = $2
      RETURNING
        appeal_id,
        action_id,
        target_account_id,
        submitted_by_account_id,
        status,
        player_note,
        reviewer_note,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at
      `,
      [actionId, accountId, note],
    );
    if (!created.rowCount) {
      reply.code(404);
      return { error: 'Enforcement action not found for this account.' };
    }
    const row = created.rows[0] as {
      appeal_id: string;
      action_id: string;
      target_account_id: string;
      submitted_by_account_id: string;
      status: EnforcementAppealStatus;
      player_note: string | null;
      reviewer_note: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      created_at: string;
      updated_at: string;
    };
    reply.code(201);
    return {
      appealId: row.appeal_id,
      actionId: row.action_id,
      targetAccountId: row.target_account_id,
      submittedByAccountId: row.submitted_by_account_id,
      status: row.status,
      playerNote: row.player_note,
      reviewerNote: row.reviewer_note,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error: unknown) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === '23505') {
      reply.code(409);
      return { error: 'An appeal is already open for this action.' };
    }
    throw error;
  }
});

app.post('/admin/enforcement/appeals/:appealId/review', async (request, reply) => {
  if (!enforcementAdminKey) {
    reply.code(501);
    return { error: 'Enforcement tooling is not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== enforcementAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const params = (request.params ?? {}) as AdminReviewAppealParams;
  if (!isUuid(params.appealId)) {
    reply.code(400);
    return { error: 'appealId must be a UUID.' };
  }
  const body = (request.body ?? {}) as AdminReviewAppealBody;
  const status = parseEnforcementAppealStatus(body.status);
  if (!status || status === 'submitted') {
    reply.code(400);
    return { error: 'status must be one of: under_review, accepted, rejected.' };
  }
  const reviewerNote = String(body.reviewerNote ?? '').trim();
  if ((status === 'accepted' || status === 'rejected') && !reviewerNote) {
    reply.code(400);
    return { error: 'reviewerNote is required for accepted or rejected outcomes.' };
  }
  if (reviewerNote.length > 1024) {
    reply.code(400);
    return { error: 'reviewerNote must be 1024 characters or fewer.' };
  }
  const revokeAction = body.revokeAction === true;
  if (revokeAction && status !== 'accepted') {
    reply.code(400);
    return { error: 'revokeAction is only allowed when status is accepted.' };
  }
  const actorIdentity = getAdminActorIdentity(request.headers as Record<string, unknown>);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const updatedAppeal = await client.query(
      `
      UPDATE enforcement_appeals
      SET
        status = $2,
        reviewer_note = $3,
        reviewed_by = $4,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE appeal_id = $1
      RETURNING
        appeal_id,
        action_id,
        target_account_id,
        submitted_by_account_id,
        status,
        player_note,
        reviewer_note,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at
      `,
      [params.appealId, status, reviewerNote || null, actorIdentity],
    );
    if (!updatedAppeal.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { error: 'Appeal not found.' };
    }
    const appeal = updatedAppeal.rows[0] as {
      appeal_id: string;
      action_id: string;
      target_account_id: string;
      submitted_by_account_id: string;
      status: EnforcementAppealStatus;
      player_note: string | null;
      reviewer_note: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      created_at: string;
      updated_at: string;
    };
    let actionRevoked = false;
    if (revokeAction) {
      const revoked = await client.query(
        `
        UPDATE enforcement_actions
        SET
          revoked_at = NOW(),
          revoked_by = $2,
          revoked_reason = COALESCE($3, 'appeal_accepted'),
          updated_at = NOW()
        WHERE action_id = $1
          AND revoked_at IS NULL
        RETURNING action_id
        `,
        [appeal.action_id, actorIdentity, reviewerNote || null],
      );
      actionRevoked = Boolean(revoked.rowCount);
    }
    await client.query('COMMIT');
    return {
      appealId: appeal.appeal_id,
      actionId: appeal.action_id,
      targetAccountId: appeal.target_account_id,
      submittedByAccountId: appeal.submitted_by_account_id,
      status: appeal.status,
      playerNote: appeal.player_note,
      reviewerNote: appeal.reviewer_note,
      reviewedBy: appeal.reviewed_by,
      reviewedAt: appeal.reviewed_at,
      createdAt: appeal.created_at,
      updatedAt: appeal.updated_at,
      actionRevoked,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/ranked/anomalies/alerts', async (request, reply) => {
  if (!rankedAnomalyAdminKey) {
    reply.code(501);
    return { error: 'Ranked anomaly alerts are not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== rankedAnomalyAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const query = (request.query ?? {}) as RankedAnomalyAlertsQuery;
  const status = query.status === undefined ? null : parseRankedAnomalyStatus(query.status);
  if (query.status !== undefined && !status) {
    reply.code(400);
    return { error: 'status must be one of: open, false_positive, confirmed.' };
  }
  const alertType = query.type === undefined ? null : parseRankedAnomalyType(query.type);
  if (query.type !== undefined && !alertType) {
    reply.code(400);
    return { error: 'type must be one of: impossible_cadence, rating_jump, mr_jump.' };
  }
  const accountId = query.accountId === undefined ? null : query.accountId.trim();
  if (accountId !== null && !isUuid(accountId)) {
    reply.code(400);
    return { error: 'accountId must be a UUID when provided.' };
  }
  const matchId = query.matchId === undefined ? null : query.matchId.trim();
  if (matchId !== null && !isUuid(matchId)) {
    reply.code(400);
    return { error: 'matchId must be a UUID when provided.' };
  }
  const limit = parsePositiveInteger(query.limit) ?? 50;
  const offset = parseNonNegativeInteger(query.offset) ?? 0;
  if (limit > 200) {
    reply.code(400);
    return { error: 'limit must be 200 or less.' };
  }

  const totalResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM ranked_anomaly_alerts
    WHERE ($1::text IS NULL OR status = $1)
      AND ($2::text IS NULL OR alert_type = $2)
      AND ($3::uuid IS NULL OR account_id = $3)
      AND ($4::uuid IS NULL OR match_id = $4)
    `,
    [status, alertType, accountId, matchId],
  );
  const total = Number((totalResult.rows[0] as { total: string }).total ?? '0');
  const rows = await db.query(
    `
    SELECT
      alert_id,
      alert_type,
      severity,
      status,
      account_id,
      match_id,
      message,
      metadata,
      detected_at,
      reviewed_at,
      reviewed_by,
      review_note
    FROM ranked_anomaly_alerts
    WHERE ($1::text IS NULL OR status = $1)
      AND ($2::text IS NULL OR alert_type = $2)
      AND ($3::uuid IS NULL OR account_id = $3)
      AND ($4::uuid IS NULL OR match_id = $4)
    ORDER BY detected_at DESC
    LIMIT $5 OFFSET $6
    `,
    [status, alertType, accountId, matchId, limit, offset],
  );

  return {
    filters: {
      status,
      type: alertType,
      accountId,
      matchId,
    },
    pagination: {
      limit,
      offset,
      total,
    },
    items: rows.rows.map((row) => {
      const alert = row as {
        alert_id: string;
        alert_type: RankedAnomalyType;
        severity: 'high' | 'medium';
        status: RankedAnomalyStatus;
        account_id: string;
        match_id: string;
        message: string;
        metadata: unknown;
        detected_at: string;
        reviewed_at: string | null;
        reviewed_by: string | null;
        review_note: string | null;
      };
      return {
        alertId: alert.alert_id,
        type: alert.alert_type,
        severity: alert.severity,
        status: alert.status,
        accountId: alert.account_id,
        matchId: alert.match_id,
        message: alert.message,
        metadata: alert.metadata,
        detectedAt: alert.detected_at,
        reviewedAt: alert.reviewed_at,
        reviewedBy: alert.reviewed_by,
        reviewNote: alert.review_note,
      };
    }),
  };
});

app.post('/ranked/anomalies/alerts/:alertId/review', async (request, reply) => {
  if (!rankedAnomalyAdminKey) {
    reply.code(501);
    return { error: 'Ranked anomaly alerts are not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== rankedAnomalyAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const params = (request.params ?? {}) as RankedAnomalyAlertParams;
  if (!isUuid(params.alertId)) {
    reply.code(400);
    return { error: 'alertId must be a UUID.' };
  }

  const body = (request.body ?? {}) as RankedAnomalyAlertReviewBody;
  const status = parseRankedAnomalyStatus(body.status);
  if (status !== 'false_positive' && status !== 'confirmed') {
    reply.code(400);
    return { error: 'status must be one of: false_positive, confirmed.' };
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (status === 'false_positive' && !note) {
    reply.code(400);
    return { error: 'note is required when marking false_positive.' };
  }
  if (note.length > 1024) {
    reply.code(400);
    return { error: 'note must be 1024 characters or fewer.' };
  }
  const reviewerHeader = getHeaderValue(request.headers['x-admin-actor']).trim();
  const reviewedBy = reviewerHeader ? reviewerHeader.slice(0, 64) : 'ops';

  const updated = await db.query(
    `
    UPDATE ranked_anomaly_alerts
    SET
      status = $2,
      reviewed_at = NOW(),
      reviewed_by = $3,
      review_note = $4
    WHERE alert_id = $1
    RETURNING
      alert_id,
      alert_type,
      severity,
      status,
      account_id,
      match_id,
      message,
      metadata,
      detected_at,
      reviewed_at,
      reviewed_by,
      review_note
    `,
    [params.alertId, status, reviewedBy, note || null],
  );
  if (!updated.rowCount) {
    reply.code(404);
    return { error: 'Anomaly alert not found.' };
  }
  const row = updated.rows[0] as {
    alert_id: string;
    alert_type: RankedAnomalyType;
    severity: 'high' | 'medium';
    status: RankedAnomalyStatus;
    account_id: string;
    match_id: string;
    message: string;
    metadata: unknown;
    detected_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    review_note: string | null;
  };
  return {
    alertId: row.alert_id,
    type: row.alert_type,
    severity: row.severity,
    status: row.status,
    accountId: row.account_id,
    matchId: row.match_id,
    message: row.message,
    metadata: row.metadata,
    detectedAt: row.detected_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
  };
});

app.post('/ranked/seasons/reset', async (request, reply) => {
  const requiredAdminKey = process.env.RANKED_SEASON_RESET_ADMIN_KEY;
  if (!requiredAdminKey) {
    reply.code(501);
    return { error: 'Ranked season reset is not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== requiredAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await runRankedSeasonReset(client, new Date(), rankedSeasonDurationDays);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
app.listen({ port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
