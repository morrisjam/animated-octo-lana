import type { FrameInput, PlayerFrameInput } from '../sim/types';

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function createEmptyPlayerInput(): PlayerFrameInput {
  return {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

export function createEmptyFrameInput(): FrameInput {
  return {
    p1: createEmptyPlayerInput(),
    p2: createEmptyPlayerInput(),
  };
}

export function combinePlayerInputs(a: PlayerFrameInput, b: PlayerFrameInput): PlayerFrameInput {
  return {
    moveX: Math.abs(a.moveX) >= Math.abs(b.moveX) ? clampAxis(a.moveX) : clampAxis(b.moveX),
    moveY: Math.abs(a.moveY) >= Math.abs(b.moveY) ? clampAxis(a.moveY) : clampAxis(b.moveY),
    boost: a.boost || b.boost,
    superBoost: a.superBoost || b.superBoost,
    special: a.special || b.special,
    launch: a.launch || b.launch,
    dunk: a.dunk || b.dunk,
    parry: a.parry || b.parry,
    breakLaunch: a.breakLaunch || b.breakLaunch,
  };
}

export function combineFrameInputs(a: FrameInput, b: FrameInput): FrameInput {
  return {
    p1: combinePlayerInputs(a.p1, b.p1),
    p2: combinePlayerInputs(a.p2, b.p2),
  };
}
