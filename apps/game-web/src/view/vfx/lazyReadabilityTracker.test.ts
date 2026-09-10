import { describe, expect, test, vi } from 'vitest';
import { createInitialState } from '../../sim/sim';
import { createLazyCombatReadabilityTracker } from './lazyReadabilityTracker';
import type { CombatReadabilityTracker } from './readabilityTracker';

describe('lazy local outcome tracker', () => {
  test('does not load until observation and never replays stale frames after a reset', async () => {
    let resolve!: (tracker: CombatReadabilityTracker) => void;
    const load = vi.fn(() => new Promise<CombatReadabilityTracker>((yes) => { resolve = yes; }));
    const lazy = createLazyCombatReadabilityTracker(load);
    const tracker = { reset: vi.fn(), recordFrame: vi.fn(() => []) };
    lazy.reset();
    expect(load).not.toHaveBeenCalled();
    expect(lazy.recordFrame(createInitialState())).toEqual([]);
    lazy.reset();
    expect(lazy.recordFrame(createInitialState())).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
    resolve(tracker);
    await Promise.resolve();
    expect(tracker.recordFrame).not.toHaveBeenCalled();
    const state = createInitialState();
    lazy.recordFrame(state, []);
    expect(tracker.recordFrame).toHaveBeenCalledWith(state, []);
    lazy.reset();
    expect(tracker.reset).toHaveBeenCalledOnce();
  });

  test('a failed optional chunk leaves gameplay running without repeated requests or false cues', async () => {
    const load = vi.fn(async () => { throw new Error('offline'); });
    const lazy = createLazyCombatReadabilityTracker(load);
    expect(lazy.recordFrame(createInitialState())).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    lazy.reset();
    expect(lazy.recordFrame(createInitialState())).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
  });
});
