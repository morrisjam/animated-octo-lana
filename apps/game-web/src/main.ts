import { createCombinedInput } from './input/combined';
import { createGamepadInput } from './input/gamepad';
import { createKeyboardInput } from './input/keyboard';
import { loadRuntimeConfig } from './config/features';
import { createInputTimelineBuffer } from './net/inputTimeline';
import {
  RollbackSession,
  type RollbackDiagnosticsSnapshot,
} from './net/rollbackSession';
import { CHARACTER_BY_ID, DEFAULT_CHARACTER_LOADOUT, isCharacterId, type CharacterId } from './sim/characters';
import { createPlatformServices, type PlatformAuthSession } from './platform';
import { validateReplayPayload } from './sim/replay';
import { buildReplayReviewData, type ReplayReviewData } from './sim/replayReview';
import { createInitialState, getRenderSnapshot, step } from './sim/sim';
import {
  DEFAULT_BALANCE_PROFILE_ID,
  resolveBalanceProfile,
} from './sim/balanceProfiles';
import {
  createTrainingTelemetryTracker,
  type TrainingRoundEndReason,
  type TrainingTelemetrySummary,
  type TrainingTelemetryTracker,
} from './sim/trainingTelemetry';
import { sanitiseTuning } from './sim/tuning';
import type { PlayerId, PlayersById, RenderSnapshot } from './sim/types';
import {
  AI_DIFFICULTY_ORDER,
  buildFrameInputWithAi,
  createAiController,
  tickAiController,
  type AiControllerState,
  type AiDifficultyId,
  DEFAULT_AI_DIFFICULTY,
} from './sim/ai';
import {
  applyArcadeLossAction,
  createArcadeRun,
  getCurrentArcadeStage,
  resolveArcadeMatch,
  type ArcadeLossAction,
  type ArcadeRunState,
} from './sim/arcade';
import {
  appendArcadeRunHistoryEntry,
  areArcadeRunHistoriesEqual,
  computeArcadeBestRecords,
  createEmptyArcadeRunHistory,
  mergeArcadeRunHistories,
  sanitiseArcadeRunHistory,
  type ArcadeRunHistory,
  type ArcadeRunHistoryEntry,
} from './sim/arcadeHistory';
import {
  createHud,
  type RollbackDiagnosticsView,
  type RuntimeMemoryDiagnosticsView,
} from './view/hud';
import { buildAssetBudgetReport, DEFAULT_ASSET_BUDGET_LIMITS } from './view/assets/budget';
import { DEFAULT_ASSET_MANIFEST } from './view/assets/defaultManifest';
import { preloadAssetManifest } from './view/assets/loader';
import { createPauseMenu } from './view/pauseMenu';
import { createOnlineDevMenu, type OnlineDiagnosticsUpdate, type OnlineDevSectionId } from './view/onlineDevMenu';
import { createOnlineDiagnosticsOverlay } from './view/onlineDiagnosticsOverlay';
import { createReplayViewer } from './view/replayViewer';
import { renderFrame } from './view/render';
import { applyStageAtmospherePreset, createScene, resizeScene } from './view/scene';
import { createAudioSystem } from './view/audio/system';
import type { CombatVfxEvent } from './view/vfx/types';
import { createMusicStateController, type MusicState } from './view/audio/musicState';
import { createVoiceCalloutSystem } from './view/audio/voiceLines';
import {
  DEFAULT_AUDIO_SETTINGS,
  sanitiseAudioSettings,
  type AudioSettings,
} from './view/audio/settings';
import {
  type ArcadeMenuSettings,
  createStartMenu,
  type GameMode,
  type OnlineDevMenuTarget,
  type OnlineRankedViewState,
  type OnlineRoomViewState,
  type RankedSnapshotViewState,
  type ReplayArchiveViewState,
  type WebAuthMenuAction,
  type WebAuthMenuRequest,
} from './view/startMenu';
import {
  applyMenuTheme,
  DEFAULT_MENU_THEME_ID,
  MENU_THEME_OPTIONS,
  resolveMenuTheme,
} from './view/menuThemes';
import {
  DEFAULT_STAGE_ATMOSPHERE_ID,
  resolveStageAtmosphere,
  STAGE_ATMOSPHERE_OPTIONS,
} from './view/stageAtmosphere';

type AppPhase = 'home' | 'playing' | 'round_transition' | 'match_over' | 'replay_review' | 'online_dev';
interface StoredSettings {
  mode?: string;
  menuThemeId?: string;
  stageAtmosphereId?: string;
  loadout?: {
    P1?: string;
    P2?: string;
  };
  aiDifficulty?: string;
  arcade?: {
    continues?: number;
    retryEnabled?: boolean;
  };
  audio?: unknown;
}
interface LoadedSettings {
  mode: GameMode;
  menuThemeId: string;
  stageAtmosphereId: string;
  loadout: PlayersById<CharacterId>;
  aiDifficulty: AiDifficultyId;
  arcade: ArcadeMenuSettings;
  audio: AudioSettings;
}

const SETTINGS_STORAGE_KEY = 'gravity_well.settings.v1';
const ARCADE_HISTORY_STORAGE_KEY = 'gravity_well.arcade_history.v1';
const ROLLBACK_DIAGNOSTICS_STORAGE_KEY = 'gravity_well.rollback_diagnostics.v1';
const TRAINING_TELEMETRY_STORAGE_KEY = 'gravity_well.training_telemetry.v1';
const platform = createPlatformServices();
const runtimeConfig = loadRuntimeConfig();
const DEFAULT_ARCADE_MENU_SETTINGS: ArcadeMenuSettings = {
  continues: 2,
  retryEnabled: true,
};
const MAX_ARCADE_HISTORY_ENTRIES = 60;

interface ArcadePendingLossState {
  stageLabel: string;
  allowedActions: ArcadeLossAction[];
}

function toCombatAudioEventType(eventType: CombatVfxEvent['type']): 'combat.boost' | 'combat.launch' | 'combat.parry' | 'combat.projectile' | 'combat.dunk' {
  switch (eventType) {
    case 'boost':
      return 'combat.boost';
    case 'launch':
      return 'combat.launch';
    case 'parry':
      return 'combat.parry';
    case 'projectile':
      return 'combat.projectile';
    case 'dunk':
    default:
      return 'combat.dunk';
  }
}

