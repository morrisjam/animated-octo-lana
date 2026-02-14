import type { FrameInput, PlayerFrameInput } from '../sim/types';
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

function mapPadToPlayerInput(gamepad: Gamepad, output: PlayerFrameInput): void {
  const leftStickX = readAxis(gamepad.axes[0]);
  const leftStickY = -readAxis(gamepad.axes[1]);
  const dpadX = readDpadAxis(readButton(gamepad, 14), readButton(gamepad, 15));
  const dpadY = readDpadAxis(readButton(gamepad, 13), readButton(gamepad, 12));

  const moveX = leftStickX !== 0 ? leftStickX : dpadX;
  const moveY = leftStickY !== 0 ? leftStickY : dpadY;

  output.moveX = moveX;
  output.moveY = moveY;
  output.boost = readButton(gamepad, 7); // RT
  output.superBoost = readButton(gamepad, 6); // LT
  output.special = readButton(gamepad, 2); // X
  output.launch = readButton(gamepad, 3); // Y
  output.dunk = readButton(gamepad, 1); // B
  output.parry = readButton(gamepad, 4); // LB
  output.breakLaunch = readButton(gamepad, 0); // A
}

export class GamepadInput {
  private readonly frameInput = createEmptyFrameInput();

  getFrameInput(): FrameInput {
    clearPlayerInput(this.frameInput.p1);
    clearPlayerInput(this.frameInput.p2);

    const pads = navigator.getGamepads?.();
    if (!pads) {
      return this.frameInput;
    }

    let connectedCount = 0;
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      if (!pad) {
        continue;
      }
      if (connectedCount === 0) {
        mapPadToPlayerInput(pad, this.frameInput.p1);
      } else if (connectedCount === 1) {
        mapPadToPlayerInput(pad, this.frameInput.p2);
        break;
      }
      connectedCount += 1;
    }

    return this.frameInput;
  }
}

export function createGamepadInput(): GamepadInput {
  return new GamepadInput();
}
