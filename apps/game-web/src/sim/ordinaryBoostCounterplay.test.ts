import { describe, expect, test } from 'vitest';
import { createInitialState } from './sim';
import {
  isOrdinaryBoostCounterplayOpportunity,
  measureOrdinaryBoostApproach,
} from './ordinaryBoostCounterplay';

describe('ordinary Boost counterplay geometry', () => {
  test('recognises a closing committed Boost inside the contact lane', () => {
    const state = createInitialState({ seed: 1 });
    const booster = state.players.P1;
    const target = state.players.P2;
    booster.pos = { x: 0, y: 0 };
    booster.vel = { x: 60, y: 0 };
    booster.boostDir = { x: 1, y: 0 };
    target.pos = { x: 12, y: 0 };
    target.vel = { x: 0, y: 0 };

    const approach = measureOrdinaryBoostApproach(booster, target);

    expect(approach).toMatchObject({
      distance: 12,
      directionX: 1,
      directionY: 0,
      lateralDistance: 0,
      closingSpeed: 60,
    });
    expect(isOrdinaryBoostCounterplayOpportunity(approach)).toBe(true);
  });

  test('rejects off-lane and degenerate Boost directions', () => {
    const state = createInitialState({ seed: 2 });
    const booster = state.players.P1;
    const target = state.players.P2;
    booster.pos = { x: 0, y: 0 };
    booster.vel = { x: 60, y: 0 };
    booster.boostDir = { x: 1, y: 0 };
    target.pos = { x: 12, y: 12 };
    target.vel = { x: 0, y: 0 };

    expect(isOrdinaryBoostCounterplayOpportunity(
      measureOrdinaryBoostApproach(booster, target),
    )).toBe(false);

    booster.boostDir = { x: 0, y: 0 };
    expect(measureOrdinaryBoostApproach(booster, target)).toBeNull();
  });
});
