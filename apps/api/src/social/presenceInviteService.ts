import { randomUUID } from 'node:crypto';

export type PresenceStatus = 'online' | 'away' | 'offline';
export type PresenceActivityType = 'home' | 'queue' | 'room' | 'match' | 'offline';

export interface PresenceActivityQueue {
  type: 'queue';
  queueType: 'ranked' | 'unranked';
}

export interface PresenceActivityRoom {
  type: 'room';
  inRoom: true;
}

export interface PresenceActivitySimple {
  type: 'home' | 'match' | 'offline';
}

export type PresenceActivityView = PresenceActivityQueue | PresenceActivityRoom | PresenceActivitySimple;

export interface PresenceEntry {
  accountId: string;
  status: PresenceStatus;
  activity: PresenceActivityView;
  updatedAt: string;
}

export interface PresenceActivityInput {
  type: PresenceActivityType;
  queueType?: 'ranked' | 'unranked' | null;
  roomCode?: string | null;
}

interface PresenceActivityRecord {
  type: PresenceActivityType;
  queueType: 'ranked' | 'unranked' | null;
  roomCode: string | null;
}

export type InviteContextType = 'queue' | 'room';

export interface PresenceInviteQueueContext {
  type: 'queue';
  queueType: 'ranked' | 'unranked';
}

export interface PresenceInviteRoomContext {
  type: 'room';
  roomCode: string;
}

export type PresenceInviteContext = PresenceInviteQueueContext | PresenceInviteRoomContext;

export interface PresenceInvitePayload {
  roomCode: string | null;
  queueType: 'ranked' | 'unranked' | null;
  deepLinks: {
    web: string;
    steam: string;
  };
}

export interface PresenceInvite {
  inviteId: string;
  fromAccountId: string;
  toAccountId: string;
  context: PresenceInviteContext;
  payload: PresenceInvitePayload;
  createdAt: string;
  expiresAt: string;
}

interface InviteRecord {
  invite: PresenceInvite;
  expiresAtMs: number;
}

interface RateWindowEntry {
  sentAtMs: number[];
}

interface PresenceRecord {
  activity: PresenceActivityRecord;
  status: PresenceStatus;
  updatedAtMs: number;
}

export interface SetPresenceResultOk {
  ok: true;
  presence: PresenceEntry;
}

export interface SetPresenceResultError {
  ok: false;
  code: 'rate_limited' | 'invalid_activity';
  message: string;
}

export type SetPresenceResult = SetPresenceResultOk | SetPresenceResultError;

export interface SendPresenceInviteRequest {
  fromAccountId: string;
  toAccountId: string;
  context: PresenceInviteContext;
}

export interface SendPresenceInviteResultOk {
  ok: true;
  invite: PresenceInvite;
}

export interface SendPresenceInviteResultError {
  ok: false;
  code: 'rate_limited' | 'invalid_target' | 'invalid_context';
  message: string;
}

export type SendPresenceInviteResult = SendPresenceInviteResultOk | SendPresenceInviteResultError;

export interface PresenceInviteServiceOptions {
  presenceTtlMs?: number;
  inviteTtlMs?: number;
  inviteRateWindowMs?: number;
  maxInvitesPerWindow?: number;
  presenceRateWindowMs?: number;
  maxPresenceUpdatesPerWindow?: number;
  webInviteBaseUrl?: string;
  steamAppId?: string;
  now?: () => number;
  idGenerator?: () => string;
}

const DEFAULT_PRESENCE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_INVITE_TTL_MS = 90 * 1000;
const DEFAULT_INVITE_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_INVITES_PER_WINDOW = 5;
const DEFAULT_PRESENCE_RATE_WINDOW_MS = 30 * 1000;
const DEFAULT_MAX_PRESENCE_UPDATES_PER_WINDOW = 12;
const DEFAULT_WEB_INVITE_BASE_URL = 'http://localhost:5173';
const DEFAULT_STEAM_APP_ID = '0';

function normaliseRoomCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isQueueType(value: string | null | undefined): value is 'ranked' | 'unranked' {
  return value === 'ranked' || value === 'unranked';
}

export class PresenceInviteService {
  private readonly presenceByAccountId = new Map<string, PresenceRecord>();
  private readonly invitesById = new Map<string, InviteRecord>();
  private readonly inviteRateBySender = new Map<string, RateWindowEntry>();
  private readonly presenceRateByAccount = new Map<string, RateWindowEntry>();
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly presenceTtlMs: number;
  private readonly inviteTtlMs: number;
  private readonly inviteRateWindowMs: number;
  private readonly maxInvitesPerWindow: number;
  private readonly presenceRateWindowMs: number;
  private readonly maxPresenceUpdatesPerWindow: number;
  private readonly webInviteBaseUrl: string;
  private readonly steamAppId: string;

