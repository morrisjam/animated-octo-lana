import { createCombinedInput } from './input/combined';
import { createEmptyPlayerInput } from './input/frame';
import { createGamepadInput } from './input/gamepad';
import { createKeyboardInput } from './input/keyboard';
import { loadRuntimeConfig } from './config/features';
import { fetchMatchmakingIceConfig } from './net/connectivityApi';
import { createInputTimelineBuffer } from './net/inputTimeline';
import {
  RollbackSession,
  type RollbackDiagnosticsSnapshot,
} from './net/rollbackSession';
import {
  buildRtcConfiguration,
  RelayFallbackController,
  type ConnectionPath,
  type MatchmakingIceConfig,
} from './net/transport';
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
import {
  createMatchTelemetryTracker,
  type MatchTelemetryTracker,
} from './sim/matchTelemetry';
import { sanitiseTuning } from './sim/tuning';
import type { PlayerFrameInput, PlayerId, PlayersById, RenderSnapshot } from './sim/types';
import {
  AI_DIFFICULTY_ORDER,
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
import { buildInputHistoryView } from './view/inputHistory';
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

type AppPhase = 'home' | 'playing' | 'round_transition' | 'match_over' | 'replay_review' | 'online_dev' | 'online_bootstrap';
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
const AI_MATCH_TELEMETRY_STORAGE_KEY = 'gravity_well.ai_match_telemetry.v1';
const platform = createPlatformServices();
const runtimeConfig = loadRuntimeConfig();
const onlineRuntimeEnabled = platform.kind === 'web' && runtimeConfig.features.onlineMatchRuntimeEnabled;
const publicOnlineEntryEnabled = platform.kind === 'web'
  && runtimeConfig.features.onlineEnabled;
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
let devOpenMenuButton: HTMLButtonElement | null = null;
let devDebugPanel: HTMLDivElement | null = null;
let devDebugPhaseLabel: HTMLDivElement | null = null;
let onlineBootstrapPanel: HTMLDivElement | null = null;
let onlineBootstrapTitle: HTMLDivElement | null = null;
let onlineBootstrapDetail: HTMLPreElement | null = null;

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
const urlParams = new URLSearchParams(window.location.search);
const seedParam = urlParams.get('seed');
const localRecoveryUiEnabled = urlParams.get('localDebug') === '1';
const diagnosticsQueryOverride = urlParams.get('diagnostics');
const debugHudEnabled = urlParams.get('debugHud') === '1';
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
let matchTelemetry: MatchTelemetryTracker = createMatchTelemetryTracker(state);
const assetBudgetReport = buildAssetBudgetReport(DEFAULT_ASSET_MANIFEST, DEFAULT_ASSET_BUDGET_LIMITS);
let assetPreloadBytesLoaded = 0;
let appPhase: AppPhase = 'home';
let startupMenuGuardArmed = true;
let p1RoundWins = 0;
let p2RoundWins = 0;
let roundTransitionRemaining = 0;
let simulationFrame = 0;
let aiControllers: Partial<Record<PlayerId, AiControllerState>> = {};
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

interface StoredAiMatchTelemetryEntry {
  exportedAt: string;
  mode: 'cpu_vs_cpu';
  rulesetVersion: string;
  balanceProfileId: string;
  aiDifficulty: AiDifficultyId;
  menuThemeId: string;
  stageAtmosphereId: string;
  seed: number;
  loadout: PlayersById<CharacterId>;
  score: {
    p1Rounds: number;
    p2Rounds: number;
  };
  winner: PlayerId | null;
  statusText: string;
  summary: ReturnType<MatchTelemetryTracker['toSummary']>;
}

type QueueType = 'unranked' | 'ranked';
type RegionId = 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';

interface MatchStartPayload {
  sessionId: string;
  sessionToken: string;
  sessionTokenExpiresAt: string;
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
  expiresAt?: string;
  localPlayer: {
    accountId: string;
    queueTicketId: string;
    selectedCharacterId?: string | null;
    side: 'P1' | 'P2';
  };
  peer: {
    accountId: string;
    queueTicketId: string;
    selectedCharacterId?: string | null;
    side: 'P1' | 'P2';
  };
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

type OnlineBootstrapStatus = 'preparing' | 'awaiting_signaling' | 'failed';

interface OnlineBootstrapState {
  source: 'ranked_queue';
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  localAccountId: string;
  peerAccountId: string | null;
  sessionToken: string | null;
  sessionTokenExpiresAt: string | null;
  connectionPath: ConnectionPath | 'server';
  status: OnlineBootstrapStatus;
  statusDetail: string;
  diagnosticsLine: string;
  iceConfig: MatchmakingIceConfig | null;
}

interface OnlineSessionFrameEntry {
  frame: number;
  accountId: string;
  input: PlayerFrameInput;
  receivedAt: string;
}

interface OnlineSessionFrameResponse {
  frames: OnlineSessionFrameEntry[];
}

type RankedMatchOutcome = 'p1_win' | 'p2_win' | 'draw' | 'forfeit';
type OnlineRankedResultStatus = 'idle' | 'submitting' | 'accepted' | 'flagged_for_review' | 'already_processed' | 'failed';

interface RankedResultDeltaView {
  accountId: string;
  side: PlayerId;
  preRating: number;
  postRating: number;
  ratingDelta: number;
  result: 'win' | 'loss' | 'draw' | 'forfeit' | string;
  preLeagueTier?: string | null;
  postLeagueTier?: string | null;
  preLeaguePoints?: number | null;
  postLeaguePoints?: number | null;
  preMrPoints?: number | null;
  postMrPoints?: number | null;
}

interface RankedResultSubmitResponse {
  submissionId: string;
  createdAt: string;
  status: 'accepted' | 'flagged_for_review';
  suspicious: boolean;
  suspiciousReasons: string[];
  reviewStatus: string;
  ratingDeltas?: RankedResultDeltaView[];
}

class OnlineRequestError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'OnlineRequestError';
    this.status = status;
    this.code = code;
  }
}

