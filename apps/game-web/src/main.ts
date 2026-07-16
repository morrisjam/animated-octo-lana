import { createCombinedInput } from './input/combined';
import { createEmptyPlayerInput } from './input/frame';
import { createGamepadInput } from './input/gamepad';
import { createKeyboardInput } from './input/keyboard';
import { loadRuntimeConfig, shouldEnableOnlineDiagnostics } from './config/features';
import {
  fetchLocalFlowReviewCatalog,
  fetchLocalFlowReviewReplay,
  type LocalFlowReviewCase,
} from './dev/localFlowReviewCatalog';
import {
  installLocalRankedRootSmokeBridge,
  LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
  resolveLocalRankedRootSmokeConfig,
  type LocalRankedRootSmokeSnapshot,
} from './dev/localRankedRootSmoke';
import type {
  LocalRankedRecoverySmokeController,
  LocalRankedRecoverySmokeObservation,
} from './dev/localRankedRecoverySmoke';
import type { LocalRankedSmokeInputDriver } from './dev/localRankedSmokeInputDriver';
import type { LocalRankedSmokeFrameTransport } from './dev/localRankedSmokeTransport';
import { fetchMatchmakingIceConfig } from './net/connectivityApi';
import { createInputTimelineBuffer } from './net/inputTimeline';
import {
  pollOnlineTerminalSession,
  resolveOnlineTerminalResolution,
  type OnlineTerminalResolution,
} from './net/onlineTerminalResolution';
import { reconcileOnlineCompletionConsensus } from './net/onlineCompletionConsensus';
import {
  decideMatchedTicketBootstrap,
  installOnlineSessionLifecycleListeners,
  ONLINE_PAUSE_BLOCKED_MESSAGE,
  OnlineSessionLifecycleController,
  resolveGameplayPauseRequest,
  shouldRecoverForPeerPresence,
  type OnlineSessionLifecycleError,
  type OnlineSessionLifecycleEvent,
  type OnlineSessionLifecycleTarget,
} from './net/onlineSessionLifecycle';
import {
  OnlineFrameProtocolError,
  OnlineInputPump,
  type OnlineFrameEnvelope,
  type OnlineFrameSubmission,
} from './net/onlineInputPump';
import { applyPendingRemoteInputs } from './net/onlineRemoteInputBuffer';
import {
  buildRankedLeaderboardSummary,
  parseRankedLeaderboard,
  type RankedLeaderboardView,
} from './net/rankedLeaderboardView';
import {
  RecoverableWebRtcTransport,
  type WebRtcRecoverySnapshot,
} from './net/recoverableWebRtcTransport';
import {
  RollbackSession,
  type RollbackDiagnosticsSnapshot,
} from './net/rollbackSession';
import {
  buildRtcConfiguration,
  type ConnectionPath,
  type MatchmakingIceConfig,
} from './net/transport';
import {
  WebRtcFrameAckTimeoutError,
  WebRtcFrameTransportClosedError,
} from './net/webRtcFrameTransport';
import {
  exchangeWebRtcRecoveryCheckpoint,
  type WebRtcRecoveryCheckpoint,
} from './net/webRtcRecoveryCheckpoint';
import {
  connectWebRtcSession,
  type WebRtcSignalEnvelope,
  type WebRtcSignalType,
} from './net/webRtcSession';
import { CHARACTER_BY_ID, DEFAULT_CHARACTER_LOADOUT, isCharacterId, type CharacterId } from './sim/characters';
import { computeStateChecksum } from './sim/checksum';
import { fingerprintDeterministicValue } from './sim/fingerprint';
import { LocalRoundReplayRecorder } from './sim/localRoundReplayRecorder';
import {
  OnlineMatchReplayRecorder,
  resolveSynchronizedReplayFrameLimit,
} from './sim/onlineMatchReplayRecorder';
import { deriveOfflineAiSeed, deriveOfflineRoundSeed } from './sim/offlineRoundSeed';
import { sanitiseSeed } from './sim/rng';
import {
  RankedMatchProofRecorder,
  rankedSeedFromSessionId,
  type RankedMatchProof,
} from './sim/rankedProof';
import { createPlatformServices, type PlatformAuthSession } from './platform';
import {
  findFirstChecksumMismatch,
  LOCAL_AI_REPLAY_SCHEMA_VERSION,
  runReplay,
  validateReplayPayload,
  type ReplayLocalAiProvenance,
  type ReplayPayload,
  type ReplayReviewFocus,
} from './sim/replay';
import type { ReplayReviewData } from './sim/replayReview';
import {
  createInitialState,
  getRenderSnapshot,
  step,
  type SimulationActionStart,
  type SimulationLaunchClash,
} from './sim/sim';
import {
  BALANCE_PROFILES,
  DEFAULT_BALANCE_PROFILE_ID,
  resolveBalanceProfile,
} from './sim/balanceProfiles';
import {
  applyBalanceCandidatePreset,
  BALANCE_CANDIDATE_PRESETS,
} from './sim/balanceCandidatePresets';
import {
  evaluateBalanceLabSampleStop,
  fingerprintBalanceTuning,
  isLocalAiTuningMode,
  isLocalBalanceLabMode,
  selectLocalAiBehaviorTuning,
  selectLocalAiControllerRoles,
  selectLocalBalanceTuning,
  selectLocalCharacterBalanceOverrides,
} from './sim/balanceLabRuntime';
import type { BalanceLabFlowModel, BalanceLabScenarioIdentity } from './sim/balanceLab';
import {
  cloneCharacterBalanceOverrides,
  fingerprintCharacterBalanceOverrides,
  sanitiseCharacterBalanceOverrides,
  type CharacterBalanceOverrides,
} from './sim/characterBalance';
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
import {
  applyBalanceScenario,
  BALANCE_SCENARIOS,
  BALANCE_SCENARIO_SCHEMA_VERSION,
  DEFAULT_BALANCE_SCENARIO_ID,
  resolveBalanceScenario,
  type BalanceScenarioId,
} from './sim/balanceScenarios';
import {
  createAiDecisionTelemetryTracker,
  type AiDecisionTelemetryTracker,
} from './sim/aiDecisionTelemetry';
import { sanitiseTuning } from './sim/tuning';
import type { GameTuning, PlayerFrameInput, PlayerId, PlayersById, RenderSnapshot } from './sim/types';
import {
  AI_DIFFICULTY_ORDER,
  createDefaultAiBehaviorTuning,
  createAiController,
  fingerprintAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
  type AiControllerState,
  type AiDecisionTrace,
  type AiDifficultyId,
  DEFAULT_AI_DIFFICULTY,
} from './sim/ai';
import {
  AI_CONTROLLER_ROLE_SCHEMA_VERSION,
  createDefaultAiControllerRoles,
  fingerprintAiControllerRoles,
  resolveAiControllerRole,
  sanitiseAiControllerRoles,
  tickAiControllerWithRole,
  type AiControllerRoleId,
  type AiControllerRoles,
} from './sim/aiControllerRoles';
import {
  BALANCE_TEST_RECIPES,
  BALANCE_TEST_RECIPE_SCHEMA_VERSION,
  DEFAULT_BALANCE_TEST_RECIPE_ID,
  findBalanceTestRecipeForSetup,
  getBalanceTestRecipeSelectionId,
  getBalanceTestRecipeSetup,
} from './sim/balanceTestRecipes';
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
import { loadStageModelAssets } from './view/stageModelRuntime';
import type { OnlineDiagnosticsUpdate, OnlineDevSectionId } from './view/onlineDevMenu';
import { createOnlineDiagnosticsOverlay } from './view/onlineDiagnosticsOverlay';
import {
  createLazyOnlineDevMenu,
  createLazyPauseMenu,
  createLazyReplayViewer,
  type LazyUiSurface,
} from './view/lazyUiControllers';
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
  ONLINE_ALPHA_STAGE_ATMOSPHERE_ID,
  resolveStageAtmosphere,
  STAGE_ATMOSPHERE_OPTIONS,
} from './view/stageAtmosphere';

type AppPhase = 'home' | 'playing' | 'round_transition' | 'match_over' | 'replay_review' | 'online_dev' | 'online_bootstrap';
type ReplayReturnPhase = 'home' | 'playing' | 'round_transition';
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
const LOCAL_RANKED_PROOF_REVIEW_STORAGE_KEY = 'gravity_well.ranked_proof_review.v1';
const platform = createPlatformServices();
const runtimeConfig = loadRuntimeConfig();
const localFlowReviewToolsEnabled = import.meta.env.DEV
  && runtimeConfig.features.debugToolsEnabled;
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
  stageModelEntries: DEFAULT_ASSET_MANIFEST.models,
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
const localRankedRootSmokeConfig = resolveLocalRankedRootSmokeConfig({
  buildEnabled: (import.meta.env.VITE_LOCAL_RANKED_ROOT_SMOKE ?? 'false').toLowerCase() === 'true',
  url: window.location.href,
});
let localRankedSmokeInputDriverModule: typeof import('./dev/localRankedSmokeInputDriver') | null = null;
let localRankedSmokeTransportModule: typeof import('./dev/localRankedSmokeTransport') | null = null;
let localRankedRecoverySmokeModule: typeof import('./dev/localRankedRecoverySmoke') | null = null;
const localRankedSmokeRuntimeModulePromise = localRankedRootSmokeConfig.enabled
  ? Promise.all([
    import('./dev/localRankedSmokeInputDriver'),
    import('./dev/localRankedSmokeTransport'),
    import('./dev/localRankedRecoverySmoke'),
  ]).then(([inputDriverModule, transportModule, recoverySmokeModule]) => {
    localRankedSmokeInputDriverModule = inputDriverModule;
    localRankedSmokeTransportModule = transportModule;
    localRankedRecoverySmokeModule = recoverySmokeModule;
  })
  : null;
const seedParam = urlParams.get('seed');
const localRecoveryUiEnabled = urlParams.get('localDebug') === '1';
const diagnosticsQueryOverride = urlParams.get('diagnostics');
const debugHudEnabled = urlParams.get('debugHud') === '1';
const forcedSeed = seedParam !== null ? Number(seedParam) : undefined;
let selectedMatchSeed = Number.isFinite(forcedSeed) ? (forcedSeed as number) : 1;
const fixedDt = 1 / 60;
let selectedMode: GameMode = loadedSettings.mode;
const configuredBalanceProfileId = (import.meta.env.VITE_BALANCE_PROFILE_ID as string | undefined)?.trim();
const activeBalanceProfile = resolveBalanceProfile(configuredBalanceProfileId);
let runtimeBalanceProfileId = activeBalanceProfile.id;
let localBalanceProfileId = activeBalanceProfile.id;
let localBalanceTuningDraft: GameTuning = { ...activeBalanceProfile.tuning };
let localAiBehaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning();
let activeAiBehaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning();
let localAiControllerRoles: AiControllerRoles = createDefaultAiControllerRoles();
let activeAiControllerRoles: AiControllerRoles = createDefaultAiControllerRoles();
let localBalanceScenarioId: BalanceScenarioId = DEFAULT_BALANCE_SCENARIO_ID;
let activeBalanceScenarioId: BalanceScenarioId = DEFAULT_BALANCE_SCENARIO_ID;
const runtimeRulesetVersion = (
  (import.meta.env.VITE_RULESET_VERSION as string | undefined)?.trim()
  || 'prototype-2026.02'
);
function buildRulesetVersion(balanceProfileId: string): string {
  return `${runtimeRulesetVersion}${balanceProfileId === DEFAULT_BALANCE_PROFILE_ID ? '' : `+${balanceProfileId}`}`;
}
function getRuntimeRulesetVersion(): string {
  return buildRulesetVersion(runtimeBalanceProfileId);
}
function getOnlineRulesetVersion(): string {
  return buildRulesetVersion(activeBalanceProfile.id);
}
const initialRulesetVersion = getRuntimeRulesetVersion();
let localCharacterBalanceOverrides: CharacterBalanceOverrides = {};
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
  balanceProfileId: runtimeBalanceProfileId,
  rulesetVersion: getRuntimeRulesetVersion(),
  playerCharacterId: selectedLoadout.P1,
  opponentCharacterId: selectedLoadout.P2,
});
let matchTelemetry: MatchTelemetryTracker = createMatchTelemetryTracker(state);
let aiDecisionTelemetry: AiDecisionTelemetryTracker = createAiDecisionTelemetryTracker();
let roundTuningFingerprint = fingerprintBalanceTuning(state.tuning);
let balanceTuningDirty = false;
let roundCharacterBalanceFingerprint = fingerprintCharacterBalanceOverrides(
  state.characterBalanceOverrides,
);
let characterBalanceDirty = false;
let roundAiBehaviorFingerprint = fingerprintAiBehaviorTuning(activeAiBehaviorTuning);
let aiBehaviorDirty = false;
let roundAiControllerRolesFingerprint = fingerprintAiControllerRoles(activeAiControllerRoles);
let aiControllerRolesDirty = false;
const assetBudgetReport = buildAssetBudgetReport(DEFAULT_ASSET_MANIFEST, DEFAULT_ASSET_BUDGET_LIMITS);
let assetPreloadBytesLoaded = 0;
interface GameplayAccessGateState {
  allowed: boolean;
  message: string | null;
}
let assetGameplayGate: GameplayAccessGateState = {
  allowed: false,
  message: 'Loading required game assets...',
};
let entitlementGameplayGate: GameplayAccessGateState = {
  allowed: false,
  message: 'Checking gameplay access...',
};
let appPhase: AppPhase = 'home';
let startupMenuGuardArmed = true;
let p1RoundWins = 0;
let p2RoundWins = 0;
let roundTransitionRemaining = 0;
let offlineRoundIndex = 0;
let simulationFrame = 0;
let liveAiRoundReplayRecorder: LocalRoundReplayRecorder | null = null;
let latestAiRoundReplayPayload: ReplayPayload | null = null;
let balanceLabSampleSequence = 0;
let balanceLabSampleTargetFrames: number | null = null;
let aiControllers: Partial<Record<PlayerId, AiControllerState>> = {};
let arcadeRun: ArcadeRunState | null = null;
let arcadePendingLossState: ArcadePendingLossState | null = null;
const inputTimeline = createInputTimelineBuffer({ maxFrames: 60 * 20 });
const enableRollbackScaffold = (import.meta.env.VITE_FEATURE_ROLLBACK_SCAFFOLD ?? 'false').toLowerCase() === 'true';
let rollbackSession: RollbackSession | null = null;
let localRankedSmokeInputDriver: LocalRankedSmokeInputDriver | null = null;
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
  schemaVersion: 'gw.training-telemetry-export.v3';
  exportedAt: string;
  rulesetVersion: string;
  balanceProfileId: string;
  tuningFingerprint: string;
  roundStartTuningFingerprint: string;
  tuningChangedDuringRun: boolean;
  balanceTuningPending: boolean;
  tuning: GameTuning;
  pendingBalanceProfileId: string;
  pendingTuningFingerprint: string;
  pendingTuning: GameTuning;
  characterBalanceFingerprint: string;
  roundStartCharacterBalanceFingerprint: string;
  characterBalanceChangedDuringRun: boolean;
  characterBalancePending: boolean;
  characterBalanceOverrides: CharacterBalanceOverrides;
  pendingCharacterBalanceOverrides: CharacterBalanceOverrides;
  summary: TrainingTelemetrySummary;
}

interface StoredAiMatchTelemetryEntry {
  schemaVersion: 'gw.ai-match-telemetry-export.v8';
  exportedAt: string;
  mode: 'cpu_vs_cpu';
  rulesetVersion: string;
  balanceProfileId: string;
  tuningFingerprint: string;
  roundStartTuningFingerprint: string;
  tuningChangedDuringRun: boolean;
  balanceTuningPending: boolean;
  tuning: GameTuning;
  pendingBalanceProfileId: string;
  pendingTuningFingerprint: string;
  pendingTuning: GameTuning;
  characterBalanceFingerprint: string;
  roundStartCharacterBalanceFingerprint: string;
  characterBalanceChangedDuringRun: boolean;
  characterBalancePending: boolean;
  characterBalanceOverrides: CharacterBalanceOverrides;
  pendingCharacterBalanceOverrides: CharacterBalanceOverrides;
  aiBehaviorFingerprint: string;
  roundStartAiBehaviorFingerprint: string;
  aiBehaviorChangedDuringRun: boolean;
  aiBehaviorPending: boolean;
  aiBehaviorTuning: AiBehaviorTuning;
  pendingAiBehaviorFingerprint: string;
  pendingAiBehaviorTuning: AiBehaviorTuning;
  aiControllerRoleSchemaVersion: typeof AI_CONTROLLER_ROLE_SCHEMA_VERSION;
  aiControllerRolesFingerprint: string;
  aiControllerRoles: AiControllerRoles;
  aiControllerRolesPending: boolean;
  pendingAiControllerRolesFingerprint: string;
  pendingAiControllerRoles: AiControllerRoles;
  aiDifficulty: AiDifficultyId;
  scenario: BalanceLabScenarioIdentity;
  menuThemeId: string;
  stageAtmosphereId: string;
  seed: number;
  matchSeed: number;
  roundSeed: number;
  roundIndex: number;
  loadout: PlayersById<CharacterId>;
  score: {
    p1Rounds: number;
    p2Rounds: number;
  };
  winner: PlayerId | null;
  statusText: string;
  summary: ReturnType<MatchTelemetryTracker['toSummary']>;
  aiDecisions: ReturnType<AiDecisionTelemetryTracker['toSummary']>;
  flow: BalanceLabFlowModel;
}

type QueueType = 'unranked' | 'ranked';
type RegionId = 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';

interface MatchTransportAttemptView {
  attemptId: string;
  generation: number;
  createdAt: string;
}

interface MatchStartPayload {
  sessionId: string;
  sessionToken: string;
  sessionTokenExpiresAt: string;
  heartbeatIntervalSeconds?: number;
  heartbeatTimeoutSeconds?: number;
  reconnectGraceSeconds?: number;
  buildVersion: string | null;
  rulesetVersion: string | null;
  balanceProfileId: string | null;
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
  expiresAt?: string;
  transportAttempt: MatchTransportAttemptView;
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
  joinDisposition?: 'created' | 'existing';
}

interface MatchSessionView {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  buildVersion: string | null;
  rulesetVersion: string | null;
  balanceProfileId: string | null;
  status: 'active' | 'resolved';
  resolvedReason?: 'session_expired' | 'reconnect_timeout' | 'peer_left' | 'completed';
  resolvedAt?: string;
  forfeitingAccountId?: string;
  createdAt: string;
  expiresAt?: string;
  transportAttempt: MatchTransportAttemptView;
  participants: Array<{
    accountId: string;
    side: 'P1' | 'P2';
    selectedCharacterId: string | null;
    connectionStatus: 'connected' | 'disconnected';
    lastHeartbeatAt?: string;
    completionAttestedAt?: string;
    disconnectedAt?: string;
    reconnectDeadlineAt?: string;
  }>;
}

type OnlineBootstrapStatus = 'preparing' | 'awaiting_signaling' | 'failed';

interface OnlineBootstrapState {
  source: 'ranked_queue';
  queueTicketId: string;
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

interface OnlineSessionFrameResponse {
  frames: OnlineFrameEnvelope[];
  peerConfirmedThrough: number;
}

interface OnlineSessionSignalsResponse {
  signals: WebRtcSignalEnvelope[];
  nextAfterSignalId: string;
}

type RankedMatchOutcome = 'p1_win' | 'p2_win' | 'draw' | 'forfeit';
type OnlineRankedResultStatus =
  | 'idle'
  | 'submitting'
  | 'awaiting_peer_confirmation'
  | 'authoritative_pending'
  | 'no_contest'
  | 'accepted'
  | 'flagged_for_review'
  | 'already_processed'
  | 'failed';
type OnlineReplayStatus = 'recording' | 'ready' | 'persisting' | 'persisted' | 'failed';

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
  status:
    | 'accepted'
    | 'flagged_for_review'
    | 'awaiting_peer_confirmation'
    | 'authoritative_pending'
    | 'no_contest';
  suspicious: boolean;
  suspiciousReasons: string[];
  reviewStatus: string;
  outcome?: RankedMatchOutcome;
  winnerAccountId?: string | null;
  settlementSource?: 'player_consensus' | 'server_authoritative';
  authoritativeResolution?: {
    reason: 'reconnect_timeout' | 'peer_left' | 'session_expired';
    forfeitingAccountId: string | null;
  };
  terminalDecision?: {
    type: 'forfeit' | 'no_contest';
    status: 'pending' | 'processing' | 'settled' | 'superseded';
    dueAt: string;
    decidedAt: string;
  };
  proof?: {
    digest: string;
    simulatorVersion: string;
    roundCount: number;
    frameCount: number;
    derivedOutcome: 'p1_win' | 'p2_win';
  };
  ratingDeltas?: RankedResultDeltaView[];
}

