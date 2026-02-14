import { describe, expect, test } from 'vitest';
import type { PlayerFrameInput } from '../sim/types';
import { createInputTimelineBuffer } from './inputTimeline';

function neutralInput(): PlayerFrameInput {
  return {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

describe('input timeline buffer', () => {
  test('returns missing frame lookups without throwing', () => {
    const timeline = createInputTimelineBuffer();
    const frame = timeline.getFrame(42);
    expect(frame.p1).toBeNull();
    expect(frame.p2).toBeNull();
    expect(frame.hasBothPlayers).toBe(false);
  });

  test('supports out-of-order inserts and per-player lookup', () => {
    const timeline = createInputTimelineBuffer();
    const p1 = { ...neutralInput(), moveX: 1 };
    const p2 = { ...neutralInput(), moveY: -1 };

    timeline.setRemoteAuthoritativeInput(10, 'P2', p2);
    timeline.setLocalInput(8, 'P1', p1);
    timeline.setRemoteAuthoritativeInput(8, 'P2', p2);

    const frame8 = timeline.getFrame(8);
    expect(frame8.p1?.source).toBe('local');
    expect(frame8.p2?.source).toBe('remote_authoritative');
    expect(frame8.hasBothPlayers).toBe(true);

    const frame10P2 = timeline.getPlayerInput(10, 'P2');
    expect(frame10P2?.input.moveY).toBe(-1);
  });

  test('replaces predicted remote input when late authoritative input arrives', () => {
    const timeline = createInputTimelineBuffer();
    const predicted = { ...neutralInput(), moveX: 1 };
    const authoritative = { ...neutralInput(), moveX: -1 };

    timeline.setPredictedRemoteInput(15, 'P2', predicted);
    const replacement = timeline.setRemoteAuthoritativeInput(15, 'P2', authoritative);

    expect(replacement.replaced).toBe(true);
    expect(replacement.replacedPrediction).toBe(true);
    expect(replacement.changed).toBe(true);
    expect(replacement.previousSource).toBe('remote_predicted');
    expect(replacement.nextSource).toBe('remote_authoritative');

    const resolved = timeline.getPlayerInput(15, 'P2');
    expect(resolved?.source).toBe('remote_authoritative');
    expect(resolved?.input.moveX).toBe(-1);
  });

  test('ignores stale predicted input after authoritative data exists', () => {
    const timeline = createInputTimelineBuffer();
    const authoritative = { ...neutralInput(), moveY: 1 };
    const stalePrediction = { ...neutralInput(), moveY: -1 };

    timeline.setRemoteAuthoritativeInput(9, 'P2', authoritative);
    const ignored = timeline.setPredictedRemoteInput(9, 'P2', stalePrediction);

    expect(ignored.ignored).toBe(true);
    expect(ignored.replaced).toBe(false);
    const final = timeline.getPlayerInput(9, 'P2');
    expect(final?.source).toBe('remote_authoritative');
    expect(final?.input.moveY).toBe(1);
  });
});
