import { randomBytes, randomUUID } from 'node:crypto';

export const QUEUE_TYPES = ['unranked', 'ranked'] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];

export const SUPPORTED_REGIONS = ['us-east', 'us-west', 'eu-west', 'ap-southeast'] as const;
export type RegionId = (typeof SUPPORTED_REGIONS)[number];

export type QueueTicketStatus = 'queued' | 'matched' | 'closed';
export type QueueTicketClosedReason =
  | 'left_queue'
  | 'peer_left'
  | 'expired'
  | 'session_expired'
  | 'reconnect_timeout'
  | 'service_draining'
  | 'session_completed';

export interface QueuePlayerMetadata {
  displayName?: string | null;
  platform?: 'web' | 'steam' | null;
  buildVersion?: string | null;
  rulesetVersion?: string | null;
  balanceProfileId?: string | null;
  selectedCharacterId?: string | null;
  rankedSnapshot?: {
    rating?: number | null;
    leagueTier?: string | null;
    mrPoints?: number | null;
  };
}

export interface QueueJoinRequest {
  accountId: string;
  queueType: QueueType;
  regionPreferences: RegionId[];
  playerMetadata?: QueuePlayerMetadata;
}

export interface MatchPlayerMetadata {
  accountId: string;
  displayName: string | null;
  queueTicketId: string;
  selectedCharacterId: string | null;
  side: 'P1' | 'P2';
  preferredRegions: RegionId[];
  queuedAt: string;
}

export interface MatchStartPayload {
  sessionId: string;
  sessionToken: string;
  sessionTokenExpiresAt: string;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
  reconnectGraceSeconds: number;
  buildVersion: string | null;
  rulesetVersion: string | null;
  balanceProfileId: string | null;
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
  expiresAt: string;
  transportAttempt: MatchSessionTransportAttemptView;
  localPlayer: MatchPlayerMetadata;
  peer: MatchPlayerMetadata;
  diagnostics: {
    skillTrack: 'unranked' | 'rating' | 'master';
    expectedGap: number | null;
    matchedGap: number | null;
    waitSeconds: number;
    regionConstraintRelaxed: boolean;
  };
}

export interface QueueTicketView {
  ticketId: string;
  accountId: string;
  queueType: QueueType;
  regionPreferences: RegionId[];
  status: QueueTicketStatus;
  queuedAt: string;
  matchedAt?: string;
  closedAt?: string;
  closedReason?: QueueTicketClosedReason;
  matchStart?: MatchStartPayload;
}

export type SessionConnectionStatus = 'connected' | 'disconnected';
export type MatchSessionStatus = 'active' | 'resolved';
export type MatchSessionResolvedReason = 'session_expired' | 'reconnect_timeout' | 'peer_left' | 'completed';

export interface MatchSessionTransportAttemptView {
  attemptId: string;
  generation: number;
  createdAt: string;
}

export interface MatchSessionParticipantView {
  accountId: string;
  queueTicketId: string;
  side: 'P1' | 'P2';
  selectedCharacterId: string | null;
  connectionStatus: SessionConnectionStatus;
  lastHeartbeatAt: string;
  completionAttestedAt?: string;
  disconnectedAt?: string;
  reconnectDeadlineAt?: string;
}

export interface MatchSessionView {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  buildVersion: string | null;
  rulesetVersion: string | null;
  balanceProfileId: string | null;
  status: MatchSessionStatus;
  resolvedReason?: MatchSessionResolvedReason;
  resolvedAt?: string;
  forfeitingAccountId?: string;
  createdAt: string;
  expiresAt: string;
  reconnectGraceSeconds: number;
  transportAttempt: MatchSessionTransportAttemptView;
  participants: MatchSessionParticipantView[];
}

export interface SessionReconnectRequest {
  sessionId: string;
  accountId: string;
  sessionToken: string;
  reconnectAttemptId: string;
}

export interface SessionTransportAttemptAdvanceRequest {
  sessionId: string;
  accountId: string;
  sessionToken: string;
  expectedGeneration: number;
}

export interface SessionTokenValidationOptions {
  allowResolved?: boolean;
  allowExpiredToken?: boolean;
}

export type SessionActionErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'session_resolved'
  | 'invalid_token'
  | 'token_expired'
  | 'participant_disconnected'
  | 'replayed_attempt'
  | 'stale_transport_attempt';

export interface SessionActionError {
  code: SessionActionErrorCode;
  message: string;
}

export type SessionActionResult<T> = { ok: true; value: T } | { ok: false; error: SessionActionError };

export interface QueueServiceOptions {
  maxResidentTickets?: number;
  ticketTtlSeconds?: number;
  sessionTtlSeconds?: number;
  sessionTokenTtlSeconds?: number;
  reconnectGraceSeconds?: number;
  heartbeatIntervalSeconds?: number;
  heartbeatTimeoutSeconds?: number;
  closedTicketRetentionSeconds?: number;
  rankedRatingInitialGap?: number;
  rankedRatingExpansionPerSecond?: number;
  rankedRatingMaxGap?: number;
  rankedMasterInitialGap?: number;
  rankedMasterExpansionPerSecond?: number;
  rankedMasterMaxGap?: number;
  rankedMasterStrictRegionSeconds?: number;
  onSessionResolved?: (
    sessionId: string,
    reason: MatchSessionResolvedReason,
    session: MatchSessionView,
  ) => void;
  now?: () => number;
}

interface QueueTicketRecord {
  ticketId: string;
  accountId: string;
  queueType: QueueType;
  regionPreferences: RegionId[];
  playerMetadata: QueuePlayerMetadata;
  status: QueueTicketStatus;
  queuedAtMs: number;
  matchedAtMs?: number;
  closedAtMs?: number;
  closedReason?: QueueTicketClosedReason;
  matchStart?: MatchStartPayload;
  sessionId?: string;
}

interface MatchSessionParticipantRecord {
  accountId: string;
  queueTicketId: string;
  side: 'P1' | 'P2';
  selectedCharacterId: string | null;
  sessionToken: string;
  sessionTokenExpiresAtMs: number;
  connectionStatus: SessionConnectionStatus;
  lastHeartbeatAtMs: number;
  completionAttestedAtMs?: number;
  disconnectedAtMs?: number;
  reconnectDeadlineAtMs?: number;
  usedReconnectAttemptIds: Set<string>;
}

interface MatchSessionRecord {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  buildVersion: string | null;
  rulesetVersion: string | null;
  balanceProfileId: string | null;
  status: MatchSessionStatus;
  resolvedReason?: MatchSessionResolvedReason;
  forfeitingAccountId?: string;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  transportAttemptId: string;
  transportAttemptGeneration: number;
  transportAttemptCreatedAtMs: number;
  ticketIds: [string, string];
  participants: [MatchSessionParticipantRecord, MatchSessionParticipantRecord];
}

