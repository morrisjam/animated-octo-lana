import type { PlayersById } from '../sim/types';

export const INPUT_BINDING_SCHEMA_VERSION = 1;
export const INPUT_BINDING_STORAGE_KEY = 'gravity_well.input_bindings.v1';

export const GAMEPLAY_ACTIONS = [
  'boost',
  'superBoost',
  'special',
  'launch',
  'dunk',
  'parry',
  'breakLaunch',
] as const;

export const KEYBOARD_COMMANDS = [
  'up',
  'down',
  'left',
  'right',
  ...GAMEPLAY_ACTIONS,
] as const;

export type GameplayAction = typeof GAMEPLAY_ACTIONS[number];
export type KeyboardCommand = typeof KEYBOARD_COMMANDS[number];
export type InputDevice = 'keyboard' | 'gamepad' | 'mouse';
export type KeyboardBinding = string | null;
export type ButtonBinding = number | null;
export type KeyboardPlayerBindings = Record<KeyboardCommand, KeyboardBinding>;
export type ButtonPlayerBindings = Record<GameplayAction, ButtonBinding>;

export interface InputBindingProfile {
  schemaVersion: typeof INPUT_BINDING_SCHEMA_VERSION;
  keyboard: PlayersById<KeyboardPlayerBindings>;
  gamepad: PlayersById<ButtonPlayerBindings>;
  mouse: PlayersById<ButtonPlayerBindings>;
}

export interface InputBindingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEFAULT_GAMEPAD_BINDINGS: ButtonPlayerBindings = {
  boost: 7,
  superBoost: 6,
  special: 2,
  launch: 3,
  dunk: 1,
  parry: 4,
  breakLaunch: 0,
};

const EMPTY_MOUSE_BINDINGS: ButtonPlayerBindings = {
  boost: null,
  superBoost: null,
  special: null,
  launch: null,
  dunk: null,
  parry: null,
  breakLaunch: null,
};

const DEFAULT_PROFILE: InputBindingProfile = {
  schemaVersion: INPUT_BINDING_SCHEMA_VERSION,
  keyboard: {
    P1: {
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      boost: 'KeyF',
      superBoost: 'KeyG',
      special: 'KeyR',
      launch: 'KeyT',
      dunk: 'KeyY',
      parry: 'KeyH',
      breakLaunch: 'KeyV',
    },
    P2: {
      up: 'KeyI',
      down: 'KeyK',
      left: 'KeyJ',
      right: 'KeyL',
      boost: 'KeyO',
      superBoost: 'KeyP',
      special: 'BracketLeft',
      launch: 'BracketRight',
      dunk: 'Backslash',
      parry: 'Quote',
      breakLaunch: 'Semicolon',
    },
  },
  gamepad: {
    P1: { ...DEFAULT_GAMEPAD_BINDINGS },
    P2: { ...DEFAULT_GAMEPAD_BINDINGS },
  },
  mouse: {
    P1: {
      ...EMPTY_MOUSE_BINDINGS,
      special: 1,
      launch: 0,
      dunk: 3,
      parry: 2,
      breakLaunch: 4,
    },
    P2: { ...EMPTY_MOUSE_BINDINGS },
  },
};

const RESERVED_KEYBOARD_CODES = new Set(['Escape', 'F1', 'KeyM', 'KeyN']);
const RESERVED_GAMEPAD_BUTTONS = new Set([8, 9, 12, 13, 14, 15, 16]);

function cloneKeyboardBindings(bindings: KeyboardPlayerBindings): KeyboardPlayerBindings {
  return { ...bindings };
}

function cloneButtonBindings(bindings: ButtonPlayerBindings): ButtonPlayerBindings {
  return { ...bindings };
}

export function cloneInputBindingProfile(profile: InputBindingProfile): InputBindingProfile {
  return {
    schemaVersion: INPUT_BINDING_SCHEMA_VERSION,
    keyboard: {
      P1: cloneKeyboardBindings(profile.keyboard.P1),
      P2: cloneKeyboardBindings(profile.keyboard.P2),
    },
    gamepad: {
      P1: cloneButtonBindings(profile.gamepad.P1),
      P2: cloneButtonBindings(profile.gamepad.P2),
    },
    mouse: {
      P1: cloneButtonBindings(profile.mouse.P1),
      P2: cloneButtonBindings(profile.mouse.P2),
    },
  };
}

export function createDefaultInputBindingProfile(): InputBindingProfile {
  return cloneInputBindingProfile(DEFAULT_PROFILE);
}

export function isKeyboardCodeAllowed(code: string): boolean {
  return code.length > 0 && code.length <= 48 && !RESERVED_KEYBOARD_CODES.has(code);
}

export function isGamepadButtonAllowed(button: number): boolean {
  return Number.isInteger(button)
    && button >= 0
    && button <= 31
    && !RESERVED_GAMEPAD_BUTTONS.has(button);
}

export function isMouseButtonAllowed(button: number): boolean {
  return Number.isInteger(button) && button >= 0 && button <= 4;
}

function resolveBrowserStorage(): InputBindingStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class InputBindingStore {
  private profile: InputBindingProfile;
  private revision = 0;
  private readonly readyPromise: Promise<void>;

  constructor(private readonly storage: InputBindingStorage | null = resolveBrowserStorage()) {
    this.profile = createDefaultInputBindingProfile();
    this.readyPromise = this.loadStoredProfile();
  }

  getProfile(): Readonly<InputBindingProfile> {
    return this.profile;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  setProfile(profile: InputBindingProfile): void {
    this.revision += 1;
    this.profile = cloneInputBindingProfile(profile);
    this.persist();
  }

  private loadStoredProfile(): Promise<void> {
    if (!this.storage) {
      return Promise.resolve();
    }
    let stored: string | null;
    try {
      stored = this.storage.getItem(INPUT_BINDING_STORAGE_KEY);
    } catch {
      return Promise.resolve();
    }
    if (!stored) {
      return Promise.resolve();
    }
    const startingRevision = this.revision;
    return import('./bindingValidation')
      .then(({ sanitiseInputBindingProfile }) => {
        if (this.revision === startingRevision) {
          this.profile = sanitiseInputBindingProfile(JSON.parse(stored));
        }
      })
      .catch(() => undefined);
  }

  private persist(): void {
    try {
      this.storage?.setItem(INPUT_BINDING_STORAGE_KEY, JSON.stringify(this.profile));
    } catch {
      // Runtime bindings still work when storage is blocked or full.
    }
  }
}

export function createInputBindingStore(storage?: InputBindingStorage | null): InputBindingStore {
  return storage === undefined ? new InputBindingStore() : new InputBindingStore(storage);
}
