type OnlineDevSectionId = 'matchmaking' | 'rooms' | 'replay' | 'ranked';

interface OnlineDevMenuOptions {
  onClose(): void;
}

interface PadState {
  up: boolean;
  down: boolean;
  confirm: boolean;
  back: boolean;
  start: boolean;
}

interface OnlineDevSection {
  id: OnlineDevSectionId;
  title: string;
  summary: string;
  status: string;
}

const SECTIONS: OnlineDevSection[] = [
  {
    id: 'matchmaking',
    title: 'Matchmaking',
    summary: 'Queue and session test tools will appear here.',
    status: 'S2.22 target',
  },
  {
    id: 'rooms',
    title: 'Rooms',
    summary: 'Private room and lobby controls will appear here.',
    status: 'S2.23 target',
  },
  {
    id: 'replay',
    title: 'Replay',
    summary: 'Replay search and playback tools will appear here.',
    status: 'S2.24 target',
  },
  {
    id: 'ranked',
    title: 'Ranked',
    summary: 'Ranked progression inspection tools will appear here.',
    status: 'S2.25 target',
  },
];

function readButton(gamepad: Gamepad, index: number, threshold = 0.35): boolean {
  const button = gamepad.buttons[index];
  if (!button) {
    return false;
  }
  return button.pressed || button.value > threshold;
}

function readPadState(gamepad: Gamepad): PadState {
  const axisY = gamepad.axes[1] ?? 0;
  const threshold = 0.55;
  const dpadUp = readButton(gamepad, 12);
  const dpadDown = readButton(gamepad, 13);

  return {
    up: dpadUp || axisY < -threshold,
    down: dpadDown || axisY > threshold,
    confirm: readButton(gamepad, 0),
    back: readButton(gamepad, 1),
    start: readButton(gamepad, 9) || readButton(gamepad, 16),
  };
}

export class OnlineDevMenu {
  private readonly root: HTMLDivElement;
  private readonly sectionButtons: HTMLButtonElement[] = [];
  private readonly detailTitle: HTMLHeadingElement;
  private readonly detailSummary: HTMLParagraphElement;
  private readonly detailStatus: HTMLParagraphElement;
  private readonly prevPadStateByIndex = new Map<number, PadState>();
  private selectedIndex = 0;
  private rafId = 0;

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (this.root.hidden) {
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.setSelectedIndex(this.selectedIndex - 1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.setSelectedIndex(this.selectedIndex + 1);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      this.options.onClose();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.sectionButtons[this.selectedIndex]?.focus();
    }
  };

  public constructor(private readonly options: OnlineDevMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'online-dev-menu';
    this.root.hidden = true;

    const panel = document.createElement('section');
    panel.className = 'online-dev-panel';
    this.root.appendChild(panel);

    const title = document.createElement('h2');
    title.textContent = 'Online Dev Menu';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Use this shell to test backend online flows quickly.';
    panel.append(title, subtitle);

    const shell = document.createElement('div');
    shell.className = 'online-dev-shell';
    panel.appendChild(shell);

    const list = document.createElement('div');
    list.className = 'online-dev-list';
    shell.appendChild(list);

    for (const [index, section] of SECTIONS.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'online-dev-item';
      button.textContent = section.title;
      button.addEventListener('click', () => {
        this.setSelectedIndex(index);
      });
      list.appendChild(button);
      this.sectionButtons.push(button);
    }

    const detail = document.createElement('div');
    detail.className = 'online-dev-detail';
    shell.appendChild(detail);

    this.detailTitle = document.createElement('h3');
    this.detailSummary = document.createElement('p');
    this.detailStatus = document.createElement('p');
    this.detailStatus.className = 'online-dev-detail-status';
    detail.append(this.detailTitle, this.detailSummary, this.detailStatus);

    const hint = document.createElement('p');
    hint.className = 'online-dev-hint';
    hint.textContent = 'Controls: Up/Down or D-pad to select section. Esc/B to close.';
    panel.appendChild(hint);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'online-dev-close';
    closeButton.textContent = 'Back to Home';
    closeButton.addEventListener('click', () => this.options.onClose());
    panel.appendChild(closeButton);

    document.body.appendChild(this.root);
    this.setSelectedIndex(0);
    window.addEventListener('keydown', this.keydownHandler);
    this.pollGamepads();
  }

  public show(): void {
    this.root.hidden = false;
    this.prevPadStateByIndex.clear();
    this.setSelectedIndex(this.selectedIndex);
  }

  public hide(): void {
    this.root.hidden = true;
    this.prevPadStateByIndex.clear();
  }

  public dispose(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
    window.removeEventListener('keydown', this.keydownHandler);
    this.root.remove();
  }

  private setSelectedIndex(index: number): void {
    const max = SECTIONS.length - 1;
    const next = Math.max(0, Math.min(max, index));
    this.selectedIndex = next;
    const section = SECTIONS[next];

    for (let i = 0; i < this.sectionButtons.length; i += 1) {
      this.sectionButtons[i].classList.toggle('active', i === next);
    }

    this.detailTitle.textContent = section.title;
    this.detailSummary.textContent = section.summary;
    this.detailStatus.textContent = section.status;
  }

  private wasPressed(padIndex: number, state: PadState, key: keyof PadState): boolean {
    const previous = this.prevPadStateByIndex.get(padIndex);
    return state[key] && !previous?.[key];
  }

  private pollGamepads = (): void => {
    if (!this.root.hidden && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i += 1) {
        const pad = pads[i];
        if (!pad) {
          continue;
        }
        const state = readPadState(pad);
        if (this.wasPressed(pad.index, state, 'up')) {
          this.setSelectedIndex(this.selectedIndex - 1);
        }
        if (this.wasPressed(pad.index, state, 'down')) {
          this.setSelectedIndex(this.selectedIndex + 1);
        }
        if (this.wasPressed(pad.index, state, 'back') || this.wasPressed(pad.index, state, 'start')) {
          this.options.onClose();
        }
        if (this.wasPressed(pad.index, state, 'confirm')) {
          this.sectionButtons[this.selectedIndex]?.focus();
        }
        this.prevPadStateByIndex.set(pad.index, state);
      }
    }

    this.rafId = window.requestAnimationFrame(this.pollGamepads);
  };
}

export function createOnlineDevMenu(options: OnlineDevMenuOptions): OnlineDevMenu {
  return new OnlineDevMenu(options);
}
