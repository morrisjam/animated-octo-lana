import type { GamepadFamily } from '../../input/controllerGlyphs';

export type ControllerNavigationAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'page_previous'
  | 'page_next';

export interface ControllerNavigationGamepad {
  axes: ArrayLike<number>;
  buttons: ArrayLike<Pick<GamepadButton, 'pressed' | 'value'>>;
}

export type ControllerNavigationSample = Record<ControllerNavigationAction, boolean>;

export interface ControllerNavigationRepeatOptions {
  initialDelayMs?: number;
  repeatIntervalMs?: number;
}

export interface ControllerNavigationTarget {
  id: string;
  disabled?: boolean;
  hidden?: boolean;
  focus(): void;
  activate(): void;
}

export interface ControllerNavigationListOptions {
  orientation?: 'vertical' | 'horizontal';
  wrap?: boolean;
  onBack?: () => void;
  onHorizontalAdjust?: (
    direction: 'left' | 'right',
    target: ControllerNavigationTarget,
  ) => void;
  onPage?: (
    direction: 'previous' | 'next',
    target: ControllerNavigationTarget | null,
  ) => void;
}

const NAVIGATION_ACTIONS: readonly ControllerNavigationAction[] = [
  'up',
  'down',
  'left',
  'right',
  'confirm',
  'back',
  'page_previous',
  'page_next',
];

const REPEATABLE_ACTIONS = new Set<ControllerNavigationAction>([
  'up',
  'down',
  'left',
  'right',
]);

function buttonPressed(gamepad: ControllerNavigationGamepad, buttonIndex: number): boolean {
  const button = gamepad.buttons[buttonIndex];
  return Boolean(button && (button.pressed || button.value > 0.5));
}

