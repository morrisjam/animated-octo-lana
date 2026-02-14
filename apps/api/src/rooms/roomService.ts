import { randomUUID } from 'node:crypto';

export type RoomPlatform = 'web' | 'steam';
export type RoomStatus = 'open' | 'active' | 'closed';
export type RoomCloseReason = 'host_closed' | 'idle_timeout';
export type RoomParticipantRole = 'player' | 'spectator';
export type RoomSessionPhase = 'character_select' | 'ready_check' | 'in_match' | 'completed';
export type RoomMatchOutcome = 'win' | 'draw' | 'forfeit';

export interface RoomParticipantView {
  accountId: string;
  platform: RoomPlatform;
  role: RoomParticipantRole;
  joinedAt: string;
}

export interface RoomSettingsView {
  locked: boolean;
  allowSpectators: boolean;
  requiredRegion: string | null;
  requiredBuildVersion: string | null;
}

export interface RoomSessionPlayerView {
  accountId: string;
  characterId: string | null;
  ready: boolean;
}

export interface RoomActiveSessionView {
  sessionId: string;
  rematchIndex: number;
  phase: RoomSessionPhase;
  startedAt: string;
  players: RoomSessionPlayerView[];
}

export interface RoomMatchHistoryEntryView {
  matchId: string;
  rematchIndex: number;
  outcome: RoomMatchOutcome;
  winnerAccountId: string | null;
  completedAt: string;
  players: Array<{
    accountId: string;
    characterId: string | null;
  }>;
}

export interface RoomView {
  roomCode: string;
  hostAccountId: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
  idleExpiresAt: string;
  closedAt?: string;
  closedReason?: RoomCloseReason;
  settings: RoomSettingsView;
  participants: RoomParticipantView[];
  activeSession?: RoomActiveSessionView;
  history: RoomMatchHistoryEntryView[];
}

export interface CreateRoomRequest {
  hostAccountId: string;
  hostPlatform: RoomPlatform;
  requiredRegion?: string | null;
  requiredBuildVersion?: string | null;
  allowSpectators?: boolean;
}

export interface JoinRoomRequest {
  roomCode: string;
  accountId: string;
  platform: RoomPlatform;
  role?: RoomParticipantRole;
  region?: string | null;
  buildVersion?: string | null;
}

export interface UpdateRoomSettingsRequest {
  roomCode: string;
  accountId: string;
  locked?: boolean;
  allowSpectators?: boolean;
}

export interface CharacterSelectRequest {
  roomCode: string;
  accountId: string;
  characterId: string;
}

export interface ReadyCheckRequest {
  roomCode: string;
  accountId: string;
  ready: boolean;
}

export interface RecordOutcomeRequest {
  roomCode: string;
  accountId: string;
  outcome: RoomMatchOutcome;
  winnerAccountId?: string | null;
}

export type InviteFlow = 'web_friend' | 'steam_friend';

export interface RoomInviteView {
  roomCode: string;
  platform: RoomPlatform;
  flow: InviteFlow;
  inviteValue: string;
}

export type RoomActionErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'room_closed'
  | 'room_full'
  | 'room_locked'
  | 'spectators_disabled'
  | 'region_mismatch'
  | 'version_mismatch'
  | 'invalid_platform'
  | 'already_active'
  | 'no_active_session'
  | 'invalid_phase'
  | 'invalid_character'
  | 'invalid_outcome'
  | 'insufficient_players';

export interface RoomActionError {
  code: RoomActionErrorCode;
  message: string;
}

export type RoomActionResult<T> = { ok: true; value: T } | { ok: false; error: RoomActionError };

export interface RoomServiceOptions {
  idleTimeoutSeconds?: number;
  closedRoomRetentionSeconds?: number;
  maxParticipants?: number;
  maxSpectators?: number;
  maxHistoryEntries?: number;
  webInviteBaseUrl?: string;
  steamAppId?: string;
  now?: () => number;
}

interface RoomParticipantRecord {
  accountId: string;
  platform: RoomPlatform;
  role: RoomParticipantRole;
  joinedAtMs: number;
}

interface RoomSessionPlayerRecord {
  accountId: string;
  characterId: string | null;
  ready: boolean;
}

