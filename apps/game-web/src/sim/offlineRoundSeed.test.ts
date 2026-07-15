import { describe, expect, it } from 'vitest';
import { deriveOfflineAiSeed, deriveOfflineRoundSeed } from './offlineRoundSeed';
import { sanitiseSeed } from './rng';

describe('offline round seeds', () => {
  it('preserves the match seed for the first round', () => {
    expect(deriveOfflineRoundSeed(2026, 0)).toBe(2026);
    expect(deriveOfflineRoundSeed(0, 0)).toBe(sanitiseSeed(0));
  });

  it('produces deterministic, distinct seeds for automatic rounds', () => {
    const seeds = Array.from({ length: 64 }, (_, roundIndex) => (
      deriveOfflineRoundSeed(90210, roundIndex)
    ));

    expect(seeds.slice(0, 4)).toEqual([90210, 90211, 90212, 90213]);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seeds.every((seed) => Number.isInteger(seed) && seed > 0)).toBe(true);
  });

  it('normalises invalid round indexes to the first round', () => {
    expect(deriveOfflineRoundSeed(77, -4)).toBe(77);
    expect(deriveOfflineRoundSeed(77, Number.NaN)).toBe(77);
    expect(deriveOfflineRoundSeed(77, 2.9)).toBe(79);
  });

  it('gives each AI side a stable stream that changes with the round', () => {
    const firstP1 = deriveOfflineAiSeed(100, 'P1');
    const firstP2 = deriveOfflineAiSeed(100, 'P2');

    expect(firstP1).not.toBe(firstP2);
    expect(deriveOfflineAiSeed(100, 'P1')).toBe(firstP1);
    expect(deriveOfflineAiSeed(101, 'P1')).not.toBe(firstP1);
    expect(deriveOfflineAiSeed(101, 'P2')).not.toBe(firstP2);
  });
});