export interface MatchmakingQueueSnapshot {
  version: 1;
  capturedAtMs: number;
  serviceDraining?: boolean;
  tickets: Array<{
    ticketId: string;
    accountId: string;
    queueType: QueueType;
    regionPreferences: RegionId[];
    playerMetadata: QueuePlayerMetadata;
    status: QueueTicketStatus;
    queuedAtMs: number;
    matchedAtMs?: number;
    closedAtMs?: number;
    closedReason?: QueueTicketClosedReason;
    matchStart?: MatchStartPayload;
    sessionId?: string;
  }>;
  sessions: Array<{
    sessionId: string;
    queueType: QueueType;
    region: RegionId;
    buildVersion?: string | null;
    rulesetVersion?: string | null;
    balanceProfileId?: string | null;
    status: MatchSessionStatus;
    resolvedReason?: MatchSessionResolvedReason;
    forfeitingAccountId?: string;
    createdAtMs: number;
    expiresAtMs: number;
    resolvedAtMs?: number;
    transportAttemptId?: string;
    transportAttemptGeneration?: number;
    transportAttemptCreatedAtMs?: number;
    ticketIds: [string, string];
    participants: Array<{
      accountId: string;
      queueTicketId: string;
      side: 'P1' | 'P2';
      selectedCharacterId?: string | null;
      sessionToken: string;
      sessionTokenExpiresAtMs: number;
      connectionStatus: SessionConnectionStatus;
      lastHeartbeatAtMs?: number;
      completionAttestedAtMs?: number;
      disconnectedAtMs?: number;
      reconnectDeadlineAtMs?: number;
      usedReconnectAttemptIds: string[];
    }>;
  }>;
}

export interface MatchmakingRuntimeSummary {
  capturedAt: string;
  residentTickets: number;
  queuedTickets: number;
  matchedTickets: number;
  activeSessions: number;
  resolvedSessions: number;
  disconnectedParticipants: number;
  readyForProcessReplacement: boolean;
}

interface CandidateMatch {
  ticket: QueueTicketRecord;
  region: RegionId;
  score: number;
  diagnostics: MatchStartPayload['diagnostics'];
}

const DEFAULT_TICKET_TTL_SECONDS = 90;
const DEFAULT_MAX_RESIDENT_TICKETS = 256;
const DEFAULT_SESSION_TTL_SECONDS = 30 * 60;
const DEFAULT_RECONNECT_GRACE_SECONDS = 20;
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 5;
const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 30;
const DEFAULT_CLOSED_RETENTION_SECONDS = 120;
const DEFAULT_RANKED_RATING_INITIAL_GAP = 120;
const DEFAULT_RANKED_RATING_EXPANSION_PER_SECOND = 8;
const DEFAULT_RANKED_RATING_MAX_GAP = 700;
const DEFAULT_MASTER_INITIAL_GAP = 80;
const DEFAULT_MASTER_EXPANSION_PER_SECOND = 5;
const DEFAULT_MASTER_MAX_GAP = 400;
const DEFAULT_MASTER_STRICT_REGION_SECONDS = 20;

function createBucketKey(queueType: QueueType, region: RegionId): string {
  return `${queueType}:${region}`;
}

function uniqueRegionsInOrder(regions: RegionId[]): RegionId[] {
  const seen = new Set<RegionId>();
  const ordered: RegionId[] = [];
  for (const region of regions) {
    if (seen.has(region)) {
      continue;
    }
    seen.add(region);
    ordered.push(region);
  }
  return ordered;
}

function buildMatchPlayerMetadata(
  ticket: QueueTicketRecord,
  side: 'P1' | 'P2',
): MatchPlayerMetadata {
  return {
    accountId: ticket.accountId,
    displayName: ticket.playerMetadata.displayName ?? null,
    queueTicketId: ticket.ticketId,
    selectedCharacterId: ticket.playerMetadata.selectedCharacterId ?? null,
    side,
    preferredRegions: [...ticket.regionPreferences],
    queuedAt: new Date(ticket.queuedAtMs).toISOString(),
  };
}

function cloneQueuePlayerMetadata(metadata: QueuePlayerMetadata): QueuePlayerMetadata {
  return {
    displayName: metadata.displayName ?? null,
    platform: metadata.platform ?? null,
    buildVersion: metadata.buildVersion ?? null,
    rulesetVersion: metadata.rulesetVersion ?? null,
    balanceProfileId: metadata.balanceProfileId ?? null,
    selectedCharacterId: metadata.selectedCharacterId ?? null,
    rankedSnapshot: metadata.rankedSnapshot ? { ...metadata.rankedSnapshot } : undefined,
  };
}

function cloneMatchStartPayload(payload: MatchStartPayload): MatchStartPayload {
  return {
    ...payload,
    reconnectGraceSeconds: payload.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS,
    transportAttempt: { ...payload.transportAttempt },
    localPlayer: { ...payload.localPlayer, preferredRegions: [...payload.localPlayer.preferredRegions] },
    peer: { ...payload.peer, preferredRegions: [...payload.peer.preferredRegions] },
    diagnostics: { ...payload.diagnostics },
  };
}

