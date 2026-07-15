export type LocalRankedRecoverySmokePhase =
  | 'idle'
  | 'armed'
  | 'ready'
  | 'triggered'
  | 'recovered'
  | 'failed';

export interface LocalRankedRecoverySmokeObservation {
  roundEpoch: number;
  simulationFrame: number;
  outboundFrames: number;
  mutuallyConfirmedThrough: number;
  attemptGeneration: number;
  connectionPath: string;
  relayAvailable: boolean;
}

export interface LocalRankedRecoverySmokeDiagnostics {
  phase: LocalRankedRecoverySmokePhase;
  forceRelayRequested: boolean;
  initialAttemptGeneration: number;
  triggerAttemptGeneration: number | null;
  recoveredAttemptGeneration: number | null;
  triggerRoundEpoch: number | null;
  checkpointRoundEpoch: number | null;
  recoveredRoundEpoch: number | null;
  triggerSimulationFrame: number | null;
  triggerOutboundFrames: number;
  triggerMutuallyConfirmedThrough: number | null;
  checkpointConfirmedThrough: number | null;
  agreedThrough: number | null;
  connectionPathBefore: string | null;
  connectionPathAfter: string | null;
  relayAvailableBefore: boolean | null;
  relayAvailableAfter: boolean | null;
  iceTransportPolicyAfter: string | null;
  recoveryCount: number;
  tailDrained: boolean;
  tailDrainedRoundEpoch: number | null;
  conflictingInputs: number;
  tooLateInputs: number;
  detail: string;
}

interface LocalRankedRecoverySmokeOptions {
  initialAttemptGeneration: number;
  forceRelayRequested: boolean;
}

interface AttemptAdvancedObservation {
  generation: number;
  relayAvailable: boolean;
  iceTransportPolicy: string;
}

interface RecoveredObservation extends AttemptAdvancedObservation {
  roundEpoch: number;
  agreedThrough: number;
  connectionPath: string;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

function assertFrameCursor(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < -1) {
    throw new Error(`${name} must be a safe integer at least -1.`);
  }
}

function cloneObservation(
  observation: LocalRankedRecoverySmokeObservation,
): LocalRankedRecoverySmokeObservation {
  return { ...observation };
}

/** Coordinates the loopback production-root recovery drill without replacing real transport code. */
export class LocalRankedRecoverySmokeController {
  private readonly initialAttemptGeneration: number;

  private readonly forceRelayRequested: boolean;

  private phase: LocalRankedRecoverySmokePhase = 'idle';

  private triggerObservation: LocalRankedRecoverySmokeObservation | null = null;

  private checkpointRoundEpoch: number | null = null;

  private checkpointConfirmedThrough: number | null = null;

  private recoveredAttemptGeneration: number | null = null;

  private recoveredRoundEpoch: number | null = null;

  private agreedThrough: number | null = null;

  private connectionPathAfter: string | null = null;

  private relayAvailableAfter: boolean | null = null;

  private iceTransportPolicyAfter: string | null = null;

  private recoveryCount = 0;

  private tailDrained = false;

  private tailDrainedRoundEpoch: number | null = null;

  private conflictingInputs = 0;

  private tooLateInputs = 0;

  private detail = 'Recovery smoke is idle.';

  public constructor(options: LocalRankedRecoverySmokeOptions) {
    if (!Number.isSafeInteger(options.initialAttemptGeneration) || options.initialAttemptGeneration < 1) {
      throw new Error('initialAttemptGeneration must be a positive safe integer.');
    }
    this.initialAttemptGeneration = options.initialAttemptGeneration;
    this.forceRelayRequested = options.forceRelayRequested;
  }

  public arm(): void {
    if (this.phase !== 'idle') {
      throw new Error(`Recovery smoke cannot arm from phase ${this.phase}.`);
    }
    this.phase = 'armed';
    this.detail = 'Waiting for a speculative, unacknowledged outbound tail.';
  }

