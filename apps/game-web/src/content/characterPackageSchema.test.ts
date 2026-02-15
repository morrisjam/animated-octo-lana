import { describe, expect, test } from 'vitest';
import {
  CHARACTER_PACKAGE_SCHEMA_VERSION,
  CharacterPackageValidationError,
  parseCharacterPackage,
} from './characterPackageSchema';

function makeValidPackage(): Record<string, unknown> {
  return {
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    id: 'vanguard_pkg',
    displayName: 'Vanguard',
    blurb: 'Placeholder all-round archetype.',
    mechanicsTag: 'future: defensive kit',
    metadata: {
      author: 'Gravity Well Team',
      version: '1.0.0',
      tags: ['starter', 'all-rounder'],
    },
    stats: {
      fuelCapacityMultiplier: 1,
      moveAccelMultiplier: 1,
      boostSpeedMultiplier: 1,
      superBoostSpeedMultiplier: 1,
      launchBasePowerMultiplier: 1,
      launchChainBonusMultiplier: 1,
      launchDurationTakenMultiplier: 1,
      specialFuelCostMultiplier: 1,
      superFuelMultiplier: 1,
      dunkRecoveryFuelMultiplier: 1,
    },
    visuals: {
      presentation: '3d',
      modelId: 'character_vanguard_model',
      animationSetId: 'character_vanguard_animset',
      vfxProfileId: 'character_vanguard_vfx',
      projectileVisualId: 'character_vanguard_projectile',
      hudPortraitId: 'character_vanguard_portrait',
    },
    audio: {
      sfxProfileId: 'character_vanguard_sfx',
      voiceProfileId: 'character_vanguard_voice',
      musicThemeId: 'character_vanguard_theme',
    },
    moves: {
      launch: {
        startupFrames: 6,
        activeFrames: 3,
        recoveryOnHitFrames: 30,
        recoveryOnWhiffFrames: 42,
      },
      dunk: {
        startupFrames: 30,
        activeFrames: 4,
        recoveryOnHitFrames: 24,
        recoveryOnWhiffFrames: 66,
        hitRange: 8,
      },
      parry: {
        startupFrames: 0,
        activeFrames: 11,
        recoveryFrames: 13,
        counterStunFrames: 45,
      },
      break: {
        startupFrames: 0,
        activeFrames: 1,
        recoveryFrames: 24,
        velocityRetain: 0.3,
      },
      movement: {
        fuelPerSecond: 0.65,
      },
      special: {
        id: 'basic_projectile',
        label: 'Basic Projectile',
        behaviorId: 'special.projectile.v1',
        kind: 'projectile',
        fuelCost: 5,
        timing: {
          startupFrames: 0,
          activeFrames: 1,
          recoveryFrames: 0,
          cooldownFrames: 19,
        },
        size: {
          range: 100,
          radius: 0.8,
          width: 1.6,
          length: 1.6,
        },
        projectile: {
          speed: 42,
          lifeSeconds: 2,
          hitRadius: 0.8,
          stunSeconds: 0.7,
          fuelDamage: 4,
          visualId: 'character_vanguard_projectile',
        },
      },
      boost: {
        holdSpeedMultiplier: 1,
        holdFuelPerSecond: 0.2,
      },
      superBoost: {
        holdSpeedMultiplier: 1,
        steerLerpMultiplier: 1,
        velocityBlendMultiplier: 1,
        startFuelCost: 6,
        travelFuelPerDistance: 0.05,
        nonCommitPenalty: 2.5,
        turnPenaltyGainMultiplier: 1,
      },
    },
    specials: [
      { id: 'special_alpha', label: 'Special Alpha', enabled: false },
      { id: 'special_beta', label: 'Special Beta', enabled: false },
    ],
  };
}

describe('character package schema', () => {
  test('parses valid character package payload', () => {
    const parsed = parseCharacterPackage(makeValidPackage());
    expect(parsed.id).toBe('vanguard_pkg');
    expect(parsed.moves.special.behaviorId).toBe('special.projectile.v1');
  });

  test('rejects payload with invalid schema version', () => {
    const invalid = makeValidPackage();
    invalid.schemaVersion = 'gw.character-package.v0';
    expect(() => parseCharacterPackage(invalid)).toThrowError(CharacterPackageValidationError);
  });

  test('rejects payload when special kind data is missing', () => {
    const invalid = makeValidPackage();
    const moves = invalid.moves as Record<string, unknown>;
    const special = moves.special as Record<string, unknown>;
    special.kind = 'command_grab';
    delete special.commandGrab;
    expect(() => parseCharacterPackage(invalid)).toThrowError(CharacterPackageValidationError);
  });

  test('rejects payload when special behavior id is not allow-listed', () => {
    const invalid = makeValidPackage();
    const moves = invalid.moves as Record<string, unknown>;
    const special = moves.special as Record<string, unknown>;
    special.behaviorId = 'special.anything.custom';
    expect(() => parseCharacterPackage(invalid)).toThrowError(CharacterPackageValidationError);
  });
});
