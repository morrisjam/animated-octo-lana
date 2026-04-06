import { describe, expect, test } from 'vitest';
import { CHARACTERS } from './characters';
import {
  COMBAT_MOVE_FRAME_REGISTRY,
  MOVE_FRAME_DATA,
  createMoveFrameData,
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

  test('default move data is built from the shared registry', () => {
    const defaultMoveData = createMoveFrameData('test_projectile');

    expect(MOVE_FRAME_DATA.launch).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.launch);
    expect(MOVE_FRAME_DATA.dunk).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.dunk);
    expect(MOVE_FRAME_DATA.parry).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.parry);
    expect(MOVE_FRAME_DATA.break).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.break);
    expect(MOVE_FRAME_DATA.special.timing).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.special);
    expect(defaultMoveData.launch).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.launch);
    expect(defaultMoveData.dunk).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.dunk);
    expect(defaultMoveData.parry).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.parry);
    expect(defaultMoveData.break).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.break);
    expect(defaultMoveData.special.timing).toMatchObject(COMBAT_MOVE_FRAME_REGISTRY.special);
  });

  test('character move definitions remain internally coherent when kits override default timings', () => {
    for (const character of CHARACTERS) {
      assertFrameValue(`${character.id}.launch.startupFrames`, character.moves.launch.startupFrames);
      assertFrameValue(`${character.id}.launch.activeFrames`, character.moves.launch.activeFrames);
      assertFrameValue(
        `${character.id}.launch.recoveryOnHitFrames`,
        character.moves.launch.recoveryOnHitFrames,
      );
      assertFrameValue(
        `${character.id}.launch.recoveryOnWhiffFrames`,
        character.moves.launch.recoveryOnWhiffFrames,
      );

      assertFrameValue(`${character.id}.dunk.startupFrames`, character.moves.dunk.startupFrames);
      assertFrameValue(`${character.id}.dunk.activeFrames`, character.moves.dunk.activeFrames);
      assertFrameValue(
        `${character.id}.dunk.recoveryOnHitFrames`,
        character.moves.dunk.recoveryOnHitFrames,
      );
      assertFrameValue(
        `${character.id}.dunk.recoveryOnWhiffFrames`,
        character.moves.dunk.recoveryOnWhiffFrames,
      );
      expect(character.moves.dunk.hitRange, `${character.id}.dunk.hitRange should be > 0`).toBeGreaterThan(0);

      assertFrameValue(`${character.id}.parry.startupFrames`, character.moves.parry.startupFrames);
      assertFrameValue(`${character.id}.parry.activeFrames`, character.moves.parry.activeFrames);
      assertFrameValue(`${character.id}.parry.recoveryFrames`, character.moves.parry.recoveryFrames);
      assertFrameValue(
        `${character.id}.parry.counterStunFrames`,
        character.moves.parry.counterStunFrames,
      );

      assertFrameValue(`${character.id}.break.startupFrames`, character.moves.break.startupFrames);
      assertFrameValue(`${character.id}.break.activeFrames`, character.moves.break.activeFrames);
      assertFrameValue(`${character.id}.break.recoveryFrames`, character.moves.break.recoveryFrames);
      expect(
        character.moves.break.velocityRetain,
        `${character.id}.break.velocityRetain should be within [0, 1]`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        character.moves.break.velocityRetain,
        `${character.id}.break.velocityRetain should be within [0, 1]`,
      ).toBeLessThanOrEqual(1);

      assertFrameValue(`${character.id}.special.startupFrames`, character.moves.special.timing.startupFrames);
      assertFrameValue(`${character.id}.special.activeFrames`, character.moves.special.timing.activeFrames);
      assertFrameValue(`${character.id}.special.recoveryFrames`, character.moves.special.timing.recoveryFrames);
      assertFrameValue(`${character.id}.special.cooldownFrames`, character.moves.special.timing.cooldownFrames);
      expect(character.moves.special.id).toBeTruthy();
      expect(character.moves.special.label).toBeTruthy();
      expect(character.specials.length, `${character.id} should expose at least one special slot`).toBeGreaterThan(0);
      expect(new Set(character.specials.map((special) => special.id)).size).toBe(character.specials.length);

      const configuredSpecial = character.specials.find((special) => special.id === character.moves.special.id);
      if (configuredSpecial) {
        expect(configuredSpecial.label).toBe(character.moves.special.label);
      }
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