interface ReplayIngestResponseView {
  replayId: string;
  matchId: string;
  sha256: string;
  payloadVersion: number;
  retentionUntil: string;
  existing?: boolean;
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
  queueTicketId: string;
  sessionId: string;
  sessionToken: string;
  reconnectGraceSeconds: number;
  queueType: QueueType;
  region: RegionId;
  matchLoadout: PlayersById<CharacterId>;
  restoreMode: GameMode;
  restoreLoadout: PlayersById<CharacterId>;
  restoreStageAtmosphereId: string;
  localPlayerId: PlayerId;
  remotePlayerId: PlayerId;
  localAccountId: string;
  remoteAccountId: string;
  statusText: string;
  connectionPath: ConnectionPath | 'server';
  iceTransportPolicy: RTCIceTransportPolicy;
  relayAvailable: boolean;
  turnCredentialMode: MatchmakingIceConfig['turnCredentialMode'];
  transportAttemptGeneration: number;
  roundEpoch: number;
  rankedProofRecorder: RankedMatchProofRecorder | null;
  rankedProof: RankedMatchProof | null;
  replayRecorder: OnlineMatchReplayRecorder;
  replayPayload: ReplayPayload | null;
  replayStatus: OnlineReplayStatus;
  replayDetail: string;
  replayId: string | null;
  replayInFlight: boolean;
  replayStartedAt: string;
  inputPump: OnlineInputPump;
  smokeFrameTransport: LocalRankedSmokeFrameTransport | null;
  smokeRecovery: LocalRankedRecoverySmokeController | null;
  transportRecovery: RecoverableWebRtcTransport;
  closeTransport: () => void;
  transportClosed: boolean;
  pendingRoundWinner: PlayerId | null;
  pendingRoundFinalFrame: number | null;
  roundSyncElapsedSeconds: number;
  sendAccumulatorSeconds: number;
  pollAccumulatorSeconds: number;
  finalOutcome: RankedMatchOutcome | null;
  winnerAccountId: string | null;
  rankedResultStatus: OnlineRankedResultStatus;
  rankedResultDetail: string;
  rankedResultSubmissionId: string | null;
  rankedResultResponse: RankedResultSubmitResponse | null;
  rankedResultPersistedRead: boolean;
  rankedResultInFlight: boolean;
  rollbackApplications: number;
  rollbackFrames: number;
  maxRollbackDepth: number;
  sessionCompletionInFlight: boolean;
  sessionCompletionStatus: 'idle' | 'completing' | 'awaiting_peer' | 'completed' | 'failed';
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

function reportLazyUiLoadFailure(surface: LazyUiSurface, error: Error): void {
  const labels: Record<LazyUiSurface, string> = {
    pause_menu: 'Pause and Balance Lab',
    replay_viewer: 'Replay Review',
    online_dev_menu: 'Online tools',
  };
  const label = labels[surface];
  console.error(`[lazy-ui] ${label} failed to load`, error);
  const statusElement = document.querySelector<HTMLDivElement>('#status');
  if (statusElement) {
    statusElement.textContent = `${label} failed to load. Retry the action or refresh.`;
  }
  if (surface === 'replay_viewer' && appPhase === 'replay_review') {
    exitReplayReview();
  } else if (surface === 'online_dev_menu' && appPhase === 'online_dev') {
    returnToHome();
  }
}

const pauseMenu = createLazyPauseMenu({
  getTuning: () => localBalanceTuningDraft,
  setTuning: (tuning) => {
    localBalanceTuningDraft = sanitiseTuning(tuning);
    localBalanceProfileId = 'custom_local';
    balanceTuningDirty = fingerprintBalanceTuning(localBalanceTuningDraft) !== roundTuningFingerprint;
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
  canReviewAiRound: () => (
    isLocalAiRoundReviewMode(selectedMode)
    && onlineMatchContext === null
    && (appPhase === 'playing' || appPhase === 'round_transition')
    && ((liveAiRoundReplayRecorder?.frameCount ?? 0) > 0 || latestAiRoundReplayPayload !== null)
  ),
  onReviewAiRound: (request) => {
    void reviewCurrentAiRound(request);
  },
  getAiRoundReplay: () => (
    liveAiRoundReplayRecorder?.buildPayload() ?? latestAiRoundReplayPayload
  ),
  getBalanceSampleSequence: () => balanceLabSampleSequence,
  onReviewAiReplaySample: (payload, request, label) => {
    void reviewCapturedAiReplaySample(payload, request, label);
  },
  onRestartTraining: () => {
    restartTrainingRound();
  },
  balanceProfiles: BALANCE_PROFILES,
  balanceCandidatePresets: BALANCE_CANDIDATE_PRESETS,
  balanceScenarios: BALANCE_SCENARIOS,
  balanceTestRecipes: BALANCE_TEST_RECIPES,
  getBalanceProfileId: () => localBalanceProfileId,
  isBalanceTuningDirty: () => balanceTuningDirty,
  getActiveBalanceTuning: () => ({ ...state.tuning }),
  getActiveBalanceTuningFingerprint: () => roundTuningFingerprint,
  onApplyBalanceProfile: (profileId) => {
    const profile = resolveBalanceProfile(profileId);
    localBalanceTuningDraft = { ...profile.tuning };
    localBalanceProfileId = profile.id;
    balanceTuningDirty = fingerprintBalanceTuning(localBalanceTuningDraft) !== roundTuningFingerprint;
  },
  onApplyBalanceCandidatePreset: (presetId) => {
    const applied = applyBalanceCandidatePreset(
      presetId,
      localBalanceTuningDraft,
      localCharacterBalanceOverrides,
      localAiBehaviorTuning,
    );
    localBalanceTuningDraft = applied.tuning;
    localCharacterBalanceOverrides = applied.characterBalanceOverrides;
    localAiBehaviorTuning = applied.aiBehaviorTuning;
    localBalanceProfileId = 'custom_local';
    balanceTuningDirty = fingerprintBalanceTuning(localBalanceTuningDraft) !== roundTuningFingerprint;
    const eligibleCharacterOverrides = selectLocalCharacterBalanceOverrides(
      selectedMode,
      onlineMatchContext !== null,
      localCharacterBalanceOverrides,
    );
    characterBalanceDirty = fingerprintCharacterBalanceOverrides(eligibleCharacterOverrides)
      !== roundCharacterBalanceFingerprint;
    const eligibleAiBehavior = selectLocalAiBehaviorTuning(
      selectedMode,
      onlineMatchContext !== null,
      localAiBehaviorTuning,
    );
    aiBehaviorDirty = fingerprintAiBehaviorTuning(eligibleAiBehavior)
      !== roundAiBehaviorFingerprint;
  },
  getBalanceTelemetry: () => matchTelemetry.toSummary(),
  getAiDecisionTelemetry: () => aiDecisionTelemetry.toSummary(),
  getBalanceScenarioIdentity: () => getCurrentBalanceScenarioIdentity(),
  getBalanceScenarioId: () => localBalanceScenarioId,
  getActiveBalanceScenarioId: () => activeBalanceScenarioId,
  setBalanceScenarioId: (scenarioId) => {
    localBalanceScenarioId = resolveBalanceScenario(scenarioId).id;
  },
  onApplyBalanceTestRecipe: (recipeId) => {
    const setup = getBalanceTestRecipeSetup(recipeId);
    localBalanceScenarioId = setup.scenarioId;
    localAiControllerRoles = selectLocalAiControllerRoles(
      selectedMode,
      onlineMatchContext !== null,
      setup.roles,
    );
    aiControllerRolesDirty = isLocalAiTuningMode(selectedMode)
      && onlineMatchContext === null
      && fingerprintAiControllerRoles(localAiControllerRoles) !== roundAiControllerRolesFingerprint;
  },
  getBalanceLoadout: () => ({
    P1: state.players.P1.characterId,
    P2: state.players.P2.characterId,
  }),
  getCharacterBalanceOverrides: () => cloneCharacterBalanceOverrides(localCharacterBalanceOverrides),
  getActiveCharacterBalanceOverrides: () => cloneCharacterBalanceOverrides(
    state.characterBalanceOverrides,
  ),
  getActiveCharacterBalanceFingerprint: () => fingerprintCharacterBalanceOverrides(
    state.characterBalanceOverrides,
  ),
  setCharacterBalanceOverrides: (overrides) => {
    localCharacterBalanceOverrides = sanitiseCharacterBalanceOverrides(overrides);
    const eligibleOverrides = selectLocalCharacterBalanceOverrides(
      selectedMode,
      onlineMatchContext !== null,
      localCharacterBalanceOverrides,
    );
    characterBalanceDirty = fingerprintCharacterBalanceOverrides(eligibleOverrides)
      !== roundCharacterBalanceFingerprint;
  },
  isCharacterBalanceDirty: () => characterBalanceDirty,
  canTuneAiBehavior: () => isLocalAiTuningMode(selectedMode) && onlineMatchContext === null,
  getAiBehaviorTuning: () => sanitiseAiBehaviorTuning(localAiBehaviorTuning),
  getActiveAiBehaviorTuning: () => sanitiseAiBehaviorTuning(activeAiBehaviorTuning),
  getActiveAiBehaviorFingerprint: () => roundAiBehaviorFingerprint,
  setAiBehaviorTuning: (tuning) => {
    localAiBehaviorTuning = sanitiseAiBehaviorTuning(tuning);
    const eligibleTuning = selectLocalAiBehaviorTuning(
      selectedMode,
      onlineMatchContext !== null,
      localAiBehaviorTuning,
    );
    aiBehaviorDirty = fingerprintAiBehaviorTuning(eligibleTuning)
      !== roundAiBehaviorFingerprint;
  },
  isAiBehaviorDirty: () => aiBehaviorDirty,
  getAiControllerRoles: () => selectLocalAiControllerRoles(
    selectedMode,
    onlineMatchContext !== null,
    localAiControllerRoles,
  ),
  getActiveAiControllerRoles: () => selectLocalAiControllerRoles(
    selectedMode,
    onlineMatchContext !== null,
    activeAiControllerRoles,
  ),
  getBalanceHumanPlayerId: () => selectedMode === 'balance_sparring' ? 'P1' : null,
  setAiControllerRole: (playerId: PlayerId, roleId: AiControllerRoleId) => {
    if (selectedMode === 'balance_sparring' && playerId === 'P1') {
      return;
    }
    localAiControllerRoles = selectLocalAiControllerRoles(
      selectedMode,
      onlineMatchContext !== null,
      sanitiseAiControllerRoles({
      ...localAiControllerRoles,
      [playerId]: roleId,
      }),
    );
    aiControllerRolesDirty = isLocalAiTuningMode(selectedMode)
      && onlineMatchContext === null
      && fingerprintAiControllerRoles(localAiControllerRoles) !== roundAiControllerRolesFingerprint;
  },
  isAiControllerRolesDirty: () => aiControllerRolesDirty,
  canRestartBalanceLab: () => (
    onlineMatchContext === null
    && isLocalBalanceLabMode(selectedMode)
  ),
  onRestartBalanceLab: (targetFrames) => {
    restartBalanceLabMatch(targetFrames);
  },
}, {
  onLoadError: reportLazyUiLoadFailure,
});
pauseMenu.setCanRestartTraining(selectedMode === 'training');
pauseMenu.setBalanceLabAvailable(selectedMode === 'balance_sparring');
hud.setVoiceSubtitlesEnabled(audioSettings.subtitlesEnabled);
const replayViewer = createLazyReplayViewer({
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
}, {
  onLoadError: reportLazyUiLoadFailure,
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
const diagnosticsRulesetVersion = initialRulesetVersion;
const diagnosticsEnabled = shouldEnableOnlineDiagnostics({
  platformKind: platform.kind,
  configuredEnabled: runtimeConfig.features.onlineDiagnosticsEnabled,
  queryOverride: diagnosticsQueryOverride,
  developmentBuild: import.meta.env.DEV,
});
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
let onlineMatchContext: OnlineMatchContext | null = null;
let rankedResumeRequiredSessionId: string | null = null;
let explicitRankedRejoinArmed = false;
let sessionAccountId: string | null = null;
const diagnosticsOverlay = diagnosticsEnabled ? createOnlineDiagnosticsOverlay() : null;
const onlineDevMenuEnabled = platform.kind === 'web' && runtimeConfig.features.onlineDevMenuEnabled;
const onlineDevMenu = onlineDevMenuEnabled
  ? createLazyOnlineDevMenu({
    apiBase: matchmakingApiBase,
    buildVersion: diagnosticsBuildId,
    rulesetVersion: getOnlineRulesetVersion(),
    balanceProfileId: activeBalanceProfile.id,
    getCharacterId: () => selectedLoadout.P1,
    getAccountId: () => sessionAccountId,
    getAccessToken: () => platform.auth.getAccessToken?.() ?? null,
    onOpenReplayPayload: async ({ replayId, payload }) => {
      const opened = await beginReplayReviewFromPayload(payload, `archive:${replayId}`);
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
  }, {
    onLoadError: reportLazyUiLoadFailure,
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
  options?: { keepalive?: boolean; matchSessionToken?: string; signal?: AbortSignal },
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
  options?: { keepalive?: boolean; matchSessionToken?: string; signal?: AbortSignal },
): Promise<Response> {
  if (!matchmakingApiBase) {
    throw new Error('Missing VITE_MATCHMAKING_API_BASE or VITE_PROFILE_API_BASE.');
  }
  const headers: Record<string, string> = {};
  const accessToken = platform.auth.getAccessToken?.() ?? null;
  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  } else {
    headers['x-account-id'] = accountId;
  }
  if (options?.matchSessionToken) {
    headers['x-match-session-token'] = options.matchSessionToken;
  }
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
    signal: options?.signal,
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

function recordPendingRankedRemoteInputs(context: OnlineMatchContext, throughFrame: number): void {
  const recorder = context.rankedProofRecorder;
  if (!recorder) {
    return;
  }
  for (const [frame, remoteInput] of context.inputPump.getPendingRemoteInputs()) {
    if (frame <= throughFrame) {
      recorder.recordInput(context.roundEpoch, frame, context.remotePlayerId, remoteInput);
    }
  }
}

function recordSynchronizedOnlineReplayFrames(
  context: OnlineMatchContext,
  session: RollbackSession,
): void {
  if (context.replayStatus !== 'recording') {
    return;
  }
  const confirmedThrough = resolveSynchronizedReplayFrameLimit({
    contiguousRemoteFrame: context.inputPump.getContiguousRemoteFrame(),
    peerConfirmedThrough: context.inputPump.getPeerConfirmedThrough(),
    currentFrame: session.getCurrentFrame(),
    winningFrame: session.getWinningFrame()?.frame ?? null,
  });
  for (
    let frame = context.replayRecorder.currentRoundFrameCount;
    frame <= confirmedThrough;
    frame += 1
  ) {
    const p1 = session.getTimelineEntry(frame, 'P1');
    const p2 = session.getTimelineEntry(frame, 'P2');
    if (!p1 || !p2 || p1.source === 'remote_predicted' || p2.source === 'remote_predicted') {
      throw new Error(`Confirmed replay frame ${frame} is missing authoritative inputs.`);
    }
    const checksum = session.getCorrectedFrameChecksum(frame);
    if (checksum === null) {
      throw new Error(`Confirmed replay frame ${frame} expired from rollback history before archival.`);
    }
    context.replayRecorder.recordSynchronizedFrame({
      epoch: context.roundEpoch,
      frame,
      confirmedThrough,
      checksum,
      players: {
        P1: {
          input: p1.input,
          source: p1.source === 'local' ? 'local' : 'remote_authoritative',
        },
        P2: {
          input: p2.input,
          source: p2.source === 'local' ? 'local' : 'remote_authoritative',
        },
      },
    });
  }
}

function recordOnlineRollbackEvidence(context: OnlineMatchContext, rollbackFrames: number): void {
  if (rollbackFrames <= 0) {
    return;
  }
  context.rollbackApplications += 1;
  context.rollbackFrames += rollbackFrames;
  context.maxRollbackDepth = Math.max(context.maxRollbackDepth, rollbackFrames);
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
      ? 'Runtime: authenticated WebRTC rollback flow enabled for this build.'
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
  frames: OnlineFrameSubmission[],
): Promise<{ acceptedFrames: number }> {
  if (frames.length === 0) {
    return { acceptedFrames: 0 };
  }
  return await requestOnlineJson<{ acceptedFrames: number }>(
    'POST',
    `/matchmaking/sessions/${context.sessionId}/frames`,
    context.localAccountId,
    {
      sessionToken: context.sessionToken,
      frames: frames.map((entry) => ({
        epoch: entry.epoch,
        frame: entry.frame,
        input: cloneOnlinePlayerInput(entry.input),
      })),
    },
  );
}

async function pollOnlineSessionFrames(
  context: OnlineMatchContext,
  epoch: number,
  sinceFrame: number,
): Promise<OnlineSessionFrameResponse> {
  return await requestOnlineJson<OnlineSessionFrameResponse>(
    'GET',
    `/matchmaking/sessions/${context.sessionId}/frames?epoch=${epoch}&sinceFrame=${sinceFrame}`,
    context.localAccountId,
    undefined,
    { matchSessionToken: context.sessionToken },
  );
}

async function confirmOnlineSessionFrames(
  context: OnlineMatchContext,
  epoch: number,
  confirmedThrough: number,
): Promise<{ confirmedThrough: number }> {
  return await requestOnlineJson<{ confirmedThrough: number }>(
    'POST',
    `/matchmaking/sessions/${context.sessionId}/frames/confirm`,
    context.localAccountId,
    {
      sessionToken: context.sessionToken,
      epoch,
      confirmedThrough,
    },
  );
}

async function publishOnlineSessionSignal(
  matchStart: MatchStartPayload,
  transportAttemptId: string,
  signal: {
    clientMessageId: string;
    signalType: WebRtcSignalType;
    payload: unknown;
  },
): Promise<{ signalId: string }> {
  return await requestOnlineJson<{ signalId: string }>(
    'POST',
    `/matchmaking/sessions/${matchStart.sessionId}/signals`,
    matchStart.localPlayer.accountId,
    {
      sessionToken: matchStart.sessionToken,
      transportAttemptId,
      clientMessageId: signal.clientMessageId,
      signalType: signal.signalType,
      payload: signal.payload,
    },
  );
}

async function pollOnlineSessionSignals(
  matchStart: MatchStartPayload,
  transportAttemptId: string,
  afterSignalId: string,
): Promise<OnlineSessionSignalsResponse> {
  const query = new URLSearchParams({
    transportAttemptId,
    afterSignalId,
    limit: '100',
  });
  return await requestOnlineJson<OnlineSessionSignalsResponse>(
    'GET',
    `/matchmaking/sessions/${matchStart.sessionId}/signals?${query.toString()}`,
    matchStart.localPlayer.accountId,
    undefined,
    { matchSessionToken: matchStart.sessionToken },
  );
}

async function prepareNextOnlineTransportAttempt(
  matchStart: MatchStartPayload,
  currentAttempt: MatchTransportAttemptView,
): Promise<MatchTransportAttemptView> {
  const session = await requestOnlineJson<MatchSessionView>(
    'POST',
    `/matchmaking/sessions/${matchStart.sessionId}/transport-attempts`,
    matchStart.localPlayer.accountId,
    {
      sessionToken: matchStart.sessionToken,
      expectedGeneration: currentAttempt.generation,
    },
  );
  if (session.transportAttempt.generation <= currentAttempt.generation) {
    throw new Error('Server did not advance the WebRTC transport attempt.');
  }
  return session.transportAttempt;
}

function createLocalRankedRecoveryObservation(
  context: OnlineMatchContext,
): LocalRankedRecoverySmokeObservation {
  return {
    roundEpoch: context.roundEpoch,
    simulationFrame,
    outboundFrames: context.inputPump.getOutboundFrameCount(),
    mutuallyConfirmedThrough: context.inputPump.getMutuallyConfirmedThrough(),
    attemptGeneration: context.transportAttemptGeneration,
    connectionPath: context.connectionPath,
    relayAvailable: context.relayAvailable,
  };
}

function createOnlineRecoveryCheckpoint(
  context: OnlineMatchContext,
  transportAttemptId: string,
): WebRtcRecoveryCheckpoint {
  if (appPhase !== 'playing' && appPhase !== 'round_transition') {
    throw new Error(`Online recovery cannot resume from app phase ${appPhase}.`);
  }
  if (!rollbackSession) {
    throw new Error('Online recovery requires retained rollback history.');
  }
  const confirmedThrough = context.inputPump.getMutuallyConfirmedThrough();
  const stateChecksum = rollbackSession.getRecoveryCheckpointChecksum(confirmedThrough);
  if (stateChecksum === null) {
    throw new Error(
      `Mutually confirmed recovery frame ${confirmedThrough} is outside rollback history.`,
    );
  }
  return {
    transportAttemptId,
    roundEpoch: context.roundEpoch,
    confirmedThrough,
    p1Rounds: p1RoundWins,
    p2Rounds: p2RoundWins,
    stateChecksum,
  };
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

function isRetryableOnlineRequestError(error: unknown): boolean {
  return !(error instanceof OnlineRequestError)
    || error.status === 429
    || error.status >= 500;
}

function closeOnlineTransport(context: OnlineMatchContext): void {
  if (context.transportClosed) {
    return;
  }
  context.transportClosed = true;
  context.closeTransport();
}

function closeCompletedOnlineSessionNetwork(context: OnlineMatchContext): void {
  if (onlineSessionLifecycle.getSnapshot().sessionId === context.sessionId) {
    clearOnlineSessionHeartbeat();
  }
  closeOnlineTransport(context);
}

function isInterruptedOnlineScreenCurrent(context: OnlineMatchContext): boolean {
  return onlineMatchContext === context && appPhase === 'match_over';
}

function renderResolvedOnlineInterruption(
  context: OnlineMatchContext,
  resolution: OnlineTerminalResolution,
  transportReason: string,
): void {
  if (!isInterruptedOnlineScreenCurrent(context)) {
    return;
  }
  const subtitleLines = [
    resolution.outcomeLine,
    `Session: ${context.sessionId}`,
    `Queue: ${context.queueType} | Region: ${context.region}`,
    `Transport detail: ${transportReason}`,
  ];
  if (context.queueType === 'ranked') {
    subtitleLines.push(buildOnlineRankedResultDetail(context));
  }
  startMenu.showMatchOverScreen({
    title: resolution.title,
    subtitle: subtitleLines.join('\n'),
    primaryLabel: 'Return to Home',
    secondaryLabel: '',
    onPrimary: () => {
      returnToHome();
    },
  });
}

async function pollInterruptedRankedResult(
  context: OnlineMatchContext,
  resolution: OnlineTerminalResolution,
  transportReason: string,
): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForMilliseconds(500);
    if (!isInterruptedOnlineScreenCurrent(context)) {
      return;
    }
    try {
      const payload = await requestOnlineJson<RankedResultSubmitResponse>(
        'GET',
        `/ranked/results/${context.sessionId}`,
        context.localAccountId,
        undefined,
        { matchSessionToken: context.sessionToken },
      );
      if (await applyOnlineRankedResultResponse(context, payload)) {
        if (payload.status === 'flagged_for_review' || payload.status === 'no_contest') {
          renderResolvedOnlineInterruption(context, resolution, transportReason);
        }
        return;
      }
      context.rankedResultDetail = resolution.kind === 'ranked_completion_pending'
        ? `Waiting for deterministic peer proof (${attempt}/${maxAttempts}).`
        : `The server has attributed the forfeit; progression settlement is pending (${attempt}/${maxAttempts}).`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'result lookup failed';
      context.rankedResultDetail = `Authoritative result lookup ${attempt}/${maxAttempts} failed: ${detail}.`;
    }
    renderResolvedOnlineInterruption(context, resolution, transportReason);
  }
  context.rankedResultDetail = resolution.kind === 'ranked_completion_pending'
    ? 'Deterministic proof settlement remains pending. No client-declared result was submitted.'
    : 'The authoritative forfeit remains queued server-side. Progression will update after settlement.';
  renderResolvedOnlineInterruption(context, resolution, transportReason);
}

async function reconcileInterruptedOnlineMatch(
  context: OnlineMatchContext,
  transportReason: string,
): Promise<void> {
  try {
    const retryIntervalMs = 500;
    const maxAttempts = Math.max(
      1,
      Math.ceil((context.reconnectGraceSeconds * 1_000) / retryIntervalMs) + 1,
    );
    const terminal = await pollOnlineTerminalSession({
      read: async () => await requestOnlineJson<MatchSessionView>(
        'GET',
        `/matchmaking/sessions/${context.sessionId}`,
        context.localAccountId,
      ),
      maxAttempts,
      retryIntervalMs,
      wait: waitForMilliseconds,
      onAttempt: (attempt, attempts, session, error) => {
        if (!isInterruptedOnlineScreenCurrent(context) || session?.status === 'resolved') {
          return;
        }
        const failureDetail = error instanceof Error ? ` Last lookup: ${error.message}` : '';
        context.statusText = `${transportReason}\nWaiting for terminal session reconciliation (${attempt}/${attempts}).${failureDetail}`;
      },
    });
    if (!isInterruptedOnlineScreenCurrent(context)) {
      return;
    }
    if (terminal.status === 'grace_expired') {
      const resolution = resolveOnlineTerminalResolution({
        queueType: context.queueType,
        localAccountId: context.localAccountId,
        remoteAccountId: context.remoteAccountId,
        session: terminal.session,
      });
      const detail = terminal.lastError instanceof Error
        ? ` Last lookup: ${terminal.lastError.message}`
        : '';
      context.rankedResultDetail = context.queueType === 'ranked'
        ? `Terminal reconciliation grace expired without an authoritative result.${detail}`
        : context.rankedResultDetail;
      renderResolvedOnlineInterruption(context, resolution, transportReason);
      return;
    }
    const session = terminal.session;
    const resolution = resolveOnlineTerminalResolution({
      queueType: context.queueType,
      localAccountId: context.localAccountId,
      remoteAccountId: context.remoteAccountId,
      session,
    });

    if (resolution.kind === 'ranked_no_contest') {
      context.finalOutcome = null;
      context.winnerAccountId = null;
      context.rankedResultStatus = 'no_contest';
      context.rankedResultDetail = 'Rating, league placement, and Master Rating are unchanged.';
    } else if (
      resolution.kind === 'ranked_forfeit_win'
      || resolution.kind === 'ranked_forfeit_loss'
    ) {
      context.finalOutcome = 'forfeit';
      context.winnerAccountId = resolution.winnerAccountId;
      context.rankedResultStatus = 'authoritative_pending';
      context.rankedResultDetail = 'Server-attributed forfeit recorded. Waiting for progression settlement.';
    } else if (resolution.kind === 'ranked_completion_pending') {
      context.rankedResultStatus = 'awaiting_peer_confirmation';
      context.rankedResultDetail = 'The completed session is waiting for deterministic proof settlement.';
    }

    renderResolvedOnlineInterruption(context, resolution, transportReason);
    if (resolution.shouldPollRankedResult) {
      await pollInterruptedRankedResult(context, resolution, transportReason);
    }
  } catch (error) {
    if (!isInterruptedOnlineScreenCurrent(context)) {
      return;
    }
    const detail = error instanceof Error ? error.message : 'server outcome lookup failed';
    context.statusText = `${transportReason}\nServer outcome lookup failed: ${detail}`;
  }
}

function interruptOnlineMatch(context: OnlineMatchContext, reason: string): void {
  clearOnlineSessionHeartbeat();
  context.inputPump.clear();
  closeOnlineTransport(context);
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
      'The authenticated live transport stopped, so this match cannot continue.',
    ].join('\n'),
    primaryLabel: 'Return to Home',
    secondaryLabel: '',
    onPrimary: () => {
      returnToHome();
    },
  });
  void reconcileInterruptedOnlineMatch(context, reason);
}

function handleOnlineTransportError(
  context: OnlineMatchContext,
  phase: 'upload' | 'poll' | 'confirm' | 'reconnect',
  error: unknown,
): void {
  const prefix = phase === 'upload'
    ? 'Live input upload failed'
    : phase === 'poll'
      ? 'Live input receive failed'
      : phase === 'confirm'
        ? 'Live input confirmation failed'
      : 'Reconnect failed';
  if (error instanceof WebRtcFrameAckTimeoutError) {
    const recovery = context.transportRecovery.getSnapshot();
    if (recovery.state === 'connected') {
      context.transportRecovery.requestRecovery(
        new WebRtcFrameTransportClosedError(error.message),
      );
    }
    return;
  }
  if (error instanceof WebRtcFrameTransportClosedError) {
    const recovery = context.transportRecovery.getSnapshot();
    if (recovery.state === 'connected') {
      context.transportRecovery.requestRecovery(error);
    }
    if (recovery.state === 'failed' || recovery.state === 'closed') {
      interruptOnlineMatch(context, `${prefix}: ${error.message}`);
    }
    return;
  }
  if (
    error instanceof OnlineFrameProtocolError
    || isTerminalOnlineTransportError(error)
  ) {
    interruptOnlineMatch(context, `${prefix}: ${error.message}`);
    return;
  }
  context.statusText = error instanceof Error
    ? `${prefix}: ${error.message}`
    : `${prefix}.`;
}

function flushOnlineTransport(context: OnlineMatchContext): void {
  if (context.transportRecovery.getSnapshot().state !== 'connected') {
    return;
  }
  if (context.inputPump.getOutboundFrameCount() > 0) {
    void context.inputPump.flushOutgoing()
      .then(() => {
        context.smokeRecovery?.observeOutboundTail(
          context.roundEpoch,
          context.inputPump.getOutboundFrameCount(),
        );
      })
      .catch((error) => {
        handleOnlineTransportError(context, 'upload', error);
      });
  }

  void context.inputPump.pollIncoming().catch((error) => {
    handleOnlineTransportError(context, 'poll', error);
  });
  void context.inputPump.flushConfirmation().catch((error) => {
    handleOnlineTransportError(context, 'confirm', error);
  });
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
  lines.push(`Replay evidence: ${context.replayStatus.replace(/_/g, ' ')}. ${context.replayDetail}`);
  return lines.join('\n');
}

function renderOnlineMatchOverScreen(context: OnlineMatchContext, winner: PlayerId, p1Wins: number, p2Wins: number): void {
  const authoritativeForfeit = context.finalOutcome === 'forfeit';
  const title = authoritativeForfeit
    ? (winner === context.localPlayerId ? 'Ranked Victory by Forfeit' : 'Ranked Defeat by Forfeit')
    : 'Online Match Complete';
  const subtitleLines = [
    `Winner: ${winner}${authoritativeForfeit ? ' (server-attributed forfeit)' : ''}`,
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
    ? context.rankedResultStatus === 'failed'
      ? 'Retry Submission'
      : context.replayStatus === 'failed'
        ? 'Retry Replay'
        : 'Refresh Rank'
    : 'Return to Home';
  const secondaryAction = context.queueType === 'ranked'
    ? () => {
      if (context.rankedResultStatus === 'failed') {
        void submitOnlineRankedResult(context);
        return;
      }
      if (context.replayStatus === 'failed') {
        void persistOnlineMatchReplay(context);
        return;
      }
      void refreshOnlineRankedResultSummary(context);
    }
    : () => {
      returnToHome();
    };

  startMenu.showMatchOverScreen({
    title,
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

function waitForMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

async function applyOnlineRankedResultResponse(
  context: OnlineMatchContext,
  payload: RankedResultSubmitResponse,
): Promise<boolean> {
  context.rankedResultSubmissionId = payload.submissionId;
  context.rankedResultResponse = payload;
  if (context.rankedProof && payload.proof) {
    persistLocalRankedProofReview(context.rankedProof, payload.proof);
  }
  const verificationDetail = payload.settlementSource === 'server_authoritative'
    ? `Server resolution verified (${payload.authoritativeResolution?.reason?.replace(/_/g, ' ') ?? 'attributed forfeit'}).`
    : payload.proof
      ? `Proof ${payload.proof.digest.slice(0, 12)} verified (${payload.proof.roundCount} rounds, ${payload.proof.frameCount} frames).`
      : 'Proof verification details unavailable.';
  if (payload.status === 'no_contest') {
    context.rankedResultStatus = 'no_contest';
    context.rankedResultDetail = `${verificationDetail}\nNo rating was changed.`;
    return true;
  }
  if (payload.status === 'authoritative_pending') {
    context.rankedResultStatus = 'authoritative_pending';
    context.rankedResultDetail = `${verificationDetail}\nProgression settlement is queued server-side.`;
    return false;
  }
  if (payload.status === 'flagged_for_review') {
    context.rankedResultStatus = 'flagged_for_review';
    context.rankedResultDetail = `${verificationDetail}\nSubmission flagged for review${payload.suspiciousReasons.length > 0 ? `: ${payload.suspiciousReasons.join(', ')}` : '.'}`;
    return true;
  }
  if (payload.status === 'awaiting_peer_confirmation') {
    context.rankedResultStatus = 'awaiting_peer_confirmation';
    context.rankedResultDetail = `${verificationDetail}\nWaiting for the opponent to submit the same proof.`;
    return false;
  }

  if (payload.outcome) {
    context.finalOutcome = payload.outcome;
  }
  if (payload.winnerAccountId !== undefined) {
    context.winnerAccountId = payload.winnerAccountId;
  }
  context.rankedResultStatus = 'accepted';
  const localDelta = payload.ratingDeltas?.find((entry) => entry.accountId === context.localAccountId) ?? null;
  context.rankedResultDetail = localDelta
    ? `${verificationDetail}\nLocal result: ${localDelta.result} | Rating ${localDelta.preRating} -> ${localDelta.postRating} (${formatSigned(localDelta.ratingDelta)})`
    : `${verificationDetail}\nRanked result accepted.`;
  await refreshOnlineRankedResultSummary(context);
  return true;
}

async function pollOnlineRankedResultConsensus(context: OnlineMatchContext): Promise<void> {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForMilliseconds(1_000);
    if (onlineMatchContext !== context) {
      return;
    }
    try {
      const payload = await requestOnlineJson<RankedResultSubmitResponse>(
        'GET',
        `/ranked/results/${context.sessionId}`,
        context.localAccountId,
        undefined,
        { matchSessionToken: context.sessionToken },
      );
      if (await applyOnlineRankedResultResponse(context, payload)) {
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'status request failed';
      context.rankedResultDetail = `Peer confirmation check ${attempt}/${maxAttempts} failed: ${detail}. Retrying.`;
      continue;
    }
    context.rankedResultDetail = `Verified proof is waiting for the opponent (${attempt}/${maxAttempts}).`;
  }
  context.rankedResultDetail = 'Verified proof remains pending the peer copy. Progression will update after settlement.';
}

async function persistOnlineMatchReplay(context: OnlineMatchContext): Promise<void> {
  if (
    context.replayInFlight
    || context.replayStatus === 'persisted'
    || (context.finalOutcome !== 'p1_win' && context.finalOutcome !== 'p2_win')
    || !context.winnerAccountId
  ) {
    return;
  }
  if (
    context.queueType === 'ranked'
    && context.rankedResultStatus !== 'accepted'
    && context.rankedResultStatus !== 'flagged_for_review'
    && context.rankedResultStatus !== 'already_processed'
  ) {
    return;
  }

  context.replayInFlight = true;
  context.replayStatus = 'persisting';
  context.replayDetail = 'Uploading canonical rollback evidence.';
  try {
    const payload = context.replayPayload ?? await context.replayRecorder.buildPayload();
    context.replayPayload = payload;
    const p1AccountId = context.localPlayerId === 'P1'
      ? context.localAccountId
      : context.remoteAccountId;
    const p2AccountId = context.localPlayerId === 'P2'
      ? context.localAccountId
      : context.remoteAccountId;
    const p1Won = context.finalOutcome === 'p1_win';
    const endedAt = new Date().toISOString();
    const ingestBody = {
      matchId: context.sessionId,
      queueType: context.queueType,
      matchType: context.queueType,
      region: context.region,
      patchVersion: diagnosticsBuildId,
      rulesetVersion: payload.header.rulesetVersion,
      simBuildHash: payload.header.simBuildHash,
      startedAt: context.replayStartedAt,
      endedAt,
      durationSeconds: Math.round(payload.inputTimeline.length * fixedDt),
      outcome: context.finalOutcome,
      winnerAccountId: context.winnerAccountId,
      participants: [
        {
          accountId: p1AccountId,
          side: 'P1' as const,
          characterId: context.matchLoadout.P1,
          result: p1Won ? 'win' as const : 'loss' as const,
        },
        {
          accountId: p2AccountId,
          side: 'P2' as const,
          characterId: context.matchLoadout.P2,
          result: p1Won ? 'loss' as const : 'win' as const,
        },
      ],
      payload,
    };
    const maxAttempts = 3;
    let response: ReplayIngestResponseView | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await requestOnlineJson<ReplayIngestResponseView>(
          'POST',
          '/replays/ingest',
          context.localAccountId,
          ingestBody,
        );
        break;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableOnlineRequestError(error);
        if (!retryable || attempt === maxAttempts) {
          throw error;
        }
        context.replayDetail = `Replay upload attempt ${attempt}/${maxAttempts} failed; retrying.`;
        await waitForMilliseconds(attempt * 500);
      }
    }
    if (!response) {
      throw lastError instanceof Error ? lastError : new Error('Replay upload failed.');
    }
    context.replayId = response.replayId;
    context.replayStatus = 'persisted';
    context.replayDetail = response.existing
      ? `Canonical replay ${response.replayId} already existed and matched this peer.`
      : `Canonical replay ${response.replayId} persisted.`;
    await refreshReplayArchive();
  } catch (error) {
    context.replayStatus = 'failed';
    context.replayDetail = error instanceof Error
      ? `Replay persistence failed: ${error.message}`
      : 'Replay persistence failed.';
  } finally {
    context.replayInFlight = false;
  }
}

async function reconcileOnlineRankedSubmission(
  context: OnlineMatchContext,
  submissionDetail: string,
): Promise<boolean> {
  const maxAttempts = 4;
  let lastError: unknown = null;
  context.rankedResultStatus = 'submitting';
  context.rankedResultDetail = `${submissionDetail} Checking the authoritative server result.`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await waitForMilliseconds(attempt * 250);
    }
    try {
      const payload = await requestOnlineJson<RankedResultSubmitResponse>(
        'GET',
        `/ranked/results/${context.sessionId}`,
        context.localAccountId,
        undefined,
        { matchSessionToken: context.sessionToken },
      );
      const settled = await applyOnlineRankedResultResponse(context, payload);
      if (!settled) {
        await pollOnlineRankedResultConsensus(context);
      }
      await persistOnlineMatchReplay(context);
      return true;
    } catch (error) {
      lastError = error;
      context.rankedResultDetail = `${submissionDetail} Authoritative result check ${attempt}/${maxAttempts} failed; retrying.`;
    }
  }

  const reconciliationDetail = lastError instanceof Error
    ? lastError.message
    : 'authoritative result lookup failed';
  context.rankedResultStatus = 'failed';
  context.rankedResultDetail = `${submissionDetail} Server reconciliation failed: ${reconciliationDetail}`;
  return false;
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
    if (
      !context.rankedProofRecorder
      || (context.finalOutcome !== 'p1_win' && context.finalOutcome !== 'p2_win')
    ) {
      throw new Error('Ranked result is missing a complete deterministic match proof.');
    }
    const proof = context.rankedProof
      ?? context.rankedProofRecorder.buildProof(context.finalOutcome);
    context.rankedProof = proof;
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
        proof,
      },
    );

