import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { CHARACTER_BY_ID, type CharacterId } from '../../game-web/src/sim/characters';
import { validateReplayPayload as validateDeterministicReplayPayload } from '../../game-web/src/sim/replay';
import {
  getRankedTuningFingerprint,
  rankedSeedFromSessionId,
  verifyRankedMatchProof,
} from '../../game-web/src/sim/rankedProof';
import { databaseTarget, db } from './db';
import {
  createMatchmakingQueueService,
  isQueueType,
  isRegionId,
  MatchmakingCapacityError,
  type SessionActionErrorCode,
  type RegionId,
  type QueueType,
  type MatchSessionView,
  type MatchmakingQueueSnapshot,
} from './matchmaking/queueService';
import {
  createLiveSessionFrameRelay,
  type RelayPlayerFrameInput,
} from './matchmaking/liveSessionFrameRelay';
import {
  createMatchmakingAccessPolicyFromEnv,
  type MatchmakingAccessDenialCode,
} from './matchmaking/accessPolicy';
import { createMatchmakingNetworkConfigServiceFromEnv } from './matchmaking/networkConfig';
import {
  createMatchmakingRuntimeStateStore,
  fingerprintMatchmakingRuntimeSnapshot,
  resolveMatchmakingRuntimeSnapshotKey,
} from './matchmaking/runtimeStateStore';
import {
  createMatchmakingRuntimeCoordinator,
  matchmakingRuntimeLockKeyFromNamespace,
  MATCHMAKING_RUNTIME_COORDINATION_MODE,
  MatchmakingRuntimeLockTimeoutError,
  type MatchmakingRuntimeLease,
} from './matchmaking/runtimeCoordinator';
import {
  createSessionSignalStore,
  DEFAULT_EXPIRED_SIGNAL_DELETE_LIMIT,
  isSessionSignalType,
  SessionSignalConflictError,
  SessionSignalQuotaExceededError,
  type SessionSignalJson,
} from './matchmaking/sessionSignalStore';
import { createMatchmakingSessionAccessStore } from './matchmaking/sessionAccessStore';
import { requestUsesMatchmakingRuntime } from './matchmaking/runtimeRoutePolicy';
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
import {
  computeReplayCanonicalDigestForArchive,
  validateReplayPayloadForArchive,
} from './replays/payload';
import {
  compareReplayArchiveIdentity,
  type CanonicalReplayBindingInput,
  type NormalisedReplayParticipant,
  type RankedReplaySettlement,
  type ReplayArchiveIdentity,
  resolveReplayIngestBodyLimitBytes,
  validateCanonicalReplayBinding,
  validateRankedReplayProofBinding,
  validateRankedReplaySettlement,
} from './replays/ingestValidation';
import {
  evaluateReplayIngestQuota,
  resolveReplayIngestQuotaPolicy,
} from './replays/ingestPolicy';
import { pruneExpiredReplayArchives } from './replays/retention';
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
import { createSteamTicketVerifier } from './auth/steamAuth';
import {
  SteamAccountLinkError,
  logIdentityLinkEvent,
  resolveSteamAccountLink,
} from './auth/steamLinkService';
import { createAuthSessionTokenService } from './auth/sessionToken';
import {
  resolveAllowInsecureAccountHeader,
  resolveAuthSessionPreviousSecrets,
  resolveAuthSessionSecret,
} from './auth/sessionConfig';
import { resolveTrustProxyHops } from './auth/proxySource';
import {
  resolveAccountAuthorizationStatus,
  resolveAuthenticatedAccountId,
} from './auth/requestAuth';
import {
  createAuthRateLimiter,
  type AuthRateLimitRule,
} from './auth/authRateLimit';
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
  createSloSampleStore,
  resolveSloSampleRetentionConfig,
} from './ops/sloSampleStore';
import {
  evaluateRankedResultConsensus,
  evaluateRankedResultSubmission,
  type RankedResultSuspiciousReason,
} from './ranked/resultValidation';
import {
  type RankedAnomalyType,
} from './ranked/anomalyDetection';
import {
  ensureActiveSeason,
  getSeasonById,
  resolveRankedSeasonDurationDays,
  runRankedSeasonReset,
} from './ranked/seasonService';
import {
  ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL,
  ARCHIVED_MASTER_LEADERBOARD_TOTAL_SQL,
} from './ranked/leaderboardQueries';
import type { LeagueTier } from './ranked/leagueService';
import {
  deriveRankedTerminalDecision,
  processRankedAuthoritativeResolution,
  type RankedAuthoritativeResolutionCandidate,
} from './ranked/authoritativeResolutionService';
import {
  createRankedTerminalDecisionStore,
  type EnqueueRankedTerminalDecisionInput,
  type RankedTerminalDecision,
} from './ranked/terminalDecisionStore';
import { resolveDurableRankedResultAccess } from './ranked/resultReadAccess';
import {
  settleRankedMatch,
  type RankedSettlementConfig,
} from './ranked/settlementService';

const app = Fastify({
  logger: true,
  trustProxy: resolveTrustProxyHops(process.env.API_TRUST_PROXY_HOPS),
});
const replayIngestBodyLimitBytes = resolveReplayIngestBodyLimitBytes(
  process.env.REPLAY_INGEST_BODY_LIMIT_BYTES,
);
const sloSampleStore = createSloSampleStore(
  db,
  resolveSloSampleRetentionConfig(process.env),
);
const allowedCorsOrigins = parseCorsOrigins(process.env.API_CORS_ORIGINS);
app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || isAllowedCorsOrigin(origin, allowedCorsOrigins)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'authorization',
    'content-type',
    'x-account-id',
    'x-admin-key',
    'x-admin-actor',
    'x-match-session-token',
  ],
});

app.addHook('onRequest', async (request) => {
  (request as { _sloRequestStartAt?: bigint })._sloRequestStartAt = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  const trackedRequest = request as {
    _sloRequestStartAt?: bigint;
    _excludeFromSloAvailability?: boolean;
  };
  const startedAt = trackedRequest._sloRequestStartAt;
  if (!startedAt || trackedRequest._excludeFromSloAvailability) {
    return;
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const routePath = String(
    (request as { routeOptions?: { url?: string } }).routeOptions?.url
    ?? request.url.split('?')[0]
    ?? 'unknown',
  ).slice(0, 160);
  try {
    const recorded = await sloSampleStore.record({
      method: request.method.toUpperCase(),
      route: routePath,
      statusCode: reply.statusCode,
      latencyMs: Math.max(0, Math.round(elapsedMs)),
    });
    if (recorded.cleanupDue) {
      try {
        await sloSampleStore.pruneBatch();
      } catch (error) {
        request.log.warn({ err: error }, 'Failed to prune retained SLO request samples.');
      }
    }
  } catch (error) {
    request.log.warn({ err: error }, 'Failed to record SLO request sample.');
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANKED_PROOF_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const PROVIDERS = new Set(['steam', 'web']);
const releaseSha = [
  process.env.RELEASE_SHA,
  process.env.RENDER_GIT_COMMIT,
  process.env.CF_PAGES_COMMIT_SHA,
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.COMMIT_SHA,
].map((value) => String(value ?? '').trim()).find((value) => value.length > 0) ?? 'dev-local';
const deploymentEnvironment = String(
  process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
).trim();
const deploymentDatabaseId = String(
  process.env.DEPLOYMENT_DATABASE_ID ?? (databaseTarget === 'local' ? 'local' : 'unconfigured'),
).trim();
const authSessionSecret = resolveAuthSessionSecret(process.env);
const authSessionTokenService = createAuthSessionTokenService({
  secret: authSessionSecret,
  previousSecrets: resolveAuthSessionPreviousSecrets(process.env, authSessionSecret),
  ttlSeconds: parsePositiveIntegerEnv(process.env.AUTH_SESSION_TTL_SECONDS),
});
const authRateLimiter = createAuthRateLimiter({
  database: db,
  secret: process.env.AUTH_RATE_LIMIT_SECRET?.trim() || authSessionSecret,
});
const authIdentityAdminKey = resolveOptionalSecret(
  process.env.AUTH_IDENTITY_ADMIN_KEY,
  'AUTH_IDENTITY_ADMIN_KEY',
);
const authRateLimitPolicies = {
  globalSource: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_GLOBAL_SOURCE', 60, 15 * 60),
  guestSource: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_GUEST_SOURCE', 20, 60 * 60),
  webSignupSource: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_WEB_SIGNUP_SOURCE', 10, 60 * 60),
  webSignupPrincipal: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_WEB_SIGNUP_PRINCIPAL', 3, 60 * 60),
  webSigninPrincipal: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_WEB_SIGNIN_PRINCIPAL', 8, 15 * 60),
  steamSource: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_STEAM_SOURCE', 20, 5 * 60),
  steamTicket: resolveAuthRateLimitPolicy('AUTH_RATE_LIMIT_STEAM_TICKET', 3, 5 * 60),
};
const replayIngestRateLimitPolicies = {
  source: resolveAuthRateLimitPolicy('REPLAY_INGEST_RATE_LIMIT_SOURCE', 40, 60 * 60),
  account: resolveAuthRateLimitPolicy('REPLAY_INGEST_RATE_LIMIT_ACCOUNT', 20, 60 * 60),
};
const rankedProofRateLimitPolicies = {
  accountSession: resolveAuthRateLimitPolicy('RANKED_PROOF_RATE_LIMIT_ACCOUNT_SESSION', 4, 10 * 60),
  accountHour: resolveAuthRateLimitPolicy('RANKED_PROOF_RATE_LIMIT_ACCOUNT_HOUR', 20, 60 * 60),
};
const replayIngestQuotaPolicy = resolveReplayIngestQuotaPolicy(process.env);
const replayRetentionCleanupIntervalMs = Math.max(
  60,
  parsePositiveIntegerEnv(process.env.REPLAY_RETENTION_CLEANUP_INTERVAL_SECONDS) ?? 3_600,
) * 1_000;
const matchmakingSignalCleanupIntervalMs = Math.min(
  3_600,
  Math.max(30, parsePositiveIntegerEnv(process.env.MATCHMAKING_SIGNAL_CLEANUP_INTERVAL_SECONDS) ?? 60),
) * 1_000;
const authRateLimitCleanupIntervalMs = Math.min(
  86_400,
  Math.max(60, parsePositiveIntegerEnv(process.env.AUTH_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS) ?? 900),
) * 1_000;
const allowInsecureAccountHeader = resolveAllowInsecureAccountHeader(process.env);
const legacyHttpFrameRelayEnabled = process.env.NODE_ENV !== 'production'
  && process.env.MATCHMAKING_ENABLE_LEGACY_HTTP_FRAME_RELAY === 'true';
const steamTicketVerifier = createSteamTicketVerifier({
  apiKey: process.env.STEAM_WEB_API_KEY,
  appId: process.env.STEAM_APP_ID,
  identity: process.env.STEAM_WEB_API_IDENTITY,
  allowDevTickets: process.env.NODE_ENV !== 'production' && process.env.STEAM_ALLOW_DEV_TICKETS === 'true',
  apiBase: process.env.STEAM_WEB_API_BASE,
  timeoutMs: parsePositiveIntegerEnv(process.env.STEAM_WEB_API_TIMEOUT_MS),
});
const liveSessionFrameRelay = createLiveSessionFrameRelay();
const sessionSignalStore = createSessionSignalStore(db, {
  ttlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SIGNAL_TTL_SECONDS),
  maxMessagesPerSession: parsePositiveIntegerEnv(
    process.env.MATCHMAKING_SIGNAL_MAX_MESSAGES_PER_SESSION,
  ),
  maxBytesPerSession: parsePositiveIntegerEnv(
    process.env.MATCHMAKING_SIGNAL_MAX_BYTES_PER_SESSION,
  ),
  maxMessagesPerSender: parsePositiveIntegerEnv(
    process.env.MATCHMAKING_SIGNAL_MAX_MESSAGES_PER_SENDER,
  ),
  maxBytesPerSender: parsePositiveIntegerEnv(
    process.env.MATCHMAKING_SIGNAL_MAX_BYTES_PER_SENDER,
  ),
});
const rankedTerminalDecisionStore = createRankedTerminalDecisionStore(db);
const pendingRankedTerminalDecisions = new Map<string, EnqueueRankedTerminalDecisionInput>();
const matchmakingQueueService = createMatchmakingQueueService({
  maxResidentTickets: parsePositiveIntegerEnv(process.env.MATCHMAKING_MAX_RESIDENT_TICKETS),
  ticketTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_TICKET_TTL_SECONDS),
  sessionTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SESSION_TTL_SECONDS),
  sessionTokenTtlSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_SESSION_TOKEN_TTL_SECONDS),
  reconnectGraceSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_RECONNECT_GRACE_SECONDS),
  heartbeatIntervalSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_HEARTBEAT_INTERVAL_SECONDS),
  heartbeatTimeoutSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_HEARTBEAT_TIMEOUT_SECONDS),
  closedTicketRetentionSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_CLOSED_RETENTION_SECONDS),
  rankedRatingInitialGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_RANKED_INITIAL_GAP),
  rankedRatingExpansionPerSecond: parsePositiveNumberEnv(process.env.MATCHMAKING_RANKED_GAP_EXPANSION_PER_SECOND),
  rankedRatingMaxGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_RANKED_MAX_GAP),
  rankedMasterInitialGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_MASTER_INITIAL_GAP),
  rankedMasterExpansionPerSecond: parsePositiveNumberEnv(process.env.MATCHMAKING_MASTER_GAP_EXPANSION_PER_SECOND),
  rankedMasterMaxGap: parsePositiveIntegerEnv(process.env.MATCHMAKING_MASTER_MAX_GAP),
  rankedMasterStrictRegionSeconds: parsePositiveIntegerEnv(process.env.MATCHMAKING_MASTER_STRICT_REGION_SECONDS),
  onSessionResolved: (sessionId, _reason, session) => {
    queueRankedTerminalDecision(session);
    const cleanupTimer = setTimeout(() => {
      liveSessionFrameRelay.clearSession(sessionId);
      void sessionSignalStore.clearSession(sessionId).catch((error) => {
        app.log.warn({ err: error, sessionId }, 'Failed to clear WebRTC signaling mailbox.');
      });
    }, 15_000);
    cleanupTimer.unref();
  },
});
const matchmakingRuntimeNamespace = resolveMatchmakingRuntimeSnapshotKey(
  process.env.MATCHMAKING_RUNTIME_NAMESPACE,
);
const matchmakingRuntimeStateStore = createMatchmakingRuntimeStateStore(db, {
  snapshotKey: matchmakingRuntimeNamespace,
});
const matchmakingSessionAccessStore = createMatchmakingSessionAccessStore(db, {
  snapshotKey: matchmakingRuntimeNamespace,
});
const matchmakingRuntimeCoordinator = createMatchmakingRuntimeCoordinator(db, {
  acquireTimeoutMs: parsePositiveIntegerEnv(process.env.MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS),
  lockKey: matchmakingRuntimeLockKeyFromNamespace(matchmakingRuntimeNamespace),
  fenceKey: matchmakingRuntimeNamespace,
});
interface MatchmakingRuntimeRequestLeaseState {
  lease: MatchmakingRuntimeLease;
  finalization: Promise<void> | null;
}

