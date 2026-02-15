import { describe, expect, test } from 'vitest';
import {
  CHARACTER_BY_ID,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_LOADOUT,
  isCharacterId,
} from './characters';

describe('character package integration', () => {
  test('loads validated packaged character definitions into runtime registry', () => {
    expect(CHARACTER_BY_ID.vanguard_pkg).toBeDefined();
    expect(CHARACTER_BY_ID.vanguard_pkg.displayName).toBe('Vanguard');
    expect(CHARACTER_IDS.includes('vanguard_pkg')).toBe(true);
  });

  test('default loadout always points at valid registered characters', () => {
    expect(isCharacterId(DEFAULT_CHARACTER_LOADOUT.P1)).toBe(true);
    expect(isCharacterId(DEFAULT_CHARACTER_LOADOUT.P2)).toBe(true);
  });
});
