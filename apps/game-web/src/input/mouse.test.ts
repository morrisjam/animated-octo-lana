import { describe, expect, test } from 'vitest';
import { createDefaultInputBindingProfile } from './bindings';
import { createEmptyPlayerInput } from './frame';
import { mapMouseButtonsToPlayerInput } from './mouse';

describe('mouse input mapping', () => {
  test('maps held mouse buttons to actions without synthesising movement', () => {
    const output = createEmptyPlayerInput();
    mapMouseButtonsToPlayerInput(
      new Set([0, 2]),
      createDefaultInputBindingProfile().mouse.P1,
      output,
    );

    expect(output).toMatchObject({
      moveX: 0,
      moveY: 0,
      launch: true,
      parry: true,
      special: false,
    });
  });
});
