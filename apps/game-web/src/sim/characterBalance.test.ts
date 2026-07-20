import { describe, expect, test } from 'vitest';
import { CHARACTER_BY_ID } from './characters';
import {
  cloneCharacterBalanceConfig,
  createCharacterBalanceConfig,
  fingerprintCharacterBalanceConfig,
  sanitiseCharacterBalanceConfig,
  sanitiseCharacterBalanceOverrides,
} from './characterBalance';

describe('local character balance configuration', () => {
  test('creates deep editable copies without mutating package definitions', () => {
    const originalStartup = CHARACTER_BY_ID.vanguard.moves.launch.startupFrames;
    const config = createCharacterBalanceConfig('vanguard');
    config.moves.launch.startupFrames += 4;
    config.moves.special.timing.recoveryFrames += 3;
    config.ai.neutralApproachMultiplier = 0.75;

    expect(CHARACTER_BY_ID.vanguard.moves.launch.startupFrames).toBe(originalStartup);
    expect(config.moves.launch.startupFrames).toBe(originalStartup + 4);

    const clone = cloneCharacterBalanceConfig(config);
    clone.moves.launch.startupFrames += 2;
    clone.ai.neutralApproachMultiplier = 0.5;
    expect(config.moves.launch.startupFrames).toBe(originalStartup + 4);
    expect(config.ai.neutralApproachMultiplier).toBe(0.75);
  });

  test('sanitises numeric edits while preserving package behavior identity', () => {
    const config = createCharacterBalanceConfig('duelist');
    const edited = {
      ...config,
      ai: {
        neutralApproachMultiplier: 99,
        neutralBoostDistanceOffset: -5,
        postControlSpacingFrames: 999,
      },
      stats: { ...config.stats, moveAccelMultiplier: 99 },
      moves: {
        ...config.moves,
        dunk: {
          ...config.moves.dunk,
          startupFrames: -10,
          hitRange: 500,
          startupPursuitSpeed: 700,
          startupTracking: 2,
        },
        special: {
          ...config.moves.special,
          behaviorId: 'special.projectile.v1',
          fuelCost: -5,
        },
      },
    };

    const sanitised = sanitiseCharacterBalanceConfig('duelist', edited);

    expect(sanitised.stats.moveAccelMultiplier).toBe(5);
    expect(sanitised.ai.neutralApproachMultiplier).toBe(2);
    expect(sanitised.ai.neutralBoostDistanceOffset).toBe(0);
    expect(sanitised.ai.postControlSpacingFrames).toBe(120);
    expect(sanitised.moves.dunk.startupFrames).toBe(0);
    expect(sanitised.moves.dunk.hitRange).toBe(100);
    expect(sanitised.moves.dunk.startupPursuitSpeed).toBe(500);
    expect(sanitised.moves.dunk.startupTracking).toBe(1);
    expect(sanitised.moves.special.fuelCost).toBe(0);
    expect(sanitised.moves.special.behaviorId).toBe(CHARACTER_BY_ID.duelist.moves.special.behaviorId);
  });

  test('keeps editable payload values only for the package special behavior', () => {
    const duelist = createCharacterBalanceConfig('duelist');
    expect(duelist.moves.special.movement).toBeDefined();
    duelist.moves.special.movement!.dashSpeed = 123;

    const sanitised = sanitiseCharacterBalanceConfig('duelist', {
      ...duelist,
      moves: {
        ...duelist.moves,
        special: {
          ...duelist.moves.special,
          behaviorId: 'special.projectile.v1',
          projectile: { speed: 999 },
        },
      },
    });

    expect(sanitised.moves.special.behaviorId).toBe('special.movement_dash.v1');
    expect(sanitised.moves.special.movement?.dashSpeed).toBe(123);
    expect(sanitised.moves.special.projectile).toBeUndefined();
  });

  test('ignores unknown character ids and fingerprints exact rules', () => {
    const base = createCharacterBalanceConfig('vanguard');
    const edited = cloneCharacterBalanceConfig(base);
    edited.moves.dunk.hitRange += 0.5;

    const overrides = sanitiseCharacterBalanceOverrides({
      vanguard: edited,
      invented_character: edited,
    });

    expect(Object.keys(overrides)).toEqual(['vanguard']);
    expect(fingerprintCharacterBalanceConfig(overrides.vanguard!)).not.toBe(
      fingerprintCharacterBalanceConfig(base),
    );
  });
});