interface OnlineMatchContext {
  sessionId: string;
  sessionToken: string;
  queueType: QueueType;
  region: RegionId;
  matchLoadout: PlayersById<CharacterId>;
  restoreMode: GameMode;
  restoreLoadout: PlayersById<CharacterId>;
  localPlayerId: PlayerId;
  remotePlayerId: PlayerId;
  localAccountId: string;
  remoteAccountId: string;
  statusText: string;
  connectionPath: ConnectionPath | 'server';
  lastRemoteFrame: number;
  outgoingFrames: Array<{ frame: number; input: PlayerFrameInput }>;
  pendingRemoteInputs: Map<number, PlayerFrameInput>;
  sendAccumulatorSeconds: number;
  pollAccumulatorSeconds: number;
  sendInFlight: boolean;
  pollInFlight: boolean;
  finalOutcome: RankedMatchOutcome | null;
  winnerAccountId: string | null;
  rankedResultStatus: OnlineRankedResultStatus;
  rankedResultDetail: string;
  rankedResultSubmissionId: string | null;
  rankedResultInFlight: boolean;
  sessionCompletionInFlight: boolean;
  sessionCompletionStatus: 'idle' | 'completing' | 'completed' | 'failed';
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
  canExportAiMatchTelemetry: () => selectedMode === 'cpu_vs_cpu',
  onExportAiMatchTelemetry: async () => {
    if (selectedMode !== 'cpu_vs_cpu') {
      return 'AI match telemetry export is only available in AI vs AI mode.';
    }
    return exportAiMatchTelemetrySession();
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
const diagnosticsEnabled = platform.kind === 'web' && (
  diagnosticsQueryOverride === '1'
  || (
    diagnosticsQueryOverride !== '0'
    && runtimeConfig.features.onlineDiagnosticsEnabled
  )
);
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
let onlineBootstrapState: OnlineBootstrapState | null = null;
let onlineRelayFallbackController: RelayFallbackController | null = null;
let onlineMatchContext: OnlineMatchContext | null = null;
let sessionAccountId: string | null = null;
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
  const failure = await parseOnlineApiFailure(response);
  return failure.message;
}

async function parseOnlineApiFailure(response: Response): Promise<{ message: string; code: string | null; status: number }> {
  try {
    const body = await response.json() as { error?: string; message?: string; code?: string };
    return {
      message: body.error ?? body.message ?? `Request failed (${response.status})`,
      code: typeof body.code === 'string' && body.code.trim().length > 0 ? body.code.trim() : null,
      status: response.status,
    };
  } catch {
    return {
      message: `Request failed (${response.status})`,
      code: null,
      status: response.status,
    };
  }
}

async function requestOnlineJson<T>(
  method: 'GET' | 'POST',
  path: string,
  accountId: string,
  body?: unknown,
  options?: { keepalive?: boolean },
): Promise<T> {
  const response = await requestOnlineRaw(method, path, accountId, body, options);
  if (!response.ok) {
    const failure = await parseOnlineApiFailure(response);
    throw new OnlineRequestError(failure.message, failure.status, failure.code);
  }
  return await response.json() as T;
}

async function requestOnlineRaw(
  method: 'GET' | 'POST',
  path: string,
  accountId: string,
  body?: unknown,
  options?: { keepalive?: boolean },
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
    keepalive: options?.keepalive ?? false,
  });
  return response;
}

function cloneOnlinePlayerInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    moveX: input.moveX,
    moveY: input.moveY,
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

function hashSeedFromString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
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