const matchmakingRuntimeLeaseByRequest = new WeakMap<object, MatchmakingRuntimeRequestLeaseState>();
let matchmakingPersistenceChain: Promise<void> = Promise.resolve();
let rankedTerminalDecisionProcessingChain: Promise<void> = Promise.resolve();
let lastPersistedMatchmakingFingerprint: string | null = null;
let matchmakingDraining = false;
const matchmakingAccessPolicy = createMatchmakingAccessPolicyFromEnv(process.env);
const matchmakingNetworkConfigService = createMatchmakingNetworkConfigServiceFromEnv(process.env);
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
const replayBlobStore = createReplayBlobStoreFromEnv(process.env, { database: db });
const rankedReplayRetentionDays = parsePositiveIntegerEnv(process.env.REPLAY_RETENTION_DAYS_RANKED) ?? 365;
const rankedSupportedRulesetVersions = new Set(
  (process.env.RANKED_SUPPORTED_RULESET_VERSIONS ?? 'prototype-2026.02')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
);
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
const rankedSettlementConfig: RankedSettlementConfig = {
  seasonDurationDays: rankedSeasonDurationDays,
  calibrationMatchesRequired: rankedCalibrationMatchesRequired,
  masterEntryRating: rankedMasterEntryRating,
  masterBasePoints: rankedMasterBasePoints,
  masterQueueWeight: rankedMasterQueueWeight,
  anomalyMinMatchIntervalSeconds: rankedAnomalyMinMatchIntervalSeconds,
  anomalyRatingJumpThreshold: rankedAnomalyRatingJumpThreshold,
  anomalyMrJumpThreshold: rankedAnomalyMrJumpThreshold,
};
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
  linkToAuthenticatedAccount?: boolean;
  mergeAccountId?: unknown;
  displayName?: string | null;
}

interface MatchmakingQueueJoinBody {
  queueType?: string;
  regionPreferences?: string[];
  buildVersion?: string;
  rulesetVersion?: string;
  balanceProfileId?: string;
  platform?: string;
  characterId?: string;
}

interface MatchmakingQueueLeaveBody {
  ticketId?: string;
}

interface MatchmakingDrainBody {
  draining?: boolean;
}

interface MatchmakingSessionDisconnectBody {
  sessionId?: string;
}

interface MatchmakingSessionHeartbeatBody {
  sessionId?: string;
  sessionToken?: string;
}

interface MatchmakingSessionReconnectBody {
  sessionId?: string;
  sessionToken?: string;
  reconnectAttemptId?: string;
}

interface MatchmakingSessionCompleteBody {
  sessionId?: string;
  sessionToken?: string;
}

interface MatchmakingSessionTransportAttemptBody {
  sessionToken?: string;
  expectedGeneration?: number;
}

interface MatchmakingSessionFramesSubmitBody {
  sessionToken?: string;
  frames?: Array<{
    epoch?: number;
    frame?: number;
    input?: Record<string, unknown>;
  }>;
}

interface MatchmakingSessionFramesQuery {
  epoch?: string;
  sinceFrame?: string;
}

interface MatchmakingSessionFramesConfirmBody {
  sessionToken?: string;
  epoch?: number;
  confirmedThrough?: number;
}

interface MatchmakingSessionSignalSubmitBody {
  sessionToken?: string;
  transportAttemptId?: string;
  clientMessageId?: string;
  signalType?: string;
  payload?: unknown;
}

interface MatchmakingSessionSignalsQuery {
  transportAttemptId?: string;
  afterSignalId?: string;
  limit?: string;
}