  public observeSpeculativeTail(observation: LocalRankedRecoverySmokeObservation): boolean {
    this.validateObservation(observation);
    if (this.phase !== 'armed') {
      return false;
    }
    if (
      observation.simulationFrame < 1
      || observation.outboundFrames < 1
      || observation.mutuallyConfirmedThrough >= observation.simulationFrame
    ) {
      return false;
    }
    if (observation.attemptGeneration !== this.initialAttemptGeneration) {
      throw new Error('Transport generation changed before the recovery smoke trigger point.');
    }
    this.triggerObservation = cloneObservation(observation);
    this.phase = 'ready';
    this.detail = 'Speculative outbound tail captured before transport flush.';
    return true;
  }

  public isHoldingBeforeRecovery(): boolean {
    return this.phase === 'ready';
  }

  public triggerRecovery(
    observation: LocalRankedRecoverySmokeObservation,
    requestRecovery: () => void,
  ): void {
    this.validateObservation(observation);
    const trigger = this.triggerObservation;
    if (this.phase !== 'ready' || !trigger) {
      throw new Error(`Recovery smoke cannot trigger from phase ${this.phase}.`);
    }
    if (
      observation.roundEpoch !== trigger.roundEpoch
      || observation.simulationFrame !== trigger.simulationFrame
      || observation.attemptGeneration !== trigger.attemptGeneration
    ) {
      throw new Error('Recovery smoke timeline advanced while transport flush was held.');
    }
    if (
      observation.outboundFrames < 1
      || observation.mutuallyConfirmedThrough >= observation.simulationFrame
    ) {
      throw new Error('Recovery smoke lost its speculative outbound tail before replacement.');
    }

    this.phase = 'triggered';
    this.detail = 'Real WebRTC replacement requested with the outbound tail retained.';
    try {
      requestRecovery();
    } catch (error) {
      this.markFailed(error);
      throw error;
    }
  }

  public markCheckpointPrepared(roundEpoch: number, confirmedThrough: number): void {
    assertNonNegativeInteger(roundEpoch, 'roundEpoch');
    assertFrameCursor(confirmedThrough, 'confirmedThrough');
    if (this.phase !== 'triggered' || !this.triggerObservation) {
      throw new Error(`Recovery checkpoint cannot be recorded from phase ${this.phase}.`);
    }
    if (roundEpoch !== this.triggerObservation.roundEpoch) {
      throw new Error('Recovery checkpoint changed the captured round epoch.');
    }
    if (confirmedThrough >= this.triggerObservation.simulationFrame) {
      throw new Error('Recovery checkpoint unexpectedly includes the speculative simulation tail.');
    }
    this.checkpointRoundEpoch = roundEpoch;
    this.checkpointConfirmedThrough = confirmedThrough;
    this.detail = `Recovery checkpoint prepared through frame ${confirmedThrough}.`;
  }

  public markAttemptAdvanced(observation: AttemptAdvancedObservation): void {
    if (this.phase !== 'triggered') {
      throw new Error(`Transport attempt cannot advance from phase ${this.phase}.`);
    }
    if (observation.generation !== this.initialAttemptGeneration + 1) {
      throw new Error(
        `Recovery advanced transport generation ${this.initialAttemptGeneration} to ${observation.generation}.`,
      );
    }
    this.recoveredAttemptGeneration = observation.generation;
    this.relayAvailableAfter = observation.relayAvailable;
    this.iceTransportPolicyAfter = observation.iceTransportPolicy;
    this.detail = `Transport attempt generation advanced to ${observation.generation}.`;
  }

  public markRecovered(observation: RecoveredObservation): void {
    assertNonNegativeInteger(observation.roundEpoch, 'roundEpoch');
    assertFrameCursor(observation.agreedThrough, 'agreedThrough');
    const trigger = this.triggerObservation;
    if (this.phase !== 'triggered' || !trigger) {
      throw new Error(`Recovery cannot complete from phase ${this.phase}.`);
    }
    if (
      observation.generation !== this.initialAttemptGeneration + 1
      || observation.generation !== this.recoveredAttemptGeneration
    ) {
      throw new Error('Recovered WebRTC session did not retain the one advanced generation.');
    }
    if (observation.roundEpoch !== trigger.roundEpoch) {
      throw new Error('Recovered WebRTC session changed the round epoch.');
    }
    if (
      this.checkpointConfirmedThrough === null
      || observation.agreedThrough > this.checkpointConfirmedThrough
    ) {
      throw new Error('Recovered WebRTC agreement exceeded the prepared checkpoint.');
    }
    this.recoveredRoundEpoch = observation.roundEpoch;
    this.agreedThrough = observation.agreedThrough;
    this.connectionPathAfter = observation.connectionPath;
    this.relayAvailableAfter = observation.relayAvailable;
    this.iceTransportPolicyAfter = observation.iceTransportPolicy;
    this.recoveryCount += 1;
    this.phase = 'recovered';
    this.detail = `WebRTC recovered through frame ${observation.agreedThrough}; outbound tail is resuming.`;
  }

