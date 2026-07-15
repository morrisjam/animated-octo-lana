import { describe, expect, test } from 'vitest';
import { createDefaultAiBehaviorTuning } from '../sim/ai';
import { AI_BEHAVIOR_TUNING_FIELDS, CHARACTER_TUNING_FIELD_IDS } from './pauseMenu';

describe('pause menu AI behavior controls', () => {
  test('exposes every numeric AI behavior tuning field exactly once', () => {
    const defaults = createDefaultAiBehaviorTuning();
    const expectedKeys = Object.keys(defaults)
      .filter((key) => key !== 'schemaVersion')
      .sort();
    const actualKeys = AI_BEHAVIOR_TUNING_FIELDS.map((field) => field.key).sort();

    expect(actualKeys).toEqual(expectedKeys);
    expect(new Set(actualKeys).size).toBe(actualKeys.length);
    for (const field of AI_BEHAVIOR_TUNING_FIELDS) {
      expect(defaults[field.key]).toBeGreaterThanOrEqual(field.min);
      expect(defaults[field.key]).toBeLessThanOrEqual(field.max);
    }
  });
});

describe('pause menu character controls', () => {
  test('does not expose launch-break timing values that runtime ignores', () => {
    expect(CHARACTER_TUNING_FIELD_IDS).not.toContain('break-startup');
    expect(CHARACTER_TUNING_FIELD_IDS).not.toContain('break-active');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('break-recovery');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('break-retain');
  });
});
