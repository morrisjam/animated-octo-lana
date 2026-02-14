import {
  CHARACTERS,
  CHARACTER_BY_ID,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_LOADOUT,
  type CharacterId,
} from '../sim/characters';
import type { PlayerId, PlayersById } from '../sim/types';

export type GameMode = 'endless' | 'best_of_3' | 'training';

interface StartMenuOptions {
  initialMode?: GameMode;
  initialLoadout?: PlayersById<CharacterId>;
  enabledModes?: GameMode[];
  onStartMode(mode: GameMode, loadout: PlayersById<CharacterId>): void;
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
    confirm: readButton(gamepad, 0), // A
    back: readButton(gamepad, 1), // B
    start: readButton(gamepad, 9) || readButton(gamepad, 16), // Start/Menu
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

export class StartMenu {
  private readonly root: HTMLDivElement;
  private readonly homePanel: HTMLDivElement;
  private readonly matchOverPanel: HTMLDivElement;
  private readonly roundBanner: HTMLDivElement;
  private readonly homeRows: HTMLElement[] = [];
  private readonly modeButtons = new Map<GameMode, HTMLButtonElement>();
  private readonly p1CharacterLabel: HTMLDivElement;
  private readonly p2CharacterLabel: HTMLDivElement;
  private readonly p1CharacterMeta: HTMLDivElement;
  private readonly p2CharacterMeta: HTMLDivElement;
  private readonly characterList: HTMLDivElement;
  private readonly matchButtons: HTMLButtonElement[] = [];
  private readonly matchTitle: HTMLHeadingElement;
  private readonly matchSubtitle: HTMLParagraphElement;
  private readonly prevPadStateByIndex = new Map<number, PadState>();
  private readonly startRowIndex: number;
  private readonly replayRowIndex: number | null;

  private currentMode: GameMode;
  private readonly enabledModes: GameMode[];
  private currentLoadout: PlayersById<CharacterId>;
  private homeRow = 0;
  private matchSelection = 0;
  private activePanel: 'home' | 'match_over' = 'home';
  private rafId = 0;

  constructor(private readonly options: StartMenuOptions) {
    this.enabledModes = sanitiseEnabledModes(options.enabledModes);
    this.currentMode = options.initialMode && this.enabledModes.includes(options.initialMode)
      ? options.initialMode
      : this.enabledModes[0];
    this.currentLoadout = cloneLoadout(options.initialLoadout ?? DEFAULT_CHARACTER_LOADOUT);

    this.root = document.createElement('div');
    this.root.className = 'start-menu';
    this.root.hidden = true;

    this.homePanel = document.createElement('div');
    this.homePanel.className = 'start-panel start-home-panel';
    this.root.appendChild(this.homePanel);

    const title = document.createElement('h1');
    title.textContent = 'Gravity Well';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Choose mode and character archetypes before each match.';
    this.homePanel.append(title, subtitle);

    const modeRow = document.createElement('div');
    modeRow.className = 'start-menu-row';
    modeRow.appendChild(this.createRowLabel('Mode'));
    const modeActions = document.createElement('div');
    modeActions.className = 'start-mode-actions';
    for (const mode of this.enabledModes) {
      const button = this.createModeButton(mode, MODE_LABELS[mode]);
      this.modeButtons.set(mode, button);
      modeActions.appendChild(button);
    }
    modeRow.appendChild(modeActions);
    this.homePanel.appendChild(modeRow);
    this.homeRows.push(modeRow);

    const p1Row = document.createElement('div');
    p1Row.className = 'start-menu-row';
    p1Row.appendChild(this.createRowLabel('P1 Character'));
    const p1Picker = this.createCharacterPicker('P1');
    this.p1CharacterLabel = p1Picker.label;
    this.p1CharacterMeta = p1Picker.meta;
    p1Row.appendChild(p1Picker.root);
    this.homePanel.appendChild(p1Row);
    this.homeRows.push(p1Row);

    const p2Row = document.createElement('div');
    p2Row.className = 'start-menu-row';
    p2Row.appendChild(this.createRowLabel('P2 Character'));
    const p2Picker = this.createCharacterPicker('P2');
    this.p2CharacterLabel = p2Picker.label;
    this.p2CharacterMeta = p2Picker.meta;
    p2Row.appendChild(p2Picker.root);
    this.homePanel.appendChild(p2Row);
    this.homeRows.push(p2Row);

    const startRow = document.createElement('div');
    startRow.className = 'start-menu-row';
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'start-action primary';
    startButton.textContent = 'Start Match';
    startButton.addEventListener('click', () => this.startMatch());
    startRow.appendChild(startButton);
    this.homePanel.appendChild(startRow);
    this.homeRows.push(startRow);
    this.startRowIndex = this.homeRows.length - 1;

    let replayRowIndex: number | null = null;
    if (this.options.onOpenReplayReview) {
      const replayRow = document.createElement('div');
      replayRow.className = 'start-menu-row';
      const replayButton = document.createElement('button');
      replayButton.type = 'button';
      replayButton.className = 'start-action';
      replayButton.textContent = 'Replay Review (Smoke Fixture)';
      replayButton.addEventListener('click', () => this.openReplayReview());
      replayRow.appendChild(replayButton);
      this.homePanel.appendChild(replayRow);
      this.homeRows.push(replayRow);
      replayRowIndex = this.homeRows.length - 1;
    }
    this.replayRowIndex = replayRowIndex;

    const padHint = document.createElement('p');
    padHint.className = 'start-pad-hint';
    padHint.textContent = 'Pad controls: D-pad/left stick to move, A to confirm, Start to begin.';
    this.homePanel.appendChild(padHint);

    this.characterList = document.createElement('div');
    this.characterList.className = 'start-character-list';
    this.homePanel.appendChild(this.characterList);
    this.renderCharacterList();

    this.matchOverPanel = document.createElement('div');
    this.matchOverPanel.className = 'start-panel start-match-panel';
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

    this.roundBanner = document.createElement('div');
    this.roundBanner.className = 'round-banner';
    this.roundBanner.hidden = true;
    this.roundBanner.innerHTML = '<div class="round-banner-title"></div><div class="round-banner-subtitle"></div>';

    document.body.append(this.root, this.roundBanner);

    this.refreshHomeUI();
    this.setMatchSelection(0);
    this.bindKeyboardNavigation();
    this.pollGamepads();
  }

