import type { PlayerId, PlayersById } from '../sim/types';
import {
  formatGamepadButtonLabel,
  type GamepadGlyphFamily,
} from './controllerGlyphs';
import {
  GAMEPLAY_ACTIONS,
  KEYBOARD_COMMANDS,
  cloneInputBindingProfile,
  createDefaultInputBindingProfile,
  isGamepadButtonAllowed,
  isKeyboardCodeAllowed,
  isMouseButtonAllowed,
  type ButtonBinding,
  type GameplayAction,
  type InputBindingStore,
  type InputDevice,
  type KeyboardBinding,
  type KeyboardCommand,
} from './bindings';

export interface BindingChangeResult {
  swappedCommand: string | null;
  swappedPlayerId: PlayerId | null;
}

function rebindSharedDevice<TCommand extends string, TValue extends string | number | null>(
  store: InputBindingStore,
  device: 'keyboard' | 'mouse',
  playerId: PlayerId,
  command: TCommand,
  value: TValue,
  commands: readonly TCommand[],
): BindingChangeResult {
  const profile = cloneInputBindingProfile(store.getProfile());
  const bindingsByPlayer = profile[device] as unknown as PlayersById<Record<TCommand, TValue>>;
  const previous = bindingsByPlayer[playerId][command];
  let swappedCommand: TCommand | null = null;
  let swappedPlayerId: PlayerId | null = null;
  if (value !== null) {
    for (const candidatePlayerId of ['P1', 'P2'] as const) {
      const candidateBindings = bindingsByPlayer[candidatePlayerId];
      const candidateCommand = commands.find(
        (candidate) => (
          (candidatePlayerId !== playerId || candidate !== command)
          && candidateBindings[candidate] === value
        ),
      );
      if (candidateCommand) {
        swappedCommand = candidateCommand;
        swappedPlayerId = candidatePlayerId;
        break;
      }
    }
  }
  bindingsByPlayer[playerId][command] = value;
  if (swappedCommand && swappedPlayerId) {
    bindingsByPlayer[swappedPlayerId][swappedCommand] = previous;
  }
  store.setProfile(profile);
  return { swappedCommand, swappedPlayerId };
}

export function rebindKeyboard(
  store: InputBindingStore,
  playerId: PlayerId,
  command: KeyboardCommand,
  code: KeyboardBinding,
): BindingChangeResult {
  if (code !== null && !isKeyboardCodeAllowed(code)) {
    return { swappedCommand: null, swappedPlayerId: null };
  }
  return rebindSharedDevice(store, 'keyboard', playerId, command, code, KEYBOARD_COMMANDS);
}

export function rebindGamepad(
  store: InputBindingStore,
  playerId: PlayerId,
  action: GameplayAction,
  button: ButtonBinding,
): BindingChangeResult {
  if (button !== null && !isGamepadButtonAllowed(button)) {
    return { swappedCommand: null, swappedPlayerId: null };
  }
  const profile = cloneInputBindingProfile(store.getProfile());
  const bindings = profile.gamepad[playerId];
  const previous = bindings[action];
  const swappedCommand = button === null
    ? null
    : GAMEPLAY_ACTIONS.find(
      (candidate) => candidate !== action && bindings[candidate] === button,
    ) ?? null;
  bindings[action] = button;
  if (swappedCommand) {
    bindings[swappedCommand] = previous;
  }
  store.setProfile(profile);
  return { swappedCommand, swappedPlayerId: swappedCommand ? playerId : null };
}

export function rebindMouse(
  store: InputBindingStore,
  playerId: PlayerId,
  action: GameplayAction,
  button: ButtonBinding,
): BindingChangeResult {
  if (button !== null && !isMouseButtonAllowed(button)) {
    return { swappedCommand: null, swappedPlayerId: null };
  }
  return rebindSharedDevice(store, 'mouse', playerId, action, button, GAMEPLAY_ACTIONS);
}

export function resetInputBindingDevice(
  store: InputBindingStore,
  playerId: PlayerId,
  device: InputDevice,
): void {
  const defaults = createDefaultInputBindingProfile();
  if (device === 'keyboard') {
    for (const command of KEYBOARD_COMMANDS) {
      rebindKeyboard(store, playerId, command, defaults.keyboard[playerId][command]);
    }
    return;
  }
  if (device === 'mouse') {
    for (const action of GAMEPLAY_ACTIONS) {
      rebindMouse(store, playerId, action, defaults.mouse[playerId][action]);
    }
    return;
  }
  const profile = cloneInputBindingProfile(store.getProfile());
  profile[device][playerId] = { ...defaults[device][playerId] } as never;
  store.setProfile(profile);
}

export function resetAllInputBindings(store: InputBindingStore): void {
  store.setProfile(createDefaultInputBindingProfile());
}

export const INPUT_COMMAND_LABELS: Record<KeyboardCommand, string> = {
  up: 'Move Up',
  down: 'Move Down',
  left: 'Move Left',
  right: 'Move Right',
  boost: 'Boost',
  superBoost: 'Super Boost',
  special: 'Special',
  launch: 'Launch',
  dunk: 'Dunk',
  parry: 'Parry',
  breakLaunch: 'Launch Break',
};

const KEYBOARD_LABELS: Record<string, string> = {
  ArrowUp: 'Up Arrow',
  ArrowDown: 'Down Arrow',
  ArrowLeft: 'Left Arrow',
  ArrowRight: 'Right Arrow',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Quote: "'",
  Semicolon: ';',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
};

export function formatKeyboardBinding(code: KeyboardBinding): string {
  if (code === null) {
    return 'Unbound';
  }
  if (KEYBOARD_LABELS[code]) {
    return KEYBOARD_LABELS[code];
  }
  if (code.startsWith('Key')) {
    return code.slice(3);
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad')) {
    return `Numpad ${code.slice(6)}`;
  }
  return code;
}

export function formatGamepadBinding(
  button: ButtonBinding,
  family: GamepadGlyphFamily = 'universal',
): string {
  return formatGamepadButtonLabel(button, family);
}

const MOUSE_BUTTON_LABELS = ['Left Click', 'Middle Click', 'Right Click', 'Mouse Back', 'Mouse Forward'];

export function formatMouseBinding(button: ButtonBinding): string {
  return button === null ? 'Unbound' : MOUSE_BUTTON_LABELS[button] ?? `Mouse ${button}`;
}
