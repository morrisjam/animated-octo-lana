import {
  CHARACTERS,
  CHARACTER_BY_ID,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_LOADOUT,
  type CharacterId,
} from '../sim/characters';
import {
  AI_DIFFICULTY_ORDER,
  AI_DIFFICULTY_PROFILES,
  DEFAULT_AI_DIFFICULTY,
  type AiDifficultyId,
} from '../sim/ai';
import {
  DEFAULT_ARCADE_STAGES,
  type ArcadeStageDefinition,
} from '../sim/arcade';
import type { PlayerId, PlayersById } from '../sim/types';

export type GameMode = 'endless' | 'best_of_3' | 'arcade' | 'training' | 'cpu_vs_cpu';
export type WebAuthMenuAction = 'signin' | 'signup' | 'signout';
export type OnlineDevMenuTarget = 'matchmaking' | 'rooms' | 'replay' | 'ranked' | 'social';
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';
export interface ArcadeMenuSettings {
  continues: number;
  retryEnabled: boolean;
}
export interface StartMenuThemeOption {
  id: string;
  label: string;
  description: string;
}
export interface StartStageAtmosphereOption {
  id: string;
  label: string;
  description: string;
}
export interface WebAuthMenuRequest {
  email?: string;
  password?: string;
  displayName?: string | null;
  upgradeCurrentGuest?: boolean;
}
export interface OnlineRankedViewState {
  headline: string;
  detail: string;
  tone?: StatusTone;
  hint?: string;
}
export interface OnlineRoomViewState {
  headline: string;
  detail: string;
  roomCode?: string | null;
  tone?: StatusTone;
  hint?: string;
}
export interface ReplayArchiveViewState {
  headline: string;
  detail: string;
  tone?: StatusTone;
  hint?: string;
}
export interface RankedSnapshotViewState {
  headline: string;
  detail: string;
  tone?: StatusTone;
  hint?: string;
}
export interface MatchOverScreenOptions {
  title?: string;
  subtitle?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

type StartScreen =
  | 'title'
  | 'login'
  | 'main'
  | 'online'
  | 'online_ranked'
  | 'online_room'
  | 'local'
  | 'replays'
  | 'rankings'
  | 'settings'
  | 'match_over';

interface StartMenuOptions {
  onlineMenuEnabled?: boolean;
  initialMode?: GameMode;
  initialLoadout?: PlayersById<CharacterId>;
  initialAiDifficulty?: AiDifficultyId;
  initialArcadeSettings?: ArcadeMenuSettings;
  initialMenuThemeId?: string;
  availableMenuThemes?: StartMenuThemeOption[];
  initialStageAtmosphereId?: string;
  availableStageAtmospheres?: StartStageAtmosphereOption[];
  enabledModes?: GameMode[];
  initialAccountSummary?: string;
  onStartMode(
    mode: GameMode,
    loadout: PlayersById<CharacterId>,
    aiDifficulty: AiDifficultyId,
    arcadeSettings: ArcadeMenuSettings,
  ): void;
  onOpenWebAuth?(action: WebAuthMenuAction, request?: WebAuthMenuRequest): Promise<void> | void;
  onJoinRankedQueue?(): Promise<OnlineRankedViewState> | OnlineRankedViewState;
  onRefreshRankedQueue?(): Promise<OnlineRankedViewState> | OnlineRankedViewState;
  onLeaveRankedQueue?(): Promise<OnlineRankedViewState> | OnlineRankedViewState;
  onCreateCustomRoom?(): Promise<OnlineRoomViewState> | OnlineRoomViewState;
  onJoinCustomRoom?(roomCode: string): Promise<OnlineRoomViewState> | OnlineRoomViewState;
  onRefreshCustomRoom?(roomCode: string): Promise<OnlineRoomViewState> | OnlineRoomViewState;
  onCloseCustomRoom?(roomCode: string): Promise<OnlineRoomViewState> | OnlineRoomViewState;
  onRefreshReplayArchive?(): Promise<ReplayArchiveViewState> | ReplayArchiveViewState;
  onOpenLatestReplay?(): Promise<ReplayArchiveViewState> | ReplayArchiveViewState;
  onRefreshRankedSnapshot?(): Promise<RankedSnapshotViewState> | RankedSnapshotViewState;
  onOpenOnlineDevMenu?(target?: OnlineDevMenuTarget): void;
  onOpenReplayReview?(): void;
  onMenuThemeChange?(themeId: string): void;
  onStageAtmosphereChange?(atmosphereId: string): void;
  onReturnHome(): void;
  onPlayAgain(): void;
}

interface PadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  start: boolean;
}

const MODE_LABELS: Record<GameMode, string> = {
  endless: 'Endless Dev',
  best_of_3: 'Best of 3',
  arcade: 'Arcade Ladder',
  training: 'Training',
  cpu_vs_cpu: 'AI vs AI',
};
const MODE_ORDER: GameMode[] = ['endless', 'best_of_3', 'arcade', 'training', 'cpu_vs_cpu'];
const ARCADE_CONTINUE_OPTIONS = [0, 1, 2, 3];
const SETTINGS_THEME_ROW_INDEX = 3;
const SETTINGS_STAGE_ATMOSPHERE_ROW_INDEX = 4;

function getAiDifficultyLabel(difficulty: AiDifficultyId): string {
  return AI_DIFFICULTY_PROFILES[difficulty]?.label ?? AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY].label;
}

function readButton(gamepad: Gamepad, index: number, threshold = 0.35): boolean {
  const button = gamepad.buttons[index];
  if (!button) {
    return false;
  }
  return button.pressed || button.value > threshold;
}

function readPadState(gamepad: Gamepad): PadState {
  const axisX = gamepad.axes[0] ?? 0;
  const axisY = gamepad.axes[1] ?? 0;
  const threshold = 0.55;
  const dpadUp = readButton(gamepad, 12);
  const dpadDown = readButton(gamepad, 13);
  const dpadLeft = readButton(gamepad, 14);
  const dpadRight = readButton(gamepad, 15);

  return {
    up: dpadUp || axisY < -threshold,
    down: dpadDown || axisY > threshold,
    left: dpadLeft || axisX < -threshold,
    right: dpadRight || axisX > threshold,
    confirm: readButton(gamepad, 0),
    back: readButton(gamepad, 1),
    start: readButton(gamepad, 9) || readButton(gamepad, 16),
  };
}

function cloneLoadout(loadout: PlayersById<CharacterId>): PlayersById<CharacterId> {
  return {
    P1: loadout.P1,
    P2: loadout.P2,
  };
}

function cycleCharacter(current: CharacterId, direction: 1 | -1): CharacterId {
  const currentIndex = CHARACTER_IDS.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + CHARACTER_IDS.length) % CHARACTER_IDS.length;
  return CHARACTER_IDS[nextIndex];
}

function sanitiseEnabledModes(rawModes: GameMode[] | undefined): GameMode[] {
  if (!rawModes || rawModes.length === 0) {
    return ['endless', 'best_of_3', 'arcade', 'cpu_vs_cpu'];
  }
  const uniqueModes: GameMode[] = [];
  for (const mode of MODE_ORDER) {
    if (rawModes.includes(mode)) {
      uniqueModes.push(mode);
    }
  }
  return uniqueModes.length > 0 ? uniqueModes : ['endless'];
}

function getNextMode(current: GameMode, enabledModes: GameMode[], direction: 1 | -1): GameMode {
  const currentIndex = enabledModes.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + enabledModes.length) % enabledModes.length;
  return enabledModes[nextIndex];
}

function sanitiseAiDifficulty(raw: AiDifficultyId | undefined): AiDifficultyId {
  if (raw && AI_DIFFICULTY_ORDER.includes(raw)) {
    return raw;
  }
  return DEFAULT_AI_DIFFICULTY;
}

function getNextAiDifficulty(current: AiDifficultyId, direction: 1 | -1): AiDifficultyId {
  const currentIndex = AI_DIFFICULTY_ORDER.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + AI_DIFFICULTY_ORDER.length) % AI_DIFFICULTY_ORDER.length;
  return AI_DIFFICULTY_ORDER[nextIndex];
}

function sanitiseArcadeSettings(raw: ArcadeMenuSettings | undefined): ArcadeMenuSettings {
  const requestedContinues = Number(raw?.continues);
  const nearestContinueOption = ARCADE_CONTINUE_OPTIONS.includes(requestedContinues)
    ? requestedContinues
    : 2;
  return {
    continues: nearestContinueOption,
    retryEnabled: raw?.retryEnabled !== false,
  };
}

function getNextArcadeContinues(current: number, direction: 1 | -1): number {
  const currentIndex = ARCADE_CONTINUE_OPTIONS.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + ARCADE_CONTINUE_OPTIONS.length) % ARCADE_CONTINUE_OPTIONS.length;
  return ARCADE_CONTINUE_OPTIONS[nextIndex];
}

function sanitiseMenuThemeOptions(raw: StartMenuThemeOption[] | undefined): StartMenuThemeOption[] {
  if (!raw || raw.length === 0) {
    return [{
      id: 'default',
      label: 'Default',
      description: 'Baseline Gravity Well visual skin.',
    }];
  }
  const deduped: StartMenuThemeOption[] = [];
  const seen = new Set<string>();
  for (const option of raw) {
    const id = option.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push({
      id,
      label: option.label.trim() || id,
      description: option.description.trim() || 'No description.',
    });
  }
  if (deduped.length === 0) {
    return [{
      id: 'default',
      label: 'Default',
      description: 'Baseline Gravity Well visual skin.',
    }];
  }
  return deduped;
}

function resolveInitialMenuThemeId(raw: string | undefined, options: StartMenuThemeOption[]): string {
  if (!raw) {
    return options[0].id;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return options[0].id;
  }
  const match = options.find((option) => option.id === trimmed);
  return match?.id ?? options[0].id;
}

function getNextMenuThemeId(current: string, options: StartMenuThemeOption[], direction: 1 | -1): string {
  if (options.length === 0) {
    return current;
  }
  const currentIndex = options.findIndex((option) => option.id === current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + options.length) % options.length;
  return options[nextIndex].id;
}