  showHome(): void {
    this.activePanel = 'home';
    this.root.hidden = false;
    this.homePanel.hidden = false;
    this.matchOverPanel.hidden = true;
    this.prevPadStateByIndex.clear();
    this.refreshHomeUI();
  }

  hideHome(): void {
    this.root.hidden = true;
    this.prevPadStateByIndex.clear();
  }

  showRoundBanner(winner: PlayerId, subtitle: string): void {
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

  hideRoundBanner(): void {
    this.roundBanner.hidden = true;
  }

  showMatchOver(winner: PlayerId, p1Wins: number, p2Wins: number): void {
    this.root.hidden = false;
    this.activePanel = 'match_over';
    this.homePanel.hidden = true;
    this.matchOverPanel.hidden = false;
    this.prevPadStateByIndex.clear();
    this.matchTitle.textContent = `${winner} wins the match`;
    this.matchSubtitle.textContent = `Final rounds: P1 ${p1Wins} - ${p2Wins} P2`;
    this.setMatchSelection(0);
  }

  private createRowLabel(text: string): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'start-row-label';
    label.textContent = text;
    return label;
  }

  private createModeButton(mode: GameMode, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-mode-btn';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.currentMode = mode;
      this.refreshHomeUI();
    });
    return button;
  }

  private createCharacterPicker(playerId: PlayerId): { root: HTMLDivElement; label: HTMLDivElement; meta: HTMLDivElement } {
    const root = document.createElement('div');
    root.className = 'start-character-picker';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'start-character-step';
    prev.textContent = 'Prev';
    prev.addEventListener('click', () => this.shiftCharacter(playerId, -1));

    const valueWrap = document.createElement('div');
    valueWrap.className = 'start-character-value';

    const label = document.createElement('div');
    label.className = 'start-character-name';

    const meta = document.createElement('div');
    meta.className = 'start-character-meta';

    valueWrap.append(label, meta);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'start-character-step';
    next.textContent = 'Next';
    next.addEventListener('click', () => this.shiftCharacter(playerId, 1));

    root.append(prev, valueWrap, next);
    return { root, label, meta };
  }

  private refreshHomeUI(): void {
    for (const [mode, button] of this.modeButtons.entries()) {
      button.classList.toggle('active', this.currentMode === mode);
    }

    const p1Character = CHARACTER_BY_ID[this.currentLoadout.P1];
    const p2Character = CHARACTER_BY_ID[this.currentLoadout.P2];
    this.p1CharacterLabel.textContent = p1Character.displayName;
    this.p2CharacterLabel.textContent = p2Character.displayName;
    this.p1CharacterMeta.textContent = `${p1Character.blurb} (${p1Character.mechanicsTag})`;
    this.p2CharacterMeta.textContent = `${p2Character.blurb} (${p2Character.mechanicsTag})`;

    for (let i = 0; i < this.homeRows.length; i += 1) {
      this.homeRows[i].classList.toggle('active', this.homeRow === i);
    }
    this.renderCharacterList();
  }

  private renderCharacterList(): void {
    this.characterList.innerHTML = '';
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
      this.characterList.appendChild(item);
    }
  }

  private shiftCharacter(playerId: PlayerId, direction: 1 | -1): void {
    const current = this.currentLoadout[playerId];
    this.currentLoadout[playerId] = cycleCharacter(current, direction);
    this.refreshHomeUI();
  }

  private startMatch(): void {
    this.options.onStartMode(this.currentMode, cloneLoadout(this.currentLoadout));
  }

  private setMatchSelection(index: number): void {
    this.matchSelection = Math.max(0, Math.min(this.matchButtons.length - 1, index));
    for (let i = 0; i < this.matchButtons.length; i += 1) {
      this.matchButtons[i].classList.toggle('active', i === this.matchSelection);
    }
  }

  private bindKeyboardNavigation(): void {
    window.addEventListener('keydown', (event) => {
      if (this.root.hidden) {
        return;
      }

      if (this.activePanel === 'home') {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.homeRow = this.clampHomeRow(this.homeRow - 1);
          this.refreshHomeUI();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.homeRow = this.clampHomeRow(this.homeRow + 1);
          this.refreshHomeUI();
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          this.applyHomeHorizontal(-1);
          return;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          this.applyHomeHorizontal(1);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.activateHomeRow();
        }
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.setMatchSelection(this.matchSelection - 1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.setMatchSelection(this.matchSelection + 1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.matchButtons[this.matchSelection].click();
      }
    });
  }

  private applyHomeHorizontal(direction: 1 | -1): void {
    if (this.homeRow === 0) {
      if (this.enabledModes.length > 1) {
        this.currentMode = getNextMode(this.currentMode, this.enabledModes, direction);
        this.refreshHomeUI();
      }
      return;
    }
    if (this.homeRow === 1) {
      this.shiftCharacter('P1', direction);
      return;
    }
    if (this.homeRow === 2) {
      this.shiftCharacter('P2', direction);
    }
  }

  private activateHomeRow(): void {
    if (this.homeRow === 0) {
      if (this.enabledModes.length > 1) {
        this.currentMode = getNextMode(this.currentMode, this.enabledModes, 1);
        this.refreshHomeUI();
      }
      return;
    }
    if (this.homeRow === 1) {
      this.shiftCharacter('P1', 1);
      return;
    }
    if (this.homeRow === 2) {
      this.shiftCharacter('P2', 1);
      return;
    }
    if (this.homeRow === this.startRowIndex) {
      this.startMatch();
      return;
    }
    if (this.replayRowIndex !== null && this.homeRow === this.replayRowIndex) {
      this.openReplayReview();
    }
  }

  private wasPressed(padIndex: number, state: PadState, key: keyof PadState): boolean {
    const previous = this.prevPadStateByIndex.get(padIndex);
    return state[key] && !previous?.[key];
  }

  private handleHomePad(padIndex: number, state: PadState, isPrimary: boolean): void {
    if (isPrimary) {
      if (this.wasPressed(padIndex, state, 'up')) {
        this.homeRow = this.clampHomeRow(this.homeRow - 1);
        this.refreshHomeUI();
      }
      if (this.wasPressed(padIndex, state, 'down')) {
        this.homeRow = this.clampHomeRow(this.homeRow + 1);
        this.refreshHomeUI();
      }
      if (this.wasPressed(padIndex, state, 'left')) {
        this.applyHomeHorizontal(-1);
      }
      if (this.wasPressed(padIndex, state, 'right')) {
        this.applyHomeHorizontal(1);
      }
      if (this.wasPressed(padIndex, state, 'confirm')) {
        this.activateHomeRow();
      }
      if (this.wasPressed(padIndex, state, 'start')) {
        this.startMatch();
      }
      return;
    }

    if (this.wasPressed(padIndex, state, 'left')) {
      this.shiftCharacter('P2', -1);
    }
    if (this.wasPressed(padIndex, state, 'right') || this.wasPressed(padIndex, state, 'confirm')) {
      this.shiftCharacter('P2', 1);
    }
    if (this.wasPressed(padIndex, state, 'start')) {
      this.startMatch();
    }
  }

  private openReplayReview(): void {
    this.options.onOpenReplayReview?.();
  }

  private clampHomeRow(value: number): number {
    const max = Math.max(0, this.homeRows.length - 1);
    if (value <= 0) {
      return 0;
    }
    if (value >= max) {
      return max;
    }
    return value;
  }

  private handleMatchPad(padIndex: number, state: PadState): void {
    if (this.wasPressed(padIndex, state, 'up')) {
      this.setMatchSelection(this.matchSelection - 1);
    }
    if (this.wasPressed(padIndex, state, 'down')) {
      this.setMatchSelection(this.matchSelection + 1);
    }
    if (this.wasPressed(padIndex, state, 'confirm') || this.wasPressed(padIndex, state, 'start')) {
      this.matchButtons[this.matchSelection].click();
    }
    if (this.wasPressed(padIndex, state, 'back')) {
      this.options.onReturnHome();
    }
  }

  private pollGamepads = (): void => {
    if (this.root.hidden || !navigator.getGamepads) {
      this.rafId = window.requestAnimationFrame(this.pollGamepads);
      return;
    }

    const pads = navigator.getGamepads();
    let connectedOrder = 0;
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      if (!pad) {
        continue;
      }
      const state = readPadState(pad);
      if (this.activePanel === 'home') {
        this.handleHomePad(pad.index, state, connectedOrder === 0);
      } else {
        this.handleMatchPad(pad.index, state);
      }
      this.prevPadStateByIndex.set(pad.index, state);
      connectedOrder += 1;
    }

    this.rafId = window.requestAnimationFrame(this.pollGamepads);
  };

  dispose(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
  }
}

export function createStartMenu(options: StartMenuOptions): StartMenu {
  return new StartMenu(options);
}
