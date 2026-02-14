import { createCombinedInput } from './input/combined';
import { createGamepadInput } from './input/gamepad';
import { createKeyboardInput } from './input/keyboard';
import { loadRuntimeConfig } from './config/features';
import { createInputTimelineBuffer } from './net/inputTimeline';
import {
  RollbackSession,
  type RollbackDiagnosticsSnapshot,
} from './net/rollbackSession';
import { CHARACTER_BY_ID, DEFAULT_CHARACTER_LOADOUT, type CharacterId } from './sim/characters';
import { createPlatformServices, type PlatformAuthSession } from './platform';
import { validateReplayPayload } from './sim/replay';
import { buildReplayReviewData, type ReplayReviewData } from './sim/replayReview';
import { createInitialState, getRenderSnapshot, step } from './sim/sim';
import { sanitiseTuning } from './sim/tuning';
import type { PlayerId, PlayersById } from './sim/types';
import { createHud, type RollbackDiagnosticsView } from './view/hud';
import { createPauseMenu } from './view/pauseMenu';
import { createOnlineDevMenu, type OnlineDiagnosticsUpdate, type OnlineDevSectionId } from './view/onlineDevMenu';
import { createOnlineDiagnosticsOverlay } from './view/onlineDiagnosticsOverlay';
import { createReplayViewer } from './view/replayViewer';
import { renderFrame } from './view/render';
import { createScene, resizeScene } from './view/scene';
import {
  createStartMenu,
  type GameMode,
  type OnlineDevMenuTarget,
  type OnlineRankedViewState,
  type OnlineRoomViewState,
  type WebAuthMenuAction,
  type WebAuthMenuRequest,
} from './view/startMenu';

type AppPhase = 'home' | 'playing' | 'round_transition' | 'match_over' | 'replay_review' | 'online_dev';
interface StoredSettings {
  mode?: string;
  loadout?: {
    P1?: string;
    P2?: string;
  };
}
interface LoadedSettings {
  mode: GameMode;
  loadout: PlayersById<CharacterId>;
}

const SETTINGS_STORAGE_KEY = 'gravity_well.settings.v1';
const ROLLBACK_DIAGNOSTICS_STORAGE_KEY = 'gravity_well.rollback_diagnostics.v1';
const platform = createPlatformServices();
const runtimeConfig = loadRuntimeConfig();

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Missing #game canvas element');
}

const matchInfo = document.querySelector<HTMLDivElement>('#matchInfo');
const hudRoot = document.querySelector<HTMLDivElement>('#hud');
if (!matchInfo || !hudRoot) {
  throw new Error('Missing HUD match elements');
}

const sceneContext = createScene(canvas);
const hud = createHud();
const input = createCombinedInput([
  createKeyboardInput(),
  createGamepadInput(),
]);
const enabledModes = getEnabledModes();
const loadedSettings = loadSettings();
let selectedLoadout: PlayersById<CharacterId> = loadedSettings.loadout;
const seedParam = new URLSearchParams(window.location.search).get('seed');
const forcedSeed = seedParam !== null ? Number(seedParam) : undefined;
let selectedMatchSeed = Number.isFinite(forcedSeed) ? (forcedSeed as number) : 1;
let selectedMode: GameMode = loadedSettings.mode;
let state = createInitialState({
  loadout: selectedLoadout,
  seed: selectedMatchSeed,
  rules: getRulesForMode(selectedMode),
});
let appPhase: AppPhase = 'home';
let p1RoundWins = 0;
let p2RoundWins = 0;
let roundTransitionRemaining = 0;
let simulationFrame = 0;
const inputTimeline = createInputTimelineBuffer({ maxFrames: 60 * 20 });
const enableRollbackScaffold = (import.meta.env.VITE_FEATURE_ROLLBACK_SCAFFOLD ?? 'false').toLowerCase() === 'true';
let rollbackSession: RollbackSession | null = null;

interface StoredRollbackDiagnosticsEntry {
  capturedAt: string;
  reason: string;
  mode: GameMode;
  seed: number;
  diagnostics: RollbackDiagnosticsSnapshot;
}

type QueueType = 'unranked' | 'ranked';
type RegionId = 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';

interface MatchStartPayload {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
}

interface QueueTicketView {
  ticketId: string;
  accountId: string;
  queueType: QueueType;
  regionPreferences: RegionId[];
  status: 'queued' | 'matched' | 'closed';
  queuedAt: string;
  matchedAt?: string;
  closedAt?: string;
  closedReason?: string;
  matchStart?: MatchStartPayload;
}

interface MatchSessionView {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  status: 'active' | 'resolved';
  createdAt: string;
  expiresAt?: string;
  participants: Array<{
    accountId: string;
    side: 'P1' | 'P2';
    connectionStatus: 'connected' | 'disconnected';
  }>;
}

interface RoomView {
  roomCode: string;
  hostAccountId: string;
  status: 'open' | 'active' | 'closed';
  participants: Array<{
    accountId: string;
    role: 'player' | 'spectator';
  }>;
  activeSession?: {
    sessionId: string;
    phase: 'character_select' | 'ready_check' | 'in_match' | 'completed';
  };
}

