import { describe, expect, test } from 'vitest';
import { createDefaultAiBehaviorTuning } from './ai';
import {
  compareAiBatchRuleSnapshots,
  createAiBatchRuleSnapshot,
  parseAiBatchRuleSnapshot,
} from './aiBatchRuleComparison';
import { createCharacterBalanceConfig } from './characterBalance';
import { createDefaultTuning } from './tuning';

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
});