function toMusicAudioEventType(state: MusicState): 'music.menu' | 'music.neutral' | 'music.launch' | 'music.end' {
  switch (state) {
    case 'neutral':
      return 'music.neutral';
    case 'launch':
      return 'music.launch';
    case 'end':
      return 'music.end';
    case 'menu':
    default:
      return 'music.menu';
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Missing #game canvas element');
}

const matchInfo = document.querySelector<HTMLDivElement>('#matchInfo');
const hudRoot = document.querySelector<HTMLDivElement>('#hud');
if (!matchInfo || !hudRoot) {
  throw new Error('Missing HUD match elements');
}

const audioSystem = createAudioSystem({
  missingEventPolicy: runtimeConfig.features.debugToolsEnabled ? 'throw' : 'warn',
});
let audioSettings: AudioSettings = DEFAULT_AUDIO_SETTINGS;
let voiceDuckingUntilSeconds = 0;
const voiceCalloutSystem = createVoiceCalloutSystem({
  locale: typeof navigator?.language === 'string' ? navigator.language : 'en-US',
  emitAudioEvent: (event) => {
    if (event.type === 'voice.callout' && audioSettings.voiceDuckingEnabled) {
      voiceDuckingUntilSeconds = performance.now() / 1000 + 0.55;
    }
    audioSystem.emit(event);
  },
});
const sceneContext = createScene(canvas, {
  onCombatAudioCue: (event, cue) => {
    audioSystem.emit({
      type: toCombatAudioEventType(event.type),
      playerId: event.playerId,
      pan: Math.max(-1, Math.min(1, event.position.x / 30)),
      cueOverride: {
        waveform: cue.waveform,
        frequencyHz: cue.frequencyHz,
        durationSeconds: cue.durationSeconds,
        gain: cue.gain,
      },
    });
    const calloutEvent = event.type === 'launch'
      ? 'launch_hit'
      : event.type === 'parry'
        ? 'parry_success'
        : event.type === 'dunk'
          ? 'dunk_hit'
          : null;
    if (calloutEvent) {
      const callout = voiceCalloutSystem.trigger({
        playerId: event.playerId,
        characterId: event.characterId,
        event: calloutEvent,
        timeSeconds: performance.now() / 1000,
      });
      if (callout && audioSettings.subtitlesEnabled) {
        hud.showVoiceSubtitle(callout.text);
      }
    }
  },
});
const hud = createHud();
const input = createCombinedInput([
  createKeyboardInput(),
  createGamepadInput(),
]);
const enabledModes = getEnabledModes();
const loadedSettings = loadSettings();
audioSettings = loadedSettings.audio;
audioSystem.setBusVolume('master', audioSettings.masterVolume);
audioSystem.setBusVolume('music', audioSettings.musicVolume);
audioSystem.setBusVolume('sfx', audioSettings.sfxVolume);
audioSystem.setBusVolume('voice', audioSettings.voiceVolume);
let selectedMenuThemeId = loadedSettings.menuThemeId;
applyMenuTheme(resolveMenuTheme(selectedMenuThemeId), document.documentElement.style);
let selectedStageAtmosphereId = loadedSettings.stageAtmosphereId;
selectedStageAtmosphereId = applyStageAtmospherePreset(sceneContext, selectedStageAtmosphereId);
let selectedLoadout: PlayersById<CharacterId> = loadedSettings.loadout;
let selectedAiDifficulty: AiDifficultyId = loadedSettings.aiDifficulty;
let selectedArcadeSettings: ArcadeMenuSettings = loadedSettings.arcade;
let arcadeHistory: ArcadeRunHistory = loadArcadeHistory();
let profileSettingsCache: Record<string, unknown> = {};
const seedParam = new URLSearchParams(window.location.search).get('seed');
const forcedSeed = seedParam !== null ? Number(seedParam) : undefined;
let selectedMatchSeed = Number.isFinite(forcedSeed) ? (forcedSeed as number) : 1;
let selectedMode: GameMode = loadedSettings.mode;
const configuredBalanceProfileId = (import.meta.env.VITE_BALANCE_PROFILE_ID as string | undefined)?.trim();
const activeBalanceProfile = resolveBalanceProfile(configuredBalanceProfileId);
const runtimeRulesetVersion = (
  (import.meta.env.VITE_RULESET_VERSION as string | undefined)?.trim()
  || 'prototype-2026.02'
);
const activeRulesetVersion = `${runtimeRulesetVersion}${activeBalanceProfile.id === DEFAULT_BALANCE_PROFILE_ID ? '' : `+${activeBalanceProfile.id}`}`;
if (
  configuredBalanceProfileId
  && configuredBalanceProfileId.length > 0
  && activeBalanceProfile.id !== configuredBalanceProfileId
  && runtimeConfig.features.debugToolsEnabled
) {
  console.warn('[balance-profile] unknown profile id; using default profile', {
    requested: configuredBalanceProfileId,
    applied: activeBalanceProfile.id,
  });
}
let state = createInitialState({
  loadout: selectedLoadout,
  seed: selectedMatchSeed,
  rules: getRulesForMode(selectedMode),
});
state.tuning = { ...activeBalanceProfile.tuning };
let trainingTelemetry: TrainingTelemetryTracker = createTrainingTelemetryTracker({
  balanceProfileId: activeBalanceProfile.id,
  rulesetVersion: activeRulesetVersion,
  playerCharacterId: selectedLoadout.P1,
  opponentCharacterId: selectedLoadout.P2,
});
const assetBudgetReport = buildAssetBudgetReport(DEFAULT_ASSET_MANIFEST, DEFAULT_ASSET_BUDGET_LIMITS);
let assetPreloadBytesLoaded = 0;
let appPhase: AppPhase = 'home';
let p1RoundWins = 0;
let p2RoundWins = 0;
let roundTransitionRemaining = 0;
let simulationFrame = 0;
let aiController: AiControllerState | null = null;
let arcadeRun: ArcadeRunState | null = null;
let arcadePendingLossState: ArcadePendingLossState | null = null;
const inputTimeline = createInputTimelineBuffer({ maxFrames: 60 * 20 });
const enableRollbackScaffold = (import.meta.env.VITE_FEATURE_ROLLBACK_SCAFFOLD ?? 'false').toLowerCase() === 'true';
let rollbackSession: RollbackSession | null = null;
const musicStateController = createMusicStateController({
  fadeSeconds: 0.35,
  gainByState: {
    menu: 0.55,
    neutral: 0.72,
    launch: 0.9,
    end: 0.62,
  },
  initialState: 'menu',
  initialTimeSeconds: 0,
  onStateChanged: (nextState) => {
    audioSystem.emit({ type: toMusicAudioEventType(nextState) });
  },
});
audioSystem.setBusVolume('music', musicStateController.tick(0));
audioSystem.emit({ type: toMusicAudioEventType(musicStateController.getState()) });

interface StoredRollbackDiagnosticsEntry {
  capturedAt: string;
  reason: string;
  mode: GameMode;
  seed: number;
  diagnostics: RollbackDiagnosticsSnapshot;
}

interface StoredTrainingTelemetryEntry {
  exportedAt: string;
  rulesetVersion: string;
  balanceProfileId: string;
  summary: TrainingTelemetrySummary;
}

type QueueType = 'unranked' | 'ranked';
type RegionId = 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';

interface MatchStartPayload {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
  diagnostics?: {
    skillTrack?: 'unranked' | 'rating' | 'master';
    expectedGap?: number | null;
    matchedGap?: number | null;
    waitSeconds?: number;
    regionConstraintRelaxed?: boolean;
  };
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

interface ReplayParticipantView {
  accountId: string;
  result?: string;
  characterId?: string;
}

interface ReplaySearchItemView {
  replayId: string;
  queueType?: QueueType | string;
  startedAt?: string;
  endedAt?: string;
  player?: ReplayParticipantView;
  opponent?: ReplayParticipantView;
}

interface ReplaySearchResponseView {
  items: ReplaySearchItemView[];
}

interface ReplayPayloadResponseView {
  replayId: string;
  payload: unknown;
}

interface RankedProgressionView {
  seasonId: string | null;
  rating: number | null;
  leagueTier: string | null;
  leaguePoints: number | null;
  mrPoints: number | null;
  provisional: boolean | null;
  placement: {
    calibrationMatchesPlayed: number | null;
    calibrationMatchesRequired: number | null;
    calibrationMatchesRemaining: number | null;
  } | null;
  recentDeltas: Array<{
    result: string | null;
    preRating: number | null;
    postRating: number | null;
    preLeaguePoints: number | null;
    postLeaguePoints: number | null;
    preMrPoints: number | null;
    postMrPoints: number | null;
    occurredAt: string | null;
  }>;
  updatedAt: string | null;
}

const pauseMenu = createPauseMenu({
  getTuning: () => state.tuning,
  setTuning: (tuning) => {
    state.tuning = sanitiseTuning(tuning);
  },
  getAudioSettings: () => audioSettings,
  setAudioSettings: (settings) => {
    audioSettings = sanitiseAudioSettings(settings);
    hud.setVoiceSubtitlesEnabled(audioSettings.subtitlesEnabled);
    persistSettings();
  },
  enableDebugTab: runtimeConfig.features.debugToolsEnabled,
  canExportTrainingTelemetry: () => selectedMode === 'training',
  onExportTrainingTelemetry: async () => {
    if (selectedMode !== 'training') {
      return 'Training telemetry export is only available in training mode.';
    }
    return exportTrainingTelemetrySession();
  },
  onRestartTraining: () => {
    restartTrainingRound();
  },
});
pauseMenu.setCanRestartTraining(selectedMode === 'training');
hud.setVoiceSubtitlesEnabled(audioSettings.subtitlesEnabled);
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
const diagnosticsRulesetVersion = activeRulesetVersion;
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
  const response = await requestOnlineRaw(method, path, accountId, body);
  if (!response.ok) {
    throw new Error(await parseOnlineApiError(response));
  }
  return await response.json() as T;
}

async function requestOnlineRaw(
  method: 'GET' | 'POST',
  path: string,
  accountId: string,
  body?: unknown,
): Promise<Response> {
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
  return response;
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
    const diagnostics = ticket.matchStart?.diagnostics;
    const diagnosticsLine = diagnostics
      ? `Band: ${diagnostics.skillTrack ?? 'n/a'} | Gap: ${diagnostics.matchedGap ?? 'n/a'} / ${diagnostics.expectedGap ?? 'n/a'}`
      : 'Band: pending';
    return {
      headline: 'Match found',
      detail: `Ticket: ${ticket.ticketId}\nSession: ${ticket.matchStart?.sessionId ?? session?.sessionId ?? 'pending'}\n${participantLine}\n${diagnosticsLine}`,
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

function formatReplayArchiveDetail(items: ReplaySearchItemView[]): string {
  if (items.length === 0) {
    return 'No replays found for this account yet.';
  }
  return items
    .slice(0, 10)
    .map((item, index) => {
      const opponent = item.opponent?.accountId ?? 'unknown';
      const result = item.player?.result ?? 'unknown';
      const queue = item.queueType ?? 'unknown';
      return `${index + 1}. ${item.replayId} | ${queue} | vs ${opponent} | ${result}`;
    })
    .join('\n');
}

async function refreshReplayArchive(): Promise<ReplayArchiveViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  const path = `/replays/search?playerId=${encodeURIComponent(accountId)}&limit=10`;
  const response = await requestOnlineJson<ReplaySearchResponseView>('GET', path, accountId);
  playerReplayItems = Array.isArray(response.items) ? response.items : [];
  return {
    headline: playerReplayItems.length > 0
      ? `Loaded ${playerReplayItems.length} replay(s)`
      : 'No replays found',
    detail: formatReplayArchiveDetail(playerReplayItems),
  };
}

async function openLatestReplay(): Promise<ReplayArchiveViewState> {
  if (playerReplayItems.length === 0) {
    await refreshReplayArchive();
  }
  const latest = playerReplayItems[0];
  if (!latest) {
    return {
      headline: 'No replay available',
      detail: 'No replay records available to open.',
    };
  }
  const accountId = getOnlineAccountIdOrThrow();
  const payloadResponse = await requestOnlineJson<ReplayPayloadResponseView>(
    'GET',
    `/replays/${latest.replayId}/payload`,
    accountId,
  );
  const opened = beginReplayReviewFromPayload(payloadResponse.payload, `archive:${payloadResponse.replayId}`);
  if (!opened) {
    throw new Error(`Replay payload validation failed for ${payloadResponse.replayId}.`);
  }
  return {
    headline: `Opened replay ${payloadResponse.replayId}`,
    detail: formatReplayArchiveDetail(playerReplayItems),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }
  return null;
}

function parseRankedDelta(payload: unknown): RankedProgressionView['recentDeltas'][number] | null {
  const row = asRecord(payload);
  if (!row) {
    return null;
  }
  return {
    result: stringOrNull(row.result),
    preRating: numberOrNull(row.preRating) ?? numberOrNull(row.ratingBefore),
    postRating: numberOrNull(row.postRating) ?? numberOrNull(row.ratingAfter),
    preLeaguePoints: numberOrNull(row.preLeaguePoints) ?? numberOrNull(row.leaguePointsBefore),
    postLeaguePoints: numberOrNull(row.postLeaguePoints) ?? numberOrNull(row.leaguePointsAfter),
    preMrPoints: numberOrNull(row.preMrPoints) ?? numberOrNull(row.mrPointsBefore),
    postMrPoints: numberOrNull(row.postMrPoints) ?? numberOrNull(row.mrPointsAfter),
    occurredAt: stringOrNull(row.occurredAt),
  };
}

function formatSigned(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return value > 0 ? `+${value}` : String(value);
}

function buildRankedTrendLine(snapshot: RankedProgressionView): string {
  if (snapshot.recentDeltas.length === 0) {
    return 'Trend: no recent ranked deltas yet.';
  }
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let forfeits = 0;
  let ratingDeltaTotal = 0;
  let ratingSamples = 0;
  let mrDeltaTotal = 0;
  let mrSamples = 0;
  for (const delta of snapshot.recentDeltas) {
    if (delta.result === 'win') {
      wins += 1;
    } else if (delta.result === 'loss') {
      losses += 1;
    } else if (delta.result === 'draw') {
      draws += 1;
    } else if (delta.result === 'forfeit') {
      forfeits += 1;
    }
    if (delta.preRating !== null && delta.postRating !== null) {
      ratingDeltaTotal += delta.postRating - delta.preRating;
      ratingSamples += 1;
    }
    if (delta.preMrPoints !== null && delta.postMrPoints !== null) {
      mrDeltaTotal += delta.postMrPoints - delta.preMrPoints;
      mrSamples += 1;
    }
  }
  const ratingDeltaLabel = ratingSamples > 0 ? formatSigned(ratingDeltaTotal) : 'n/a';
  const mrDeltaLabel = mrSamples > 0 ? formatSigned(mrDeltaTotal) : 'n/a';
  return `Trend (last ${snapshot.recentDeltas.length}): ${wins}W-${losses}L-${draws}D-${forfeits}F | Rating ${ratingDeltaLabel} | MR ${mrDeltaLabel}`;
}

function buildPromotionLine(snapshot: RankedProgressionView): string {
  const tier = snapshot.leagueTier;
  if (!tier) {
    const placement = snapshot.placement;
    if (!placement || placement.calibrationMatchesRequired === null || placement.calibrationMatchesPlayed === null) {
      return 'Placement: calibration in progress.';
    }
    return `Placement: ${placement.calibrationMatchesPlayed}/${placement.calibrationMatchesRequired} calibration matches complete.`;
  }
  if (tier === 'Platinum') {
    return snapshot.mrPoints !== null
      ? `Master Track: active at MR ${snapshot.mrPoints}.`
      : 'Master Track: reach master entry threshold to unlock MR.';
  }
  const points = snapshot.leaguePoints ?? 0;
  const pointsToPromotion = Math.max(1, 100 - points);
  const nextTierByTier: Record<string, string> = {
    Iron: 'Bronze',
    Bronze: 'Silver',
    Silver: 'Gold',
    Gold: 'Platinum',
  };
  const nextTier = nextTierByTier[tier] ?? 'next tier';
  return `Promotion: ${pointsToPromotion} LP to ${nextTier}.`;
}

function parseRankedProgression(payload: unknown): RankedProgressionView | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const current = asRecord(root.current) ?? root;
  const placementRoot = asRecord(current.placement) ?? asRecord(root.placement);
  const recentRaw = Array.isArray(root.recentDeltas)
    ? root.recentDeltas
    : Array.isArray(root.recentResults)
      ? root.recentResults
      : Array.isArray(current.recentDeltas)
        ? current.recentDeltas
        : [];
  return {
    seasonId: stringOrNull(current.seasonId) ?? stringOrNull(root.seasonId),
    rating: numberOrNull(current.rating),
    leagueTier: stringOrNull(current.leagueTier),
    leaguePoints: numberOrNull(current.leaguePoints),
    mrPoints: numberOrNull(current.mrPoints),
    provisional: booleanOrNull(current.provisional),
    placement: placementRoot
      ? {
        calibrationMatchesPlayed: numberOrNull(placementRoot.calibrationMatchesPlayed),
        calibrationMatchesRequired: numberOrNull(placementRoot.calibrationMatchesRequired),
        calibrationMatchesRemaining: numberOrNull(placementRoot.calibrationMatchesRemaining),
      }
      : null,
    recentDeltas: recentRaw
      .map((entry) => parseRankedDelta(entry))
      .filter((entry): entry is RankedProgressionView['recentDeltas'][number] => entry !== null),
    updatedAt: stringOrNull(current.updatedAt) ?? stringOrNull(root.updatedAt),
  };
}

function toRankedSnapshotViewState(snapshot: RankedProgressionView | null, source: 'api' | 'profile' | 'none'): RankedSnapshotViewState {
  if (!snapshot) {
    return {
      headline: 'No ranked data',
      detail: 'No ranked progression data is available yet.',
    };
  }
  const sourceLabel = source === 'api' ? 'Ranked API' : 'Profile fallback';
  const statusLine = snapshot.provisional
    ? 'Status: Provisional placement period active.'
    : 'Status: Placement complete.';
  const placement = snapshot.placement;
  const placementLine = placement && placement.calibrationMatchesRequired !== null && placement.calibrationMatchesPlayed !== null
    ? `Calibration: ${placement.calibrationMatchesPlayed}/${placement.calibrationMatchesRequired} (${placement.calibrationMatchesRemaining ?? 'n/a'} remaining)`
    : 'Calibration: n/a';
  const trendLine = buildRankedTrendLine(snapshot);
  const promotionLine = buildPromotionLine(snapshot);
  return {
    headline: `${snapshot.leagueTier ?? 'Placement'} | Rating ${snapshot.rating ?? 'n/a'}`,
    detail: `Source: ${sourceLabel}\nSeason: ${snapshot.seasonId ?? 'current'}\n${statusLine}\n${placementLine}\nLeague Points: ${snapshot.leaguePoints ?? 'n/a'}\nMR Points: ${snapshot.mrPoints ?? 'n/a'}\n${promotionLine}\n${trendLine}\nUpdated: ${snapshot.updatedAt ?? 'unknown'}`,
  };
}

async function refreshRankedSnapshot(): Promise<RankedSnapshotViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  const rankedResponse = await requestOnlineRaw('GET', '/ranked/progression', accountId);
  if (rankedResponse.ok) {
    const payload = await rankedResponse.json() as unknown;
    playerRankedSnapshot = parseRankedProgression(payload);
    return toRankedSnapshotViewState(playerRankedSnapshot, 'api');
  }
  if (rankedResponse.status !== 404 && rankedResponse.status !== 501) {
    throw new Error(await parseOnlineApiError(rankedResponse));
  }

  const profile = await platform.profile.getProfile(accountId);
  const settings = asRecord(profile.settings);
  const rankedSettings = asRecord(settings?.ranked) ?? asRecord(settings?.rankedProgression);
  playerRankedSnapshot = rankedSettings ? parseRankedProgression(rankedSettings) : null;
  return toRankedSnapshotViewState(playerRankedSnapshot, playerRankedSnapshot ? 'profile' : 'none');
}

