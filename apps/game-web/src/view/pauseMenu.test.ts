import { describe, expect, test } from 'vitest';
import { createDefaultAiBehaviorTuning } from '../sim/ai';
import type { BalanceLabFlowModel } from '../sim/balanceLab';
import {
  AI_BEHAVIOR_TUNING_FIELDS,
  CHARACTER_TUNING_FIELD_IDS,
  formatOrdinaryBoostCounterplay,
} from './pauseMenu';

function createOrdinaryBoostFlow(): NonNullable<BalanceLabFlowModel['ordinaryBoostCounterplay']> {
  const createPlayer = () => ({
    opportunities: 0,
    completedOpportunities: 0,
    firstResponses: 0,
    targetSuperBoostResponses: 0,
    firstResponseActions: {
      boost: 0,
      super_boost: 0,
      special: 0,
      launch: 0,
      dunk: 0,
      parry: 0,
      launch_break: 0,
      none: 0,
    },
    outcomes: {
      combat_conversion: 0,
      contact: 0,
      clean_pass: 0,
      avoided_and_opened: 0,
      avoided_but_closed: 0,
      avoided_stable: 0,
      superseded_by_super_boost: 0,
      booster_interrupted: 0,
      round_end: 0,
      sample_end: 0,
    },
    responseCoverageRatio: 0,
    superBoostResponseRatio: 0,
    averageFirstResponseSeconds: null,
    averageAvailableReactionSeconds: null,
    averageStartDistance: null,
  });
  const p1 = createPlayer();
  Object.assign(p1, {
    opportunities: 4,
    completedOpportunities: 4,
    firstResponses: 3,
    targetSuperBoostResponses: 1,
    responseCoverageRatio: 0.75,
    superBoostResponseRatio: 0.25,
    averageFirstResponseSeconds: 0.125,
  });
  p1.outcomes.contact = 2;
  p1.outcomes.combat_conversion = 1;
  p1.outcomes.clean_pass = 1;
  return { opportunities: 4, players: { P1: p1, P2: createPlayer() } };
}

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

  test('exposes the package-declared post-control repeat-dash weight as a bounded defense control', () => {
    expect(AI_BEHAVIOR_TUNING_FIELDS.find(
      (field) => field.key === 'postControlRepeatDashWeightScale',
    )).toMatchObject({
      section: 'Commitment and defense',
      label: 'Package-Declared Movement-Dash Repeat Weight After Control Return',
      step: 0.05,
      min: 0,
      max: 1,
    });
  });
});

describe('pause menu character controls', () => {
  test('does not expose launch-break timing values that runtime ignores', () => {
    expect(CHARACTER_TUNING_FIELD_IDS).not.toContain('break-startup');
    expect(CHARACTER_TUNING_FIELD_IDS).not.toContain('break-active');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('break-recovery');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('break-retain');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('ai-neutral-approach');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('ai-neutral-boost-distance');
    expect(CHARACTER_TUNING_FIELD_IDS).toContain('ai-post-control-spacing');
  });
});

describe('pause menu ordinary Boost counterplay formatter', () => {
  test('separates historical, empty, and populated samples', () => {
    expect(formatOrdinaryBoostCounterplay(null)).toBe('unavailable in historical sample');
    const empty = createOrdinaryBoostFlow();
    empty.opportunities = 0;
    empty.players.P1 = { ...empty.players.P1, opportunities: 0 };
    expect(formatOrdinaryBoostCounterplay(empty)).toBe('--');
    expect(formatOrdinaryBoostCounterplay(createOrdinaryBoostFlow())).toBe(
      'P1 4 reads | answered 3 (75%) | SB 1 | contact 2 | conversion 1 | pass 1 | response 0.13s avg || P2 --',
    );
  });
});
