import { describe, expect, test } from 'vitest';
import {
  BALANCE_PROFILE_BY_ID,
  BALANCE_PROFILE_IDS,
  BALANCE_PROFILES,
  DEFAULT_BALANCE_PROFILE_ID,
  resolveBalanceProfile,
} from './balanceProfiles';
import { createDefaultTuning } from './tuning';

describe('balance profile registry', () => {
  test('includes a default profile that matches base tuning', () => {
    const defaults = createDefaultTuning();
    expect(BALANCE_PROFILE_IDS.includes(DEFAULT_BALANCE_PROFILE_ID)).toBe(true);
    expect(BALANCE_PROFILE_BY_ID.default).toBeDefined();
    expect(BALANCE_PROFILE_BY_ID.default.tuning).toEqual(defaults);
  });

  test('resolves unknown or empty ids back to default profile', () => {
    expect(resolveBalanceProfile(undefined).id).toBe(DEFAULT_BALANCE_PROFILE_ID);
    expect(resolveBalanceProfile('').id).toBe(DEFAULT_BALANCE_PROFILE_ID);
    expect(resolveBalanceProfile('missing_profile').id).toBe(DEFAULT_BALANCE_PROFILE_ID);
  });

  test('all profile ids are unique and tuning values are finite', () => {
    const ids = new Set<string>();
    for (const profile of BALANCE_PROFILES) {
      expect(ids.has(profile.id)).toBe(false);
      ids.add(profile.id);
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.description.length).toBeGreaterThan(0);
      for (const value of Object.values(profile.tuning)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
