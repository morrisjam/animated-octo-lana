import { describe, expect, it, vi } from 'vitest';
import {
  LocalRankedRecoverySmokeController,
  type LocalRankedRecoverySmokeObservation,
} from './localRankedRecoverySmoke';

function observation(
  overrides: Partial<LocalRankedRecoverySmokeObservation> = {},
): LocalRankedRecoverySmokeObservation {
  return {
    roundEpoch: 2,
    simulationFrame: 14,
    outboundFrames: 3,
    mutuallyConfirmedThrough: 10,
    attemptGeneration: 4,
    connectionPath: 'relay',
    relayAvailable: true,
    ...overrides,
  };
}

describe('LocalRankedRecoverySmokeController', () => {
  it('captures a speculative tail and proves one same-round replacement', () => {
    const controller = new LocalRankedRecoverySmokeController({
      initialAttemptGeneration: 4,
      forceRelayRequested: true,
    });
    const requestRecovery = vi.fn();

    controller.arm();
    expect(controller.observeSpeculativeTail(observation())).toBe(true);
    expect(controller.isHoldingBeforeRecovery()).toBe(true);
    controller.triggerRecovery(observation(), requestRecovery);
    expect(requestRecovery).toHaveBeenCalledOnce();
    expect(controller.isHoldingBeforeRecovery()).toBe(false);

    controller.markCheckpointPrepared(2, 10);
    controller.markAttemptAdvanced({
      generation: 5,
      relayAvailable: true,
      iceTransportPolicy: 'relay',
    });
    controller.markRecovered({
      generation: 5,
      roundEpoch: 2,
      agreedThrough: 9,
      connectionPath: 'relay',
      relayAvailable: true,
      iceTransportPolicy: 'relay',
    });

    expect(controller.getDiagnostics(2)).toMatchObject({
      phase: 'recovered',
      initialAttemptGeneration: 4,
      triggerAttemptGeneration: 4,
      recoveredAttemptGeneration: 5,
      triggerRoundEpoch: 2,
      checkpointRoundEpoch: 2,
      recoveredRoundEpoch: 2,
      triggerSimulationFrame: 14,
      triggerOutboundFrames: 3,
      triggerMutuallyConfirmedThrough: 10,
      checkpointConfirmedThrough: 10,
      agreedThrough: 9,
      connectionPathBefore: 'relay',
      connectionPathAfter: 'relay',
      recoveryCount: 1,
      tailDrained: false,
      tailDrainedRoundEpoch: null,
    });
    controller.observeOutboundTail(3, 0);
    expect(controller.getDiagnostics(0).tailDrained).toBe(false);
    controller.observeOutboundTail(2, 0);
    expect(controller.getDiagnostics(0)).toMatchObject({
      tailDrained: true,
      tailDrainedRoundEpoch: 2,
    });
  });

  it('waits for both an outbound tail and a speculative frame boundary', () => {
    const controller = new LocalRankedRecoverySmokeController({
      initialAttemptGeneration: 4,
      forceRelayRequested: false,
    });
    controller.arm();

    expect(controller.observeSpeculativeTail(observation({ outboundFrames: 0 }))).toBe(false);
    expect(controller.observeSpeculativeTail(observation({ mutuallyConfirmedThrough: 14 }))).toBe(false);
    expect(controller.observeSpeculativeTail(observation())).toBe(true);
    expect(() => controller.triggerRecovery(
      observation({ simulationFrame: 15 }),
      () => undefined,
    )).toThrow(/timeline advanced/);
  });

  it('retains conflicting and too-late input evidence across the completed match', () => {
    const controller = new LocalRankedRecoverySmokeController({
      initialAttemptGeneration: 1,
      forceRelayRequested: false,
    });

    controller.recordRejectedInputs(2, 1);
    controller.recordRejectedInputs(1, 3);

    expect(controller.getDiagnostics(0)).toMatchObject({
      conflictingInputs: 3,
      tooLateInputs: 4,
    });
  });
});