function getOnlineRuntimeStatusDetail(sessionId: string | null, phase?: string | null): string {
  const sessionLine = `Session: ${sessionId ?? 'pending'}`;
  const phaseLine = phase ? `Phase: ${phase}` : null;
  return [
    sessionLine,
    phaseLine,
    onlineRuntimeEnabled
      ? 'Runtime: live relay-backed online flow enabled for this build.'
      : 'Runtime: public online match entry is hidden for this build.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function getRankedQueueHint(ticket: QueueTicketView | null, session: MatchSessionView | null): string {
  if (!ticket) {
    return 'Join queue to start searching. Refresh later if you return to this screen mid-session.';
  }
  if (ticket.status === 'queued') {
    return 'Stay here while searching. Refresh if the wait timer or queue state looks stale.';
  }
  if (ticket.status === 'matched') {
    if (onlineRuntimeEnabled) {
      return session?.status === 'active'
        ? 'Match accepted. The client should transition into the online session automatically.'
        : 'Session created. Stay on this screen while the browser finishes bootstrap.';
    }
    return 'This build can create ranked sessions, but the public online runtime entry is intentionally hidden.';
  }
  return 'Queue is closed. Join again to start a fresh search.';
}

function getRoomStateHint(room: RoomView | null): string {
  if (!room) {
    return 'Create a room for a private match or join with a six-character code.';
  }
  if (room.status === 'closed') {
    return 'This room is closed. Create a new room for another private session.';
  }
  if (room.activeSession) {
    if (room.activeSession.phase === 'in_match') {
      return 'Room session is live. Refresh if participant or session state looks stale.';
    }
    return 'Room session is staged. Keep players in the room and refresh as the phase advances.';
  }
  return 'Share the room code with another player, then refresh once they join.';
}

function getBootstrapStatusLabel(status: OnlineBootstrapStatus): string {
  switch (status) {
    case 'awaiting_signaling':
      return 'Runtime Prepared';
    case 'failed':
      return 'Bootstrap Failed';
    case 'preparing':
    default:
      return 'Preparing Session';
  }
}

function getBootstrapNextStep(state: OnlineBootstrapState): string {
  if (state.status === 'failed') {
    return 'Return home, refresh queue status, and retry the session if needed.';
  }
  if (state.status === 'awaiting_signaling') {
    return state.connectionPath === 'relay'
      ? 'Relay route is prepared. The client is handing off into the live match.'
      : 'Direct route is preferred, with relay fallback available if the direct path stalls.';
  }
  return 'Validating session and preparing transport before entering the match.';
}

async function submitOnlineSessionFrames(
  context: OnlineMatchContext,
  frames: Array<{ frame: number; input: PlayerFrameInput }>,
): Promise<void> {
  if (frames.length === 0) {
    return;
  }
  await requestOnlineJson<{ acceptedFrames: number }>(
    'POST',
    `/matchmaking/sessions/${context.sessionId}/frames`,
    context.localAccountId,
    {
      sessionToken: context.sessionToken,
      frames: frames.map((entry) => ({
        frame: entry.frame,
        input: cloneOnlinePlayerInput(entry.input),
      })),
    },
  );
}

async function pollOnlineSessionFrames(context: OnlineMatchContext): Promise<void> {
  const response = await requestOnlineJson<OnlineSessionFrameResponse>(
    'GET',
    `/matchmaking/sessions/${context.sessionId}/frames?sessionToken=${encodeURIComponent(context.sessionToken)}&sinceFrame=${context.lastRemoteFrame}`,
    context.localAccountId,
  );
  for (const entry of response.frames) {
    context.pendingRemoteInputs.set(entry.frame, cloneOnlinePlayerInput(entry.input));
    if (entry.frame > context.lastRemoteFrame) {
      context.lastRemoteFrame = entry.frame;
    }
  }
}

function isTerminalOnlineTransportError(error: unknown): error is OnlineRequestError {
  if (!(error instanceof OnlineRequestError)) {
    return false;
  }
  if (error.code === 'session_resolved' || error.code === 'token_expired' || error.code === 'invalid_token') {
    return true;
  }
  return error.status === 401 || error.status === 403 || error.status === 404 || error.status === 409;
}

function interruptOnlineMatch(context: OnlineMatchContext, reason: string): void {
  context.outgoingFrames.length = 0;
  context.pendingRemoteInputs.clear();
  context.sendAccumulatorSeconds = 0;
  context.pollAccumulatorSeconds = 0;
  context.statusText = reason;
  if (onlineMatchContext !== context) {
    return;
  }
  if (appPhase !== 'playing' && appPhase !== 'round_transition') {
    return;
  }
  pauseMenu.setPaused(false);
  persistRollbackDiagnostics('online_session_interrupted');
  appPhase = 'match_over';
  void platform.presence.setStatus('match_over');
  startMenu.showMatchOverScreen({
    title: 'Online Session Interrupted',
    subtitle: [
      `Queue: ${context.queueType} | Region: ${context.region}`,
      `Score: ${getRoundScoreText()}`,
      '',
      reason,
      'The live relay stopped, so this match cannot continue.',
    ].join('\n'),
    primaryLabel: 'Return to Home',
    secondaryLabel: '',
    onPrimary: () => {
      returnToHome();
    },
  });
}

function handleOnlineTransportError(
  context: OnlineMatchContext,
  phase: 'upload' | 'poll' | 'reconnect',
  error: unknown,
): void {
  const prefix = phase === 'upload'
    ? 'Frame relay upload failed'
    : phase === 'poll'
      ? 'Frame relay poll failed'
      : 'Reconnect failed';
  if (isTerminalOnlineTransportError(error)) {
    interruptOnlineMatch(context, `${prefix}: ${error.message}`);
    return;
  }
  context.statusText = error instanceof Error
    ? `${prefix}: ${error.message}`
    : `${prefix}.`;
}

function flushOnlineTransport(context: OnlineMatchContext): void {
  if (context.outgoingFrames.length > 0 && !context.sendInFlight) {
    const frames = context.outgoingFrames.splice(0, context.outgoingFrames.length);
    context.sendInFlight = true;
    void submitOnlineSessionFrames(context, frames)
      .catch((error) => {
        handleOnlineTransportError(context, 'upload', error);
      })
      .finally(() => {
        context.sendInFlight = false;
      });
  }

  if (!context.pollInFlight) {
    context.pollInFlight = true;
    void pollOnlineSessionFrames(context)
      .catch((error) => {
        handleOnlineTransportError(context, 'poll', error);
      })
      .finally(() => {
        context.pollInFlight = false;
      });
  }
}

function buildOnlineRankSummaryLine(snapshot: RankedProgressionView | null): string {
  if (!snapshot) {
    return 'Rank snapshot unavailable.';
  }
  const tier = snapshot.leagueTier ?? 'Placement';
  const rating = snapshot.rating ?? 'n/a';
  const leaguePoints = snapshot.leaguePoints ?? 'n/a';
  const mrPoints = snapshot.mrPoints ?? 'n/a';
  return `Rank: ${tier} | Rating ${rating} | LP ${leaguePoints} | MR ${mrPoints}`;
}

function buildOnlineRankedResultDetail(context: OnlineMatchContext): string {
  const lines = [`Ranked result: ${context.rankedResultStatus.replace(/_/g, ' ')}`];
  if (context.rankedResultDetail.trim().length > 0) {
    lines.push(context.rankedResultDetail.trim());
  }
  return lines.join('\n');
}

function renderOnlineMatchOverScreen(context: OnlineMatchContext, winner: PlayerId, p1Wins: number, p2Wins: number): void {
  const subtitleLines = [
    `Winner: ${winner}`,
    `Final rounds: P1 ${p1Wins} - ${p2Wins} P2`,
    `Session: ${context.sessionId}`,
    `Queue: ${context.queueType} | Region: ${context.region}`,
  ];
  if (context.queueType === 'ranked') {
    subtitleLines.push(buildOnlineRankedResultDetail(context));
  } else if (context.statusText.trim().length > 0) {
    subtitleLines.push(context.statusText.trim());
  }

  const secondaryLabel = context.queueType === 'ranked'
    ? (context.rankedResultStatus === 'failed' ? 'Retry Submission' : 'Refresh Rank')
    : 'Return to Home';
  const secondaryAction = context.queueType === 'ranked'
    ? () => {
      if (context.rankedResultStatus === 'failed') {
        void submitOnlineRankedResult(context);
        return;
      }
      void refreshOnlineRankedResultSummary(context);
    }
    : () => {
      returnToHome();
    };

  startMenu.showMatchOverScreen({
    title: 'Online Match Complete',
    subtitle: subtitleLines.join('\n'),
    primaryLabel: 'Return to Home',
    secondaryLabel,
    onPrimary: () => {
      returnToHome();
    },
    onSecondary: secondaryAction,
  });
}

async function refreshOnlineRankedResultSummary(context: OnlineMatchContext): Promise<void> {
  if (context.queueType !== 'ranked') {
    return;
  }
  try {
    await refreshRankedSnapshot();
    context.rankedResultDetail = [
      context.rankedResultDetail.trim(),
      buildOnlineRankSummaryLine(playerRankedSnapshot),
    ]
      .filter((line, index, array) => line.length > 0 && array.indexOf(line) === index)
      .join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ranked progression refresh failed.';
    context.rankedResultDetail = [
      context.rankedResultDetail.trim(),
      `Progression refresh failed: ${message}`,
    ]
      .filter((line, index, array) => line.length > 0 && array.indexOf(line) === index)
      .join('\n');
  }
  if (onlineMatchContext === context && appPhase === 'match_over') {
    const winner = context.winnerAccountId === context.localAccountId
      ? context.localPlayerId
      : context.remotePlayerId;
    renderOnlineMatchOverScreen(context, winner, p1RoundWins, p2RoundWins);
  }
}

async function submitOnlineRankedResult(context: OnlineMatchContext): Promise<void> {
  if (context.queueType !== 'ranked' || !context.finalOutcome || context.rankedResultInFlight) {
    return;
  }

  context.rankedResultInFlight = true;
  context.rankedResultStatus = 'submitting';
  context.rankedResultDetail = 'Submitting ranked result to API.';
  if (onlineMatchContext === context && appPhase === 'match_over') {
    const winner = context.winnerAccountId === context.localAccountId
      ? context.localPlayerId
      : context.remotePlayerId;
    renderOnlineMatchOverScreen(context, winner, p1RoundWins, p2RoundWins);
  }

  try {
    const response = await requestOnlineRaw(
      'POST',
      '/ranked/results',
      context.localAccountId,
      {
        sessionId: context.sessionId,
        matchId: context.sessionId,
        sessionToken: context.sessionToken,
        outcome: context.finalOutcome,
        participantAccountIds: [context.localAccountId, context.remoteAccountId],
        winnerAccountId: context.winnerAccountId,
      },
    );

    if (response.ok) {
      const payload = await response.json() as RankedResultSubmitResponse;
      context.rankedResultSubmissionId = payload.submissionId;
      if (payload.status === 'flagged_for_review') {
        context.rankedResultStatus = 'flagged_for_review';
        context.rankedResultDetail = `Submission flagged for review${payload.suspiciousReasons.length > 0 ? `: ${payload.suspiciousReasons.join(', ')}` : '.'}`;
      } else {
        context.rankedResultStatus = 'accepted';
        const localDelta = payload.ratingDeltas?.find((entry) => entry.accountId === context.localAccountId) ?? null;
        const deltaLine = localDelta
          ? `Local result: ${localDelta.result} | Rating ${localDelta.preRating} -> ${localDelta.postRating} (${formatSigned(localDelta.ratingDelta)})`
          : 'Ranked result accepted.';
        context.rankedResultDetail = deltaLine;
        await refreshOnlineRankedResultSummary(context);
      }
    } else {
      const errorMessage = await parseOnlineApiError(response);
      if (
        response.status === 409
        && (
          errorMessage.includes('already been processed')
          || errorMessage.includes('already submitted')
        )
      ) {
        context.rankedResultStatus = 'already_processed';
        context.rankedResultDetail = 'Ranked result was already processed for this session.';
        await refreshOnlineRankedResultSummary(context);
      } else {
        context.rankedResultStatus = 'failed';
        context.rankedResultDetail = errorMessage;
      }
    }
  } catch (error) {
    context.rankedResultStatus = 'failed';
    context.rankedResultDetail = error instanceof Error ? error.message : 'Ranked result submission failed.';
  } finally {
    context.rankedResultInFlight = false;
    if (onlineMatchContext === context && appPhase === 'match_over') {
      const winner = context.winnerAccountId === context.localAccountId
        ? context.localPlayerId
        : context.remotePlayerId;
      renderOnlineMatchOverScreen(context, winner, p1RoundWins, p2RoundWins);
    }
  }
}

function toRankedViewState(ticket: QueueTicketView | null, session: MatchSessionView | null): OnlineRankedViewState {
  if (!ticket) {
    return {
      headline: 'Not queued',
      detail: 'Press "Join Ranked Queue" to start matchmaking.',
      hint: getRankedQueueHint(ticket, session),
    };
  }
  if (ticket.status === 'queued') {
    const waitMs = getQueueWaitMs(ticket.queuedAt);
    const waitLabel = waitMs !== null ? `${Math.floor(waitMs / 1000)}s` : 'unknown';
    return {
      headline: 'Searching for match',
      detail: `Ticket: ${ticket.ticketId}\nQueue: ${ticket.queueType}\nWait: ${waitLabel}`,
      hint: getRankedQueueHint(ticket, session),
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
      headline: 'Match found (session created)',
      detail: [
        `Ticket: ${ticket.ticketId}`,
        participantLine,
        diagnosticsLine,
        getOnlineRuntimeStatusDetail(
          ticket.matchStart?.sessionId ?? session?.sessionId ?? null,
          session?.status ?? null,
        ),
      ].join('\n'),
      tone: onlineRuntimeEnabled ? 'success' : 'warning',
      hint: getRankedQueueHint(ticket, session),
    };
  }
  return {
    headline: 'Queue closed',
    detail: `Ticket: ${ticket.ticketId}\nReason: ${ticket.closedReason ?? 'closed'}`,
    tone: 'warning',
    hint: getRankedQueueHint(ticket, session),
  };
}

function toRoomViewState(room: RoomView | null, fallbackRoomCode?: string): OnlineRoomViewState {
  if (!room) {
    return {
      headline: 'No room loaded',
      detail: 'Create a room or enter a code to join one.',
      roomCode: fallbackRoomCode ?? null,
      hint: getRoomStateHint(room),
    };
  }
  const players = room.participants.filter((item) => item.role === 'player').length;
  const spectators = room.participants.filter((item) => item.role === 'spectator').length;
  const sessionDetail = room.activeSession
    ? getOnlineRuntimeStatusDetail(room.activeSession.sessionId, room.activeSession.phase)
    : 'Session: none';
  return {
    headline: `Room ${room.roomCode} (${room.status})`,
    detail: `Host: ${room.hostAccountId}\nPlayers: ${players}\nSpectators: ${spectators}\n${sessionDetail}`,
    roomCode: room.roomCode,
    tone: room.activeSession ? 'success' : room.status === 'closed' ? 'warning' : 'neutral',
    hint: getRoomStateHint(room),
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
      characterId: selectedLoadout.P1,
    },
  );
  if (playerRankedTicket.matchStart?.sessionId) {
    playerRankedSession = await requestOnlineJson<MatchSessionView>(
      'GET',
      `/matchmaking/sessions/${playerRankedTicket.matchStart.sessionId}`,
      accountId,
    );
    void beginRankedSessionBootstrap(playerRankedTicket, playerRankedSession, 'ranked_queue');
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
    void beginRankedSessionBootstrap(playerRankedTicket, playerRankedSession, 'ranked_queue');
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
    tone: playerReplayItems.length > 0 ? 'success' : 'warning',
    hint: playerReplayItems.length > 0
      ? 'Open the latest replay to review the newest archived session.'
      : 'Finish an online match and wait for replay persistence before refreshing again.',
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
      tone: 'warning',
      hint: 'Refresh replay archive after a completed online session to fetch the newest replay.',
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
    tone: 'success',
    hint: 'Replay review is now active. Exit replay review to return to the menu.',
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
      tone: 'warning',
      hint: 'Complete a ranked session, then refresh again after result submission finishes.',
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
    tone: source === 'api' ? 'success' : 'neutral',
    hint: source === 'api'
      ? 'Snapshot is current from the ranking service.'
      : 'This snapshot came from stored profile data and may lag behind the latest match.',
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

function scheduleRankedQueueAutoRefresh(elapsedSeconds: number): void {
  if (
    !playerRankedTicket
    || playerRankedTicket.status !== 'queued'
    || appPhase !== 'home'
    || onlineMatchContext !== null
    || onlineBootstrapState !== null
  ) {
    rankedQueueAutoPollAccumulatorSeconds = 0;
    return;
  }
  if (rankedQueueAutoPollInFlight) {
    return;
  }
  rankedQueueAutoPollAccumulatorSeconds += elapsedSeconds;
  if (rankedQueueAutoPollAccumulatorSeconds < 1) {
    return;
  }
  rankedQueueAutoPollAccumulatorSeconds = 0;
  rankedQueueAutoPollInFlight = true;
  void refreshRankedQueue()
    .catch((error) => {
      if (runtimeConfig.features.debugToolsEnabled) {
        console.warn('[online] ranked queue auto-refresh failed', error);
      }
    })
    .finally(() => {
      rankedQueueAutoPollInFlight = false;
    });
}

const startMenu = createStartMenu({
  onlineMenuEnabled: publicOnlineEntryEnabled,
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
    beginUserInitiatedMode(mode, loadout, aiDifficulty, arcadeSettings);
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
    beginUserInitiatedMode(selectedMode, selectedLoadout, selectedAiDifficulty, selectedArcadeSettings);
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
let replayReviewData: ReplayReviewData | null = null;
let replayReviewSourceLabel = '';
let replayFrameIndex = 0;
let replayAccumulator = 0;
let replayPaused = true;
const replaySpeedOptions = [0.25, 0.5, 1, 2, 4];
let replaySpeedIndex = 2;
let rankedQueueAutoPollAccumulatorSeconds = 0;
let rankedQueueAutoPollInFlight = false;
let onlineLifecycleDisconnectedSessionId: string | null = null;
let onlineLifecycleReconnectInFlight = false;
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
  const enabledModes: GameMode[] = ['endless', 'best_of_3'];
  if (runtimeConfig.features.arcadeModeEnabled) {
    enabledModes.push('arcade');
  }
  if (runtimeConfig.features.trainingModeEnabled) {
    enabledModes.push('training');
  }
  enabledModes.push('cpu_vs_cpu');
  return enabledModes;
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
      stageAtmosphereId: 'wormhole_depths_v1',
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

function shouldShowLiveInputHistory(): boolean {
  return appPhase === 'playing' && (selectedMode === 'training' || selectedMode === 'cpu_vs_cpu');
}

function shouldShowLiveMatchTelemetry(): boolean {
  return appPhase === 'playing' && (selectedMode === 'training' || selectedMode === 'cpu_vs_cpu');
}

function buildOfflineAiControllersForCurrentMode(): Partial<Record<PlayerId, AiControllerState>> {
  if (selectedMode === 'training' || onlineMatchContext !== null) {
    return {};
  }

  const profileId = resolveAiDifficultyForCurrentMatch();
  if (selectedMode === 'cpu_vs_cpu') {
    return {
      P1: createAiController({
        seed: selectedMatchSeed ^ 0x517cc1b7,
        profileId,
      }),
      P2: createAiController({
        seed: selectedMatchSeed ^ 0x9e3779b9,
        profileId,
      }),
    };
  }

  return {
    P2: createAiController({
      seed: selectedMatchSeed ^ 0x9e3779b9,
      profileId,
    }),
  };
}

function resetRoundState(): void {
  persistRollbackDiagnostics('round_reset');
  const tuning = state.tuning;
  const matchLoadout = onlineMatchContext ? onlineMatchContext.matchLoadout : resolveLoadoutForCurrentMatch();
  state = createInitialState({
    loadout: matchLoadout,
    seed: selectedMatchSeed,
    rules: getRulesForMode(selectedMode),
  });
  state.tuning = { ...tuning };
  matchTelemetry = createMatchTelemetryTracker(state);
  sceneContext.cameraPlayerTracks.P1.set(state.players.P1.pos.x, state.players.P1.pos.y);
  sceneContext.cameraPlayerTracks.P2.set(state.players.P2.pos.x, state.players.P2.pos.y);
  sceneContext.launchCameraActive = false;
  inputTimeline.clear();
  simulationFrame = 0;
  rollbackSession = enableRollbackScaffold
    || onlineMatchContext !== null
    ? new RollbackSession({
      initialState: state,
      localPlayerId: onlineMatchContext?.localPlayerId ?? 'P1',
      fixedDt,
      maxHistoryFrames: 60 * 20,
    })
    : null;
  aiControllers = buildOfflineAiControllersForCurrentMode();
  const showDebugDiagnostics = debugHudEnabled;
  hud.setRollbackDiagnosticsVisible(showDebugDiagnostics);
  hud.setInputHistoryVisible(shouldShowLiveInputHistory());
  hud.setMatchTelemetryVisible(shouldShowLiveMatchTelemetry());
  hud.updateRollbackDiagnostics(showDebugDiagnostics && rollbackSession ? getRollbackDiagnosticsView(rollbackSession) : null);
  hud.updateInputHistory(null);
  hud.updateMatchTelemetry(shouldShowLiveMatchTelemetry() ? matchTelemetry.toSummary() : null);
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
  clearOnlineBootstrapState();
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
  if (!onlineMatchContext) {
    persistSettings();
  }
  if (sessionAccountId && !onlineMatchContext) {
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
  startupMenuGuardArmed = false;
  persistRollbackDiagnostics('return_home');
  clearOnlineBootstrapState();
  clearOnlineMatchContext();
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
  hud.setInputHistoryVisible(false);
  hud.setMatchTelemetryVisible(false);
  hud.updateInputHistory(null);
  hud.updateMatchTelemetry(null);
  syncTrainingFrameDataVisibility();
  accumulator = 0;
}

function beginUserInitiatedMode(
  mode: GameMode,
  loadout?: PlayersById<CharacterId>,
  aiDifficulty?: AiDifficultyId,
  arcadeSettings?: ArcadeMenuSettings,
): void {
  startupMenuGuardArmed = false;
  clearOnlineBootstrapState();
  clearOnlineMatchContext();
  beginMode(mode, loadout, aiDifficulty, arcadeSettings);
}

function ensureDevOpenMenuButton(): void {
  if (!localRecoveryUiEnabled || devOpenMenuButton) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dev-open-menu-button';
  button.textContent = 'Open Menu';
  button.addEventListener('click', () => {
    returnToHome();
  });
  document.body.appendChild(button);
  devOpenMenuButton = button;
}

function ensureDevDebugPanel(): void {
  if (!localRecoveryUiEnabled || devDebugPanel) {
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'dev-debug-panel';

  const title = document.createElement('div');
  title.className = 'dev-debug-title';
  title.textContent = 'Local Debug';

  const phaseLabel = document.createElement('div');
  phaseLabel.className = 'dev-debug-phase';
  phaseLabel.textContent = `Phase: ${appPhase}`;

  const homeButton = document.createElement('button');
  homeButton.type = 'button';
  homeButton.className = 'dev-debug-action';
  homeButton.textContent = 'Force Home Menu';
  homeButton.addEventListener('click', () => {
    returnToHome();
  });

  panel.append(title, phaseLabel, homeButton);
  document.body.appendChild(panel);
  devDebugPanel = panel;
  devDebugPhaseLabel = phaseLabel;
}

function ensureOnlineBootstrapPanel(): void {
  if (onlineBootstrapPanel) {
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'online-bootstrap-panel';
  panel.hidden = true;

  const title = document.createElement('div');
  title.className = 'online-bootstrap-title';
  title.textContent = 'Connecting Online Match';

  const detail = document.createElement('pre');
  detail.className = 'online-bootstrap-detail';
  detail.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'online-bootstrap-actions';

  const returnHomeButton = document.createElement('button');
  returnHomeButton.type = 'button';
  returnHomeButton.className = 'online-bootstrap-action';
  returnHomeButton.textContent = 'Cancel To Home';
  returnHomeButton.addEventListener('click', () => {
    returnToHome();
  });

  actions.appendChild(returnHomeButton);
  panel.append(title, detail, actions);
  document.body.appendChild(panel);

  onlineBootstrapPanel = panel;
  onlineBootstrapTitle = title;
  onlineBootstrapDetail = detail;
}

function renderOnlineBootstrapPanel(): void {
  ensureOnlineBootstrapPanel();
  if (!onlineBootstrapPanel || !onlineBootstrapTitle || !onlineBootstrapDetail) {
    return;
  }
  if (appPhase !== 'online_bootstrap' || !onlineBootstrapState) {
    onlineBootstrapPanel.hidden = true;
    onlineBootstrapDetail.textContent = '';
    return;
  }
  onlineBootstrapTitle.textContent = 'Connecting Online Match';
  const iceConfig = onlineBootstrapState.iceConfig;
  const iceLine = iceConfig
    ? `ICE servers: ${iceConfig.iceServers.length} | Direct timeout: ${iceConfig.directConnectTimeoutMs}ms`
    : 'ICE servers: unavailable';
  const statusLabel = getBootstrapStatusLabel(onlineBootstrapState.status);
  const nextStep = getBootstrapNextStep(onlineBootstrapState);
  onlineBootstrapDetail.textContent = [
    `Current Step: ${statusLabel}`,
    `Next: ${nextStep}`,
    '',
    `Queue: ${onlineBootstrapState.queueType}`,
    `Region: ${onlineBootstrapState.region}`,
    `Session: ${onlineBootstrapState.sessionId}`,
    `Players: ${onlineBootstrapState.localAccountId} vs ${onlineBootstrapState.peerAccountId ?? 'pending'}`,
    `Transport path: ${onlineBootstrapState.connectionPath}`,
    iceLine,
    `Token expires: ${onlineBootstrapState.sessionTokenExpiresAt ?? 'unknown'}`,
    onlineBootstrapState.diagnosticsLine,
    '',
    onlineBootstrapState.statusDetail,
  ].join('\n');
  onlineBootstrapPanel.hidden = false;
}

function clearOnlineBootstrapState(): void {
  onlineBootstrapState = null;
  onlineRelayFallbackController = null;
  if (onlineBootstrapPanel) {
    onlineBootstrapPanel.hidden = true;
  }
}

function clearOnlineMatchContext(): void {
  if (onlineMatchContext) {
    selectedMode = onlineMatchContext.restoreMode;
    selectedLoadout = {
      P1: onlineMatchContext.restoreLoadout.P1,
      P2: onlineMatchContext.restoreLoadout.P2,
    };
  }
  onlineMatchContext = null;
  onlineLifecycleDisconnectedSessionId = null;
  onlineLifecycleReconnectInFlight = false;
}

function createReconnectAttemptId(): string {
  const runtimeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') {
    return `resume-${runtimeCrypto.randomUUID()}`;
  }
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xFFFFFF).toString(36);
  return `resume-${timestamp}-${random}`;
}

function canLifecycleManageOnlineSession(): boolean {
  return Boolean(
    onlineMatchContext
    && (appPhase === 'playing' || appPhase === 'round_transition'),
  );
}

async function markOnlineSessionDisconnected(source: 'visibility_hidden' | 'pagehide'): Promise<void> {
  const context = onlineMatchContext;
  if (!context || !canLifecycleManageOnlineSession()) {
    return;
  }
  if (onlineLifecycleDisconnectedSessionId === context.sessionId) {
    return;
  }
  try {
    await requestOnlineJson<MatchSessionView>(
      'POST',
      '/matchmaking/sessions/disconnect',
      context.localAccountId,
      { sessionId: context.sessionId },
      { keepalive: source === 'pagehide' },
    );
    onlineLifecycleDisconnectedSessionId = context.sessionId;
    context.statusText = `Session suspended (${source}). Reconnect will be requested when focus returns.`;
  } catch (error) {
    context.statusText = error instanceof Error
      ? `Disconnect notice failed: ${error.message}`
      : 'Disconnect notice failed.';
  }
}

async function reconnectOnlineSessionAfterResume(source: 'visibility_visible'): Promise<void> {
  const context = onlineMatchContext;
  if (!context || !canLifecycleManageOnlineSession()) {
    onlineLifecycleDisconnectedSessionId = null;
    return;
  }
  if (onlineLifecycleDisconnectedSessionId !== context.sessionId || onlineLifecycleReconnectInFlight) {
    return;
  }
  onlineLifecycleReconnectInFlight = true;
  context.statusText = 'Requesting session reconnect after returning to the match.';
  try {
    await requestOnlineJson<MatchSessionView>(
      'POST',
      '/matchmaking/sessions/reconnect',
      context.localAccountId,
      {
        sessionId: context.sessionId,
        sessionToken: context.sessionToken,
        reconnectAttemptId: createReconnectAttemptId(),
      },
    );
    onlineLifecycleDisconnectedSessionId = null;
    context.statusText = `Reconnect requested (${source}). Online relay resumed.`;
  } catch (error) {
    handleOnlineTransportError(context, 'reconnect', error);
  } finally {
    onlineLifecycleReconnectInFlight = false;
  }
}

async function completeOnlineSession(context: OnlineMatchContext): Promise<void> {
  if (context.sessionCompletionInFlight || context.sessionCompletionStatus === 'completed') {
    return;
  }
  context.sessionCompletionInFlight = true;
  context.sessionCompletionStatus = 'completing';
  try {
    await requestOnlineJson<MatchSessionView>(
      'POST',
      '/matchmaking/sessions/complete',
      context.localAccountId,
      {
        sessionId: context.sessionId,
        sessionToken: context.sessionToken,
      },
    );
    context.sessionCompletionStatus = 'completed';
    context.statusText = 'Online session closed cleanly.';
  } catch (error) {
    if (error instanceof OnlineRequestError && error.code === 'session_resolved') {
      context.sessionCompletionStatus = 'completed';
      context.statusText = 'Online session was already closed.';
      return;
    }
    context.sessionCompletionStatus = 'failed';
    context.statusText = error instanceof Error
      ? `Session close failed: ${error.message}`
      : 'Session close failed.';
  } finally {
    context.sessionCompletionInFlight = false;
  }
}

function beginOnlineMatch(matchStart: MatchStartPayload): void {
  const localPlayerId = matchStart.localPlayer.side;
  const remotePlayerId = matchStart.peer.side;
  const localCharacterId = isCharacterId(matchStart.localPlayer.selectedCharacterId)
    ? matchStart.localPlayer.selectedCharacterId
    : selectedLoadout.P1;
  const remoteCharacterId = isCharacterId(matchStart.peer.selectedCharacterId)
    ? matchStart.peer.selectedCharacterId
    : selectedLoadout.P2;
  const restoreMode = selectedMode;
  const restoreLoadout = {
    P1: selectedLoadout.P1,
    P2: selectedLoadout.P2,
  };
  const matchLoadout = localPlayerId === 'P1'
    ? { P1: localCharacterId, P2: remoteCharacterId }
    : { P1: remoteCharacterId, P2: localCharacterId };

  selectedMode = 'best_of_3';
  selectedMatchSeed = hashSeedFromString(matchStart.sessionId);
  onlineMatchContext = {
    sessionId: matchStart.sessionId,
    sessionToken: matchStart.sessionToken,
    queueType: matchStart.queueType,
    region: matchStart.region,
    matchLoadout,
    restoreMode,
    restoreLoadout,
    localPlayerId,
    remotePlayerId,
    localAccountId: matchStart.localPlayer.accountId,
    remoteAccountId: matchStart.peer.accountId,
    statusText: 'Connected via authenticated session relay.',
    connectionPath: 'server',
    lastRemoteFrame: -1,
    outgoingFrames: [],
    pendingRemoteInputs: new Map<number, PlayerFrameInput>(),
    sendAccumulatorSeconds: 0,
    pollAccumulatorSeconds: 0,
    sendInFlight: false,
    pollInFlight: false,
    finalOutcome: null,
    winnerAccountId: null,
    rankedResultStatus: 'idle',
    rankedResultDetail: 'Awaiting match completion.',
    rankedResultSubmissionId: null,
    rankedResultInFlight: false,
    sessionCompletionInFlight: false,
    sessionCompletionStatus: 'idle',
  };
  clearOnlineBootstrapState();
  beginMode('best_of_3', undefined, selectedAiDifficulty, selectedArcadeSettings);
}

async function beginRankedSessionBootstrap(
  ticket: QueueTicketView,
  session: MatchSessionView | null,
  source: 'ranked_queue',
): Promise<void> {
  if (!onlineRuntimeEnabled || !ticket.matchStart) {
    return;
  }

  const accountId = sessionAccountId ?? ticket.accountId;
  const matchStart = ticket.matchStart;
  onlineRelayFallbackController = null;
  onlineBootstrapState = {
    source,
    sessionId: matchStart.sessionId,
    queueType: matchStart.queueType,
    region: matchStart.region,
    localAccountId: matchStart.localPlayer.accountId ?? accountId,
    peerAccountId: matchStart.peer.accountId ?? null,
    sessionToken: matchStart.sessionToken ?? null,
    sessionTokenExpiresAt: matchStart.sessionTokenExpiresAt ?? null,
    connectionPath: 'direct',
    status: 'preparing',
    diagnosticsLine: `Participants: ${matchStart.localPlayer.accountId} vs ${matchStart.peer.accountId}`,
    statusDetail: 'Matched session accepted. Preparing online runtime bootstrap.',
    iceConfig: null,
  };
  appPhase = 'online_bootstrap';
  void platform.presence.setStatus('online_dev');
  pauseMenu.setPaused(false);
  pauseMenu.setCanRestartTraining(false);
  startMenu.hideHome();
  startMenu.hideRoundBanner();
  replayViewer.hide();
  onlineDevMenu?.hide();
  hudRoot.style.visibility = 'hidden';
  syncTrainingFrameDataVisibility();
  accumulator = 0;
  onlineDiagnosticsUpdate = {
    ...onlineDiagnosticsUpdate,
    ticketId: ticket.ticketId,
    sessionId: matchStart.sessionId,
    queueType: matchStart.queueType,
    region: matchStart.region,
    participantAccountIds: [matchStart.localPlayer.accountId, matchStart.peer.accountId],
    queueWaitMs: getQueueWaitMs(ticket.queuedAt),
    connectionPath: 'unknown',
  };
  renderOnlineBootstrapPanel();

  const iceConfig = await fetchMatchmakingIceConfig(matchmakingApiBase, false);
  if (!onlineBootstrapState || onlineBootstrapState.sessionId !== matchStart.sessionId) {
    return;
  }
  if (iceConfig) {
    onlineRelayFallbackController = new RelayFallbackController({
      directConnectTimeoutMs: iceConfig.directConnectTimeoutMs,
    });
    onlineRelayFallbackController.startDirectAttempt(Date.now());
    buildRtcConfiguration(iceConfig, 'direct');
  }

  onlineBootstrapState = {
    ...onlineBootstrapState,
    status: 'awaiting_signaling',
    connectionPath: iceConfig ? 'direct' : 'server',
    statusDetail: iceConfig
      ? 'Session relay is ready now, and RTC configuration has also been prepared for a future direct path.'
      : 'Session relay is ready. ICE config was unavailable, so the runtime will use server relay only.',
    iceConfig,
  };
  onlineDiagnosticsUpdate = {
    ...onlineDiagnosticsUpdate,
    connectionPath: iceConfig ? 'direct' : 'relay',
  };
  renderOnlineBootstrapPanel();
  beginOnlineMatch(matchStart);
}

function openOnlineDevMenu(section?: OnlineDevMenuTarget): void {
  if (!onlineDevMenu) {
    return;
  }
  clearOnlineBootstrapState();
  clearOnlineMatchContext();
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

function exportAiMatchTelemetrySession(): string {
  const exportedAt = new Date().toISOString();
  const summary = matchTelemetry.toSummary();
  const snapshot = getRenderSnapshot(state);
  const payload: StoredAiMatchTelemetryEntry = {
    exportedAt,
    mode: 'cpu_vs_cpu',
    rulesetVersion: activeRulesetVersion,
    balanceProfileId: activeBalanceProfile.id,
    aiDifficulty: selectedAiDifficulty,
    menuThemeId: selectedMenuThemeId,
    stageAtmosphereId: selectedStageAtmosphereId,
    seed: selectedMatchSeed,
    loadout: {
      P1: selectedLoadout.P1,
      P2: selectedLoadout.P2,
    },
    score: {
      p1Rounds: p1RoundWins,
      p2Rounds: p2RoundWins,
    },
    winner: state.winner,
    statusText: snapshot.statusText,
    summary,
  };

  const timestamp = exportedAt.replace(/[:.]/g, '-');
  const fileName = `gravity-well-ai-match-telemetry-${timestamp}.json`;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  const writeResult = platform.persistence.writeJson(AI_MATCH_TELEMETRY_STORAGE_KEY, payload);
  if (!writeResult.ok && runtimeConfig.features.debugToolsEnabled) {
    console.warn('[persistence] ai match telemetry write skipped', writeResult);
  }

  return `AI match telemetry exported: ${fileName}`;
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

  if (appPhase === 'online_bootstrap') {
    const status = onlineBootstrapState?.status ?? 'preparing';
    const path = onlineBootstrapState?.connectionPath ?? 'direct';
    matchInfo.textContent = `Online Bootstrap | ${status} | ${path}`;
    return;
  }

  if (onlineMatchContext && (appPhase === 'playing' || appPhase === 'round_transition' || appPhase === 'match_over')) {
    matchInfo.textContent = `Online ${onlineMatchContext.queueType} | ${onlineMatchContext.region} | ${onlineMatchContext.connectionPath} relay | ${getRoundScoreText()}`;
    return;
  }

  if (selectedMode === 'endless') {
    matchInfo.textContent = 'Mode: Endless Dev';
    return;
  }

  if (selectedMode === 'cpu_vs_cpu') {
    matchInfo.textContent = `Mode: AI vs AI | ${getRoundScoreText()} | ${selectedAiDifficulty}`;
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
  if (phase === 'home' || phase === 'online_dev' || phase === 'online_bootstrap') {
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
    if (onlineMatchContext) {
      onlineMatchContext.finalOutcome = winner === 'P1' ? 'p1_win' : 'p2_win';
      onlineMatchContext.winnerAccountId = winner === onlineMatchContext.localPlayerId
        ? onlineMatchContext.localAccountId
        : onlineMatchContext.remoteAccountId;
      renderOnlineMatchOverScreen(onlineMatchContext, winner, p1RoundWins, p2RoundWins);
      void completeOnlineSession(onlineMatchContext);
      if (onlineMatchContext.queueType === 'ranked') {
        void submitOnlineRankedResult(onlineMatchContext);
      }
    } else {
      startMenu.showMatchOver(winner, p1RoundWins, p2RoundWins);
    }
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

  if (appPhase === 'online_bootstrap') {
    if (key === 'escape') {
      event.preventDefault();
      returnToHome();
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

  if (
    runtimeConfig.features.debugToolsEnabled
    && key === 'm'
    && (appPhase === 'playing' || appPhase === 'round_transition')
  ) {
    event.preventDefault();
    returnToHome();
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
      if (onlineMatchContext) {
        const localInput = cloneOnlinePlayerInput(frameInputRaw.p1);
        const resolvedOnlineFrameInput = onlineMatchContext.localPlayerId === 'P1'
          ? { p1: localInput, p2: createEmptyPlayerInput() }
          : { p1: createEmptyPlayerInput(), p2: localInput };
        onlineMatchContext.outgoingFrames.push({
          frame: simulationFrame,
          input: localInput,
        });
        const remoteInput = onlineMatchContext.pendingRemoteInputs.get(simulationFrame) ?? null;
        if (remoteInput) {
          onlineMatchContext.pendingRemoteInputs.delete(simulationFrame);
        }
        if (rollbackSession) {
          const rollbackResult = rollbackSession.advanceFrame({
            localInput,
            remoteAuthoritativeInput: remoteInput,
          });
          if (runtimeConfig.features.debugToolsEnabled && rollbackResult.rollbackFrames > 0) {
            console.info('[rollback] online correction', {
              frame: rollbackResult.frame,
              rollbackFrames: rollbackResult.rollbackFrames,
            });
          }
          if (runtimeConfig.features.debugToolsEnabled) {
            const desyncEvents = rollbackSession.drainPendingDesyncEvents();
            for (const event of desyncEvents) {
              console.warn('[rollback] online desync event', event);
            }
          }
          state = rollbackSession.getStateSnapshot();
        } else {
          step(state, resolvedOnlineFrameInput, fixedDt);
        }
        matchTelemetry.recordFrame(resolvedOnlineFrameInput, state, fixedDt);
      } else {
        let frameInput = frameInputRaw;
        const p1AiController = aiControllers.P1;
        const p2AiController = aiControllers.P2;
        if (p1AiController || p2AiController) {
          const p1Input = p1AiController
            ? (() => {
              const aiTick = tickAiController(state, 'P1', p1AiController);
              aiControllers.P1 = aiTick.next;
              return aiTick.input;
            })()
            : frameInputRaw.p1;
          const p2Input = p2AiController
            ? (() => {
              const aiTick = tickAiController(state, 'P2', p2AiController);
              aiControllers.P2 = aiTick.next;
              return aiTick.input;
            })()
            : frameInputRaw.p2;
          frameInput = {
            p1: p1Input,
            p2: p2Input,
          };
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
        matchTelemetry.recordFrame(frameInput, state, fixedDt);
        if (selectedMode === 'training') {
          trainingTelemetry.recordFrame(frameInput, state, fixedDt);
        }
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

  scheduleRankedQueueAutoRefresh(elapsedSeconds);

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

  if (onlineMatchContext && appPhase === 'playing') {
    onlineMatchContext.sendAccumulatorSeconds += elapsedSeconds;
    onlineMatchContext.pollAccumulatorSeconds += elapsedSeconds;
    if (onlineMatchContext.sendAccumulatorSeconds >= 0.05 || onlineMatchContext.outgoingFrames.length >= 4) {
      onlineMatchContext.sendAccumulatorSeconds = 0;
      flushOnlineTransport(onlineMatchContext);
    } else if (onlineMatchContext.pollAccumulatorSeconds >= 0.05) {
      flushOnlineTransport(onlineMatchContext);
    }
    if (onlineMatchContext.pollAccumulatorSeconds >= 0.05) {
      onlineMatchContext.pollAccumulatorSeconds = 0;
    }
  }

  if (
    appPhase === 'online_bootstrap'
    && onlineBootstrapState
    && onlineBootstrapState.iceConfig
    && onlineRelayFallbackController
    && onlineRelayFallbackController.shouldFallbackToRelay(nowMs)
  ) {
    onlineRelayFallbackController.applyRelayFallback();
    buildRtcConfiguration(onlineBootstrapState.iceConfig, 'relay');
    onlineBootstrapState = {
      ...onlineBootstrapState,
      connectionPath: 'relay',
      statusDetail: 'Direct connect timed out. Relay fallback is prepared. The remaining missing layer is signaling/datachannel exchange.',
    };
    onlineDiagnosticsUpdate = {
      ...onlineDiagnosticsUpdate,
      connectionPath: 'relay',
    };
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
  const memoryDiagnostics = debugHudEnabled
    ? getRuntimeMemoryDiagnosticsView(snapshot)
    : null;

  if (appPhase === 'replay_review') {
    hud.setRollbackDiagnosticsVisible(false);
    hud.updateRollbackDiagnostics(null);
  } else if (debugHudEnabled) {
    hud.setRollbackDiagnosticsVisible(true);
    hud.updateRollbackDiagnostics(rollbackSession ? getRollbackDiagnosticsView(rollbackSession) : null, memoryDiagnostics);
  } else {
    hud.setRollbackDiagnosticsVisible(false);
    hud.updateRollbackDiagnostics(null);
  }
  const showInputHistory = shouldShowLiveInputHistory();
  const showMatchTelemetry = shouldShowLiveMatchTelemetry();
  hud.setInputHistoryVisible(showInputHistory);
  hud.setMatchTelemetryVisible(showMatchTelemetry);
  hud.updateInputHistory(showInputHistory ? buildInputHistoryView(inputTimeline, 10) : null);
  hud.updateMatchTelemetry(showMatchTelemetry ? matchTelemetry.toSummary() : null);
  hud.update(snapshot);
  updateMatchInfo();
  updateOnlineDiagnosticsOverlay();
  renderOnlineBootstrapPanel();
  if (devDebugPhaseLabel) {
    devDebugPhaseLabel.textContent = `Phase: ${appPhase}`;
  }

  requestAnimationFrame(tick);
}

hudRoot.style.visibility = 'hidden';
syncTrainingFrameDataVisibility();
ensureDevOpenMenuButton();
ensureDevDebugPanel();
void bootstrapPlatformProfile();
void platform.presence.setStatus('home');
startMenu.showHome();
if (runtimeConfig.features.debugToolsEnabled) {
  window.setTimeout(() => {
    if (!startupMenuGuardArmed) {
      return;
    }
    if (appPhase !== 'home') {
      returnToHome();
      return;
    }
    startMenu.showHome();
    hudRoot.style.visibility = 'hidden';
  }, 250);
}
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  resizeScene(sceneContext);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void markOnlineSessionDisconnected('visibility_hidden');
    return;
  }
  if (document.visibilityState === 'visible') {
    void reconnectOnlineSessionAfterResume('visibility_visible');
  }
});

window.addEventListener('pagehide', () => {
  void markOnlineSessionDisconnected('pagehide');
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