function sanitiseStageAtmosphereOptions(raw: StartStageAtmosphereOption[] | undefined): StartStageAtmosphereOption[] {
  if (!raw || raw.length === 0) {
    return [{
      id: 'default',
      label: 'Default Arena',
      description: 'Baseline Gravity Well arena lighting and atmosphere.',
    }];
  }
  const deduped: StartStageAtmosphereOption[] = [];
  const seen = new Set<string>();
  for (const option of raw) {
    const id = option.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push({
      id,
      label: option.label.trim() || id,
      description: option.description.trim() || 'No description.',
    });
  }
  if (deduped.length === 0) {
    return [{
      id: 'default',
      label: 'Default Arena',
      description: 'Baseline Gravity Well arena lighting and atmosphere.',
    }];
  }
  return deduped;
}

function resolveInitialStageAtmosphereId(raw: string | undefined, options: StartStageAtmosphereOption[]): string {
  if (!raw) {
    return options[0].id;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return options[0].id;
  }
  const match = options.find((option) => option.id === trimmed);
  return match?.id ?? options[0].id;
}

function getNextStageAtmosphereId(current: string, options: StartStageAtmosphereOption[], direction: 1 | -1): string {
  if (options.length === 0) {
    return current;
  }
  const currentIndex = options.findIndex((option) => option.id === current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + options.length) % options.length;
  return options[nextIndex].id;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(target.type);
  }
  return false;
}

function buildArcadeLadderView(
  playerCharacterId: CharacterId,
  settings: ArcadeMenuSettings,
  stages: ArcadeStageDefinition[] = DEFAULT_ARCADE_STAGES,
): { headline: string; detail: string; hint: string } {
  const playerCharacter = CHARACTER_BY_ID[playerCharacterId]?.displayName ?? playerCharacterId;
  const finalEncounter = stages.find((stage) => stage.finalEncounter) ?? stages[stages.length - 1] ?? null;
  const stageLines = stages.map((stage, index) => {
    const opponent = CHARACTER_BY_ID[stage.opponentCharacterId]?.displayName ?? stage.opponentCharacterId;
    const tag = stage.finalEncounter ? 'Final' : `Stage ${index + 1}`;
    return `${tag}: ${stage.label} | ${opponent} | ${getAiDifficultyLabel(stage.aiDifficulty)}`;
  });

  return {
    headline: `${stages.length}-stage ladder | ${playerCharacter} run`,
    detail: `Encounter Order:\n${stageLines.join('\n')}`,
    hint: `Rounds: best of 3. Continues: ${settings.continues}. Retry stage: ${settings.retryEnabled ? 'Enabled' : 'Disabled'}. Final encounter: ${finalEncounter?.label ?? 'Unknown'}.`,
  };
}

export class StartMenu {
  private readonly root: HTMLDivElement;
  private readonly roundBanner: HTMLDivElement;

  private readonly titlePanel: HTMLDivElement;
  private readonly titleSubtitle: HTMLParagraphElement;
  private readonly loginPanel: HTMLDivElement;
  private readonly mainPanel: HTMLDivElement;
  private readonly onlinePanel: HTMLDivElement;
  private readonly onlineRankedPanel: HTMLDivElement;
  private readonly onlineRoomPanel: HTMLDivElement;
  private readonly localPanel: HTMLDivElement;
  private readonly replaysPanel: HTMLDivElement;
  private readonly rankingsPanel: HTMLDivElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly matchOverPanel: HTMLDivElement;

  private readonly rowsByScreen = new Map<StartScreen, HTMLElement[]>();
  private readonly rowIndexByScreen = new Map<StartScreen, number>();

  private readonly accountSummaryLabel: HTMLDivElement;
  private readonly loginAccountSummaryLabel: HTMLDivElement;
  private readonly settingsAccountSummaryLabel: HTMLDivElement;
  private readonly settingsAuthStateLabel: HTMLDivElement;
  private readonly authStatusLabel: HTMLDivElement;
  private readonly authEmailInput: HTMLInputElement;
  private readonly authPasswordInput: HTMLInputElement;
  private readonly authDisplayNameInput: HTMLInputElement;
  private readonly authUpgradeGuestInput: HTMLInputElement;
  private readonly signInButton: HTMLButtonElement;
  private readonly signUpButton: HTMLButtonElement;
  private readonly signOutButton: HTMLButtonElement;
  private readonly titleContinueButton: HTMLButtonElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly mainOnlineButton: HTMLButtonElement | null;
  private readonly mainLocalButton: HTMLButtonElement;
  private readonly entitlementStatusLabel: HTMLDivElement;
  private readonly settingsSignOutButton: HTMLButtonElement;
  private readonly settingsThemeOptionsLabel: HTMLDivElement;
  private readonly settingsThemeDescriptionLabel: HTMLDivElement;
  private readonly settingsThemeButton: HTMLButtonElement;
  private readonly settingsStageAtmosphereOptionsLabel: HTMLDivElement;
  private readonly settingsStageAtmosphereDescriptionLabel: HTMLDivElement;
  private readonly settingsStageAtmosphereButton: HTMLButtonElement;
  private readonly rankedStatusHeadline: HTMLDivElement;
  private readonly rankedStatusDetail: HTMLPreElement;
  private readonly rankedStatusHint: HTMLDivElement;
  private readonly roomStatusHeadline: HTMLDivElement;
  private readonly roomStatusDetail: HTMLPreElement;
  private readonly roomStatusHint: HTMLDivElement;
  private readonly roomCodeInput: HTMLInputElement;
  private readonly rankedJoinButton: HTMLButtonElement;
  private readonly rankedRefreshButton: HTMLButtonElement;
  private readonly rankedLeaveButton: HTMLButtonElement;
  private readonly roomCreateButton: HTMLButtonElement;
  private readonly roomJoinButton: HTMLButtonElement;
  private readonly roomRefreshButton: HTMLButtonElement;
  private readonly roomCloseButton: HTMLButtonElement;
  private readonly replayStatusHeadline: HTMLDivElement;
  private readonly replayStatusDetail: HTMLPreElement;
  private readonly replayStatusHint: HTMLDivElement;
  private readonly replayRefreshButton: HTMLButtonElement;
  private readonly replayOpenLatestButton: HTMLButtonElement;
  private readonly rankingsStatusHeadline: HTMLDivElement;
  private readonly rankingsStatusDetail: HTMLPreElement;
  private readonly rankingsStatusHint: HTMLDivElement;
  private readonly rankingsRefreshButton: HTMLButtonElement;
  private readonly localModeOptionsLabel: HTMLDivElement;
  private readonly localModeButton: HTMLButtonElement;
  private readonly localDifficultyOptionsLabel: HTMLDivElement;
  private readonly localDifficultyButton: HTMLButtonElement;
  private readonly localArcadeContinuesOptionsLabel: HTMLDivElement;
  private readonly localArcadeContinuesButton: HTMLButtonElement;
  private readonly localArcadeRetryButton: HTMLButtonElement;
  private readonly localArcadeLadderHeadline: HTMLDivElement;
  private readonly localArcadeLadderDetail: HTMLPreElement;
  private readonly localArcadeLadderHint: HTMLDivElement;
  private readonly localArcadeHistoryHeadline: HTMLDivElement;
  private readonly localArcadeHistoryDetail: HTMLPreElement;
  private readonly p1CharacterButton: HTMLButtonElement;
  private readonly p2CharacterButton: HTMLButtonElement;
  private readonly localCharacterList: HTMLDivElement;

  private readonly matchButtons: HTMLButtonElement[] = [];
  private readonly matchPrimaryButton: HTMLButtonElement;
  private readonly matchSecondaryButton: HTMLButtonElement;
  private readonly matchTitle: HTMLHeadingElement;
  private readonly matchSubtitle: HTMLParagraphElement;

  private readonly prevPadStateByIndex = new Map<number, PadState>();
  private currentScreen: StartScreen = 'title';
  private rafId = 0;

