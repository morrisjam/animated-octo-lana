import { describe, expect, it } from 'vitest';
import { createInitialState, step } from './sim';
import { computeStateChecksum } from './checksum';
import {
  attachBalanceReplayCandidate,
  createBalanceReplayComparison,
  describeBalanceReplayComparison,
  selectBalanceReplaySample,
} from './balanceReplayComparison';
import type { BalanceLabRuleChange } from './balanceLab';
import type { ReplayPayload } from './replay';
import type { FrameInput, GameTuning } from './types';

const FIXED_DT = 1 / 60;

function createReplay(options: {
  frames?: number;
  seed?: number;
  rulesetVersion?: string;
  tuning?: Partial<GameTuning>;
} = {}): ReplayPayload {
  const state = createInitialState({ seed: options.seed ?? 77 });
  if (options.tuning) {
    state.tuning = { ...state.tuning, ...options.tuning };
  }
  const frames = options.frames ?? 4;
  const inputTimeline: FrameInput[] = [];
  const expectedChecksums: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const input: FrameInput = {
      p1: { moveX: frame % 2 === 0 ? 1 : 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
      p2: { moveX: -1, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
    };
    step(state, input, FIXED_DT);
    inputTimeline.push(input);
    expectedChecksums.push(computeStateChecksum(state));
  }
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: options.rulesetVersion ?? 'test-rules',
      simBuildHash: 'test-build',
      seed: options.seed ?? 77,
      loadout: { ...state.loadout },
      fixedDt: FIXED_DT,
      advanceRngPerFrame: false,
      rules: { ...state.rules },
      balanceTuning: { ...state.tuning },
      characterBalanceOverrides: structuredClone(state.characterBalanceOverrides),
      reviewFocus: {
        schemaVersion: 'gw.replay-focus.v1',
        source: 'test',
        label: 'Contact incident',
        focusFrame: 2,
        endFrame: 3,
      },
    },
    inputTimeline,
    rounds: [{ round: 1, startFrame: 0, endFrame: frames - 1 }],
    expectedChecksums,
  };
}

describe('balance replay comparison', () => {
  it('captures a checksum-verified baseline and clamps its incident focus', () => {
    const baseline = createReplay();
    baseline.header.reviewFocus = {
      schemaVersion: 'gw.replay-focus.v1',
      source: 'test',
      label: 'Late incident',
      focusFrame: 200,
      endFrame: 400,
    };
    const comparison = createBalanceReplayComparison(baseline);

    expect(comparison.baseline.focus).toMatchObject({
      label: 'Late incident',
      focusFrame: 3,
      endFrame: 3,
    });
    baseline.inputTimeline[0]!.p1 = { moveX: -1 };
    expect(comparison.baseline.payload.inputTimeline[0]?.p1?.moveX).toBe(1);
  });

  it('retains aligned baseline and candidate samples for one effective change', () => {
    const baseline = createReplay();
    const candidate = createReplay({ tuning: { closeRangeSeparationImpulse: 11 } });
    const change: BalanceLabRuleChange = {
      scope: 'global',
      characterId: null,
      path: 'closeRangeSeparationImpulse',
      baselineValue: 10,
      candidateValue: 11,
      delta: 1,
    };
    const comparison = attachBalanceReplayCandidate(
      createBalanceReplayComparison(baseline),
      candidate,
      [change],
    );

    expect(comparison.ruleChanges).toEqual([change]);
    expect(selectBalanceReplaySample(comparison, 'baseline', 3)).toMatchObject({
      variant: 'baseline',
      frameIndex: 3,
    });
    expect(selectBalanceReplaySample(comparison, 'candidate', 3)).toMatchObject({
      variant: 'candidate',
      frameIndex: 3,
    });
    expect(comparison.candidate?.focus).toEqual(comparison.baseline.focus);
  });

  it('allows a zero-change repeatability control', () => {
    const baseline = createReplay();
    const comparison = attachBalanceReplayCandidate(
      createBalanceReplayComparison(baseline),
      createReplay(),
      [],
    );
    expect(comparison.candidate).not.toBeNull();
    expect(comparison.ruleChanges).toEqual([]);
    expect(describeBalanceReplayComparison(comparison)).toEqual({
      mode: 'repeatability',
      label: 'Repeatability control: no effective rule change.',
    });
  });

  it('accepts the local draft suffix but rejects a different base ruleset', () => {
    const comparison = createBalanceReplayComparison(createReplay());
    expect(() => attachBalanceReplayCandidate(
      comparison,
      createReplay({ rulesetVersion: 'test-rules+custom_local' }),
      [],
    )).not.toThrow();
    expect(() => attachBalanceReplayCandidate(
      comparison,
      createReplay({ rulesetVersion: 'other-rules+custom_local' }),
      [],
    )).toThrow('baseline base ruleset');
  });

  it('describes baseline-only and exact single-rule comparisons for the viewer', () => {
    const baseline = createReplay();
    const baselineOnly = createBalanceReplayComparison(baseline);
    expect(describeBalanceReplayComparison(baselineOnly)).toEqual({
      mode: 'baseline_only',
      label: 'Baseline captured; run the matched candidate to unlock A/B review.',
    });
    expect(() => selectBalanceReplaySample(baselineOnly, 'candidate')).toThrow(
      'Candidate replay is not available yet.',
    );

    const comparison = attachBalanceReplayCandidate(
      baselineOnly,
      createReplay({ tuning: { closeRangeSeparationImpulse: 11.25 } }),
      [{
        scope: 'global',
        characterId: null,
        path: 'closeRangeSeparationImpulse',
        baselineValue: 10,
        candidateValue: 11.25,
        delta: 1.25,
      }],
    );
    expect(describeBalanceReplayComparison(comparison)).toEqual({
      mode: 'single_change',
      label: 'Close Range Separation Impulse: 10 -> 11.25',
    });
  });

  it('rejects multi-variable, unmatched, and checksum-invalid candidates', () => {
    const baseline = createReplay();
    const comparison = createBalanceReplayComparison(baseline);
    const changes: BalanceLabRuleChange[] = [
      {
        scope: 'global',
        characterId: null,
        path: 'closeRangeSeparationImpulse',
        baselineValue: 10,
        candidateValue: 11,
        delta: 1,
      },
      {
        scope: 'global',
        characterId: null,
        path: 'closeRangeSeparationPadding',
        baselineValue: 4.2,
        candidateValue: 5,
        delta: 0.8,
      },
    ];

    expect(() => attachBalanceReplayCandidate(comparison, createReplay(), changes)).toThrow(
      'exactly one effective rule change',
    );
    expect(() => attachBalanceReplayCandidate(comparison, createReplay({ frames: 5 }), [])).toThrow(
      'matched-sample frame count',
    );
    expect(() => attachBalanceReplayCandidate(comparison, createReplay({ seed: 78 }), [])).toThrow(
      'preserve the baseline',
    );

    const tampered = createReplay();
    tampered.expectedChecksums![1] = 123;
    expect(() => attachBalanceReplayCandidate(comparison, tampered, [])).toThrow(
      'checksum mismatch',
    );
  });
});
