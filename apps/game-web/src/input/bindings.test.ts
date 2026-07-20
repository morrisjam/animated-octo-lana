import { describe, expect, test } from 'vitest';
import {
  rebindGamepad,
  rebindKeyboard,
  rebindMouse,
  resetInputBindingDevice,
} from './bindingEditor';
import {
  INPUT_BINDING_STORAGE_KEY,
  InputBindingStore,
  createDefaultInputBindingProfile,
  type InputBindingStorage,
} from './bindings';
import { sanitiseInputBindingProfile } from './bindingValidation';

class MemoryStorage implements InputBindingStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('input binding profiles', () => {
  test('preserves the legacy keyboard and controller layout and adds practical P1 mouse defaults', () => {
    const profile = createDefaultInputBindingProfile();

    expect(profile.keyboard.P1).toMatchObject({
      up: 'KeyW',
      boost: 'KeyF',
      launch: 'KeyT',
      breakLaunch: 'KeyV',
    });
    expect(profile.keyboard.P2).toMatchObject({
      up: 'KeyI',
      launch: 'BracketRight',
      parry: 'Quote',
    });
    expect(profile.gamepad.P1).toMatchObject({
      boost: 7,
      superBoost: 6,
      launch: 3,
      breakLaunch: 0,
    });
    expect(profile.mouse.P1).toMatchObject({
      launch: 0,
      special: 1,
      parry: 2,
      dunk: 3,
      breakLaunch: 4,
    });
    expect(Object.values(profile.mouse.P2).every((binding) => binding === null)).toBe(true);
  });

  test('sanitises malformed and reserved bindings without discarding valid unbound choices', () => {
    const profile = sanitiseInputBindingProfile({
      keyboard: {
        P1: { up: null, boost: 'Escape', launch: 'KeyN' },
      },
      gamepad: {
        P1: { boost: null, launch: 99 },
      },
      mouse: {
        P1: { boost: 7 },
        P2: { special: 1 },
      },
    });

    expect(profile.keyboard.P1.up).toBeNull();
    expect(profile.keyboard.P1.boost).toBe('KeyF');
    expect(profile.keyboard.P1.launch).toBe('KeyT');
    expect(profile.gamepad.P1.boost).toBeNull();
    expect(profile.gamepad.P1.launch).toBe(3);
    expect(profile.mouse.P1.boost).toBeNull();
    expect(profile.mouse.P2.special).toBe(1);
  });
});

describe('input binding store', () => {
  test('swaps shared keyboard bindings across players and persists the result', async () => {
    const storage = new MemoryStorage();
    const store = new InputBindingStore(storage);

    const result = rebindKeyboard(store, 'P1', 'up', 'KeyI');

    expect(result).toEqual({ swappedCommand: 'up', swappedPlayerId: 'P2' });
    expect(store.getProfile().keyboard.P1.up).toBe('KeyI');
    expect(store.getProfile().keyboard.P2.up).toBe('KeyW');
    expect(storage.values.has(INPUT_BINDING_STORAGE_KEY)).toBe(true);
    const reloaded = new InputBindingStore(storage);
    await reloaded.whenReady();
    expect(reloaded.getProfile().keyboard).toEqual(store.getProfile().keyboard);
  });

  test('swaps controller conflicts only inside the selected player profile', () => {
    const store = new InputBindingStore(null);

    const result = rebindGamepad(store, 'P1', 'boost', 6);

    expect(result).toEqual({ swappedCommand: 'superBoost', swappedPlayerId: 'P1' });
    expect(store.getProfile().gamepad.P1.boost).toBe(6);
    expect(store.getProfile().gamepad.P1.superBoost).toBe(7);
    expect(store.getProfile().gamepad.P2.boost).toBe(7);
    expect(store.getProfile().gamepad.P2.superBoost).toBe(6);
  });

  test('swaps shared mouse buttons across players and can reset one device', () => {
    const store = new InputBindingStore(null);
    rebindMouse(store, 'P2', 'boost', 0);

    expect(store.getProfile().mouse.P2.boost).toBe(0);
    expect(store.getProfile().mouse.P1.launch).toBeNull();

    resetInputBindingDevice(store, 'P1', 'mouse');
    expect(store.getProfile().mouse.P1.launch).toBe(0);
    expect(store.getProfile().mouse.P2.boost).toBeNull();
  });

  test('restores one keyboard layout without duplicating keys across players', () => {
    const store = new InputBindingStore(null);
    rebindKeyboard(store, 'P2', 'up', 'KeyW');

    resetInputBindingDevice(store, 'P1', 'keyboard');

    expect(store.getProfile().keyboard.P1.up).toBe('KeyW');
    expect(store.getProfile().keyboard.P2.up).toBe('KeyI');
    const allKeys = [
      ...Object.values(store.getProfile().keyboard.P1),
      ...Object.values(store.getProfile().keyboard.P2),
    ].filter((value): value is string => value !== null);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