  private readonly enabledModes: GameMode[];
  private readonly onlineMenuEnabled: boolean;
  private readonly menuThemeOptions: StartMenuThemeOption[];
  private readonly stageAtmosphereOptions: StartStageAtmosphereOption[];
  private currentMode: GameMode;
  private currentMenuThemeId: string;
  private currentStageAtmosphereId: string;
  private currentAiDifficulty: AiDifficultyId;
  private currentArcadeSettings: ArcadeMenuSettings;
  private currentLoadout: PlayersById<CharacterId>;
  private accountSummary: string;
  private isAuthenticated = false;
  private authBusy = false;
  private rankedBusy = false;
  private roomBusy = false;
  private replayBusy = false;
  private rankingsBusy = false;
  private matchPrimaryAction: () => void;
  private matchSecondaryAction: () => void;

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (this.root.hidden) {
      return;
    }
    if (isEditableTarget(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.handleBackAction();
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      if (this.currentScreen === 'local' || this.currentScreen === 'settings') {
        event.preventDefault();
        this.applyHorizontalNavigation(-1);
      }
      return;
    }
    if (event.key === 'ArrowRight') {
      if (this.currentScreen === 'local' || this.currentScreen === 'settings') {
        event.preventDefault();
        this.applyHorizontalNavigation(1);
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      this.handleBackAction();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.activateSelection();
    }
  };

  public constructor(private readonly options: StartMenuOptions) {
    this.enabledModes = sanitiseEnabledModes(options.enabledModes);
    this.onlineMenuEnabled = options.onlineMenuEnabled !== false;
    this.menuThemeOptions = sanitiseMenuThemeOptions(options.availableMenuThemes);
    this.stageAtmosphereOptions = sanitiseStageAtmosphereOptions(options.availableStageAtmospheres);
    this.currentMenuThemeId = resolveInitialMenuThemeId(options.initialMenuThemeId, this.menuThemeOptions);
    this.currentStageAtmosphereId = resolveInitialStageAtmosphereId(options.initialStageAtmosphereId, this.stageAtmosphereOptions);
    this.currentMode = options.initialMode && this.enabledModes.includes(options.initialMode)
      ? options.initialMode
      : this.enabledModes[0];
    this.currentAiDifficulty = sanitiseAiDifficulty(options.initialAiDifficulty);
    this.currentArcadeSettings = sanitiseArcadeSettings(options.initialArcadeSettings);
    this.currentLoadout = cloneLoadout(options.initialLoadout ?? DEFAULT_CHARACTER_LOADOUT);
    this.accountSummary = options.initialAccountSummary ?? 'Guest Account';
    this.matchPrimaryAction = () => this.options.onPlayAgain();
    this.matchSecondaryAction = () => this.options.onReturnHome();

    this.root = document.createElement('div');
    this.root.className = 'start-menu';
    this.root.hidden = true;

    this.titlePanel = this.createPanel('Gravity Well', 'Press continue to enter the portal.');
    this.titlePanel.classList.add('start-title-panel');
    const titleSubtitle = this.titlePanel.querySelector('p');
    if (!(titleSubtitle instanceof HTMLParagraphElement)) {
      throw new Error('Missing title subtitle paragraph.');
    }
    this.titleSubtitle = titleSubtitle;
    this.loginPanel = this.createPanel('Login', 'Sign in, sign up, or continue as guest.');
    this.mainPanel = this.createPanel('Main Menu', 'Choose a category.');
    this.mainPanel.classList.add('start-nav-panel');
    this.onlinePanel = this.createPanel('Online', 'Matchmaking and custom rooms.');
    this.onlinePanel.classList.add('start-nav-panel');
    this.onlineRankedPanel = this.createPanel('Ranked Queue', 'Join, refresh, and leave queue from one place.');
    this.onlineRankedPanel.classList.add('start-utility-panel');
    this.onlineRoomPanel = this.createPanel('Custom Room', 'Create or join room sessions by code.');
    this.onlineRoomPanel.classList.add('start-utility-panel');
    this.localPanel = this.createPanel('Local', 'Local match setup.');
    this.localPanel.classList.add('start-local-panel');
    this.replaysPanel = this.createPanel('Replays', 'Review archived and fixture replays.');
    this.replaysPanel.classList.add('start-utility-panel');
    this.rankingsPanel = this.createPanel('Rankings', 'Ranked snapshot and leaderboard entry point.');
    this.rankingsPanel.classList.add('start-utility-panel');
    this.settingsPanel = this.createPanel('Settings', 'Account and social options.');
    this.settingsPanel.classList.add('start-settings-panel');

    const continueRow = this.createActionRow('Continue', () => {
      this.setScreen('login');
    });
    this.titleContinueButton = continueRow.button;
    this.titlePanel.appendChild(continueRow.row);
    this.registerRows('title', [continueRow.row]);

    const loginSessionRow = document.createElement('div');
    loginSessionRow.className = 'start-menu-row';
    this.loginAccountSummaryLabel = document.createElement('div');
    this.loginAccountSummaryLabel.className = 'start-row-label';
    this.loginAccountSummaryLabel.textContent = this.accountSummary;
    loginSessionRow.appendChild(this.loginAccountSummaryLabel);
    this.loginPanel.appendChild(loginSessionRow);

    const authFields = document.createElement('div');
    authFields.className = 'start-auth-fields';

    const emailLabel = document.createElement('label');
    emailLabel.className = 'start-auth-field';
    emailLabel.textContent = 'Email';
    this.authEmailInput = document.createElement('input');
    this.authEmailInput.type = 'email';
    this.authEmailInput.placeholder = 'you@example.com';
    this.authEmailInput.autocomplete = 'email';
    emailLabel.appendChild(this.authEmailInput);

    const passwordLabel = document.createElement('label');
    passwordLabel.className = 'start-auth-field';
    passwordLabel.textContent = 'Password';
    this.authPasswordInput = document.createElement('input');
    this.authPasswordInput.type = 'password';
    this.authPasswordInput.placeholder = 'Password';
    this.authPasswordInput.autocomplete = 'current-password';
    passwordLabel.appendChild(this.authPasswordInput);

    const displayNameLabel = document.createElement('label');
    displayNameLabel.className = 'start-auth-field';
    displayNameLabel.textContent = 'Display Name (Sign Up)';
    this.authDisplayNameInput = document.createElement('input');
    this.authDisplayNameInput.type = 'text';
    this.authDisplayNameInput.placeholder = 'Optional';
    this.authDisplayNameInput.autocomplete = 'nickname';
    displayNameLabel.appendChild(this.authDisplayNameInput);

    const upgradeRow = document.createElement('label');
    upgradeRow.className = 'start-auth-check';
    this.authUpgradeGuestInput = document.createElement('input');
    this.authUpgradeGuestInput.type = 'checkbox';
    this.authUpgradeGuestInput.checked = true;
    const upgradeText = document.createElement('span');
    upgradeText.textContent = 'Upgrade current guest account on sign up';
    upgradeRow.append(this.authUpgradeGuestInput, upgradeText);

    authFields.append(emailLabel, passwordLabel, displayNameLabel, upgradeRow);
    this.loginPanel.appendChild(authFields);

    this.authStatusLabel = document.createElement('p');
    this.authStatusLabel.className = 'start-auth-status';
    this.authStatusLabel.textContent = '';
    this.loginPanel.appendChild(this.authStatusLabel);

    const signInRow = this.createActionRow('Sign In', async () => {
      await this.handleAuthAction('signin');
    });
    this.signInButton = signInRow.button;
    const signUpRow = this.createActionRow('Sign Up', async () => {
      await this.handleAuthAction('signup');
    });
    this.signUpButton = signUpRow.button;
    const signOutRow = this.createActionRow('Sign Out', async () => {
      await this.handleAuthAction('signout');
    });
    this.signOutButton = signOutRow.button;
    const guestRow = this.createActionRow('Continue as Guest', () => {
      this.setScreen('main');
    });
    this.continueButton = guestRow.button;
    const loginBackRow = this.createActionRow('Back', () => {
      this.setScreen('title');
    });
    const loginRows: HTMLElement[] = [];
    if (this.options.onOpenWebAuth) {
      this.loginPanel.append(signInRow.row, signUpRow.row, signOutRow.row);
      loginRows.push(signInRow.row, signUpRow.row, signOutRow.row);
    } else {
      authFields.hidden = true;
      signInRow.row.hidden = true;
      signUpRow.row.hidden = true;
      signOutRow.row.hidden = true;
      this.signInButton.disabled = true;
      this.signUpButton.disabled = true;
      this.signOutButton.disabled = true;
      this.authStatusLabel.textContent = 'Steam sign-in is automatic in Steam builds. Retry launch from Steam if sign-in fails.';
      this.authStatusLabel.classList.remove('error');
    }
    this.loginPanel.append(guestRow.row, loginBackRow.row);
    loginRows.push(guestRow.row, loginBackRow.row);
    this.registerRows('login', loginRows);

    const mainAccountRow = document.createElement('div');
    mainAccountRow.className = 'start-menu-row';
    this.accountSummaryLabel = document.createElement('div');
    this.accountSummaryLabel.className = 'start-row-label';
    this.accountSummaryLabel.textContent = this.accountSummary;
    mainAccountRow.appendChild(this.accountSummaryLabel);
    this.mainPanel.appendChild(mainAccountRow);
    const entitlementRow = document.createElement('div');
    entitlementRow.className = 'start-menu-row';
    this.entitlementStatusLabel = document.createElement('div');
    this.entitlementStatusLabel.className = 'start-row-label';
    this.entitlementStatusLabel.textContent = '';
    entitlementRow.appendChild(this.entitlementStatusLabel);
    this.mainPanel.appendChild(entitlementRow);

    const mainOnlineRow = this.onlineMenuEnabled
      ? this.createActionRow('Online', () => {
        this.setScreen('online');
      })
      : null;
    this.mainOnlineButton = mainOnlineRow?.button ?? null;
    const mainLocalRow = this.createActionRow('Local', () => {
      this.setScreen('local');
    });
    this.mainLocalButton = mainLocalRow.button;
    const mainReplaysRow = this.createActionRow('Replays', () => {
      this.setScreen('replays');
    });
    const mainRankingsRow = this.createActionRow('Rankings', () => {
      this.setScreen('rankings');
    });
    const mainSettingsRow = this.createActionRow('Settings', () => {
      this.setScreen('settings');
    });
    const mainBackRow = this.createActionRow('Back', () => {
      this.setScreen('login');
    });

    const mainRows: HTMLDivElement[] = [];
    if (mainOnlineRow) {
      mainRows.push(mainOnlineRow.row);
    }
    mainRows.push(
      mainLocalRow.row,
      mainReplaysRow.row,
      mainRankingsRow.row,
      mainSettingsRow.row,
      mainBackRow.row,
    );
    this.mainPanel.append(...mainRows);
    this.registerRows('main', mainRows);

    const onlineRankedRow = this.createActionRow('Ranked', () => {
      this.setScreen('online_ranked');
    });
    const onlineRoomRow = this.createActionRow('Custom Room', () => {
      this.setScreen('online_room');
    });
    const onlineBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    this.onlinePanel.append(onlineRankedRow.row, onlineRoomRow.row, onlineBackRow.row);
    this.registerRows('online', [onlineRankedRow.row, onlineRoomRow.row, onlineBackRow.row]);

    const rankedStatusPanel = this.createStatusPanel('Status');
    this.rankedStatusHeadline = rankedStatusPanel.headline;
    this.rankedStatusDetail = rankedStatusPanel.detail;
    this.rankedStatusHint = rankedStatusPanel.hint;
    const rankedJoinRow = this.createActionRow('Join Ranked Queue', async () => {
      await this.handleRankedAction('join');
    });
    this.rankedJoinButton = rankedJoinRow.button;
    const rankedRefreshRow = this.createActionRow('Refresh Queue Status', async () => {
      await this.handleRankedAction('refresh');
    });
    this.rankedRefreshButton = rankedRefreshRow.button;
    const rankedLeaveRow = this.createActionRow('Leave Queue', async () => {
      await this.handleRankedAction('leave');
    });
    this.rankedLeaveButton = rankedLeaveRow.button;
    const rankedBackRow = this.createActionRow('Back', () => {
      this.setScreen('online');
    });
    const rankedLayout = document.createElement('div');
    rankedLayout.className = 'start-utility-layout';
    const rankedInfo = document.createElement('div');
    rankedInfo.className = 'start-utility-info';
    const rankedActions = document.createElement('div');
    rankedActions.className = 'start-utility-actions';
    rankedInfo.appendChild(rankedStatusPanel.root);
    rankedActions.append(rankedJoinRow.row, rankedRefreshRow.row, rankedLeaveRow.row, rankedBackRow.row);
    rankedLayout.append(rankedInfo, rankedActions);
    this.onlineRankedPanel.append(rankedLayout);
    this.registerRows('online_ranked', [rankedJoinRow.row, rankedRefreshRow.row, rankedLeaveRow.row, rankedBackRow.row]);

    const roomCodeField = document.createElement('label');
    roomCodeField.className = 'start-auth-field';
    roomCodeField.textContent = 'Room Code';
    this.roomCodeInput = document.createElement('input');
    this.roomCodeInput.type = 'text';
    this.roomCodeInput.placeholder = 'ABC123';
    this.roomCodeInput.maxLength = 6;
    this.roomCodeInput.autocomplete = 'off';
    roomCodeField.appendChild(this.roomCodeInput);
    this.onlineRoomPanel.appendChild(roomCodeField);
    const roomStatusPanel = this.createStatusPanel('Room Status');
    this.roomStatusHeadline = roomStatusPanel.headline;
    this.roomStatusDetail = roomStatusPanel.detail;
    this.roomStatusHint = roomStatusPanel.hint;
    const roomCreateRow = this.createActionRow('Create Room', async () => {
      await this.handleRoomAction('create');
    });
    this.roomCreateButton = roomCreateRow.button;
    const roomJoinRow = this.createActionRow('Join Room', async () => {
      await this.handleRoomAction('join');
    });
    this.roomJoinButton = roomJoinRow.button;
    const roomRefreshRow = this.createActionRow('Refresh Room', async () => {
      await this.handleRoomAction('refresh');
    });
    this.roomRefreshButton = roomRefreshRow.button;
    const roomCloseRow = this.createActionRow('Close Room', async () => {
      await this.handleRoomAction('close');
    });
    this.roomCloseButton = roomCloseRow.button;
    const roomBackRow = this.createActionRow('Back', () => {
      this.setScreen('online');
    });
    const roomLayout = document.createElement('div');
    roomLayout.className = 'start-utility-layout';
    const roomInfo = document.createElement('div');
    roomInfo.className = 'start-utility-info';
    const roomActions = document.createElement('div');
    roomActions.className = 'start-utility-actions';
    roomInfo.append(roomCodeField, roomStatusPanel.root);
    roomActions.append(roomCreateRow.row, roomJoinRow.row, roomRefreshRow.row, roomCloseRow.row, roomBackRow.row);
    roomLayout.append(roomInfo, roomActions);
    this.onlineRoomPanel.append(roomLayout);
    this.registerRows('online_room', [roomCreateRow.row, roomJoinRow.row, roomRefreshRow.row, roomCloseRow.row, roomBackRow.row]);

    const localModeRow = this.createActionRow('', () => {
      this.currentMode = getNextMode(this.currentMode, this.enabledModes, 1);
      this.refreshLocalRows();
    });
    this.localModeButton = localModeRow.button;
    this.localModeOptionsLabel = document.createElement('div');
    this.localModeOptionsLabel.className = 'start-mode-options';

    const localDifficultyRow = this.createActionRow('', () => {
      this.currentAiDifficulty = getNextAiDifficulty(this.currentAiDifficulty, 1);
      this.refreshLocalRows();
    });
    this.localDifficultyButton = localDifficultyRow.button;
    this.localDifficultyOptionsLabel = document.createElement('div');
    this.localDifficultyOptionsLabel.className = 'start-mode-options';

    const localArcadeContinuesRow = this.createActionRow('', () => {
      this.currentArcadeSettings.continues = getNextArcadeContinues(this.currentArcadeSettings.continues, 1);
      this.refreshLocalRows();
    });
    this.localArcadeContinuesButton = localArcadeContinuesRow.button;
    this.localArcadeContinuesOptionsLabel = document.createElement('div');
    this.localArcadeContinuesOptionsLabel.className = 'start-mode-options';

    const localArcadeRetryRow = this.createActionRow('', () => {
      this.currentArcadeSettings.retryEnabled = !this.currentArcadeSettings.retryEnabled;
      this.refreshLocalRows();
    });
    this.localArcadeRetryButton = localArcadeRetryRow.button;

    const localP1Row = this.createActionRow('', () => {
      this.shiftCharacter('P1', 1);
    });
    this.p1CharacterButton = localP1Row.button;

    const localP2Row = this.createActionRow('', () => {
      this.shiftCharacter('P2', 1);
    });
    this.p2CharacterButton = localP2Row.button;

    this.localCharacterList = document.createElement('div');
    this.localCharacterList.className = 'start-character-list';
    const localArcadeLadderPanel = this.createStatusPanel('Arcade Ladder');
    this.localArcadeLadderHeadline = localArcadeLadderPanel.headline;
    this.localArcadeLadderDetail = localArcadeLadderPanel.detail;
    this.localArcadeLadderHint = localArcadeLadderPanel.hint;
    const localArcadeHistoryPanel = this.createStatusPanel('Arcade History');
    this.localArcadeHistoryHeadline = localArcadeHistoryPanel.headline;
    this.localArcadeHistoryDetail = localArcadeHistoryPanel.detail;

    const localStartRow = this.createActionRow('Start Local Match', () => {
      this.startLocalMatch();
    }, true);
    const localBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });

