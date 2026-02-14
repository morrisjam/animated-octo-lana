import { describe, expect, test } from 'vitest';
import { computeStateChecksum } from '../sim/checksum';
import { createInitialState, step } from '../sim/sim';
import type { FrameInput, PlayerFrameInput } from '../sim/types';
import { RollbackSession } from './rollbackSession';

const FIXED_DT = 1 / 60;

function neutralPlayerInput(): PlayerFrameInput {
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

function makeFrameInput(p1: PlayerFrameInput, p2: PlayerFrameInput): FrameInput {
  return {
    p1: { ...p1 },
    p2: { ...p2 },
  };
}

describe('rollback session', () => {
  test('uses predicted remote input when authoritative input is missing', () => {
    const initial = createInitialState({ seed: 77 });
    const session = new RollbackSession({
      initialState: initial,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
    });

    const local = { ...neutralPlayerInput(), moveX: 1 };
    session.advanceFrame({
      localInput: local,
      remoteAuthoritativeInput: { ...neutralPlayerInput(), moveY: -1 },
    });

    const predictedAdvance = session.advanceFrame({
      localInput: local,
    });

    expect(predictedAdvance.usedPrediction).toBe(true);
    const timelineEntry = session.getTimelineEntry(1, 'P2');
    expect(timelineEntry?.source).toBe('remote_predicted');
    expect(timelineEntry?.input.moveY).toBe(-1);
  });

  test('late authoritative remote input rolls back and resimulates to canonical state', () => {
    const initial = createInitialState({ seed: 2026 });
    const session = new RollbackSession({
      initialState: initial,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
    });

    const localInputs: PlayerFrameInput[] = [
      { ...neutralPlayerInput(), moveX: 1 },
      { ...neutralPlayerInput(), moveX: -1 },
      { ...neutralPlayerInput(), moveY: 1 },
    ];

    const remoteFrame0 = { ...neutralPlayerInput(), moveY: 0 };
    session.advanceFrame({ localInput: localInputs[0], remoteAuthoritativeInput: remoteFrame0 });
    session.advanceFrame({ localInput: localInputs[1] });
    session.advanceFrame({ localInput: localInputs[2] });

    const rollbackFrames = session.setRemoteAuthoritativeInput(1, { ...neutralPlayerInput(), moveY: 1 });
    expect(rollbackFrames).toBe(2);

    const baseline = createInitialState({ seed: 2026 });
    step(baseline, makeFrameInput(localInputs[0], remoteFrame0), FIXED_DT);
    step(baseline, makeFrameInput(localInputs[1], { ...neutralPlayerInput(), moveY: 1 }), FIXED_DT);
    // Frame 2 has no authoritative remote input yet, so prediction should reuse frame 1 remote input.
    step(baseline, makeFrameInput(localInputs[2], { ...neutralPlayerInput(), moveY: 1 }), FIXED_DT);

    expect(computeStateChecksum(session.getStateSnapshot())).toBe(computeStateChecksum(baseline));

    const diagnostics = session.getDiagnosticsSnapshot();
    expect(diagnostics.totalRollbacks).toBe(1);
    expect(diagnostics.maxRollbackDepth).toBe(2);
    expect(diagnostics.lastRollbackFromFrame).toBe(1);
    expect(diagnostics.desyncEvents.length).toBeGreaterThan(0);
    expect(diagnostics.desyncEvents[0].frame).toBe(1);
    expect(diagnostics.desyncEvents[0].preRollbackChecksum).not.toBe(
      diagnostics.desyncEvents[0].postRollbackChecksum,
    );

    const pending = session.drainPendingDesyncEvents();
    expect(pending.length).toBeGreaterThan(0);
    expect(session.drainPendingDesyncEvents()).toEqual([]);
  });
});
