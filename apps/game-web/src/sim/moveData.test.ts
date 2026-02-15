import { describe, expect, test } from 'vitest';
import { CHARACTERS } from './characters';
import {
  COMBAT_MOVE_FRAME_REGISTRY,
  MOVE_FRAME_DATA,
  framesToSeconds,
  secondsToFrames,
} from './moveData';

function assertFrameValue(name: string, value: number): void {
  expect(Number.isInteger(value), `${name} should be an integer frame count`).toBe(true);
  expect(value, `${name} should be >= 0`).toBeGreaterThanOrEqual(0);
}

describe('combat move frame registry', () => {
  test('stores explicit 60Hz frame timing values for every combat move', () => {
    assertFrameValue('launch.startupFrames', COMBAT_MOVE_FRAME_REGISTRY.launch.startupFrames);
    assertFrameValue('launch.activeFrames', COMBAT_MOVE_FRAME_REGISTRY.launch.activeFrames);
    assertFrameValue('launch.recoveryOnHitFrames', COMBAT_MOVE_FRAME_REGISTRY.launch.recoveryOnHitFrames);
    assertFrameValue('launch.recoveryOnWhiffFrames', COMBAT_MOVE_FRAME_REGISTRY.launch.recoveryOnWhiffFrames);

    assertFrameValue('dunk.startupFrames', COMBAT_MOVE_FRAME_REGISTRY.dunk.startupFrames);
    assertFrameValue('dunk.activeFrames', COMBAT_MOVE_FRAME_REGISTRY.dunk.activeFrames);
    assertFrameValue('dunk.recoveryOnHitFrames', COMBAT_MOVE_FRAME_REGISTRY.dunk.recoveryOnHitFrames);
    assertFrameValue('dunk.recoveryOnWhiffFrames', COMBAT_MOVE_FRAME_REGISTRY.dunk.recoveryOnWhiffFrames);

    assertFrameValue('parry.startupFrames', COMBAT_MOVE_FRAME_REGISTRY.parry.startupFrames);
    assertFrameValue('parry.activeFrames', COMBAT_MOVE_FRAME_REGISTRY.parry.activeFrames);
    assertFrameValue('parry.recoveryFrames', COMBAT_MOVE_FRAME_REGISTRY.parry.recoveryFrames);
    assertFrameValue('parry.counterStunFrames', COMBAT_MOVE_FRAME_REGISTRY.parry.counterStunFrames);

    assertFrameValue('break.startupFrames', COMBAT_MOVE_FRAME_REGISTRY.break.startupFrames);
    assertFrameValue('break.activeFrames', COMBAT_MOVE_FRAME_REGISTRY.break.activeFrames);
    assertFrameValue('break.recoveryFrames', COMBAT_MOVE_FRAME_REGISTRY.break.recoveryFrames);

    assertFrameValue('special.startupFrames', COMBAT_MOVE_FRAME_REGISTRY.special.startupFrames);
    assertFrameValue('special.activeFrames', COMBAT_MOVE_FRAME_REGISTRY.special.activeFrames);
    assertFrameValue('special.recoveryFrames', COMBAT_MOVE_FRAME_REGISTRY.special.recoveryFrames);
    assertFrameValue('special.cooldownFrames', COMBAT_MOVE_FRAME_REGISTRY.special.cooldownFrames);
  });

  test('character move definitions and default move data are built from the shared registry', () => {
    expect(MOVE_FRAME_DATA.launch).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.launch);
    expect(MOVE_FRAME_DATA.dunk).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.dunk);
    expect(MOVE_FRAME_DATA.parry).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.parry);
    expect(MOVE_FRAME_DATA.break).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.break);
    expect(MOVE_FRAME_DATA.special.timing).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.special);

    for (const character of CHARACTERS) {
      expect(character.moves.launch).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.launch);
      expect(character.moves.dunk).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.dunk);
      expect(character.moves.parry).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.parry);
      expect(character.moves.break).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.break);
      expect(character.moves.special.timing).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.special);
    }
  });

  test('frame conversion helpers stay consistent with 60Hz units', () => {
    expect(framesToSeconds(0)).toBe(0);
    expect(framesToSeconds(60)).toBe(1);
    expect(secondsToFrames(0)).toBe(0);
    expect(secondsToFrames(1)).toBe(60);
    expect(secondsToFrames(framesToSeconds(42))).toBe(42);
  });
});
