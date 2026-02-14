import type { FrameInput } from '../sim/types';
import type { PlayerFrameInput } from '../sim/types';
import { createEmptyFrameInput } from './frame';

export interface FrameInputSource {
  getFrameInput(): FrameInput;
  dispose?(): void;
}

function mergePlayerInput(target: PlayerFrameInput, source: PlayerFrameInput): void {
  target.moveX = Math.abs(target.moveX) >= Math.abs(source.moveX) ? target.moveX : source.moveX;
  target.moveY = Math.abs(target.moveY) >= Math.abs(source.moveY) ? target.moveY : source.moveY;
  target.boost = target.boost || source.boost;
  target.superBoost = target.superBoost || source.superBoost;
  target.special = target.special || source.special;
  target.launch = target.launch || source.launch;
  target.dunk = target.dunk || source.dunk;
  target.parry = target.parry || source.parry;
  target.breakLaunch = target.breakLaunch || source.breakLaunch;
}

function clearPlayerInput(input: PlayerFrameInput): void {
  input.moveX = 0;
  input.moveY = 0;
  input.boost = false;
  input.superBoost = false;
  input.special = false;
  input.launch = false;
  input.dunk = false;
  input.parry = false;
  input.breakLaunch = false;
}

export class CombinedInput {
  private readonly frameInput = createEmptyFrameInput();

  constructor(private readonly sources: FrameInputSource[]) {}

  getFrameInput(): FrameInput {
    clearPlayerInput(this.frameInput.p1);
    clearPlayerInput(this.frameInput.p2);
    for (const source of this.sources) {
      const sourceInput = source.getFrameInput();
      mergePlayerInput(this.frameInput.p1, sourceInput.p1);
      mergePlayerInput(this.frameInput.p2, sourceInput.p2);
    }
    return this.frameInput;
  }

  dispose(): void {
    for (const source of this.sources) {
      source.dispose?.();
    }
  }
}

export function createCombinedInput(sources: FrameInputSource[]): CombinedInput {
  return new CombinedInput(sources);
}
