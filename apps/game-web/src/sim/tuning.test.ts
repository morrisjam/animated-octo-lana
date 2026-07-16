import { describe, expect, test } from 'vitest';
import { fingerprintDeterministicValue } from './fingerprint';
import {
  createDefaultTuning,
  fingerprintGameTuning,
  sanitiseTuning,
} from './tuning';

describe('game tuning', () => {
  test('ships the locally validated flow candidate as explicit defaults', () => {
    const defaults = createDefaultTuning();

    expect(defaults.helplessVelocityDamping).toBe(0.995);
    expect(defaults.actionRecoveryControlMultiplier).toBe(1);
    expect(defaults.combatBoostReacquireDelaySeconds).toBe(0);
    expect(defaults.defensiveResetDistance).toBe(26);
    expect(defaults.defensiveResetImpulse).toBe(14);
    expect(defaults.launchBreakResetMultiplier).toBe(1.1);
    expect(defaults.naturalRecoveryResetMultiplier).toBe(0);
    expect(defaults.postControlCounterLaunchClashGraceSeconds).toBe(0);
  });

  test('fills missing fields from defaults for snapshot and draft compatibility', () => {
    const defaults = createDefaultTuning();

    expect(sanitiseTuning({ launchBasePower: defaults.launchBasePower + 5 })).toEqual({
      ...defaults,
      launchBasePower: defaults.launchBasePower + 5,
    });
  });

  test('clamps flow controls and falls back from non-finite values', () => {
    const defaults = createDefaultTuning();
    const tuning = sanitiseTuning({
      ...defaults,
      helplessReleaseSpeedRatio: Number.NaN,
      actionRecoveryControlMultiplier: 2,
      combatBoostReacquireDelaySeconds: 2,
      startupClashGraceSeconds: 1,
      postControlCounterLaunchClashGraceSeconds: 1,
      launchClashSeparationPadding: 80,
      launchClashRecoilMultiplier: -2,
      closeRangeSeparationPadding: -10,
      closeRangeSeparationImpulse: 500,
      closeRangeCommitSeparationMultiplier: 2,
      defensiveResetDistance: 80,
      defensiveResetImpulse: -3,
      launchBreakResetMultiplier: 3,
      naturalRecoveryResetMultiplier: 3,
    });

    expect(tuning.helplessReleaseSpeedRatio).toBe(defaults.helplessReleaseSpeedRatio);
    expect(tuning.actionRecoveryControlMultiplier).toBe(1);
    expect(tuning.combatBoostReacquireDelaySeconds).toBe(1);
    expect(tuning.startupClashGraceSeconds).toBe(0.25);
    expect(tuning.postControlCounterLaunchClashGraceSeconds).toBe(0.1);
    expect(tuning.launchClashSeparationPadding).toBe(40);
    expect(tuning.launchClashRecoilMultiplier).toBe(0);
    expect(tuning.closeRangeSeparationPadding).toBe(0);
    expect(tuning.closeRangeSeparationImpulse).toBe(100);
    expect(tuning.closeRangeCommitSeparationMultiplier).toBe(1);
    expect(tuning.defensiveResetDistance).toBe(50);
    expect(tuning.defensiveResetImpulse).toBe(0);
    expect(tuning.launchBreakResetMultiplier).toBe(2);
    expect(tuning.naturalRecoveryResetMultiplier).toBe(2);
  });

  test('keeps the default tuning fingerprint compatible while attributing non-zero experiments', () => {
    const defaults = createDefaultTuning();
    const legacyDefaults = { ...defaults } as Partial<typeof defaults>;
    delete legacyDefaults.postControlCounterLaunchClashGraceSeconds;
    delete legacyDefaults.combatBoostReacquireDelaySeconds;

    expect(fingerprintGameTuning(defaults)).toBe(fingerprintDeterministicValue(legacyDefaults));
    expect(fingerprintGameTuning({
      ...defaults,
      postControlCounterLaunchClashGraceSeconds: 2 / 60,
    })).not.toBe(fingerprintGameTuning(defaults));
    expect(fingerprintGameTuning({
      ...defaults,
      combatBoostReacquireDelaySeconds: 0.18,
    })).not.toBe(fingerprintGameTuning(defaults));
  });
});