function readAxis(gamepad: ControllerNavigationGamepad, axisIndex: number): number {
  const value = Number(gamepad.axes[axisIndex] ?? 0);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function resolveControllerNavigationSample(
  gamepad: ControllerNavigationGamepad,
  family: GamepadFamily,
  axisDeadzone = 0.55,
): ControllerNavigationSample {
  const x = readAxis(gamepad, 0);
  const y = readAxis(gamepad, 1);
  const confirmButton = family === 'nintendo' ? 1 : 0;
  const backButton = family === 'nintendo' ? 0 : 1;
  return {
    up: buttonPressed(gamepad, 12) || y <= -axisDeadzone,
    down: buttonPressed(gamepad, 13) || y >= axisDeadzone,
    left: buttonPressed(gamepad, 14) || x <= -axisDeadzone,
    right: buttonPressed(gamepad, 15) || x >= axisDeadzone,
    confirm: buttonPressed(gamepad, confirmButton),
    back: buttonPressed(gamepad, backButton),
    page_previous: buttonPressed(gamepad, 4),
    page_next: buttonPressed(gamepad, 5),
  };
}

export class ControllerNavigationRepeater {
  private readonly initialDelayMs: number;
  private readonly repeatIntervalMs: number;
  private readonly heldSince = new Map<ControllerNavigationAction, number>();
  private readonly lastEmittedAt = new Map<ControllerNavigationAction, number>();
  private previous = Object.fromEntries(
    NAVIGATION_ACTIONS.map((action) => [action, false]),
  ) as ControllerNavigationSample;

  constructor(options: ControllerNavigationRepeatOptions = {}) {
    this.initialDelayMs = Math.max(0, options.initialDelayMs ?? 360);
    this.repeatIntervalMs = Math.max(1, options.repeatIntervalMs ?? 120);
  }

  poll(sample: ControllerNavigationSample, nowMs: number): ControllerNavigationAction[] {
    const actions: ControllerNavigationAction[] = [];
    for (const action of NAVIGATION_ACTIONS) {
      const pressed = sample[action];
      if (!pressed) {
        this.heldSince.delete(action);
        this.lastEmittedAt.delete(action);
        continue;
      }
      if (!this.previous[action]) {
        this.heldSince.set(action, nowMs);
        this.lastEmittedAt.set(action, nowMs);
        actions.push(action);
        continue;
      }
      if (!REPEATABLE_ACTIONS.has(action)) {
        continue;
      }
      const heldSince = this.heldSince.get(action) ?? nowMs;
      const lastEmittedAt = this.lastEmittedAt.get(action) ?? heldSince;
      if (
        nowMs >= heldSince
        && nowMs - heldSince >= this.initialDelayMs
        && nowMs - lastEmittedAt >= this.repeatIntervalMs
      ) {
        this.lastEmittedAt.set(action, nowMs);
        actions.push(action);
      }
    }
    this.previous = { ...sample };
    return actions;
  }

  reset(): void {
    this.previous = Object.fromEntries(
      NAVIGATION_ACTIONS.map((action) => [action, false]),
    ) as ControllerNavigationSample;
    this.heldSince.clear();
    this.lastEmittedAt.clear();
  }
}

function targetIsAvailable(target: ControllerNavigationTarget): boolean {
  return !target.disabled && !target.hidden;
}

export function findNextControllerNavigationIndex(
  targets: readonly ControllerNavigationTarget[],
  currentIndex: number,
  direction: -1 | 1,
  wrap = true,
): number {
  if (targets.length === 0) {
    return -1;
  }
  const start = currentIndex >= 0 && currentIndex < targets.length
    ? currentIndex
    : direction > 0 ? -1 : targets.length;
  for (let offset = 1; offset <= targets.length; offset += 1) {
    let candidate = start + direction * offset;
    if (wrap) {
      candidate = ((candidate % targets.length) + targets.length) % targets.length;
    } else if (candidate < 0 || candidate >= targets.length) {
      break;
    }
    if (targetIsAvailable(targets[candidate])) {
      return candidate;
    }
  }
  return currentIndex >= 0 && targetIsAvailable(targets[currentIndex]) ? currentIndex : -1;
}

export class ControllerNavigationList {
  private targets: ControllerNavigationTarget[];
  private selectedIndex = -1;
  private readonly orientation: 'vertical' | 'horizontal';
  private readonly wrap: boolean;
  private readonly onBack: (() => void) | undefined;
  private readonly onHorizontalAdjust: ControllerNavigationListOptions['onHorizontalAdjust'];
  private readonly onPage: ControllerNavigationListOptions['onPage'];

  constructor(
    targets: readonly ControllerNavigationTarget[],
    options: ControllerNavigationListOptions = {},
  ) {
    this.targets = [...targets];
    this.orientation = options.orientation ?? 'vertical';
    this.wrap = options.wrap ?? true;
    this.onBack = options.onBack;
    this.onHorizontalAdjust = options.onHorizontalAdjust;
    this.onPage = options.onPage;
    this.selectedIndex = findNextControllerNavigationIndex(this.targets, -1, 1, false);
  }

  setTargets(targets: readonly ControllerNavigationTarget[]): void {
    const selectedId = this.getSelectedTarget()?.id ?? null;
    this.targets = [...targets];
    const retainedIndex = selectedId
      ? this.targets.findIndex((target) => target.id === selectedId && targetIsAvailable(target))
      : -1;
    this.selectedIndex = retainedIndex >= 0
      ? retainedIndex
      : findNextControllerNavigationIndex(this.targets, -1, 1, false);
  }

  getSelectedTarget(): ControllerNavigationTarget | null {
    return this.selectedIndex >= 0 ? this.targets[this.selectedIndex] ?? null : null;
  }

  focusSelected(): boolean {
    const target = this.getSelectedTarget();
    if (!target || !targetIsAvailable(target)) {
      return false;
    }
    target.focus();
    return true;
  }

  handle(action: ControllerNavigationAction): boolean {
    if (action === 'confirm') {
      const target = this.getSelectedTarget();
      if (!target || !targetIsAvailable(target)) {
        return false;
      }
      target.activate();
      return true;
    }
    if (action === 'back') {
      if (!this.onBack) {
        return false;
      }
      this.onBack();
      return true;
    }
    if (action === 'page_previous' || action === 'page_next') {
      if (!this.onPage) {
        return false;
      }
      this.onPage(action === 'page_previous' ? 'previous' : 'next', this.getSelectedTarget());
      return true;
    }
    if (
      this.orientation === 'vertical'
      && (action === 'left' || action === 'right')
      && this.onHorizontalAdjust
    ) {
      const target = this.getSelectedTarget();
      if (!target) {
        return false;
      }
      this.onHorizontalAdjust(action, target);
      return true;
    }
    const previousAction = this.orientation === 'vertical' ? 'up' : 'left';
    const nextAction = this.orientation === 'vertical' ? 'down' : 'right';
    if (action !== previousAction && action !== nextAction) {
      return false;
    }
    const nextIndex = findNextControllerNavigationIndex(
      this.targets,
      this.selectedIndex,
      action === previousAction ? -1 : 1,
      this.wrap,
    );
    if (nextIndex < 0) {
      return false;
    }
    this.selectedIndex = nextIndex;
    return this.focusSelected();
  }
}
