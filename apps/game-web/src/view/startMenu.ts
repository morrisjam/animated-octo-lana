import {
  CHARACTERS,
  CHARACTER_BY_ID,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_LOADOUT,
  type CharacterId,
} from '../sim/characters';
import type { PlayerId, PlayersById } from '../sim/types';

export type GameMode = 'endless' | 'best_of_3' | 'training';
export type WebAuthMenuAction = 'signin' | 'signup' | 'signout';
export type OnlineDevMenuTarget = 'matchmaking' | 'rooms' | 'replay' | 'ranked' | 'social';
export interface WebAuthMenuRequest {
  email?: string;
  password?: string;
  displayName?: string | null;
  upgradeCurrentGuest?: boolean;
}

type StartScreen = 'title' | 'login' | 'main' | 'online' | 'local' | 'replays' | 'rankings' | 'settings' | 'match_over';

interface StartMenuOptions {
  initialMode?: GameMode;
  initialLoadout?: PlayersById<CharacterId>;
  enabledModes?: GameMode[];
  initialAccountSummary?: string;
  onStartMode(mode: GameMode, loadout: PlayersById<CharacterId>): void;
  onOpenWebAuth?(action: WebAuthMenuAction, request?: WebAuthMenuRequest): Promise<void> | void;
  onOpenOnlineDevMenu?(target?: OnlineDevMenuTarget): void;
  onOpenReplayReview?(): void;
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
  training: 'Training',
};
const MODE_ORDER: GameMode[] = ['endless', 'best_of_3', 'training'];

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
    return ['endless', 'best_of_3'];
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

export class StartMenu {
  private readonly root: HTMLDivElement;
  private readonly roundBanner: HTMLDivElement;

  private readonly titlePanel: HTMLDivElement;
  private readonly loginPanel: HTMLDivElement;
  private readonly mainPanel: HTMLDivElement;
  private readonly onlinePanel: HTMLDivElement;
  private readonly localPanel: HTMLDivElement;
  private readonly replaysPanel: HTMLDivElement;
  private readonly rankingsPanel: HTMLDivElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly matchOverPanel: HTMLDivElement;

  private readonly rowsByScreen = new Map<StartScreen, HTMLElement[]>();
  private readonly rowIndexByScreen = new Map<StartScreen, number>();

  private readonly accountSummaryLabel: HTMLDivElement;
  private readonly loginAccountSummaryLabel: HTMLDivElement;
  private readonly authStatusLabel: HTMLDivElement;
  private readonly authEmailInput: HTMLInputElement;
  private readonly authPasswordInput: HTMLInputElement;
  private readonly authDisplayNameInput: HTMLInputElement;
  private readonly authUpgradeGuestInput: HTMLInputElement;
  private readonly signInButton: HTMLButtonElement;
  private readonly signUpButton: HTMLButtonElement;
  private readonly signOutButton: HTMLButtonElement;
  private readonly localModeButton: HTMLButtonElement;
  private readonly p1CharacterButton: HTMLButtonElement;
  private readonly p2CharacterButton: HTMLButtonElement;
  private readonly localCharacterList: HTMLDivElement;

  private readonly matchButtons: HTMLButtonElement[] = [];
  private readonly matchTitle: HTMLHeadingElement;
  private readonly matchSubtitle: HTMLParagraphElement;

  private readonly prevPadStateByIndex = new Map<number, PadState>();
  private currentScreen: StartScreen = 'title';
  private rafId = 0;

