import { describe, expect, test, vi } from 'vitest';
import type { PlayerFrameInput } from '../sim/types';
import { applyPendingRemoteInputs } from './onlineRemoteInputBuffer';

function input(moveX: number): PlayerFrameInput {
  return {
    moveX,
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

describe('online remote input buffer', () => {
  test('applies delayed and current inputs in order while retaining future inputs', () => {
    const pending = new Map<number, PlayerFrameInput>([
      [8, input(0.8)],
      [3, input(0.3)],
      [5, input(0.5)],
    ]);
    const applyRemoteAuthoritativeInputs = vi.fn(() => ({
      acceptedFrames: [3, 5],
      rollbackFrames: 2,
      duplicateFrames: [],
      conflictingFrames: [],
      tooLateFrames: [],
    }));

    const result = applyPendingRemoteInputs(
      pending,
      { applyRemoteAuthoritativeInputs },
      5,
    );

    expect(applyRemoteAuthoritativeInputs).toHaveBeenCalledWith([
      { frame: 3, input: input(0.3) },
      { frame: 5, input: input(0.5) },
    ]);
    expect(result).toEqual({
      appliedFrames: [3, 5],
      rollbackFrames: 2,
      duplicateFrames: [],
      conflictingFrames: [],
      tooLateFrames: [],
    });
    expect([...pending.keys()]).toEqual([8]);
  });

  test('does not invoke rollback when no input is ready', () => {
    const pending = new Map<number, PlayerFrameInput>([[4, input(1)]]);
    const applyRemoteAuthoritativeInputs = vi.fn();

    expect(applyPendingRemoteInputs(pending, { applyRemoteAuthoritativeInputs }, 3)).toEqual({
      appliedFrames: [],
      rollbackFrames: 0,
      duplicateFrames: [],
      conflictingFrames: [],
      tooLateFrames: [],
    });
    expect(applyRemoteAuthoritativeInputs).not.toHaveBeenCalled();
  });
});