interface RoomActiveSessionRecord {
  sessionId: string;
  rematchIndex: number;
  phase: RoomSessionPhase;
  startedAtMs: number;
  players: RoomSessionPlayerRecord[];
}

interface RoomMatchHistoryEntryRecord {
  matchId: string;
  rematchIndex: number;
  outcome: RoomMatchOutcome;
  winnerAccountId: string | null;
  completedAtMs: number;
  players: Array<{
    accountId: string;
    characterId: string | null;
  }>;
}

interface RoomSettingsRecord {
  locked: boolean;
  allowSpectators: boolean;
  requiredRegion: string | null;
  requiredBuildVersion: string | null;
}

interface RoomRecord {
  roomCode: string;
  hostAccountId: string;
  status: RoomStatus;
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs?: number;
  closedReason?: RoomCloseReason;
  settings: RoomSettingsRecord;
  participants: RoomParticipantRecord[];
  activeSession?: RoomActiveSessionRecord;
  history: RoomMatchHistoryEntryRecord[];
}

const DEFAULT_IDLE_TIMEOUT_SECONDS = 15 * 60;
const DEFAULT_CLOSED_RETENTION_SECONDS = 30 * 60;
const DEFAULT_MAX_PARTICIPANTS = 2;
const DEFAULT_MAX_SPECTATORS = 4;
const DEFAULT_MAX_HISTORY_ENTRIES = 20;
const DEFAULT_WEB_INVITE_BASE_URL = 'http://localhost:5173';
const DEFAULT_STEAM_APP_ID = '0';
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_CHARACTER_ID_LENGTH = 64;

function normaliseRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

function normaliseRegion(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  return normalised.length > 0 ? normalised : null;
}

function normaliseBuildVersion(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalised = value.trim();
  return normalised.length > 0 ? normalised : null;
}

function buildRoomCode(): string {
  let output = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    output += ROOM_CODE_ALPHABET[index];
  }
  return output;
}

export function isRoomPlatform(value: string | undefined): value is RoomPlatform {
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === 'web' || normalised === 'steam';
}

export function isRoomParticipantRole(value: string | undefined): value is RoomParticipantRole {
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === 'player' || normalised === 'spectator';
}

export function isRoomMatchOutcome(value: string | undefined): value is RoomMatchOutcome {
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === 'win' || normalised === 'draw' || normalised === 'forfeit';
}

export class RoomService {
  private readonly now: () => number;

  private readonly idleTimeoutMs: number;

  private readonly closedRetentionMs: number;

  private readonly maxParticipants: number;

  private readonly maxSpectators: number;

  private readonly maxHistoryEntries: number;

  private readonly webInviteBaseUrl: string;

  private readonly steamAppId: string;

  private readonly roomsByCode = new Map<string, RoomRecord>();

  public constructor(options: RoomServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idleTimeoutMs = (options.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS) * 1000;
    this.closedRetentionMs = (options.closedRoomRetentionSeconds ?? DEFAULT_CLOSED_RETENTION_SECONDS) * 1000;
    this.maxParticipants = options.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
    this.maxSpectators = options.maxSpectators ?? DEFAULT_MAX_SPECTATORS;
    this.maxHistoryEntries = options.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    this.webInviteBaseUrl = (options.webInviteBaseUrl ?? DEFAULT_WEB_INVITE_BASE_URL).replace(/\/+$/, '');
    this.steamAppId = options.steamAppId?.trim() || DEFAULT_STEAM_APP_ID;
  }

  public getConfig(): {
    idleTimeoutSeconds: number;
    maxParticipants: number;
    maxSpectators: number;
    maxHistoryEntries: number;
    webInviteBaseUrl: string;
    steamAppId: string;
  } {
    return {
      idleTimeoutSeconds: Math.floor(this.idleTimeoutMs / 1000),
      maxParticipants: this.maxParticipants,
      maxSpectators: this.maxSpectators,
      maxHistoryEntries: this.maxHistoryEntries,
      webInviteBaseUrl: this.webInviteBaseUrl,
      steamAppId: this.steamAppId,
    };
  }

