import { describe, expect, test } from 'vitest';
import { createDefaultAiBehaviorTuning } from './ai';
import {
  compareAiBatchRuleSnapshots,
  createAiBatchRuleSnapshot,
  parseAiBatchRuleSnapshot,
} from './aiBatchRuleComparison';
import { createCharacterBalanceConfig } from './characterBalance';
import { fingerprintDeterministicValue } from './fingerprint';
import { createDefaultTuning, createGameTuningFingerprintInput } from './tuning';

describe('AI batch rule comparison', () => {
  test('records one exact effective AI rule change', () => {
    const baseline = createAiBatchRuleSnapshot();
    const candidate = createAiBatchRuleSnapshot(
      createDefaultTuning(),
      {},
      {
        ...createDefaultAiBehaviorTuning(),
        commitmentResetFrames: 12,
      },
    );

    expect(compareAiBatchRuleSnapshots(baseline, candidate)).toEqual({
      policy: 'single_variable',
      changes: [{
        scope: 'ai',
        characterId: null,
        path: 'commitmentResetFrames',
        baselineValue: 0,
        candidateValue: 12,
        delta: 12,
      }],
    });
  });

  test('rejects an unchanged candidate and accidental multi-rule drafts', () => {
    const baseline = createAiBatchRuleSnapshot();
    expect(() => compareAiBatchRuleSnapshots(baseline, createAiBatchRuleSnapshot())).toThrow(
      'no effective rule change',
    );

    const tuning = createDefaultTuning();
    tuning.launchBasePower += 1;
    const contaminated = createAiBatchRuleSnapshot(tuning, {}, {
      ...createDefaultAiBehaviorTuning(),
      commitmentResetFrames: 12,
    });
    expect(() => compareAiBatchRuleSnapshots(baseline, contaminated)).toThrow(
      'changed 2 effective rules',
    );
    expect(compareAiBatchRuleSnapshots(baseline, contaminated, {
      allowMultipleRuleChanges: true,
    })).toMatchObject({
      policy: 'explicit_multi_variable',
      changes: [
        { scope: 'global', path: 'launchBasePower' },
        { scope: 'ai', path: 'commitmentResetFrames' },
      ],
    });
  });

  test('compares effective character rules and rejects a tampered snapshot', () => {
    const baseline = createAiBatchRuleSnapshot();
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames += 1;
    const candidate = createAiBatchRuleSnapshot(createDefaultTuning(), { vanguard });

    expect(compareAiBatchRuleSnapshots(baseline, candidate).changes).toContainEqual({
      scope: 'character',
      characterId: 'vanguard',
      path: 'moves.launch.startupFrames',
      baselineValue: vanguard.moves.launch.startupFrames - 1,
      candidateValue: vanguard.moves.launch.startupFrames,
      delta: 1,
    });

    const tampered = structuredClone(candidate);
    tampered.aiBehaviorTuning.commitmentResetFrames = 12;
    expect(parseAiBatchRuleSnapshot(tampered)).toBeNull();
    expect(parseAiBatchRuleSnapshot(candidate)).toEqual(candidate);
  });

  test('records one exact package-driven AI pacing change', () => {
    const baseline = createAiBatchRuleSnapshot();
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.ai.neutralApproachMultiplier = 0.75;
    const candidate = createAiBatchRuleSnapshot(createDefaultTuning(), { vanguard });

    expect(compareAiBatchRuleSnapshots(baseline, candidate)).toEqual({
      policy: 'single_variable',
      changes: [{
        scope: 'character',
        characterId: 'vanguard',
        path: 'ai.neutralApproachMultiplier',
        baselineValue: 1,
        candidateValue: 0.75,
        delta: -0.25,
      }],
    });

    const duelist = createCharacterBalanceConfig('duelist');
    duelist.ai.postControlSpacingFrames = 4;
    const spacingCandidate = createAiBatchRuleSnapshot(createDefaultTuning(), { duelist });
    expect(compareAiBatchRuleSnapshots(baseline, spacingCandidate)).toEqual({
      policy: 'single_variable',
      changes: [{
        scope: 'character',
        characterId: 'duelist',
        path: 'ai.postControlSpacingFrames',
        baselineValue: 0,
        candidateValue: 4,
        delta: 4,
      }],
    });
  });

  test('parses legacy zero-default tuning snapshots with the current neutral fingerprint', () => {
    const current = createAiBatchRuleSnapshot();
    const {
      postControlCounterLaunchClashGraceSeconds: _zeroNeutralField,
      combatBoostReacquireDelaySeconds: _combatBoostNeutralField,
      committedLocomotionInputAuthority: _locomotionAuthorityNeutralField,
      ordinaryBoostAccelerationSeconds: _boostAccelerationNeutralField,
      ...legacyTuning
    } = current.tuning;
    const legacy = {
      ...current,
      tuning: legacyTuning,
      fingerprint: fingerprintDeterministicValue({
        schemaVersion: current.schemaVersion,
        tuning: legacyTuning,
        characterBalanceOverrides: current.characterBalanceOverrides,
        aiBehaviorTuning: current.aiBehaviorTuning,
      }),
    };

    expect(current.fingerprint).toBe(legacy.fingerprint);
    expect(parseAiBatchRuleSnapshot(legacy)).toEqual(current);
    expect(parseAiBatchRuleSnapshot(legacy)?.tuning.postControlCounterLaunchClashGraceSeconds)
      .toBe(0);
    expect(parseAiBatchRuleSnapshot(legacy)?.tuning.combatBoostReacquireDelaySeconds).toBe(0);
    expect(parseAiBatchRuleSnapshot(legacy)?.tuning.committedLocomotionInputAuthority).toBe(0);
    expect(parseAiBatchRuleSnapshot(legacy)?.tuning.ordinaryBoostAccelerationSeconds).toBe(0);
  });

  test('includes a non-zero post-control counter grace value in rule fingerprints', () => {
    const baseline = createAiBatchRuleSnapshot();
    const tuning = createDefaultTuning();
    tuning.postControlCounterLaunchClashGraceSeconds = 0.05;
    const candidate = createAiBatchRuleSnapshot(tuning);

    expect(candidate.fingerprint).not.toBe(baseline.fingerprint);
    expect(compareAiBatchRuleSnapshots(baseline, candidate)).toEqual({
      policy: 'single_variable',
      changes: [{
        scope: 'global',
        characterId: null,
        path: 'postControlCounterLaunchClashGraceSeconds',
        baselineValue: 0,
        candidateValue: 0.05,
        delta: 0.05,
      }],
    });
  });

  test('validates a v12 fingerprint before migrating its zero-default chase lock', () => {
    const current = createAiBatchRuleSnapshot();
    const {
      postControlChaseLockFrames: _postControlChaseLockFrames,
      postControlRepeatDashWeightScale: _postControlRepeatDashWeightScale,
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...v12AiBehavior
    } = current.aiBehaviorTuning;
    const storedAiBehavior = {
      ...v12AiBehavior,
      schemaVersion: 'gw.ai-behavior-tuning.v12',
    };
    const legacy = {
      ...current,
      aiBehaviorTuning: storedAiBehavior,
      fingerprint: fingerprintDeterministicValue({
        schemaVersion: current.schemaVersion,
        tuning: createGameTuningFingerprintInput(current.tuning),
        characterBalanceOverrides: current.characterBalanceOverrides,
        aiBehaviorTuning: storedAiBehavior,
      }),
    };

    expect(legacy.fingerprint).not.toBe(current.fingerprint);
    expect(parseAiBatchRuleSnapshot(legacy)).toEqual(current);

    legacy.aiBehaviorTuning.commitmentResetFrames = 12;
    expect(parseAiBatchRuleSnapshot(legacy)).toBeNull();
  });

  test('validates a v14 fingerprint before migrating neutral between-exchange repositioning', () => {
    const current = createAiBatchRuleSnapshot();
    const {
      exchangeRepositionWeightScale: _exchangeRepositionWeightScale,
      ...v14AiBehavior
    } = current.aiBehaviorTuning;
    const storedAiBehavior = {
      ...v14AiBehavior,
      schemaVersion: 'gw.ai-behavior-tuning.v14',
    };
    const legacy = {
      ...current,
      aiBehaviorTuning: storedAiBehavior,
      fingerprint: fingerprintDeterministicValue({
        schemaVersion: current.schemaVersion,
        tuning: createGameTuningFingerprintInput(current.tuning),
        characterBalanceOverrides: current.characterBalanceOverrides,
        aiBehaviorTuning: storedAiBehavior,
      }),
    };

    expect(legacy.fingerprint).not.toBe(current.fingerprint);
    expect(parseAiBatchRuleSnapshot(legacy)).toEqual(current);

    legacy.aiBehaviorTuning.repositionWeightScale = 1;
    expect(parseAiBatchRuleSnapshot(legacy)).toBeNull();
  });

  test('fingerprints between-exchange reposition candidates as one exact AI rule change', () => {
    const baseline = createAiBatchRuleSnapshot();
    const candidate = createAiBatchRuleSnapshot(
      createDefaultTuning(),
      {},
      {
        ...createDefaultAiBehaviorTuning(),
        exchangeRepositionWeightScale: 0.5,
      },
    );

    expect(compareAiBatchRuleSnapshots(baseline, candidate)).toEqual({
      policy: 'single_variable',
      changes: [{
        scope: 'ai',
        characterId: null,
        path: 'exchangeRepositionWeightScale',
        baselineValue: 0,
        candidateValue: 0.5,
        delta: 0.5,
      }],
    });
  });

  test('fingerprints chase-lock candidates as one exact AI rule change', () => {
    const baseline = createAiBatchRuleSnapshot();
    const candidate = createAiBatchRuleSnapshot(
      createDefaultTuning(),
      {},
      {
        ...createDefaultAiBehaviorTuning(),
        postControlChaseLockFrames: 12,
      },
    );

    expect(candidate.fingerprint).not.toBe(baseline.fingerprint);
    expect(compareAiBatchRuleSnapshots(baseline, candidate)).toEqual({
      policy: 'single_variable',
      changes: [{
        scope: 'ai',
        characterId: null,
        path: 'postControlChaseLockFrames',
        baselineValue: 0,
        candidateValue: 12,
        delta: 12,
      }],
    });
  });
});