  public constructor(options: PresenceInviteServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.presenceTtlMs = options.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS;
    this.inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
    this.inviteRateWindowMs = options.inviteRateWindowMs ?? DEFAULT_INVITE_RATE_WINDOW_MS;
    this.maxInvitesPerWindow = options.maxInvitesPerWindow ?? DEFAULT_MAX_INVITES_PER_WINDOW;
    this.presenceRateWindowMs = options.presenceRateWindowMs ?? DEFAULT_PRESENCE_RATE_WINDOW_MS;
    this.maxPresenceUpdatesPerWindow =
      options.maxPresenceUpdatesPerWindow ?? DEFAULT_MAX_PRESENCE_UPDATES_PER_WINDOW;
    this.webInviteBaseUrl = trimTrailingSlash(options.webInviteBaseUrl ?? DEFAULT_WEB_INVITE_BASE_URL);
    this.steamAppId = String(options.steamAppId ?? DEFAULT_STEAM_APP_ID).trim() || DEFAULT_STEAM_APP_ID;
  }

  public setPresence(
    accountId: string,
    status: PresenceStatus,
    activity: PresenceActivityInput,
  ): SetPresenceResult {
    this.pruneExpiredPresence();
    this.pruneRateLimits(this.presenceRateByAccount, this.presenceRateWindowMs);

    const normalisedActivity = this.normalisePresenceActivity(activity);
    if (!normalisedActivity) {
      return {
        ok: false,
        code: 'invalid_activity',
        message: 'Presence activity is invalid.',
      };
    }

    const nowMs = this.now();
    const rateWindow = this.presenceRateByAccount.get(accountId) ?? { sentAtMs: [] };
    rateWindow.sentAtMs.push(nowMs);
    this.presenceRateByAccount.set(accountId, rateWindow);
    if (rateWindow.sentAtMs.length > this.maxPresenceUpdatesPerWindow) {
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Presence update rate limit exceeded. Please wait before updating status.',
      };
    }

    const record: PresenceRecord = {
      status,
      activity: normalisedActivity,
      updatedAtMs: nowMs,
    };
    this.presenceByAccountId.set(accountId, record);