interface MatchmakingIceConfigBody {
  sessionId?: string;
  sessionToken?: string;
  forceRelay?: boolean;
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
  proof?: unknown;
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

function isUuid(value: string | undefined): value is string {
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
    return ['http://localhost:*', 'http://127.0.0.1:*'];
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

interface AuthRateLimitPolicy {
  maxAttempts: number;
  windowSeconds: number;
}

interface AuthRateLimitRejection {
  error: string;
  code?: string;
  recovery: string;
  retryAfterSeconds?: number;
}

function resolveOptionalSecret(value: string | undefined, name: string): string | null {
  const secret = value?.trim() ?? '';
  if (!secret) {
    return null;
  }
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters when configured.`);
  }
  return secret;
}

function resolveAuthRateLimitPolicy(
  envPrefix: string,
  defaultMaxAttempts: number,
  defaultWindowSeconds: number,
): AuthRateLimitPolicy {
  return {
    maxAttempts: parsePositiveIntegerEnv(process.env[`${envPrefix}_MAX_ATTEMPTS`])
      ?? defaultMaxAttempts,
    windowSeconds: parsePositiveIntegerEnv(process.env[`${envPrefix}_WINDOW_SECONDS`])
      ?? defaultWindowSeconds,
  };
}

function buildAuthRateLimitRule(
  scope: string,
  subject: string,
  policy: AuthRateLimitPolicy,
): AuthRateLimitRule {
  return {
    scope,
    subject,
    maxAttempts: policy.maxAttempts,
    windowSeconds: policy.windowSeconds,
  };
}

async function enforceAuthRateLimits(
  request: FastifyRequest,
  reply: FastifyReply,
  rules: AuthRateLimitRule[],
): Promise<AuthRateLimitRejection | null> {
  try {
    const decisions = await authRateLimiter.consume(rules);
    const denied = decisions.filter((decision) => !decision.allowed);
    if (denied.length === 0) {
      return null;
    }
    const retryAfterSeconds = Math.max(
      1,
      ...denied.map((decision) => decision.retryAfterSeconds),
    );
    request.log.warn(
      { scopes: denied.map((decision) => decision.scope), retryAfterSeconds },
      'Authentication request rate-limited.',
    );
    reply.header('Retry-After', String(retryAfterSeconds));
    reply.code(429);
    return {
      error: 'Too many authentication attempts.',
      recovery: 'Wait before retrying with fresh credentials.',
      retryAfterSeconds,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Authentication rate-limit check failed closed.');
    reply.code(503);
    return {
      error: 'Authentication safety service is temporarily unavailable.',
      recovery: 'Retry after the service has recovered.',
    };
  }
}

async function enforceReplayIngestRateLimits(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
): Promise<AuthRateLimitRejection | null> {
  try {
    const decisions = await authRateLimiter.consume([
      buildAuthRateLimitRule(
        'replay_ingest_source',
        request.ip,
        replayIngestRateLimitPolicies.source,
      ),
      buildAuthRateLimitRule(
        'replay_ingest_account',
        accountId,
        replayIngestRateLimitPolicies.account,
      ),
    ]);
    const denied = decisions.filter((decision) => !decision.allowed);
    if (denied.length === 0) {
      return null;
    }
    const retryAfterSeconds = Math.max(1, ...denied.map((decision) => decision.retryAfterSeconds));
    request.log.warn(
      { scopes: denied.map((decision) => decision.scope), retryAfterSeconds },
      'Replay ingest rate-limited.',
    );
    reply.header('Retry-After', String(retryAfterSeconds));
    reply.code(429);
    return {
      error: 'Too many replay ingest attempts.',
      recovery: 'Wait before uploading another replay archive.',
      retryAfterSeconds,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Replay ingest rate-limit check failed closed.');
    reply.code(503);
    return {
      error: 'Replay ingest safety service is temporarily unavailable.',
      recovery: 'Retry after the service has recovered.',
    };
  }
}

async function enforceRankedProofRateLimits(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
  sessionId: string,
): Promise<AuthRateLimitRejection | null> {
  try {
    const decisions = await authRateLimiter.consume([
      buildAuthRateLimitRule(
        'ranked_proof_account_session',
        `${accountId}:${sessionId}`,
        rankedProofRateLimitPolicies.accountSession,
      ),
      buildAuthRateLimitRule(
        'ranked_proof_account_hour',
        accountId,
        rankedProofRateLimitPolicies.accountHour,
      ),
    ]);
    const denied = decisions.filter((decision) => !decision.allowed);
    if (denied.length === 0) {
      return null;
    }
    const retryAfterSeconds = Math.max(1, ...denied.map((decision) => decision.retryAfterSeconds));
    request.log.warn(
      { scopes: denied.map((decision) => decision.scope), retryAfterSeconds },
      'Ranked proof verification rate-limited.',
    );
    reply.header('Retry-After', String(retryAfterSeconds));
    reply.code(429);
    return {
      error: 'Too many ranked proof verification attempts.',
      code: 'ranked_proof_rate_limited',
      recovery: 'Wait before retrying the ranked proof submission.',
      retryAfterSeconds,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Ranked proof rate-limit check failed closed.');
    reply.code(503);
    return {
      error: 'Ranked proof verification safety service is temporarily unavailable.',
      code: 'ranked_proof_rate_limit_unavailable',
      recovery: 'Retry after the service has recovered.',
    };
  }
}

function secretMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
}

function isAuthIdentityAdmin(request: FastifyRequest): boolean {
  if (!authIdentityAdminKey) {
    return false;
  }
  const provided = getHeaderValue(request.headers['x-admin-key']);
  return secretMatches(provided, authIdentityAdminKey);
}

function requireAuthIdentityAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): { error: string } | null {
  if (!authIdentityAdminKey) {
    reply.code(404);
    return { error: 'Administrative identity routes are disabled.' };
  }
  if (!isAuthIdentityAdmin(request)) {
    reply.code(401);
    return { error: 'Missing or invalid authentication administration key.' };
  }
  return null;
}

function queueRankedTerminalDecision(session: MatchSessionView): void {
  const decision = deriveRankedTerminalDecision(session);
  if (!decision) {
    return;
  }
  pendingRankedTerminalDecisions.set(decision.sessionId, decision);
}

function queuePersistedRankedTerminalDecisions(snapshot: MatchmakingQueueSnapshot): void {
  const reconnectGraceSeconds = matchmakingQueueService.getConfig().reconnectGraceSeconds;
  for (const storedSession of snapshot.sessions) {
    if (storedSession.status !== 'resolved') {
      continue;
    }
    queueRankedTerminalDecision({
      sessionId: storedSession.sessionId,
      queueType: storedSession.queueType,
      region: storedSession.region,
      buildVersion: storedSession.buildVersion ?? null,
      rulesetVersion: storedSession.rulesetVersion ?? null,
      balanceProfileId: storedSession.balanceProfileId ?? null,
      status: storedSession.status,
      resolvedReason: storedSession.resolvedReason,
      resolvedAt: storedSession.resolvedAtMs
        ? new Date(storedSession.resolvedAtMs).toISOString()
        : undefined,
      forfeitingAccountId: storedSession.forfeitingAccountId,
      createdAt: new Date(storedSession.createdAtMs).toISOString(),
      expiresAt: new Date(storedSession.expiresAtMs).toISOString(),
      reconnectGraceSeconds,
      transportAttempt: {
        attemptId: storedSession.transportAttemptId ?? storedSession.sessionId,
        generation: storedSession.transportAttemptGeneration ?? 1,
        createdAt: new Date(
          storedSession.transportAttemptCreatedAtMs ?? storedSession.createdAtMs,
        ).toISOString(),
      },
      participants: storedSession.participants.map((participant) => ({
        accountId: participant.accountId,
        queueTicketId: participant.queueTicketId,
        side: participant.side,
        selectedCharacterId: participant.selectedCharacterId ?? null,
        connectionStatus: participant.connectionStatus,
        lastHeartbeatAt: new Date(participant.lastHeartbeatAtMs ?? snapshot.capturedAtMs).toISOString(),
        disconnectedAt: participant.disconnectedAtMs
          ? new Date(participant.disconnectedAtMs).toISOString()
          : undefined,
        reconnectDeadlineAt: participant.reconnectDeadlineAtMs
          ? new Date(participant.reconnectDeadlineAtMs).toISOString()
          : undefined,
      })),
    });
  }
}

function toAuthoritativeResolutionCandidate(
  decision: RankedTerminalDecision,
): RankedAuthoritativeResolutionCandidate {
  if (
    decision.decisionType !== 'forfeit'
    || !decision.winnerAccountId
    || !decision.forfeitingAccountId
    || (decision.reason !== 'reconnect_timeout' && decision.reason !== 'peer_left')
  ) {
    throw new Error(`Terminal decision ${decision.sessionId} is not a ranked forfeit.`);
  }
  return {
    sessionId: decision.sessionId,
    matchId: decision.sessionId,
    reason: decision.reason,
    forfeitingAccountId: decision.forfeitingAccountId,
    winnerAccountId: decision.winnerAccountId,
    participants: [
      { accountId: decision.participantP1AccountId, side: 'P1' },
      { accountId: decision.participantP2AccountId, side: 'P2' },
    ],
    resolvedAt: decision.dueAt,
    metadata: {
      source: 'ranked_terminal_decisions',
      dueAt: decision.dueAt,
      decidedAt: decision.decidedAt,
    },
  };
}

async function processRankedTerminalDecisionBatch(): Promise<void> {
  const claimed = await rankedTerminalDecisionStore.claimBatch();
  for (const decision of claimed) {
    const claimToken = decision.claimToken;
    if (!claimToken) {
      app.log.error({ sessionId: decision.sessionId }, 'Claimed terminal decision has no claim token.');
      continue;
    }
    try {
      if (decision.decisionType === 'no_contest') {
        const marked = await rankedTerminalDecisionStore.markSettled({
          sessionId: decision.sessionId,
          claimToken,
        });
        if (!marked) {
          app.log.warn(
            { sessionId: decision.sessionId },
            'No-contest terminal decision lease expired before completion.',
          );
          continue;
        }
        app.log.info({
          sessionId: decision.sessionId,
          reason: decision.reason,
        }, 'Recorded durable ranked no-contest decision.');
        continue;
      }

      const candidate = toAuthoritativeResolutionCandidate(decision);
      const result = await processRankedAuthoritativeResolution(db, candidate, rankedSettlementConfig);
      const marked = result.status === 'settled'
        ? await rankedTerminalDecisionStore.markSettled({
          sessionId: decision.sessionId,
          claimToken,
          settledMatchId: decision.sessionId,
        })
        : await rankedTerminalDecisionStore.markSuperseded({
          sessionId: decision.sessionId,
          claimToken,
        });
      if (!marked) {
        app.log.warn(
          { sessionId: decision.sessionId, resolutionId: result.resolutionId },
          'Ranked terminal decision lease expired after authoritative settlement.',
        );
        continue;
      }
      app.log.info({
        sessionId: decision.sessionId,
        resolutionId: result.resolutionId,
        status: result.status,
        reason: decision.reason,
      }, 'Processed authoritative ranked session resolution.');
    } catch (error) {
      const retryQueued = await rankedTerminalDecisionStore.markRetry({
        sessionId: decision.sessionId,
        claimToken,
        error,
      }).catch((retryError) => {
        app.log.error(
          { err: retryError, sessionId: decision.sessionId },
          'Failed to release ranked terminal decision lease for retry.',
        );
        return false;
      });
      app.log.error({
        err: error,
        sessionId: decision.sessionId,
        retryQueued,
      }, 'Failed to process ranked terminal decision.');
    }
  }
}

function scheduleRankedTerminalDecisionProcessing(): Promise<void> {
  const processing = rankedTerminalDecisionProcessingChain
    .catch(() => undefined)
    .then(() => processRankedTerminalDecisionBatch())
    .catch((error) => {
      app.log.error({ err: error }, 'Failed to claim ranked terminal decisions.');
    });
  rankedTerminalDecisionProcessingChain = processing;
  return processing;
}

function captureMatchmakingState(): MatchmakingQueueSnapshot {
  return {
    ...matchmakingQueueService.exportSnapshot(),
    serviceDraining: matchmakingDraining,
  };
}

function persistMatchmakingSnapshot(
  snapshot: MatchmakingQueueSnapshot,
  lease: MatchmakingRuntimeLease,
): Promise<void> {
  const fingerprint = fingerprintMatchmakingRuntimeSnapshot(snapshot);
  const decisions = [...pendingRankedTerminalDecisions.values()];
  const checkpoint = matchmakingPersistenceChain
    .catch(() => undefined)
    .then(async () => {
      lease.assertActive();
      const client = lease.database;
      try {
        await client.query('BEGIN');
        await matchmakingRuntimeStateStore.save(snapshot, lease.fenceToken, client);
        await matchmakingSessionAccessStore.replaceFromSnapshot(snapshot, client);
        for (const decision of decisions) {
          await rankedTerminalDecisionStore.enqueue(client, decision);
        }
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original checkpoint error if the connection was also lost.
        }
        throw error;
      }
      lastPersistedMatchmakingFingerprint = fingerprint;
      for (const decision of decisions) {
        if (pendingRankedTerminalDecisions.get(decision.sessionId) === decision) {
          pendingRankedTerminalDecisions.delete(decision.sessionId);
        }
      }
      await scheduleRankedTerminalDecisionProcessing();
    });
  matchmakingPersistenceChain = checkpoint;
  return checkpoint;
}

function persistMatchmakingState(lease: MatchmakingRuntimeLease): Promise<void> {
  return persistMatchmakingSnapshot(captureMatchmakingState(), lease);
}

async function persistMatchmakingStateIfChanged(lease: MatchmakingRuntimeLease): Promise<void> {
  await matchmakingPersistenceChain.catch(() => undefined);
  lease.assertActive();
  const snapshot = captureMatchmakingState();
  if (
    fingerprintMatchmakingRuntimeSnapshot(snapshot) === lastPersistedMatchmakingFingerprint
    && pendingRankedTerminalDecisions.size === 0
  ) {
    return;
  }
  await persistMatchmakingSnapshot(snapshot, lease);
}

async function restoreMatchmakingState(lease: MatchmakingRuntimeLease): Promise<void> {
  lease.assertActive();
  const snapshot = await matchmakingRuntimeStateStore.load(lease.database);
  if (!snapshot) {
    await matchmakingSessionAccessStore.replaceFromSnapshot({
      version: 1,
      capturedAtMs: Date.now(),
      serviceDraining: false,
      tickets: [],
      sessions: [],
    }, lease.database);
    app.log.info('No persisted matchmaking runtime snapshot found.');
    return;
  }
  applyMatchmakingSnapshot(snapshot);
  await persistMatchmakingState(lease);
  app.log.info({
    tickets: snapshot.tickets.length,
    sessions: snapshot.sessions.length,
    capturedAt: new Date(snapshot.capturedAtMs).toISOString(),
  }, 'Restored persisted matchmaking runtime state.');
}

function applyMatchmakingSnapshot(snapshot: MatchmakingQueueSnapshot): void {
  matchmakingDraining = snapshot.serviceDraining === true;
  queuePersistedRankedTerminalDecisions(snapshot);
  matchmakingQueueService.restoreSnapshot(snapshot);
  for (const session of matchmakingQueueService.getResolvedSessions()) {
    queueRankedTerminalDecision(session);
  }
}

async function refreshMatchmakingState(lease: MatchmakingRuntimeLease): Promise<void> {
  lease.assertActive();
  const snapshot = await matchmakingRuntimeStateStore.load(lease.database);
  lastPersistedMatchmakingFingerprint = snapshot
    ? fingerprintMatchmakingRuntimeSnapshot(snapshot)
    : null;
  if (snapshot) {
    applyMatchmakingSnapshot(snapshot);
  }
}

function requireMatchmakingRuntimeLease(request: object): MatchmakingRuntimeLease {
  const state = matchmakingRuntimeLeaseByRequest.get(request);
  if (!state || state.finalization) {
    throw new Error('Matchmaking request no longer owns the runtime lease.');
  }
  state.lease.assertActive();
  return state.lease;
}

async function finalizeMatchmakingRuntimeLease(request: object): Promise<void> {
  const state = matchmakingRuntimeLeaseByRequest.get(request);
  if (!state) {
    return;
  }
  if (!state.finalization) {
    state.finalization = (async () => {
      try {
        await persistMatchmakingStateIfChanged(state.lease);
      } finally {
        matchmakingRuntimeLeaseByRequest.delete(request);
        await state.lease.release();
      }
    })();
  }
  await state.finalization;
}

app.addHook('onRequest', async (request, reply) => {
  if (!requestUsesMatchmakingRuntime(request.url)) {
    return;
  }
  let lease: MatchmakingRuntimeLease | null = null;
  try {
    lease = await matchmakingRuntimeCoordinator.acquire();
    matchmakingRuntimeLeaseByRequest.set(request, { lease, finalization: null });
    await refreshMatchmakingState(lease);
  } catch (error) {
    if (lease) {
      matchmakingRuntimeLeaseByRequest.delete(request);
      await lease.release();
    }
    if (error instanceof MatchmakingRuntimeLockTimeoutError) {
      (request as { _excludeFromSloAvailability?: boolean })._excludeFromSloAvailability = true;
      reply.header('retry-after', '1');
      await reply.code(503).send({
        error: 'Matchmaking runtime is busy. Retry this request.',
        code: 'matchmaking_runtime_busy',
      });
      return;
    }
    throw error;
  }
});

app.addHook('onSend', async (request, _reply, payload) => {
  await finalizeMatchmakingRuntimeLease(request);
  return payload;
});

app.addHook('onResponse', async (request) => {
  try {
    await finalizeMatchmakingRuntimeLease(request);
  } catch (error) {
    request.log.error({ err: error }, 'Failed to finalize matchmaking runtime lease after response.');
  }
});

app.addHook('onRequestAbort', async (request) => {
  try {
    await finalizeMatchmakingRuntimeLease(request);
  } catch (error) {
    request.log.error({ err: error }, 'Failed to finalize matchmaking runtime lease after request abort.');
  }
});

function isAllowedCorsOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return true;
  }
  return allowedOrigins.some((allowedOrigin) => {
    if (!allowedOrigin.endsWith(':*')) {
      return false;
    }
    const prefix = allowedOrigin.slice(0, -1);
    return origin.startsWith(prefix);
  });
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

function parseOptionalCharacterId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  return trimmed;
}

function parseFrameAxis(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(-1, Math.min(1, value));
}

function parseFrameButton(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseRelayPlayerFrameInput(value: unknown): RelayPlayerFrameInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const moveX = parseFrameAxis(record.moveX);
  const moveY = parseFrameAxis(record.moveY);
  const boost = parseFrameButton(record.boost);
  const superBoost = parseFrameButton(record.superBoost);
  const special = parseFrameButton(record.special);
  const launch = parseFrameButton(record.launch);
  const dunk = parseFrameButton(record.dunk);
  const parry = parseFrameButton(record.parry);
  const breakLaunch = parseFrameButton(record.breakLaunch);
  if (
    moveX === null
    || moveY === null
    || boost === null
    || superBoost === null
    || special === null
    || launch === null
    || dunk === null
    || parry === null
    || breakLaunch === null
  ) {
    return null;
  }
  return {
    moveX,
    moveY,
    boost,
    superBoost,
    special,
    launch,
    dunk,
    parry,
    breakLaunch,
  };
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
    case 'participant_disconnected':
      return 409;
    case 'replayed_attempt':
    case 'stale_transport_attempt':
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

async function withRepeatableReadSnapshot<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    const result = await operation(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the query error if the connection also fails during rollback.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function getHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function getMatchSessionToken(headers: Record<string, unknown>): string {
  return getHeaderValue(
    headers['x-match-session-token'] as string | string[] | undefined,
  ).trim();
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

app.addHook('preHandler', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    return;
  }
  const accountStatus = await resolveAccountAuthorizationStatus(db, accountId);
  if (accountStatus === 'missing') {
    return reply.code(401).send({
      error: 'Authenticated account no longer exists.',
      code: 'account_missing',
    });
  }
  if (accountStatus === 'disabled') {
    return reply.code(403).send({
      error: 'Authenticated account is disabled.',
      code: 'account_disabled',
    });
  }
});

app.get('/health', async () => ({
  ok: true,
  databaseTarget,
  releaseSha,
  matchmakingRuntimeCoordination: MATCHMAKING_RUNTIME_COORDINATION_MODE,
  matchmakingRuntimeNamespace,
}));

app.get('/readyz', async (_request, reply) => {
  try {
    const [databaseResult, migrationResult] = await Promise.all([
      db.query<{ connected: number }>('SELECT 1::int AS connected'),
      db.query<{ filename: string; checksum: string | null }>(
        'SELECT filename, checksum FROM schema_migrations ORDER BY filename ASC',
      ),
    ]);
    const databaseConnected = databaseResult.rows[0]?.connected === 1;
    const migrationHead = migrationResult.rows.at(-1)?.filename ?? null;
    const migrationCount = migrationResult.rows.length;
    const migrationChecksumsVerified = migrationResult.rows.length > 0
      && migrationResult.rows.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum ?? ''));
    const ok = databaseConnected && migrationHead !== null && migrationChecksumsVerified;
    if (!ok) {
      reply.code(503);
    }
    return {
      ok,
      databaseTarget,
      deploymentEnvironment,
      databaseId: deploymentDatabaseId,
      releaseSha,
      migrationHead,
      migrationCount,
      migrationChecksumsVerified,
      replayBlobProvider: replayBlobStore.provider,
      replayBlobDurable: replayBlobStore.durable,
      matchmakingRuntimeCoordination: MATCHMAKING_RUNTIME_COORDINATION_MODE,
      matchmakingRuntimeNamespace,
    };
  } catch (error) {
    app.log.warn({ err: error }, 'Readiness database check failed.');
    reply.code(503);
    return {
      ok: false,
      databaseTarget,
      deploymentEnvironment,
      databaseId: deploymentDatabaseId,
      releaseSha,
      migrationHead: null,
      migrationCount: 0,
      migrationChecksumsVerified: false,
      replayBlobProvider: replayBlobStore.provider,
      replayBlobDurable: replayBlobStore.durable,
      matchmakingRuntimeCoordination: MATCHMAKING_RUNTIME_COORDINATION_MODE,
      matchmakingRuntimeNamespace,
    };
  }
});

app.post('/accounts', async (request, reply) => {
  const rateLimitRejection = await enforceAuthRateLimits(request, reply, [
    buildAuthRateLimitRule('auth_global_source', request.ip, authRateLimitPolicies.globalSource),
    buildAuthRateLimitRule('guest_create_source', request.ip, authRateLimitPolicies.guestSource),
  ]);
  if (rateLimitRejection) {
    return rateLimitRejection;
  }
  const status = 'active';
  const result = await db.query(
    `INSERT INTO accounts(status) VALUES ($1) RETURNING id, status, created_at, updated_at`,
    [status],
  );
  const account = result.rows[0] as { id: string; status: string; created_at: string; updated_at: string };
  reply.code(201);
  return {
    ...account,
    ...(account.status === 'active' ? authSessionTokenService.issue(account.id, 'guest') : {}),
  };
});

app.get('/accounts/:accountId', async (request, reply) => {
  const params = request.params as { accountId?: string };
  if (!isUuid(params.accountId)) {
    reply.code(400);
    return { error: 'Invalid account id.' };
  }
  const actorAccountId = getAuthenticatedAccountId(request);
  if (actorAccountId !== params.accountId && !isAuthIdentityAdmin(request)) {
    reply.code(403);
    return { error: 'Only the authenticated account can read its account record.' };
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
  const adminRejection = requireAuthIdentityAdmin(request, reply);
  if (adminRejection) {
    return adminRejection;
  }
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
  const actor = getHeaderValue(request.headers['x-admin-actor']).trim().slice(0, 128)
    || 'auth_identity_admin';

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
  const adminRejection = requireAuthIdentityAdmin(request, reply);
  if (adminRejection) {
    return adminRejection;
  }
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
  const rateLimitRejection = await enforceAuthRateLimits(request, reply, [
    buildAuthRateLimitRule('auth_global_source', request.ip, authRateLimitPolicies.globalSource),
    buildAuthRateLimitRule('web_signup_source', request.ip, authRateLimitPolicies.webSignupSource),
    ...(email ? [buildAuthRateLimitRule(
      'web_signup_principal',
      email,
      authRateLimitPolicies.webSignupPrincipal,
    )] : []),
  ]);
  if (rateLimitRejection) {
    return rateLimitRejection;
  }
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
  if (!accountId) {
    throw new Error('Web sign-up completed without an account id.');
  }
  const sessionToken = authSessionTokenService.issue(accountId, 'web');
  reply.code(201);
  return {
    accountId,
    email,
    upgradedFromGuest,
    provider: 'web',
    ...sessionToken,
    nextAction: 'Use /auth/web/signin to restore sessions on another device.',
  };
});

app.post('/auth/web/signin', async (request, reply) => {
  const body = (request.body ?? {}) as WebSigninBody;
  const email = normaliseWebEmail(body.email);
  const rateLimitRejection = await enforceAuthRateLimits(request, reply, [
    buildAuthRateLimitRule('auth_global_source', request.ip, authRateLimitPolicies.globalSource),
    ...(email ? [buildAuthRateLimitRule(
      'web_signin_principal',
      email,
      authRateLimitPolicies.webSigninPrincipal,
    )] : []),
  ]);
  if (rateLimitRejection) {
    return rateLimitRejection;
  }
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

  await authRateLimiter.clear('web_signin_principal', email).catch((error) => {
    request.log.warn({ err: error }, 'Failed to clear successful web sign-in rate-limit bucket.');
  });

  const sessionToken = authSessionTokenService.issue(row.account_id, 'web');

  return {
    accountId: row.account_id,
    displayName: row.display_name,
    provider: 'web',
    isAuthenticated: true,
    ...sessionToken,
  };
});

app.post('/auth/steam/exchange', async (request, reply) => {
  const body = (request.body ?? {}) as SteamExchangeBody;
  const steamTicketSubject = typeof body.steamTicket === 'string'
    ? body.steamTicket.trim().toLowerCase()
    : '';
  const rateLimitRejection = await enforceAuthRateLimits(request, reply, [
    buildAuthRateLimitRule('auth_global_source', request.ip, authRateLimitPolicies.globalSource),
    buildAuthRateLimitRule('steam_exchange_source', request.ip, authRateLimitPolicies.steamSource),
    ...(steamTicketSubject ? [buildAuthRateLimitRule(
      'steam_exchange_ticket',
      steamTicketSubject,
      authRateLimitPolicies.steamTicket,
    )] : []),
  ]);
  if (rateLimitRejection) {
    return rateLimitRejection;
  }
  if (body.mergeAccountId !== undefined) {
    reply.code(400);
    return {
      error: 'Automatic account merging is no longer supported.',
      code: 'automatic_account_merge_removed',
      recovery: 'Authenticate the account to keep and resend with linkToAuthenticatedAccount=true.',
    };
  }
  if (
    body.linkToAuthenticatedAccount !== undefined
    && typeof body.linkToAuthenticatedAccount !== 'boolean'
  ) {
    reply.code(400);
    return { error: 'linkToAuthenticatedAccount must be a boolean when provided.' };
  }
  const linkToAuthenticatedAccount = body.linkToAuthenticatedAccount === true;
  const authenticatedAccountId = getAuthenticatedAccountId(request);
  if (linkToAuthenticatedAccount && !authenticatedAccountId) {
    reply.code(401);
    return {
      error: 'Steam identity linking requires an authenticated target account.',
      code: 'steam_link_authentication_required',
    };
  }
  if (authenticatedAccountId && !linkToAuthenticatedAccount) {
    reply.code(409);
    return {
      error: 'An authenticated account must explicitly confirm Steam identity linking.',
      code: 'steam_link_confirmation_required',
      recovery: 'Resend with linkToAuthenticatedAccount=true to keep the authenticated account.',
    };
  }
  const ticketValidation = await steamTicketVerifier.verify(body.steamTicket);
  if (!ticketValidation.ok) {
    const statusCode = ticketValidation.code === 'invalid_request'
      ? 400
      : ticketValidation.code === 'invalid_ticket'
        ? 401
        : 503;
    reply.code(statusCode);
    return {
      error: ticketValidation.error,
      recovery: ticketValidation.code === 'invalid_ticket'
        ? 'Retry Steam sign-in and submit a fresh ticket.'
        : ticketValidation.code === 'invalid_request'
          ? 'Request a GetAuthTicketForWebApi ticket with the configured service identity.'
          : 'Keep the current Steam session and retry after server verification recovers.',
    };
  }
  const steamUserId = ticketValidation.steamUserId;
  const displayName = normaliseDisplayName(body.displayName);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const linkResult = await resolveSteamAccountLink(client, {
      steamUserId,
      authenticatedAccountId,
      linkToAuthenticatedAccount,
    });
    const accountId = linkResult.accountId;

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
      eventType: linkResult.linkedToExistingAccount
        ? 'upgrade'
        : (linkResult.createdAccount ? 'signup' : 'signin'),
      emailNormalised: `steam:${steamUserId}`,
      reason: linkResult.linkedToExistingAccount ? 'explicit_identity_link' : null,
    });

    return {
      accountId,
      provider: 'steam',
      steamUserId,
      createdAccount: linkResult.createdAccount,
      linkedToExistingAccount: linkResult.linkedToExistingAccount,
      identityAlreadyLinked: linkResult.identityAlreadyLinked,
      isAuthenticated: true,
      ...authSessionTokenService.issue(accountId, 'steam'),
    };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Steam token exchange failed.';
    if (linkToAuthenticatedAccount && authenticatedAccountId) {
      await logIdentityLinkEvent(db, {
        accountId: authenticatedAccountId,
        provider: 'steam',
        providerUserId: steamUserId,
        eventType: 'link_failed',
        actor: authenticatedAccountId,
        metadata: {
          reason: error instanceof SteamAccountLinkError ? error.code : 'steam_link_failed',
        },
      }).catch((auditError) => {
        request.log.warn({ err: auditError }, 'Failed to record Steam identity link failure.');
      });
    }
    await logAccountAuthEvent({
      accountId: authenticatedAccountId,
      provider: 'steam',
      eventType: 'signin_failed',
      emailNormalised: `steam:${steamUserId}`,
      reason: message,
    });
    if (error instanceof SteamAccountLinkError) {
      switch (error.code) {
        case 'steam_linked_account_disabled':
          reply.code(403);
          return {
            error: error.message,
            code: error.code,
            recovery: 'Contact support to restore account access.',
          };
        case 'steam_identity_already_linked':
          reply.code(409);
          return {
            error: error.message,
            code: error.code,
            recovery: 'Sign in to the already-linked account or contact support. No account data was moved.',
          };
        case 'steam_link_target_not_found':
          reply.code(404);
          return { error: error.message, code: error.code };
        case 'steam_link_target_disabled':
          reply.code(409);
          return {
            error: error.message,
            code: error.code,
            recovery: 'Contact support to re-enable the account before linking Steam.',
          };
        case 'steam_link_target_already_has_identity':
          reply.code(409);
          return {
            error: error.message,
            code: error.code,
            recovery: 'Unlink the existing Steam identity before linking another.',
          };
        case 'steam_link_authentication_required':
          reply.code(401);
          return { error: error.message, code: error.code };
      }
    }
    if (message.includes('identities_provider_provider_user_id_key')) {
      reply.code(409);
      return {
        error: 'Steam identity is already linked to another account.',
        code: 'steam_identity_already_linked',
        recovery: 'Sign in to the already-linked account or contact support. No account data was moved.',
      };
    }
    if (message.includes('identities_account_id_provider_key')) {
      reply.code(409);
      return {
        error: 'This account already has a linked Steam identity.',
        code: 'steam_link_target_already_has_identity',
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

app.get('/matchmaking/access/status', async () => matchmakingAccessPolicy.getStatus());

app.get('/matchmaking/network/status', async () => matchmakingNetworkConfigService.getStatus());

app.post('/matchmaking/network/ice-config', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid authentication.' };
  }
  const body = (request.body ?? {}) as MatchmakingIceConfigBody;
  if (!isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }
  if (body.forceRelay !== undefined && typeof body.forceRelay !== 'boolean') {
    reply.code(400);
    return { error: 'forceRelay must be a boolean when provided.' };
  }
  requireMatchmakingRuntimeLease(request);
  const sessionValidation = matchmakingQueueService.validateSessionToken(
    body.sessionId,
    accountId,
    sessionToken,
  );
  if (!sessionValidation.ok) {
    reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
    return { error: sessionValidation.error.message, code: sessionValidation.error.code };
  }
  return matchmakingNetworkConfigService.issueConfig(accountId, { forceRelay: body.forceRelay === true });
});

app.post('/matchmaking/queue/join', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (matchmakingDraining) {
    (request as { _excludeFromSloAvailability?: boolean })._excludeFromSloAvailability = true;
    reply.header('retry-after', '15');
    reply.code(503);
    return {
      error: 'Matchmaking is temporarily paused for a service deployment.',
      code: 'matchmaking_draining',
    };
  }

  const body = (request.body ?? {}) as MatchmakingQueueJoinBody;
  const buildVersion = typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null;
  const accessDecision = matchmakingAccessPolicy.evaluate(accountId, buildVersion);
  if (!accessDecision.allowed) {
    reply.code(403);
    return {
      error: getMatchmakingAccessError(accessDecision.code),
      code: accessDecision.code,
    };
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
  // A drain can begin while this request awaits account/rating queries.
  if (matchmakingDraining) {
    (request as { _excludeFromSloAvailability?: boolean })._excludeFromSloAvailability = true;
    reply.header('retry-after', '15');
    reply.code(503);
    return {
      error: 'Matchmaking is temporarily paused for a service deployment.',
      code: 'matchmaking_draining',
    };
  }
  const rulesetVersion = typeof body.rulesetVersion === 'string' ? body.rulesetVersion.trim() : null;
  const balanceProfileId = typeof body.balanceProfileId === 'string' ? body.balanceProfileId.trim() : null;
  const selectedCharacterId = parseOptionalCharacterId(body.characterId);
  if (queueType === 'ranked' && !buildVersion) {
    reply.code(400);
    return { error: 'buildVersion is required for ranked matchmaking.' };
  }
  if (queueType === 'ranked' && !rulesetVersion) {
    reply.code(400);
    return { error: 'rulesetVersion is required for ranked matchmaking.' };
  }
  if (queueType === 'ranked' && !balanceProfileId) {
    reply.code(400);
    return { error: 'balanceProfileId is required for ranked matchmaking.' };
  }
  if (queueType === 'ranked' && !rankedSupportedRulesetVersions.has(rulesetVersion as string)) {
    reply.code(409);
    return { error: 'rulesetVersion is not supported for ranked verification.' };
  }
  if (queueType === 'ranked' && getRankedTuningFingerprint(balanceProfileId as string) === null) {
    reply.code(409);
    return { error: 'balanceProfileId is not supported for ranked verification.' };
  }
  if (queueType === 'ranked' && (!selectedCharacterId || !CHARACTER_BY_ID[selectedCharacterId])) {
    reply.code(400);
    return { error: 'characterId must identify a supported ranked character.' };
  }
  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const existingTicket = matchmakingQueueService.getActiveTicketForAccountQueue(
    accountId,
    queueType,
  );
  let ticket: ReturnType<typeof matchmakingQueueService.join>;
  try {
    ticket = matchmakingQueueService.join({
      accountId,
      queueType,
      regionPreferences,
      playerMetadata: {
        displayName,
        buildVersion,
        rulesetVersion,
        balanceProfileId,
        platform: body.platform === 'steam' || body.platform === 'web' ? body.platform : null,
        selectedCharacterId,
        rankedSnapshot,
      },
    });
  } catch (error) {
    if (error instanceof MatchmakingCapacityError) {
      (request as { _excludeFromSloAvailability?: boolean })._excludeFromSloAvailability = true;
      reply.header('retry-after', '15');
      reply.code(503);
      return {
        error: 'Matchmaking is temporarily at controlled-alpha capacity.',
        code: error.code,
        maxResidentTickets: error.maxResidentTickets,
      };
    }
    throw error;
  }
  await persistMatchmakingState(runtimeLease);

  reply.code(201);
  return {
    ...ticket,
    joinDisposition: existingTicket ? 'existing' : 'created',
  };
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

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const ticket = matchmakingQueueService.getTicketForAccount(params.ticketId, accountId);
  await persistMatchmakingState(runtimeLease);
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

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const ticket = matchmakingQueueService.leaveTicket(body.ticketId, accountId);
  await persistMatchmakingState(runtimeLease);
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

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const session = matchmakingQueueService.getSessionForAccount(params.sessionId, accountId);
  await persistMatchmakingState(runtimeLease);
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

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const result = matchmakingQueueService.markSessionDisconnected(body.sessionId, accountId);
  await persistMatchmakingState(runtimeLease);
  if (!result.ok) {
    reply.code(mapSessionErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/matchmaking/sessions/heartbeat', async (request, reply) => {
  // High-frequency liveness traffic is intentionally excluded from the
  // durable per-request SLO table to avoid one PostgreSQL write per pulse.
  (request as { _excludeFromSloAvailability?: boolean })._excludeFromSloAvailability = true;
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as MatchmakingSessionHeartbeatBody;
  if (!isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const result = matchmakingQueueService.heartbeatSession(body.sessionId, accountId, sessionToken);
  await persistMatchmakingState(runtimeLease);
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

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const result = matchmakingQueueService.reconnectSession({
    sessionId: body.sessionId,
    accountId,
    sessionToken,
    reconnectAttemptId,
  });
  await persistMatchmakingState(runtimeLease);
  if (!result.ok) {
    reply.code(mapSessionErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/matchmaking/sessions/complete', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const body = (request.body ?? {}) as MatchmakingSessionCompleteBody;
  if (!isUuid(body.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const result = matchmakingQueueService.completeSession(body.sessionId, accountId, sessionToken);
  await persistMatchmakingState(runtimeLease);
  if (!result.ok) {
    reply.code(mapSessionErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  return result.value;
});

app.post('/matchmaking/sessions/:sessionId/transport-attempts', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const body = (request.body ?? {}) as MatchmakingSessionTransportAttemptBody;
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }
  if (!Number.isSafeInteger(body.expectedGeneration) || Number(body.expectedGeneration) < 1) {
    reply.code(400);
    return { error: 'expectedGeneration must be a positive safe integer.' };
  }

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const result = matchmakingQueueService.advanceTransportAttempt({
    sessionId: params.sessionId,
    accountId,
    sessionToken,
    expectedGeneration: Number(body.expectedGeneration),
  });
  await persistMatchmakingState(runtimeLease);
  if (!result.ok) {
    reply.code(mapSessionErrorToHttp(result.error.code));
    return { error: result.error.message, code: result.error.code };
  }
  await sessionSignalStore.clearSupersededAttempts(
    params.sessionId,
    result.value.transportAttempt.attemptId,
  );
  return result.value;
});

app.post('/matchmaking/sessions/:sessionId/signals', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const body = (request.body ?? {}) as MatchmakingSessionSignalSubmitBody;
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }

  const transportAttemptId = String(body.transportAttemptId ?? '').trim();
  if (!isUuid(transportAttemptId)) {
    reply.code(400);
    return { error: 'transportAttemptId is required and must be a UUID.' };
  }
  const sessionAccess = await matchmakingSessionAccessStore.validateSignalAccess({
    sessionId: params.sessionId,
    accountId,
    sessionToken,
    transportAttemptId,
  });
  if (!sessionAccess.ok) {
    reply.code(mapSessionErrorToHttp(sessionAccess.error.code));
    return { error: sessionAccess.error.message, code: sessionAccess.error.code };
  }
  if (!isSessionSignalType(body.signalType)) {
    reply.code(400);
    return { error: 'signalType must be offer, answer, ice_candidate, or end_of_candidates.' };
  }

  try {
    const signal = await sessionSignalStore.publishSignal({
      sessionId: params.sessionId,
      transportAttemptId,
      senderAccountId: accountId,
      recipientAccountId: sessionAccess.value.peerAccountId,
      clientMessageId: String(body.clientMessageId ?? ''),
      type: body.signalType,
      payload: body.payload as SessionSignalJson,
    });
    return {
      signalId: signal.signalId,
      createdAt: signal.createdAt,
      expiresAt: signal.expiresAt,
    };
  } catch (error) {
    if (error instanceof SessionSignalConflictError) {
      reply.code(409);
      return { error: error.message, code: 'signal_id_conflict' };
    }
    if (error instanceof SessionSignalQuotaExceededError) {
      reply.code(429);
      return {
        error: error.message,
        code: 'signal_quota_exceeded',
        quotaScope: error.scope,
        recovery: 'Start a fresh transport attempt or wait for the signaling mailbox to expire.',
      };
    }
    if (error instanceof TypeError) {
      reply.code(400);
      return { error: error.message };
    }
    throw error;
  }
});

app.get('/matchmaking/sessions/:sessionId/signals', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const query = (request.query ?? {}) as MatchmakingSessionSignalsQuery;
  const sessionToken = getMatchSessionToken(request.headers);
  if (!sessionToken) {
    reply.code(400);
    return { error: 'x-match-session-token header is required.' };
  }

  const transportAttemptId = String(query.transportAttemptId ?? '').trim();
  if (!isUuid(transportAttemptId)) {
    reply.code(400);
    return { error: 'transportAttemptId is required and must be a UUID.' };
  }
  const sessionAccess = await matchmakingSessionAccessStore.validateSignalAccess({
    sessionId: params.sessionId,
    accountId,
    sessionToken,
    transportAttemptId,
  });
  if (!sessionAccess.ok) {
    reply.code(mapSessionErrorToHttp(sessionAccess.error.code));
    return { error: sessionAccess.error.message, code: sessionAccess.error.code };
  }

  try {
    const result = await sessionSignalStore.readPeerSignals({
      sessionId: params.sessionId,
      transportAttemptId,
      recipientAccountId: accountId,
      afterSignalId: query.afterSignalId ?? '0',
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
    return {
      signals: result.signals.map((signal) => ({
        signalId: signal.signalId,
        transportAttemptId: signal.transportAttemptId,
        senderAccountId: signal.senderAccountId,
        signalType: signal.type,
        payload: signal.payload,
        createdAt: signal.createdAt,
      })),
      nextAfterSignalId: result.nextAfterSignalId,
    };
  } catch (error) {
    if (error instanceof TypeError) {
      reply.code(400);
      return { error: error.message };
    }
    throw error;
  }
});

app.post('/matchmaking/sessions/:sessionId/frames', async (request, reply) => {
  if (!legacyHttpFrameRelayEnabled) {
    reply.code(404);
    return { error: 'Legacy HTTP frame relay is disabled; use the negotiated WebRTC DataChannel.' };
  }
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }

  const body = (request.body ?? {}) as MatchmakingSessionFramesSubmitBody;
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }
  const frames = Array.isArray(body.frames) ? body.frames : [];
  if (frames.length === 0 || frames.length > 30) {
    reply.code(400);
    return { error: 'frames must contain between 1 and 30 entries.' };
  }

  requireMatchmakingRuntimeLease(request);
  const sessionValidation = matchmakingQueueService.validateSessionToken(
    params.sessionId,
    accountId,
    sessionToken,
    { allowResolved: true },
  );
  if (!sessionValidation.ok) {
    reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
    return { error: sessionValidation.error.message, code: sessionValidation.error.code };
  }

  const parsedFrames: Array<{ epoch: number; frame: number; input: RelayPlayerFrameInput }> = [];
  for (const item of frames) {
    const epoch = Number(item?.epoch ?? 0);
    if (!Number.isInteger(epoch) || epoch < 0) {
      reply.code(400);
      return { error: 'Each frame entry requires a non-negative integer epoch.' };
    }
    const frame = Number(item?.frame);
    if (!Number.isInteger(frame) || frame < 0) {
      reply.code(400);
      return { error: 'Each frame entry requires a non-negative integer frame id.' };
    }
    const input = parseRelayPlayerFrameInput(item?.input);
    if (!input) {
      reply.code(400);
      return { error: 'Each frame entry requires a valid input payload.' };
    }
    parsedFrames.push({ epoch, frame, input });
  }

  liveSessionFrameRelay.submitFrames({
    sessionId: params.sessionId,
    accountId,
    frames: parsedFrames,
  });
  return { acceptedFrames: parsedFrames.length };
});

app.post('/matchmaking/sessions/:sessionId/frames/confirm', async (request, reply) => {
  if (!legacyHttpFrameRelayEnabled) {
    reply.code(404);
    return { error: 'Legacy HTTP frame relay is disabled; use the negotiated WebRTC DataChannel.' };
  }
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }

  const body = (request.body ?? {}) as MatchmakingSessionFramesConfirmBody;
  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    reply.code(400);
    return { error: 'sessionToken is required.' };
  }
  const epoch = Number(body.epoch ?? 0);
  if (!Number.isInteger(epoch) || epoch < 0) {
    reply.code(400);
    return { error: 'epoch must be a non-negative integer.' };
  }
  const confirmedThrough = Number(body.confirmedThrough ?? -1);
  if (!Number.isInteger(confirmedThrough) || confirmedThrough < -1) {
    reply.code(400);
    return { error: 'confirmedThrough must be an integer greater than or equal to -1.' };
  }

  requireMatchmakingRuntimeLease(request);
  const sessionValidation = matchmakingQueueService.validateSessionToken(
    params.sessionId,
    accountId,
    sessionToken,
    { allowResolved: true },
  );
  if (!sessionValidation.ok) {
    reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
    return { error: sessionValidation.error.message, code: sessionValidation.error.code };
  }

  return {
    epoch,
    confirmedThrough: liveSessionFrameRelay.confirmPeerFrames(
      params.sessionId,
      accountId,
      epoch,
      confirmedThrough,
    ),
  };
});

app.get('/matchmaking/sessions/:sessionId/frames', async (request, reply) => {
  if (!legacyHttpFrameRelayEnabled) {
    reply.code(404);
    return { error: 'Legacy HTTP frame relay is disabled; use the negotiated WebRTC DataChannel.' };
  }
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }

  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }

  const query = (request.query ?? {}) as MatchmakingSessionFramesQuery;
  const sessionToken = getMatchSessionToken(request.headers);
  if (!sessionToken) {
    reply.code(400);
    return { error: 'x-match-session-token header is required.' };
  }
  const epochRaw = query.epoch ?? '0';
  const epoch = Number(epochRaw);
  if (!Number.isInteger(epoch) || epoch < 0) {
    reply.code(400);
    return { error: 'epoch must be a non-negative integer.' };
  }
  const sinceFrameRaw = query.sinceFrame ?? '-1';
  const sinceFrame = Number(sinceFrameRaw);
  if (!Number.isInteger(sinceFrame) || sinceFrame < -1) {
    reply.code(400);
    return { error: 'sinceFrame must be an integer greater than or equal to -1.' };
  }

  requireMatchmakingRuntimeLease(request);
  const sessionValidation = matchmakingQueueService.validateSessionToken(
    params.sessionId,
    accountId,
    sessionToken,
    { allowResolved: true },
  );
  if (!sessionValidation.ok) {
    reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
    return { error: sessionValidation.error.message, code: sessionValidation.error.code };
  }

  return liveSessionFrameRelay.getPeerFrames(params.sessionId, accountId, epoch, sinceFrame);
});

app.post('/ranked/results', { bodyLimit: RANKED_PROOF_BODY_LIMIT_BYTES }, async (request, reply) => {
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

  requireMatchmakingRuntimeLease(request);
  const sessionValidation = matchmakingQueueService.validateSessionToken(body.sessionId, accountId, sessionToken, {
    allowResolved: true,
    allowExpiredToken: true,
  });
  if (!sessionValidation.ok) {
    reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
    return { error: sessionValidation.error.message, code: sessionValidation.error.code };
  }
  if (sessionValidation.value.queueType !== 'ranked') {
    reply.code(409);
    return { error: 'Session is not a ranked queue session.' };
  }
  const terminalDecision = await rankedTerminalDecisionStore.getBySession(body.sessionId);
  if (terminalDecision) {
    reply.code(409);
    return {
      error: terminalDecision.decisionType === 'no_contest'
        ? 'Ranked session ended as a server-owned no-contest.'
        : 'Ranked session has a server-owned authoritative resolution.',
      code: terminalDecision.decisionType === 'no_contest'
        ? 'ranked_session_no_contest'
        : 'ranked_session_authoritative_resolution',
      terminalStatus: terminalDecision.status,
      reason: terminalDecision.reason,
    };
  }

  const existingAccountSubmission = await db.query(
    `
    SELECT 1
    FROM ranked_result_submissions
    WHERE session_id = $1 AND submitted_by_account_id = $2
    LIMIT 1
    `,
    [body.sessionId, accountId],
  );
  if (existingAccountSubmission.rowCount) {
    reply.code(409);
    return { error: 'Ranked result was already submitted for this session by this account.' };
  }

  const p1Participant = sessionValidation.value.participants.find((participant) => participant.side === 'P1');
  const p2Participant = sessionValidation.value.participants.find((participant) => participant.side === 'P2');
  if (!p1Participant || !p2Participant) {
    reply.code(409);
    return { error: 'Session participants are invalid for ranked processing.' };
  }
  if (outcome === 'draw') {
    reply.code(422);
    return {
      error: 'Ranked draws are no-contest during the controlled alpha and do not change progression.',
      code: 'ranked_draw_no_contest',
    };
  }
  if (outcome === 'forfeit') {
    reply.code(422);
    return {
      error: 'Ranked forfeits are accepted only from the server-authoritative session resolver.',
      code: 'ranked_proof_required',
    };
  }
  const sessionBuildVersion = sessionValidation.value.buildVersion?.trim() ?? '';
  const sessionRulesetVersion = sessionValidation.value.rulesetVersion?.trim() ?? '';
  const sessionBalanceProfileId = sessionValidation.value.balanceProfileId?.trim() ?? '';
  const p1CharacterId = p1Participant.selectedCharacterId;
  const p2CharacterId = p2Participant.selectedCharacterId;
  if (
    !sessionBuildVersion
    || !sessionRulesetVersion
    || !sessionBalanceProfileId
    || !p1CharacterId
    || !p2CharacterId
    || !CHARACTER_BY_ID[p1CharacterId]
    || !CHARACTER_BY_ID[p2CharacterId]
  ) {
    reply.code(409);
    return {
      error: 'Ranked session is missing verifier-compatible build, ruleset, or loadout metadata.',
      code: 'ranked_session_not_verifiable',
    };
  }
  const rateLimitRejection = await enforceRankedProofRateLimits(
    request,
    reply,
    accountId,
    body.sessionId,
  );
  if (rateLimitRejection) {
    return rateLimitRejection;
  }
  const proofVerification = await verifyRankedMatchProof(body.proof, {
    sessionId: body.sessionId,
    matchId: body.matchId,
    buildVersion: sessionBuildVersion,
    rulesetVersion: sessionRulesetVersion,
    balanceProfileId: sessionBalanceProfileId,
    seed: rankedSeedFromSessionId(body.sessionId),
    loadout: {
      P1: p1CharacterId as CharacterId,
      P2: p2CharacterId as CharacterId,
    },
  });
  if (!proofVerification.ok) {
    reply.code(422);
    return {
      error: proofVerification.message,
      code: 'invalid_ranked_proof',
      proofErrorCode: proofVerification.code,
    };
  }
  if (proofVerification.derivedOutcome !== outcome) {
    reply.code(422);
    return {
      error: 'Submitted outcome does not match the server-replayed ranked proof.',
      code: 'ranked_outcome_mismatch',
    };
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
  const winnerAccountId = proofVerification.winnerSide === 'P1'
    ? p1Participant.accountId
    : p2Participant.accountId;
  if (winnerAccountIdRaw !== winnerAccountId) {
    reply.code(422);
    return {
      error: 'winnerAccountId does not match the server-replayed ranked proof.',
      code: 'ranked_winner_mismatch',
    };
  }
  const proofView = {
    digest: proofVerification.proofDigest,
    simulatorVersion: proofVerification.proof.simulatorVersion,
    roundCount: proofVerification.roundCount,
    frameCount: proofVerification.frameCount,
    derivedOutcome: proofVerification.derivedOutcome,
  };
  const reviewStatus = evaluation.suspicious ? 'pending' : 'none';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.sessionId]);
    await client.query(
      `
      INSERT INTO ranked_match_proofs(
        proof_digest, session_id, match_id, schema_version, simulator_version,
        build_version, ruleset_version, balance_profile_id, derived_outcome,
        winner_side, round_count, frame_count, payload_json
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13::jsonb
      )
      ON CONFLICT (proof_digest) DO NOTHING
      `,
      [
        proofVerification.proofDigest,
        body.sessionId,
        body.matchId,
        proofVerification.proof.schemaVersion,
        proofVerification.proof.simulatorVersion,
        proofVerification.proof.buildVersion,
        proofVerification.proof.rulesetVersion,
        proofVerification.proof.balanceProfileId,
        proofVerification.derivedOutcome,
        proofVerification.winnerSide,
        proofVerification.roundCount,
        proofVerification.frameCount,
        JSON.stringify(proofVerification.proof),
      ],
    );
    const submission = await client.query(
      `
      INSERT INTO ranked_result_submissions(
        session_id, match_id, queue_type, submitted_by_account_id,
        session_participants, submitted_participants, winner_account_id,
        outcome, valid_session_token, suspicious, suspicious_reasons,
        review_status, payload_json, proof_digest, proof_verification_status,
        derived_outcome
      )
      VALUES (
        $1, $2, 'ranked', $3,
        $4::uuid[], $5::uuid[], $6,
        $7, TRUE, $8, $9::text[],
        $10, $11::jsonb, $12, 'verified',
        $13
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
          proofDigest: proofVerification.proofDigest,
          verifiedRoundCount: proofVerification.roundCount,
          verifiedFrameCount: proofVerification.frameCount,
        }),
        proofVerification.proofDigest,
        proofVerification.derivedOutcome,
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
        proof: proofView,
      };
    }

    const peerSubmissionResult = await client.query(
      `
      SELECT submission_id, submitted_by_account_id, outcome, winner_account_id, proof_digest
      FROM ranked_result_submissions
      WHERE session_id = $1
        AND submitted_by_account_id <> $2
        AND suspicious = FALSE
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
      `,
      [body.sessionId, accountId],
    );
    if (!peerSubmissionResult.rowCount) {
      await client.query('COMMIT');
      reply.code(202);
      return {
        submissionId: row.submission_id,
        createdAt: row.created_at,
        status: 'awaiting_peer_confirmation',
        suspicious: false,
        suspiciousReasons: [],
        reviewStatus,
        proof: proofView,
      };
    }

    const peerSubmission = peerSubmissionResult.rows[0] as {
      submission_id: string;
      submitted_by_account_id: string;
      outcome: string;
      winner_account_id: string | null;
      proof_digest: string | null;
    };
    const consensus = evaluateRankedResultConsensus(
      {
        outcome: peerSubmission.outcome,
        winnerAccountId: peerSubmission.winner_account_id,
        proofDigest: peerSubmission.proof_digest,
      },
      {
        outcome,
        winnerAccountId,
        proofDigest: proofVerification.proofDigest,
      },
    );
    if (consensus.suspicious) {
      const consensusReasons = consensus.reasons;
      await client.query(
        `
        UPDATE ranked_result_submissions
        SET suspicious = TRUE,
            suspicious_reasons = $2::text[],
            review_status = 'pending'
        WHERE session_id = $1
        `,
        [body.sessionId, consensusReasons],
      );
      await client.query('COMMIT');
      reply.code(202);
      return {
        submissionId: row.submission_id,
        createdAt: row.created_at,
        status: 'flagged_for_review',
        suspicious: true,
        suspiciousReasons: consensusReasons,
        reviewStatus: 'pending',
        proof: proofView,
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

    const settlement = await settleRankedMatch(client, {
      matchId: body.matchId,
      sessionId: body.sessionId,
      participants: [
        { accountId: p1Participant.accountId, side: 'P1' },
        { accountId: p2Participant.accountId, side: 'P2' },
      ],
      outcome,
      winnerAccountId,
      occurredAtIso: row.created_at,
      source: {
        kind: 'player_consensus',
        submissionId: row.submission_id,
      },
      config: rankedSettlementConfig,
    });

    await client.query('COMMIT');
    reply.code(201);
    return {
      submissionId: row.submission_id,
      createdAt: row.created_at,
      status: 'accepted',
      suspicious: false,
      suspiciousReasons: [],
      reviewStatus,
      proof: proofView,
      ratingDeltas: settlement.ratingDeltas,
    };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const databaseError = error as { code?: string; constraint?: string } | undefined;
    const code = databaseError?.code;
    const constraint = databaseError?.constraint ?? '';
    if (
      code === '23505'
      && constraint.startsWith('ranked_result_submissions_session_id_submitted_by_account')
    ) {
      reply.code(409);
      return { error: 'Ranked result was already submitted for this session by this account.' };
    }
    if (
      code === '23505'
      && (constraint === 'ranked_matches_pkey' || constraint === 'ranked_matches_session_id_key')
    ) {
      reply.code(409);
      return { error: 'Ranked match has already been processed.' };
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/ranked/results/:sessionId', async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid authentication credential.' };
  }
  const params = request.params as { sessionId?: string };
  if (!isUuid(params.sessionId)) {
    reply.code(400);
    return { error: 'sessionId is required and must be a UUID.' };
  }
  const [terminalDecision, processedMatch] = await Promise.all([
    rankedTerminalDecisionStore.getBySession(params.sessionId),
    db.query(
    `
    SELECT
      m.match_id,
      m.created_at,
      m.outcome,
      m.winner_account_id,
      m.participant_p1_account_id,
      m.participant_p2_account_id,
      m.settlement_source,
      p.proof_digest,
      p.simulator_version,
      p.round_count,
      p.frame_count,
      p.derived_outcome,
      ar.reason AS authoritative_reason,
      ar.forfeiting_account_id
    FROM ranked_matches m
    LEFT JOIN ranked_result_submissions s ON s.submission_id = m.processed_submission_id
    LEFT JOIN ranked_match_proofs p ON p.proof_digest = s.proof_digest
    LEFT JOIN ranked_authoritative_resolutions ar
      ON ar.resolution_id = m.authoritative_resolution_id
    WHERE m.session_id = $1
    LIMIT 1
    `,
    [params.sessionId],
    ),
  ]);
  const durableMatchParticipants = processedMatch.rows[0]
    ? {
      participantP1AccountId: String(
        (processedMatch.rows[0] as { participant_p1_account_id: unknown })
          .participant_p1_account_id,
      ),
      participantP2AccountId: String(
        (processedMatch.rows[0] as { participant_p2_account_id: unknown })
          .participant_p2_account_id,
      ),
    }
    : null;
  const durableAccess = resolveDurableRankedResultAccess(
    accountId,
    terminalDecision,
    durableMatchParticipants,
  );
  if (durableAccess.hasDurableRecord) {
    if (!durableAccess.authorized) {
      reply.code(403);
      return { error: 'Ranked result belongs to another session participant.' };
    }
  } else {
    const sessionToken = getMatchSessionToken(request.headers);
    if (!sessionToken) {
      reply.code(400);
      return { error: 'x-match-session-token header is required.' };
    }
    requireMatchmakingRuntimeLease(request);
    const sessionValidation = matchmakingQueueService.validateSessionToken(
      params.sessionId,
      accountId,
      sessionToken,
      { allowResolved: true, allowExpiredToken: true },
    );
    if (!sessionValidation.ok) {
      reply.code(mapSessionErrorToHttp(sessionValidation.error.code));
      return { error: sessionValidation.error.message, code: sessionValidation.error.code };
    }
    if (sessionValidation.value.queueType !== 'ranked') {
      reply.code(409);
      return { error: 'Session is not a ranked queue session.' };
    }
  }

  if (processedMatch.rowCount) {
    const match = processedMatch.rows[0] as {
      match_id: string;
      created_at: string;
      outcome: 'p1_win' | 'p2_win' | 'draw' | 'forfeit';
      winner_account_id: string | null;
      settlement_source: 'player_consensus' | 'server_authoritative';
      proof_digest: string | null;
      simulator_version: string | null;
      round_count: number | null;
      frame_count: number | null;
      derived_outcome: 'p1_win' | 'p2_win' | null;
      authoritative_reason: 'reconnect_timeout' | 'peer_left' | null;
      forfeiting_account_id: string | null;
    };
    const deltas = await db.query(
      `
      SELECT
        account_id, side, pre_rating, post_rating, rating_delta, result,
        pre_league_tier, post_league_tier, pre_league_points, post_league_points,
        pre_mr_points, post_mr_points
      FROM ranked_match_rating_deltas
      WHERE match_id = $1
      ORDER BY side ASC
      `,
      [match.match_id],
    );
    return {
      submissionId: match.match_id,
      createdAt: match.created_at,
      status: 'accepted',
      suspicious: false,
      suspiciousReasons: [],
      reviewStatus: 'none',
      outcome: match.outcome,
      winnerAccountId: match.winner_account_id,
      settlementSource: match.settlement_source,
      authoritativeResolution: match.authoritative_reason ? {
        reason: match.authoritative_reason,
        forfeitingAccountId: match.forfeiting_account_id,
      } : undefined,
      proof: match.proof_digest ? {
        digest: match.proof_digest,
        simulatorVersion: match.simulator_version,
        roundCount: Number(match.round_count),
        frameCount: Number(match.frame_count),
        derivedOutcome: match.derived_outcome,
      } : undefined,
      ratingDeltas: deltas.rows.map((rawRow) => {
        const delta = rawRow as Record<string, unknown>;
        return {
          accountId: String(delta.account_id),
          side: delta.side,
          preRating: Number(delta.pre_rating),
          postRating: Number(delta.post_rating),
          ratingDelta: Number(delta.rating_delta),
          result: delta.result,
          preLeagueTier: delta.pre_league_tier,
          postLeagueTier: delta.post_league_tier,
          preLeaguePoints: delta.pre_league_points === null ? null : Number(delta.pre_league_points),
          postLeaguePoints: delta.post_league_points === null ? null : Number(delta.post_league_points),
          preMrPoints: delta.pre_mr_points === null ? null : Number(delta.pre_mr_points),
          postMrPoints: delta.post_mr_points === null ? null : Number(delta.post_mr_points),
        };
      }),
    };
  }

  if (terminalDecision) {
    const noContest = terminalDecision.decisionType === 'no_contest';
    return {
      submissionId: terminalDecision.sessionId,
      createdAt: terminalDecision.decidedAt,
      status: noContest ? 'no_contest' : 'authoritative_pending',
      suspicious: false,
      suspiciousReasons: [],
      reviewStatus: 'none',
      outcome: noContest ? undefined : 'forfeit',
      winnerAccountId: terminalDecision.winnerAccountId,
      settlementSource: 'server_authoritative',
      authoritativeResolution: {
        reason: terminalDecision.reason,
        forfeitingAccountId: terminalDecision.forfeitingAccountId,
      },
      terminalDecision: {
        type: terminalDecision.decisionType,
        status: terminalDecision.status,
        dueAt: terminalDecision.dueAt,
        decidedAt: terminalDecision.decidedAt,
      },
      ratingDeltas: [],
    };
  }

  const submissions = await db.query(
    `
    SELECT
      s.submission_id,
      s.submitted_by_account_id,
      s.created_at,
      s.suspicious,
      s.suspicious_reasons,
      s.review_status,
      p.proof_digest,
      p.simulator_version,
      p.round_count,
      p.frame_count,
      p.derived_outcome
    FROM ranked_result_submissions s
    LEFT JOIN ranked_match_proofs p ON p.proof_digest = s.proof_digest
    WHERE s.session_id = $1
    ORDER BY s.created_at ASC
    `,
    [params.sessionId],
  );
  const ownSubmission = submissions.rows.find((rawRow) => (
    (rawRow as { submitted_by_account_id?: string }).submitted_by_account_id === accountId
  )) ?? submissions.rows[0];
  const flagged = submissions.rows.find((rawRow) => Boolean((rawRow as { suspicious?: boolean }).suspicious));
  const selected = (flagged ?? ownSubmission) as {
    submission_id?: string;
    created_at?: string;
    suspicious_reasons?: RankedResultSuspiciousReason[];
    review_status?: string;
    proof_digest?: string | null;
    simulator_version?: string | null;
    round_count?: number | null;
    frame_count?: number | null;
    derived_outcome?: 'p1_win' | 'p2_win' | null;
  } | undefined;
  return {
    submissionId: selected?.submission_id ?? params.sessionId,
    createdAt: selected?.created_at ?? new Date().toISOString(),
    status: flagged ? 'flagged_for_review' : 'awaiting_peer_confirmation',
    suspicious: Boolean(flagged),
    suspiciousReasons: selected?.suspicious_reasons ?? [],
    reviewStatus: selected?.review_status ?? 'none',
    proof: selected?.proof_digest ? {
      digest: selected.proof_digest,
      simulatorVersion: selected.simulator_version ?? null,
      roundCount: Number(selected.round_count),
      frameCount: Number(selected.frame_count),
      derivedOutcome: selected.derived_outcome ?? null,
    } : undefined,
  };
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
  if (season.state === 'scheduled') {
    reply.code(409);
    return {
      error: 'Ranked season has not started.',
      code: 'ranked_season_not_started',
      startsAt: season.startsAt,
    };
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
  const seasonId = requestedSeasonId || (
    await ensureActiveSeason(db, new Date(), rankedSeasonDurationDays)
  ).seasonId;

  return withRepeatableReadSnapshot(async (leaderboardDb) => {
    const season = await getSeasonById(leaderboardDb, seasonId);
    if (!season) {
      reply.code(404);
      return { error: 'Ranked season not found.' };
    }
    if (season.state === 'scheduled') {
      reply.code(409);
      return {
        error: 'Ranked season has not started.',
        code: 'ranked_season_not_started',
        startsAt: season.startsAt,
      };
    }

  const parsedLimit = parsePositiveInteger(query.limit);
  const limit = parsedLimit ? Math.min(parsedLimit, 100) : 25;
  const parsedOffset = parseNonNegativeInteger(query.offset);
  const offset = parsedOffset ?? 0;
  const region = parseLeaderboardRegion(query.region);
  const track = parseLeaderboardTrack(query.track);

  if (track === 'master') {
    if (season.state === 'archived') {
      const totalResult = await leaderboardDb.query(
        ARCHIVED_MASTER_LEADERBOARD_TOTAL_SQL,
        [season.seasonId, region],
      );
      const total = Number((totalResult.rows[0] as { count: string }).count);
      const rows = await leaderboardDb.query(
        ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL,
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
            rank_position: number | string;
            account_id: string;
            display_name: string | null;
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
            rank: Number(entry.rank_position),
            accountId: entry.account_id,
            displayName: entry.display_name,
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

    const totalResult = await leaderboardDb.query(
      `
        SELECT COUNT(*) AS count
        FROM ranked_master_ratings m
        JOIN accounts a ON a.id = m.account_id
        LEFT JOIN profiles p ON p.account_id = m.account_id
        WHERE m.season_id = $1
          AND a.status = 'active'
          AND (
            $2::text IS NULL
            OR COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') = $2
          )
      `,
      [season.seasonId, region],
    );
    const total = Number((totalResult.rows[0] as { count: string }).count);
    const rows = await leaderboardDb.query(
      `
        WITH ranked_rows AS (
          SELECT
            ROW_NUMBER() OVER (
              ORDER BY m.mr_points DESC, m.wins DESC, m.matches_played DESC, m.account_id ASC
            ) AS rank_position,
            m.account_id,
            p.display_name,
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
          JOIN accounts a ON a.id = m.account_id
          LEFT JOIN profiles p ON p.account_id = m.account_id
          WHERE m.season_id = $1 AND a.status = 'active'
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
          rank_position: number | string;
          account_id: string;
          display_name: string | null;
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
          rank: Number(entry.rank_position),
          accountId: entry.account_id,
          displayName: entry.display_name,
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
    const totalResult = await leaderboardDb.query(
      `
        SELECT COUNT(*) AS count
        FROM ranked_season_standings s
        WHERE s.season_id = $1
          AND ($2::text IS NULL OR s.region = $2)
      `,
      [season.seasonId, region],
    );
    const total = Number((totalResult.rows[0] as { count: string }).count);
    const rows = await leaderboardDb.query(
      `
        SELECT
          s.rank_position,
          s.account_id,
          p.display_name,
          s.region,
          s.rating,
          s.matches_played,
          s.wins,
          s.losses,
          s.draws,
          s.forfeits,
          s.league_tier,
          s.league_points,
          s.mr_points,
          s.provisional,
          s.captured_at
        FROM ranked_season_standings s
        LEFT JOIN profiles p ON p.account_id = s.account_id
        WHERE s.season_id = $1
          AND ($2::text IS NULL OR s.region = $2)
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
          rank_position: number | string;
          account_id: string;
          display_name: string | null;
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
          rank: Number(entry.rank_position),
          accountId: entry.account_id,
          displayName: entry.display_name,
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

  const totalResult = await leaderboardDb.query(
    `
      SELECT COUNT(*) AS count
      FROM ranked_player_ratings r
      JOIN accounts a ON a.id = r.account_id
      LEFT JOIN profiles p ON p.account_id = r.account_id
      WHERE a.status = 'active'
        AND (
        $1::text IS NULL
        OR COALESCE(NULLIF(LOWER(TRIM(p.settings_json->>'region')), ''), 'global') = $1
      )
    `,
    [region],
  );
  const total = Number((totalResult.rows[0] as { count: string }).count);
  const rows = await leaderboardDb.query(
    `
      WITH ranked_rows AS (
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY r.rating DESC, r.wins DESC, r.matches_played DESC, r.account_id ASC
          ) AS rank_position,
          r.account_id,
          p.display_name,
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
        JOIN accounts a ON a.id = r.account_id
        LEFT JOIN profiles p ON p.account_id = r.account_id
        LEFT JOIN ranked_league_progression l ON l.account_id = r.account_id
        LEFT JOIN ranked_master_ratings m ON m.season_id = $2 AND m.account_id = r.account_id
        WHERE a.status = 'active'
      )
      SELECT *
      FROM ranked_rows
      WHERE ($1::text IS NULL OR region = $1)
      ORDER BY rank_position ASC, account_id ASC
      LIMIT $3 OFFSET $4
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
        rank_position: number | string;
        account_id: string;
        display_name: string | null;
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
        rank: Number(entry.rank_position),
        accountId: entry.account_id,
        displayName: entry.display_name,
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
});

app.get('/ops/matchmaking/runtime', async (request, reply) => {
  if (!sloAdminKey) {
    reply.code(501);
    return { error: 'Matchmaking operations are not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== sloAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  const summary = matchmakingQueueService.getRuntimeSummary();
  await persistMatchmakingState(runtimeLease);
  return {
    acceptingJoins: !matchmakingDraining,
    draining: matchmakingDraining,
    ...summary,
  };
});

app.post('/ops/matchmaking/drain', async (request, reply) => {
  if (!sloAdminKey) {
    reply.code(501);
    return { error: 'Matchmaking operations are not configured.' };
  }
  const adminKey = getHeaderValue(request.headers['x-admin-key']);
  if (adminKey !== sloAdminKey) {
    reply.code(401);
    return { error: 'Missing or invalid admin key.' };
  }
  const body = (request.body ?? {}) as MatchmakingDrainBody;
  if (typeof body.draining !== 'boolean') {
    reply.code(400);
    return { error: 'draining must be a boolean.' };
  }

  const runtimeLease = requireMatchmakingRuntimeLease(request);
  matchmakingDraining = body.draining;
  const closedQueuedTickets = matchmakingDraining
    ? matchmakingQueueService.drainQueuedTickets()
    : 0;
  await persistMatchmakingState(runtimeLease);
  return {
    acceptingJoins: !matchmakingDraining,
    draining: matchmakingDraining,
    closedQueuedTickets,
    ...matchmakingQueueService.getRuntimeSummary(),
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
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await runRankedSeasonReset(client, new Date(), rankedSeasonDurationDays);
    if (result.status === 'locked') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      reply.header('retry-after', '5');
      reply.code(503);
      return {
        error: 'Ranked season reset is already in progress.',
        code: 'ranked_season_reset_locked',
        retryAfterSeconds: 5,
      };
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the reset error if the connection also fails during rollback.
      }
    }
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
  const body = (request.body ?? {}) as CreateRoomBody;
  const buildVersion = typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null;
  const accessDecision = matchmakingAccessPolicy.evaluate(accountId, buildVersion);
  if (!accessDecision.allowed) {
    reply.code(403);
    return { error: getMatchmakingAccessError(accessDecision.code), code: accessDecision.code };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }

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
  const body = (request.body ?? {}) as JoinRoomBody;
  const buildVersion = typeof body.buildVersion === 'string' ? body.buildVersion.trim() : null;
  const accessDecision = matchmakingAccessPolicy.evaluate(accountId, buildVersion);
  if (!accessDecision.allowed) {
    reply.code(403);
    return { error: getMatchmakingAccessError(accessDecision.code), code: accessDecision.code };
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

app.post('/replays/ingest', { bodyLimit: replayIngestBodyLimitBytes }, async (request, reply) => {
  const accountId = getAuthenticatedAccountId(request);
  if (!accountId) {
    reply.code(401);
    return { error: 'Missing or invalid x-account-id header.' };
  }
  if (!await ensureAccountExists(accountId)) {
    reply.code(404);
    return { error: 'Account not found.' };
  }
  const replayRateLimitRejection = await enforceReplayIngestRateLimits(request, reply, accountId);
  if (replayRateLimitRejection) {
    return replayRateLimitRejection;
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
  if (queueType === 'ranked' && !payload.header.onlineMatch) {
    reply.code(400);
    return {
      error: 'Ranked replay archives require canonical online match identity.',
      code: 'ranked_replay_identity_required',
    };
  }
  if (payload.header.onlineMatch) {
    const deterministicValidation = validateDeterministicReplayPayload(payload);
    if (!deterministicValidation.ok) {
      reply.code(400);
      return {
        error: `Canonical replay simulation verification failed: ${deterministicValidation.error.message}`,
        code: deterministicValidation.error.code,
      };
    }
  }

  const requestedMatchId = String(body.matchId ?? '').trim();
  if (payload.header.onlineMatch && !isUuid(requestedMatchId)) {
    reply.code(400);
    return { error: 'Canonical online replay matchId must be a UUID.' };
  }
  const matchId = isUuid(requestedMatchId) ? requestedMatchId : randomUUID();

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

  const existingMatchArchive = await db.query(
    'SELECT replay_id FROM replays WHERE match_id = $1 LIMIT 1',
    [matchId],
  );
  if (!existingMatchArchive.rowCount) {
    const quotaUsage = await db.query(
      `
        SELECT
          COUNT(*)::integer AS active_archives,
          COALESCE(SUM(r.compressed_bytes), 0)::bigint AS active_compressed_bytes
        FROM replays r
        JOIN replay_participants rp ON rp.replay_id = r.replay_id
        WHERE rp.account_id = $1
          AND r.deleted_at IS NULL
          AND r.retention_until > NOW()
      `,
      [accountId],
    );
    const usageRow = quotaUsage.rows[0] as {
      active_archives?: number | string;
      active_compressed_bytes?: number | string;
    } | undefined;
    const quotaDecision = evaluateReplayIngestQuota({
      activeArchives: Number(usageRow?.active_archives ?? 0),
      activeCompressedBytes: Number(usageRow?.active_compressed_bytes ?? 0),
      incomingEstimatedBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    }, replayIngestQuotaPolicy);
    if (!quotaDecision.allowed) {
      reply.code(429);
      return {
        error: quotaDecision.error,
        code: quotaDecision.code,
        recovery: 'Delete old replay archives or wait for their retention period to expire.',
      };
    }
  }

  const canonicalIdentity = payload.header.onlineMatch;
  const canonicalParticipants = normalisedParticipants as NormalisedReplayParticipant[];
  if (canonicalIdentity) {
    requireMatchmakingRuntimeLease(request);
    const session = matchmakingQueueService.getSessionForAccount(
      canonicalIdentity.sessionId,
      accountId,
    );
    if (!session) {
      reply.code(409);
      return {
        error: 'Canonical replay matchmaking session is unavailable for this account.',
        code: 'replay_session_unavailable',
      };
    }
    const canonicalBinding: CanonicalReplayBindingInput = {
      accountId,
      matchId,
      queueType,
      matchType,
      region,
      outcome,
      winnerAccountId,
      participants: canonicalParticipants,
      payload,
      session,
    };
    const bindingValidation = validateCanonicalReplayBinding(canonicalBinding);
    if (!bindingValidation.ok) {
      reply.code(400);
      return { error: bindingValidation.error, code: 'invalid_replay_binding' };
    }

    if (queueType === 'ranked') {
      const rankedMatch = await db.query(
        `
          SELECT
            m.match_id,
            m.session_id,
            m.outcome,
            m.winner_account_id,
            m.settlement_source,
            m.participant_p1_account_id,
            m.participant_p2_account_id,
            p.proof_digest,
            p.payload_json AS proof_payload,
            p.round_count AS proof_round_count,
            p.frame_count AS proof_frame_count,
            p.derived_outcome AS proof_derived_outcome
          FROM ranked_matches m
          LEFT JOIN ranked_result_submissions s
            ON s.submission_id = m.processed_submission_id
          LEFT JOIN ranked_match_proofs p
            ON p.proof_digest = s.proof_digest
          WHERE m.match_id = $1 AND m.session_id = $2
          LIMIT 1
        `,
        [matchId, canonicalIdentity.sessionId],
      );
      if (!rankedMatch.rowCount) {
        reply.code(409);
        return {
          error: 'Ranked replay cannot be archived before its match is settled.',
          code: 'ranked_match_not_settled',
        };
      }
      const row = rankedMatch.rows[0] as {
        match_id: string;
        session_id: string;
        outcome: string;
        winner_account_id: string | null;
        settlement_source: string;
        participant_p1_account_id: string;
        participant_p2_account_id: string;
        proof_digest: string | null;
        proof_payload: unknown;
        proof_round_count: number | null;
        proof_frame_count: number | null;
        proof_derived_outcome: string | null;
      };
      const settlement: RankedReplaySettlement = {
        matchId: row.match_id,
        sessionId: row.session_id,
        outcome: row.outcome,
        winnerAccountId: row.winner_account_id,
        settlementSource: row.settlement_source,
        p1AccountId: row.participant_p1_account_id,
        p2AccountId: row.participant_p2_account_id,
        proofRoundCount: row.proof_round_count,
        proofFrameCount: row.proof_frame_count,
        proofDerivedOutcome: row.proof_derived_outcome,
      };
      const settlementValidation = validateRankedReplaySettlement(
        canonicalBinding,
        bindingValidation.value,
        settlement,
      );
      if (!settlementValidation.ok) {
        reply.code(409);
        return { error: settlementValidation.error, code: 'ranked_replay_mismatch' };
      }
      if (!row.proof_digest || !row.proof_payload) {
        reply.code(409);
        return {
          error: 'Canonical ranked replay has no persisted verified proof payload.',
          code: 'ranked_replay_proof_missing',
        };
      }
      const proofBindingValidation = await validateRankedReplayProofBinding(
        payload,
        bindingValidation.value,
        {
          proofDigest: row.proof_digest,
          proofPayload: row.proof_payload,
        },
      );
      if (!proofBindingValidation.ok) {
        reply.code(409);
        return {
          error: proofBindingValidation.error,
          code: 'ranked_replay_proof_mismatch',
        };
      }
    }
  }

  const replayId = randomUUID();
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
    const databaseError = error as { code?: string; constraint?: string };
    const duplicateMatchId = (
      databaseError.code === '23505'
      && databaseError.constraint === 'replays_match_id_key'
    ) || message.includes('replays_match_id_key');
    if (duplicateMatchId) {
      const existingReplay = await db.query(
        `
          SELECT
            replay_id, match_id, queue_type, match_type, region, patch_version,
            ruleset_version, sim_build_hash, payload_version, outcome, winner_account_id,
            storage_key, compressed_bytes, sha256, retention_until, deleted_at
          FROM replays
          WHERE match_id = $1
          LIMIT 1
        `,
        [matchId],
      );
      if (!existingReplay.rowCount) {
        throw error;
      }
      const existingRow = existingReplay.rows[0] as {
        replay_id: string;
        match_id: string;
        queue_type: string;
        match_type: string;
        region: string;
        patch_version: string;
        ruleset_version: string;
        sim_build_hash: string;
        payload_version: number;
        outcome: string;
        winner_account_id: string | null;
        storage_key: string;
        compressed_bytes: number;
        sha256: string;
        retention_until: unknown;
        deleted_at: unknown;
      };
      if (existingRow.deleted_at) {
        reply.code(409);
        return { error: 'Replay for this matchId was deleted and cannot be replaced.' };
      }

      const existingParticipantRows = await db.query(
        `
          SELECT account_id, side, character_id, result
          FROM replay_participants
          WHERE replay_id = $1
          ORDER BY side
        `,
        [existingRow.replay_id],
      );
      let existingPayload: unknown;
      try {
        existingPayload = await replayBlobStore.getReplayPayload(existingRow.storage_key);
      } catch {
        reply.code(409);
        return { error: 'Existing replay archive is missing its canonical payload.' };
      }
      const existingValidation = validateReplayPayloadForArchive(existingPayload);
      if (!existingValidation.ok) {
        reply.code(409);
        return { error: 'Existing replay archive payload is invalid and cannot be replaced.' };
      }

      const existingIdentity: ReplayArchiveIdentity = {
        queueType: existingRow.queue_type,
        matchType: existingRow.match_type,
        region: existingRow.region,
        patchVersion: existingRow.patch_version,
        rulesetVersion: existingRow.ruleset_version,
        simBuildHash: existingRow.sim_build_hash,
        outcome: existingRow.outcome,
        winnerAccountId: existingRow.winner_account_id,
        payloadDigest: computeReplayCanonicalDigestForArchive(existingValidation.payload),
        participants: existingParticipantRows.rows.map((participant) => ({
          accountId: String(participant.account_id),
          side: String(participant.side) as 'P1' | 'P2',
          characterId: String(participant.character_id),
          result: String(participant.result) as NormalisedReplayParticipant['result'],
        })),
      };
      const incomingIdentity: ReplayArchiveIdentity = {
        queueType,
        matchType,
        region,
        patchVersion,
        rulesetVersion,
        simBuildHash,
        outcome,
        winnerAccountId,
        payloadDigest: computeReplayCanonicalDigestForArchive(payload),
        participants: canonicalParticipants,
      };
      const identityComparison = compareReplayArchiveIdentity(existingIdentity, incomingIdentity);
      if (!identityComparison.ok) {
        reply.code(409);
        return { error: identityComparison.error, code: 'replay_identity_conflict' };
      }

      reply.code(200);
      return {
        replayId: existingRow.replay_id,
        matchId: existingRow.match_id,
        storageKey: existingRow.storage_key,
        compressedBytes: existingRow.compressed_bytes,
        sha256: existingRow.sha256,
        payloadVersion: existingRow.payload_version,
        retentionUntil: toIsoString(existingRow.retention_until),
        existing: true,
      };
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
  return resolveAuthenticatedAccountId(
    request.headers,
    authSessionTokenService,
    allowInsecureAccountHeader,
  );
}

function getMatchmakingAccessError(code: MatchmakingAccessDenialCode): string {
  switch (code) {
    case 'matchmaking_closed':
      return 'Online match entry is currently closed.';
    case 'account_not_allowlisted':
      return 'This account is not enabled for the controlled alpha.';
    case 'build_version_required':
      return 'An approved build version is required for online play.';
    case 'build_not_allowlisted':
      return 'This build is not enabled for the controlled alpha.';
    default:
      return 'Online match entry is unavailable.';
  }
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
const matchmakingCheckpointIntervalMs = parsePositiveIntegerEnv(
  process.env.MATCHMAKING_SNAPSHOT_INTERVAL_MS,
) ?? 5_000;
const rankedTerminalDecisionProcessingIntervalMs = Math.min(
  60_000,
  Math.max(
    250,
    parsePositiveIntegerEnv(process.env.RANKED_TERMINAL_DECISION_PROCESS_INTERVAL_MS) ?? 1_000,
  ),
);
let matchmakingCheckpointTimer: NodeJS.Timeout | null = null;
let rankedTerminalDecisionProcessingTimer: NodeJS.Timeout | null = null;
let authRateLimitCleanupTimer: NodeJS.Timeout | null = null;
let replayRetentionCleanupTimer: NodeJS.Timeout | null = null;
let matchmakingSignalCleanupTimer: NodeJS.Timeout | null = null;
let sloSampleCleanupTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function runSloSampleCleanup(): Promise<void> {
  const result = await sloSampleStore.pruneBounded();
  if (result.deleted > 0) {
    app.log.info(
      { batches: result.batches, deleted: result.deleted },
      'Pruned retained SLO request samples.',
    );
  }
}

async function runReplayRetentionCleanup(): Promise<void> {
  let selected = 0;
  let deleted = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await pruneExpiredReplayArchives(db, replayBlobStore, 100);
    selected += result.selected;
    deleted += result.deleted;
    if (result.selected < 100) {
      break;
    }
  }
  if (selected > 0) {
    app.log.info({ selected, deleted }, 'Pruned expired replay archives.');
  }
}

async function runMatchmakingSignalCleanup(): Promise<void> {
  let deleted = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const batchDeleted = await sessionSignalStore.deleteExpiredSignals(
      DEFAULT_EXPIRED_SIGNAL_DELETE_LIMIT,
    );
    deleted += batchDeleted;
    if (batchDeleted < DEFAULT_EXPIRED_SIGNAL_DELETE_LIMIT) {
      break;
    }
  }
  if (deleted > 0) {
    app.log.info({ deleted }, 'Pruned expired WebRTC signaling messages.');
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down API.');
  if (matchmakingCheckpointTimer) {
    clearInterval(matchmakingCheckpointTimer);
    matchmakingCheckpointTimer = null;
  }
  if (rankedTerminalDecisionProcessingTimer) {
    clearInterval(rankedTerminalDecisionProcessingTimer);
    rankedTerminalDecisionProcessingTimer = null;
  }
  if (authRateLimitCleanupTimer) {
    clearInterval(authRateLimitCleanupTimer);
    authRateLimitCleanupTimer = null;
  }
  if (replayRetentionCleanupTimer) {
    clearInterval(replayRetentionCleanupTimer);
    replayRetentionCleanupTimer = null;
  }
  if (matchmakingSignalCleanupTimer) {
    clearInterval(matchmakingSignalCleanupTimer);
    matchmakingSignalCleanupTimer = null;
  }
  if (sloSampleCleanupTimer) {
    clearInterval(sloSampleCleanupTimer);
    sloSampleCleanupTimer = null;
  }
  try {
    await app.close();
    await matchmakingRuntimeCoordinator.withLease(async (lease) => {
      await refreshMatchmakingState(lease);
      await persistMatchmakingState(lease);
    });
    await db.end();
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'API shutdown failed.');
    process.exit(1);
  }
}

async function startServer(): Promise<void> {
  await matchmakingRuntimeCoordinator.withLease((lease) => restoreMatchmakingState(lease));
  await processRankedTerminalDecisionBatch();
  await authRateLimiter.pruneExpired();
  await runReplayRetentionCleanup();
  await runMatchmakingSignalCleanup();
  await runSloSampleCleanup();
  await app.listen({ port, host: '0.0.0.0' });
  authRateLimitCleanupTimer = setInterval(() => {
    void authRateLimiter.pruneExpired().catch((error) => {
      app.log.warn({ err: error }, 'Failed to prune expired authentication rate-limit buckets.');
    });
  }, authRateLimitCleanupIntervalMs);
  authRateLimitCleanupTimer.unref();
  replayRetentionCleanupTimer = setInterval(() => {
    void runReplayRetentionCleanup().catch((error) => {
      app.log.warn({ err: error }, 'Failed to prune expired replay archives.');
    });
  }, replayRetentionCleanupIntervalMs);
  replayRetentionCleanupTimer.unref();
  matchmakingSignalCleanupTimer = setInterval(() => {
    void runMatchmakingSignalCleanup().catch((error) => {
      app.log.warn({ err: error }, 'Failed to prune expired WebRTC signaling messages.');
    });
  }, matchmakingSignalCleanupIntervalMs);
  matchmakingSignalCleanupTimer.unref();
  sloSampleCleanupTimer = setInterval(() => {
    void runSloSampleCleanup().catch((error) => {
      app.log.warn({ err: error }, 'Failed to prune retained SLO request samples.');
    });
  }, sloSampleStore.config.cleanupIntervalMs);
  sloSampleCleanupTimer.unref();
  matchmakingCheckpointTimer = setInterval(() => {
    void matchmakingRuntimeCoordinator.withLease(async (lease) => {
      await refreshMatchmakingState(lease);
      await persistMatchmakingState(lease);
    }).catch((error) => {
      app.log.error(error, 'Periodic matchmaking state checkpoint failed.');
    });
  }, matchmakingCheckpointIntervalMs);
  matchmakingCheckpointTimer.unref();
  rankedTerminalDecisionProcessingTimer = setInterval(() => {
    void scheduleRankedTerminalDecisionProcessing();
  }, rankedTerminalDecisionProcessingIntervalMs);
  rankedTerminalDecisionProcessingTimer.unref();
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

startServer().catch(async (error) => {
  app.log.error(error);
  await db.end().catch(() => undefined);
  process.exit(1);
});
