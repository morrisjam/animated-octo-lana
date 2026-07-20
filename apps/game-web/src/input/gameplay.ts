import type { InputBindingStore } from './bindings';
import { createCombinedInput } from './combined';
import { createGamepadInput, type GamepadInputOptions } from './gamepad';
import { createKeyboardInput } from './keyboard';
import { createMouseInput } from './mouse';

export function createGameplayInput(
  target: HTMLElement,
  bindingStore: InputBindingStore,
  gamepadOptions: GamepadInputOptions = {},
) {
  return createCombinedInput([
    createKeyboardInput(bindingStore),
    createGamepadInput(bindingStore, gamepadOptions),
    createMouseInput(target, bindingStore),
  ]);
}