    if (response.ok) {
      const payload = await response.json() as RankedResultSubmitResponse;
      const settled = await applyOnlineRankedResultResponse(context, payload);
      if (!settled) {
        await pollOnlineRankedResultConsensus(context);
      }
      await persistOnlineMatchReplay(context);
    } else {
      const errorMessage = await parseOnlineApiError(response);
      if (
        response.status === 409
        && (
          errorMessage.includes('already been processed')
          || errorMessage.includes('already submitted')
        )
      ) {
        await reconcileOnlineRankedSubmission(
          context,
          'Ranked result was already received for this session.',
        );
      } else {
        context.rankedResultStatus = 'failed';
        context.rankedResultDetail = errorMessage;
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Ranked result submission failed.';
    await reconcileOnlineRankedSubmission(
      context,
      `Ranked submission response was unavailable: ${detail}.`,
    );
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
  const previousTicket = playerRankedTicket;
  playerRankedTicket = await requestOnlineJson<QueueTicketView>(
    'POST',
    '/matchmaking/queue/join',
    accountId,
    {
      queueType: 'ranked',
      regionPreferences: ['us-east', 'us-west', 'eu-west'],
      buildVersion: diagnosticsBuildId,
      rulesetVersion: getOnlineRulesetVersion(),
      balanceProfileId: activeBalanceProfile.id,
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
    void beginRankedSessionBootstrap(playerRankedTicket, playerRankedSession, 'ranked_queue', {
      previousTicket,
      serverCreatedTicket: playerRankedTicket.joinDisposition === 'created',
    });
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
  const previousTicket = playerRankedTicket;
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
    void beginRankedSessionBootstrap(playerRankedTicket, playerRankedSession, 'ranked_queue', {
      previousTicket,
      serverCreatedTicket: false,
    });
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
  const opened = await beginReplayReviewFromPayload(payloadResponse.payload, `archive:${payloadResponse.replayId}`);
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

async function openLocalReplayFile(file: File): Promise<ReplayArchiveViewState> {
  const maximumBytes = 16 * 1024 * 1024;
  if (file.size > maximumBytes) {
    throw new Error(`Replay file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the local review limit is 16 MB.`);
  }
  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }
  const opened = await beginReplayReviewFromPayload(payloadRaw, `local:${file.name}`, true);
  if (!opened) {
    throw new Error(`${file.name} is invalid or does not reproduce its recorded frame checksums.`);
  }
  return {
    headline: `Opened ${file.name}`,
    detail: 'The replay was validated locally and opened at its flagged gameplay-flow sequence.',
    tone: 'success',
    hint: 'Use frame step, speed controls, contact windows, and Gameplay Flow Review to inspect the loop.',
  };
}

async function openLocalFlowReview(reviewCase: LocalFlowReviewCase): Promise<ReplayArchiveViewState> {
  const payloadRaw = await fetchLocalFlowReviewReplay(reviewCase.id);
  const opened = await beginReplayReviewFromPayload(
    payloadRaw,
    `local-flow:${reviewCase.label}`,
    true,
  );
  if (!opened) {
    throw new Error(
      `${reviewCase.label} is invalid or does not reproduce its recorded frame checksums.`,
    );
  }
  return {
    headline: `Opened ${reviewCase.kind}`,
    detail: `${reviewCase.label}\nRound seed ${reviewCase.roundSeed}; focused at frame ${reviewCase.focusFrame}.`,
    tone: 'success',
    hint: 'Use frame step, speed controls, contact windows, and Gameplay Flow Review to judge the sequence.',
  };
}

function persistLocalRankedProofReview(
  proof: RankedMatchProof,
  verification: NonNullable<RankedResultSubmitResponse['proof']>,
): void {
  if (!runtimeConfig.features.debugToolsEnabled) {
    return;
  }
  void import('./sim/rankedProofReview').then(({ createStoredRankedProofReview }) => {
    const record = createStoredRankedProofReview(proof, verification);
    window.localStorage.setItem(LOCAL_RANKED_PROOF_REVIEW_STORAGE_KEY, JSON.stringify(record));
  }).catch((error: unknown) => {
    console.warn('[ranked-proof] local review persistence skipped', error);
  });
}

async function openLocalRankedProofReview(): Promise<ReplayArchiveViewState> {
  let rawRecord: unknown;
  try {
    const stored = window.localStorage.getItem(LOCAL_RANKED_PROOF_REVIEW_STORAGE_KEY);
    if (!stored) {
      return {
        headline: 'No local ranked proof yet',
        detail: 'This device has not retained a server-verified ranked match proof.',
        tone: 'warning',
        hint: 'Complete a ranked match, wait for proof verification, then return here.',
      };
    }
    rawRecord = JSON.parse(stored) as unknown;
  } catch {
    return {
      headline: 'Local ranked proof unreadable',
      detail: 'The retained proof record is not valid JSON.',
      tone: 'warning',
      hint: 'Complete another ranked match to replace the local record.',
    };
  }

  const {
    buildRankedProofReviewData,
    parseStoredRankedProofReview,
  } = await import('./sim/rankedProofReview');
  const parsed = await parseStoredRankedProofReview(rawRecord);
  if (parsed.ok === false) {
    return {
      headline: 'Local ranked proof rejected',
      detail: parsed.message,
      tone: 'warning',
      hint: 'The replay viewer will only open a proof matching its server verification receipt.',
    };
  }

  const review = buildRankedProofReviewData(parsed.record.proof);
  const sourceLabel = `ranked:${parsed.record.proof.sessionId} | verified ${parsed.record.verification.digest.slice(0, 12)}`;
  beginReplayReview(review, sourceLabel);
  return {
    headline: 'Opened local ranked match',
    detail: [
      `Saved: ${new Date(parsed.record.savedAt).toLocaleString()}`,
      `Proof: ${parsed.record.verification.digest}`,
      `Rounds: ${parsed.record.verification.roundCount}`,
      `Frames: ${parsed.record.verification.frameCount}`,
    ].join('\n'),
    tone: 'success',
    hint: 'Use the round selector and Gameplay Flow Review to inspect contact, spacing, resets, action variety, and exchanges.',
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

function toRankedSnapshotViewState(
  snapshot: RankedProgressionView | null,
  source: 'api' | 'profile' | 'none',
  leaderboard: RankedLeaderboardView | null = null,
  viewerAccountId = '',
): RankedSnapshotViewState {
  const leaderboardSummary = leaderboard
    ? buildRankedLeaderboardSummary(leaderboard, viewerAccountId)
    : null;
  if (!snapshot) {
    return {
      headline: 'No ranked data',
      detail: [
        'No ranked progression data is available yet.',
        leaderboardSummary?.detail,
      ].filter(Boolean).join('\n\n'),
      tone: 'warning',
      hint: leaderboardSummary
        ? 'Complete a ranked session to enter the leaderboard.'
        : 'Complete a ranked session, then refresh again after result submission finishes.',
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
  const rankLabel = leaderboardSummary?.viewerRank ? `#${leaderboardSummary.viewerRank} | ` : '';
  return {
    headline: `${rankLabel}${snapshot.leagueTier ?? 'Placement'} | Rating ${snapshot.rating ?? 'n/a'}`,
    detail: [
      `Source: ${sourceLabel}\nSeason: ${snapshot.seasonId ?? 'current'}\n${statusLine}\n${placementLine}\nLeague Points: ${snapshot.leaguePoints ?? 'n/a'}\nMR Points: ${snapshot.mrPoints ?? 'n/a'}\n${promotionLine}\n${trendLine}\nUpdated: ${snapshot.updatedAt ?? 'unknown'}`,
      leaderboardSummary?.detail,
    ].filter(Boolean).join('\n\n'),
    tone: source === 'api' ? 'success' : 'neutral',
    hint: source === 'api' && leaderboardSummary
      ? 'Progression and the current top 100 leaderboard are live from the ranking service.'
      : source === 'api'
        ? 'Snapshot is current from the ranking service; leaderboard data is unavailable.'
      : 'This snapshot came from stored profile data and may lag behind the latest match.',
  };
}

async function refreshRankedSnapshot(): Promise<RankedSnapshotViewState> {
  const accountId = getOnlineAccountIdOrThrow();
  const rankedResponse = await requestOnlineRaw('GET', '/ranked/progression', accountId);
  if (rankedResponse.ok) {
    const payload = await rankedResponse.json() as unknown;
    playerRankedSnapshot = parseRankedProgression(payload);
    const leaderboardQuery = new URLSearchParams({ limit: '100', offset: '0' });
    if (playerRankedSnapshot?.seasonId) {
      leaderboardQuery.set('seasonId', playerRankedSnapshot.seasonId);
    }
    const leaderboardResponse = await requestOnlineRaw(
      'GET',
      `/ranked/leaderboard?${leaderboardQuery.toString()}`,
      accountId,
    );
    let leaderboard: RankedLeaderboardView | null = null;
    if (leaderboardResponse.ok) {
      leaderboard = parseRankedLeaderboard(await leaderboardResponse.json() as unknown);
      if (!leaderboard) {
        throw new Error('Ranked leaderboard returned an invalid response.');
      }
    } else if (leaderboardResponse.status !== 404 && leaderboardResponse.status !== 501) {
      throw new Error(await parseOnlineApiError(leaderboardResponse));
    }
    return toRankedSnapshotViewState(playerRankedSnapshot, 'api', leaderboard, accountId);
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
  onOpenLocalReplayFile: async (file: File) => {
    return await openLocalReplayFile(file);
  },
  onLoadLocalFlowReviews: localFlowReviewToolsEnabled
    ? async () => await fetchLocalFlowReviewCatalog()
    : undefined,
  onOpenLocalFlowReview: localFlowReviewToolsEnabled
    ? async (reviewCase: LocalFlowReviewCase) => await openLocalFlowReview(reviewCase)
    : undefined,
  onOpenLocalRankedProofReview: runtimeConfig.features.debugToolsEnabled
    ? async () => await openLocalRankedProofReview()
    : undefined,
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
function applyGameplayAccessGate(): void {
  const blockingGate = !assetGameplayGate.allowed
    ? assetGameplayGate
    : !entitlementGameplayGate.allowed
      ? entitlementGameplayGate
      : null;
  startMenu.setEntitlementGate(blockingGate === null, blockingGate?.message ?? null);
}

applyGameplayAccessGate();
applyArcadeHistoryView();
document.documentElement.dataset.assetPreloadState = 'loading';
document.documentElement.dataset.assetPreloadBytes = '0';
document.documentElement.dataset.stageModelState = 'loading';
document.documentElement.dataset.stageModelLoadedIds = '';
void preloadAssetManifest(DEFAULT_ASSET_MANIFEST, {
  onProgress: (progress) => {
    if (runtimeConfig.features.debugToolsEnabled && progress.loaded === progress.total) {
      console.info(`[assets] preloaded ${progress.loaded}/${progress.total} manifest entries`);
    }
  },
}).then(async (result) => {
  const stageModelResult = await loadStageModelAssets(sceneContext.stageBackgroundModel);
  selectedStageAtmosphereId = applyStageAtmospherePreset(sceneContext, selectedStageAtmosphereId);
  assetPreloadBytesLoaded = result.entries.reduce((total, entry) => total + entry.bytes, 0);
  document.documentElement.dataset.assetPreloadBytes = String(assetPreloadBytesLoaded);
  document.documentElement.dataset.stageModelState = 'ready';
  document.documentElement.dataset.stageModelLoadedIds = stageModelResult.loadedIds.join(',');
  document.documentElement.dataset.assetPreloadState = 'ready';
  assetGameplayGate = { allowed: true, message: null };
  applyGameplayAccessGate();
}).catch((error) => {
  document.documentElement.dataset.assetPreloadState = 'failed';
  document.documentElement.dataset.stageModelState = 'failed';
  assetGameplayGate = {
    allowed: false,
    message: 'Required game assets failed validation. Refresh to retry. [ASSET_PRELOAD_FAILED]',
  };
  applyGameplayAccessGate();
  console.error('[assets] preload failed', error);
});

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
let replayReturnPhase: ReplayReturnPhase = 'home';
const replaySpeedOptions = [0.25, 0.5, 1, 2, 4];
let replaySpeedIndex = 2;
let rankedQueueAutoPollAccumulatorSeconds = 0;
let rankedQueueAutoPollInFlight = false;
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
  enabledModes.push('balance_sparring');
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
    stageAtmosphereId: ONLINE_ALPHA_STAGE_ATMOSPHERE_ID,
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
  pauseMenu.setBalanceLabAvailable(selectedMode === 'balance_sparring');
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
    entitlementGameplayGate = {
      allowed: false,
      message: 'Entitlement check failed. Please retry or refresh.',
    };
    applyGameplayAccessGate();
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
  }).catch((error) => {
    entitlementGameplayGate = {
      allowed: false,
      message: 'Entitlement check failed. Please retry or refresh.',
    };
    applyGameplayAccessGate();
    throw error;
  });
  if (access.allowed) {
    entitlementGameplayGate = { allowed: true, message: null };
    applyGameplayAccessGate();
    return;
  }

  entitlementGameplayGate = {
    allowed: false,
    message: `${access.message} [${access.code}]`,
  };
  applyGameplayAccessGate();
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

function formatAiControllerRoles(roles: AiControllerRoles): string {
  return `P1 ${resolveAiControllerRole(roles.P1).label} / P2 ${resolveAiControllerRole(roles.P2).label}`;
}

function getCurrentBalanceScenarioIdentity(): BalanceLabScenarioIdentity {
  const aiDifficulty = resolveAiDifficultyForCurrentMatch();
  const startingSituation = resolveBalanceScenario(activeBalanceScenarioId);
  const balanceSparring = selectedMode === 'balance_sparring';
  const testRecipe = findBalanceTestRecipeForSetup(
    activeBalanceScenarioId,
    activeAiControllerRoles,
  );
  const loadout = {
    P1: state.players.P1.characterId,
    P2: state.players.P2.characterId,
  };
  const descriptor = {
    schemaVersion: 'gw.balance-lab-scenario.v5',
    startingSituationSchemaVersion: BALANCE_SCENARIO_SCHEMA_VERSION,
    aiControllerRoleSchemaVersion: AI_CONTROLLER_ROLE_SCHEMA_VERSION,
    balanceTestRecipeSchemaVersion: BALANCE_TEST_RECIPE_SCHEMA_VERSION,
    balanceTestRecipeId: testRecipe?.id ?? 'custom',
    humanControlledPlayerId: balanceSparring ? 'P1' : null,
    aiControllerRoles: sanitiseAiControllerRoles(activeAiControllerRoles),
    startingSituationId: startingSituation.id,
    mode: selectedMode,
    seed: state.seed,
    aiDifficulty,
    fixedDt,
    rules: state.rules,
    loadout,
    rulesetVersion: runtimeRulesetVersion,
  };
  const controllerLabel = balanceSparring
    ? `P1 Human / P2 ${resolveAiControllerRole(activeAiControllerRoles.P2).label}`
    : formatAiControllerRoles(activeAiControllerRoles);
  return {
    fingerprint: fingerprintDeterministicValue(descriptor),
    label: `${testRecipe?.label ?? 'Custom probe'} | ${startingSituation.label} | ${selectedMode} | seed ${state.seed} | ${aiDifficulty} | ${controllerLabel} | ${loadout.P1} vs ${loadout.P2}`,
    sampleId: `local-sample-${balanceLabSampleSequence}`,
    descriptor,
  };
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
    balanceProfileId: runtimeBalanceProfileId,
    rulesetVersion: getRuntimeRulesetVersion(),
    playerCharacterId: selectedLoadout.P1,
    opponentCharacterId: selectedLoadout.P2,
  });
}

function shouldShowLiveInputHistory(): boolean {
  return appPhase === 'playing' && isLocalBalanceLabMode(selectedMode);
}

function shouldShowLiveMatchTelemetry(): boolean {
  return appPhase === 'playing' && isLocalBalanceLabMode(selectedMode);
}

function isLocalAiRoundReviewMode(mode: GameMode): boolean {
  return mode === 'endless'
    || mode === 'best_of_3'
    || mode === 'arcade'
    || mode === 'balance_sparring'
    || mode === 'cpu_vs_cpu';
}

function buildOfflineAiControllersForCurrentMode(): Partial<Record<PlayerId, AiControllerState>> {
  if (selectedMode === 'training' || onlineMatchContext !== null) {
    return {};
  }

  const profileId = resolveAiDifficultyForCurrentMatch();
  if (selectedMode === 'cpu_vs_cpu') {
    return {
      P1: createAiController({
        seed: deriveOfflineAiSeed(state.seed, 'P1'),
        profileId,
        behaviorTuning: activeAiBehaviorTuning,
      }),
      P2: createAiController({
        seed: deriveOfflineAiSeed(state.seed, 'P2'),
        profileId,
        behaviorTuning: activeAiBehaviorTuning,
      }),
    };
  }

  return {
    P2: createAiController({
      seed: deriveOfflineAiSeed(state.seed, 'P2'),
      profileId,
      ...(selectedMode === 'balance_sparring'
        ? { behaviorTuning: activeAiBehaviorTuning }
        : {}),
    }),
  };
}

function resetRoundState(options: { advanceOfflineRound?: boolean } = {}): void {
  const completedAiRoundReplay = liveAiRoundReplayRecorder?.buildPayload() ?? null;
  if (completedAiRoundReplay) {
    latestAiRoundReplayPayload = completedAiRoundReplay;
  }
  liveAiRoundReplayRecorder = null;
  persistRollbackDiagnostics('round_reset');
  balanceLabSampleSequence += 1;
  if (
    options.advanceOfflineRound
    && onlineMatchContext === null
    && selectedMode !== 'training'
  ) {
    offlineRoundIndex += 1;
  }
  if (onlineMatchContext) {
    onlineMatchContext.roundEpoch += 1;
    onlineMatchContext.inputPump.startEpoch(onlineMatchContext.roundEpoch);
  }
  const localBalanceEligible = onlineMatchContext === null
    && isLocalBalanceLabMode(selectedMode);
  const tuning = selectLocalBalanceTuning(
    selectedMode,
    onlineMatchContext !== null,
    activeBalanceProfile.tuning,
    localBalanceTuningDraft,
  );
  runtimeBalanceProfileId = localBalanceEligible
    ? localBalanceProfileId
    : activeBalanceProfile.id;
  activeBalanceScenarioId = localBalanceEligible
    ? localBalanceScenarioId
    : DEFAULT_BALANCE_SCENARIO_ID;
  const matchLoadout = onlineMatchContext ? onlineMatchContext.matchLoadout : resolveLoadoutForCurrentMatch();
  const characterBalanceOverrides = selectLocalCharacterBalanceOverrides(
    selectedMode,
    onlineMatchContext !== null,
    localCharacterBalanceOverrides,
  );
  activeAiBehaviorTuning = selectLocalAiBehaviorTuning(
    selectedMode,
    onlineMatchContext !== null,
    localAiBehaviorTuning,
  );
  activeAiControllerRoles = selectLocalAiControllerRoles(
    selectedMode,
    onlineMatchContext !== null,
    localAiControllerRoles,
  );
  const roundSeed = onlineMatchContext
    ? selectedMatchSeed
    : deriveOfflineRoundSeed(selectedMatchSeed, offlineRoundIndex);
  state = createInitialState({
    loadout: matchLoadout,
    seed: roundSeed,
    rules: getRulesForMode(selectedMode),
    characterBalanceOverrides,
  });
  state.tuning = { ...tuning };
  applyBalanceScenario(state, activeBalanceScenarioId);
  const LocalRankedSmokeInputDriverConstructor = localRankedSmokeInputDriverModule
    ?.LocalRankedSmokeInputDriver;
  localRankedSmokeInputDriver = LocalRankedSmokeInputDriverConstructor && onlineMatchContext
    ? new LocalRankedSmokeInputDriverConstructor({
      seed: state.seed,
      loadout: state.loadout,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
    })
    : null;
  onlineMatchContext?.rankedProofRecorder?.startRound(onlineMatchContext.roundEpoch);
  onlineMatchContext?.replayRecorder.startRound(onlineMatchContext.roundEpoch);
  matchTelemetry = createMatchTelemetryTracker(state);
  aiDecisionTelemetry.startRound();
  roundTuningFingerprint = fingerprintBalanceTuning(state.tuning);
  balanceTuningDirty = false;
  roundCharacterBalanceFingerprint = fingerprintCharacterBalanceOverrides(
    state.characterBalanceOverrides,
  );
  characterBalanceDirty = false;
  roundAiBehaviorFingerprint = fingerprintAiBehaviorTuning(activeAiBehaviorTuning);
  aiBehaviorDirty = false;
  roundAiControllerRolesFingerprint = fingerprintAiControllerRoles(activeAiControllerRoles);
  aiControllerRolesDirty = false;
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
  if (isLocalAiRoundReviewMode(selectedMode) && onlineMatchContext === null) {
    const aiMirror = selectedMode === 'cpu_vs_cpu';
    const balanceSparring = selectedMode === 'balance_sparring';
    const testRecipe = aiMirror || balanceSparring
      ? findBalanceTestRecipeForSetup(activeBalanceScenarioId, activeAiControllerRoles)
      : null;
    const localAiProvenance: ReplayLocalAiProvenance | undefined = aiMirror
      ? {
          schemaVersion: LOCAL_AI_REPLAY_SCHEMA_VERSION,
          profileId: resolveAiDifficultyForCurrentMatch(),
          matchSeed: sanitiseSeed(selectedMatchSeed),
          roundSeed: state.seed,
          roundIndex: offlineRoundIndex,
          controllerSeeds: {
            P1: deriveOfflineAiSeed(state.seed, 'P1'),
            P2: deriveOfflineAiSeed(state.seed, 'P2'),
          },
          controllerRoles: sanitiseAiControllerRoles(activeAiControllerRoles),
          behaviorTuning: sanitiseAiBehaviorTuning(activeAiBehaviorTuning),
          recoveryPolicyId: 'legacy' as const,
          clashPolicyId: 'legacy' as const,
          pursuitPolicyId: 'legacy' as const,
        }
      : undefined;
    const localModeLabel = selectedMode === 'endless'
      ? 'AI Sparring (Endless)'
      : selectedMode === 'best_of_3'
        ? 'AI Sparring (Best of 3)'
        : selectedMode === 'arcade'
          ? 'Arcade Ladder'
          : balanceSparring
            ? 'Balance Sparring'
            : 'AI vs AI';
    liveAiRoundReplayRecorder = new LocalRoundReplayRecorder({
      rulesetVersion: getRuntimeRulesetVersion(),
      simBuildHash: diagnosticsBuildId,
      roundNumber: offlineRoundIndex + 1,
      seed: state.seed,
      loadout: state.loadout,
      fixedDt,
      rules: state.rules,
      tuning: state.tuning,
      characterBalanceOverrides: state.characterBalanceOverrides,
      ...(aiMirror || balanceSparring ? { startingSituationId: activeBalanceScenarioId } : {}),
      ...(localAiProvenance ? { localAiProvenance } : {}),
      sourceLabel: aiMirror
        ? `AI vs AI ${state.loadout.P1} vs ${state.loadout.P2} | probe ${testRecipe?.label ?? 'Custom'} | ${resolveAiDifficultyForCurrentMatch()} | ${formatAiControllerRoles(activeAiControllerRoles)} | ${resolveBalanceScenario(activeBalanceScenarioId).label} | round ${offlineRoundIndex + 1} seed ${state.seed}`
        : `${localModeLabel} | P1 ${state.loadout.P1} human vs P2 ${state.loadout.P2} ${resolveAiDifficultyForCurrentMatch()} AI | probe ${testRecipe?.label ?? 'Custom'} | ${resolveBalanceScenario(activeBalanceScenarioId).label} | round ${offlineRoundIndex + 1} seed ${state.seed}`,
    });
  }
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
      balanceProfileId: runtimeBalanceProfileId,
      rulesetVersion: getRuntimeRulesetVersion(),
      scenarioIdentity: getCurrentBalanceScenarioIdentity(),
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
  balanceLabSampleTargetFrames = null;
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
  pauseMenu.setBalanceLabAvailable(selectedMode === 'balance_sparring');
  if (selectedMode === 'training') {
    trainingTelemetry = createTrainingTelemetryForCurrentSelection();
  }
  if (!Number.isFinite(forcedSeed) && onlineMatchContext === null) {
    selectedMatchSeed = ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0) || 1;
  }
  offlineRoundIndex = 0;
  liveAiRoundReplayRecorder = null;
  latestAiRoundReplayPayload = null;
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
  hud.setControlsVisible(selectedMode !== 'cpu_vs_cpu');
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
  balanceLabSampleTargetFrames = null;
  persistRollbackDiagnostics('return_home');
  leaveActiveOnlineSessionBeforeTeardown();
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
  hud.setControlsVisible(true);
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
  leaveActiveOnlineSessionBeforeTeardown();
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
    ? `ICE servers: ${iceConfig.iceServers.length} | TURN relay: ${iceConfig.relayAvailable ? 'ready' : 'missing'} | Connect timeout: ${iceConfig.directConnectTimeoutMs}ms`
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
  if (onlineBootstrapPanel) {
    onlineBootstrapPanel.hidden = true;
  }
}

function leaveActiveOnlineSessionBeforeTeardown(): void {
  const context = onlineMatchContext;
  const interruptScreenCanLeave = appPhase === 'match_over'
    && context !== null
    && context.finalOutcome === null
    && context.sessionCompletionStatus !== 'completed';
  if (
    appPhase !== 'online_bootstrap'
    && appPhase !== 'playing'
    && appPhase !== 'round_transition'
    && !interruptScreenCanLeave
  ) {
    return;
  }

  const queueTicketId = context?.queueTicketId ?? onlineBootstrapState?.queueTicketId ?? null;
  const accountId = context?.localAccountId ?? onlineBootstrapState?.localAccountId ?? null;
  if (!queueTicketId || !accountId) {
    return;
  }
  if (playerRankedTicket?.ticketId === queueTicketId) {
    playerRankedSession = null;
  }
  void requestOnlineJson<QueueTicketView>(
    'POST',
    '/matchmaking/queue/leave',
    accountId,
    { ticketId: queueTicketId },
    { keepalive: true },
  ).then((ticket) => {
    if (playerRankedTicket?.ticketId === queueTicketId) {
      playerRankedTicket = ticket;
      playerRankedSession = null;
    }
  }).catch((error) => {
    if (runtimeConfig.features.debugToolsEnabled) {
      console.warn('[online] intentional leave notice failed', error);
    }
  });
}

function clearOnlineMatchContext(): void {
  clearOnlineSessionHeartbeat();
  if (onlineMatchContext) {
    onlineMatchContext.inputPump.clear();
    closeOnlineTransport(onlineMatchContext);
    selectedMode = onlineMatchContext.restoreMode;
    pauseMenu.setBalanceLabAvailable(selectedMode === 'balance_sparring');
    selectedLoadout = {
      P1: onlineMatchContext.restoreLoadout.P1,
      P2: onlineMatchContext.restoreLoadout.P2,
    };
    selectedStageAtmosphereId = applyStageAtmospherePreset(
      sceneContext,
      onlineMatchContext.restoreStageAtmosphereId,
    );
    startMenu.setStageAtmosphere(selectedStageAtmosphereId);
  }
  onlineMatchContext = null;
  localRankedSmokeInputDriver = null;
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

function resolveHeartbeatIntervalMs(matchStart: MatchStartPayload): number {
  const configuredSeconds = Number(matchStart.heartbeatIntervalSeconds);
  const seconds = Number.isFinite(configuredSeconds)
    ? Math.min(30, Math.max(1, configuredSeconds))
    : 5;
  return Math.floor(seconds * 1000);
}

function clearOnlineSessionHeartbeat(): void {
  onlineSessionLifecycle.clear();
}

async function requestOnlineSessionReconnect(
  target: OnlineSessionLifecycleTarget,
): Promise<MatchSessionView> {
  const timeoutMs = Math.max(1_000, Math.min(5_000, target.intervalMs));
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort(new Error(`Session reconnect timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  try {
    return await requestOnlineJson<MatchSessionView>(
      'POST',
      '/matchmaking/sessions/reconnect',
      target.localAccountId,
      {
        sessionId: target.sessionId,
        sessionToken: target.sessionToken,
        reconnectAttemptId: createReconnectAttemptId(),
      },
      { signal: controller.signal },
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function handleOnlineSessionHeartbeatError(
  target: OnlineSessionLifecycleTarget,
  error: unknown,
): void {
  if (onlineSessionLifecycle.getSnapshot().sessionId !== target.sessionId) {
    return;
  }
  const message = error instanceof Error ? error.message : 'Session heartbeat failed.';
  if (isTerminalOnlineTransportError(error)) {
    if (
      error.code === 'session_resolved'
      && onlineMatchContext?.sessionId === target.sessionId
      && appPhase === 'match_over'
      && onlineMatchContext.finalOutcome !== null
    ) {
      onlineMatchContext.statusText = 'Session resolved while completion consensus was pending. Verifying the terminal reason.';
      clearOnlineSessionHeartbeat();
      return;
    }
    clearOnlineSessionHeartbeat();
    if (onlineMatchContext?.sessionId === target.sessionId) {
      interruptOnlineMatch(onlineMatchContext, `Session liveness failed: ${message}`);
      return;
    }
    if (onlineBootstrapState?.sessionId === target.sessionId) {
      onlineBootstrapState = {
        ...onlineBootstrapState,
        status: 'failed',
        statusDetail: `Session liveness failed before transport setup: ${message}`,
      };
      renderOnlineBootstrapPanel();
    }
    return;
  }

  if (onlineMatchContext?.sessionId === target.sessionId) {
    onlineMatchContext.statusText = `Session heartbeat delayed: ${message}`;
    return;
  }
  if (onlineBootstrapState?.sessionId === target.sessionId) {
    onlineBootstrapState = {
      ...onlineBootstrapState,
      statusDetail: `WebRTC setup continues while session heartbeat retries: ${message}`,
    };
    renderOnlineBootstrapPanel();
  }
}

function setOnlineSessionLifecycleStatus(
  target: OnlineSessionLifecycleTarget,
  message: string,
): void {
  if (onlineMatchContext?.sessionId === target.sessionId) {
    onlineMatchContext.statusText = message;
    return;
  }
  if (onlineBootstrapState?.sessionId === target.sessionId) {
    onlineBootstrapState = {
      ...onlineBootstrapState,
      statusDetail: message,
    };
    renderOnlineBootstrapPanel();
  }
}

function handleOnlineSessionLifecycleEvent(event: OnlineSessionLifecycleEvent): void {
  if (event.type === 'suspended') {
    const suffix = onlineBootstrapState?.sessionId === event.target.sessionId
      ? ' during WebRTC setup. Reconnect will resume on focus.'
      : '. Reconnect will be requested when focus returns.';
    setOnlineSessionLifecycleStatus(
      event.target,
      `Session suspended (${event.source})${suffix}`,
    );
    return;
  }

  if (event.type === 'reconnecting') {
    const message = event.source === 'heartbeat_timeout'
      ? 'Session liveness expired. Requesting a nonce-protected reconnect.'
      : onlineBootstrapState?.sessionId === event.target.sessionId
        ? 'Requesting session reconnect before WebRTC setup continues.'
        : 'Requesting session reconnect after returning to the match.';
    setOnlineSessionLifecycleStatus(event.target, message);
    return;
  }

  const message = event.type === 'heartbeat_recovered'
    ? 'Session liveness restored after a missed heartbeat.'
    : onlineBootstrapState?.sessionId === event.target.sessionId
      ? `Reconnect accepted (${event.source}). WebRTC setup continues.`
      : `Reconnect accepted (${event.source}). Online transport resumed.`;
  setOnlineSessionLifecycleStatus(event.target, message);
}

function handleOnlineSessionLifecycleError(failure: OnlineSessionLifecycleError): void {
  if (onlineSessionLifecycle.getSnapshot().sessionId !== failure.target.sessionId) {
    return;
  }
  if (failure.phase === 'disconnect') {
    const detail = failure.error instanceof Error
      ? `Disconnect notice failed: ${failure.error.message}`
      : 'Disconnect notice failed.';
    setOnlineSessionLifecycleStatus(failure.target, detail);
    return;
  }
  if (failure.phase === 'reconnect') {
    if (onlineMatchContext?.sessionId === failure.target.sessionId) {
      const message = failure.error instanceof Error ? failure.error.message : 'Reconnect failed.';
      interruptOnlineMatch(onlineMatchContext, `Reconnect failed: ${message}`);
      return;
    }
    if (onlineBootstrapState?.sessionId === failure.target.sessionId) {
      clearOnlineSessionHeartbeat();
      onlineBootstrapState = {
        ...onlineBootstrapState,
        status: 'failed',
        statusDetail: failure.error instanceof Error
          ? `Session reconnect failed before transport setup: ${failure.error.message}`
          : 'Session reconnect failed before transport setup.',
      };
      renderOnlineBootstrapPanel();
    }
    return;
  }
  handleOnlineSessionHeartbeatError(failure.target, failure.error);
}

function handleOnlineHeartbeatSessionView(
  target: OnlineSessionLifecycleTarget,
  session: MatchSessionView,
): void {
  const context = onlineMatchContext;
  if (
    !context
    || context.sessionId !== target.sessionId
    || (appPhase !== 'playing' && appPhase !== 'round_transition')
  ) {
    return;
  }
  const peer = session.participants.find((participant) => (
    participant.accountId === context.remoteAccountId
  ));
  const recovery = context.transportRecovery.getSnapshot();
  if (shouldRecoverForPeerPresence({
    localSide: context.localPlayerId,
    peerConnectionStatus: peer?.connectionStatus ?? null,
    transportState: recovery.state,
  })) {
    context.statusText = 'Peer presence disconnected. Advancing the shared transport generation.';
    context.transportRecovery.requestRecovery(new WebRtcFrameTransportClosedError(
      'Peer presence reported a disconnected gameplay transport.',
    ));
  }
}

const onlineSessionLifecycle = new OnlineSessionLifecycleController({
  heartbeat: async (target, signal) => {
    const session = await requestOnlineJson<MatchSessionView>(
      'POST',
      '/matchmaking/sessions/heartbeat',
      target.localAccountId,
      {
        sessionId: target.sessionId,
        sessionToken: target.sessionToken,
      },
      { signal },
    );
    handleOnlineHeartbeatSessionView(target, session);
  },
  disconnect: async (target) => {
    await requestOnlineJson<MatchSessionView>(
      'POST',
      '/matchmaking/sessions/disconnect',
      target.localAccountId,
      { sessionId: target.sessionId },
      { keepalive: true },
    );
  },
  reconnect: async (target) => {
    await requestOnlineSessionReconnect(target);
  },
  isDisconnectedError: (error) => (
    error instanceof OnlineRequestError
    && error.code === 'participant_disconnected'
  ),
  reconnectMaxAttempts: 3,
  reconnectRetryDelayMs: 500,
  isRetryableReconnectError: isRetryableOnlineRequestError,
  waitForReconnectRetry: waitForMilliseconds,
  onEvent: handleOnlineSessionLifecycleEvent,
  onError: handleOnlineSessionLifecycleError,
});

function startOnlineSessionHeartbeat(matchStart: MatchStartPayload): void {
  clearOnlineSessionHeartbeat();
  onlineSessionLifecycle.start({
    sessionId: matchStart.sessionId,
    sessionToken: matchStart.sessionToken,
    localAccountId: matchStart.localPlayer.accountId,
    intervalMs: resolveHeartbeatIntervalMs(matchStart),
  });
  if (document.visibilityState === 'hidden' && canLifecycleManageOnlineSession()) {
    void onlineSessionLifecycle.suspend('visibility_hidden');
  }
}

function canLifecycleManageOnlineSession(): boolean {
  const sessionId = onlineSessionLifecycle.getSnapshot().sessionId;
  if (!sessionId) {
    return false;
  }
  return (
    onlineMatchContext?.sessionId === sessionId
    && (appPhase === 'playing' || appPhase === 'round_transition')
  ) || (
    onlineBootstrapState?.sessionId === sessionId
    && appPhase === 'online_bootstrap'
  );
}

async function completeOnlineSession(context: OnlineMatchContext): Promise<void> {
  if (context.sessionCompletionInFlight || context.sessionCompletionStatus === 'completed') {
    return;
  }
  context.sessionCompletionInFlight = true;
  context.sessionCompletionStatus = 'completing';
  let terminalResolutionReached = false;
  try {
    const retryIntervalMs = 500;
    const result = await reconcileOnlineCompletionConsensus({
      attest: async () => await requestOnlineJson<MatchSessionView>(
        'POST',
        '/matchmaking/sessions/complete',
        context.localAccountId,
        {
          sessionId: context.sessionId,
          sessionToken: context.sessionToken,
        },
      ),
      read: async () => await requestOnlineJson<MatchSessionView>(
        'GET',
        `/matchmaking/sessions/${context.sessionId}`,
        context.localAccountId,
      ),
      maxAttempts: Math.max(
        20,
        Math.ceil((context.reconnectGraceSeconds * 1_000) / retryIntervalMs),
      ),
      retryIntervalMs,
      wait: waitForMilliseconds,
      onAttempt: (attempt, maxAttempts, session, error) => {
        if (onlineMatchContext !== context || context.sessionCompletionStatus === 'completed') {
          return;
        }
        context.sessionCompletionStatus = session?.status === 'active'
          ? 'awaiting_peer'
          : 'completing';
        const errorDetail = error instanceof Error ? ` Last request: ${error.message}` : '';
        context.statusText = `Waiting for peer completion (${attempt}/${maxAttempts}).${errorDetail}`;
      },
    });
    if (result.status === 'consensus') {
      terminalResolutionReached = true;
      context.sessionCompletionStatus = 'completed';
      context.statusText = 'Match completion confirmed.';
    } else if (result.status === 'terminal') {
      terminalResolutionReached = true;
      context.sessionCompletionStatus = 'failed';
      context.statusText = `Session resolved as ${result.session.resolvedReason ?? 'unknown'} before completion consensus.`;
    } else {
      context.sessionCompletionStatus = 'awaiting_peer';
      const detail = result.lastError instanceof Error ? ` Last request: ${result.lastError.message}` : '';
      context.statusText = `Peer completion pending.${detail}`;
    }
  } catch (error) {
    context.sessionCompletionStatus = 'failed';
    context.statusText = error instanceof Error
      ? `Session close failed: ${error.message}`
      : 'Session close failed.';
  } finally {
    context.sessionCompletionInFlight = false;
    if (terminalResolutionReached) {
      closeCompletedOnlineSessionNetwork(context);
    }
  }
}

function beginOnlineMatch(
  matchStart: MatchStartPayload,
  transport: RecoverableWebRtcTransport,
  connectionPath: ConnectionPath,
  iceConfig: MatchmakingIceConfig,
  closeTransport: () => void,
): OnlineMatchContext {
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
  const restoreStageAtmosphereId = selectedStageAtmosphereId;
  const matchLoadout = localPlayerId === 'P1'
    ? { P1: localCharacterId, P2: remoteCharacterId }
    : { P1: remoteCharacterId, P2: localCharacterId };
  if (
    matchStart.queueType === 'ranked'
    && (!matchStart.buildVersion || !matchStart.rulesetVersion || !matchStart.balanceProfileId)
  ) {
    throw new Error('Ranked match start is missing build or ruleset verification metadata.');
  }

  selectedMode = 'best_of_3';
  hud.setControlsVisible(true);
  pauseMenu.setBalanceLabAvailable(false);
  selectedMatchSeed = rankedSeedFromSessionId(matchStart.sessionId);
  const balanceProfileId = matchStart.balanceProfileId ?? activeBalanceProfile.id;
  const onlineBalanceProfile = resolveBalanceProfile(balanceProfileId);
  const onlineStage = resolveStageAtmosphere(ONLINE_ALPHA_STAGE_ATMOSPHERE_ID);
  selectedStageAtmosphereId = applyStageAtmospherePreset(sceneContext, onlineStage.id);
  startMenu.setStageAtmosphere(selectedStageAtmosphereId);
  const LocalRankedSmokeFrameTransportConstructor = localRankedSmokeTransportModule
    ?.LocalRankedSmokeFrameTransport;
  const LocalRankedRecoverySmokeControllerConstructor = localRankedRecoverySmokeModule
    ?.LocalRankedRecoverySmokeController;
  if (
    localRankedRootSmokeConfig.enabled
    && (!LocalRankedSmokeFrameTransportConstructor || !LocalRankedRecoverySmokeControllerConstructor)
  ) {
    throw new Error('Local ranked smoke runtime was not loaded before match bootstrap.');
  }
  const smokeFrameTransport = LocalRankedSmokeFrameTransportConstructor
    ? new LocalRankedSmokeFrameTransportConstructor({
      transport,
      inboundDelayPolls: localRankedRootSmokeConfig.inboundDelayPolls,
    })
    : null;
  const smokeRecovery = LocalRankedRecoverySmokeControllerConstructor
    ? new LocalRankedRecoverySmokeControllerConstructor({
      initialAttemptGeneration: matchStart.transportAttempt.generation,
      forceRelayRequested: localRankedRootSmokeConfig.forceRelay,
    })
    : null;
  const inputPump = new OnlineInputPump({
    epoch: 0,
    remoteAccountId: matchStart.peer.accountId,
    transport: smokeFrameTransport ?? transport,
  });
  const context: OnlineMatchContext = {
    queueTicketId: matchStart.localPlayer.queueTicketId,
    sessionId: matchStart.sessionId,
    sessionToken: matchStart.sessionToken,
    reconnectGraceSeconds: Math.max(1, Number(matchStart.reconnectGraceSeconds ?? 20)),
    queueType: matchStart.queueType,
    region: matchStart.region,
    matchLoadout,
    restoreMode,
    restoreLoadout,
    restoreStageAtmosphereId,
    localPlayerId,
    remotePlayerId,
    localAccountId: matchStart.localPlayer.accountId,
    remoteAccountId: matchStart.peer.accountId,
    statusText: `Connected via authenticated WebRTC ${connectionPath} path.`,
    connectionPath,
    iceTransportPolicy: iceConfig.iceTransportPolicy,
    relayAvailable: iceConfig.relayAvailable,
    turnCredentialMode: iceConfig.turnCredentialMode,
    transportAttemptGeneration: matchStart.transportAttempt.generation,
    roundEpoch: -1,
    rankedProofRecorder: matchStart.queueType === 'ranked'
      ? new RankedMatchProofRecorder({
        sessionId: matchStart.sessionId,
        matchId: matchStart.sessionId,
        buildVersion: matchStart.buildVersion as string,
        rulesetVersion: matchStart.rulesetVersion as string,
        balanceProfileId: matchStart.balanceProfileId as string,
        seed: selectedMatchSeed,
        loadout: matchLoadout,
      })
      : null,
    rankedProof: null,
    replayRecorder: new OnlineMatchReplayRecorder({
      sessionId: matchStart.sessionId,
      matchId: matchStart.sessionId,
      localPlayerId,
      rulesetVersion: matchStart.rulesetVersion ?? getOnlineRulesetVersion(),
      simBuildHash: matchStart.buildVersion ?? diagnosticsBuildId,
      balanceProfileId: onlineBalanceProfile.id,
      seed: selectedMatchSeed,
      loadout: matchLoadout,
      fixedDt,
      rules: getRulesForMode('best_of_3'),
      tuning: onlineBalanceProfile.tuning,
      characterBalanceOverrides: {},
      stage: {
        id: onlineStage.id,
        version: 'gw.stage-atmosphere.v1',
        fingerprint: fingerprintDeterministicValue(onlineStage),
      },
    }),
    replayPayload: null,
    replayStatus: 'recording',
    replayDetail: 'Recording mutually confirmed rollback inputs.',
    replayId: null,
    replayInFlight: false,
    replayStartedAt: new Date().toISOString(),
    inputPump,
    smokeFrameTransport,
    smokeRecovery,
    transportRecovery: transport,
    closeTransport,
    transportClosed: false,
    pendingRoundWinner: null,
    pendingRoundFinalFrame: null,
    roundSyncElapsedSeconds: 0,
    sendAccumulatorSeconds: 0,
    pollAccumulatorSeconds: 0,
    finalOutcome: null,
    winnerAccountId: null,
    rankedResultStatus: 'idle',
    rankedResultDetail: 'Awaiting match completion.',
    rankedResultSubmissionId: null,
    rankedResultResponse: null,
    rankedResultPersistedRead: false,
    rankedResultInFlight: false,
    rollbackApplications: 0,
    rollbackFrames: 0,
    maxRollbackDepth: 0,
    sessionCompletionInFlight: false,
    sessionCompletionStatus: 'idle',
  };
  onlineMatchContext = context;
  clearOnlineBootstrapState();
  beginMode('best_of_3', undefined, selectedAiDifficulty, selectedArcadeSettings);
  return context;
}

async function beginRankedSessionBootstrap(
  ticket: QueueTicketView,
  session: MatchSessionView | null,
  source: 'ranked_queue',
  bootstrap: {
    previousTicket: QueueTicketView | null;
    serverCreatedTicket: boolean;
  },
): Promise<void> {
  if (!onlineRuntimeEnabled || !ticket.matchStart) {
    return;
  }

  const accountId = sessionAccountId ?? ticket.accountId;
  const matchStart = ticket.matchStart;
  if (
    onlineMatchContext?.sessionId === matchStart.sessionId
    || onlineBootstrapState?.sessionId === matchStart.sessionId
  ) {
    return;
  }
  const bootstrapAction = decideMatchedTicketBootstrap({
    previousTicket: bootstrap.previousTicket ? {
      ticketId: bootstrap.previousTicket.ticketId,
      status: bootstrap.previousTicket.status,
      sessionId: bootstrap.previousTicket.matchStart?.sessionId ?? null,
    } : null,
    currentTicket: {
      ticketId: ticket.ticketId,
      status: ticket.status,
      sessionId: matchStart.sessionId,
    },
    sessionStatus: session?.status ?? null,
    serverCreatedTicket: bootstrap.serverCreatedTicket,
  });
  onlineBootstrapState = {
    source,
    queueTicketId: ticket.ticketId,
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
  if (bootstrapAction !== 'start_fresh') {
    onlineBootstrapState = {
      ...onlineBootstrapState,
      status: 'failed',
      statusDetail: session?.status === 'resolved'
        ? 'This matched session has already ended. Return home and join the queue again.'
        : 'This browser did not observe the match start and has no verified recovery checkpoint. Starting again at frame zero would desynchronize the match; leave this session and requeue.',
    };
  }
  if (
    matchStart.buildVersion !== diagnosticsBuildId
    || matchStart.rulesetVersion !== getOnlineRulesetVersion()
    || matchStart.balanceProfileId !== activeBalanceProfile.id
  ) {
    onlineBootstrapState = {
      ...onlineBootstrapState,
      status: 'failed',
      statusDetail: 'Matched session build or ruleset does not match this client. The match was not started.',
    };
  }
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

  if (onlineBootstrapState.status === 'failed') {
    return;
  }

  startOnlineSessionHeartbeat(matchStart);

  const requestedConnectionPath: ConnectionPath = localRankedRootSmokeConfig.forceRelay
    ? 'relay'
    : 'direct';
  const iceConfig = await fetchMatchmakingIceConfig(
    matchmakingApiBase,
    localRankedRootSmokeConfig.forceRelay,
    {
    accountId: matchStart.localPlayer.accountId,
    accessToken: platform.auth.getAccessToken?.() ?? null,
  }, {
    sessionId: matchStart.sessionId,
    sessionToken: matchStart.sessionToken ?? '',
  });
  if (!onlineBootstrapState || onlineBootstrapState.sessionId !== matchStart.sessionId) {
    return;
  }
  if (!iceConfig) {
    clearOnlineSessionHeartbeat();
    onlineBootstrapState = {
      ...onlineBootstrapState,
      status: 'failed',
      connectionPath: 'server',
      statusDetail: 'ICE configuration is unavailable. The match was not started because the process-local frame relay is not an alpha-safe fallback.',
      iceConfig: null,
    };
    renderOnlineBootstrapPanel();
    return;
  }
  if (runtimeConfig.environment !== 'development' && !iceConfig.relayAvailable) {
    clearOnlineSessionHeartbeat();
    onlineBootstrapState = {
      ...onlineBootstrapState,
      status: 'failed',
      connectionPath: 'relay',
      statusDetail: 'TURN relay is not configured. Staging and production refuse to start an online match without NAT fallback.',
      iceConfig,
    };
    renderOnlineBootstrapPanel();
    return;
  }

  onlineBootstrapState = {
    ...onlineBootstrapState,
    status: 'awaiting_signaling',
    connectionPath: requestedConnectionPath,
    statusDetail: 'Exchanging authenticated WebRTC signaling and opening the reliable gameplay channel.',
    iceConfig,
  };
  renderOnlineBootstrapPanel();

  let activeTransportAttempt = matchStart.transportAttempt;
  let activeIceConfig = iceConfig;
  let activeConnectTimeoutMs = Math.max(12_000, iceConfig.directConnectTimeoutMs * 3);
  const connectFreshWebRtcSession = () => connectWebRtcSession({
    transportAttemptId: activeTransportAttempt.attemptId,
    localAccountId: matchStart.localPlayer.accountId,
    remoteAccountId: matchStart.peer.accountId,
    initiator: matchStart.localPlayer.side === 'P1',
    rtcConfiguration: buildRtcConfiguration(activeIceConfig, requestedConnectionPath),
    signalTransport: {
      publish: (signal) => publishOnlineSessionSignal(
        matchStart,
        activeTransportAttempt.attemptId,
        signal,
      ),
      poll: (afterSignalId) => pollOnlineSessionSignals(
        matchStart,
        activeTransportAttempt.attemptId,
        afterSignalId,
      ),
    },
    connectTimeoutMs: activeConnectTimeoutMs,
  });
  let bootstrapRtcSession: Awaited<ReturnType<typeof connectWebRtcSession>> | null = null;
  let bootstrapTransport: RecoverableWebRtcTransport | null = null;
  try {
    const rtcSession = await connectFreshWebRtcSession();
    bootstrapRtcSession = rtcSession;
    if (!onlineBootstrapState || onlineBootstrapState.sessionId !== matchStart.sessionId) {
      rtcSession.close();
      return;
    }

    let matchContext: OnlineMatchContext | null = null;
    let pendingRecoveryCheckpoint: WebRtcRecoveryCheckpoint | null = null;
    let pendingRecoveryAgreedThrough: number | null = null;
    const recoveryTransport = new RecoverableWebRtcTransport({
      initialSession: rtcSession,
      localAccountId: matchStart.localPlayer.accountId,
      remoteAccountId: matchStart.peer.accountId,
      connect: connectFreshWebRtcSession,
      prepareRecovery: async () => {
        if (!matchContext || onlineMatchContext !== matchContext) {
          throw new Error('Online match context ended before transport recovery could start.');
        }
        if (matchContext.finalOutcome) {
          throw new Error(matchContext.statusText);
        }
        const checkpoint = createOnlineRecoveryCheckpoint(
          matchContext,
          activeTransportAttempt.attemptId,
        );
        matchContext.smokeRecovery?.markCheckpointPrepared(
          checkpoint.roundEpoch,
          checkpoint.confirmedThrough,
        );
        const reconnectGraceSeconds = Number(matchStart.reconnectGraceSeconds ?? 20);
        if (!Number.isFinite(reconnectGraceSeconds) || reconnectGraceSeconds < 9) {
          throw new Error('Server reconnect grace is too short for safe WebRTC recovery.');
        }
        clearOnlineSessionHeartbeat();
        await requestOnlineJson<MatchSessionView>(
          'POST',
          '/matchmaking/sessions/disconnect',
          matchStart.localPlayer.accountId,
          { sessionId: matchStart.sessionId },
        );
        activeTransportAttempt = await prepareNextOnlineTransportAttempt(
          matchStart,
          activeTransportAttempt,
        );
        matchContext.transportAttemptGeneration = activeTransportAttempt.generation;
        const refreshedIceConfig = await fetchMatchmakingIceConfig(
          matchmakingApiBase,
          localRankedRootSmokeConfig.forceRelay,
          {
          accountId: matchStart.localPlayer.accountId,
          accessToken: platform.auth.getAccessToken?.() ?? null,
        }, {
          sessionId: matchStart.sessionId,
          sessionToken: matchStart.sessionToken,
        });
        if (!refreshedIceConfig) {
          throw new Error('ICE configuration could not be refreshed for WebRTC recovery.');
        }
        if (runtimeConfig.environment !== 'development' && !refreshedIceConfig.relayAvailable) {
          throw new Error('TURN relay is unavailable during WebRTC recovery.');
        }
        activeIceConfig = refreshedIceConfig;
        matchContext.smokeRecovery?.markAttemptAdvanced({
          generation: activeTransportAttempt.generation,
          relayAvailable: refreshedIceConfig.relayAvailable,
          iceTransportPolicy: refreshedIceConfig.iceTransportPolicy,
        });
        activeConnectTimeoutMs = Math.min(
          Math.max(5_000, refreshedIceConfig.directConnectTimeoutMs * 3),
          Math.floor((reconnectGraceSeconds - 5) * 1_000),
        );
        pendingRecoveryCheckpoint = {
          ...checkpoint,
          transportAttemptId: activeTransportAttempt.attemptId,
        };
      },
      validateReplacement: async (session) => {
        if (!pendingRecoveryCheckpoint) {
          throw new Error('Recovery checkpoint was not prepared for the replacement channel.');
        }
        const agreement = await exchangeWebRtcRecoveryCheckpoint(
          session.channel,
          pendingRecoveryCheckpoint,
          {
            resolveStateChecksum: (confirmedThrough) => (
              rollbackSession?.getRecoveryCheckpointChecksum(confirmedThrough) ?? null
            ),
            onCheckpointAgreed: async () => {
              await requestOnlineSessionReconnect({
                sessionId: matchStart.sessionId,
                sessionToken: matchStart.sessionToken,
                localAccountId: matchStart.localPlayer.accountId,
                intervalMs: resolveHeartbeatIntervalMs(matchStart),
              });
            },
          },
        );
        if (!matchContext || onlineMatchContext !== matchContext) {
          throw new Error('Online match context ended during recovery checkpoint agreement.');
        }
        pendingRecoveryAgreedThrough = agreement.confirmedThrough;
        startOnlineSessionHeartbeat(matchStart);
      },
      maxAttempts: 1,
      maxRecoveries: 1,
      frameTransport: { maxFramesPerBatch: 30 },
      onStateChange: (snapshot: WebRtcRecoverySnapshot) => {
        if (!matchContext || onlineMatchContext !== matchContext) {
          return;
        }
        if (snapshot.state === 'reconnecting') {
          const attempt = Math.max(1, snapshot.attempt);
          matchContext.statusText = `WebRTC interrupted. Re-signaling attempt ${attempt}/${snapshot.maxAttempts}; simulation paused.`;
          accumulator = 0;
        }
      },
      onRecovered: (session) => {
        if (!matchContext || onlineMatchContext !== matchContext) {
          return;
        }
        matchContext.inputPump.resumeAfterTransportRecovery();
        const agreedThrough = pendingRecoveryAgreedThrough;
        pendingRecoveryCheckpoint = null;
        pendingRecoveryAgreedThrough = null;
        matchContext.connectionPath = session.connectionPath;
        matchContext.iceTransportPolicy = activeIceConfig.iceTransportPolicy;
        matchContext.relayAvailable = activeIceConfig.relayAvailable;
        matchContext.turnCredentialMode = activeIceConfig.turnCredentialMode;
        matchContext.smokeRecovery?.markRecovered({
          generation: matchContext.transportAttemptGeneration,
          roundEpoch: matchContext.roundEpoch,
          agreedThrough: agreedThrough ?? -1,
          connectionPath: session.connectionPath,
          relayAvailable: activeIceConfig.relayAvailable,
          iceTransportPolicy: activeIceConfig.iceTransportPolicy,
        });
        matchContext.statusText = `WebRTC ${session.connectionPath} path recovered from confirmed frame ${agreedThrough ?? 'unknown'}. The outbound tail is resynchronizing.`;
        matchContext.sendAccumulatorSeconds = 0.05;
        matchContext.pollAccumulatorSeconds = 0.05;
        onlineDiagnosticsUpdate = {
          ...onlineDiagnosticsUpdate,
          connectionPath: session.connectionPath,
        };
      },
      onTerminalFailure: (error) => {
        if (!matchContext || onlineMatchContext !== matchContext) {
          return;
        }
        if (matchContext.finalOutcome) {
          return;
        }
        matchContext.smokeRecovery?.markFailed(error);
        void requestOnlineJson<MatchSessionView>(
          'POST',
          '/matchmaking/sessions/disconnect',
          matchStart.localPlayer.accountId,
          { sessionId: matchStart.sessionId },
          { keepalive: true },
        ).catch(() => undefined);
        interruptOnlineMatch(matchContext, error.message);
      },
    });
    bootstrapTransport = recoveryTransport;
    bootstrapRtcSession = null;
    const closeTransport = (): void => recoveryTransport.close();
    onlineBootstrapState = {
      ...onlineBootstrapState,
      connectionPath: rtcSession.connectionPath,
      statusDetail: `Reliable WebRTC ${rtcSession.connectionPath} path established. Entering synchronized match.`,
    };
    onlineDiagnosticsUpdate = {
      ...onlineDiagnosticsUpdate,
      connectionPath: rtcSession.connectionPath,
    };
    void requestOnlineJson(
      'POST',
      '/matchmaking/network/connection-telemetry',
      matchStart.localPlayer.accountId,
      {
        sessionId: matchStart.sessionId,
        queueType: matchStart.queueType,
        region: matchStart.region,
        connectionPath: rtcSession.connectionPath,
        transport: 'webrtc',
      },
    ).catch(() => undefined);
    renderOnlineBootstrapPanel();
    matchContext = beginOnlineMatch(
      matchStart,
      recoveryTransport,
      rtcSession.connectionPath,
      activeIceConfig,
      closeTransport,
    );
    bootstrapTransport = null;
  } catch (error) {
    bootstrapTransport?.close();
    bootstrapRtcSession?.close();
    if (!onlineBootstrapState || onlineBootstrapState.sessionId !== matchStart.sessionId) {
      return;
    }
    clearOnlineSessionHeartbeat();
    onlineBootstrapState = {
      ...onlineBootstrapState,
      status: 'failed',
      statusDetail: error instanceof Error
        ? `WebRTC bootstrap failed: ${error.message}`
        : 'WebRTC bootstrap failed.',
    };
    renderOnlineBootstrapPanel();
  }
}

function openOnlineDevMenu(section?: OnlineDevMenuTarget): void {
  if (!onlineDevMenu) {
    return;
  }
  leaveActiveOnlineSessionBeforeTeardown();
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
    correctionEventCount: snapshot.correctionEvents.length,
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
    seed: state.seed,
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
    schemaVersion: 'gw.training-telemetry-export.v3',
    exportedAt: summary.exportedAt,
    rulesetVersion: summary.rulesetVersion,
    balanceProfileId: summary.balanceProfileId,
    tuningFingerprint: fingerprintBalanceTuning(state.tuning),
    roundStartTuningFingerprint: roundTuningFingerprint,
    tuningChangedDuringRun: false,
    balanceTuningPending: balanceTuningDirty,
    tuning: { ...state.tuning },
    pendingBalanceProfileId: localBalanceProfileId,
    pendingTuningFingerprint: fingerprintBalanceTuning(localBalanceTuningDraft),
    pendingTuning: { ...localBalanceTuningDraft },
    characterBalanceFingerprint: fingerprintCharacterBalanceOverrides(
      state.characterBalanceOverrides,
    ),
    roundStartCharacterBalanceFingerprint: roundCharacterBalanceFingerprint,
    characterBalanceChangedDuringRun: false,
    characterBalancePending: characterBalanceDirty,
    characterBalanceOverrides: cloneCharacterBalanceOverrides(state.characterBalanceOverrides),
    pendingCharacterBalanceOverrides: cloneCharacterBalanceOverrides(localCharacterBalanceOverrides),
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

async function exportAiMatchTelemetrySession(): Promise<string> {
  const { buildBalanceLabFlowModel } = await import('./sim/balanceLab');
  const exportedAt = new Date().toISOString();
  const summary = matchTelemetry.toSummary();
  const snapshot = getRenderSnapshot(state);
  const payload: StoredAiMatchTelemetryEntry = {
    schemaVersion: 'gw.ai-match-telemetry-export.v8',
    exportedAt,
    mode: 'cpu_vs_cpu',
    rulesetVersion: getRuntimeRulesetVersion(),
    balanceProfileId: runtimeBalanceProfileId,
    tuningFingerprint: fingerprintBalanceTuning(state.tuning),
    roundStartTuningFingerprint: roundTuningFingerprint,
    tuningChangedDuringRun: false,
    balanceTuningPending: balanceTuningDirty,
    tuning: { ...state.tuning },
    pendingBalanceProfileId: localBalanceProfileId,
    pendingTuningFingerprint: fingerprintBalanceTuning(localBalanceTuningDraft),
    pendingTuning: { ...localBalanceTuningDraft },
    characterBalanceFingerprint: fingerprintCharacterBalanceOverrides(
      state.characterBalanceOverrides,
    ),
    roundStartCharacterBalanceFingerprint: roundCharacterBalanceFingerprint,
    characterBalanceChangedDuringRun: false,
    characterBalancePending: characterBalanceDirty,
    characterBalanceOverrides: cloneCharacterBalanceOverrides(state.characterBalanceOverrides),
    pendingCharacterBalanceOverrides: cloneCharacterBalanceOverrides(localCharacterBalanceOverrides),
    aiBehaviorFingerprint: fingerprintAiBehaviorTuning(activeAiBehaviorTuning),
    roundStartAiBehaviorFingerprint: roundAiBehaviorFingerprint,
    aiBehaviorChangedDuringRun: false,
    aiBehaviorPending: aiBehaviorDirty,
    aiBehaviorTuning: sanitiseAiBehaviorTuning(activeAiBehaviorTuning),
    pendingAiBehaviorFingerprint: fingerprintAiBehaviorTuning(localAiBehaviorTuning),
    pendingAiBehaviorTuning: sanitiseAiBehaviorTuning(localAiBehaviorTuning),
    aiControllerRoleSchemaVersion: AI_CONTROLLER_ROLE_SCHEMA_VERSION,
    aiControllerRolesFingerprint: fingerprintAiControllerRoles(activeAiControllerRoles),
    aiControllerRoles: sanitiseAiControllerRoles(activeAiControllerRoles),
    aiControllerRolesPending: aiControllerRolesDirty,
    pendingAiControllerRolesFingerprint: fingerprintAiControllerRoles(
      selectLocalAiControllerRoles(selectedMode, onlineMatchContext !== null, localAiControllerRoles),
    ),
    pendingAiControllerRoles: selectLocalAiControllerRoles(
      selectedMode,
      onlineMatchContext !== null,
      localAiControllerRoles,
    ),
    aiDifficulty: selectedAiDifficulty,
    scenario: getCurrentBalanceScenarioIdentity(),
    menuThemeId: selectedMenuThemeId,
    stageAtmosphereId: selectedStageAtmosphereId,
    seed: state.seed,
    matchSeed: selectedMatchSeed,
    roundSeed: state.seed,
    roundIndex: offlineRoundIndex,
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
    aiDecisions: aiDecisionTelemetry.toSummary(),
    flow: buildBalanceLabFlowModel(summary),
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

function restartBalanceLabMatch(targetFrames?: number): void {
  if (
    onlineMatchContext !== null
    || !isLocalBalanceLabMode(selectedMode)
  ) {
    return;
  }
  if (selectedMode === 'training') {
    trainingTelemetry.endRound('manual_restart');
  }
  p1RoundWins = 0;
  p2RoundWins = 0;
  roundTransitionRemaining = 0;
  resetRoundState();
  balanceLabSampleTargetFrames = typeof targetFrames === 'number'
    && Number.isFinite(targetFrames)
    && targetFrames > 0
    ? Math.floor(targetFrames)
    : null;
  appPhase = 'playing';
  startMenu.hideRoundBanner();
  startMenu.hideHome();
  hudRoot.style.visibility = 'visible';
  syncTrainingFrameDataVisibility();
  accumulator = 0;
}

async function reviewCurrentAiRound(request?: {
  focusFrame: number;
  endFrame?: number;
  label: string;
}): Promise<boolean> {
  if (
    !isLocalAiRoundReviewMode(selectedMode)
    || onlineMatchContext !== null
    || (appPhase !== 'playing' && appPhase !== 'round_transition')
  ) {
    return false;
  }
  const payload = liveAiRoundReplayRecorder?.buildPayload() ?? latestAiRoundReplayPayload;
  if (!payload) {
    return false;
  }
  const returnPhase = appPhase;
  const recordedRound = payload.rounds?.[0]?.round ?? offlineRoundIndex + 1;
  const reviewFocus: ReplayReviewFocus | undefined = request
    ? {
        schemaVersion: 'gw.replay-focus.v1',
        source: 'balance_lab_exchange',
        label: request.label,
        focusFrame: Math.max(0, Math.floor(request.focusFrame)),
        endFrame: request.endFrame === undefined
          ? undefined
          : Math.max(0, Math.floor(request.endFrame)),
      }
    : undefined;
  return await beginReplayReviewFromPayload(
    payload,
    selectedMode === 'cpu_vs_cpu'
      ? `Live AI vs AI round ${recordedRound}`
      : selectedMode === 'balance_sparring'
        ? `Live Balance Sparring round ${recordedRound}`
        : `Live AI sparring round ${recordedRound}`,
    true,
    returnPhase,
    reviewFocus,
  );
}

async function reviewCapturedAiReplaySample(
  payload: ReplayPayload,
  request: {
    focusFrame: number;
    endFrame?: number;
    label: string;
  },
  label: string,
): Promise<boolean> {
  if (
    (selectedMode !== 'cpu_vs_cpu' && selectedMode !== 'balance_sparring')
    || onlineMatchContext !== null
    || (appPhase !== 'playing' && appPhase !== 'round_transition')
  ) {
    return false;
  }
  const returnPhase = appPhase;
  const reviewFocus: ReplayReviewFocus = {
    schemaVersion: 'gw.replay-focus.v1',
    source: 'balance_lab_incident_comparison',
    label: request.label,
    focusFrame: Math.max(0, Math.floor(request.focusFrame)),
    endFrame: request.endFrame === undefined
      ? undefined
      : Math.max(0, Math.floor(request.endFrame)),
  };
  return await beginReplayReviewFromPayload(
    payload,
    label,
    true,
    returnPhase,
    reviewFocus,
  );
}

function beginReplayReview(
  review: ReplayReviewData,
  sourceLabel: string,
  initialFrame = 0,
  returnPhase: ReplayReturnPhase = 'home',
): void {
  replayReviewData = review;
  replayReviewSourceLabel = sourceLabel;
  replayReturnPhase = returnPhase;
  replayFrameIndex = Math.max(0, Math.min(review.totalFrames - 1, Math.floor(initialFrame)));
  replayAccumulator = 0;
  replayPaused = true;
  replaySpeedIndex = replaySpeedOptions.indexOf(1);
  if (replaySpeedIndex < 0) {
    replaySpeedIndex = 0;
  }

  appPhase = 'replay_review';
  hud.setControlsVisible(true);
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
  const initialSnapshot = replayReviewData.frames[replayFrameIndex]?.snapshot;
  if (initialSnapshot) {
    sceneContext.cameraPlayerTracks.P1.set(initialSnapshot.players.P1.pos.x, initialSnapshot.players.P1.pos.y);
    sceneContext.cameraPlayerTracks.P2.set(initialSnapshot.players.P2.pos.x, initialSnapshot.players.P2.pos.y);
    sceneContext.launchCameraActive = false;
  }
}

async function beginReplayReviewFromPayload(
  payloadRaw: unknown,
  sourceLabel: string,
  requireChecksums = false,
  returnPhase: ReplayReturnPhase = 'home',
  reviewFocusOverride?: ReplayReviewFocus,
): Promise<boolean> {
  const validation = validateReplayPayload(payloadRaw);
  if (validation.ok === false) {
    console.error('[replay-review] invalid replay payload', sourceLabel, validation.error);
    return false;
  }

  if (requireChecksums && !validation.payload.expectedChecksums) {
    console.error('[replay-review] local replay is missing deterministic checksums', sourceLabel);
    return false;
  }

  if (validation.payload.expectedChecksums) {
    const mismatch = findFirstChecksumMismatch(
      runReplay(validation.payload).checksums,
      validation.payload.expectedChecksums,
    );
    if (mismatch) {
      console.error('[replay-review] deterministic checksum mismatch', sourceLabel, mismatch);
      return false;
    }
  }

  const focus = reviewFocusOverride ?? validation.payload.header.reviewFocus;
  const focusedSourceLabel = focus ? `${sourceLabel} | ${focus.label}` : sourceLabel;
  const reviewPayload = reviewFocusOverride
    ? {
        ...validation.payload,
        header: {
          ...validation.payload.header,
          reviewFocus: reviewFocusOverride,
        },
      }
    : validation.payload;
  const { buildReplayReviewData } = await import('./sim/replayReview');
  beginReplayReview(
    buildReplayReviewData(reviewPayload),
    focusedSourceLabel,
    focus?.focusFrame ?? 0,
    returnPhase,
  );
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

  await beginReplayReviewFromPayload(payloadRaw, fileName);
}

function exitReplayReview(): void {
  if (appPhase !== 'replay_review') {
    return;
  }
  const returnPhase = replayReturnPhase;
  replayViewer.hide();
  replayReviewData = null;
  replayFrameIndex = 0;
  replayAccumulator = 0;
  replayPaused = true;
  replayReviewSourceLabel = '';
  replayReturnPhase = 'home';
  if (returnPhase === 'home') {
    returnToHome();
    return;
  }

  appPhase = returnPhase;
  pauseMenu.setCanRestartTraining(selectedMode === 'training');
  startMenu.hideHome();
  if (returnPhase === 'round_transition' && state.winner) {
    if (selectedMode === 'arcade' && arcadeRun) {
      const stage = getCurrentArcadeStage(arcadeRun);
      startMenu.showRoundBanner(state.winner, `${stage.label} | ${getRoundScoreText()}`);
    } else {
      startMenu.showRoundBanner(state.winner, getRoundScoreText());
    }
  } else {
    startMenu.hideRoundBanner();
  }
  hudRoot.style.visibility = 'visible';
  syncTrainingFrameDataVisibility();
  hud.setRollbackDiagnosticsVisible(debugHudEnabled);
  hud.updateRollbackDiagnostics(debugHudEnabled && rollbackSession
    ? getRollbackDiagnosticsView(rollbackSession)
    : null);
  hud.setInputHistoryVisible(shouldShowLiveInputHistory());
  hud.setMatchTelemetryVisible(shouldShowLiveMatchTelemetry());
  hud.updateMatchTelemetry(shouldShowLiveMatchTelemetry() ? matchTelemetry.toSummary() : null);
  sceneContext.cameraPlayerTracks.P1.set(state.players.P1.pos.x, state.players.P1.pos.y);
  sceneContext.cameraPlayerTracks.P2.set(state.players.P2.pos.x, state.players.P2.pos.y);
  sceneContext.launchCameraActive = false;
  pauseMenu.setPaused(true);
  accumulator = 0;
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

function getBalanceLabSampleProgressText(): string {
  if (balanceLabSampleTargetFrames === null) {
    return '';
  }
  const completedFrames = Math.min(simulationFrame, balanceLabSampleTargetFrames);
  return ` | Matched sample ${(completedFrames * fixedDt).toFixed(1)}/${(balanceLabSampleTargetFrames * fixedDt).toFixed(1)}s`;
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
    const recovery = onlineMatchContext.transportRecovery.getSnapshot();
    const recoveryLine = recovery.state === 'reconnecting'
      ? ` | Reconnecting ${Math.max(1, recovery.attempt)}/${recovery.maxAttempts}`
      : '';
    matchInfo.textContent = `Online ${onlineMatchContext.queueType} | ${onlineMatchContext.region} | WebRTC ${onlineMatchContext.connectionPath}${recoveryLine} | ${getRoundScoreText()}`;
    return;
  }

  if (selectedMode === 'endless') {
    matchInfo.textContent = 'Mode: AI Sparring | Endless';
    return;
  }

  if (selectedMode === 'cpu_vs_cpu') {
    const testRecipeId = getBalanceTestRecipeSelectionId(
      activeBalanceScenarioId,
      activeAiControllerRoles,
    );
    const testRecipe = findBalanceTestRecipeForSetup(
      activeBalanceScenarioId,
      activeAiControllerRoles,
    );
    const configurationLabel = testRecipeId !== 'custom'
      && testRecipeId !== DEFAULT_BALANCE_TEST_RECIPE_ID
      ? ` | Probe: ${testRecipe?.label ?? testRecipeId}`
      : testRecipeId === 'custom'
        ? ` | Custom: ${formatAiControllerRoles(activeAiControllerRoles)} / ${resolveBalanceScenario(activeBalanceScenarioId).label}`
        : '';
    matchInfo.textContent = `Mode: AI vs AI | ${getRoundScoreText()} | ${selectedAiDifficulty}${configurationLabel} | Round ${offlineRoundIndex + 1} seed ${state.seed}${getBalanceLabSampleProgressText()}`;
    return;
  }

  if (selectedMode === 'balance_sparring') {
    const scenario = resolveBalanceScenario(activeBalanceScenarioId);
    const testRecipe = findBalanceTestRecipeForSetup(
      activeBalanceScenarioId,
      activeAiControllerRoles,
    );
    matchInfo.textContent = `Mode: Balance Sparring | P1 Human vs P2 ${selectedAiDifficulty} AI | Probe: ${testRecipe?.label ?? 'Custom'} | ${scenario.label} | Round ${offlineRoundIndex + 1} seed ${state.seed}${getBalanceLabSampleProgressText()}`;
    return;
  }

  if (selectedMode === 'training') {
    matchInfo.textContent = `Mode: Training${getBalanceLabSampleProgressText()}`;
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

  matchInfo.textContent = `Mode: AI Sparring | Best of 3 | ${getRoundScoreText()}`;
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

function beginOnlineRoundResolution(context: OnlineMatchContext, winner: PlayerId): void {
  if (context.pendingRoundWinner) {
    return;
  }
  const winningFrame = rollbackSession?.getWinningFrame() ?? null;
  context.pendingRoundWinner = winningFrame?.winner ?? winner;
  context.pendingRoundFinalFrame = winningFrame?.frame ?? Math.max(0, simulationFrame - 1);
  context.roundSyncElapsedSeconds = 0;
  context.statusText = `Synchronizing round ${context.roundEpoch + 1} through frame ${context.pendingRoundFinalFrame}.`;
  appPhase = 'round_transition';
  roundTransitionRemaining = 0;
  startMenu.showRoundBanner(winner, 'Verifying decisive frame with peer');
}

function onRoundWin(winner: PlayerId): void {
  if (onlineMatchContext) {
    beginOnlineRoundResolution(onlineMatchContext, winner);
    return;
  }
  commitRoundWin(winner);
}

function commitRoundWin(winner: PlayerId): void {
  if (selectedMode === 'training') {
    restartTrainingRound('round_win');
    return;
  }

  if (selectedMode === 'endless' || selectedMode === 'balance_sparring') {
    appPhase = 'round_transition';
    roundTransitionRemaining = 0.5;
    startMenu.showRoundBanner(
      winner,
      selectedMode === 'balance_sparring'
        ? 'Balance Sparring continues with the active local rules'
        : 'Endless mode continues',
    );
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
      onlineMatchContext.replayStatus = 'ready';
      onlineMatchContext.replayDetail = `${onlineMatchContext.replayRecorder.roundCount} canonical rounds are ready to persist.`;
      renderOnlineMatchOverScreen(onlineMatchContext, winner, p1RoundWins, p2RoundWins);
      void completeOnlineSession(onlineMatchContext);
      if (onlineMatchContext.queueType === 'ranked') {
        void submitOnlineRankedResult(onlineMatchContext);
      } else {
        void persistOnlineMatchReplay(onlineMatchContext);
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

function requestGameplayPauseToggle(): void {
  const decision = resolveGameplayPauseRequest(onlineMatchContext !== null);
  if (decision.forceUnpaused) {
    pauseMenu.setPaused(false);
  }
  if (decision.togglePause) {
    pauseMenu.toggle();
  }
  if (decision.resetAccumulator) {
    accumulator = 0;
  }
  if (decision.statusText && onlineMatchContext) {
    onlineMatchContext.statusText = decision.statusText;
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
    requestGameplayPauseToggle();
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

function updateOnlineRoundResolution(
  context: OnlineMatchContext,
  elapsedSeconds: number,
): boolean {
  let finalFrame = context.pendingRoundFinalFrame;
  if (!context.pendingRoundWinner || finalFrame === null) {
    return false;
  }

  context.roundSyncElapsedSeconds += elapsedSeconds;
  if (rollbackSession) {
    recordPendingRankedRemoteInputs(context, Math.max(0, simulationFrame - 1));
    const remoteInputBatch = applyPendingRemoteInputs(
      context.inputPump.getPendingRemoteInputs(),
      rollbackSession,
      Math.max(0, simulationFrame - 1),
    );
    if (
      remoteInputBatch.conflictingFrames.length > 0
      || remoteInputBatch.tooLateFrames.length > 0
    ) {
      interruptOnlineMatch(
        context,
        'The decisive frame could not be verified within rollback history.',
      );
      return true;
    }
    recordOnlineRollbackEvidence(context, remoteInputBatch.rollbackFrames);
    state = rollbackSession.getStateSnapshot();
    try {
      recordSynchronizedOnlineReplayFrames(context, rollbackSession);
    } catch (error) {
      context.replayStatus = 'failed';
      context.replayDetail = error instanceof Error ? error.message : 'Online replay synchronization failed.';
      interruptOnlineMatch(context, context.replayDetail);
      return true;
    }
  }

  const winningFrame = rollbackSession?.getWinningFrame() ?? null;
  if (!state.winner || (rollbackSession && !winningFrame)) {
    context.pendingRoundWinner = null;
    context.pendingRoundFinalFrame = null;
    context.roundSyncElapsedSeconds = 0;
    context.statusText = 'Predicted round result was corrected. Match resumed.';
    startMenu.hideRoundBanner();
    appPhase = 'playing';
    accumulator = 0;
    return true;
  }

  const resolvedWinner = winningFrame?.winner ?? state.winner;
  const resolvedFinalFrame = winningFrame?.frame ?? finalFrame;
  if (
    resolvedWinner !== context.pendingRoundWinner
    || resolvedFinalFrame !== context.pendingRoundFinalFrame
  ) {
    context.pendingRoundWinner = resolvedWinner;
    context.pendingRoundFinalFrame = resolvedFinalFrame;
    finalFrame = resolvedFinalFrame;
    startMenu.showRoundBanner(resolvedWinner, 'Corrected result; verifying with peer');
  }

  if (context.inputPump.isSynchronizedThrough(finalFrame)) {
    const confirmedWinner = context.pendingRoundWinner;
    try {
      context.rankedProofRecorder?.finalizeRound(
        context.roundEpoch,
        finalFrame,
        confirmedWinner,
        winningFrame?.checksum ?? computeStateChecksum(state),
      );
      context.replayRecorder.finalizeRound(
        context.roundEpoch,
        finalFrame,
        confirmedWinner,
      );
    } catch (error) {
      context.replayStatus = 'failed';
      context.replayDetail = error instanceof Error
        ? error.message
        : 'Round evidence finalization failed.';
      interruptOnlineMatch(
        context,
        error instanceof Error
          ? `Round evidence finalization failed: ${error.message}`
          : 'Round evidence finalization failed.',
      );
      return true;
    }
    context.pendingRoundWinner = null;
    context.pendingRoundFinalFrame = null;
    context.roundSyncElapsedSeconds = 0;
    context.statusText = `Round ${context.roundEpoch + 1} confirmed through frame ${finalFrame}.`;
    commitRoundWin(confirmedWinner);
    return true;
  }

  if (context.roundSyncElapsedSeconds >= 10) {
    const diagnostics = context.inputPump.getDiagnostics();
    interruptOnlineMatch(
      context,
      `Round synchronization timed out at frame ${finalFrame} (remote ${diagnostics.contiguousRemoteFrame}, peer confirmation ${diagnostics.peerConfirmedThrough}).`,
    );
  }
  return true;
}

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
    requestGameplayPauseToggle();
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

  const onlineTransportReconnecting = onlineMatchContext?.transportRecovery.getSnapshot().state
    === 'reconnecting';
  const localRankedRecoveryHolding = onlineMatchContext?.smokeRecovery?.isHoldingBeforeRecovery()
    ?? false;
  const onlineSimulationPaused = onlineTransportReconnecting || localRankedRecoveryHolding;
  const simulationElapsedSeconds = localRankedRootSmokeConfig.enabled && onlineMatchContext
    ? elapsedSeconds * localRankedRootSmokeConfig.simulationRate
    : elapsedSeconds;
  if (!pauseMenu.isPaused() && appPhase === 'playing' && !onlineSimulationPaused) {
    accumulator = Math.min(accumulator + simulationElapsedSeconds, maxAccumulatedTime);
  } else {
    accumulator = 0;
  }

  if (!pauseMenu.isPaused() && appPhase === 'playing' && !onlineSimulationPaused) {
    while (accumulator >= fixedDt) {
      const frameInputRaw = input.getFrameInput();
      if (onlineMatchContext) {
        let localInput: PlayerFrameInput;
        try {
          localInput = localRankedSmokeInputDriver
            ? localRankedSmokeInputDriver.nextLocalInput(
              simulationFrame,
              onlineMatchContext.localPlayerId,
            )
            : cloneOnlinePlayerInput(
              onlineMatchContext.localPlayerId === 'P1' ? frameInputRaw.p1 : frameInputRaw.p2,
            );
          onlineMatchContext.inputPump.enqueueLocalInput(simulationFrame, localInput);
        } catch (error) {
          interruptOnlineMatch(
            onlineMatchContext,
            error instanceof Error
              ? `Live input queue failed: ${error.message}`
              : 'Live input queue failed.',
          );
          accumulator = 0;
          break;
        }
        const resolvedOnlineFrameInput = onlineMatchContext.localPlayerId === 'P1'
          ? { p1: localInput, p2: createEmptyPlayerInput() }
          : { p1: createEmptyPlayerInput(), p2: localInput };
        onlineMatchContext.rankedProofRecorder?.recordInput(
          onlineMatchContext.roundEpoch,
          simulationFrame,
          onlineMatchContext.localPlayerId,
          localInput,
        );
        if (rollbackSession) {
          recordPendingRankedRemoteInputs(onlineMatchContext, simulationFrame);
          const remoteInputBatch = applyPendingRemoteInputs(
            onlineMatchContext.inputPump.getPendingRemoteInputs(),
            rollbackSession,
            simulationFrame,
          );
          onlineMatchContext.smokeRecovery?.recordRejectedInputs(
            remoteInputBatch.conflictingFrames.length,
            remoteInputBatch.tooLateFrames.length,
          );
          if (
            remoteInputBatch.conflictingFrames.length > 0
            || remoteInputBatch.tooLateFrames.length > 0
          ) {
            const rejectedFrames = [
              ...remoteInputBatch.conflictingFrames.map((frame) => `conflict ${frame}`),
              ...remoteInputBatch.tooLateFrames.map((frame) => `too late ${frame}`),
            ].join(', ');
            interruptOnlineMatch(
              onlineMatchContext,
              `Authoritative input could not be applied (${rejectedFrames}).`,
            );
            accumulator = 0;
            break;
          }
          const rollbackResult = rollbackSession.advanceFrame({
            localInput,
          });
          const rollbackFrames = remoteInputBatch.rollbackFrames + rollbackResult.rollbackFrames;
          recordOnlineRollbackEvidence(onlineMatchContext, rollbackFrames);
          if (runtimeConfig.features.debugToolsEnabled && rollbackFrames > 0) {
            console.info('[rollback] online correction', {
              frame: rollbackResult.frame,
              authoritativeFrames: remoteInputBatch.appliedFrames,
              rollbackFrames,
            });
          }
          if (runtimeConfig.features.debugToolsEnabled) {
            const correctionEvents = rollbackSession.drainPendingCorrectionEvents();
            for (const event of correctionEvents) {
              console.info('[rollback] online state correction', event);
            }
          }
          state = rollbackSession.getStateSnapshot();
          try {
            recordSynchronizedOnlineReplayFrames(onlineMatchContext, rollbackSession);
          } catch (error) {
            onlineMatchContext.replayStatus = 'failed';
            onlineMatchContext.replayDetail = error instanceof Error
              ? error.message
              : 'Online replay synchronization failed.';
            interruptOnlineMatch(onlineMatchContext, onlineMatchContext.replayDetail);
            accumulator = 0;
            break;
          }
        } else {
          const pendingRemoteInputs = onlineMatchContext.inputPump.getPendingRemoteInputs();
          const remoteInput = pendingRemoteInputs.get(simulationFrame) ?? null;
          if (remoteInput) {
            pendingRemoteInputs.delete(simulationFrame);
            if (onlineMatchContext.localPlayerId === 'P1') {
              resolvedOnlineFrameInput.p2 = remoteInput;
            } else {
              resolvedOnlineFrameInput.p1 = remoteInput;
            }
          }
          step(state, resolvedOnlineFrameInput, fixedDt);
        }
        // Online metrics stay disabled until frame observations can be replaced after rollback.
      } else {
        let frameInput = frameInputRaw;
        const aiDecisions: Partial<Record<PlayerId, AiDecisionTrace>> = {};
        const p1AiController = aiControllers.P1;
        const p2AiController = aiControllers.P2;
        if (p1AiController || p2AiController) {
          const p1Input = p1AiController
            ? (() => {
              const aiTick = tickAiControllerWithRole(
                state,
                'P1',
                p1AiController,
                activeAiControllerRoles.P1,
              );
              aiControllers.P1 = aiTick.next;
              aiDecisions.P1 = aiTick.decision;
              return aiTick.input;
            })()
            : frameInputRaw.p1;
          const p2Input = p2AiController
            ? (() => {
              const aiTick = tickAiControllerWithRole(
                state,
                'P2',
                p2AiController,
                activeAiControllerRoles.P2,
              );
              aiControllers.P2 = aiTick.next;
              aiDecisions.P2 = aiTick.decision;
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
        let acceptedActionStarts: SimulationActionStart[] | undefined;
        let launchClashes: SimulationLaunchClash[] | undefined;
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
            const correctionEvents = rollbackSession.drainPendingCorrectionEvents();
            for (const event of correctionEvents) {
              console.info('[rollback] state correction', event);
            }
          }
          state = rollbackSession.getStateSnapshot();
        } else {
          acceptedActionStarts = [];
          launchClashes = [];
          step(state, frameInput, fixedDt, {
            onActionStart: (event) => acceptedActionStarts?.push(event),
            onLaunchClash: (event) => launchClashes?.push(event),
          });
        }
        aiDecisionTelemetry.recordFrame(simulationFrame, aiDecisions);
        matchTelemetry.recordFrame(frameInput, state, fixedDt, acceptedActionStarts, launchClashes);
        liveAiRoundReplayRecorder?.recordFrame(frameInput, state, aiDecisions);
        if (selectedMode === 'training') {
          trainingTelemetry.recordFrame(frameInput, state, fixedDt);
        }
      }
      simulationFrame += 1;
      accumulator -= fixedDt;
      if (
        onlineMatchContext
        && !state.winner
        && onlineMatchContext.smokeRecovery?.observeSpeculativeTail(
          createLocalRankedRecoveryObservation(onlineMatchContext),
        )
      ) {
        accumulator = 0;
        break;
      }
      if (balanceLabSampleTargetFrames !== null) {
        const balanceSampleStop = evaluateBalanceLabSampleStop(
          balanceLabSampleTargetFrames,
          simulationFrame,
          state.winner !== null,
        );
        if (balanceSampleStop.shouldStop) {
          balanceLabSampleTargetFrames = null;
          const completedSeconds = balanceSampleStop.completedFrames * fixedDt;
          const targetSeconds = balanceSampleStop.targetFrames * fixedDt;
          const status = balanceSampleStop.reason === 'round_finished_early'
            ? `Matched sample stopped at ${completedSeconds.toFixed(1)}s because the candidate finished before the ${targetSeconds.toFixed(1)}s baseline. Review finish cadence and flow deltas.`
            : `Matched sample completed at the baseline's exact ${balanceSampleStop.targetFrames}-frame (${targetSeconds.toFixed(1)}s) window.`;
          accumulator = 0;
          pauseMenu.openBalanceLab(status);
          break;
        }
      }
    }

    if (state.winner && !pauseMenu.isPaused()) {
      onRoundWin(state.winner);
    }
  }

  if (!pauseMenu.isPaused() && appPhase === 'round_transition') {
    const resolvingOnlineRound = onlineMatchContext
      ? onlineTransportReconnecting
        || updateOnlineRoundResolution(onlineMatchContext, elapsedSeconds)
      : false;
    if (!resolvingOnlineRound) {
      roundTransitionRemaining -= elapsedSeconds;
      if (roundTransitionRemaining <= 0) {
        resetRoundState({ advanceOfflineRound: true });
        startMenu.hideRoundBanner();
        appPhase = 'playing';
      }
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

  if (
    onlineMatchContext
    && (appPhase === 'playing' || appPhase === 'round_transition')
    && onlineMatchContext.transportRecovery.getSnapshot().state === 'connected'
    && !onlineMatchContext.smokeRecovery?.isHoldingBeforeRecovery()
  ) {
    onlineMatchContext.sendAccumulatorSeconds += elapsedSeconds;
    onlineMatchContext.pollAccumulatorSeconds += elapsedSeconds;
    if (
      onlineMatchContext.sendAccumulatorSeconds >= 0.05
      || onlineMatchContext.inputPump.getOutboundFrameCount() >= 4
    ) {
      onlineMatchContext.sendAccumulatorSeconds = 0;
      flushOnlineTransport(onlineMatchContext);
    } else if (onlineMatchContext.pollAccumulatorSeconds >= 0.05) {
      flushOnlineTransport(onlineMatchContext);
    }
    if (onlineMatchContext.pollAccumulatorSeconds >= 0.05) {
      onlineMatchContext.pollAccumulatorSeconds = 0;
    }
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

function buildLocalRankedRootSmokeSnapshot(): LocalRankedRootSmokeSnapshot {
  const context = onlineMatchContext;
  const proof = context?.rankedProof ?? null;
  const result = context?.rankedResultResponse ?? null;
  const rollbackDiagnostics = rollbackSession?.getDiagnosticsSnapshot() ?? null;
  const inputPumpDiagnostics = context?.inputPump.getDiagnostics() ?? null;
  return {
    schemaVersion: LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
    rootPath: window.location.pathname,
    releaseProfile: {
      environment: runtimeConfig.environment,
      buildId: diagnosticsBuildId,
      onlineEnabled: runtimeConfig.features.onlineEnabled,
      rankedEnabled: runtimeConfig.features.rankedEnabled,
      onlineMatchRuntimeEnabled: runtimeConfig.features.onlineMatchRuntimeEnabled,
      debugToolsEnabled: runtimeConfig.features.debugToolsEnabled,
    },
    forceRelayRequested: localRankedRootSmokeConfig.forceRelay,
    phase: appPhase,
    account: {
      accountId: sessionAccountId,
      signedAccessToken: Boolean(platform.auth.getAccessToken?.()),
    },
    ticket: playerRankedTicket ? {
      ticketId: playerRankedTicket.ticketId,
      status: playerRankedTicket.status,
      sessionId: playerRankedTicket.matchStart?.sessionId ?? null,
    } : null,
    bootstrap: onlineBootstrapState ? {
      sessionId: onlineBootstrapState.sessionId,
      status: onlineBootstrapState.status,
      connectionPath: onlineBootstrapState.connectionPath,
      detail: onlineBootstrapState.statusDetail,
    } : null,
    session: playerRankedSession ? {
      sessionId: playerRankedSession.sessionId,
      status: playerRankedSession.status,
      resolvedReason: playerRankedSession.resolvedReason ?? null,
      participantAccountIds: playerRankedSession.participants.map((entry) => entry.accountId),
    } : null,
    match: context && inputPumpDiagnostics ? {
      sessionId: context.sessionId,
      localAccountId: context.localAccountId,
      remoteAccountId: context.remoteAccountId,
      localPlayerId: context.localPlayerId,
      remotePlayerId: context.remotePlayerId,
      connectionPath: context.connectionPath,
      iceTransportPolicy: context.iceTransportPolicy,
      relayAvailable: context.relayAvailable,
      turnCredentialMode: context.turnCredentialMode,
      transportAttemptGeneration: context.transportAttemptGeneration,
      roundEpoch: context.roundEpoch,
      simulationFrame,
      p1RoundWins,
      p2RoundWins,
      winner: state.winner,
      finalOutcome: context.finalOutcome,
      winnerAccountId: context.winnerAccountId,
      sessionCompletionStatus: context.sessionCompletionStatus,
      proof: proof ? {
        claimedOutcome: proof.claimedOutcome,
        roundCount: proof.rounds.length,
        frameCount: proof.rounds.reduce((total, round) => total + round.inputs.length, 0),
      } : null,
      replay: {
        status: context.replayStatus,
        replayId: context.replayId,
        digest: context.replayPayload?.integrity?.digest ?? null,
        roundCount: context.replayRecorder.roundCount,
        frameCount: context.replayRecorder.frameCount,
        detail: context.replayDetail,
      },
      result: {
        status: context.rankedResultStatus,
        submissionId: context.rankedResultSubmissionId,
        persistedRead: context.rankedResultPersistedRead,
        settlementSource: result?.settlementSource ?? null,
        proofDigest: result?.proof?.digest ?? null,
        proofRoundCount: result?.proof?.roundCount ?? null,
        proofFrameCount: result?.proof?.frameCount ?? null,
        outcome: result?.outcome ?? null,
        winnerAccountId: result?.winnerAccountId ?? null,
        ratingDeltas: (result?.ratingDeltas ?? []).map((delta) => ({
          accountId: delta.accountId,
          side: delta.side,
          preRating: delta.preRating,
          postRating: delta.postRating,
          ratingDelta: delta.ratingDelta,
          result: delta.result,
        })),
        detail: context.rankedResultDetail,
      },
      rollback: {
        applications: context.rollbackApplications,
        totalFrames: context.rollbackFrames,
        maxDepth: context.maxRollbackDepth,
        currentRoundTotalRollbacks: rollbackDiagnostics?.totalRollbacks ?? 0,
        currentRoundCorrectionEvents: rollbackDiagnostics?.correctionEvents.length ?? 0,
      },
      inputPump: {
        outboundFrames: inputPumpDiagnostics.outboundFrames,
        contiguousRemoteFrame: inputPumpDiagnostics.contiguousRemoteFrame,
        peerConfirmedThrough: inputPumpDiagnostics.peerConfirmedThrough,
        mutuallyConfirmedThrough: context.inputPump.getMutuallyConfirmedThrough(),
        uploadFailures: inputPumpDiagnostics.uploadFailures,
        pollFailures: inputPumpDiagnostics.pollFailures,
        confirmationFailures: inputPumpDiagnostics.confirmationFailures,
      },
      recovery: context.smokeRecovery?.getDiagnostics(inputPumpDiagnostics.outboundFrames) ?? null,
      smokeTransport: context.smokeFrameTransport?.getDiagnostics() ?? null,
      driver: localRankedSmokeInputDriver?.getDiagnostics() ?? null,
    } : null,
    progression: playerRankedSnapshot ? {
      rating: playerRankedSnapshot.rating,
      leagueTier: playerRankedSnapshot.leagueTier,
      leaguePoints: playerRankedSnapshot.leaguePoints,
      provisional: playerRankedSnapshot.provisional,
      recentDeltas: playerRankedSnapshot.recentDeltas.map((delta) => ({
        result: delta.result,
        preRating: delta.preRating,
        postRating: delta.postRating,
        occurredAt: delta.occurredAt,
      })),
    } : null,
  };
}

async function refreshLocalRankedRootSmokePersistedState(): Promise<void> {
  const context = onlineMatchContext;
  if (!localRankedRootSmokeConfig.enabled || !context || appPhase !== 'match_over') {
    throw new Error('A completed local ranked root smoke match is required before persistence readback.');
  }
  playerRankedSession = await requestOnlineJson<MatchSessionView>(
    'GET',
    `/matchmaking/sessions/${context.sessionId}`,
    context.localAccountId,
  );
  const persistedResult = await requestOnlineJson<RankedResultSubmitResponse>(
    'GET',
    `/ranked/results/${context.sessionId}`,
    context.localAccountId,
    undefined,
    { matchSessionToken: context.sessionToken },
  );
  if (!await applyOnlineRankedResultResponse(context, persistedResult)) {
    throw new Error('Persisted ranked result is still awaiting peer consensus.');
  }
  await persistOnlineMatchReplay(context);
  context.rankedResultPersistedRead = true;
}

const disposeLocalRankedRootSmokeBridge = installLocalRankedRootSmokeBridge(
  localRankedRootSmokeConfig,
  {
    schemaVersion: LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
    getSnapshot: buildLocalRankedRootSmokeSnapshot,
    joinRankedQueue: async () => {
      await localRankedSmokeRuntimeModulePromise;
      await joinRankedQueue();
    },
    refreshRankedQueue: async () => {
      await refreshRankedQueue();
    },
    armMidRoundRecovery: async () => {
      const context = onlineMatchContext;
      if (!context || !context.smokeRecovery || appPhase !== 'playing' || context.finalOutcome) {
        throw new Error('A live local ranked root match is required to arm recovery.');
      }
      context.smokeRecovery.arm();
    },
    triggerMidRoundRecovery: async () => {
      const context = onlineMatchContext;
      if (!context || !context.smokeRecovery || appPhase !== 'playing' || context.finalOutcome) {
        throw new Error('A live local ranked root match is required to trigger recovery.');
      }
      context.smokeRecovery.triggerRecovery(
        createLocalRankedRecoveryObservation(context),
        () => context.transportRecovery.requestRecovery(
          new WebRtcFrameTransportClosedError('Loopback ranked-root recovery smoke requested.'),
        ),
      );
    },
    refreshPersistedState: refreshLocalRankedRootSmokePersistedState,
  },
);

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

const disposeOnlineSessionLifecycleListeners = installOnlineSessionLifecycleListeners({
  controller: onlineSessionLifecycle,
  canManage: canLifecycleManageOnlineSession,
});

window.addEventListener('beforeunload', () => {
  disposeLocalRankedRootSmokeBridge();
  disposeOnlineSessionLifecycleListeners();
  startMenu.dispose();
  onlineDevMenu?.dispose();
  replayViewer.dispose();
  diagnosticsOverlay?.dispose();
  input.dispose();
  audioSystem.dispose();
  platform.dispose?.();
});
