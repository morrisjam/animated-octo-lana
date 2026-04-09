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
  | 'session_completed';

export interface QueuePlayerMetadata {
  displayName?: string | null;
  platform?: 'web' | 'steam' | null;
  buildVersion?: string | null;
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
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
  expiresAt: string;
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

export interface MatchSessionParticipantView {
  accountId: string;
  queueTicketId: string;
  side: 'P1' | 'P2';
  connectionStatus: SessionConnectionStatus;
  disconnectedAt?: string;
  reconnectDeadlineAt?: string;
}

export interface MatchSessionView {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  status: MatchSessionStatus;
  resolvedReason?: MatchSessionResolvedReason;
  createdAt: string;
  expiresAt: string;
  reconnectGraceSeconds: number;
  participants: MatchSessionParticipantView[];
}

export interface SessionReconnectRequest {
  sessionId: string;
  accountId: string;
  sessionToken: string;
  reconnectAttemptId: string;
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
  | 'replayed_attempt';

export interface SessionActionError {
  code: SessionActionErrorCode;
  message: string;
}

export type SessionActionResult<T> = { ok: true; value: T } | { ok: false; error: SessionActionError };

export interface QueueServiceOptions {
  ticketTtlSeconds?: number;
  sessionTtlSeconds?: number;
  sessionTokenTtlSeconds?: number;
  reconnectGraceSeconds?: number;
  closedTicketRetentionSeconds?: number;
  rankedRatingInitialGap?: number;
  rankedRatingExpansionPerSecond?: number;
  rankedRatingMaxGap?: number;
  rankedMasterInitialGap?: number;
  rankedMasterExpansionPerSecond?: number;
  rankedMasterMaxGap?: number;
  rankedMasterStrictRegionSeconds?: number;
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
  sessionToken: string;
  sessionTokenExpiresAtMs: number;
  connectionStatus: SessionConnectionStatus;
  disconnectedAtMs?: number;
  reconnectDeadlineAtMs?: number;
  usedReconnectAttemptIds: Set<string>;
}

interface MatchSessionRecord {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  status: MatchSessionStatus;
  resolvedReason?: MatchSessionResolvedReason;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  ticketIds: [string, string];
  participants: [MatchSessionParticipantRecord, MatchSessionParticipantRecord];
}

interface CandidateMatch {
  ticket: QueueTicketRecord;
  region: RegionId;
  score: number;
  diagnostics: MatchStartPayload['diagnostics'];
}

const DEFAULT_TICKET_TTL_SECONDS = 90;
const DEFAULT_SESSION_TTL_SECONDS = 30;
const DEFAULT_RECONNECT_GRACE_SECONDS = 10;
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

export class MatchmakingQueueService {
  private readonly ticketTtlMs: number;

  private readonly sessionTtlMs: number;

  private readonly sessionTokenTtlMs: number;

  private readonly reconnectGraceMs: number;

  private readonly closedRetentionMs: number;

  private readonly rankedRatingInitialGap: number;

  private readonly rankedRatingExpansionPerSecond: number;

  private readonly rankedRatingMaxGap: number;

  private readonly rankedMasterInitialGap: number;

  private readonly rankedMasterExpansionPerSecond: number;

  private readonly rankedMasterMaxGap: number;

  private readonly rankedMasterStrictRegionSeconds: number;

  private readonly now: () => number;

  private readonly ticketsById = new Map<string, QueueTicketRecord>();

  private readonly sessionsById = new Map<string, MatchSessionRecord>();

  private readonly activeTicketByAccountQueue = new Map<string, string>();

  private readonly regionBuckets = new Map<string, string[]>();