  public createRoom(request: CreateRoomRequest): RoomView {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const roomCode = this.generateUniqueRoomCode();
    const room: RoomRecord = {
      roomCode,
      hostAccountId: request.hostAccountId,
      status: 'open',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      settings: {
        locked: false,
        allowSpectators: request.allowSpectators ?? false,
        requiredRegion: normaliseRegion(request.requiredRegion),
        requiredBuildVersion: normaliseBuildVersion(request.requiredBuildVersion),
      },
      participants: [
        {
          accountId: request.hostAccountId,
          platform: request.hostPlatform,
          role: 'player',
          joinedAtMs: nowMs,
        },
      ],
      history: [],
    };
    this.roomsByCode.set(roomCode, room);
    return this.toRoomView(room);
  }

  public getRoomForAccount(roomCode: string, accountId: string): RoomView | null {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(roomCode));
    if (!room) {
      return null;
    }
    const isParticipant = room.participants.some((participant) => participant.accountId === accountId);
    if (!isParticipant) {
      return null;
    }
    return this.toRoomView(room);
  }

  public updateRoomSettings(request: UpdateRoomSettingsRequest): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(request.roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.hostAccountId !== request.accountId) {
      return this.error('forbidden', 'Only the host can update room settings.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }

    if (typeof request.locked === 'boolean') {
      room.settings.locked = request.locked;
    }
    if (typeof request.allowSpectators === 'boolean') {
      room.settings.allowSpectators = request.allowSpectators;
    }
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  public joinRoom(request: JoinRoomRequest): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(request.roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }

    const requestedRole: RoomParticipantRole = request.role ?? 'player';
    const incomingRegion = normaliseRegion(request.region);
    const incomingBuildVersion = normaliseBuildVersion(request.buildVersion);

    if (room.settings.requiredRegion && incomingRegion !== room.settings.requiredRegion) {
      return this.error('region_mismatch', `Room requires region ${room.settings.requiredRegion}.`);
    }
    if (room.settings.requiredBuildVersion && incomingBuildVersion !== room.settings.requiredBuildVersion) {
      return this.error('version_mismatch', `Room requires build ${room.settings.requiredBuildVersion}.`);
    }

    const existingParticipant = room.participants.find((participant) => participant.accountId === request.accountId);
    if (existingParticipant) {
      if (requestedRole === 'spectator' && !room.settings.allowSpectators) {
        return this.error('spectators_disabled', 'Host has disabled spectators in this room.');
      }
      existingParticipant.platform = request.platform;
      existingParticipant.role = requestedRole;
      room.updatedAtMs = nowMs;
      return { ok: true, value: this.toRoomView(room) };
    }

    if (room.settings.locked && request.accountId !== room.hostAccountId) {
      return this.error('room_locked', 'Host has locked this room.');
    }

    if (requestedRole === 'spectator') {
      if (!room.settings.allowSpectators) {
        return this.error('spectators_disabled', 'Host has disabled spectators in this room.');
      }
      const spectatorCount = room.participants.filter((participant) => participant.role === 'spectator').length;
      if (spectatorCount >= this.maxSpectators) {
        return this.error('room_full', 'Room spectator capacity is full.');
      }
    } else {
      const playerCount = room.participants.filter((participant) => participant.role === 'player').length;
      if (playerCount >= this.maxParticipants) {
        return this.error('room_full', 'Room player capacity is full.');
      }
    }

    room.participants.push({
      accountId: request.accountId,
      platform: request.platform,
      role: requestedRole,
      joinedAtMs: nowMs,
    });
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  public startRoomSession(roomCode: string, accountId: string): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.hostAccountId !== accountId) {
      return this.error('forbidden', 'Only the host can start a room session.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }
    if (room.activeSession && room.activeSession.phase !== 'completed') {
      return this.error('already_active', 'Room session is already active.');
    }
    return this.beginNewSession(room, nowMs, room.activeSession ? room.activeSession.rematchIndex + 1 : 1);
  }

  public setCharacterSelection(request: CharacterSelectRequest): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(request.roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }
    if (!room.activeSession) {
      return this.error('no_active_session', 'No active room session.');
    }
    if (room.activeSession.phase !== 'character_select' && room.activeSession.phase !== 'ready_check') {
      return this.error('invalid_phase', 'Character selection is not open in current session phase.');
    }

    const characterId = request.characterId.trim();
    if (!characterId || characterId.length > MAX_CHARACTER_ID_LENGTH) {
      return this.error('invalid_character', 'characterId must be 1 to 64 characters.');
    }

    const playerState = room.activeSession.players.find((player) => player.accountId === request.accountId);
    if (!playerState) {
      return this.error('forbidden', 'Only active player participants can set character selection.');
    }

    playerState.characterId = characterId;
    playerState.ready = false;

    if (room.activeSession.players.every((player) => player.characterId !== null)) {
      room.activeSession.phase = 'ready_check';
    } else {
      room.activeSession.phase = 'character_select';
    }
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  public setReadyState(request: ReadyCheckRequest): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(request.roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }
    if (!room.activeSession) {
      return this.error('no_active_session', 'No active room session.');
    }
    if (room.activeSession.phase !== 'ready_check') {
      return this.error('invalid_phase', 'Ready checks are not open in current session phase.');
    }

    const playerState = room.activeSession.players.find((player) => player.accountId === request.accountId);
    if (!playerState) {
      return this.error('forbidden', 'Only active player participants can update ready state.');
    }
    if (!playerState.characterId) {
      return this.error('invalid_phase', 'Set character selection before setting ready state.');
    }

    playerState.ready = request.ready;
    if (room.activeSession.players.every((player) => player.ready)) {
      room.activeSession.phase = 'in_match';
    }
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  public recordMatchOutcome(request: RecordOutcomeRequest): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(request.roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.hostAccountId !== request.accountId) {
      return this.error('forbidden', 'Only the host can record match outcomes.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }
    if (!room.activeSession) {
      return this.error('no_active_session', 'No active room session.');
    }
    if (room.activeSession.phase !== 'in_match') {
      return this.error('invalid_phase', 'Match outcome can only be recorded after ready checks complete.');
    }

    const winnerAccountId = request.winnerAccountId ?? null;
    const validPlayerIds = new Set(room.activeSession.players.map((player) => player.accountId));
    if (request.outcome === 'win') {
      if (!winnerAccountId || !validPlayerIds.has(winnerAccountId)) {
        return this.error('invalid_outcome', 'Win outcome requires winnerAccountId for an active player.');
      }
    } else if (winnerAccountId !== null && !validPlayerIds.has(winnerAccountId)) {
      return this.error('invalid_outcome', 'winnerAccountId must reference an active player when provided.');
    }

    const historyEntry: RoomMatchHistoryEntryRecord = {
      matchId: room.activeSession.sessionId,
      rematchIndex: room.activeSession.rematchIndex,
      outcome: request.outcome,
      winnerAccountId,
      completedAtMs: nowMs,
      players: room.activeSession.players.map((player) => ({
        accountId: player.accountId,
        characterId: player.characterId,
      })),
    };
    room.history.push(historyEntry);
    if (room.history.length > this.maxHistoryEntries) {
      room.history = room.history.slice(room.history.length - this.maxHistoryEntries);
    }

    room.activeSession.phase = 'completed';
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  public startRematch(roomCode: string, accountId: string): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.hostAccountId !== accountId) {
      return this.error('forbidden', 'Only the host can start a rematch.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }
    if (!room.activeSession) {
      return this.error('no_active_session', 'No active session exists. Start a room session first.');
    }
    if (room.activeSession.phase !== 'completed') {
      return this.error('invalid_phase', 'Rematch can only start after previous match outcome is recorded.');
    }
    return this.beginNewSession(room, nowMs, room.activeSession.rematchIndex + 1);
  }

  public closeRoom(roomCode: string, accountId: string): RoomActionResult<RoomView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    if (room.hostAccountId !== accountId) {
      return this.error('forbidden', 'Only the host can close the room.');
    }
    if (room.status === 'closed') {
      return { ok: true, value: this.toRoomView(room) };
    }
    room.status = 'closed';
    room.closedReason = 'host_closed';
    room.closedAtMs = nowMs;
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  public getInvite(roomCode: string, accountId: string, platform: RoomPlatform): RoomActionResult<RoomInviteView> {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const room = this.roomsByCode.get(normaliseRoomCode(roomCode));
    if (!room) {
      return this.error('not_found', 'Room not found.');
    }
    const isParticipant = room.participants.some((participant) => participant.accountId === accountId);
    if (!isParticipant) {
      return this.error('forbidden', 'Only room participants can request invites.');
    }
    if (room.status === 'closed') {
      return this.error('room_closed', 'Room is closed.');
    }
    room.updatedAtMs = nowMs;

    if (platform === 'web') {
      return {
        ok: true,
        value: {
          roomCode: room.roomCode,
          platform: 'web',
          flow: 'web_friend',
          inviteValue: `${this.webInviteBaseUrl}/?room=${room.roomCode}`,
        },
      };
    }

    return {
      ok: true,
      value: {
        roomCode: room.roomCode,
        platform: 'steam',
        flow: 'steam_friend',
        inviteValue: `steam://run/${this.steamAppId}//+join_room ${room.roomCode}`,
      },
    };
  }

  private beginNewSession(room: RoomRecord, nowMs: number, rematchIndex: number): RoomActionResult<RoomView> {
    const playerParticipants = room.participants.filter((participant) => participant.role === 'player');
    if (playerParticipants.length < 2) {
      return this.error('insufficient_players', 'Room needs at least two player participants to start session.');
    }

    room.activeSession = {
      sessionId: randomUUID(),
      rematchIndex,
      phase: 'character_select',
      startedAtMs: nowMs,
      players: playerParticipants.map((participant) => ({
        accountId: participant.accountId,
        characterId: null,
        ready: false,
      })),
    };
    room.status = 'active';
    room.updatedAtMs = nowMs;
    return { ok: true, value: this.toRoomView(room) };
  }

  private cleanup(nowMs: number): void {
    const rooms = [...this.roomsByCode.values()];
    for (const room of rooms) {
      if (room.status !== 'closed' && nowMs - room.updatedAtMs > this.idleTimeoutMs) {
        room.status = 'closed';
        room.closedReason = 'idle_timeout';
        room.closedAtMs = nowMs;
        room.updatedAtMs = nowMs;
      }
      if (room.status === 'closed' && room.closedAtMs !== undefined && nowMs - room.closedAtMs > this.closedRetentionMs) {
        this.roomsByCode.delete(room.roomCode);
      }
    }
  }

  private toRoomView(room: RoomRecord): RoomView {
    const idleExpiryMs = room.updatedAtMs + this.idleTimeoutMs;
    return {
      roomCode: room.roomCode,
      hostAccountId: room.hostAccountId,
      status: room.status,
      createdAt: new Date(room.createdAtMs).toISOString(),
      updatedAt: new Date(room.updatedAtMs).toISOString(),
      idleExpiresAt: new Date(idleExpiryMs).toISOString(),
      closedAt: room.closedAtMs ? new Date(room.closedAtMs).toISOString() : undefined,
      closedReason: room.closedReason,
      settings: {
        locked: room.settings.locked,
        allowSpectators: room.settings.allowSpectators,
        requiredRegion: room.settings.requiredRegion,
        requiredBuildVersion: room.settings.requiredBuildVersion,
      },
      participants: room.participants.map((participant) => ({
        accountId: participant.accountId,
        platform: participant.platform,
        role: participant.role,
        joinedAt: new Date(participant.joinedAtMs).toISOString(),
      })),
      activeSession: room.activeSession
        ? {
          sessionId: room.activeSession.sessionId,
          rematchIndex: room.activeSession.rematchIndex,
          phase: room.activeSession.phase,
          startedAt: new Date(room.activeSession.startedAtMs).toISOString(),
          players: room.activeSession.players.map((player) => ({
            accountId: player.accountId,
            characterId: player.characterId,
            ready: player.ready,
          })),
        }
        : undefined,
      history: room.history.map((entry) => ({
        matchId: entry.matchId,
        rematchIndex: entry.rematchIndex,
        outcome: entry.outcome,
        winnerAccountId: entry.winnerAccountId,
        completedAt: new Date(entry.completedAtMs).toISOString(),
        players: entry.players.map((player) => ({
          accountId: player.accountId,
          characterId: player.characterId,
        })),
      })),
    };
  }

  private generateUniqueRoomCode(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = buildRoomCode();
      if (!this.roomsByCode.has(candidate)) {
        return candidate;
      }
    }
    return randomUUID().replace(/-/g, '').slice(0, ROOM_CODE_LENGTH).toUpperCase();
  }

  private error(code: RoomActionErrorCode, message: string): RoomActionResult<never> {
    return {
      ok: false,
      error: {
        code,
        message,
      },
    };
  }
}

export function createRoomService(options: RoomServiceOptions = {}): RoomService {
  return new RoomService(options);
}