    const localLayout = document.createElement('div');
    localLayout.className = 'start-local-layout';
    const localRulesColumn = document.createElement('div');
    localRulesColumn.className = 'start-local-column start-local-rules';
    const localRosterColumn = document.createElement('div');
    localRosterColumn.className = 'start-local-column start-local-roster';
    const localRulesHeading = document.createElement('div');
    localRulesHeading.className = 'start-section-heading';
    localRulesHeading.textContent = 'Match Rules';
    const localRosterHeading = document.createElement('div');
    localRosterHeading.className = 'start-section-heading';
    localRosterHeading.textContent = 'Fighters';
    const localActions = document.createElement('div');
    localActions.className = 'start-local-actions';

    localRulesColumn.append(
      localRulesHeading,
      localModeRow.row,
      this.localModeOptionsLabel,
      localDifficultyRow.row,
      this.localDifficultyOptionsLabel,
      localArcadeContinuesRow.row,
      this.localArcadeContinuesOptionsLabel,
      localArcadeRetryRow.row,
      localArcadeLadderPanel.root,
      localArcadeHistoryPanel.root,
    );
    localRosterColumn.append(
      localRosterHeading,
      localP1Row.row,
      localP2Row.row,
      this.localCharacterList,
    );
    localLayout.append(localRulesColumn, localRosterColumn);
    localActions.append(localStartRow.row, localBackRow.row);

    this.localPanel.append(localLayout, localActions);
    this.registerRows(
      'local',
      [
        localModeRow.row,
        localDifficultyRow.row,
        localArcadeContinuesRow.row,
        localArcadeRetryRow.row,
        localP1Row.row,
        localP2Row.row,
        localStartRow.row,
        localBackRow.row,
      ],
    );

    const replayStatusPanel = this.createStatusPanel('Replay Archive');
    this.replayStatusHeadline = replayStatusPanel.headline;
    this.replayStatusDetail = replayStatusPanel.detail;
    this.replayStatusHint = replayStatusPanel.hint;
    const replayRefreshRow = this.createActionRow('Refresh Replay Archive', async () => {
      await this.handleReplayAction('refresh');
    });
    this.replayRefreshButton = replayRefreshRow.button;
    const replayOpenLatestRow = this.createActionRow('Open Latest Replay', async () => {
      await this.handleReplayAction('open_latest');
    });
    this.replayOpenLatestButton = replayOpenLatestRow.button;
    const replayFixtureRow = this.createActionRow('Replay Review (Smoke Fixture)', () => {
      this.options.onOpenReplayReview?.();
    });
    const replayBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    const replayLayout = document.createElement('div');
    replayLayout.className = 'start-utility-layout';
    const replayInfo = document.createElement('div');
    replayInfo.className = 'start-utility-info';
    const replayActions = document.createElement('div');
    replayActions.className = 'start-utility-actions';
    replayInfo.appendChild(replayStatusPanel.root);
    replayActions.append(replayRefreshRow.row, replayOpenLatestRow.row, replayFixtureRow.row, replayBackRow.row);
    replayLayout.append(replayInfo, replayActions);
    this.replaysPanel.append(replayLayout);
    this.registerRows('replays', [replayRefreshRow.row, replayOpenLatestRow.row, replayFixtureRow.row, replayBackRow.row]);

    const rankingsStatusPanel = this.createStatusPanel('Ranked Snapshot');
    this.rankingsStatusHeadline = rankingsStatusPanel.headline;
    this.rankingsStatusDetail = rankingsStatusPanel.detail;
    this.rankingsStatusHint = rankingsStatusPanel.hint;
    const rankingsRefreshRow = this.createActionRow('Refresh Ranked Snapshot', async () => {
      await this.handleRankingsRefreshAction();
    });
    this.rankingsRefreshButton = rankingsRefreshRow.button;
    const rankingsBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    const rankingsLayout = document.createElement('div');
    rankingsLayout.className = 'start-utility-layout';
    const rankingsInfo = document.createElement('div');
    rankingsInfo.className = 'start-utility-info';
    const rankingsActions = document.createElement('div');
    rankingsActions.className = 'start-utility-actions';
    rankingsInfo.appendChild(rankingsStatusPanel.root);
    rankingsActions.append(rankingsRefreshRow.row, rankingsBackRow.row);
    rankingsLayout.append(rankingsInfo, rankingsActions);
    this.rankingsPanel.append(rankingsLayout);
    this.registerRows('rankings', [rankingsRefreshRow.row, rankingsBackRow.row]);

    const settingsSessionRow = document.createElement('div');
    settingsSessionRow.className = 'start-menu-row';
    this.settingsAccountSummaryLabel = document.createElement('div');
    this.settingsAccountSummaryLabel.className = 'start-row-label';
    this.settingsAccountSummaryLabel.textContent = this.accountSummary;
    this.settingsAuthStateLabel = document.createElement('div');
    this.settingsAuthStateLabel.className = 'start-status-headline';
    this.settingsAuthStateLabel.textContent = 'Guest session';
    settingsSessionRow.append(this.settingsAccountSummaryLabel, this.settingsAuthStateLabel);
    this.settingsPanel.appendChild(settingsSessionRow);

