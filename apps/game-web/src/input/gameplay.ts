import type { InputBindingStore } from './bindings';
import { createCombinedInput } from './combined';
import { createGamepadInput } from './gamepad';
import { createKeyboardInput } from './keyboard';
import { createMouseInput } from './mouse';

export function createGameplayInput(target: HTMLElement, bindingStore: InputBindingStore) {
  return createCombinedInput([
    createKeyboardInput(bindingStore),
    createGamepadInput(bindingStore),
    createMouseInput(target, bindingStore),
  ]);
}