const pauseMenu = createPauseMenu({
  getTuning: () => state.tuning,
  setTuning: (tuning) => {
    state.tuning = sanitiseTuning(tuning);
  },
  enableDebugTab: runtimeConfig.features.debugToolsEnabled,
  onRestartTraining: () => {
    restartTrainingRound();
  },
});
pauseMenu.setCanRestartTraining(selectedMode === 'training');
const replayViewer = createReplayViewer({
  onTogglePause: () => {
    replayPaused = !replayPaused;
    replayAccumulator = 0;
  },
  onStep: (direction) => {
    stepReplayFrame(direction);
  },
  onAdjustSpeed: (direction) => {
    adjustReplaySpeed(direction);
  },
  onJumpRound: (roundIndex) => {
    jumpReplayRound(roundIndex);
  },
  onSeek: (frameIndex) => {
    setReplayFrameIndex(frameIndex);
    replayPaused = true;
  },
  onExit: () => {
    exitReplayReview();
  },
});
const matchmakingApiBase = (
  (import.meta.env.VITE_MATCHMAKING_API_BASE as string | undefined)?.trim()
  || (import.meta.env.VITE_PROFILE_API_BASE as string | undefined)?.trim()
  || ''
);
const diagnosticsBuildId = (
  (import.meta.env.VITE_APP_BUILD as string | undefined)?.trim()
  || (import.meta.env.VITE_COMMIT_SHA as string | undefined)?.trim()
  || 'dev-local'
);
const diagnosticsRulesetVersion = (
  (import.meta.env.VITE_RULESET_VERSION as string | undefined)?.trim()
  || 'prototype-2026.02'
);
const diagnosticsEnabled = platform.kind === 'web' && runtimeConfig.features.onlineDiagnosticsEnabled;
let onlineDiagnosticsUpdate: OnlineDiagnosticsUpdate = {
  ticketId: null,
  sessionId: null,
  queueType: null,
  region: null,
  queueWaitMs: null,
  connectionPath: 'unknown',
  rttMs: null,
  packetLossPercent: null,
  participantAccountIds: [],
};
const diagnosticsOverlay = diagnosticsEnabled ? createOnlineDiagnosticsOverlay() : null;
const onlineDevMenuEnabled = platform.kind === 'web' && runtimeConfig.features.onlineDevMenuEnabled;
const onlineDevMenu = onlineDevMenuEnabled
  ? createOnlineDevMenu({
    apiBase: matchmakingApiBase,
    getAccountId: () => sessionAccountId,
    onOpenReplayPayload: async ({ replayId, payload }) => {
      const opened = beginReplayReviewFromPayload(payload, `archive:${replayId}`);
      if (!opened) {
        throw new Error(`Replay payload validation failed for ${replayId}.`);
      }
    },
    onDiagnosticsUpdate: (update) => {
      onlineDiagnosticsUpdate = update;
    },
    onClose: () => {
      closeOnlineDevMenu();
    },
  })
  : null;

function getOnlineAccountIdOrThrow(): string {
  if (!sessionAccountId) {
    throw new Error('Sign in or continue as guest first, then retry.');
  }
  return sessionAccountId;
}