  private readonly enabledModes: GameMode[];
  private currentMode: GameMode;
  private currentLoadout: PlayersById<CharacterId>;
  private accountSummary: string;
  private isAuthenticated = false;
  private authBusy = false;

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
      if (this.currentScreen === 'local') {
        event.preventDefault();
        this.applyLocalHorizontal(-1);
      }
      return;
    }
    if (event.key === 'ArrowRight') {
      if (this.currentScreen === 'local') {
        event.preventDefault();
        this.applyLocalHorizontal(1);
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
    this.currentMode = options.initialMode && this.enabledModes.includes(options.initialMode)
      ? options.initialMode
      : this.enabledModes[0];
    this.currentLoadout = cloneLoadout(options.initialLoadout ?? DEFAULT_CHARACTER_LOADOUT);
    this.accountSummary = options.initialAccountSummary ?? 'Guest Account';

    this.root = document.createElement('div');
    this.root.className = 'start-menu';
    this.root.hidden = true;

    this.titlePanel = this.createPanel('Gravity Well', 'Press continue to enter the portal.');
    this.loginPanel = this.createPanel('Login', 'Sign in, sign up, or continue as guest.');
    this.mainPanel = this.createPanel('Main Menu', 'Choose a category.');
    this.onlinePanel = this.createPanel('Online', 'Matchmaking and custom rooms.');
    this.localPanel = this.createPanel('Local', 'Local match setup.');
    this.replaysPanel = this.createPanel('Replays', 'Review archived and fixture replays.');
    this.rankingsPanel = this.createPanel('Rankings', 'Ranked snapshot and leaderboard entry point.');
    this.settingsPanel = this.createPanel('Settings', 'Account and social options.');

    const continueRow = this.createActionRow('Continue', () => {
      this.setScreen('login');
    });
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
    const loginBackRow = this.createActionRow('Back', () => {
      this.setScreen('title');
    });
    this.loginPanel.append(signInRow.row, signUpRow.row, signOutRow.row, guestRow.row, loginBackRow.row);
    this.registerRows('login', [signInRow.row, signUpRow.row, signOutRow.row, guestRow.row, loginBackRow.row]);

    const mainAccountRow = document.createElement('div');
    mainAccountRow.className = 'start-menu-row';
    this.accountSummaryLabel = document.createElement('div');
    this.accountSummaryLabel.className = 'start-row-label';
    this.accountSummaryLabel.textContent = this.accountSummary;
    mainAccountRow.appendChild(this.accountSummaryLabel);
    this.mainPanel.appendChild(mainAccountRow);

    const mainOnlineRow = this.createActionRow('Online', () => {
      this.setScreen('online');
    });
    const mainLocalRow = this.createActionRow('Local', () => {
      this.setScreen('local');
    });
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

    this.mainPanel.append(
      mainOnlineRow.row,
      mainLocalRow.row,
      mainReplaysRow.row,
      mainRankingsRow.row,
      mainSettingsRow.row,
      mainBackRow.row,
    );
    this.registerRows('main', [
      mainOnlineRow.row,
      mainLocalRow.row,
      mainReplaysRow.row,
      mainRankingsRow.row,
      mainSettingsRow.row,
      mainBackRow.row,
    ]);

    const onlineRankedRow = this.createActionRow('Ranked', () => {
      this.options.onOpenOnlineDevMenu?.('matchmaking');
    });
    const onlineRoomRow = this.createActionRow('Custom Room', () => {
      this.options.onOpenOnlineDevMenu?.('rooms');
    });
    const onlineBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    this.onlinePanel.append(onlineRankedRow.row, onlineRoomRow.row, onlineBackRow.row);
    this.registerRows('online', [onlineRankedRow.row, onlineRoomRow.row, onlineBackRow.row]);

    const localModeRow = this.createActionRow('', () => {
      this.currentMode = getNextMode(this.currentMode, this.enabledModes, 1);
      this.refreshLocalRows();
    });
    this.localModeButton = localModeRow.button;

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

    const localStartRow = this.createActionRow('Start Local Match', () => {
      this.startLocalMatch();
    }, true);
    const localBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });

    this.localPanel.append(localModeRow.row, localP1Row.row, localP2Row.row, this.localCharacterList, localStartRow.row, localBackRow.row);
    this.registerRows('local', [localModeRow.row, localP1Row.row, localP2Row.row, localStartRow.row, localBackRow.row]);

    const replayArchiveRow = this.createActionRow('Replay Archive', () => {
      this.options.onOpenOnlineDevMenu?.('replay');
    });
    const replayFixtureRow = this.createActionRow('Replay Review (Smoke Fixture)', () => {
      this.options.onOpenReplayReview?.();
    });
    const replayBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    this.replaysPanel.append(replayArchiveRow.row, replayFixtureRow.row, replayBackRow.row);
    this.registerRows('replays', [replayArchiveRow.row, replayFixtureRow.row, replayBackRow.row]);

    const rankingsSnapshotRow = this.createActionRow('Ranked Snapshot', () => {
      this.options.onOpenOnlineDevMenu?.('ranked');
    });
    const rankingsBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    this.rankingsPanel.append(rankingsSnapshotRow.row, rankingsBackRow.row);
    this.registerRows('rankings', [rankingsSnapshotRow.row, rankingsBackRow.row]);

    const settingsAccountRow = this.createActionRow('Account', () => {
      this.setScreen('login');
    });
    const settingsSocialRow = this.createActionRow('Social', () => {
      this.options.onOpenOnlineDevMenu?.('social');
    });
    const settingsBackRow = this.createActionRow('Back', () => {
      this.setScreen('main');
    });
    this.settingsPanel.append(settingsAccountRow.row, settingsSocialRow.row, settingsBackRow.row);
    this.registerRows('settings', [settingsAccountRow.row, settingsSocialRow.row, settingsBackRow.row]);

    const padHint = document.createElement('p');
    padHint.className = 'start-pad-hint';
    padHint.textContent = 'Controls: Up/Down to navigate, Left/Right to adjust local selectors, A/Enter confirm, B/Esc back.';
    this.mainPanel.appendChild(padHint.cloneNode(true));
    this.onlinePanel.appendChild(padHint.cloneNode(true));
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
    this.matchSubtitle.textContent = '';
    this.matchOverPanel.append(this.matchTitle, this.matchSubtitle);

    const playAgainButton = document.createElement('button');
    playAgainButton.type = 'button';
    playAgainButton.className = 'start-action';
    playAgainButton.textContent = 'Play Again';
    playAgainButton.addEventListener('click', () => this.options.onPlayAgain());

    const homeButton = document.createElement('button');
    homeButton.type = 'button';
    homeButton.className = 'start-action';
    homeButton.textContent = 'Return to Home';
    homeButton.addEventListener('click', () => this.options.onReturnHome());

    this.matchButtons.push(playAgainButton, homeButton);
    this.matchOverPanel.append(playAgainButton, homeButton);

    this.root.append(
      this.titlePanel,
      this.loginPanel,
      this.mainPanel,
      this.onlinePanel,
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

  public showMatchOver(winner: PlayerId, p1Wins: number, p2Wins: number): void {
    this.root.hidden = false;
    this.currentScreen = 'match_over';
    this.prevPadStateByIndex.clear();
    this.matchTitle.textContent = `${winner} wins the match`;
    this.matchSubtitle.textContent = `Final rounds: P1 ${p1Wins} - ${p2Wins} P2`;
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
  }

  public setAuthState(isAuthenticated: boolean): void {
    this.isAuthenticated = isAuthenticated;
    this.signOutButton.disabled = !this.isAuthenticated || this.authBusy;
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

  private createPanel(title: string, subtitle: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'start-panel start-home-panel';
    panel.hidden = true;

    const heading = document.createElement('h1');
    heading.textContent = title;
    const sub = document.createElement('p');
    sub.textContent = subtitle;
    panel.append(heading, sub);

    return panel;
  }

  private createActionRow(label: string, onActivate: () => void | Promise<void>, primary = false): { row: HTMLDivElement; button: HTMLButtonElement } {
    const row = document.createElement('div');
    row.className = 'start-menu-row';
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
    this.localModeButton.textContent = `Mode: ${MODE_LABELS[this.currentMode]}`;

    const p1 = CHARACTER_BY_ID[this.currentLoadout.P1];
    const p2 = CHARACTER_BY_ID[this.currentLoadout.P2];
    this.p1CharacterButton.textContent = `P1: ${p1.displayName} (${p1.mechanicsTag})`;
    this.p2CharacterButton.textContent = `P2: ${p2.displayName} (${p2.mechanicsTag})`;

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
    this.options.onStartMode(this.currentMode, cloneLoadout(this.currentLoadout));
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unexpected authentication failure.';
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
      this.shiftCharacter('P1', direction);
      return;
    }
    if (rowIndex === 2) {
      this.shiftCharacter('P2', direction);
    }
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
      case 'match_over':
        this.options.onReturnHome();
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
          this.applyLocalHorizontal(-1);
        }
        if (this.wasPressed(primaryPad.index, state, 'right')) {
          this.applyLocalHorizontal(1);
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
