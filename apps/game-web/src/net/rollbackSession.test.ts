import { describe, expect, test } from 'vitest';
import { computeStateChecksum } from '../sim/checksum';
import { createCharacterBalanceConfig } from '../sim/characterBalance';
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
    expect(diagnostics.correctionEvents.length).toBeGreaterThan(0);
    expect(diagnostics.correctionEvents[0].frame).toBe(1);
    expect(diagnostics.correctionEvents[0].predictedStateChecksum).not.toBe(
      diagnostics.correctionEvents[0].correctedStateChecksum,
    );

    const pending = session.drainPendingCorrectionEvents();
    expect(pending.length).toBeGreaterThan(0);
    expect(session.drainPendingCorrectionEvents()).toEqual([]);
  });

  test('exposes corrected per-frame checksums only while rollback history is retained', () => {
    const session = new RollbackSession({
      initialState: createInitialState({ seed: 303 }),
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
      maxHistoryFrames: 2,
    });
    const firstLocal = { ...neutralPlayerInput(), moveX: 1 };
    const firstRemote = { ...neutralPlayerInput(), moveY: -1 };
    session.advanceFrame({
      localInput: firstLocal,
      remoteAuthoritativeInput: firstRemote,
    });

    const baseline = createInitialState({ seed: 303 });
    step(baseline, makeFrameInput(firstLocal, firstRemote), FIXED_DT);
    expect(session.getCorrectedFrameChecksum(0)).toBe(computeStateChecksum(baseline));

    session.advanceFrame({ localInput: neutralPlayerInput() });
    session.advanceFrame({ localInput: neutralPlayerInput() });
    session.advanceFrame({ localInput: neutralPlayerInput() });
    expect(session.getCorrectedFrameChecksum(0)).toBeNull();
    expect(() => session.getCorrectedFrameChecksum(-1)).toThrow(/non-negative integer/);
  });

  test('exposes the initial state as the recovery prefix before frame zero', () => {
    const initial = createInitialState({ seed: 304 });
    const session = new RollbackSession({
      initialState: initial,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
    });

    expect(session.getRecoveryCheckpointChecksum(-1)).toBe(computeStateChecksum(initial));
    expect(() => session.getRecoveryCheckpointChecksum(-2)).toThrow(/at least -1/);
  });

  test('batches multiple late authoritative inputs into one rollback', () => {
    const initial = createInitialState({ seed: 404 });
    const session = new RollbackSession({
      initialState: initial,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
    });
    const localInputs = [
      { ...neutralPlayerInput(), moveX: 1 },
      { ...neutralPlayerInput(), moveY: 1 },
      { ...neutralPlayerInput(), moveX: -1 },
      { ...neutralPlayerInput(), moveY: -1 },
    ];
    const remoteFrame0 = neutralPlayerInput();
    for (const [frame, localInput] of localInputs.entries()) {
      session.advanceFrame({
        localInput,
        remoteAuthoritativeInput: frame === 0 ? remoteFrame0 : null,
      });
    }

    const remoteFrame1 = { ...neutralPlayerInput(), moveX: -1 };
    const remoteFrame2 = { ...neutralPlayerInput(), moveY: 1 };
    const rollbackFrames = session.setRemoteAuthoritativeInputs([
      { frame: 2, input: remoteFrame2 },
      { frame: 1, input: remoteFrame1 },
    ]);

    expect(rollbackFrames).toBe(3);
    expect(session.getDiagnosticsSnapshot().totalRollbacks).toBe(1);

    const baseline = createInitialState({ seed: 404 });
    step(baseline, makeFrameInput(localInputs[0], remoteFrame0), FIXED_DT);
    step(baseline, makeFrameInput(localInputs[1], remoteFrame1), FIXED_DT);
    step(baseline, makeFrameInput(localInputs[2], remoteFrame2), FIXED_DT);
    step(baseline, makeFrameInput(localInputs[3], remoteFrame2), FIXED_DT);
    expect(computeStateChecksum(session.getStateSnapshot())).toBe(computeStateChecksum(baseline));
  });

  test('preserves local character rules through rollback and resimulation', () => {
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames = 2;
    vanguard.moves.dunk.hitRange += 1.25;
    const overrides = { vanguard };
    const initial = createInitialState({ seed: 505, characterBalanceOverrides: overrides });
    const session = new RollbackSession({
      initialState: initial,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
    });
    const localInputs = [
      { ...neutralPlayerInput(), moveX: 1 },
      { ...neutralPlayerInput(), launch: true },
      { ...neutralPlayerInput(), moveY: 1 },
    ];
    const remoteFrame0 = neutralPlayerInput();
    session.advanceFrame({ localInput: localInputs[0], remoteAuthoritativeInput: remoteFrame0 });
    session.advanceFrame({ localInput: localInputs[1] });
    session.advanceFrame({ localInput: localInputs[2] });

    const correctedRemote = { ...neutralPlayerInput(), moveY: -1 };
    session.setRemoteAuthoritativeInput(1, correctedRemote);

    const baseline = createInitialState({ seed: 505, characterBalanceOverrides: overrides });
    step(baseline, makeFrameInput(localInputs[0], remoteFrame0), FIXED_DT);
    step(baseline, makeFrameInput(localInputs[1], correctedRemote), FIXED_DT);
    step(baseline, makeFrameInput(localInputs[2], correctedRemote), FIXED_DT);

    const rolledBack = session.getStateSnapshot();
    expect(rolledBack.characterBalanceOverrides.vanguard?.moves.launch.startupFrames).toBe(2);
    expect(computeStateChecksum(rolledBack)).toBe(computeStateChecksum(baseline));
  });

  test('reports duplicate, conflicting, and too-late authoritative frames', () => {
    const session = new RollbackSession({
      initialState: createInitialState({ seed: 606 }),
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
      maxHistoryFrames: 2,
    });
    const authoritativeFrame0 = { ...neutralPlayerInput(), moveX: -1 };
    session.advanceFrame({
      localInput: neutralPlayerInput(),
      remoteAuthoritativeInput: authoritativeFrame0,
    });

    const duplicateAndConflict = session.applyRemoteAuthoritativeInputs([
      { frame: 0, input: authoritativeFrame0 },
      { frame: 0, input: { ...authoritativeFrame0, moveX: 1 } },
    ]);
    expect(duplicateAndConflict.duplicateFrames).toEqual([0]);
    expect(duplicateAndConflict.conflictingFrames).toEqual([0]);

    session.advanceFrame({ localInput: neutralPlayerInput() });
    session.advanceFrame({ localInput: neutralPlayerInput() });
    session.advanceFrame({ localInput: neutralPlayerInput() });
    const tooLate = session.applyRemoteAuthoritativeInputs([
      { frame: 0, input: authoritativeFrame0 },
    ]);
    expect(tooLate.acceptedFrames).toEqual([]);
    expect(tooLate.tooLateFrames).toEqual([0]);
    expect(session.getDiagnosticsSnapshot()).toMatchObject({
      duplicateAuthoritativeFrames: 1,
      conflictingAuthoritativeFrames: 1,
      tooLateAuthoritativeFrames: 1,
    });
  });

  test('retains the first winning frame after simulation advances beyond it', () => {
    const initial = createInitialState({ seed: 707 });
    initial.players.P1.pos = { x: 0, y: 0 };
    initial.players.P2.pos = { x: 2, y: 0 };
    initial.players.P2.fuel = 0;
    initial.players.P2.helpless = 2;
    const session = new RollbackSession({
      initialState: initial,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
    });

    let firstWinningFrame: number | null = null;
    for (let frame = 0; frame < 120; frame += 1) {
      session.advanceFrame({
        localInput: { ...neutralPlayerInput(), dunk: frame === 0 },
        remoteAuthoritativeInput: neutralPlayerInput(),
      });
      if (session.getStateSnapshot().winner && firstWinningFrame === null) {
        firstWinningFrame = frame;
      }
    }

    expect(firstWinningFrame).not.toBeNull();
    expect(session.getWinningFrame()).toMatchObject({
      frame: firstWinningFrame,
      winner: 'P1',
    });
    expect(session.getCurrentFrame()).toBeGreaterThan(Number(firstWinningFrame) + 1);
  });
});
