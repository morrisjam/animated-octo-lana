import type { FrameInput, PlayerFrameInput } from '../sim/types';
import type { InputBindingStore, KeyboardPlayerBindings } from './bindings';
import { createEmptyFrameInput } from './frame';

export function mapKeyboardToPlayerInput(
  keys: ReadonlySet<string>,
  map: KeyboardPlayerBindings,
  output: PlayerFrameInput,
): void {
  const isDown = (code: string | null): boolean => code !== null && keys.has(code);
  const left = isDown(map.left);
  const right = isDown(map.right);
  const up = isDown(map.up);
  const down = isDown(map.down);

  output.moveX = (right ? 1 : 0) - (left ? 1 : 0);
  output.moveY = (up ? 1 : 0) - (down ? 1 : 0);
  output.boost = isDown(map.boost);
  output.superBoost = isDown(map.superBoost);
  output.special = isDown(map.special);
  output.launch = isDown(map.launch);
  output.dunk = isDown(map.dunk);
  output.parry = isDown(map.parry);
  output.breakLaunch = isDown(map.breakLaunch);
}

export class KeyboardInput {
  private keys = new Set<string>();
  private readonly frameInput = createEmptyFrameInput();

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!event.code) {
      return;
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!event.code) {
      return;
    }
    this.keys.delete(event.code);
  };

  private clearKeys = (): void => this.keys.clear();

  constructor(private readonly bindingStore: InputBindingStore) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
  }

  getFrameInput(): FrameInput {
    const bindings = this.bindingStore.getProfile().keyboard;
    mapKeyboardToPlayerInput(this.keys, bindings.P1, this.frameInput.p1);
    mapKeyboardToPlayerInput(this.keys, bindings.P2, this.frameInput.p2);
    return this.frameInput;
  }
}

export function createKeyboardInput(bindingStore: InputBindingStore): KeyboardInput {
  return new KeyboardInput(bindingStore);
}