    return {
      ok: true,
      presence: this.toPresenceEntry(accountId, record),
    };
  }

  public getPresence(accountId: string): PresenceEntry | null {
    this.pruneExpiredPresence();
    const record = this.presenceByAccountId.get(accountId);
    if (!record) {
      return null;
    }
    return this.toPresenceEntry(accountId, record);
  }

  public listPresence(accountIds: string[]): PresenceEntry[] {
    this.pruneExpiredPresence();
    const values: PresenceEntry[] = [];
    for (const accountId of accountIds) {
      const record = this.presenceByAccountId.get(accountId);
      if (record) {
        values.push(this.toPresenceEntry(accountId, record));
      }
    }
    return values;
  }

  public sendInvite(request: SendPresenceInviteRequest): SendPresenceInviteResult {
    this.pruneExpiredInvites();
    this.pruneRateLimits(this.inviteRateBySender, this.inviteRateWindowMs);

    if (request.fromAccountId === request.toAccountId) {
      return {
        ok: false,
        code: 'invalid_target',
        message: 'Cannot send invite to yourself.',
      };
    }

    const context = this.normaliseInviteContext(request.context);
    if (!context) {
      return {
        ok: false,
        code: 'invalid_context',
        message: 'Invite context is invalid.',
      };
    }

    const nowMs = this.now();
    const rateWindow = this.inviteRateBySender.get(request.fromAccountId) ?? { sentAtMs: [] };
    rateWindow.sentAtMs.push(nowMs);
    this.inviteRateBySender.set(request.fromAccountId, rateWindow);
    if (rateWindow.sentAtMs.length > this.maxInvitesPerWindow) {
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Invite rate limit exceeded. Please wait before sending more invites.',
      };
    }

    const inviteId = this.idGenerator();
    const payload = this.buildInvitePayload(context);
    const invite: PresenceInvite = {
      inviteId,
      fromAccountId: request.fromAccountId,
      toAccountId: request.toAccountId,
      context,
      payload,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + this.inviteTtlMs).toISOString(),
    };

    this.invitesById.set(inviteId, {
      invite,
      expiresAtMs: nowMs + this.inviteTtlMs,
    });

    return {
      ok: true,
      invite,
    };
  }

  public listInvitesForTarget(accountId: string): PresenceInvite[] {
    this.pruneExpiredInvites();
    const invites: PresenceInvite[] = [];
    for (const record of this.invitesById.values()) {
      if (record.invite.toAccountId === accountId) {
        invites.push(record.invite);
      }
    }
    invites.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return invites;
  }

  public cancelInvite(inviteId: string, actorAccountId: string): boolean {
    this.pruneExpiredInvites();
    const invite = this.invitesById.get(inviteId)?.invite;
    if (!invite) {
      return false;
    }
    if (invite.fromAccountId !== actorAccountId && invite.toAccountId !== actorAccountId) {
      return false;
    }
    this.invitesById.delete(inviteId);
    return true;
  }

  private normalisePresenceActivity(activity: PresenceActivityInput): PresenceActivityRecord | null {
    if (!activity || typeof activity !== 'object') {
      return null;
    }
    const type = activity.type;
    if (!['home', 'queue', 'room', 'match', 'offline'].includes(type)) {
      return null;
    }

    if (type === 'queue') {
      if (!isQueueType(activity.queueType ?? null)) {
        return null;
      }
      return {
        type,
        queueType: activity.queueType,
        roomCode: null,
      };
    }

    if (type === 'room') {
      const roomCode = normaliseRoomCode(activity.roomCode ?? null);
      if (!roomCode || roomCode.length < 4 || roomCode.length > 12) {
        return null;
      }
      return {
        type,
        queueType: null,
        roomCode,
      };
    }

    return {
      type,
      queueType: null,
      roomCode: null,
    };
  }

  private normaliseInviteContext(context: PresenceInviteContext): PresenceInviteContext | null {
    if (context.type === 'queue') {
      if (!isQueueType(context.queueType)) {
        return null;
      }
      return {
        type: 'queue',
        queueType: context.queueType,
      };
    }

    const roomCode = normaliseRoomCode(context.roomCode);
    if (!roomCode || roomCode.length < 4 || roomCode.length > 12) {
      return null;
    }
    return {
      type: 'room',
      roomCode,
    };
  }

  private buildInvitePayload(context: PresenceInviteContext): PresenceInvitePayload {
    if (context.type === 'queue') {
      const queueType = context.queueType;
      return {
        roomCode: null,
        queueType,
        deepLinks: {
          web: `${this.webInviteBaseUrl}/?queue=${encodeURIComponent(queueType)}`,
          steam: `steam://run/${this.steamAppId}//+join_queue ${queueType}`,
        },
      };
    }

    const roomCode = context.roomCode;
    return {
      roomCode,
      queueType: null,
      deepLinks: {
        web: `${this.webInviteBaseUrl}/?room=${encodeURIComponent(roomCode)}`,
        steam: `steam://run/${this.steamAppId}//+join_room ${roomCode}`,
      },
    };
  }

  private toPresenceActivityView(activity: PresenceActivityRecord): PresenceActivityView {
    if (activity.type === 'queue' && activity.queueType) {
      return {
        type: 'queue',
        queueType: activity.queueType,
      };
    }
    if (activity.type === 'room') {
      return {
        type: 'room',
        inRoom: true,
      };
    }
    return {
      type: activity.type === 'offline' ? 'offline' : (activity.type as 'home' | 'match'),
    };
  }

  private toPresenceEntry(accountId: string, record: PresenceRecord): PresenceEntry {
    return {
      accountId,
      status: record.status,
      activity: this.toPresenceActivityView(record.activity),
      updatedAt: new Date(record.updatedAtMs).toISOString(),
    };
  }

  private pruneExpiredPresence(): void {
    const nowMs = this.now();
    for (const [accountId, record] of this.presenceByAccountId.entries()) {
      if (nowMs - record.updatedAtMs > this.presenceTtlMs) {
        this.presenceByAccountId.delete(accountId);
      }
    }
  }

  private pruneExpiredInvites(): void {
    const nowMs = this.now();
    for (const [inviteId, record] of this.invitesById.entries()) {
      if (record.expiresAtMs <= nowMs) {
        this.invitesById.delete(inviteId);
      }
    }
  }

  private pruneRateLimits(rateMap: Map<string, RateWindowEntry>, windowMs: number): void {
    const nowMs = this.now();
    for (const [accountId, rateWindow] of rateMap.entries()) {
      rateWindow.sentAtMs = rateWindow.sentAtMs.filter((sentAtMs) => nowMs - sentAtMs <= windowMs);
      if (rateWindow.sentAtMs.length === 0) {
        rateMap.delete(accountId);
      }
    }
  }
}

export function createPresenceInviteService(options: PresenceInviteServiceOptions = {}): PresenceInviteService {
  return new PresenceInviteService(options);
}
