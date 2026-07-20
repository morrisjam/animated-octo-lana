import { describe, expect, test } from 'vitest';
import { createDefaultInputBindingProfile } from './bindings';
import { createEmptyPlayerInput } from './frame';
import { mapPadToPlayerInput } from './gamepad';

function createGamepad(pressedButtons: number[], axes = [0, 0]): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, index) => ({
    pressed: pressedButtons.includes(index),
    touched: pressedButtons.includes(index),
    value: pressedButtons.includes(index) ? 1 : 0,
  }));
  return { axes, buttons } as unknown as Gamepad;
}

describe('gamepad input mapping', () => {
  test('uses standard movement axes and remappable action buttons', () => {
    const output = createEmptyPlayerInput();
    const bindings = createDefaultInputBindingProfile().gamepad.P1;
    bindings.launch = 5;

    mapPadToPlayerInput(createGamepad([5, 7], [0.75, -0.5]), bindings, output);

    expect(output).toMatchObject({
      moveX: 0.75,
      moveY: 0.5,
      boost: true,
      launch: true,
      parry: false,
    });
  });

  test('falls back to the D-pad when the left stick is inside its deadzone', () => {
    const output = createEmptyPlayerInput();
    mapPadToPlayerInput(
      createGamepad([12, 14], [0.1, 0.1]),
      createDefaultInputBindingProfile().gamepad.P1,
      output,
    );

    expect(output.moveX).toBe(-1);
    expect(output.moveY).toBe(1);
  });
});