async function parseOnlineApiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error ?? body.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function requestOnlineJson<T>(
  method: 'GET' | 'POST',
  path: string,
  accountId: string,
  body?: unknown,
): Promise<T> {
  if (!matchmakingApiBase) {
    throw new Error('Missing VITE_MATCHMAKING_API_BASE or VITE_PROFILE_API_BASE.');
  }
  const headers: Record<string, string> = {
    'x-account-id': accountId,
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${matchmakingApiBase}${path}`, {
    method,
    headers,
    body: payload,
  });
  if (!response.ok) {
    throw new Error(await parseOnlineApiError(response));
  }
  return await response.json() as T;
}

function getQueueWaitMs(queuedAt: string | undefined): number | null {
  if (!queuedAt) {
    return null;
  }
  const queuedAtMs = Date.parse(queuedAt);
  if (!Number.isFinite(queuedAtMs)) {
    return null;
  }
  return Math.max(0, Date.now() - queuedAtMs);
}

function toRankedViewState(ticket: QueueTicketView | null, session: MatchSessionView | null): OnlineRankedViewState {
  if (!ticket) {
    return {
      headline: 'Not queued',
      detail: 'Press "Join Ranked Queue" to start matchmaking.',
    };
  }
  if (ticket.status === 'queued') {
    const waitMs = getQueueWaitMs(ticket.queuedAt);
    const waitLabel = waitMs !== null ? `${Math.floor(waitMs / 1000)}s` : 'unknown';
    return {
      headline: 'Searching for match',
      detail: `Ticket: ${ticket.ticketId}\nQueue: ${ticket.queueType}\nWait: ${waitLabel}`,
    };
  }
  if (ticket.status === 'matched') {
    const participantLine = session?.participants?.length
      ? `Participants: ${session.participants.map((item) => item.accountId).join(', ')}`
      : 'Participants: pending';
    return {
      headline: 'Match found',
      detail: `Ticket: ${ticket.ticketId}\nSession: ${ticket.matchStart?.sessionId ?? session?.sessionId ?? 'pending'}\n${participantLine}`,
    };
  }
  return {
    headline: 'Queue closed',
    detail: `Ticket: ${ticket.ticketId}\nReason: ${ticket.closedReason ?? 'closed'}`,
  };
}

function toRoomViewState(room: RoomView | null, fallbackRoomCode?: string): OnlineRoomViewState {
  if (!room) {
    return {
      headline: 'No room loaded',
      detail: 'Create a room or enter a code to join one.',
      roomCode: fallbackRoomCode ?? null,
    };
  }
  const players = room.participants.filter((item) => item.role === 'player').length;
  const spectators = room.participants.filter((item) => item.role === 'spectator').length;
  return {
    headline: `Room ${room.roomCode} (${room.status})`,
    detail: `Host: ${room.hostAccountId}\nPlayers: ${players}\nSpectators: ${spectators}\nSession: ${room.activeSession?.sessionId ?? 'none'}`,
    roomCode: room.roomCode,
  };
}

async function joinRankedQueue(): Promise<OnlineRankedViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  playerRankedTicket = await requestOnlineJson<QueueTicketView>(
    'POST',
    '/matchmaking/queue/join',
    accountId,
    {
      queueType: 'ranked',
      regionPreferences: ['us-east', 'us-west', 'eu-west'],
      buildVersion: '0.1.0-web',
      platform: 'web',
    },
  );
  if (playerRankedTicket.matchStart?.sessionId) {
    playerRankedSession = await requestOnlineJson<MatchSessionView>(
      'GET',
      `/matchmaking/sessions/${playerRankedTicket.matchStart.sessionId}`,
      accountId,
    );
  } else {
    playerRankedSession = null;
  }
  return toRankedViewState(playerRankedTicket, playerRankedSession);
}

async function refreshRankedQueue(): Promise<OnlineRankedViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  if (!playerRankedTicket) {
    return toRankedViewState(null, null);
  }
  playerRankedTicket = await requestOnlineJson<QueueTicketView>(
    'GET',
    `/matchmaking/queue/tickets/${playerRankedTicket.ticketId}`,
    accountId,
  );
  if (playerRankedTicket.matchStart?.sessionId) {
    playerRankedSession = await requestOnlineJson<MatchSessionView>(
      'GET',
      `/matchmaking/sessions/${playerRankedTicket.matchStart.sessionId}`,
      accountId,
    );
  } else {
    playerRankedSession = null;
  }
  return toRankedViewState(playerRankedTicket, playerRankedSession);
}

async function leaveRankedQueue(): Promise<OnlineRankedViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  if (!playerRankedTicket) {
    return toRankedViewState(null, null);
  }
  playerRankedTicket = await requestOnlineJson<QueueTicketView>(
    'POST',
    '/matchmaking/queue/leave',
    accountId,
    { ticketId: playerRankedTicket.ticketId },
  );
  playerRankedSession = null;
  return toRankedViewState(playerRankedTicket, playerRankedSession);
}

async function createCustomRoom(): Promise<OnlineRoomViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  playerRoom = await requestOnlineJson<RoomView>('POST', '/rooms', accountId, {
    platform: 'web',
    allowSpectators: true,
  });
  return toRoomViewState(playerRoom);
}

async function joinCustomRoom(roomCode: string): Promise<OnlineRoomViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  playerRoom = await requestOnlineJson<RoomView>(
    'POST',
    `/rooms/${roomCode}/join`,
    accountId,
    {
      platform: 'web',
      role: 'player',
    },
  );
  return toRoomViewState(playerRoom);
}

async function refreshCustomRoom(roomCode: string): Promise<OnlineRoomViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  playerRoom = await requestOnlineJson<RoomView>('GET', `/rooms/${roomCode}`, accountId);
  return toRoomViewState(playerRoom);
}

async function closeCustomRoom(roomCode: string): Promise<OnlineRoomViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  playerRoom = await requestOnlineJson<RoomView>('POST', `/rooms/${roomCode}/close`, accountId);
  return toRoomViewState(playerRoom);
}

const startMenu = createStartMenu({
  initialMode: selectedMode,
  initialLoadout: selectedLoadout,
  enabledModes,
  initialAccountSummary: 'Guest Account',
  onStartMode: (mode, loadout) => {
    beginMode(mode, loadout);
  },
  onOpenWebAuth: platform.kind === 'web'
    ? async (action: WebAuthMenuAction, request?: WebAuthMenuRequest) => {
      await openWebAuthFlow(action, request);
    }
    : undefined,
  onReturnHome: () => {
    returnToHome();
  },
  onPlayAgain: () => {
    beginMode(selectedMode, selectedLoadout);
  },
  onJoinRankedQueue: async () => {
    return await joinRankedQueue();
  },
  onRefreshRankedQueue: async () => {
    return await refreshRankedQueue();
  },
  onLeaveRankedQueue: async () => {
    return await leaveRankedQueue();
  },
  onCreateCustomRoom: async () => {
    return await createCustomRoom();
  },
  onJoinCustomRoom: async (roomCode: string) => {
    return await joinCustomRoom(roomCode);
  },
  onRefreshCustomRoom: async (roomCode: string) => {
    return await refreshCustomRoom(roomCode);
  },
  onCloseCustomRoom: async (roomCode: string) => {
    return await closeCustomRoom(roomCode);
  },
  onOpenOnlineDevMenu: onlineDevMenuEnabled
    ? (target?: OnlineDevMenuTarget) => {
      openOnlineDevMenu(target);
    }
    : undefined,
  onOpenReplayReview: () => {
    void beginReplayReviewFromFixture('smoke.replay.json');
  },
});

const fixedDt = 1 / 60;
const maxAccumulatedTime = 0.25;

let accumulator = 0;
let lastTimeSeconds = performance.now() / 1000;
let pauseButtonWasDown = false;
let pauseToggleLockUntil = 0;
let sessionAccountId: string | null = null;
let replayReviewData: ReplayReviewData | null = null;
let replayReviewSourceLabel = '';
let replayFrameIndex = 0;
let replayAccumulator = 0;
let replayPaused = true;
const replaySpeedOptions = [0.25, 0.5, 1, 2, 4];
let replaySpeedIndex = 2;
let playerRankedTicket: QueueTicketView | null = null;
let playerRankedSession: MatchSessionView | null = null;
let playerRoom: RoomView | null = null;

function formatAccountSummary(session: PlatformAuthSession): string {
  if (!session.isAuthenticated || !session.accountId) {
    return `Guest Account (${session.accountId ?? 'local'})`;
  }
  const name = session.displayName?.trim();
  return name ? `Signed in: ${name}` : `Signed in: ${session.accountId}`;
}

function getEnabledModes(): GameMode[] {
  return ['endless', 'best_of_3', 'training'];
}

function getRulesForMode(mode: GameMode): { allowDunkWin: boolean } {
  if (mode === 'training') {
    return { allowDunkWin: false };
  }
  return { allowDunkWin: true };
}

function resolveStoredMode(mode: string | undefined): GameMode {
  if (mode && enabledModes.includes(mode as GameMode)) {
    return mode as GameMode;
  }
  return enabledModes[0] ?? 'endless';
}

function isCharacterId(value: string | undefined): value is CharacterId {
  if (!value) {
    return false;
  }
  return value in CHARACTER_BY_ID;
}

function loadSettings(): LoadedSettings {
  const fallbackMode = resolveStoredMode('endless');
  const fallback: LoadedSettings = {
    mode: fallbackMode,
    loadout: {
      P1: DEFAULT_CHARACTER_LOADOUT.P1,
      P2: DEFAULT_CHARACTER_LOADOUT.P2,
    },
  };

  const raw = platform.storage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  let parsed: StoredSettings;
  try {
    parsed = JSON.parse(raw) as StoredSettings;
  } catch {
    return fallback;
  }

  const mode = resolveStoredMode(parsed.mode);
  const parsedP1 = parsed.loadout?.P1;
  const parsedP2 = parsed.loadout?.P2;
  const p1 = isCharacterId(parsedP1) ? parsedP1 : DEFAULT_CHARACTER_LOADOUT.P1;
  const p2 = isCharacterId(parsedP2) ? parsedP2 : DEFAULT_CHARACTER_LOADOUT.P2;

  return {
    mode,
    loadout: {
      P1: p1,
      P2: p2,
    },
  };
}

function persistSettings(): void {
  const payload: StoredSettings = {
    mode: selectedMode,
    loadout: {
      P1: selectedLoadout.P1,
      P2: selectedLoadout.P2,
    },
  };
  platform.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

async function bootstrapPlatformProfile(): Promise<void> {
  try {
    const session = await platform.auth.getSession();
    sessionAccountId = session.accountId;
    startMenu.setAccountSummary(formatAccountSummary(session));
    startMenu.setAuthState(session.isAuthenticated);
    if (!session.accountId) {
      return;
    }
    const profile = await platform.profile.getProfile(session.accountId);
    if (session.isAuthenticated && profile.displayName) {
      startMenu.setAccountSummary(`Signed in: ${profile.displayName}`);
    }
  } catch {
    // Profile bootstrap fallback is intentionally silent for prototype flow.
  }
}

async function openWebAuthFlow(action: WebAuthMenuAction, request?: WebAuthMenuRequest): Promise<void> {
  const auth = platform.auth;
  if (!auth.signIn || !auth.signUp || !auth.signOut) {
    throw new Error('Web auth is unavailable for this platform build.');
  }

  let session: PlatformAuthSession | null = null;
  if (action === 'signout') {
    session = await auth.signOut();
  } else if (action === 'signin') {
    const email = request?.email?.trim();
    const password = request?.password ?? '';
    if (!email) {
      throw new Error('Email is required.');
    }
    if (!password) {
      throw new Error('Password is required.');
    }
    session = await auth.signIn({ email, password });
  } else if (action === 'signup') {
    const email = request?.email?.trim();
    const password = request?.password ?? '';
    if (!email) {
      throw new Error('Email is required.');
    }
    if (!password) {
      throw new Error('Password is required.');
    }
    const currentSession = await auth.getSession();
    const canUpgradeGuest = !currentSession.isAuthenticated && Boolean(currentSession.accountId);
    session = await auth.signUp({
      email,
      password,
      displayName: request?.displayName?.trim() || null,
      upgradeCurrentGuest: canUpgradeGuest ? Boolean(request?.upgradeCurrentGuest) : false,
    });
  } else {
    throw new Error('Unknown auth action.');
  }

  if (!session) {
    throw new Error('Authentication request did not return a session.');
  }

  sessionAccountId = session.accountId;
  startMenu.setAccountSummary(formatAccountSummary(session));
  startMenu.setAuthState(session.isAuthenticated);
  if (!session.isAuthenticated) {
    playerRankedTicket = null;
    playerRankedSession = null;
    playerRoom = null;
  }
  if (session.accountId) {
    const profile = await platform.profile.getProfile(session.accountId);
    if (session.isAuthenticated && profile.displayName) {
      startMenu.setAccountSummary(`Signed in: ${profile.displayName}`);
    }
  }
}

function resetRoundState(): void {
  persistRollbackDiagnostics('round_reset');
  const tuning = state.tuning;
  state = createInitialState({
    loadout: selectedLoadout,
    seed: selectedMatchSeed,
    rules: getRulesForMode(selectedMode),
  });
  state.tuning = { ...tuning };
  sceneContext.cameraPlayerTracks.P1.set(state.players.P1.pos.x, state.players.P1.pos.y);
  sceneContext.cameraPlayerTracks.P2.set(state.players.P2.pos.x, state.players.P2.pos.y);
  sceneContext.launchCameraActive = false;
  inputTimeline.clear();
  simulationFrame = 0;
  rollbackSession = enableRollbackScaffold
    ? new RollbackSession({
      initialState: state,
      localPlayerId: 'P1',
      fixedDt,
      maxHistoryFrames: 60 * 20,
    })
    : null;
  const showRollbackDiagnostics = runtimeConfig.features.debugToolsEnabled && rollbackSession !== null;
  hud.setRollbackDiagnosticsVisible(showRollbackDiagnostics);
  hud.updateRollbackDiagnostics(showRollbackDiagnostics ? getRollbackDiagnosticsView(rollbackSession) : null);
}

function beginMode(mode: GameMode, loadout?: PlayersById<CharacterId>): void {
  const resolvedMode = resolveStoredMode(mode);
  if (loadout) {
    selectedLoadout = {
      P1: loadout.P1,
      P2: loadout.P2,
    };
  }
  selectedMode = resolvedMode;
  if (!Number.isFinite(forcedSeed)) {
    selectedMatchSeed = ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0) || 1;
  }
  p1RoundWins = 0;
  p2RoundWins = 0;
  roundTransitionRemaining = 0;
  resetRoundState();
  appPhase = 'playing';
  persistSettings();
  if (sessionAccountId) {
    void platform.profile.saveProfile(sessionAccountId, {
      settings: {
        mode: selectedMode,
        loadout: selectedLoadout,
      },
    });
  }
  void platform.presence.setStatus('playing');
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(selectedMode === 'training');
  startMenu.hideHome();
  startMenu.hideRoundBanner();
  hudRoot.style.visibility = 'visible';
  hud.setTrainingFrameDataVisible(selectedMode === 'training');
  accumulator = 0;
}

function returnToHome(): void {
  persistRollbackDiagnostics('return_home');
  appPhase = 'home';
  void platform.presence.setStatus('home');
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(false);
  startMenu.showHome();
  replayViewer.hide();
  hudRoot.style.visibility = 'hidden';
  hud.setTrainingFrameDataVisible(false);
  accumulator = 0;
}

function openOnlineDevMenu(section?: OnlineDevMenuTarget): void {
  if (!onlineDevMenu) {
    return;
  }
  const sectionId: OnlineDevSectionId | undefined = section
    ? ({
      matchmaking: 'matchmaking',
      rooms: 'rooms',
      replay: 'replay',
      ranked: 'ranked',
      social: 'social',
    } as const)[section]
    : undefined;
  appPhase = 'online_dev';
  void platform.presence.setStatus('online_dev');
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(false);
  startMenu.hideHome();
  startMenu.hideRoundBanner();
  replayViewer.hide();
  hudRoot.style.visibility = 'hidden';
  hud.setTrainingFrameDataVisible(false);
  onlineDevMenu.show(sectionId);
}

function closeOnlineDevMenu(): void {
  if (!onlineDevMenu) {
    return;
  }
  onlineDevMenu.hide();
  returnToHome();
}

function getRollbackDiagnosticsView(session: RollbackSession): RollbackDiagnosticsView {
  const snapshot = session.getDiagnosticsSnapshot();
  return {
    totalFramesSimulated: snapshot.totalFramesSimulated,
    predictedRemoteFrames: snapshot.predictedRemoteFrames,
    authoritativeRemoteFrames: snapshot.authoritativeRemoteFrames,
    totalRollbacks: snapshot.totalRollbacks,
    maxRollbackDepth: snapshot.maxRollbackDepth,
    lastRollbackDepth: snapshot.lastRollbackDepth,
    lastRollbackFromFrame: snapshot.lastRollbackFromFrame,
    desyncEventCount: snapshot.desyncEvents.length,
  };
}

function persistRollbackDiagnostics(reason: string): void {
  if (!rollbackSession) {
    return;
  }
  const diagnostics = rollbackSession.getDiagnosticsSnapshot();
  if (diagnostics.totalFramesSimulated <= 0) {
    return;
  }
  const entry: StoredRollbackDiagnosticsEntry = {
    capturedAt: new Date().toISOString(),
    reason,
    mode: selectedMode,
    seed: selectedMatchSeed,
    diagnostics,
  };
  console.info('[rollback] match diagnostics', entry);

  const raw = platform.storage.getItem(ROLLBACK_DIAGNOSTICS_STORAGE_KEY);
  let entries: StoredRollbackDiagnosticsEntry[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredRollbackDiagnosticsEntry[];
      if (Array.isArray(parsed)) {
        entries = parsed;
      }
    } catch {
      entries = [];
    }
  }
  entries.push(entry);
  if (entries.length > 20) {
    entries = entries.slice(entries.length - 20);
  }
  platform.storage.setItem(ROLLBACK_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(entries));
}

function restartTrainingRound(): void {
  if (selectedMode !== 'training') {
    return;
  }
  resetRoundState();
  appPhase = 'playing';
  startMenu.hideRoundBanner();
  startMenu.hideHome();
  hudRoot.style.visibility = 'visible';
  hud.setTrainingFrameDataVisible(true);
  accumulator = 0;
}

function beginReplayReviewFromPayload(payloadRaw: unknown, sourceLabel: string): boolean {
  const validation = validateReplayPayload(payloadRaw);
  if (!validation.ok) {
    console.error('[replay-review] invalid replay payload', sourceLabel, validation.error);
    return false;
  }

  replayReviewData = buildReplayReviewData(validation.payload);
  replayReviewSourceLabel = sourceLabel;
  replayFrameIndex = 0;
  replayAccumulator = 0;
  replayPaused = true;
  replaySpeedIndex = replaySpeedOptions.indexOf(1);
  if (replaySpeedIndex < 0) {
    replaySpeedIndex = 0;
  }

  appPhase = 'replay_review';
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(false);
  startMenu.hideRoundBanner();
  startMenu.hideHome();
  onlineDevMenu?.hide();
  hudRoot.style.visibility = 'visible';
  hud.setTrainingFrameDataVisible(false);
  hud.setRollbackDiagnosticsVisible(false);
  hud.updateRollbackDiagnostics(null);
  replayViewer.show(replayReviewData, replayReviewSourceLabel);
  replayViewer.updatePlayback(replayFrameIndex, replayPaused, replaySpeedOptions[replaySpeedIndex]);
  const firstSnapshot = replayReviewData.frames[replayFrameIndex]?.snapshot;
  if (firstSnapshot) {
    sceneContext.cameraPlayerTracks.P1.set(firstSnapshot.players.P1.pos.x, firstSnapshot.players.P1.pos.y);
    sceneContext.cameraPlayerTracks.P2.set(firstSnapshot.players.P2.pos.x, firstSnapshot.players.P2.pos.y);
    sceneContext.launchCameraActive = false;
  }
  return true;
}

async function beginReplayReviewFromFixture(fileName: string): Promise<void> {
  let payloadRaw: unknown;
  try {
    const response = await fetch(`/replays/${fileName}`);
    if (!response.ok) {
      throw new Error(`Replay fixture load failed (${response.status})`);
    }
    payloadRaw = await response.json();
  } catch (error) {
    console.error('[replay-review] failed to load replay fixture', fileName, error);
    return;
  }

  beginReplayReviewFromPayload(payloadRaw, fileName);
}

function exitReplayReview(): void {
  if (appPhase !== 'replay_review') {
    return;
  }
  replayViewer.hide();
  replayReviewData = null;
  replayFrameIndex = 0;
  replayAccumulator = 0;
  replayPaused = true;
  replayReviewSourceLabel = '';
  returnToHome();
}

function setReplayFrameIndex(frameIndex: number): void {
  if (!replayReviewData) {
    return;
  }
  const clamped = Math.max(0, Math.min(replayReviewData.totalFrames - 1, Math.floor(frameIndex)));
  replayFrameIndex = clamped;
  replayViewer.updatePlayback(replayFrameIndex, replayPaused, replaySpeedOptions[replaySpeedIndex]);
}

function stepReplayFrame(direction: -1 | 1): void {
  if (appPhase !== 'replay_review' || !replayReviewData) {
    return;
  }
  replayPaused = true;
  setReplayFrameIndex(replayFrameIndex + direction);
}

function adjustReplaySpeed(direction: -1 | 1): void {
  if (appPhase !== 'replay_review') {
    return;
  }
  replaySpeedIndex = Math.max(0, Math.min(replaySpeedOptions.length - 1, replaySpeedIndex + direction));
  replayViewer.updatePlayback(replayFrameIndex, replayPaused, replaySpeedOptions[replaySpeedIndex]);
}

function jumpReplayRound(roundIndex: number): void {
  if (appPhase !== 'replay_review' || !replayReviewData) {
    return;
  }
  const round = replayReviewData.rounds.find((item) => item.index === roundIndex);
  if (!round) {
    return;
  }
  replayPaused = true;
  setReplayFrameIndex(round.startFrame);
}

function getRoundScoreText(): string {
  return `Rounds: P1 ${p1RoundWins} - ${p2RoundWins} P2`;
}

function updateMatchInfo(): void {
  if (appPhase === 'home') {
    matchInfo.textContent = 'Home';
    return;
  }

  if (appPhase === 'replay_review') {
    if (!replayReviewData) {
      matchInfo.textContent = 'Replay Review';
      return;
    }
    const round = replayReviewData.rounds.find(
      (item) => replayFrameIndex >= item.startFrame && replayFrameIndex <= item.endFrame,
    ) ?? replayReviewData.rounds[0];
    matchInfo.textContent = `Replay Review | ${round?.label ?? 'Round 1'} | Frame ${replayFrameIndex + 1}/${replayReviewData.totalFrames}`;
    return;
  }

  if (appPhase === 'online_dev') {
    matchInfo.textContent = 'Online Dev Menu';
    return;
  }

  if (selectedMode === 'endless') {
    matchInfo.textContent = 'Mode: Endless Dev';
    return;
  }

  if (selectedMode === 'training') {
    matchInfo.textContent = 'Mode: Training';
    return;
  }

  matchInfo.textContent = `Mode: Best of 3 | ${getRoundScoreText()}`;
}

function updateOnlineDiagnosticsOverlay(): void {
  if (!diagnosticsOverlay) {
    return;
  }
  diagnosticsOverlay.update({
    capturedAt: new Date().toISOString(),
    build: diagnosticsBuildId,
    rulesetVersion: diagnosticsRulesetVersion,
    accountId: sessionAccountId,
    participantAccountIds: onlineDiagnosticsUpdate.participantAccountIds,
    sessionId: onlineDiagnosticsUpdate.sessionId,
    ticketId: onlineDiagnosticsUpdate.ticketId,
    queueType: onlineDiagnosticsUpdate.queueType,
    region: onlineDiagnosticsUpdate.region,
    queueWaitMs: onlineDiagnosticsUpdate.queueWaitMs,
    connectionPath: onlineDiagnosticsUpdate.connectionPath,
    rttMs: onlineDiagnosticsUpdate.rttMs,
    packetLossPercent: onlineDiagnosticsUpdate.packetLossPercent,
    rollback: rollbackSession ? getRollbackDiagnosticsView(rollbackSession) : null,
  });
}

function isPauseButtonDown(): boolean {
  const gamepads = navigator.getGamepads?.() ?? [];
  for (const gamepad of gamepads) {
    if (!gamepad) {
      continue;
    }
    const startButton = gamepad.buttons[9];
    const menuButton = gamepad.buttons[16];
    if (
      (startButton && (startButton.pressed || startButton.value > 0.35))
      || (menuButton && (menuButton.pressed || menuButton.value > 0.35))
    ) {
      return true;
    }
  }
  return false;
}

function onRoundWin(winner: PlayerId): void {
  if (selectedMode === 'training') {
    restartTrainingRound();
    return;
  }

  if (selectedMode === 'endless') {
    appPhase = 'round_transition';
    roundTransitionRemaining = 0.5;
    startMenu.showRoundBanner(winner, 'Endless mode continues');
    return;
  }

  if (winner === 'P1') {
    p1RoundWins += 1;
  } else {
    p2RoundWins += 1;
  }

  if (p1RoundWins >= 2 || p2RoundWins >= 2) {
    persistRollbackDiagnostics('match_over');
    appPhase = 'match_over';
    void platform.presence.setStatus('match_over');
    startMenu.showMatchOver(winner, p1RoundWins, p2RoundWins);
    hudRoot.style.visibility = 'hidden';
    return;
  }

  appPhase = 'round_transition';
  roundTransitionRemaining = 1.2;
  startMenu.showRoundBanner(winner, getRoundScoreText());
}

window.addEventListener('keydown', (event) => {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (!key) {
    return;
  }
  if (appPhase === 'replay_review') {
    if (key === 'escape') {
      event.preventDefault();
      exitReplayReview();
    }
    return;
  }

  if (appPhase === 'online_dev') {
    if (key === 'escape') {
      event.preventDefault();
      closeOnlineDevMenu();
    }
    return;
  }

  if (selectedMode === 'training' && appPhase === 'playing' && key === 'n') {
    event.preventDefault();
    restartTrainingRound();
    return;
  }

  if (key === 'escape') {
    if (appPhase !== 'playing' && appPhase !== 'round_transition') {
      return;
    }
    event.preventDefault();
    pauseMenu.toggle();
    accumulator = 0;
  }
});

function tick(nowMs: number): void {
  const nowSeconds = nowMs / 1000;
  const elapsedSeconds = nowSeconds - lastTimeSeconds;
  lastTimeSeconds = nowSeconds;

  const pauseDown = isPauseButtonDown();
  if (
    pauseDown
    && !pauseButtonWasDown
    && nowSeconds >= pauseToggleLockUntil
    && (appPhase === 'playing' || appPhase === 'round_transition')
  ) {
    pauseMenu.toggle();
    accumulator = 0;
    pauseToggleLockUntil = nowSeconds + 0.2;
  }
  pauseButtonWasDown = pauseDown;

  if (!pauseMenu.isPaused() && appPhase === 'playing') {
    accumulator = Math.min(accumulator + elapsedSeconds, maxAccumulatedTime);
  } else {
    accumulator = 0;
  }

  if (!pauseMenu.isPaused() && appPhase === 'playing') {
    while (accumulator >= fixedDt) {
      const frameInput = input.getFrameInput();
      inputTimeline.setLocalInput(simulationFrame, 'P1', frameInput.p1);
      inputTimeline.setLocalInput(simulationFrame, 'P2', frameInput.p2);
      if (rollbackSession) {
        const rollbackResult = rollbackSession.advanceFrame({
          localInput: frameInput.p1,
          remoteAuthoritativeInput: frameInput.p2,
        });
        if (runtimeConfig.features.debugToolsEnabled && rollbackResult.rollbackFrames > 0) {
          console.info('[rollback] correction', {
            frame: rollbackResult.frame,
            rollbackFrames: rollbackResult.rollbackFrames,
          });
        }
        if (runtimeConfig.features.debugToolsEnabled) {
          const desyncEvents = rollbackSession.drainPendingDesyncEvents();
          for (const event of desyncEvents) {
            console.warn('[rollback] desync event', event);
          }
        }
        state = rollbackSession.getStateSnapshot();
      } else {
        step(state, frameInput, fixedDt);
      }
      simulationFrame += 1;
      accumulator -= fixedDt;
    }

    if (state.winner) {
      onRoundWin(state.winner);
    }
  }

  if (!pauseMenu.isPaused() && appPhase === 'round_transition') {
    roundTransitionRemaining -= elapsedSeconds;
    if (roundTransitionRemaining <= 0) {
      resetRoundState();
      startMenu.hideRoundBanner();
      appPhase = 'playing';
    }
  }

  if (appPhase === 'replay_review' && replayReviewData) {
    if (!replayPaused) {
      const replaySpeed = replaySpeedOptions[replaySpeedIndex] ?? 1;
      replayAccumulator = Math.min(replayAccumulator + elapsedSeconds * replaySpeed, maxAccumulatedTime);
      while (replayAccumulator >= replayReviewData.fixedDt) {
        replayAccumulator -= replayReviewData.fixedDt;
        if (replayFrameIndex >= replayReviewData.totalFrames - 1) {
          replayPaused = true;
          replayAccumulator = 0;
          break;
        }
        replayFrameIndex += 1;
      }
    } else {
      replayAccumulator = 0;
    }
    replayViewer.updatePlayback(replayFrameIndex, replayPaused, replaySpeedOptions[replaySpeedIndex] ?? 1);
  } else {
    replayAccumulator = 0;
  }

  const snapshot = appPhase === 'replay_review' && replayReviewData
    ? replayReviewData.frames[replayFrameIndex].snapshot
    : getRenderSnapshot(state);

  if (appPhase === 'replay_review') {
    hud.setRollbackDiagnosticsVisible(false);
    hud.updateRollbackDiagnostics(null);
  } else if (runtimeConfig.features.debugToolsEnabled && rollbackSession) {
    hud.updateRollbackDiagnostics(getRollbackDiagnosticsView(rollbackSession));
  } else {
    hud.updateRollbackDiagnostics(null);
  }
  renderFrame(sceneContext, snapshot);
  hud.update(snapshot);
  updateMatchInfo();
  updateOnlineDiagnosticsOverlay();

  requestAnimationFrame(tick);
}

hudRoot.style.visibility = 'hidden';
hud.setTrainingFrameDataVisible(false);
void bootstrapPlatformProfile();
void platform.presence.setStatus('home');
startMenu.showHome();
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  resizeScene(sceneContext);
});

window.addEventListener('beforeunload', () => {
  startMenu.dispose();
  onlineDevMenu?.dispose();
  replayViewer.dispose();
  diagnosticsOverlay?.dispose();
  input.dispose();
  platform.dispose?.();
});
