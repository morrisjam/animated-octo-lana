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
import { createPlatformServices } from './platform';
import { validateReplayPayload } from './sim/replay';
import { buildReplayReviewData, type ReplayReviewData } from './sim/replayReview';
import { createInitialState, getRenderSnapshot, step } from './sim/sim';
import { sanitiseTuning } from './sim/tuning';
import type { PlayerId, PlayersById } from './sim/types';
import { createHud, type RollbackDiagnosticsView } from './view/hud';
import { createPauseMenu } from './view/pauseMenu';
import { createReplayViewer } from './view/replayViewer';
import { renderFrame } from './view/render';
import { createScene, resizeScene } from './view/scene';
import { createStartMenu, type GameMode } from './view/startMenu';

type AppPhase = 'home' | 'playing' | 'round_transition' | 'match_over' | 'replay_review';
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

const startMenu = createStartMenu({
  initialMode: selectedMode,
  initialLoadout: selectedLoadout,
  enabledModes,
  onStartMode: (mode, loadout) => {
    beginMode(mode, loadout);
  },
  onReturnHome: () => {
    returnToHome();
  },
  onPlayAgain: () => {
    beginMode(selectedMode, selectedLoadout);
  },
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

function getEnabledModes(): GameMode[] {
  const modes: GameMode[] = ['endless', 'best_of_3'];
  if (runtimeConfig.features.trainingModeEnabled) {
    modes.push('training');
  }
  return modes;
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
    if (!session.accountId) {
      return;
    }
    await platform.profile.getProfile(session.accountId);
  } catch {
    // Profile bootstrap fallback is intentionally silent for prototype flow.
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

  const validation = validateReplayPayload(payloadRaw);
  if (!validation.ok) {
    console.error('[replay-review] invalid replay payload', validation.error);
    return;
  }

  replayReviewData = buildReplayReviewData(validation.payload);
  replayReviewSourceLabel = fileName;
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
  if (appPhase === 'replay_review') {
    if (event.key.toLowerCase() === 'escape') {
      event.preventDefault();
      exitReplayReview();
    }
    return;
  }

  if (selectedMode === 'training' && appPhase === 'playing' && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    restartTrainingRound();
    return;
  }

  if (event.key.toLowerCase() === 'escape') {
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
  replayViewer.dispose();
  input.dispose();
  platform.dispose?.();
});