    const settingsAccountRow = this.createActionRow('Manage Account', () => {
      this.setScreen('login');
    });
    const settingsSignOutRow = this.createActionRow('Sign Out', async () => {
      await this.handleAuthAction('signout');
    });
    this.settingsSignOutButton = settingsSignOutRow.button;
    const settingsSocialRow = this.createActionRow('Social', () => {
      this.options.onOpenOnlineDevMenu?.('social');
    });
    const settingsThemeInfoRow = document.createElement('div');
    settingsThemeInfoRow.className = 'start-menu-row';
    this.settingsThemeOptionsLabel = document.createElement('div');
    this.settingsThemeOptionsLabel.className = 'start-mode-options';
    this.settingsThemeDescriptionLabel = document.createElement('div');
    this.settingsThemeDescriptionLabel.className = 'start-mode-options';
    settingsThemeInfoRow.append(this.settingsThemeOptionsLabel, this.settingsThemeDescriptionLabel);
    const settingsThemeRow = this.createActionRow('Menu Theme', () => {
      this.cycleMenuTheme(1);
    });
    this.settingsThemeButton = settingsThemeRow.button;
    const settingsStageAtmosphereInfoRow = document.createElement('div');
    settingsStageAtmosphereInfoRow.className = 'start-menu-row';
    this.settingsStageAtmosphereOptionsLabel = document.createElement('div');
    this.settingsStageAtmosphereOptionsLabel.className = 'start-mode-options';
    this.settingsStageAtmosphereDescriptionLabel = document.createElement('div');
    this.settingsStageAtmosphereDescriptionLabel.className = 'start-mode-options';
    settingsStageAtmosphereInfoRow.append(this.settingsStageAtmosphereOptionsLabel, this.settingsStageAtmosphereDescriptionLabel);
    const settingsStageAtmosphereRow = this.createActionRow('Stage Atmosphere', () => {
      this.cycleStageAtmosphere(1);
    });
    this.settingsStageAtmosphereButton = settingsStageAtmosphereRow.button;
    const settingsBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    const settingsLayout = document.createElement('div');
    settingsLayout.className = 'start-settings-layout';
    const settingsAccountColumn = document.createElement('div');
    settingsAccountColumn.className = 'start-settings-column';
    const settingsPresentationColumn = document.createElement('div');
    settingsPresentationColumn.className = 'start-settings-column';
    const settingsAccountHeading = document.createElement('div');
    settingsAccountHeading.className = 'start-section-heading';
    settingsAccountHeading.textContent = 'Account';
    const settingsPresentationHeading = document.createElement('div');
    settingsPresentationHeading.className = 'start-section-heading';
    settingsPresentationHeading.textContent = 'Presentation';
    const settingsActions = document.createElement('div');
    settingsActions.className = 'start-settings-actions';

    settingsAccountColumn.append(
      settingsAccountHeading,
      settingsSessionRow,
      settingsAccountRow.row,
      settingsSignOutRow.row,
      settingsSocialRow.row,
    );
    settingsPresentationColumn.append(
      settingsPresentationHeading,
      settingsThemeInfoRow,
      settingsThemeRow.row,
      settingsStageAtmosphereInfoRow,
      settingsStageAtmosphereRow.row,
    );
    settingsLayout.append(settingsAccountColumn, settingsPresentationColumn);
    settingsActions.append(settingsBackRow.row);
    this.settingsPanel.append(settingsLayout, settingsActions);
    this.registerRows('settings', [
      settingsAccountRow.row,
      settingsSignOutRow.row,
      settingsSocialRow.row,
      settingsThemeRow.row,
      settingsStageAtmosphereRow.row,
      settingsBackRow.row,
    ]);

    const padHint = document.createElement('p');
    padHint.className = 'start-pad-hint';
    padHint.textContent = 'Controls: Up/Down to navigate, Left/Right to adjust local selectors, A/Enter confirm, B/Esc back.';
    this.mainPanel.appendChild(padHint.cloneNode(true));
    this.onlinePanel.appendChild(padHint.cloneNode(true));
    this.onlineRankedPanel.appendChild(padHint.cloneNode(true));
    this.onlineRoomPanel.appendChild(padHint.cloneNode(true));
    this.localPanel.appendChild(padHint.cloneNode(true));
    this.replaysPanel.appendChild(padHint.cloneNode(true));
    this.rankingsPanel.appendChild(padHint.cloneNode(true));
    this.settingsPanel.appendChild(padHint.cloneNode(true));
    this.loginPanel.appendChild(padHint.cloneNode(true));
    this.titlePanel.appendChild(padHint.cloneNode(true));

    this.matchOverPanel = document.createElement('div');
    this.matchOverPanel.className = 'start-panel';
    this.matchOverPanel.hidden = true;
    this.root.appendChild(this.matchOverPanel);

    this.matchTitle = document.createElement('h2');
    this.matchTitle.textContent = 'Match Over';
    this.matchSubtitle = document.createElement('p');
    this.matchSubtitle.className = 'start-match-subtitle';
    this.matchSubtitle.textContent = '';
    this.matchOverPanel.append(this.matchTitle, this.matchSubtitle);

    const playAgainButton = document.createElement('button');
    playAgainButton.type = 'button';
    playAgainButton.className = 'start-action';
    playAgainButton.textContent = 'Play Again';
    playAgainButton.addEventListener('click', () => this.matchPrimaryAction());
    this.matchPrimaryButton = playAgainButton;

    const homeButton = document.createElement('button');
    homeButton.type = 'button';
    homeButton.className = 'start-action';
    homeButton.textContent = 'Return to Home';
    homeButton.addEventListener('click', () => this.matchSecondaryAction());
    this.matchSecondaryButton = homeButton;

    this.matchButtons.push(playAgainButton, homeButton);
    this.matchOverPanel.append(playAgainButton, homeButton);

    this.root.append(
      this.titlePanel,
      this.loginPanel,
      this.mainPanel,
      this.onlinePanel,
      this.onlineRankedPanel,
      this.onlineRoomPanel,
      this.localPanel,
      this.replaysPanel,
      this.rankingsPanel,
      this.settingsPanel,
    );

    this.roundBanner = document.createElement('div');
    this.roundBanner.className = 'round-banner';
    this.roundBanner.hidden = true;
    this.roundBanner.innerHTML = '<div class="round-banner-title"></div><div class="round-banner-subtitle"></div>';

    document.body.append(this.root, this.roundBanner);