function normalizeBuildVersion(buildVersion: string | null | undefined): string | null {
  const normalized = buildVersion?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function haveCompatibleClientVersions(first: QueueTicketRecord, second: QueueTicketRecord): boolean {
  const firstBuild = normalizeBuildVersion(first.playerMetadata.buildVersion);
  const secondBuild = normalizeBuildVersion(second.playerMetadata.buildVersion);
  if (firstBuild !== secondBuild) {
    return false;
  }
  const firstRuleset = normalizeBuildVersion(first.playerMetadata.rulesetVersion);
  const secondRuleset = normalizeBuildVersion(second.playerMetadata.rulesetVersion);
  if (firstRuleset !== secondRuleset) {
    return false;
  }
  const firstBalanceProfile = normalizeBuildVersion(first.playerMetadata.balanceProfileId);
  const secondBalanceProfile = normalizeBuildVersion(second.playerMetadata.balanceProfileId);
  return firstBalanceProfile === secondBalanceProfile;
}

export function isQueueType(value: string | undefined): value is QueueType {
  if (!value) {
    return false;
  }
  return (QUEUE_TYPES as readonly string[]).includes(value);
}

export function isRegionId(value: string | undefined): value is RegionId {
  if (!value) {
    return false;
  }
  return (SUPPORTED_REGIONS as readonly string[]).includes(value);
}

export class MatchmakingCapacityError extends Error {
  public readonly code = 'matchmaking_at_capacity';

  public constructor(public readonly maxResidentTickets: number) {
    super(`Matchmaking has reached its ${maxResidentTickets} resident-ticket capacity.`);
    this.name = 'MatchmakingCapacityError';
  }
}

export class MatchmakingQueueService {
  private readonly maxResidentTickets: number;

  private readonly ticketTtlMs: number;

  private readonly sessionTtlMs: number;

  private readonly sessionTokenTtlMs: number;

  private readonly reconnectGraceMs: number;

  private readonly heartbeatIntervalMs: number;

  private readonly heartbeatTimeoutMs: number;

  private readonly closedRetentionMs: number;

  private readonly rankedRatingInitialGap: number;

  private readonly rankedRatingExpansionPerSecond: number;

  private readonly rankedRatingMaxGap: number;

  private readonly rankedMasterInitialGap: number;

  private readonly rankedMasterExpansionPerSecond: number;

  private readonly rankedMasterMaxGap: number;

  private readonly rankedMasterStrictRegionSeconds: number;

  private readonly now: () => number;

  private readonly onSessionResolved: (
    sessionId: string,
    reason: MatchSessionResolvedReason,
    session: MatchSessionView,
  ) => void;

  private readonly ticketsById = new Map<string, QueueTicketRecord>();

  private readonly sessionsById = new Map<string, MatchSessionRecord>();

  private readonly activeTicketByAccountQueue = new Map<string, string>();

  private readonly regionBuckets = new Map<string, string[]>();

  public constructor(options: QueueServiceOptions = {}) {
    const maxResidentTickets = options.maxResidentTickets ?? DEFAULT_MAX_RESIDENT_TICKETS;
    if (!Number.isSafeInteger(maxResidentTickets) || maxResidentTickets <= 0) {
      throw new Error('maxResidentTickets must be a positive safe integer.');
    }
    this.maxResidentTickets = maxResidentTickets;
    this.ticketTtlMs = (options.ticketTtlSeconds ?? DEFAULT_TICKET_TTL_SECONDS) * 1000;
    this.sessionTtlMs = (options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
    this.sessionTokenTtlMs = (options.sessionTokenTtlSeconds ?? options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
    this.reconnectGraceMs = (options.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS) * 1000;
    this.heartbeatIntervalMs = Math.max(
      1_000,
      (options.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS) * 1000,
    );
    this.heartbeatTimeoutMs = Math.max(
      this.heartbeatIntervalMs * 3,
      (options.heartbeatTimeoutSeconds ?? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS) * 1000,
    );
    this.closedRetentionMs = (options.closedTicketRetentionSeconds ?? DEFAULT_CLOSED_RETENTION_SECONDS) * 1000;
    this.rankedRatingInitialGap = Math.max(1, Math.floor(options.rankedRatingInitialGap ?? DEFAULT_RANKED_RATING_INITIAL_GAP));
    this.rankedRatingExpansionPerSecond = Math.max(0.1, options.rankedRatingExpansionPerSecond ?? DEFAULT_RANKED_RATING_EXPANSION_PER_SECOND);
    this.rankedRatingMaxGap = Math.max(
      this.rankedRatingInitialGap,
      Math.floor(options.rankedRatingMaxGap ?? DEFAULT_RANKED_RATING_MAX_GAP),
    );
    this.rankedMasterInitialGap = Math.max(1, Math.floor(options.rankedMasterInitialGap ?? DEFAULT_MASTER_INITIAL_GAP));
    this.rankedMasterExpansionPerSecond = Math.max(0.1, options.rankedMasterExpansionPerSecond ?? DEFAULT_MASTER_EXPANSION_PER_SECOND);
    this.rankedMasterMaxGap = Math.max(
      this.rankedMasterInitialGap,
      Math.floor(options.rankedMasterMaxGap ?? DEFAULT_MASTER_MAX_GAP),
    );
    this.rankedMasterStrictRegionSeconds = Math.max(
      0,
      Math.floor(options.rankedMasterStrictRegionSeconds ?? DEFAULT_MASTER_STRICT_REGION_SECONDS),
    );
    this.onSessionResolved = options.onSessionResolved ?? (() => undefined);
    this.now = options.now ?? (() => Date.now());
  }

  public exportSnapshot(): MatchmakingQueueSnapshot {
    const nowMs = this.now();
    this.cleanup(nowMs);
    return {
      version: 1,
      capturedAtMs: nowMs,
      tickets: [...this.ticketsById.values()].map((ticket) => ({
        ticketId: ticket.ticketId,
        accountId: ticket.accountId,
        queueType: ticket.queueType,
        regionPreferences: [...ticket.regionPreferences],
        playerMetadata: cloneQueuePlayerMetadata(ticket.playerMetadata),
        status: ticket.status,
        queuedAtMs: ticket.queuedAtMs,
        matchedAtMs: ticket.matchedAtMs,
        closedAtMs: ticket.closedAtMs,
        closedReason: ticket.closedReason,
        matchStart: ticket.matchStart ? cloneMatchStartPayload(ticket.matchStart) : undefined,
        sessionId: ticket.sessionId,
      })),
      sessions: [...this.sessionsById.values()].map((session) => ({
        sessionId: session.sessionId,
        queueType: session.queueType,
        region: session.region,
        buildVersion: session.buildVersion,
        rulesetVersion: session.rulesetVersion,
        balanceProfileId: session.balanceProfileId,
        status: session.status,
        resolvedReason: session.resolvedReason,
        forfeitingAccountId: session.forfeitingAccountId,
        createdAtMs: session.createdAtMs,
        expiresAtMs: session.expiresAtMs,
        resolvedAtMs: session.resolvedAtMs,
        transportAttemptId: session.transportAttemptId,
        transportAttemptGeneration: session.transportAttemptGeneration,
        transportAttemptCreatedAtMs: session.transportAttemptCreatedAtMs,
        ticketIds: [...session.ticketIds] as [string, string],
        participants: session.participants.map((participant) => ({
          accountId: participant.accountId,
          queueTicketId: participant.queueTicketId,
          side: participant.side,
          selectedCharacterId: participant.selectedCharacterId,
          sessionToken: participant.sessionToken,
          sessionTokenExpiresAtMs: participant.sessionTokenExpiresAtMs,
          connectionStatus: participant.connectionStatus,
          lastHeartbeatAtMs: participant.lastHeartbeatAtMs,
          completionAttestedAtMs: participant.completionAttestedAtMs,
          disconnectedAtMs: participant.disconnectedAtMs,
          reconnectDeadlineAtMs: participant.reconnectDeadlineAtMs,
          usedReconnectAttemptIds: [...participant.usedReconnectAttemptIds],
        })),
      })),
    };
  }

  public getRuntimeSummary(): MatchmakingRuntimeSummary {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const tickets = [...this.ticketsById.values()];
    const sessions = [...this.sessionsById.values()];
    const queuedTickets = tickets.filter((ticket) => ticket.status === 'queued').length;
    const activeSessions = sessions.filter((session) => session.status === 'active');
    return {
      capturedAt: new Date(nowMs).toISOString(),
      residentTickets: tickets.length,
      queuedTickets,
      matchedTickets: tickets.filter((ticket) => ticket.status === 'matched').length,
      activeSessions: activeSessions.length,
      resolvedSessions: sessions.filter((session) => session.status === 'resolved').length,
      disconnectedParticipants: activeSessions.reduce(
        (count, session) => count + session.participants.filter(
          (participant) => participant.connectionStatus === 'disconnected',
        ).length,
        0,
      ),
      readyForProcessReplacement: queuedTickets === 0 && activeSessions.length === 0,
    };
  }

  public drainQueuedTickets(): number {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const queuedTickets = [...this.ticketsById.values()].filter((ticket) => ticket.status === 'queued');
    for (const ticket of queuedTickets) {
      this.closeTicket(ticket, 'service_draining', nowMs);
    }
    return queuedTickets.length;
  }

  public restoreSnapshot(snapshot: MatchmakingQueueSnapshot): void {
    if (snapshot.version !== 1 || !Array.isArray(snapshot.tickets) || !Array.isArray(snapshot.sessions)) {
      throw new Error('Unsupported matchmaking queue snapshot.');
    }

    this.ticketsById.clear();
    this.sessionsById.clear();
    this.activeTicketByAccountQueue.clear();
    this.regionBuckets.clear();

    for (const storedTicket of snapshot.tickets) {
      const ticket: QueueTicketRecord = {
        ticketId: storedTicket.ticketId,
        accountId: storedTicket.accountId,
        queueType: storedTicket.queueType,
        regionPreferences: [...storedTicket.regionPreferences],
        playerMetadata: cloneQueuePlayerMetadata(storedTicket.playerMetadata),
        status: storedTicket.status,
        queuedAtMs: storedTicket.queuedAtMs,
        matchedAtMs: storedTicket.matchedAtMs,
        closedAtMs: storedTicket.closedAtMs,
        closedReason: storedTicket.closedReason,
        matchStart: storedTicket.matchStart ? cloneMatchStartPayload(storedTicket.matchStart) : undefined,
        sessionId: storedTicket.sessionId,
      };
      this.ticketsById.set(ticket.ticketId, ticket);
      if (ticket.status !== 'closed') {
        this.activeTicketByAccountQueue.set(
          this.getAccountQueueKey(ticket.accountId, ticket.queueType),
          ticket.ticketId,
        );
      }
      if (ticket.status === 'queued') {
        this.addToRegionBuckets(ticket);
      }
    }

    for (const storedSession of snapshot.sessions) {
      if (storedSession.ticketIds.length !== 2 || storedSession.participants.length !== 2) {
        throw new Error(`Invalid matchmaking session snapshot: ${storedSession.sessionId}`);
      }
      const participants = storedSession.participants.map((participant) => ({
        accountId: participant.accountId,
        queueTicketId: participant.queueTicketId,
        side: participant.side,
        selectedCharacterId: participant.selectedCharacterId
          ?? this.ticketsById.get(participant.queueTicketId)?.playerMetadata.selectedCharacterId
          ?? null,
        sessionToken: participant.sessionToken,
        sessionTokenExpiresAtMs: participant.sessionTokenExpiresAtMs,
        connectionStatus: participant.connectionStatus,
        // Older snapshots predate liveness tracking. A restore grants one fresh
        // timeout window so process replacement cannot manufacture a forfeit.
        lastHeartbeatAtMs: participant.lastHeartbeatAtMs ?? snapshot.capturedAtMs,
        completionAttestedAtMs: participant.completionAttestedAtMs,
        disconnectedAtMs: participant.disconnectedAtMs,
        reconnectDeadlineAtMs: participant.reconnectDeadlineAtMs,
        usedReconnectAttemptIds: new Set(participant.usedReconnectAttemptIds),
      })) as [MatchSessionParticipantRecord, MatchSessionParticipantRecord];
      this.sessionsById.set(storedSession.sessionId, {
        sessionId: storedSession.sessionId,
        queueType: storedSession.queueType,
        region: storedSession.region,
        buildVersion: storedSession.buildVersion
          ?? normalizeBuildVersion(
            this.ticketsById.get(storedSession.ticketIds[0])?.playerMetadata.buildVersion,
          ),
        rulesetVersion: storedSession.rulesetVersion
          ?? normalizeBuildVersion(
            this.ticketsById.get(storedSession.ticketIds[0])?.playerMetadata.rulesetVersion,
          ),
        balanceProfileId: storedSession.balanceProfileId
          ?? normalizeBuildVersion(
            this.ticketsById.get(storedSession.ticketIds[0])?.playerMetadata.balanceProfileId,
          ),
        status: storedSession.status,
        resolvedReason: storedSession.resolvedReason,
        forfeitingAccountId: storedSession.forfeitingAccountId,
        createdAtMs: storedSession.createdAtMs,
        expiresAtMs: storedSession.expiresAtMs,
        resolvedAtMs: storedSession.resolvedAtMs,
        transportAttemptId: storedSession.transportAttemptId ?? randomUUID(),
        transportAttemptGeneration: storedSession.transportAttemptGeneration ?? 1,
        transportAttemptCreatedAtMs: storedSession.transportAttemptCreatedAtMs
          ?? snapshot.capturedAtMs,
        ticketIds: [...storedSession.ticketIds] as [string, string],
        participants,
      });
    }

    this.cleanup(this.now());
  }

  public getConfig(): {
    queueTypes: QueueType[];
    regions: RegionId[];
    ticketTtlSeconds: number;
    sessionTtlSeconds: number;
    sessionTokenTtlSeconds: number;
    reconnectGraceSeconds: number;
    heartbeatIntervalSeconds: number;
    heartbeatTimeoutSeconds: number;
    maxResidentTickets: number;
  } {
    return {
      queueTypes: [...QUEUE_TYPES],
      regions: [...SUPPORTED_REGIONS],
      ticketTtlSeconds: Math.floor(this.ticketTtlMs / 1000),
      sessionTtlSeconds: Math.floor(this.sessionTtlMs / 1000),
      sessionTokenTtlSeconds: Math.floor(this.sessionTokenTtlMs / 1000),
      reconnectGraceSeconds: Math.floor(this.reconnectGraceMs / 1000),
      heartbeatIntervalSeconds: Math.floor(this.heartbeatIntervalMs / 1000),
      heartbeatTimeoutSeconds: Math.floor(this.heartbeatTimeoutMs / 1000),
      maxResidentTickets: this.maxResidentTickets,
    };
  }

  public getActiveTicketForAccountQueue(
    accountId: string,
    queueType: QueueType,
  ): QueueTicketView | null {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const accountQueueKey = this.getAccountQueueKey(accountId, queueType);
    const ticketId = this.activeTicketByAccountQueue.get(accountQueueKey);
    if (!ticketId) {
      return null;
    }
    const ticket = this.ticketsById.get(ticketId);
    if (!ticket || ticket.status === 'closed') {
      this.activeTicketByAccountQueue.delete(accountQueueKey);
      return null;
    }
    return this.toTicketView(ticket);
  }

  public join(request: QueueJoinRequest): QueueTicketView {
    const nowMs = this.now();
    this.cleanup(nowMs);

    const accountQueueKey = this.getAccountQueueKey(request.accountId, request.queueType);
    const existingTicketId = this.activeTicketByAccountQueue.get(accountQueueKey);
    if (existingTicketId) {
      const existingTicket = this.ticketsById.get(existingTicketId);
      if (existingTicket && existingTicket.status !== 'closed') {
        this.tryMatchFromTicket(existingTicket.ticketId, nowMs);
        return this.toTicketView(existingTicket);
      }
      this.activeTicketByAccountQueue.delete(accountQueueKey);
    }

    if (this.ticketsById.size >= this.maxResidentTickets) {
      throw new MatchmakingCapacityError(this.maxResidentTickets);
    }

    const ticket: QueueTicketRecord = {
      ticketId: randomUUID(),
      accountId: request.accountId,
      queueType: request.queueType,
      regionPreferences: uniqueRegionsInOrder(request.regionPreferences),
      playerMetadata: request.playerMetadata ?? {},
      status: 'queued',
      queuedAtMs: nowMs,
    };

    this.ticketsById.set(ticket.ticketId, ticket);
    this.activeTicketByAccountQueue.set(accountQueueKey, ticket.ticketId);
    this.addToRegionBuckets(ticket);
    this.tryMatchFromTicket(ticket.ticketId, nowMs);

    const storedTicket = this.ticketsById.get(ticket.ticketId);
    if (!storedTicket) {
      throw new Error('Queue ticket disappeared unexpectedly.');
    }
    return this.toTicketView(storedTicket);
  }

  public getTicketForAccount(ticketId: string, accountId: string): QueueTicketView | null {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const ticket = this.ticketsById.get(ticketId);
    if (!ticket || ticket.accountId !== accountId) {
      return null;
    }
    // The route holds the runtime lease and persists this bounded matching attempt.
    this.tryMatchFromTicket(ticket.ticketId, nowMs);
    return this.toTicketView(ticket);
  }

  public getSessionForAccount(sessionId: string, accountId: string): MatchSessionView | null {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return null;
    }
    const participant = this.findParticipant(session, accountId);
    if (!participant) {
      return null;
    }
    return this.toSessionView(session);
  }

  public getResolvedSessions(): MatchSessionView[] {
    const nowMs = this.now();
    this.cleanup(nowMs);
    return [...this.sessionsById.values()]
      .filter((session) => session.status === 'resolved')
      .map((session) => this.toSessionView(session));
  }

  public advanceTransportAttempt(
    request: SessionTransportAttemptAdvanceRequest,
  ): SessionActionResult<MatchSessionView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(request.sessionId);
    if (!session) {
      return this.error('not_found', 'Session not found.');
    }
    const participant = this.findParticipant(session, request.accountId);
    if (!participant) {
      return this.error('forbidden', 'Session does not contain this account.');
    }
    if (session.status !== 'active') {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > participant.sessionTokenExpiresAtMs) {
      return this.error('token_expired', 'Session token has expired.');
    }
    if (participant.sessionToken !== request.sessionToken) {
      return this.error('invalid_token', 'Session token is invalid.');
    }
    if (!Number.isSafeInteger(request.expectedGeneration) || request.expectedGeneration < 1) {
      return this.error('stale_transport_attempt', 'Transport attempt generation is invalid.');
    }
    if (request.expectedGeneration > session.transportAttemptGeneration) {
      return this.error('stale_transport_attempt', 'Transport attempt generation is ahead of the server.');
    }
    if (request.expectedGeneration === session.transportAttemptGeneration) {
      session.transportAttemptGeneration += 1;
      session.transportAttemptId = randomUUID();
      session.transportAttemptCreatedAtMs = nowMs;
    }
    return { ok: true, value: this.toSessionView(session) };
  }

  public markSessionDisconnected(sessionId: string, accountId: string): SessionActionResult<MatchSessionView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return this.error('not_found', 'Session not found.');
    }
    const participant = this.findParticipant(session, accountId);
    if (!participant) {
      return this.error('forbidden', 'Session does not contain this account.');
    }
    if (session.status !== 'active') {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (participant.connectionStatus === 'disconnected') {
      return { ok: true, value: this.toSessionView(session) };
    }

    participant.connectionStatus = 'disconnected';
    participant.disconnectedAtMs = nowMs;
    participant.reconnectDeadlineAtMs = nowMs + this.reconnectGraceMs;
    return { ok: true, value: this.toSessionView(session) };
  }

  public heartbeatSession(
    sessionId: string,
    accountId: string,
    sessionToken: string,
  ): SessionActionResult<MatchSessionView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return this.error('not_found', 'Session not found.');
    }
    const participant = this.findParticipant(session, accountId);
    if (!participant) {
      return this.error('forbidden', 'Session does not contain this account.');
    }
    if (session.status !== 'active') {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > participant.sessionTokenExpiresAtMs) {
      return this.error('token_expired', 'Session token has expired.');
    }
    if (participant.sessionToken !== sessionToken) {
      return this.error('invalid_token', 'Session token is invalid.');
    }
    if (participant.connectionStatus === 'disconnected') {
      return this.error(
        'participant_disconnected',
        'Participant must complete reconnect before heartbeats can resume.',
      );
    }

    participant.lastHeartbeatAtMs = nowMs;
    return { ok: true, value: this.toSessionView(session) };
  }

  public validateSessionToken(
    sessionId: string,
    accountId: string,
    sessionToken: string,
    options: SessionTokenValidationOptions = {},
  ): SessionActionResult<MatchSessionView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return this.error('not_found', 'Session not found.');
    }
    const participant = this.findParticipant(session, accountId);
    if (!participant) {
      return this.error('forbidden', 'Session does not contain this account.');
    }
    if (session.status !== 'active' && !options.allowResolved) {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > participant.sessionTokenExpiresAtMs && !options.allowExpiredToken) {
      return this.error('token_expired', 'Session token has expired.');
    }
    if (participant.sessionToken !== sessionToken) {
      return this.error('invalid_token', 'Session token is invalid.');
    }
    return { ok: true, value: this.toSessionView(session) };
  }

  public reconnectSession(request: SessionReconnectRequest): SessionActionResult<MatchSessionView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(request.sessionId);
    if (!session) {
      return this.error('not_found', 'Session not found.');
    }
    const participant = this.findParticipant(session, request.accountId);
    if (!participant) {
      return this.error('forbidden', 'Session does not contain this account.');
    }
    if (session.status !== 'active') {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > participant.sessionTokenExpiresAtMs) {
      return this.error('token_expired', 'Session token has expired.');
    }
    if (participant.sessionToken !== request.sessionToken) {
      return this.error('invalid_token', 'Session token is invalid.');
    }
    if (participant.usedReconnectAttemptIds.has(request.reconnectAttemptId)) {
      return this.error('replayed_attempt', 'Reconnect attempt id has already been used.');
    }
    participant.usedReconnectAttemptIds.add(request.reconnectAttemptId);
    participant.connectionStatus = 'connected';
    participant.lastHeartbeatAtMs = nowMs;
    participant.disconnectedAtMs = undefined;
    participant.reconnectDeadlineAtMs = undefined;
    return { ok: true, value: this.toSessionView(session) };
  }

  public completeSession(sessionId: string, accountId: string, sessionToken: string): SessionActionResult<MatchSessionView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return this.error('not_found', 'Session not found.');
    }
    const participant = this.findParticipant(session, accountId);
    if (!participant) {
      return this.error('forbidden', 'Session does not contain this account.');
    }
    const alreadyCompleted = session.status === 'resolved' && session.resolvedReason === 'completed';
    if (session.status !== 'active' && !alreadyCompleted) {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > participant.sessionTokenExpiresAtMs) {
      return this.error('token_expired', 'Session token has expired.');
    }
    if (participant.sessionToken !== sessionToken) {
      return this.error('invalid_token', 'Session token is invalid.');
    }
    if (alreadyCompleted) {
      return { ok: true, value: this.toSessionView(session) };
    }

    participant.completionAttestedAtMs ??= nowMs;
    if (session.participants.every(({ completionAttestedAtMs }) => completionAttestedAtMs !== undefined)) {
      this.resolveSession(session, nowMs, 'completed');
    }
    return { ok: true, value: this.toSessionView(session) };
  }

  public leaveTicket(ticketId: string, accountId: string): QueueTicketView | null {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const ticket = this.ticketsById.get(ticketId);
    if (!ticket || ticket.accountId !== accountId) {
      return null;
    }

    if (ticket.status === 'closed') {
      return this.toTicketView(ticket);
    }

    if (ticket.status === 'queued') {
      this.removeFromRegionBuckets(ticket);
      this.closeTicket(ticket, 'left_queue', nowMs);
      return this.toTicketView(ticket);
    }

    if (ticket.status === 'matched' && ticket.sessionId) {
      const session = this.sessionsById.get(ticket.sessionId);
      if (session) {
        this.resolveSession(session, nowMs, 'peer_left', accountId);
      }
      this.closeTicket(ticket, 'left_queue', nowMs);
    }

    return this.toTicketView(ticket);
  }

  private tryMatchFromTicket(ticketId: string, nowMs: number): void {
    const sourceTicket = this.ticketsById.get(ticketId);
    if (!sourceTicket || sourceTicket.status !== 'queued') {
      return;
    }

    const candidate = this.findBestCandidate(sourceTicket, nowMs);
    if (!candidate) {
      return;
    }

    this.createMatch(sourceTicket, candidate.ticket, candidate.region, nowMs, candidate.diagnostics);
  }

  private findBestCandidate(sourceTicket: QueueTicketRecord, nowMs: number): CandidateMatch | null {
    let bestMatch: CandidateMatch | null = null;
    const seenCandidates = new Set<string>();

    for (const sourceRegion of sourceTicket.regionPreferences) {
      const bucketKey = createBucketKey(sourceTicket.queueType, sourceRegion);
      const candidateTicketIds = this.regionBuckets.get(bucketKey) ?? [];
      for (const candidateTicketId of candidateTicketIds) {
        if (candidateTicketId === sourceTicket.ticketId || seenCandidates.has(candidateTicketId)) {
          continue;
        }
        seenCandidates.add(candidateTicketId);
        const candidateTicket = this.ticketsById.get(candidateTicketId);
        if (!candidateTicket || candidateTicket.status !== 'queued') {
          continue;
        }
        if (!haveCompatibleClientVersions(sourceTicket, candidateTicket)) {
          continue;
        }

        const region = this.resolveSharedRegion(sourceTicket, candidateTicket);
        if (!region) {
          continue;
        }

        const regionScore = this.computeRegionScore(sourceTicket, candidateTicket, region);
        let diagnostics: MatchStartPayload['diagnostics'] = {
          skillTrack: 'unranked',
          expectedGap: null,
          matchedGap: null,
          waitSeconds: Math.floor(Math.max(nowMs - sourceTicket.queuedAtMs, nowMs - candidateTicket.queuedAtMs) / 1000),
          regionConstraintRelaxed: false,
        };
        let skillPenalty = 0;
        if (sourceTicket.queueType === 'ranked') {
          const rankedBand = this.evaluateRankedBand(sourceTicket, candidateTicket, region, nowMs);
          if (!rankedBand) {
            continue;
          }
          diagnostics = rankedBand.diagnostics;
          skillPenalty = rankedBand.skillPenalty;
        }
        const score = regionScore * 1000 + skillPenalty;
        if (!bestMatch) {
          bestMatch = { ticket: candidateTicket, region, score, diagnostics };
          continue;
        }

        if (score < bestMatch.score) {
          bestMatch = { ticket: candidateTicket, region, score, diagnostics };
          continue;
        }

        if (score === bestMatch.score && candidateTicket.queuedAtMs < bestMatch.ticket.queuedAtMs) {
          bestMatch = { ticket: candidateTicket, region, score, diagnostics };
        }
      }
    }

    return bestMatch;
  }

  private resolveSharedRegion(first: QueueTicketRecord, second: QueueTicketRecord): RegionId | null {
    let bestRegion: RegionId | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const region of first.regionPreferences) {
      const secondIndex = second.regionPreferences.indexOf(region);
      if (secondIndex < 0) {
        continue;
      }
      const score = first.regionPreferences.indexOf(region) + secondIndex;
      if (score < bestScore) {
        bestScore = score;
        bestRegion = region;
      }
    }
    return bestRegion;
  }

  private computeRegionScore(first: QueueTicketRecord, second: QueueTicketRecord, region: RegionId): number {
    const firstRank = first.regionPreferences.indexOf(region);
    const secondRank = second.regionPreferences.indexOf(region);
    return firstRank + secondRank;
  }

  private evaluateRankedBand(
    sourceTicket: QueueTicketRecord,
    candidateTicket: QueueTicketRecord,
    region: RegionId,
    nowMs: number,
  ): { diagnostics: MatchStartPayload['diagnostics']; skillPenalty: number } | null {
    const sourceSnapshot = this.getRankedSnapshot(sourceTicket);
    const candidateSnapshot = this.getRankedSnapshot(candidateTicket);
    const sourceIsMaster = sourceSnapshot.mrPoints !== null;
    const candidateIsMaster = candidateSnapshot.mrPoints !== null;
    if (sourceIsMaster !== candidateIsMaster) {
      return null;
    }

    const waitSeconds = Math.max(0, Math.floor(
      Math.max(nowMs - sourceTicket.queuedAtMs, nowMs - candidateTicket.queuedAtMs) / 1000,
    ));
    const isMasterTrack = sourceIsMaster && candidateIsMaster;
    const baseGap = isMasterTrack ? this.rankedMasterInitialGap : this.rankedRatingInitialGap;
    const expansionPerSecond = isMasterTrack ? this.rankedMasterExpansionPerSecond : this.rankedRatingExpansionPerSecond;
    const maxGap = isMasterTrack ? this.rankedMasterMaxGap : this.rankedRatingMaxGap;
    const expectedGap = Math.min(maxGap, Math.round(baseGap + waitSeconds * expansionPerSecond));
    const matchedGap = isMasterTrack
      ? Math.abs((sourceSnapshot.mrPoints as number) - (candidateSnapshot.mrPoints as number))
      : Math.abs(sourceSnapshot.rating - candidateSnapshot.rating);
    if (matchedGap > expectedGap) {
      return null;
    }

    let regionConstraintRelaxed = false;
    if (isMasterTrack) {
      if (waitSeconds < this.rankedMasterStrictRegionSeconds) {
        const sourcePrimary = sourceTicket.regionPreferences[0];
        const candidatePrimary = candidateTicket.regionPreferences[0];
        if (!(region === sourcePrimary && region === candidatePrimary)) {
          return null;
        }
      } else {
        regionConstraintRelaxed = true;
      }
    }

    return {
      diagnostics: {
        skillTrack: isMasterTrack ? 'master' : 'rating',
        expectedGap,
        matchedGap,
        waitSeconds,
        regionConstraintRelaxed,
      },
      skillPenalty: matchedGap,
    };
  }

  private getRankedSnapshot(ticket: QueueTicketRecord): { rating: number; mrPoints: number | null } {
    const snapshot = ticket.playerMetadata.rankedSnapshot;
    const rating = typeof snapshot?.rating === 'number' && Number.isFinite(snapshot.rating)
      ? snapshot.rating
      : 1200;
    const mrPoints = typeof snapshot?.mrPoints === 'number' && Number.isFinite(snapshot.mrPoints)
      ? snapshot.mrPoints
      : null;
    return {
      rating,
      mrPoints,
    };
  }

  private createMatch(
    first: QueueTicketRecord,
    second: QueueTicketRecord,
    region: RegionId,
    nowMs: number,
    diagnostics: MatchStartPayload['diagnostics'],
  ): void {
    const [p1Ticket, p2Ticket] = [first, second].sort((a, b) => {
      if (a.queuedAtMs !== b.queuedAtMs) {
        return a.queuedAtMs - b.queuedAtMs;
      }
      return a.ticketId.localeCompare(b.ticketId);
    });

    const sessionId = randomUUID();
    const createdAt = new Date(nowMs).toISOString();
    const sessionExpiresAtMs = nowMs + this.sessionTtlMs;
    const sessionTokenExpiresAtMs = nowMs + this.sessionTokenTtlMs;
    const session: MatchSessionRecord = {
      sessionId,
      queueType: first.queueType,
      region,
      buildVersion: normalizeBuildVersion(first.playerMetadata.buildVersion),
      rulesetVersion: normalizeBuildVersion(first.playerMetadata.rulesetVersion),
      balanceProfileId: normalizeBuildVersion(first.playerMetadata.balanceProfileId),
      status: 'active',
      createdAtMs: nowMs,
      expiresAtMs: sessionExpiresAtMs,
      transportAttemptId: randomUUID(),
      transportAttemptGeneration: 1,
      transportAttemptCreatedAtMs: nowMs,
      ticketIds: [first.ticketId, second.ticketId],
      participants: [
        {
          accountId: p1Ticket.accountId,
          queueTicketId: p1Ticket.ticketId,
          side: 'P1',
          selectedCharacterId: p1Ticket.playerMetadata.selectedCharacterId ?? null,
          sessionToken: randomBytes(16).toString('hex'),
          sessionTokenExpiresAtMs,
          connectionStatus: 'connected',
          lastHeartbeatAtMs: nowMs,
          usedReconnectAttemptIds: new Set<string>(),
        },
        {
          accountId: p2Ticket.accountId,
          queueTicketId: p2Ticket.ticketId,
          side: 'P2',
          selectedCharacterId: p2Ticket.playerMetadata.selectedCharacterId ?? null,
          sessionToken: randomBytes(16).toString('hex'),
          sessionTokenExpiresAtMs,
          connectionStatus: 'connected',
          lastHeartbeatAtMs: nowMs,
          usedReconnectAttemptIds: new Set<string>(),
        },
      ],
    };
    this.sessionsById.set(sessionId, session);

    const p1Local = buildMatchPlayerMetadata(p1Ticket, 'P1');
    const p2Local = buildMatchPlayerMetadata(p2Ticket, 'P2');
    const p1Participant = session.participants[0];
    const p2Participant = session.participants[1];
    const expiresAt = new Date(sessionExpiresAtMs).toISOString();
    const tokenExpiresAt = new Date(sessionTokenExpiresAtMs).toISOString();

    const p1Payload: MatchStartPayload = {
      sessionId,
      sessionToken: p1Participant.sessionToken,
      sessionTokenExpiresAt: tokenExpiresAt,
      heartbeatIntervalSeconds: Math.floor(this.heartbeatIntervalMs / 1000),
      heartbeatTimeoutSeconds: Math.floor(this.heartbeatTimeoutMs / 1000),
      reconnectGraceSeconds: Math.floor(this.reconnectGraceMs / 1000),
      buildVersion: session.buildVersion,
      rulesetVersion: session.rulesetVersion,
      balanceProfileId: session.balanceProfileId,
      queueType: first.queueType,
      region,
      createdAt,
      expiresAt,
      transportAttempt: this.toTransportAttemptView(session),
      localPlayer: p1Local,
      peer: p2Local,
      diagnostics,
    };

    const p2Payload: MatchStartPayload = {
      sessionId,
      sessionToken: p2Participant.sessionToken,
      sessionTokenExpiresAt: tokenExpiresAt,
      heartbeatIntervalSeconds: Math.floor(this.heartbeatIntervalMs / 1000),
      heartbeatTimeoutSeconds: Math.floor(this.heartbeatTimeoutMs / 1000),
      reconnectGraceSeconds: Math.floor(this.reconnectGraceMs / 1000),
      buildVersion: session.buildVersion,
      rulesetVersion: session.rulesetVersion,
      balanceProfileId: session.balanceProfileId,
      queueType: first.queueType,
      region,
      createdAt,
      expiresAt,
      transportAttempt: this.toTransportAttemptView(session),
      localPlayer: p2Local,
      peer: p1Local,
      diagnostics,
    };

    this.removeFromRegionBuckets(first);
    this.removeFromRegionBuckets(second);

    first.status = 'matched';
    first.matchedAtMs = nowMs;
    first.matchStart = first.ticketId === p1Ticket.ticketId ? p1Payload : p2Payload;
    first.sessionId = sessionId;

    second.status = 'matched';
    second.matchedAtMs = nowMs;
    second.matchStart = second.ticketId === p1Ticket.ticketId ? p1Payload : p2Payload;
    second.sessionId = sessionId;
  }

  private addToRegionBuckets(ticket: QueueTicketRecord): void {
    for (const region of ticket.regionPreferences) {
      const bucketKey = createBucketKey(ticket.queueType, region);
      const bucket = this.regionBuckets.get(bucketKey) ?? [];
      bucket.push(ticket.ticketId);
      this.regionBuckets.set(bucketKey, bucket);
    }
  }

  private removeFromRegionBuckets(ticket: QueueTicketRecord): void {
    for (const region of ticket.regionPreferences) {
      const bucketKey = createBucketKey(ticket.queueType, region);
      const bucket = this.regionBuckets.get(bucketKey);
      if (!bucket) {
        continue;
      }
      const filtered = bucket.filter((id) => id !== ticket.ticketId);
      if (filtered.length > 0) {
        this.regionBuckets.set(bucketKey, filtered);
      } else {
        this.regionBuckets.delete(bucketKey);
      }
    }
  }

  private closeTicket(ticket: QueueTicketRecord, reason: QueueTicketClosedReason, nowMs: number): void {
    this.removeFromRegionBuckets(ticket);
    ticket.status = 'closed';
    ticket.closedReason = reason;
    ticket.closedAtMs = nowMs;
    ticket.matchStart = undefined;
    ticket.sessionId = undefined;
    this.activeTicketByAccountQueue.delete(this.getAccountQueueKey(ticket.accountId, ticket.queueType));
  }

  private cleanup(nowMs: number): void {
    const tickets = [...this.ticketsById.values()];
    for (const ticket of tickets) {
      if (ticket.status === 'queued' && nowMs - ticket.queuedAtMs > this.ticketTtlMs) {
        this.closeTicket(ticket, 'expired', nowMs);
        continue;
      }

      if (ticket.status === 'closed' && ticket.closedAtMs !== undefined && nowMs - ticket.closedAtMs > this.closedRetentionMs) {
        this.ticketsById.delete(ticket.ticketId);
      }
    }

    const sessions = [...this.sessionsById.values()];
    for (const session of sessions) {
      if (session.status === 'active') {
        for (const participant of session.participants) {
          if (
            participant.connectionStatus === 'connected'
            && nowMs > participant.lastHeartbeatAtMs + this.heartbeatTimeoutMs
          ) {
            const heartbeatExpiredAtMs = participant.lastHeartbeatAtMs + this.heartbeatTimeoutMs;
            participant.connectionStatus = 'disconnected';
            participant.disconnectedAtMs = heartbeatExpiredAtMs;
            participant.reconnectDeadlineAtMs = heartbeatExpiredAtMs + this.reconnectGraceMs;
          }
        }
        const timedOutParticipants = session.participants
          .filter(
            (participant) => participant.reconnectDeadlineAtMs !== undefined
              && nowMs > participant.reconnectDeadlineAtMs,
          )
          .sort((first, second) => (
            (first.reconnectDeadlineAtMs as number) - (second.reconnectDeadlineAtMs as number)
            || first.accountId.localeCompare(second.accountId)
          ));
        const earliestReconnectDeadlineMs = timedOutParticipants[0]?.reconnectDeadlineAtMs;
        const sessionExpired = nowMs > session.expiresAtMs;
        if (
          earliestReconnectDeadlineMs !== undefined
          && (!sessionExpired || earliestReconnectDeadlineMs < session.expiresAtMs)
        ) {
          const earliestTimedOutParticipants = timedOutParticipants.filter(
            (participant) => participant.reconnectDeadlineAtMs === earliestReconnectDeadlineMs,
          );
          this.resolveSession(
            session,
            earliestReconnectDeadlineMs,
            'reconnect_timeout',
            earliestTimedOutParticipants.length === 1
              ? earliestTimedOutParticipants[0].accountId
              : undefined,
          );
          continue;
        }
        if (sessionExpired) {
          this.resolveSession(session, session.expiresAtMs, 'session_expired');
          continue;
        }
      }

      if (session.status === 'resolved' && session.resolvedAtMs !== undefined && nowMs - session.resolvedAtMs > this.closedRetentionMs) {
        this.sessionsById.delete(session.sessionId);
      }
    }
  }

  private resolveSession(
    session: MatchSessionRecord,
    nowMs: number,
    reason: MatchSessionResolvedReason,
    forfeitingAccountId?: string,
  ): void {
    if (session.status === 'resolved') {
      return;
    }
    session.status = 'resolved';
    session.resolvedReason = reason;
    session.forfeitingAccountId = forfeitingAccountId;
    session.resolvedAtMs = nowMs;

    const closeReason: QueueTicketClosedReason = reason === 'reconnect_timeout'
      ? 'reconnect_timeout'
      : reason === 'completed'
        ? 'session_completed'
        : reason === 'peer_left'
          ? 'peer_left'
          : 'session_expired';
    for (const participant of session.participants) {
      const ticket = this.ticketsById.get(participant.queueTicketId);
      if (ticket && ticket.status !== 'closed') {
        this.closeTicket(ticket, closeReason, nowMs);
      }
    }
    this.onSessionResolved(session.sessionId, reason, this.toSessionView(session));
  }

  private findParticipant(session: MatchSessionRecord, accountId: string): MatchSessionParticipantRecord | null {
    return session.participants.find((participant) => participant.accountId === accountId) ?? null;
  }

  private toTicketView(ticket: QueueTicketRecord): QueueTicketView {
    return {
      ticketId: ticket.ticketId,
      accountId: ticket.accountId,
      queueType: ticket.queueType,
      regionPreferences: [...ticket.regionPreferences],
      status: ticket.status,
      queuedAt: new Date(ticket.queuedAtMs).toISOString(),
      matchedAt: ticket.matchedAtMs ? new Date(ticket.matchedAtMs).toISOString() : undefined,
      closedAt: ticket.closedAtMs ? new Date(ticket.closedAtMs).toISOString() : undefined,
      closedReason: ticket.closedReason,
      matchStart: ticket.matchStart
        ? cloneMatchStartPayload(ticket.matchStart)
        : undefined,
    };
  }

  private toSessionView(session: MatchSessionRecord): MatchSessionView {
    return {
      sessionId: session.sessionId,
      queueType: session.queueType,
      region: session.region,
      buildVersion: session.buildVersion,
      rulesetVersion: session.rulesetVersion,
      balanceProfileId: session.balanceProfileId,
      status: session.status,
      resolvedReason: session.resolvedReason,
      resolvedAt: session.resolvedAtMs ? new Date(session.resolvedAtMs).toISOString() : undefined,
      forfeitingAccountId: session.forfeitingAccountId,
      createdAt: new Date(session.createdAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      reconnectGraceSeconds: Math.floor(this.reconnectGraceMs / 1000),
      transportAttempt: this.toTransportAttemptView(session),
      participants: session.participants.map((participant) => ({
        accountId: participant.accountId,
        queueTicketId: participant.queueTicketId,
        side: participant.side,
        selectedCharacterId: participant.selectedCharacterId,
        connectionStatus: participant.connectionStatus,
        lastHeartbeatAt: new Date(participant.lastHeartbeatAtMs).toISOString(),
        completionAttestedAt: participant.completionAttestedAtMs !== undefined
          ? new Date(participant.completionAttestedAtMs).toISOString()
          : undefined,
        disconnectedAt: participant.disconnectedAtMs ? new Date(participant.disconnectedAtMs).toISOString() : undefined,
        reconnectDeadlineAt: participant.reconnectDeadlineAtMs ? new Date(participant.reconnectDeadlineAtMs).toISOString() : undefined,
      })),
    };
  }

  private toTransportAttemptView(session: MatchSessionRecord): MatchSessionTransportAttemptView {
    return {
      attemptId: session.transportAttemptId,
      generation: session.transportAttemptGeneration,
      createdAt: new Date(session.transportAttemptCreatedAtMs).toISOString(),
    };
  }

  private error(code: SessionActionErrorCode, message: string): SessionActionResult<never> {
    return {
      ok: false,
      error: {
        code,
        message,
      },
    };
  }

  private getAccountQueueKey(accountId: string, queueType: QueueType): string {
    return `${accountId}:${queueType}`;
  }
}

export function createMatchmakingQueueService(options: QueueServiceOptions = {}): MatchmakingQueueService {
  return new MatchmakingQueueService(options);
}
