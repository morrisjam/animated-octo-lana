import type { FrameInput, PlayerFrameInput } from '../sim/types';
import type { ButtonPlayerBindings, InputBindingStore } from './bindings';
import { createEmptyFrameInput } from './frame';

const AXIS_DEADZONE = 0.2;
const BUTTON_THRESHOLD = 0.35;

function readAxis(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (Math.abs(value) < AXIS_DEADZONE) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function readButton(gamepad: Gamepad, index: number): boolean {
  const button = gamepad.buttons[index];
  if (!button) {
    return false;
  }
  return button.pressed || button.value > BUTTON_THRESHOLD;
}

function readDpadAxis(negative: boolean, positive: boolean): number {
  if (negative === positive) {
    return 0;
  }
  return positive ? 1 : -1;
}

function clearPlayerInput(output: PlayerFrameInput): void {
  output.moveX = 0;
  output.moveY = 0;
  output.boost = false;
  output.superBoost = false;
  output.special = false;
  output.launch = false;
  output.dunk = false;
  output.parry = false;
  output.breakLaunch = false;
}

export function mapPadToPlayerInput(
  gamepad: Gamepad,
  bindings: ButtonPlayerBindings,
  output: PlayerFrameInput,
): void {
  const leftStickX = readAxis(gamepad.axes[0]);
  const leftStickY = -readAxis(gamepad.axes[1]);
  const dpadX = readDpadAxis(readButton(gamepad, 14), readButton(gamepad, 15));
  const dpadY = readDpadAxis(readButton(gamepad, 13), readButton(gamepad, 12));

  const moveX = leftStickX !== 0 ? leftStickX : dpadX;
  const moveY = leftStickY !== 0 ? leftStickY : dpadY;

  output.moveX = moveX;
  output.moveY = moveY;
  output.boost = bindings.boost !== null && readButton(gamepad, bindings.boost);
  output.superBoost = bindings.superBoost !== null && readButton(gamepad, bindings.superBoost);
  output.special = bindings.special !== null && readButton(gamepad, bindings.special);
  output.launch = bindings.launch !== null && readButton(gamepad, bindings.launch);
  output.dunk = bindings.dunk !== null && readButton(gamepad, bindings.dunk);
  output.parry = bindings.parry !== null && readButton(gamepad, bindings.parry);
  output.breakLaunch = bindings.breakLaunch !== null && readButton(gamepad, bindings.breakLaunch);
}

export class GamepadInput {
  private readonly frameInput = createEmptyFrameInput();

  constructor(private readonly bindingStore: InputBindingStore) {}

  getFrameInput(): FrameInput {
    clearPlayerInput(this.frameInput.p1);
    clearPlayerInput(this.frameInput.p2);

    const pads = navigator.getGamepads?.();
    if (!pads) {
      return this.frameInput;
    }

    let connectedCount = 0;
    const bindings = this.bindingStore.getProfile().gamepad;
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      if (!pad) {
        continue;
      }
      if (connectedCount === 0) {
        mapPadToPlayerInput(pad, bindings.P1, this.frameInput.p1);
      } else if (connectedCount === 1) {
        mapPadToPlayerInput(pad, bindings.P2, this.frameInput.p2);
        break;
      }
      connectedCount += 1;
    }

    return this.frameInput;
  }
}

export function createGamepadInput(bindingStore: InputBindingStore): GamepadInput {
  return new GamepadInput(bindingStore);
}
