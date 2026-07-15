import { describe, expect, test } from 'vitest';
import {
  CHARACTER_BY_ID,
  CHARACTER_IDS,
  CHARACTER_PACKAGE_VERSION_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
  DEFAULT_CHARACTER_LOADOUT,
  isCharacterId,
} from './characters';
import { computeStateChecksum } from './checksum';
import { createInitialState, step } from './sim';
import type { FrameInput } from './types';

function neutralInput(): FrameInput {
  return {
    p1: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
    p2: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
  };
}

function scriptedInputForFrame(frame: number): FrameInput {
  const input = neutralInput();
  input.p1.moveX = frame % 30 < 15 ? 1 : -1;
  input.p2.moveY = frame % 20 < 10 ? 1 : -1;
  input.p1.boost = frame % 45 === 0;
  input.p2.boost = frame % 55 === 0;
  input.p1.special = frame % 60 === 0;
  input.p2.special = frame % 75 === 0;
  input.p1.launch = frame % 90 === 0;
  input.p2.launch = frame % 110 === 0;
  input.p1.parry = frame % 80 === 0;
  input.p2.parry = frame % 95 === 0;
  input.p1.dunk = frame % 140 === 0;
  input.p2.dunk = frame % 165 === 0;
  return input;
}

describe('character package integration', () => {
  test('loads validated packaged character definitions into runtime registry', () => {
    expect(CHARACTER_IDS.slice(0, 4)).toEqual(['vanguard', 'duelist', 'ace', 'warden']);
    expect(CHARACTER_BY_ID.vanguard.package?.version).toBe('0.3.3');
    expect(CHARACTER_BY_ID.duelist.package?.version).toBe('0.3.2');
    expect(CHARACTER_BY_ID.vanguard.moves.dunk.startupPursuitSpeed).toBe(70);
    expect(CHARACTER_BY_ID.vanguard.moves.special.behaviorId).toBe('special.block_guard.v1');
    expect(CHARACTER_BY_ID.duelist.moves.special.behaviorId).toBe('special.movement_dash.v1');
    expect(CHARACTER_BY_ID.vanguard_pkg).toBeUndefined();
    expect(CHARACTER_PACKAGE_VERSION_BY_ID.vanguard).toBe('0.3.3');
    expect(CHARACTER_REGISTRY_FINGERPRINT).toMatch(/^gw\.character-registry\.v1:[0-9a-f]{8}$/);
  });

  test('default loadout always points at valid registered characters', () => {
    expect(isCharacterId(DEFAULT_CHARACTER_LOADOUT.P1)).toBe(true);
    expect(isCharacterId(DEFAULT_CHARACTER_LOADOUT.P2)).toBe(true);
  });

  test('packaged characters pass deterministic checksum smoke replay', () => {
    const packagedCharacterIds = CHARACTER_IDS.filter((id) => Boolean(CHARACTER_BY_ID[id].package));
    expect(packagedCharacterIds.length).toBeGreaterThan(0);

    for (const characterId of packagedCharacterIds) {
      const opponentId = characterId === 'vanguard' ? 'duelist' : 'vanguard';
      const stateA = createInitialState({
        seed: 424242,
        loadout: { P1: characterId, P2: opponentId },
      });
      const stateB = createInitialState({
        seed: 424242,
        loadout: { P1: characterId, P2: opponentId },
      });
      let finalChecksum = 0;
      for (let frame = 0; frame < 240; frame += 1) {
        const input = scriptedInputForFrame(frame);
        step(stateA, input, 1 / 60);
        step(stateB, input, 1 / 60);
        const checksumA = computeStateChecksum(stateA);
        const checksumB = computeStateChecksum(stateB);
        expect(checksumA, `${characterId} diverged at frame ${frame + 1}`).toBe(checksumB);
        finalChecksum = checksumA;
      }
      expect(finalChecksum).toBeGreaterThan(0);
    }
  });

  test('packaged characters stay within frame and balance QA bounds', () => {
    const packagedCharacterIds = CHARACTER_IDS.filter((id) => Boolean(CHARACTER_BY_ID[id].package));
    expect(packagedCharacterIds.length).toBeGreaterThan(0);

    for (const characterId of packagedCharacterIds) {
      const character = CHARACTER_BY_ID[characterId];
      expect(character.stats.fuelCapacityMultiplier).toBeGreaterThanOrEqual(0.5);
      expect(character.stats.fuelCapacityMultiplier).toBeLessThanOrEqual(2.5);
      expect(character.stats.moveAccelMultiplier).toBeGreaterThanOrEqual(0.5);
      expect(character.stats.moveAccelMultiplier).toBeLessThanOrEqual(2.5);
      expect(character.moves.launch.startupFrames).toBeGreaterThanOrEqual(0);
      expect(character.moves.launch.startupFrames).toBeLessThanOrEqual(60);
      expect(character.moves.launch.activeFrames).toBeGreaterThanOrEqual(1);
      expect(character.moves.launch.activeFrames).toBeLessThanOrEqual(24);
      expect(character.moves.launch.recoveryOnWhiffFrames).toBeGreaterThanOrEqual(character.moves.launch.recoveryOnHitFrames);
      expect(character.moves.dunk.startupFrames).toBeGreaterThanOrEqual(0);
      expect(character.moves.dunk.startupFrames).toBeLessThanOrEqual(120);
      expect(character.moves.dunk.activeFrames).toBeGreaterThanOrEqual(1);
      expect(character.moves.dunk.activeFrames).toBeLessThanOrEqual(24);
      expect(character.moves.dunk.recoveryOnWhiffFrames).toBeGreaterThanOrEqual(character.moves.dunk.recoveryOnHitFrames);
      expect(character.moves.dunk.startupPursuitSpeed).toBeGreaterThanOrEqual(0);
      expect(character.moves.dunk.startupPursuitSpeed).toBeLessThanOrEqual(200);
      expect(character.moves.dunk.startupTracking).toBeGreaterThanOrEqual(0);
      expect(character.moves.dunk.startupTracking).toBeLessThanOrEqual(1);
      expect(character.moves.special.fuelCost).toBeGreaterThanOrEqual(0);
      expect(character.moves.special.fuelCost).toBeLessThanOrEqual(30);
      expect(character.moves.special.timing.cooldownFrames).toBeGreaterThanOrEqual(0);
      expect(character.moves.special.timing.cooldownFrames).toBeLessThanOrEqual(600);
      expect(character.moves.superBoost.startFuelCost).toBeGreaterThanOrEqual(0);
      expect(character.moves.superBoost.startFuelCost).toBeLessThanOrEqual(40);
      expect(character.moves.superBoost.travelFuelPerDistance).toBeGreaterThanOrEqual(0);
      expect(character.moves.superBoost.travelFuelPerDistance).toBeLessThanOrEqual(0.5);
    }
  });
});
