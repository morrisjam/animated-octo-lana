import {
  GAMEPLAY_ACTIONS,
  INPUT_BINDING_SCHEMA_VERSION,
  KEYBOARD_COMMANDS,
  createDefaultInputBindingProfile,
  isGamepadButtonAllowed,
  isKeyboardCodeAllowed,
  isMouseButtonAllowed,
  type ButtonBinding,
  type ButtonPlayerBindings,
  type InputBindingProfile,
  type KeyboardBinding,
  type KeyboardPlayerBindings,
} from './bindings';

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitiseKeyboardPlayer(
  raw: unknown,
  fallback: KeyboardPlayerBindings,
): KeyboardPlayerBindings {
  const source = readObject(raw);
  const output = { ...fallback };
  for (const command of KEYBOARD_COMMANDS) {
    const value = source[command];
    output[command] = value === null
      ? null
      : typeof value === 'string' && isKeyboardCodeAllowed(value)
        ? value
        : fallback[command];
  }
  return output;
}

function sanitiseButtonPlayer(
  raw: unknown,
  fallback: ButtonPlayerBindings,
  isAllowed: (button: number) => boolean,
): ButtonPlayerBindings {
  const source = readObject(raw);
  const output = { ...fallback };
  for (const action of GAMEPLAY_ACTIONS) {
    const value = source[action];
    output[action] = value === null
      ? null
      : typeof value === 'number' && isAllowed(value)
        ? value
        : fallback[action];
  }
  return output;
}

export function sanitiseInputBindingProfile(raw: unknown): InputBindingProfile {
  const fallback = createDefaultInputBindingProfile();
  const source = readObject(raw);
  const keyboard = readObject(source.keyboard);
  const gamepad = readObject(source.gamepad);
  const mouse = readObject(source.mouse);
  return {
    schemaVersion: INPUT_BINDING_SCHEMA_VERSION,
    keyboard: {
      P1: sanitiseKeyboardPlayer(keyboard.P1, fallback.keyboard.P1),
      P2: sanitiseKeyboardPlayer(keyboard.P2, fallback.keyboard.P2),
    },
    gamepad: {
      P1: sanitiseButtonPlayer(gamepad.P1, fallback.gamepad.P1, isGamepadButtonAllowed),
      P2: sanitiseButtonPlayer(gamepad.P2, fallback.gamepad.P2, isGamepadButtonAllowed),
    },
    mouse: {
      P1: sanitiseButtonPlayer(mouse.P1, fallback.mouse.P1, isMouseButtonAllowed),
      P2: sanitiseButtonPlayer(mouse.P2, fallback.mouse.P2, isMouseButtonAllowed),
    },
  };
}