    window.addEventListener('keydown', this.keydownHandler);
    this.refreshLocalRows();
    this.setScreen('title');
    this.setAuthState(false);
    this.applyRankedState({
      headline: 'Not queued',
      detail: 'Press "Join Ranked Queue" to start matchmaking.',
      hint: 'Refresh queue status if this screen looks stale after joining.',
    });
    this.applyRoomState({
      headline: 'No room loaded',
      detail: 'Create a room or enter a code to join one.',
      roomCode: null,
      hint: 'Custom rooms are best for direct invites and private tests.',
    });
    this.applyReplayState({
      headline: 'Replay archive idle',
      detail: 'Press "Refresh Replay Archive" to load recent matches.',
      hint: 'Recent online sessions only appear here after the replay payload has been stored.',
    });
    this.applyRankingsState({
      headline: 'No ranked snapshot loaded',
      detail: 'Press "Refresh Ranked Snapshot" to load progression.',
      hint: 'Use this after a ranked session to confirm placement and rating changes.',
    });
    this.setArcadeHistoryView(
      'No arcade runs',
      'Complete an arcade ladder run to populate recent runs and best completion records.',
    );
    this.refreshSettingsThemeRows();
    this.refreshSettingsStageAtmosphereRows();
    this.setMatchSelection(0);
    this.pollGamepads();
  }

  public showHome(): void {
    this.root.hidden = false;
    this.prevPadStateByIndex.clear();
    this.setScreen('title');
  }

  public hideHome(): void {
    this.root.hidden = true;
    this.prevPadStateByIndex.clear();
  }

  public showRoundBanner(winner: PlayerId, subtitle: string): void {
    const titleElement = this.roundBanner.querySelector<HTMLDivElement>('.round-banner-title');
    const subtitleElement = this.roundBanner.querySelector<HTMLDivElement>('.round-banner-subtitle');
    if (titleElement) {
      titleElement.textContent = `${winner} takes the round`;
    }
    if (subtitleElement) {
      subtitleElement.textContent = subtitle;
    }
    this.roundBanner.hidden = false;
  }

  public hideRoundBanner(): void {
    this.roundBanner.hidden = true;
  }

  private resetMatchOverActions(): void {
    this.matchPrimaryButton.textContent = 'Play Again';
    this.matchSecondaryButton.textContent = 'Return to Home';
    this.matchSecondaryButton.hidden = false;
    this.matchPrimaryAction = () => this.options.onPlayAgain();
    this.matchSecondaryAction = () => this.options.onReturnHome();
  }

  public showMatchOver(winner: PlayerId, p1Wins: number, p2Wins: number): void {
    this.resetMatchOverActions();
    this.root.hidden = false;
    this.currentScreen = 'match_over';
    this.prevPadStateByIndex.clear();
    this.matchTitle.textContent = `${winner} wins the match`;
    this.matchSubtitle.textContent = `Final rounds: P1 ${p1Wins} - ${p2Wins} P2`;
    this.setMatchSelection(0);
    this.refreshPanelVisibility();
  }

  public showMatchOverScreen(options: MatchOverScreenOptions): void {
    this.resetMatchOverActions();
    if (options.primaryLabel) {
      this.matchPrimaryButton.textContent = options.primaryLabel;
    }
    if (options.secondaryLabel !== undefined) {
      this.matchSecondaryButton.textContent = options.secondaryLabel;
      this.matchSecondaryButton.hidden = options.secondaryLabel.trim().length === 0;
    }
    if (options.onPrimary) {
      this.matchPrimaryAction = options.onPrimary;
    }
    if (options.onSecondary) {
      this.matchSecondaryAction = options.onSecondary;
    }

    this.root.hidden = false;
    this.currentScreen = 'match_over';
    this.prevPadStateByIndex.clear();
    this.matchTitle.textContent = options.title ?? 'Match Over';
    this.matchSubtitle.textContent = options.subtitle ?? '';
    this.setMatchSelection(0);
    this.refreshPanelVisibility();
  }

  public dispose(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
    window.removeEventListener('keydown', this.keydownHandler);
    this.root.remove();
    this.roundBanner.remove();
  }

  public setAccountSummary(summary: string): void {
    this.accountSummary = summary;
    this.accountSummaryLabel.textContent = summary;
    this.loginAccountSummaryLabel.textContent = summary;
    this.settingsAccountSummaryLabel.textContent = summary;
  }

  public setAuthState(isAuthenticated: boolean): void {
    this.isAuthenticated = isAuthenticated;
    this.signOutButton.disabled = !this.isAuthenticated || this.authBusy;
    this.settingsSignOutButton.disabled = !this.isAuthenticated || this.authBusy;
    this.continueButton.textContent = this.isAuthenticated ? 'Continue' : 'Continue as Guest';
    this.settingsAuthStateLabel.textContent = this.isAuthenticated ? 'Authenticated session' : 'Guest session';
    if (isAuthenticated) {
      this.authStatusLabel.textContent = '';
      this.authStatusLabel.classList.remove('error');
      return;
    }
    if (this.authStatusLabel.textContent.trim().length === 0) {
      this.authStatusLabel.textContent = 'Guest session active.';
      this.authStatusLabel.classList.remove('error');
    }
  }

  public setLocalSetup(
    mode: GameMode,
    loadout: PlayersById<CharacterId>,
    aiDifficulty: AiDifficultyId,
    arcadeSettings?: ArcadeMenuSettings,
  ): void {
    this.currentMode = this.enabledModes.includes(mode) ? mode : (this.enabledModes[0] ?? 'endless');
    this.currentLoadout = cloneLoadout(loadout);
    this.currentAiDifficulty = sanitiseAiDifficulty(aiDifficulty);
    this.currentArcadeSettings = sanitiseArcadeSettings(arcadeSettings);
    this.refreshLocalRows();
  }

  public setMenuTheme(themeId: string): void {
    const resolved = resolveInitialMenuThemeId(themeId, this.menuThemeOptions);
    this.currentMenuThemeId = resolved;
    this.refreshSettingsThemeRows();
  }

  public setStageAtmosphere(atmosphereId: string): void {
    const resolved = resolveInitialStageAtmosphereId(atmosphereId, this.stageAtmosphereOptions);
    this.currentStageAtmosphereId = resolved;
    this.refreshSettingsStageAtmosphereRows();
  }

  public setArcadeHistoryView(headline: string, detail: string): void {
    this.localArcadeHistoryHeadline.textContent = headline;
    this.localArcadeHistoryDetail.textContent = detail;
  }

  public setArcadeLadderView(headline: string, detail: string, hint = ''): void {
    this.localArcadeLadderHeadline.textContent = headline;
    this.localArcadeLadderDetail.textContent = detail;
    this.localArcadeLadderHint.hidden = hint.trim().length === 0;
    this.localArcadeLadderHint.textContent = hint;
  }

  public setEntitlementGate(canAccessGameplay: boolean, message: string | null): void {
    if (this.mainOnlineButton) {
      this.mainOnlineButton.disabled = !canAccessGameplay;
    }
    this.mainLocalButton.disabled = !canAccessGameplay;
    this.titleContinueButton.disabled = false;
    this.titleSubtitle.textContent = canAccessGameplay
      ? 'Press continue to enter the portal.'
      : 'Access to gameplay is currently blocked. See status details.';
    const entitlementMessage = message?.trim() ?? '';
    this.entitlementStatusLabel.textContent = entitlementMessage;
    this.entitlementStatusLabel.classList.toggle('error', !canAccessGameplay && entitlementMessage.length > 0);
    if (this.entitlementStatusLabel.parentElement instanceof HTMLElement) {
      this.entitlementStatusLabel.parentElement.hidden = entitlementMessage.length === 0;
    }
  }

  private createPanel(title: string, subtitle: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'start-panel start-home-panel';
    panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'start-panel-header';
    const kicker = document.createElement('div');
    kicker.className = 'start-panel-kicker';
    kicker.textContent = 'Gravity Well';
    const heading = document.createElement('h1');
    heading.className = 'start-panel-title';
    heading.textContent = title;
    const sub = document.createElement('p');
    sub.className = 'start-panel-subtitle';
    sub.textContent = subtitle;
    header.append(kicker, heading, sub);
    panel.append(header);

    return panel;
  }

  private createStatusPanel(title: string): {
    root: HTMLDivElement;
    headline: HTMLDivElement;
    detail: HTMLPreElement;
    hint: HTMLDivElement;
  } {
    const root = document.createElement('div');
    root.className = 'start-status-panel';
    const heading = document.createElement('div');
    heading.className = 'start-row-label';
    heading.textContent = title;
    const headline = document.createElement('div');
    headline.className = 'start-status-headline';
    headline.textContent = '-';
    const detail = document.createElement('pre');
    detail.className = 'start-status-detail';
    detail.textContent = '-';
    const hint = document.createElement('div');
    hint.className = 'start-status-hint';
    hint.hidden = true;
    root.append(heading, headline, detail, hint);
    return { root, headline, detail, hint };
  }

  private applyRankedState(state: OnlineRankedViewState): void {
    this.applyStatusPanelState(this.rankedStatusHeadline, this.rankedStatusDetail, this.rankedStatusHint, state);
  }

  private applyRoomState(state: OnlineRoomViewState): void {
    this.applyStatusPanelState(this.roomStatusHeadline, this.roomStatusDetail, this.roomStatusHint, state);
    if (state.roomCode) {
      this.roomCodeInput.value = state.roomCode;
    }
  }

  private applyReplayState(state: ReplayArchiveViewState): void {
    this.applyStatusPanelState(this.replayStatusHeadline, this.replayStatusDetail, this.replayStatusHint, state);
  }

  private applyRankingsState(state: RankedSnapshotViewState): void {
    this.applyStatusPanelState(this.rankingsStatusHeadline, this.rankingsStatusDetail, this.rankingsStatusHint, state);
  }

  private applyStatusPanelState(
    headlineNode: HTMLDivElement,
    detailNode: HTMLPreElement,
    hintNode: HTMLDivElement,
    state: { headline: string; detail: string; tone?: StatusTone; hint?: string },
  ): void {
    const tone = state.tone ?? 'neutral';
    const hint = state.hint?.trim() ?? '';
    headlineNode.textContent = state.headline;
    detailNode.textContent = state.detail;
    headlineNode.dataset.tone = tone;
    detailNode.dataset.tone = tone;
    hintNode.dataset.tone = tone;
    hintNode.hidden = hint.length === 0;
    hintNode.textContent = hint;
  }

  private setRankedBusy(busy: boolean): void {
    this.rankedBusy = busy;
    this.rankedJoinButton.disabled = busy;
    this.rankedRefreshButton.disabled = busy;
    this.rankedLeaveButton.disabled = busy;
  }

  private setRoomBusy(busy: boolean): void {
    this.roomBusy = busy;
    this.roomCodeInput.disabled = busy;
    this.roomCreateButton.disabled = busy;
    this.roomJoinButton.disabled = busy;
    this.roomRefreshButton.disabled = busy;
    this.roomCloseButton.disabled = busy;
  }

  private setReplayBusy(busy: boolean): void {
    this.replayBusy = busy;
    this.replayRefreshButton.disabled = busy;
    this.replayOpenLatestButton.disabled = busy;
  }

  private setRankingsBusy(busy: boolean): void {
    this.rankingsBusy = busy;
    this.rankingsRefreshButton.disabled = busy;
  }

  private createActionRow(label: string, onActivate: () => void | Promise<void>, primary = false): { row: HTMLDivElement; button: HTMLButtonElement } {
    const row = document.createElement('div');
    row.className = 'start-menu-row start-action-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'start-action primary' : 'start-action';
    button.textContent = label;
    button.addEventListener('click', () => {
      const result = onActivate();
      if (result instanceof Promise) {
        void result;
      }
    });
    row.appendChild(button);
    return { row, button };
  }

  private registerRows(screen: StartScreen, rows: HTMLElement[]): void {
    this.rowsByScreen.set(screen, rows);
    if (!this.rowIndexByScreen.has(screen)) {
      this.rowIndexByScreen.set(screen, 0);
    }
  }

  private setScreen(screen: StartScreen): void {
    this.currentScreen = screen;
    this.refreshPanelVisibility();
    this.refreshRowHighlights();
  }

  private refreshPanelVisibility(): void {
    this.titlePanel.hidden = this.currentScreen !== 'title';
    this.loginPanel.hidden = this.currentScreen !== 'login';
    this.mainPanel.hidden = this.currentScreen !== 'main';
    this.onlinePanel.hidden = this.currentScreen !== 'online';
    this.onlineRankedPanel.hidden = this.currentScreen !== 'online_ranked';
    this.onlineRoomPanel.hidden = this.currentScreen !== 'online_room';
    this.localPanel.hidden = this.currentScreen !== 'local';
    this.replaysPanel.hidden = this.currentScreen !== 'replays';
    this.rankingsPanel.hidden = this.currentScreen !== 'rankings';
    this.settingsPanel.hidden = this.currentScreen !== 'settings';
    this.matchOverPanel.hidden = this.currentScreen !== 'match_over';
  }

  private getRowsForCurrentScreen(): HTMLElement[] {
    if (this.currentScreen === 'match_over') {
      return this.matchButtons;
    }
    return this.rowsByScreen.get(this.currentScreen) ?? [];
  }

  private getCurrentRowIndex(): number {
    if (this.currentScreen === 'match_over') {
      return this.matchButtons.findIndex((button) => button.classList.contains('active'));
    }
    return this.rowIndexByScreen.get(this.currentScreen) ?? 0;
  }

  private setCurrentRowIndex(index: number): void {
    const rows = this.getRowsForCurrentScreen();
    if (rows.length === 0) {
      return;
    }
    const next = Math.max(0, Math.min(rows.length - 1, index));
    if (this.currentScreen === 'match_over') {
      this.setMatchSelection(next);
      return;
    }
    this.rowIndexByScreen.set(this.currentScreen, next);
    this.refreshRowHighlights();
  }

  private refreshRowHighlights(): void {
    for (const [screen, rows] of this.rowsByScreen.entries()) {
      const activeIndex = this.currentScreen === screen
        ? (this.rowIndexByScreen.get(screen) ?? 0)
        : -1;
      for (let i = 0; i < rows.length; i += 1) {
        rows[i].classList.toggle('active', i === activeIndex);
      }
    }

    if (this.currentScreen === 'match_over') {
      const selected = this.getCurrentRowIndex();
      for (let i = 0; i < this.matchButtons.length; i += 1) {
        this.matchButtons[i].classList.toggle('active', i === selected);
      }
    } else {
      for (const button of this.matchButtons) {
        button.classList.remove('active');
      }
    }
  }

  private refreshLocalRows(): void {
    const arcadeModeSelected = this.currentMode === 'arcade';
    const aiVsAiSelected = this.currentMode === 'cpu_vs_cpu';
    this.localModeButton.textContent = `Mode: ${MODE_LABELS[this.currentMode]}`;
    this.localModeOptionsLabel.textContent = this.enabledModes
      .map((mode) => mode === this.currentMode ? `[${MODE_LABELS[mode]}]` : MODE_LABELS[mode])
      .join('  |  ');
    this.localDifficultyButton.textContent = aiVsAiSelected
      ? `AI Difficulty: ${getAiDifficultyLabel(this.currentAiDifficulty)} (Both)`
      : `AI Difficulty: ${getAiDifficultyLabel(this.currentAiDifficulty)}`;
    this.localDifficultyOptionsLabel.textContent = AI_DIFFICULTY_ORDER
      .map((difficulty) => (
        difficulty === this.currentAiDifficulty
          ? `[${getAiDifficultyLabel(difficulty)}]`
          : getAiDifficultyLabel(difficulty)
      ))
      .join('  |  ');
    this.localArcadeContinuesButton.disabled = !arcadeModeSelected;
    this.localArcadeRetryButton.disabled = !arcadeModeSelected;
    this.p2CharacterButton.disabled = arcadeModeSelected;
    this.localArcadeContinuesOptionsLabel.classList.toggle('muted', !arcadeModeSelected);
    if (arcadeModeSelected) {
      this.localArcadeContinuesButton.textContent = `Arcade Continues: ${this.currentArcadeSettings.continues}`;
      this.localArcadeContinuesOptionsLabel.textContent = ARCADE_CONTINUE_OPTIONS
        .map((value) => value === this.currentArcadeSettings.continues ? `[${value}]` : `${value}`)
        .join('  |  ');
      this.localArcadeRetryButton.textContent = `Arcade Retry: ${this.currentArcadeSettings.retryEnabled ? 'Enabled' : 'Disabled'}`;
      const ladderView = buildArcadeLadderView(this.currentLoadout.P1, this.currentArcadeSettings);
      this.setArcadeLadderView(ladderView.headline, ladderView.detail, ladderView.hint);
    } else {
      this.localArcadeContinuesButton.textContent = 'Arcade Continues: Arcade mode only';
      this.localArcadeContinuesOptionsLabel.textContent = 'Switch mode to Arcade Ladder to edit continue and retry rules.';
      this.localArcadeRetryButton.textContent = 'Arcade Retry: Arcade mode only';
      this.setArcadeLadderView(
        'Arcade ladder preview',
        'Switch to Arcade Ladder to preview the encounter order, final encounter, and current continue rules.',
        'Arcade runs replace the normal P2 selection with ladder-controlled opponents.',
      );
    }

    const p1 = CHARACTER_BY_ID[this.currentLoadout.P1];
    const p2 = CHARACTER_BY_ID[this.currentLoadout.P2];
    this.p1CharacterButton.textContent = `P1: ${p1.displayName} (${p1.mechanicsTag})`;
    this.p2CharacterButton.textContent = arcadeModeSelected
      ? 'P2: Ladder-controlled opponents'
      : `P2: ${p2.displayName} (${p2.mechanicsTag})`;

    this.localCharacterList.innerHTML = '';
    for (const character of CHARACTERS) {
      const item = document.createElement('div');
      item.className = 'start-character-item';
      const selectedByP1 = this.currentLoadout.P1 === character.id;
      const selectedByP2 = this.currentLoadout.P2 === character.id;
      if (selectedByP1) {
        item.classList.add('selected-p1');
      }
      if (selectedByP2) {
        item.classList.add('selected-p2');
      }

      const name = document.createElement('div');
      name.className = 'start-character-item-name';
      name.textContent = character.displayName;
      const blurb = document.createElement('div');
      blurb.className = 'start-character-item-blurb';
      blurb.textContent = character.mechanicsTag;
      item.append(name, blurb);
      this.localCharacterList.appendChild(item);
    }

    this.refreshRowHighlights();
  }

  private shiftCharacter(playerId: PlayerId, direction: 1 | -1): void {
    const current = this.currentLoadout[playerId];
    this.currentLoadout[playerId] = cycleCharacter(current, direction);
    this.refreshLocalRows();
  }

  private startLocalMatch(): void {
    this.options.onStartMode(
      this.currentMode,
      cloneLoadout(this.currentLoadout),
      this.currentAiDifficulty,
      { ...this.currentArcadeSettings },
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unexpected request failure.';
  }

  private getRankedBusyState(action: 'join' | 'refresh' | 'leave'): OnlineRankedViewState {
    if (action === 'join') {
      return {
        headline: 'Joining ranked queue',
        detail: 'Submitting matchmaking ticket and waiting for queue confirmation.',
        tone: 'neutral',
        hint: 'Stay on this screen. Buttons will re-enable once the request resolves.',
      };
    }
    if (action === 'refresh') {
      return {
        headline: 'Refreshing queue state',
        detail: 'Pulling the latest ticket and session status from the online service.',
        tone: 'neutral',
        hint: 'Use this if the queue looks stale or the match does not advance.',
      };
    }
    return {
      headline: 'Leaving ranked queue',
      detail: 'Cancelling the current search ticket.',
      tone: 'warning',
      hint: 'You can join again immediately after the queue closes.',
    };
  }

  private getRoomBusyState(action: 'create' | 'join' | 'refresh' | 'close', roomCode: string): OnlineRoomViewState {
    if (action === 'create') {
      return {
        headline: 'Creating room',
        detail: 'Requesting a new private room and reserving a shareable code.',
        tone: 'neutral',
        hint: 'Share the generated code once the room is ready.',
      };
    }
    if (action === 'join') {
      return {
        headline: `Joining room ${roomCode}`,
        detail: 'Resolving the room and joining it as a player.',
        roomCode,
        tone: 'neutral',
        hint: 'If join fails, confirm the room code and whether the room is still open.',
      };
    }
    if (action === 'refresh') {
      return {
        headline: `Refreshing room ${roomCode}`,
        detail: 'Loading the latest participant and session state.',
        roomCode,
        tone: 'neutral',
        hint: 'Use refresh when a player joins, leaves, or a session should have started.',
      };
    }
    return {
      headline: `Closing room ${roomCode}`,
      detail: 'Sending a close request to stop new joins and resolve the room.',
      roomCode,
      tone: 'warning',
      hint: 'Once closed, players need a new room code for the next session.',
    };
  }

  private getReplayBusyState(action: 'refresh' | 'open_latest'): ReplayArchiveViewState {
    if (action === 'refresh') {
      return {
        headline: 'Refreshing replay archive',
        detail: 'Loading the latest archived sessions for this account.',
        tone: 'neutral',
        hint: 'Recent online matches may take a moment to appear after result submission.',
      };
    }
    return {
      headline: 'Opening latest replay',
      detail: 'Fetching replay payload and switching into replay review.',
      tone: 'neutral',
      hint: 'If this stalls, refresh the archive first to make sure a replay is available.',
    };
  }

  private getRankingsBusyState(): RankedSnapshotViewState {
    return {
      headline: 'Refreshing ranked snapshot',
      detail: 'Requesting progression, placement, and recent ranked deltas.',
      tone: 'neutral',
      hint: 'Use this after a ranked set to confirm the latest rating update landed.',
    };
  }

  private getAuthRequest(action: WebAuthMenuAction): WebAuthMenuRequest | undefined {
    if (action === 'signout') {
      return undefined;
    }
    const email = this.authEmailInput.value.trim();
    const password = this.authPasswordInput.value;
    if (!email || !password) {
      this.authStatusLabel.textContent = 'Email and password are required.';
      this.authStatusLabel.classList.add('error');
      return undefined;
    }
    if (action === 'signup') {
      return {
        email,
        password,
        displayName: this.authDisplayNameInput.value.trim() || null,
        upgradeCurrentGuest: this.authUpgradeGuestInput.checked,
      };
    }
    return { email, password };
  }

  private setAuthBusy(busy: boolean): void {
    this.authBusy = busy;
    this.signInButton.disabled = busy;
    this.signUpButton.disabled = busy;
    this.signOutButton.disabled = busy || !this.isAuthenticated;
    this.settingsSignOutButton.disabled = busy || !this.isAuthenticated;
  }

  private async handleAuthAction(action: WebAuthMenuAction): Promise<void> {
    if (!this.options.onOpenWebAuth) {
      this.setScreen('main');
      return;
    }
    const request = this.getAuthRequest(action);
    if (action !== 'signout' && !request) {
      return;
    }
    this.authStatusLabel.classList.remove('error');
    this.authStatusLabel.textContent = action === 'signout' ? 'Signing out...' : 'Submitting authentication...';
    this.setAuthBusy(true);
    try {
      await this.options.onOpenWebAuth(action, request);
      this.authPasswordInput.value = '';
      this.authStatusLabel.classList.remove('error');
      if (action === 'signout') {
        this.authStatusLabel.textContent = 'Signed out. Guest session restored.';
      } else if (action === 'signin') {
        this.authStatusLabel.textContent = 'Sign-in successful.';
        this.setScreen('main');
      } else {
        this.authStatusLabel.textContent = 'Sign-up successful.';
        this.setScreen('main');
      }
    } catch (error) {
      this.authStatusLabel.textContent = `Auth failed: ${this.getErrorMessage(error)}`;
      this.authStatusLabel.classList.add('error');
    } finally {
      this.setAuthBusy(false);
    }
  }

  private normaliseRoomCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private async handleRankedAction(action: 'join' | 'refresh' | 'leave'): Promise<void> {
    const callback = action === 'join'
      ? this.options.onJoinRankedQueue
      : action === 'refresh'
        ? this.options.onRefreshRankedQueue
        : this.options.onLeaveRankedQueue;
    if (!callback) {
      this.applyRankedState({
        headline: 'Unavailable',
        detail: 'Ranked queue is not configured for this build.',
        tone: 'warning',
        hint: 'Use Local or Arcade from the main menu in builds without online matchmaking.',
      });
      return;
    }
    this.applyRankedState(this.getRankedBusyState(action));
    this.setRankedBusy(true);
    try {
      const state = await callback();
      this.applyRankedState(state);
    } catch (error) {
      this.applyRankedState({
        headline: 'Queue action failed',
        detail: this.getErrorMessage(error),
        tone: 'danger',
        hint: 'Try refresh first if the action may have completed on the server.',
      });
    } finally {
      this.setRankedBusy(false);
    }
  }

  private async handleRoomAction(action: 'create' | 'join' | 'refresh' | 'close'): Promise<void> {
    const roomCode = this.normaliseRoomCode(this.roomCodeInput.value);
    this.roomCodeInput.value = roomCode;
    if ((action === 'join' || action === 'refresh' || action === 'close') && !roomCode) {
      this.applyRoomState({
        headline: 'Room code required',
        detail: 'Enter a room code before this action.',
        tone: 'warning',
        hint: 'Room codes are six-character share codes such as ABC123.',
      });
      return;
    }
    this.applyRoomState(this.getRoomBusyState(action, roomCode));
    this.setRoomBusy(true);
    try {
      let state: OnlineRoomViewState | undefined;
      if (action === 'create') {
        if (!this.options.onCreateCustomRoom) {
          throw new Error('Create room is unavailable in this build.');
        }
        state = await this.options.onCreateCustomRoom();
      } else if (action === 'join') {
        if (!this.options.onJoinCustomRoom) {
          throw new Error('Join room is unavailable in this build.');
        }
        state = await this.options.onJoinCustomRoom(roomCode);
      } else if (action === 'refresh') {
        if (!this.options.onRefreshCustomRoom) {
          throw new Error('Refresh room is unavailable in this build.');
        }
        state = await this.options.onRefreshCustomRoom(roomCode);
      } else if (action === 'close') {
        if (!this.options.onCloseCustomRoom) {
          throw new Error('Close room is unavailable in this build.');
        }
        state = await this.options.onCloseCustomRoom(roomCode);
      }
      if (state) {
        this.applyRoomState(state);
      }
    } catch (error) {
      this.applyRoomState({
        headline: 'Room action failed',
        detail: this.getErrorMessage(error),
        roomCode,
        tone: 'danger',
        hint: 'Refresh the room or re-enter the code before trying again.',
      });
    } finally {
      this.setRoomBusy(false);
    }
  }

  private async handleReplayAction(action: 'refresh' | 'open_latest'): Promise<void> {
    const callback = action === 'refresh'
      ? this.options.onRefreshReplayArchive
      : this.options.onOpenLatestReplay;
    if (!callback) {
      this.applyReplayState({
        headline: 'Replay unavailable',
        detail: 'Replay archive is not configured for this build.',
        tone: 'warning',
        hint: 'You can still use the fixture replay review entry from this menu.',
      });
      return;
    }
    this.applyReplayState(this.getReplayBusyState(action));
    this.setReplayBusy(true);
    try {
      const state = await callback();
      this.applyReplayState(state);
    } catch (error) {
      this.applyReplayState({
        headline: 'Replay action failed',
        detail: this.getErrorMessage(error),
        tone: 'danger',
        hint: 'Refresh the archive and retry once the latest replay entry appears.',
      });
    } finally {
      this.setReplayBusy(false);
    }
  }

  private async handleRankingsRefreshAction(): Promise<void> {
    if (!this.options.onRefreshRankedSnapshot) {
      this.applyRankingsState({
        headline: 'Ranked snapshot unavailable',
        detail: 'Ranked progression API is not configured for this build.',
        tone: 'warning',
        hint: 'Ranked progression is only available in builds with the ranking service enabled.',
      });
      return;
    }
    this.applyRankingsState(this.getRankingsBusyState());
    this.setRankingsBusy(true);
    try {
      const state = await this.options.onRefreshRankedSnapshot();
      this.applyRankingsState(state);
    } catch (error) {
      this.applyRankingsState({
        headline: 'Ranked snapshot failed',
        detail: this.getErrorMessage(error),
        tone: 'danger',
        hint: 'Retry after the current online request finishes or after result submission completes.',
      });
    } finally {
      this.setRankingsBusy(false);
    }
  }

  private moveSelection(direction: 1 | -1): void {
    const rows = this.getRowsForCurrentScreen();
    if (rows.length === 0) {
      return;
    }
    const current = this.getCurrentRowIndex();
    const next = (current + direction + rows.length) % rows.length;
    this.setCurrentRowIndex(next);
  }

  private activateSelection(): void {
    const rows = this.getRowsForCurrentScreen();
    if (rows.length === 0) {
      return;
    }
    if (this.currentScreen === 'match_over') {
      const matchButton = rows[this.getCurrentRowIndex()] as HTMLButtonElement;
      matchButton?.click();
      return;
    }

    const row = rows[this.getCurrentRowIndex()];
    const button = row.querySelector<HTMLButtonElement>('button');
    button?.click();
  }

  private applyLocalHorizontal(direction: 1 | -1): void {
    if (this.currentScreen !== 'local') {
      return;
    }
    const rowIndex = this.getCurrentRowIndex();
    if (rowIndex === 0) {
      this.currentMode = getNextMode(this.currentMode, this.enabledModes, direction);
      this.refreshLocalRows();
      return;
    }
    if (rowIndex === 1) {
      this.currentAiDifficulty = getNextAiDifficulty(this.currentAiDifficulty, direction);
      this.refreshLocalRows();
      return;
    }
    if (rowIndex === 2) {
      if (this.currentMode !== 'arcade') {
        return;
      }
      this.currentArcadeSettings.continues = getNextArcadeContinues(this.currentArcadeSettings.continues, direction);
      this.refreshLocalRows();
      return;
    }
    if (rowIndex === 3) {
      if (this.currentMode !== 'arcade') {
        return;
      }
      this.currentArcadeSettings.retryEnabled = !this.currentArcadeSettings.retryEnabled;
      this.refreshLocalRows();
      return;
    }
    if (rowIndex === 4) {
      this.shiftCharacter('P1', direction);
      return;
    }
    if (rowIndex === 5) {
      this.shiftCharacter('P2', direction);
    }
  }

  private applySettingsHorizontal(direction: 1 | -1): void {
    if (this.currentScreen !== 'settings') {
      return;
    }
    const rowIndex = this.getCurrentRowIndex();
    if (rowIndex === SETTINGS_THEME_ROW_INDEX) {
      this.cycleMenuTheme(direction);
      return;
    }
    if (rowIndex === SETTINGS_STAGE_ATMOSPHERE_ROW_INDEX) {
      this.cycleStageAtmosphere(direction);
    }
  }

  private applyHorizontalNavigation(direction: 1 | -1): void {
    if (this.currentScreen === 'local') {
      this.applyLocalHorizontal(direction);
      return;
    }
    if (this.currentScreen === 'settings') {
      this.applySettingsHorizontal(direction);
    }
  }

  private cycleMenuTheme(direction: 1 | -1): void {
    const nextThemeId = getNextMenuThemeId(this.currentMenuThemeId, this.menuThemeOptions, direction);
    if (nextThemeId === this.currentMenuThemeId) {
      return;
    }
    this.currentMenuThemeId = nextThemeId;
    this.refreshSettingsThemeRows();
    this.options.onMenuThemeChange?.(nextThemeId);
  }

  private cycleStageAtmosphere(direction: 1 | -1): void {
    const nextAtmosphereId = getNextStageAtmosphereId(this.currentStageAtmosphereId, this.stageAtmosphereOptions, direction);
    if (nextAtmosphereId === this.currentStageAtmosphereId) {
      return;
    }
    this.currentStageAtmosphereId = nextAtmosphereId;
    this.refreshSettingsStageAtmosphereRows();
    this.options.onStageAtmosphereChange?.(nextAtmosphereId);
  }

  private refreshSettingsThemeRows(): void {
    const activeTheme = this.menuThemeOptions.find((theme) => theme.id === this.currentMenuThemeId) ?? this.menuThemeOptions[0];
    this.settingsThemeButton.textContent = `Menu Theme: ${activeTheme.label}`;
    this.settingsThemeOptionsLabel.textContent = this.menuThemeOptions
      .map((theme) => theme.id === activeTheme.id ? `[${theme.label}]` : theme.label)
      .join('  |  ');
    this.settingsThemeDescriptionLabel.textContent = activeTheme.description;
  }

  private refreshSettingsStageAtmosphereRows(): void {
    const activeAtmosphere = this.stageAtmosphereOptions.find(
      (atmosphere) => atmosphere.id === this.currentStageAtmosphereId,
    ) ?? this.stageAtmosphereOptions[0];
    this.settingsStageAtmosphereButton.textContent = `Stage Atmosphere: ${activeAtmosphere.label}`;
    this.settingsStageAtmosphereOptionsLabel.textContent = this.stageAtmosphereOptions
      .map((atmosphere) => atmosphere.id === activeAtmosphere.id ? `[${atmosphere.label}]` : atmosphere.label)
      .join('  |  ');
    this.settingsStageAtmosphereDescriptionLabel.textContent = activeAtmosphere.description;
  }

  private handleBackAction(): void {
    switch (this.currentScreen) {
      case 'title':
        return;
      case 'login':
        this.setScreen('title');
        return;
      case 'main':
        this.setScreen('login');
        return;
      case 'online':
      case 'local':
      case 'replays':
      case 'rankings':
      case 'settings':
        this.setScreen('main');
        return;
      case 'online_ranked':
      case 'online_room':
        this.setScreen('online');
        return;
      case 'match_over':
        this.matchSecondaryAction();
        return;
      default:
        return;
    }
  }

  private setMatchSelection(index: number): void {
    this.rowIndexByScreen.set('match_over', Math.max(0, Math.min(this.matchButtons.length - 1, index)));
    this.refreshRowHighlights();
  }

  private wasPressed(padIndex: number, state: PadState, key: keyof PadState): boolean {
    const previous = this.prevPadStateByIndex.get(padIndex);
    return state[key] && !previous?.[key];
  }

  private pollGamepads = (): void => {
    if (!this.root.hidden && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      const primaryPad = pads.find((pad) => Boolean(pad)) ?? null;
      if (primaryPad) {
        const state = readPadState(primaryPad);
        if (this.wasPressed(primaryPad.index, state, 'up')) {
          this.moveSelection(-1);
        }
        if (this.wasPressed(primaryPad.index, state, 'down')) {
          this.moveSelection(1);
        }
        if (this.wasPressed(primaryPad.index, state, 'left')) {
          this.applyHorizontalNavigation(-1);
        }
        if (this.wasPressed(primaryPad.index, state, 'right')) {
          this.applyHorizontalNavigation(1);
        }
        if (this.wasPressed(primaryPad.index, state, 'confirm')) {
          this.activateSelection();
        }
        if (this.wasPressed(primaryPad.index, state, 'back')) {
          this.handleBackAction();
        }
        if (this.wasPressed(primaryPad.index, state, 'start')) {
          if (this.currentScreen === 'local') {
            this.startLocalMatch();
          } else if (this.currentScreen === 'match_over') {
            this.activateSelection();
          }
        }
        this.prevPadStateByIndex.set(primaryPad.index, state);
      }
    }

    this.rafId = window.requestAnimationFrame(this.pollGamepads);
  };
}

export function createStartMenu(options: StartMenuOptions): StartMenu {
  return new StartMenu(options);
}
