import { describe, expect, test } from 'vitest';
import { createDefaultInputBindingProfile } from './bindings';
import { createEmptyPlayerInput } from './frame';
import { mapKeyboardToPlayerInput } from './keyboard';

describe('keyboard input mapping', () => {
  test('maps physical key codes to movement and simultaneous actions', () => {
    const output = createEmptyPlayerInput();
    mapKeyboardToPlayerInput(
      new Set(['KeyW', 'KeyD', 'KeyF', 'KeyT']),
      createDefaultInputBindingProfile().keyboard.P1,
      output,
    );

    expect(output).toMatchObject({
      moveX: 1,
      moveY: 1,
      boost: true,
      launch: true,
      superBoost: false,
    });
  });

  test('treats unbound commands as inactive', () => {
    const output = createEmptyPlayerInput();
    const bindings = createDefaultInputBindingProfile().keyboard.P1;
    bindings.up = null;
    bindings.launch = null;

    mapKeyboardToPlayerInput(new Set(['KeyW', 'KeyT']), bindings, output);

    expect(output.moveY).toBe(0);
    expect(output.launch).toBe(false);
  });
});