  public constructor(options: QueueServiceOptions = {}) {
    this.ticketTtlMs = (options.ticketTtlSeconds ?? DEFAULT_TICKET_TTL_SECONDS) * 1000;
    this.sessionTtlMs = (options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
    this.sessionTokenTtlMs = (options.sessionTokenTtlSeconds ?? options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
    this.reconnectGraceMs = (options.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS) * 1000;
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
    this.now = options.now ?? (() => Date.now());
  }

  public getConfig(): {
    queueTypes: QueueType[];
    regions: RegionId[];
    ticketTtlSeconds: number;
    sessionTtlSeconds: number;
    sessionTokenTtlSeconds: number;
    reconnectGraceSeconds: number;
  } {
    return {
      queueTypes: [...QUEUE_TYPES],
      regions: [...SUPPORTED_REGIONS],
      ticketTtlSeconds: Math.floor(this.ticketTtlMs / 1000),
      sessionTtlSeconds: Math.floor(this.sessionTtlMs / 1000),
      sessionTokenTtlSeconds: Math.floor(this.sessionTokenTtlMs / 1000),
      reconnectGraceSeconds: Math.floor(this.reconnectGraceMs / 1000),
    };
  }

  public join(request: QueueJoinRequest): QueueTicketView {
    const nowMs = this.now();
    this.cleanup(nowMs);

    const accountQueueKey = this.getAccountQueueKey(request.accountId, request.queueType);
    const existingTicketId = this.activeTicketByAccountQueue.get(accountQueueKey);
    if (existingTicketId) {
      const existingTicket = this.ticketsById.get(existingTicketId);
      if (existingTicket && existingTicket.status !== 'closed') {
        return this.toTicketView(existingTicket);
      }
      this.activeTicketByAccountQueue.delete(accountQueueKey);
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

    participant.connectionStatus = 'disconnected';
    participant.disconnectedAtMs = nowMs;
    participant.reconnectDeadlineAtMs = nowMs + this.reconnectGraceMs;
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
    if (session.status !== 'active') {
      return this.error('session_resolved', 'Session has already resolved.');
    }
    if (nowMs > participant.sessionTokenExpiresAtMs) {
      return this.error('token_expired', 'Session token has expired.');
    }
    if (participant.sessionToken !== sessionToken) {
      return this.error('invalid_token', 'Session token is invalid.');
    }
    this.resolveSession(session, nowMs, 'completed');
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
        session.status = 'resolved';
        session.resolvedAtMs = nowMs;
        session.resolvedReason = 'peer_left';
        const peerTicketId = session.ticketIds.find((id) => id !== ticket.ticketId);
        if (peerTicketId) {
          const peerTicket = this.ticketsById.get(peerTicketId);
          if (peerTicket && peerTicket.status !== 'closed') {
            this.closeTicket(peerTicket, 'peer_left', nowMs);
          }
        }
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
      status: 'active',
      createdAtMs: nowMs,
      expiresAtMs: sessionExpiresAtMs,
      ticketIds: [first.ticketId, second.ticketId],
      participants: [
        {
          accountId: p1Ticket.accountId,
          queueTicketId: p1Ticket.ticketId,
          side: 'P1',
          sessionToken: randomBytes(16).toString('hex'),
          sessionTokenExpiresAtMs,
          connectionStatus: 'connected',
          usedReconnectAttemptIds: new Set<string>(),
        },
        {
          accountId: p2Ticket.accountId,
          queueTicketId: p2Ticket.ticketId,
          side: 'P2',
          sessionToken: randomBytes(16).toString('hex'),
          sessionTokenExpiresAtMs,
          connectionStatus: 'connected',
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
      queueType: first.queueType,
      region,
      createdAt,
      expiresAt,
      localPlayer: p1Local,
      peer: p2Local,
      diagnostics,
    };

    const p2Payload: MatchStartPayload = {
      sessionId,
      sessionToken: p2Participant.sessionToken,
      sessionTokenExpiresAt: tokenExpiresAt,
      queueType: first.queueType,
      region,
      createdAt,
      expiresAt,
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
        if (nowMs > session.expiresAtMs) {
          this.resolveSession(session, nowMs, 'session_expired');
          continue;
        }
        if (session.participants.some((participant) => participant.reconnectDeadlineAtMs !== undefined && nowMs > participant.reconnectDeadlineAtMs)) {
          this.resolveSession(session, nowMs, 'reconnect_timeout');
          continue;
        }
      }

      if (session.status === 'resolved' && session.resolvedAtMs !== undefined && nowMs - session.resolvedAtMs > this.closedRetentionMs) {
        this.sessionsById.delete(session.sessionId);
      }
    }
  }

  private resolveSession(session: MatchSessionRecord, nowMs: number, reason: MatchSessionResolvedReason): void {
    if (session.status === 'resolved') {
      return;
    }
    session.status = 'resolved';
    session.resolvedReason = reason;
    session.resolvedAtMs = nowMs;

    const closeReason: QueueTicketClosedReason = reason === 'reconnect_timeout'
      ? 'reconnect_timeout'
      : reason === 'completed'
        ? 'session_completed'
        : 'session_expired';
    for (const participant of session.participants) {
      const ticket = this.ticketsById.get(participant.queueTicketId);
      if (ticket && ticket.status !== 'closed') {
        this.closeTicket(ticket, closeReason, nowMs);
      }
    }
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
        ? {
          ...ticket.matchStart,
          localPlayer: { ...ticket.matchStart.localPlayer, preferredRegions: [...ticket.matchStart.localPlayer.preferredRegions] },
          peer: { ...ticket.matchStart.peer, preferredRegions: [...ticket.matchStart.peer.preferredRegions] },
          diagnostics: { ...ticket.matchStart.diagnostics },
        }
        : undefined,
    };
  }

  private toSessionView(session: MatchSessionRecord): MatchSessionView {
    return {
      sessionId: session.sessionId,
      queueType: session.queueType,
      region: session.region,
      status: session.status,
      resolvedReason: session.resolvedReason,
      createdAt: new Date(session.createdAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      reconnectGraceSeconds: Math.floor(this.reconnectGraceMs / 1000),
      participants: session.participants.map((participant) => ({
        accountId: participant.accountId,
        queueTicketId: participant.queueTicketId,
        side: participant.side,
        connectionStatus: participant.connectionStatus,
        disconnectedAt: participant.disconnectedAtMs ? new Date(participant.disconnectedAtMs).toISOString() : undefined,
        reconnectDeadlineAt: participant.reconnectDeadlineAtMs ? new Date(participant.reconnectDeadlineAtMs).toISOString() : undefined,
      })),
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
