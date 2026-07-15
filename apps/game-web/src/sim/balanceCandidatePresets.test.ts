import { describe, expect, test } from 'vitest';
import { createDefaultAiBehaviorTuning } from './ai';
import { createCharacterBalanceConfig } from './characterBalance';
import {
  applyBalanceCandidatePreset,
  BALANCE_CANDIDATE_PRESET_IDS,
  BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION,
  BALANCE_CANDIDATE_PRESETS,
  resolveBalanceCandidatePreset,
} from './balanceCandidatePresets';
import { createDefaultTuning } from './tuning';

describe('Balance Lab candidate presets', () => {
  test('exports a versioned human-review registry with explicit rule evidence', () => {
    expect(BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION).toBe('gw.balance-candidate-preset.v1');
    expect(BALANCE_CANDIDATE_PRESET_IDS).toEqual(['launch_break_agency_v1']);
    expect(BALANCE_CANDIDATE_PRESETS.map((preset) => preset.id)).toEqual(BALANCE_CANDIDATE_PRESET_IDS);
    expect(BALANCE_CANDIDATE_PRESETS[0]).toMatchObject({
      status: 'human_review',
      rules: [
        { characterId: 'vanguard', baselineValue: 18, candidateValue: 6 },
        { characterId: 'duelist', baselineValue: 28, candidateValue: 10 },
      ],
    });
  });

  test('stages only the two candidate character rules without mutating current drafts', () => {
    const tuning = createDefaultTuning();
    const aiBehavior = createDefaultAiBehaviorTuning();
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames = 9;
    const overrides = { vanguard };

    const applied = applyBalanceCandidatePreset(
      'launch_break_agency_v1',
      tuning,
      overrides,
      aiBehavior,
    );

    expect(applied.tuning).toEqual(tuning);
    expect(applied.aiBehaviorTuning).toEqual(aiBehavior);
    expect(applied.characterBalanceOverrides.vanguard?.moves.launch.startupFrames).toBe(9);
    expect(applied.characterBalanceOverrides.vanguard?.moves.break.recoveryFrames).toBe(6);
    expect(applied.characterBalanceOverrides.duelist?.moves.break.recoveryFrames).toBe(10);
    expect(overrides.vanguard.moves.break.recoveryFrames).toBe(18);
    expect(overrides).not.toHaveProperty('duelist');
  });

  test('falls back deterministically for an invalid preset id', () => {
    expect(resolveBalanceCandidatePreset('missing')).toBe(BALANCE_CANDIDATE_PRESETS[0]);
  });
});