  public recordRejectedInputs(conflictingInputs: number, tooLateInputs: number): void {
    assertNonNegativeInteger(conflictingInputs, 'conflictingInputs');
    assertNonNegativeInteger(tooLateInputs, 'tooLateInputs');
    this.conflictingInputs += conflictingInputs;
    this.tooLateInputs += tooLateInputs;
  }

  public observeOutboundTail(roundEpoch: number, currentOutboundFrames: number): void {
    assertNonNegativeInteger(roundEpoch, 'roundEpoch');
    assertNonNegativeInteger(currentOutboundFrames, 'currentOutboundFrames');
    const trigger = this.triggerObservation;
    if (
      this.phase !== 'recovered'
      || !trigger
      || roundEpoch !== trigger.roundEpoch
      || currentOutboundFrames !== 0
    ) {
      return;
    }
    this.tailDrained = true;
    this.tailDrainedRoundEpoch = roundEpoch;
    this.detail = `WebRTC recovered through frame ${this.agreedThrough}; outbound tail drained in round ${roundEpoch}.`;
  }

  public markFailed(error: unknown): void {
    this.phase = 'failed';
    this.detail = error instanceof Error ? error.message : String(error);
  }

  public getDiagnostics(currentOutboundFrames: number): LocalRankedRecoverySmokeDiagnostics {
    assertNonNegativeInteger(currentOutboundFrames, 'currentOutboundFrames');
    const trigger = this.triggerObservation;
    return {
      phase: this.phase,
      forceRelayRequested: this.forceRelayRequested,
      initialAttemptGeneration: this.initialAttemptGeneration,
      triggerAttemptGeneration: trigger?.attemptGeneration ?? null,
      recoveredAttemptGeneration: this.recoveredAttemptGeneration,
      triggerRoundEpoch: trigger?.roundEpoch ?? null,
      checkpointRoundEpoch: this.checkpointRoundEpoch,
      recoveredRoundEpoch: this.recoveredRoundEpoch,
      triggerSimulationFrame: trigger?.simulationFrame ?? null,
      triggerOutboundFrames: trigger?.outboundFrames ?? 0,
      triggerMutuallyConfirmedThrough: trigger?.mutuallyConfirmedThrough ?? null,
      checkpointConfirmedThrough: this.checkpointConfirmedThrough,
      agreedThrough: this.agreedThrough,
      connectionPathBefore: trigger?.connectionPath ?? null,
      connectionPathAfter: this.connectionPathAfter,
      relayAvailableBefore: trigger?.relayAvailable ?? null,
      relayAvailableAfter: this.relayAvailableAfter,
      iceTransportPolicyAfter: this.iceTransportPolicyAfter,
      recoveryCount: this.recoveryCount,
      tailDrained: this.tailDrained,
      tailDrainedRoundEpoch: this.tailDrainedRoundEpoch,
      conflictingInputs: this.conflictingInputs,
      tooLateInputs: this.tooLateInputs,
      detail: this.detail,
    };
  }

  private validateObservation(observation: LocalRankedRecoverySmokeObservation): void {
    assertNonNegativeInteger(observation.roundEpoch, 'roundEpoch');
    assertNonNegativeInteger(observation.simulationFrame, 'simulationFrame');
    assertNonNegativeInteger(observation.outboundFrames, 'outboundFrames');
    assertFrameCursor(observation.mutuallyConfirmedThrough, 'mutuallyConfirmedThrough');
    if (!Number.isSafeInteger(observation.attemptGeneration) || observation.attemptGeneration < 1) {
      throw new Error('attemptGeneration must be a positive safe integer.');
    }
    if (!observation.connectionPath) {
      throw new Error('connectionPath is required.');
    }
  }
}