const startMenu = createStartMenu({
  initialMode: selectedMode,
  initialMenuThemeId: selectedMenuThemeId,
  availableMenuThemes: MENU_THEME_OPTIONS,
  initialStageAtmosphereId: selectedStageAtmosphereId,
  availableStageAtmospheres: STAGE_ATMOSPHERE_OPTIONS,
  initialLoadout: selectedLoadout,
  initialAiDifficulty: selectedAiDifficulty,
  initialArcadeSettings: selectedArcadeSettings,
  enabledModes,
  initialAccountSummary: 'Guest Account',
  onStartMode: (mode, loadout, aiDifficulty, arcadeSettings) => {
    beginMode(mode, loadout, aiDifficulty, arcadeSettings);
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
    beginMode(selectedMode, selectedLoadout, selectedAiDifficulty, selectedArcadeSettings);
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
  onRefreshReplayArchive: async () => {
    return await refreshReplayArchive();
  },
  onOpenLatestReplay: async () => {
    return await openLatestReplay();
  },
  onRefreshRankedSnapshot: async () => {
    return await refreshRankedSnapshot();
  },
  onOpenOnlineDevMenu: onlineDevMenuEnabled
    ? (target?: OnlineDevMenuTarget) => {
      openOnlineDevMenu(target);
    }
    : undefined,
  onOpenReplayReview: () => {
    void beginReplayReviewFromFixture('smoke.replay.json');
  },
  onMenuThemeChange: (themeId: string) => {
    selectedMenuThemeId = resolveMenuTheme(themeId).id;
    applyMenuTheme(resolveMenuTheme(selectedMenuThemeId), document.documentElement.style);
    persistSettings();
  },
  onStageAtmosphereChange: (atmosphereId: string) => {
    selectedStageAtmosphereId = applyStageAtmospherePreset(sceneContext, atmosphereId);
    persistSettings();
  },
});
startMenu.setEntitlementGate(true, null);
applyArcadeHistoryView();
void preloadAssetManifest(DEFAULT_ASSET_MANIFEST, {
  onProgress: (progress) => {
    if (runtimeConfig.features.debugToolsEnabled && progress.loaded === progress.total) {
      console.info(`[assets] preloaded ${progress.loaded}/${progress.total} manifest entries`);
    }
  },
}).then((result) => {
  assetPreloadBytesLoaded = result.entries.reduce((total, entry) => total + entry.bytes, 0);
}).catch((error) => {
  console.error('[assets] preload failed', error);
});

const fixedDt = 1 / 60;
const maxAccumulatedTime = 0.25;

let accumulator = 0;
let lastTimeSeconds = performance.now() / 1000;
let pauseButtonWasDown = false;
let pauseToggleLockUntil = 0;
let frameDataToggleButtonWasDown = false;
let frameDataToggleLockUntil = 0;
let trainingFrameDataVisible = selectedMode === 'training';
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
let playerReplayItems: ReplaySearchItemView[] = [];
let playerRankedSnapshot: RankedProgressionView | null = null;

function syncTrainingFrameDataVisibility(): void {
  const shouldShow = selectedMode === 'training' && appPhase === 'playing' && trainingFrameDataVisible;
  hud.setTrainingFrameDataVisible(shouldShow);
}

function setTrainingFrameDataVisibility(visible: boolean): void {
  trainingFrameDataVisible = visible;
  syncTrainingFrameDataVisibility();
}

function toggleTrainingFrameDataVisibility(): void {
  if (selectedMode !== 'training' || appPhase !== 'playing') {
    return;
  }
  setTrainingFrameDataVisibility(!trainingFrameDataVisible);
}

function formatAccountSummary(session: PlatformAuthSession): string {
  if (!session.isAuthenticated || !session.accountId) {
    const recovery = session.displayName?.trim();
    if (recovery) {
      return recovery;
    }
    return `Guest Account (${session.accountId ?? 'local'})`;
  }
  const name = session.displayName?.trim();
  return name ? `Signed in: ${name}` : `Signed in: ${session.accountId}`;
}

function getEnabledModes(): GameMode[] {
  return ['endless', 'best_of_3', 'arcade', 'training'];
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

function resolveStoredAiDifficulty(value: string | undefined): AiDifficultyId {
  if (value === 'rookie' || value === 'cadet' || value === 'veteran' || value === 'ace') {
    return value;
  }
  return DEFAULT_AI_DIFFICULTY;
}

function resolveStoredMenuThemeId(value: string | undefined): string {
  return resolveMenuTheme(value).id;
}

function resolveStoredStageAtmosphereId(value: string | undefined): string {
  return resolveStageAtmosphere(value).id;
}

function sanitiseArcadeMenuSettings(raw: unknown): ArcadeMenuSettings {
  const value = raw && typeof raw === 'object' ? raw as { continues?: unknown; retryEnabled?: unknown } : {};
  const requestedContinues = Number(value.continues);
  const continues = Number.isFinite(requestedContinues)
    ? Math.max(0, Math.min(3, Math.floor(requestedContinues)))
    : DEFAULT_ARCADE_MENU_SETTINGS.continues;
  return {
    continues,
    retryEnabled: value.retryEnabled === undefined
      ? DEFAULT_ARCADE_MENU_SETTINGS.retryEnabled
      : Boolean(value.retryEnabled),
  };
}

function coerceStoredSettings(raw: unknown): LoadedSettings | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const parsed = raw as StoredSettings;
  const hasKnownKeys = 'mode' in parsed
    || 'menuThemeId' in parsed
    || 'stageAtmosphereId' in parsed
    || 'loadout' in parsed
    || 'audio' in parsed
    || 'aiDifficulty' in parsed
    || 'arcade' in parsed;
  if (!hasKnownKeys) {
    return null;
  }
  const mode = resolveStoredMode(parsed.mode);
  const parsedP1 = parsed.loadout?.P1;
  const parsedP2 = parsed.loadout?.P2;
  const p1 = isCharacterId(parsedP1) ? parsedP1 : DEFAULT_CHARACTER_LOADOUT.P1;
  const p2 = isCharacterId(parsedP2) ? parsedP2 : DEFAULT_CHARACTER_LOADOUT.P2;
  const audio = sanitiseAudioSettings(parsed.audio);
  const aiDifficulty = resolveStoredAiDifficulty(parsed.aiDifficulty);
  const menuThemeId = resolveStoredMenuThemeId(parsed.menuThemeId);
  const stageAtmosphereId = resolveStoredStageAtmosphereId(parsed.stageAtmosphereId);
  const arcade = sanitiseArcadeMenuSettings(parsed.arcade);

  return {
    mode,
    menuThemeId,
    stageAtmosphereId,
    loadout: {
      P1: p1,
      P2: p2,
    },
    aiDifficulty,
    arcade,
    audio,
  };
}

function loadSettings(): LoadedSettings {
  const fallbackMode = resolveStoredMode('endless');
  const fallback: LoadedSettings = {
    mode: fallbackMode,
    menuThemeId: DEFAULT_MENU_THEME_ID,
    stageAtmosphereId: DEFAULT_STAGE_ATMOSPHERE_ID,
    loadout: {
      P1: DEFAULT_CHARACTER_LOADOUT.P1,
      P2: DEFAULT_CHARACTER_LOADOUT.P2,
    },
    aiDifficulty: DEFAULT_AI_DIFFICULTY,
    arcade: { ...DEFAULT_ARCADE_MENU_SETTINGS },
    audio: DEFAULT_AUDIO_SETTINGS,
  };

  const persisted = platform.persistence.readJson<StoredSettings>(SETTINGS_STORAGE_KEY);
  if (!persisted.ok) {
    return fallback;
  }
  return coerceStoredSettings(persisted.value) ?? fallback;
}

function loadArcadeHistory(): ArcadeRunHistory {
  const persisted = platform.persistence.readJson<unknown>(ARCADE_HISTORY_STORAGE_KEY);
  if (!persisted.ok) {
    return createEmptyArcadeRunHistory();
  }
  return sanitiseArcadeRunHistory(persisted.value);
}

function persistArcadeHistory(): void {
  const writeResult = platform.persistence.writeJson(ARCADE_HISTORY_STORAGE_KEY, arcadeHistory);
  if (!writeResult.ok && runtimeConfig.features.debugToolsEnabled) {
    console.warn('[persistence] arcade history write skipped', writeResult);
  }
}

function formatArcadeDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(wholeSeconds / 60);
  const secs = wholeSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function buildArcadeHistoryView(history: ArcadeRunHistory): { headline: string; detail: string } {
  if (history.entries.length === 0) {
    return {
      headline: 'No arcade runs',
      detail: 'Complete an arcade ladder run to populate recent runs and best completion records.',
    };
  }

  const recentLines = history.entries.slice(0, 5).map((entry) => {
    const character = CHARACTER_BY_ID[entry.playerCharacterId]?.displayName ?? entry.playerCharacterId;
    const date = new Date(entry.completedAt).toISOString().slice(0, 10);
    const resultLabel = entry.outcome === 'completed' ? 'Clear' : 'Failed';
    return `${date} | ${character} | ${entry.aiDifficulty} | ${resultLabel} | ${formatArcadeDuration(entry.completionSeconds)}`;
  });
  const bestRecords = computeArcadeBestRecords(history).slice(0, 6);
  const bestLines = bestRecords.length > 0
    ? bestRecords.map((record) => {
      const character = CHARACTER_BY_ID[record.playerCharacterId]?.displayName ?? record.playerCharacterId;
      return `${character} | ${record.aiDifficulty} | ${formatArcadeDuration(record.completionSeconds)}`;
    })
    : ['No completed clears yet.'];

  return {
    headline: `${history.entries.length} run(s) recorded`,
    detail: `Recent Runs:\n${recentLines.join('\n')}\n\nBest Clears:\n${bestLines.join('\n')}`,
  };
}

function applyArcadeHistoryView(): void {
  const view = buildArcadeHistoryView(arcadeHistory);
  startMenu.setArcadeHistoryView(view.headline, view.detail);
}

function buildFullProfileSettingsPayload(
  baseSettings: Record<string, unknown> | null | undefined,
  history: ArcadeRunHistory = arcadeHistory,
): Record<string, unknown> {
  return {
    ...(baseSettings ?? {}),
    mode: selectedMode,
    menuThemeId: selectedMenuThemeId,
    stageAtmosphereId: selectedStageAtmosphereId,
    loadout: selectedLoadout,
    aiDifficulty: selectedAiDifficulty,
    arcade: selectedArcadeSettings,
    audio: audioSettings,
    arcadeHistory: history,
  };
}

function buildHistorySyncProfileSettingsPayload(
  baseSettings: Record<string, unknown> | null | undefined,
  history: ArcadeRunHistory,
): Record<string, unknown> {
  return {
    ...(baseSettings ?? {}),
    arcadeHistory: history,
  };
}

function applyLoadedProfileSettings(profileSettings: LoadedSettings): void {
  selectedMode = profileSettings.mode;
  selectedMenuThemeId = profileSettings.menuThemeId;
  selectedStageAtmosphereId = profileSettings.stageAtmosphereId;
  selectedLoadout = profileSettings.loadout;
  selectedAiDifficulty = profileSettings.aiDifficulty;
  selectedArcadeSettings = profileSettings.arcade;
  audioSettings = profileSettings.audio;
  applyMenuTheme(resolveMenuTheme(selectedMenuThemeId), document.documentElement.style);
  selectedStageAtmosphereId = applyStageAtmospherePreset(sceneContext, selectedStageAtmosphereId);
  startMenu.setMenuTheme(selectedMenuThemeId);
  startMenu.setStageAtmosphere(selectedStageAtmosphereId);
  startMenu.setLocalSetup(selectedMode, selectedLoadout, selectedAiDifficulty, selectedArcadeSettings);
  audioSystem.setBusVolume('master', audioSettings.masterVolume);
  audioSystem.setBusVolume('music', audioSettings.musicVolume);
  audioSystem.setBusVolume('sfx', audioSettings.sfxVolume);
  audioSystem.setBusVolume('voice', audioSettings.voiceVolume);
  persistSettings();
}

function persistSettings(): void {
  const payload: StoredSettings = {
    mode: selectedMode,
    menuThemeId: selectedMenuThemeId,
    stageAtmosphereId: selectedStageAtmosphereId,
    loadout: {
      P1: selectedLoadout.P1,
      P2: selectedLoadout.P2,
    },
    aiDifficulty: selectedAiDifficulty,
    arcade: selectedArcadeSettings,
    audio: audioSettings,
  };
  const result = platform.persistence.writeJson(SETTINGS_STORAGE_KEY, payload);
  if (!result.ok && runtimeConfig.features.debugToolsEnabled) {
    console.warn('[persistence] settings write skipped', result);
  }
}

async function syncArcadeHistoryWithProfile(
  accountId: string,
  sourceSettings?: Record<string, unknown> | null,
): Promise<void> {
  const remoteSettings = sourceSettings ?? profileSettingsCache ?? {};
  const remoteHistory = sanitiseArcadeRunHistory((remoteSettings as { arcadeHistory?: unknown }).arcadeHistory);
  const mergedHistory = mergeArcadeRunHistories(arcadeHistory, remoteHistory, MAX_ARCADE_HISTORY_ENTRIES);

  if (!areArcadeRunHistoriesEqual(arcadeHistory, mergedHistory)) {
    arcadeHistory = mergedHistory;
    persistArcadeHistory();
    applyArcadeHistoryView();
  }

  if (areArcadeRunHistoriesEqual(mergedHistory, remoteHistory)) {
    return;
  }

  const savedProfile = await platform.profile.saveProfile(accountId, {
    settings: buildHistorySyncProfileSettingsPayload(remoteSettings, mergedHistory),
  });
  const savedSettings = asRecord(savedProfile.settings) ?? {};
  profileSettingsCache = savedSettings;
  const savedHistory = sanitiseArcadeRunHistory(savedSettings.arcadeHistory);
  if (!areArcadeRunHistoriesEqual(arcadeHistory, savedHistory)) {
    arcadeHistory = mergeArcadeRunHistories(savedHistory, arcadeHistory, MAX_ARCADE_HISTORY_ENTRIES);
    persistArcadeHistory();
    applyArcadeHistoryView();
  }
}

function recordArcadeRunSummary(outcome: 'completed' | 'failed', summary: {
  stagesCleared: number;
  totalStages: number;
  continuesUsed: number;
  retriesUsed: number;
  durationSeconds: number;
}): void {
  const recordedDifficulty = arcadeRun
    ? resolveRecordedArcadeDifficulty(arcadeRun)
    : selectedAiDifficulty;
  const completedAt = new Date().toISOString();
  const runId = `${completedAt}:${selectedLoadout.P1}:${recordedDifficulty}:${summary.durationSeconds.toFixed(3)}:${outcome}`;
  const entry: ArcadeRunHistoryEntry = {
    id: runId,
    completedAt,
    playerCharacterId: selectedLoadout.P1,
    aiDifficulty: recordedDifficulty,
    outcome,
    completionSeconds: Math.max(0, summary.durationSeconds),
    stagesCleared: summary.stagesCleared,
    totalStages: summary.totalStages,
    continuesUsed: summary.continuesUsed,
    retriesUsed: summary.retriesUsed,
  };
  arcadeHistory = appendArcadeRunHistoryEntry(arcadeHistory, entry, MAX_ARCADE_HISTORY_ENTRIES);
  persistArcadeHistory();
  applyArcadeHistoryView();
  if (sessionAccountId) {
    void syncArcadeHistoryWithProfile(sessionAccountId, profileSettingsCache).catch((error) => {
      if (runtimeConfig.features.debugToolsEnabled) {
        console.warn('[profile] arcade history sync failed', error);
      }
    });
  }
}

async function bootstrapPlatformProfile(): Promise<void> {
  let session: PlatformAuthSession;
  try {
    session = await platform.auth.getSession();
  } catch (error) {
    if (runtimeConfig.features.debugToolsEnabled) {
      console.warn('[auth] getSession failed during bootstrap; falling back to guest defaults', error);
    }
    session = {
      accountId: null,
      displayName: 'Guest',
      isAuthenticated: false,
    };
  }

  sessionAccountId = session.accountId;
  startMenu.setAccountSummary(formatAccountSummary(session));
  startMenu.setAuthState(session.isAuthenticated);
  try {
    await refreshEntitlementGate('startup');
  } catch {
    startMenu.setEntitlementGate(false, 'Entitlement check failed. Please retry or refresh.');
    return;
  }

  if (!session.isAuthenticated) {
    playerRankedTicket = null;
    playerRankedSession = null;
    playerRoom = null;
    playerReplayItems = [];
    playerRankedSnapshot = null;
    profileSettingsCache = {};
  }

  if (!session.accountId) {
    return;
  }

  try {
    const profile = await platform.profile.getProfile(session.accountId);
    const remoteSettings = asRecord(profile.settings) ?? {};
    profileSettingsCache = remoteSettings;
    if (session.isAuthenticated && profile.displayName) {
      startMenu.setAccountSummary(`Signed in: ${profile.displayName}`);
    }
    const profileSettings = coerceStoredSettings(remoteSettings);
    if (profileSettings) {
      applyLoadedProfileSettings(profileSettings);
    }
    await syncArcadeHistoryWithProfile(session.accountId, remoteSettings);
  } catch (error) {
    if (runtimeConfig.features.debugToolsEnabled) {
      console.warn('[profile] bootstrap hydration failed; continuing without profile sync', error);
    }
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
  await refreshEntitlementGate('session');
  if (!session.isAuthenticated) {
    playerRankedTicket = null;
    playerRankedSession = null;
    playerRoom = null;
    playerReplayItems = [];
    playerRankedSnapshot = null;
    profileSettingsCache = {};
  }
  if (session.accountId) {
    try {
      const profile = await platform.profile.getProfile(session.accountId);
      const remoteSettings = asRecord(profile.settings) ?? {};
      profileSettingsCache = remoteSettings;
      if (session.isAuthenticated && profile.displayName) {
        startMenu.setAccountSummary(`Signed in: ${profile.displayName}`);
      }
      const loadedProfileSettings = coerceStoredSettings(remoteSettings);
      if (loadedProfileSettings) {
        applyLoadedProfileSettings(loadedProfileSettings);
      }
      await syncArcadeHistoryWithProfile(session.accountId, remoteSettings);
    } catch (error) {
      if (runtimeConfig.features.debugToolsEnabled) {
        console.warn('[profile] post-auth hydration failed; session remains active', error);
      }
    }
  }
}

async function refreshEntitlementGate(stage: 'startup' | 'session'): Promise<void> {
  const access = await platform.entitlement.checkAccess({
    stage,
    accountId: sessionAccountId,
  });
  if (access.allowed) {
    startMenu.setEntitlementGate(true, null);
    return;
  }

  startMenu.setEntitlementGate(false, `${access.message} [${access.code}]`);
  if (runtimeConfig.features.debugToolsEnabled) {
    console.warn('[entitlement] access blocked', {
      stage,
      code: access.code,
      status: access.status,
      accountId: sessionAccountId,
    });
  }
}

function getAiDifficultyRank(value: AiDifficultyId): number {
  const index = AI_DIFFICULTY_ORDER.indexOf(value);
  return index >= 0 ? index : 0;
}

function aiDifficultyByRank(rank: number): AiDifficultyId {
  const safeRank = Math.max(0, Math.min(AI_DIFFICULTY_ORDER.length - 1, Math.floor(rank)));
  return AI_DIFFICULTY_ORDER[safeRank] ?? DEFAULT_AI_DIFFICULTY;
}

function resolveAiDifficultyForCurrentMatch(): AiDifficultyId {
  if (selectedMode !== 'arcade' || !arcadeRun) {
    return selectedAiDifficulty;
  }
  const stage = getCurrentArcadeStage(arcadeRun);
  return getAiDifficultyRank(stage.aiDifficulty) > getAiDifficultyRank(selectedAiDifficulty)
    ? stage.aiDifficulty
    : selectedAiDifficulty;
}

function resolveLoadoutForCurrentMatch(): PlayersById<CharacterId> {
  if (selectedMode === 'arcade' && arcadeRun) {
    const stage = getCurrentArcadeStage(arcadeRun);
    return {
      P1: selectedLoadout.P1,
      P2: stage.opponentCharacterId,
    };
  }
  return selectedLoadout;
}

function resolveRecordedArcadeDifficulty(run: ArcadeRunState): AiDifficultyId {
  let maxRank = getAiDifficultyRank(selectedAiDifficulty);
  for (const record of run.records) {
    const rank = getAiDifficultyRank(record.aiDifficulty);
    if (rank > maxRank) {
      maxRank = rank;
    }
  }
  return aiDifficultyByRank(maxRank);
}

function createTrainingTelemetryForCurrentSelection(): TrainingTelemetryTracker {
  return createTrainingTelemetryTracker({
    balanceProfileId: activeBalanceProfile.id,
    rulesetVersion: activeRulesetVersion,
    playerCharacterId: selectedLoadout.P1,
    opponentCharacterId: selectedLoadout.P2,
  });
}

function resetRoundState(): void {
  persistRollbackDiagnostics('round_reset');
  const tuning = state.tuning;
  const matchLoadout = resolveLoadoutForCurrentMatch();
  state = createInitialState({
    loadout: matchLoadout,
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
  aiController = selectedMode === 'training'
    ? null
    : createAiController({
      seed: selectedMatchSeed ^ 0x9e3779b9,
      profileId: resolveAiDifficultyForCurrentMatch(),
    });
  const showDebugDiagnostics = runtimeConfig.features.debugToolsEnabled;
  hud.setRollbackDiagnosticsVisible(showDebugDiagnostics);
  hud.updateRollbackDiagnostics(showDebugDiagnostics && rollbackSession ? getRollbackDiagnosticsView(rollbackSession) : null);
  const roundStartCallout = voiceCalloutSystem.trigger({
    playerId: 'P1',
    characterId: state.players.P1.characterId,
    event: 'round_start',
    timeSeconds: performance.now() / 1000,
  });
  if (roundStartCallout && audioSettings.subtitlesEnabled) {
    hud.showVoiceSubtitle(roundStartCallout.text);
  }
  if (selectedMode === 'training') {
    trainingTelemetry.updateMetadata({
      playerCharacterId: matchLoadout.P1,
      opponentCharacterId: matchLoadout.P2,
      balanceProfileId: activeBalanceProfile.id,
      rulesetVersion: activeRulesetVersion,
    });
    trainingTelemetry.startRound(state);
  }
}

function beginMode(
  mode: GameMode,
  loadout?: PlayersById<CharacterId>,
  aiDifficulty?: AiDifficultyId,
  arcadeSettings?: ArcadeMenuSettings,
): void {
  const resolvedMode = resolveStoredMode(mode);
  if (loadout) {
    selectedLoadout = {
      P1: loadout.P1,
      P2: loadout.P2,
    };
  }
  if (aiDifficulty) {
    selectedAiDifficulty = resolveStoredAiDifficulty(aiDifficulty);
  }
  if (arcadeSettings) {
    selectedArcadeSettings = sanitiseArcadeMenuSettings(arcadeSettings);
  }
  selectedMode = resolvedMode;
  if (selectedMode === 'training') {
    trainingTelemetry = createTrainingTelemetryForCurrentSelection();
  }
  if (!Number.isFinite(forcedSeed)) {
    selectedMatchSeed = ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0) || 1;
  }
  arcadePendingLossState = null;
  arcadeRun = selectedMode === 'arcade'
    ? createArcadeRun({
      startedAtMs: Date.now(),
      rules: {
        roundsToWin: 2,
        maxContinues: selectedArcadeSettings.continues,
        allowContinueAfterLoss: true,
        allowRetryStage: selectedArcadeSettings.retryEnabled,
      },
    })
    : null;
  p1RoundWins = 0;
  p2RoundWins = 0;
  roundTransitionRemaining = 0;
  resetRoundState();
  appPhase = 'playing';
  setTrainingFrameDataVisibility(selectedMode === 'training');
  persistSettings();
  if (sessionAccountId) {
    void platform.profile.saveProfile(sessionAccountId, {
      settings: buildFullProfileSettingsPayload(profileSettingsCache, arcadeHistory),
    }).then((savedProfile) => {
      profileSettingsCache = asRecord(savedProfile.settings) ?? profileSettingsCache;
    }).catch((error) => {
      if (runtimeConfig.features.debugToolsEnabled) {
        console.warn('[profile] settings save skipped', error);
      }
    });
  }
  void platform.presence.setStatus('playing');
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(selectedMode === 'training');
  startMenu.hideHome();
  startMenu.hideRoundBanner();
  hudRoot.style.visibility = 'visible';
  syncTrainingFrameDataVisibility();
  accumulator = 0;
}

function returnToHome(): void {
  persistRollbackDiagnostics('return_home');
  if (selectedMode === 'training') {
    trainingTelemetry.endRound('mode_exit');
  }
  arcadePendingLossState = null;
  if (selectedMode === 'arcade') {
    arcadeRun = null;
  }
  appPhase = 'home';
  void platform.presence.setStatus('home');
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(false);
  startMenu.showHome();
  replayViewer.hide();
  hudRoot.style.visibility = 'hidden';
  syncTrainingFrameDataVisibility();
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
  syncTrainingFrameDataVisibility();
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

function getRuntimeMemoryDiagnosticsView(snapshot: RenderSnapshot): RuntimeMemoryDiagnosticsView {
  const audioDiagnostics = audioSystem.getDiagnostics();
  return {
    assetBytesLoaded: assetPreloadBytesLoaded,
    textureBytesBudgeted: assetBudgetReport.usage.textureBytes,
    meshTrianglesBudgeted: assetBudgetReport.usage.meshTriangles,
    vfxBudgeted: assetBudgetReport.usage.vfxEmitters,
    vfxActive: sceneContext.combatVfxRuntime.active.length,
    projectilesActive: snapshot.projectiles.length,
    audioEventsRouted: audioDiagnostics.routedEvents,
    audioMissingRoutes: audioDiagnostics.missingRoutes,
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

  let entries: StoredRollbackDiagnosticsEntry[] = [];
  const persistedEntries = platform.persistence.readJson<StoredRollbackDiagnosticsEntry[]>(
    ROLLBACK_DIAGNOSTICS_STORAGE_KEY,
  );
  if (persistedEntries.ok && Array.isArray(persistedEntries.value)) {
    entries = persistedEntries.value;
  }
  entries.push(entry);
  if (entries.length > 20) {
    entries = entries.slice(entries.length - 20);
  }
  const writeResult = platform.persistence.writeJson(ROLLBACK_DIAGNOSTICS_STORAGE_KEY, entries);
  if (!writeResult.ok && runtimeConfig.features.debugToolsEnabled) {
    console.warn('[persistence] rollback diagnostics write skipped', writeResult);
  }
}

function exportTrainingTelemetrySession(): string {
  const summary = trainingTelemetry.toSummary();
  const payload: StoredTrainingTelemetryEntry = {
    exportedAt: summary.exportedAt,
    rulesetVersion: summary.rulesetVersion,
    balanceProfileId: summary.balanceProfileId,
    summary,
  };
  const timestamp = summary.exportedAt.replace(/[:.]/g, '-');
  const fileName = `gravity-well-training-telemetry-${timestamp}.json`;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  const writeResult = platform.persistence.writeJson(TRAINING_TELEMETRY_STORAGE_KEY, payload);
  if (!writeResult.ok && runtimeConfig.features.debugToolsEnabled) {
    console.warn('[persistence] training telemetry write skipped', writeResult);
  }

  return `Training telemetry exported: ${fileName}`;
}

function restartTrainingRound(reason: TrainingRoundEndReason = 'manual_restart'): void {
  if (selectedMode !== 'training') {
    return;
  }
  trainingTelemetry.endRound(reason);
  resetRoundState();
  appPhase = 'playing';
  startMenu.hideRoundBanner();
  startMenu.hideHome();
  hudRoot.style.visibility = 'visible';
  syncTrainingFrameDataVisibility();
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
  syncTrainingFrameDataVisibility();
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

  if (selectedMode === 'arcade') {
    const stage = arcadeRun ? getCurrentArcadeStage(arcadeRun) : null;
    const stageIndex = arcadeRun ? arcadeRun.stageIndex + 1 : 1;
    const totalStages = arcadeRun?.stages.length ?? 1;
    const stageLabel = stage?.label ?? 'Stage';
    matchInfo.textContent = `Mode: Arcade | ${stageIndex}/${totalStages} ${stageLabel} | ${getRoundScoreText()}`;
    return;
  }

  matchInfo.textContent = `Mode: Best of 3 | ${getRoundScoreText()}`;
}

function resolveAdaptiveMusicState(phase: AppPhase, snapshot: RenderSnapshot): MusicState {
  if (phase === 'home' || phase === 'online_dev') {
    return 'menu';
  }
  if (phase === 'match_over' || snapshot.winner) {
    return 'end';
  }
  const launchActive = snapshot.players.P1.helpless > 0 || snapshot.players.P2.helpless > 0;
  if (launchActive) {
    return 'launch';
  }
  return 'neutral';
}

function getDynamicRangeMixMultipliers(mode: AudioSettings['dynamicRangeMode']): {
  master: number;
  music: number;
  sfx: number;
  voice: number;
} {
  if (mode === 'reduced') {
    return {
      master: 0.95,
      music: 0.82,
      sfx: 0.76,
      voice: 1,
    };
  }
  return {
    master: 1,
    music: 1,
    sfx: 1,
    voice: 1,
  };
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

function isFrameDataToggleButtonDown(): boolean {
  const gamepads = navigator.getGamepads?.() ?? [];
  for (const gamepad of gamepads) {
    if (!gamepad) {
      continue;
    }
    const viewButton = gamepad.buttons[8];
    if (viewButton && (viewButton.pressed || viewButton.value > 0.35)) {
      return true;
    }
  }
  return false;
}

function restartArcadeStageFromLoss(action: ArcadeLossAction): void {
  if (!arcadeRun) {
    return;
  }
  applyArcadeLossAction(arcadeRun, action, Date.now());
  arcadePendingLossState = null;
  p1RoundWins = 0;
  p2RoundWins = 0;
  appPhase = 'playing';
  pauseMenu.setPaused(false);
  startMenu.hideRoundBanner();
  startMenu.hideHome();
  hudRoot.style.visibility = 'visible';
  syncTrainingFrameDataVisibility();
  resetRoundState();
  accumulator = 0;
  void platform.presence.setStatus('playing');
}

function showArcadeCompletionSummary(): void {
  if (!arcadeRun) {
    return;
  }
  const finalResolution = arcadeRun.records[arcadeRun.records.length - 1];
  const stagesCleared = arcadeRun.records.filter((record) => record.result === 'clear').length;
  const durationSeconds = Math.max(0, (Date.now() - arcadeRun.startedAtMs) / 1000);
  startMenu.showMatchOverScreen({
    title: 'Arcade Complete',
    subtitle: [
      `Final encounter cleared: ${finalResolution?.stageLabel ?? 'Unknown'}`,
      `Stages cleared: ${stagesCleared}/${arcadeRun.stages.length}`,
      `Continues used: ${arcadeRun.continuesUsed}`,
      `Retries used: ${arcadeRun.retriesUsed}`,
      `Run time: ${formatArcadeDuration(durationSeconds)}`,
    ].join('\n'),
    primaryLabel: 'Run Again',
    secondaryLabel: 'Return to Home',
    onPrimary: () => {
      beginMode('arcade', selectedLoadout, selectedAiDifficulty, selectedArcadeSettings);
    },
    onSecondary: () => {
      returnToHome();
    },
  });
}

function showArcadeFailureSummary(): void {
  if (!arcadeRun) {
    return;
  }
  const lastRecord = arcadeRun.records[arcadeRun.records.length - 1] ?? null;
  const stagesCleared = arcadeRun.records.filter((record) => record.result === 'clear').length;
  const durationSeconds = Math.max(0, (Date.now() - arcadeRun.startedAtMs) / 1000);
  startMenu.showMatchOverScreen({
    title: 'Arcade Run Ended',
    subtitle: [
      `Fell at: ${lastRecord?.stageLabel ?? 'Unknown stage'}`,
      `Stages cleared: ${stagesCleared}/${arcadeRun.stages.length}`,
      `Continues used: ${arcadeRun.continuesUsed}`,
      `Retries used: ${arcadeRun.retriesUsed}`,
      `Run time: ${formatArcadeDuration(durationSeconds)}`,
    ].join('\n'),
    primaryLabel: 'Try Arcade Again',
    secondaryLabel: 'Return to Home',
    onPrimary: () => {
      beginMode('arcade', selectedLoadout, selectedAiDifficulty, selectedArcadeSettings);
    },
    onSecondary: () => {
      returnToHome();
    },
  });
}

function showArcadeLossPrompt(stageLabel: string, allowedActions: ArcadeLossAction[]): void {
  arcadePendingLossState = { stageLabel, allowedActions };
  const remainingContinues = Math.max(0, selectedArcadeSettings.continues - (arcadeRun?.continuesUsed ?? 0));
  const canContinue = allowedActions.includes('continue');
  const canRetry = allowedActions.includes('retry_stage');

  const primaryLabel = canContinue
    ? `Continue (${remainingContinues} left)`
    : 'Retry Stage';
  const secondaryLabel = canContinue && canRetry
    ? 'Retry Stage'
    : 'Return to Home';

  startMenu.showMatchOverScreen({
    title: 'Arcade Stage Lost',
    subtitle: [
      `${stageLabel}`,
      `Choose how to proceed.`,
      `Continues left: ${remainingContinues}`,
      `Retry stage: ${canRetry ? 'Enabled' : 'Disabled'}`,
    ].join('\n'),
    primaryLabel,
    secondaryLabel,
    onPrimary: () => {
      if (canContinue) {
        restartArcadeStageFromLoss('continue');
      } else {
        restartArcadeStageFromLoss('retry_stage');
      }
    },
    onSecondary: () => {
      if (canContinue && canRetry) {
        restartArcadeStageFromLoss('retry_stage');
      } else {
        returnToHome();
      }
    },
  });
}

function onRoundWin(winner: PlayerId): void {
  if (selectedMode === 'training') {
    restartTrainingRound('round_win');
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

  const roundsToWin = selectedMode === 'arcade' && arcadeRun
    ? arcadeRun.rules.roundsToWin
    : 2;
  if (p1RoundWins >= roundsToWin || p2RoundWins >= roundsToWin) {
    if (selectedMode === 'arcade' && arcadeRun) {
      persistRollbackDiagnostics('arcade_match_end');
      const resolution = resolveArcadeMatch(arcadeRun, winner, p1RoundWins, p2RoundWins, Date.now());
      if (resolution.type === 'advance_stage') {
        p1RoundWins = 0;
        p2RoundWins = 0;
        appPhase = 'round_transition';
        roundTransitionRemaining = 1.2;
        startMenu.showRoundBanner(
          winner,
          `Stage Clear: ${resolution.clearedStage.label} -> ${resolution.nextStage.label}`,
        );
        return;
      }

      appPhase = 'match_over';
      void platform.presence.setStatus('match_over');
      hudRoot.style.visibility = 'hidden';
      if (resolution.type === 'run_complete') {
        recordArcadeRunSummary('completed', resolution.summary);
        const matchWinCallout = voiceCalloutSystem.trigger({
          playerId: winner,
          characterId: state.players[winner].characterId,
          event: 'match_win',
          timeSeconds: performance.now() / 1000,
        });
        if (matchWinCallout && audioSettings.subtitlesEnabled) {
          hud.showVoiceSubtitle(matchWinCallout.text);
        }
        showArcadeCompletionSummary();
        return;
      }
      if (resolution.type === 'stage_loss') {
        showArcadeLossPrompt(resolution.stage.label, resolution.allowedActions);
        return;
      }
      recordArcadeRunSummary('failed', resolution.summary);
      showArcadeFailureSummary();
      return;
    }

    persistRollbackDiagnostics('match_over');
    appPhase = 'match_over';
    const matchWinCallout = voiceCalloutSystem.trigger({
      playerId: winner,
      characterId: state.players[winner].characterId,
      event: 'match_win',
      timeSeconds: performance.now() / 1000,
    });
    if (matchWinCallout && audioSettings.subtitlesEnabled) {
      hud.showVoiceSubtitle(matchWinCallout.text);
    }
    void platform.presence.setStatus('match_over');
    startMenu.showMatchOver(winner, p1RoundWins, p2RoundWins);
    hudRoot.style.visibility = 'hidden';
    return;
  }

  appPhase = 'round_transition';
  roundTransitionRemaining = 1.2;
  if (selectedMode === 'arcade' && arcadeRun) {
    const stage = getCurrentArcadeStage(arcadeRun);
    startMenu.showRoundBanner(winner, `${stage.label} | ${getRoundScoreText()}`);
  } else {
    startMenu.showRoundBanner(winner, getRoundScoreText());
  }
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

  if (selectedMode === 'training' && appPhase === 'playing' && key === 'f1') {
    event.preventDefault();
    toggleTrainingFrameDataVisibility();
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

  const frameDataToggleDown = isFrameDataToggleButtonDown();
  if (
    frameDataToggleDown
    && !frameDataToggleButtonWasDown
    && nowSeconds >= frameDataToggleLockUntil
    && selectedMode === 'training'
    && appPhase === 'playing'
  ) {
    toggleTrainingFrameDataVisibility();
    frameDataToggleLockUntil = nowSeconds + 0.2;
  }
  frameDataToggleButtonWasDown = frameDataToggleDown;

  if (!pauseMenu.isPaused() && appPhase === 'playing') {
    accumulator = Math.min(accumulator + elapsedSeconds, maxAccumulatedTime);
  } else {
    accumulator = 0;
  }

  if (!pauseMenu.isPaused() && appPhase === 'playing') {
    while (accumulator >= fixedDt) {
      const frameInputRaw = input.getFrameInput();
      let frameInput = frameInputRaw;
      if (aiController) {
        const aiTick = tickAiController(state, 'P2', aiController);
        aiController = aiTick.next;
        frameInput = buildFrameInputWithAi(frameInputRaw.p1, aiTick.input, 'P2');
      }
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
      if (selectedMode === 'training') {
        trainingTelemetry.recordFrame(frameInput, state, fixedDt);
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

  const usesSimulationClock = appPhase === 'playing'
    || appPhase === 'round_transition'
    || appPhase === 'replay_review'
    || appPhase === 'match_over';
  const musicClockSeconds = usesSimulationClock ? snapshot.gameTime : nowSeconds;
  const nextMusicState = resolveAdaptiveMusicState(appPhase, snapshot);
  musicStateController.setState(nextMusicState, musicClockSeconds);
  const dynamicRange = getDynamicRangeMixMultipliers(audioSettings.dynamicRangeMode);
  const duckingActive = audioSettings.voiceDuckingEnabled && nowSeconds < voiceDuckingUntilSeconds;
  const duckingFactor = duckingActive ? 0.58 : 1;
  const musicStateGain = musicStateController.tick(musicClockSeconds);
  audioSystem.setBusVolume('master', audioSettings.masterVolume * dynamicRange.master);
  audioSystem.setBusVolume('music', audioSettings.musicVolume * dynamicRange.music * musicStateGain * duckingFactor);
  audioSystem.setBusVolume('sfx', audioSettings.sfxVolume * dynamicRange.sfx * duckingFactor);
  audioSystem.setBusVolume('voice', audioSettings.voiceVolume * dynamicRange.voice);

  renderFrame(sceneContext, snapshot);
  const memoryDiagnostics = runtimeConfig.features.debugToolsEnabled
    ? getRuntimeMemoryDiagnosticsView(snapshot)
    : null;

  if (appPhase === 'replay_review') {
    hud.setRollbackDiagnosticsVisible(false);
    hud.updateRollbackDiagnostics(null);
  } else if (runtimeConfig.features.debugToolsEnabled) {
    hud.setRollbackDiagnosticsVisible(true);
    hud.updateRollbackDiagnostics(rollbackSession ? getRollbackDiagnosticsView(rollbackSession) : null, memoryDiagnostics);
  } else {
    hud.setRollbackDiagnosticsVisible(false);
    hud.updateRollbackDiagnostics(null);
  }
  hud.update(snapshot);
  updateMatchInfo();
  updateOnlineDiagnosticsOverlay();

  requestAnimationFrame(tick);
}

hudRoot.style.visibility = 'hidden';
syncTrainingFrameDataVisibility();
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
  audioSystem.dispose();
  platform.dispose?.();
});
