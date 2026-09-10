import { describe, expect, test } from 'vitest';
import { createInitialState, getRenderSnapshot } from '../sim/sim';
import { resolvePlayerActivityReadability, resolvePlayerIndicatorPresentation } from './actionReadability';

function player() {
  return getRenderSnapshot(createInitialState()).players.P1;
}

describe('phase-local combat indicator presentation', () => {
  test('startup settles once from move elapsed time and never pulses with global time', () => {
    const p = { ...player(), presentationAction: 'launch' as const, presentationPhase: 'startup' as const };
    let priorOpacity = 0;
    for (const elapsed of [0, 0.0005, 0.02, 0.04, 0.08, 1, 60]) {
      p.presentationElapsedSeconds = elapsed;
      const result = resolvePlayerIndicatorPresentation(p, 100)!;
      expect(result.indicatorId).toBe('launch');
      expect(result.phase).toBe('startup');
      expect(result.color).toBe('#ffc247');
      expect(result.opacity).toBeGreaterThanOrEqual(priorOpacity);
      expect(result.opacity).toBeLessThanOrEqual(0.72);
      expect(resolvePlayerIndicatorPresentation(p, 100.0005)).toEqual(result);
      expect(resolvePlayerIndicatorPresentation(p, -500)).toEqual(result);
      priorOpacity = result.opacity;
    }
    p.presentationElapsedSeconds = 0;
    expect(resolvePlayerIndicatorPresentation(p, 100)!.opacity).toBe(0.58);
  });

  test.each(['active', 'sustain', 'recovery'] as const)('keeps %s exact and stable at any render time', (phase) => {
    const p = { ...player(), presentationAction: 'launch' as const, presentationPhase: phase };
    const result = resolvePlayerIndicatorPresentation(p, 1)!;
    expect(result.phase).toBe(phase);
    expect(resolvePlayerIndicatorPresentation(p, 1.0005)).toEqual(result);
    expect(resolvePlayerIndicatorPresentation(p, 999999)).toEqual(result);
  });

  test.each(['helpless', 'attack_recovery', 'recover'] as const)('shows a hollow vulnerability halo for %s, not stale action flashes', (action) => {
    const p = { ...player(), presentationAction: action, breakFlash: 0.2, parryFlash: 0.2 };
    const result = resolvePlayerIndicatorPresentation(p, 8)!;
    expect(result.indicatorId).toBe('vulnerability');
    expect(result.color).toBe(action === 'helpless' ? '#ff9b7a' : '#a8b4ca');
    expect(resolvePlayerIndicatorPresentation(p, 8.0005)).toEqual(result);
    expect(resolvePlayerIndicatorPresentation(player(), 8)).toBeNull();
  });

  test('reports attack recovery rather than idle and sanitizes absent or non-finite phase clocks', () => {
    expect(resolvePlayerActivityReadability({ ...player(), presentationAction: 'attack_recovery' }).label)
      .toBe('Attack recovery / VULNERABLE');
    for (const elapsed of [undefined, NaN, Infinity, -1]) {
      const result = resolvePlayerIndicatorPresentation({
        ...player(), presentationAction: 'launch', presentationPhase: 'startup', presentationElapsedSeconds: elapsed,
      })!;
      expect(Number.isFinite(result.opacity)).toBe(true);
      expect(result.opacity).toBeGreaterThanOrEqual(0.58);
      expect(result.opacity).toBeLessThanOrEqual(0.72);
    }
  });
});
