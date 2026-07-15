import type { PlayerFrameInput } from '../sim/types';

export interface OnlineFrameSubmission {
  epoch: number;
  frame: number;
  input: PlayerFrameInput;
}

export interface OnlineFrameEnvelope extends OnlineFrameSubmission {
  accountId: string;
  receivedAt: string;
}

export interface OnlineFrameTransport {
  submitFrames(frames: OnlineFrameSubmission[]): Promise<{ acceptedFrames: number }>;
  pollFrames(
    epoch: number,
    sinceFrame: number,
  ): Promise<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough?: number }>;
  confirmFrames(epoch: number, confirmedThrough: number): Promise<{ confirmedThrough: number }>;
}

export interface OnlineInputPumpDiagnostics {
  epoch: number;
  outboundFrames: number;
  pendingRemoteFrames: number;
  contiguousRemoteFrame: number;
  peerConfirmedThrough: number;
  confirmationSentThrough: number;
  uploadAttempts: number;
  uploadFailures: number;
  uploadRetries: number;
  pollAttempts: number;
  pollFailures: number;
  duplicateRemoteFrames: number;
  staleEpochFrames: number;
  confirmationAttempts: number;
  confirmationFailures: number;
}

interface OutboundFrameRecord {
  sequence: number;
  input: PlayerFrameInput;
  attempts: number;
}

export interface OnlineInputPumpOptions {
  epoch?: number;
  remoteAccountId: string;
  transport: OnlineFrameTransport;
  maxUploadBatchFrames?: number;
  maxOutboundFrames?: number;
}

const DEFAULT_MAX_UPLOAD_BATCH_FRAMES = 30;
const DEFAULT_MAX_OUTBOUND_FRAMES = 240;

function cloneInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    moveX: input.moveX,
    moveY: input.moveY,
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

function inputsEqual(first: PlayerFrameInput, second: PlayerFrameInput): boolean {
  return first.moveX === second.moveX
    && first.moveY === second.moveY
    && first.boost === second.boost
    && first.superBoost === second.superBoost
    && first.special === second.special
    && first.launch === second.launch
    && first.dunk === second.dunk
    && first.parry === second.parry
    && first.breakLaunch === second.breakLaunch;
}

function validateEpoch(epoch: number): void {
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error(`epoch must be a non-negative integer. Received: ${epoch}`);
  }
}

function validateFrame(frame: number): void {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`frame must be a non-negative integer. Received: ${frame}`);
  }
}

export class OnlineFrameProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OnlineFrameProtocolError';
  }
}

export class OnlineInputPump {
  private epoch: number;

  private generation = 1;

  private nextOutboundSequence = 1;

  private readonly outbound = new Map<number, OutboundFrameRecord>();

  private readonly pendingRemote = new Map<number, PlayerFrameInput>();

  private readonly acceptedRemote = new Map<number, PlayerFrameInput>();

  private readonly receivedRemoteFrames = new Set<number>();

  private contiguousRemoteFrame = -1;

  private peerConfirmedThrough = -1;

  private confirmationSentThrough = -1;

  private uploadInFlight = false;

  private pollInFlight = false;

  private confirmationInFlight = false;

  private uploadAttempts = 0;

  private uploadFailures = 0;

  private uploadRetries = 0;

  private pollAttempts = 0;

  private pollFailures = 0;

  private duplicateRemoteFrames = 0;

  private staleEpochFrames = 0;

  private confirmationAttempts = 0;

  private confirmationFailures = 0;

  private readonly remoteAccountId: string;

  private readonly transport: OnlineFrameTransport;

  private readonly maxUploadBatchFrames: number;

  private readonly maxOutboundFrames: number;

  public constructor(options: OnlineInputPumpOptions) {
    const epoch = options.epoch ?? 0;
    validateEpoch(epoch);
    this.epoch = epoch;
    this.remoteAccountId = options.remoteAccountId;
    this.transport = options.transport;
    this.maxUploadBatchFrames = Math.max(
      1,
      Math.floor(options.maxUploadBatchFrames ?? DEFAULT_MAX_UPLOAD_BATCH_FRAMES),
    );
    this.maxOutboundFrames = Math.max(
      this.maxUploadBatchFrames,
      Math.floor(options.maxOutboundFrames ?? DEFAULT_MAX_OUTBOUND_FRAMES),
    );
  }

  public startEpoch(epoch: number): void {
    validateEpoch(epoch);
    this.epoch = epoch;
    this.generation += 1;
    this.nextOutboundSequence = 1;
    this.outbound.clear();
    this.pendingRemote.clear();
    this.acceptedRemote.clear();
    this.receivedRemoteFrames.clear();
    this.contiguousRemoteFrame = -1;
    this.peerConfirmedThrough = -1;
    this.confirmationSentThrough = -1;
    this.uploadInFlight = false;
    this.pollInFlight = false;
    this.confirmationInFlight = false;
  }

  public clear(): void {
    this.generation += 1;
    this.outbound.clear();
    this.pendingRemote.clear();
    this.acceptedRemote.clear();
    this.receivedRemoteFrames.clear();
    this.contiguousRemoteFrame = -1;
    this.peerConfirmedThrough = -1;
    this.confirmationSentThrough = -1;
    this.uploadInFlight = false;
    this.pollInFlight = false;
    this.confirmationInFlight = false;
  }

  public resumeAfterTransportRecovery(): void {
    this.generation += 1;
    this.uploadInFlight = false;
    this.pollInFlight = false;
    this.confirmationInFlight = false;
    this.peerConfirmedThrough = -1;
    this.confirmationSentThrough = -1;
  }

  public enqueueLocalInput(frame: number, input: PlayerFrameInput): void {
    validateFrame(frame);
    const existing = this.outbound.get(frame);
    if (existing) {
      if (!inputsEqual(existing.input, input)) {
        throw new OnlineFrameProtocolError(`Local frame ${this.epoch}:${frame} was queued with conflicting input.`);
      }
      return;
    }
    if (this.outbound.size >= this.maxOutboundFrames) {
      throw new OnlineFrameProtocolError(
        `Outbound input backlog exceeded ${this.maxOutboundFrames} unacknowledged frames.`,
      );
    }
    this.outbound.set(frame, {
      sequence: this.nextOutboundSequence++,
      input: cloneInput(input),
      attempts: 0,
    });
  }

  public getPendingRemoteInputs(): Map<number, PlayerFrameInput> {
    return this.pendingRemote;
  }

  public getOutboundFrameCount(): number {
    return this.outbound.size;
  }

  public getEpoch(): number {
    return this.epoch;
  }

  public getContiguousRemoteFrame(): number {
    return this.contiguousRemoteFrame;
  }

  public getPeerConfirmedThrough(): number {
    return this.peerConfirmedThrough;
  }

  public getMutuallyConfirmedThrough(): number {
    return Math.min(
      this.contiguousRemoteFrame,
      this.peerConfirmedThrough,
      this.confirmationSentThrough,
    );
  }

  public isSynchronizedThrough(frame: number): boolean {
    validateFrame(frame);
    return this.outbound.size === 0
      && this.contiguousRemoteFrame >= frame
      && this.confirmationSentThrough >= frame
      && this.peerConfirmedThrough >= frame;
  }

  public async flushOutgoing(): Promise<number> {
    if (this.uploadInFlight || this.outbound.size === 0) {
      return 0;
    }
    const generation = this.generation;
    const epoch = this.epoch;
    const batch = [...this.outbound.entries()]
      .sort(([firstFrame], [secondFrame]) => firstFrame - secondFrame)
      .slice(0, this.maxUploadBatchFrames)
      .map(([frame, record]) => ({
        epoch,
        frame,
        sequence: record.sequence,
        input: cloneInput(record.input),
        previousAttempts: record.attempts,
      }));
    if (batch.length === 0) {
      return 0;
    }

    this.uploadInFlight = true;
    this.uploadAttempts += 1;
    for (const entry of batch) {
      const queued = this.outbound.get(entry.frame);
      if (queued?.sequence === entry.sequence) {
        if (queued.attempts > 0) {
          this.uploadRetries += 1;
        }
        queued.attempts += 1;
      }
    }

    try {
      const response = await this.transport.submitFrames(batch.map((entry) => ({
        epoch: entry.epoch,
        frame: entry.frame,
        input: cloneInput(entry.input),
      })));
      if (response.acceptedFrames !== batch.length) {
        throw new OnlineFrameProtocolError(
          `Frame relay acknowledged ${response.acceptedFrames}/${batch.length} uploaded frames.`,
        );
      }
      if (generation !== this.generation || epoch !== this.epoch) {
        return 0;
      }
      for (const entry of batch) {
        const queued = this.outbound.get(entry.frame);
        if (queued?.sequence === entry.sequence) {
          this.outbound.delete(entry.frame);
        }
      }
      return batch.length;
    } catch (error) {
      if (generation !== this.generation || epoch !== this.epoch) {
        return 0;
      }
      this.uploadFailures += 1;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.uploadInFlight = false;
      }
    }
  }

  public async pollIncoming(): Promise<number> {
    if (this.pollInFlight) {
      return 0;
    }
    const generation = this.generation;
    const epoch = this.epoch;
    const sinceFrame = this.contiguousRemoteFrame;
    this.pollInFlight = true;
    this.pollAttempts += 1;
    try {
      const response = await this.transport.pollFrames(epoch, sinceFrame);
      if (generation !== this.generation || epoch !== this.epoch) {
        return 0;
      }
      let accepted = 0;
      const peerConfirmedThrough = Number(response.peerConfirmedThrough ?? -1);
      if (Number.isInteger(peerConfirmedThrough) && peerConfirmedThrough >= -1) {
        this.peerConfirmedThrough = Math.max(this.peerConfirmedThrough, peerConfirmedThrough);
      }
      for (const entry of response.frames) {
        if (entry.epoch !== this.epoch) {
          this.staleEpochFrames += 1;
          continue;
        }
        if (entry.accountId !== this.remoteAccountId) {
          throw new OnlineFrameProtocolError(
            `Frame ${entry.epoch}:${entry.frame} came from unexpected account ${entry.accountId}.`,
          );
        }
        validateFrame(entry.frame);
        const existing = this.acceptedRemote.get(entry.frame);
        if (existing) {
          if (!inputsEqual(existing, entry.input)) {
            throw new OnlineFrameProtocolError(
              `Remote frame ${entry.epoch}:${entry.frame} changed after first receipt.`,
            );
          }
          this.duplicateRemoteFrames += 1;
          continue;
        }
        if (entry.frame <= this.contiguousRemoteFrame) {
          this.duplicateRemoteFrames += 1;
          continue;
        }
        const input = cloneInput(entry.input);
        this.acceptedRemote.set(entry.frame, input);
        this.pendingRemote.set(entry.frame, cloneInput(input));
        this.receivedRemoteFrames.add(entry.frame);
        accepted += 1;
      }
      while (this.receivedRemoteFrames.has(this.contiguousRemoteFrame + 1)) {
        this.contiguousRemoteFrame += 1;
        this.receivedRemoteFrames.delete(this.contiguousRemoteFrame);
      }
      this.pruneAcceptedHistory();
      return accepted;
    } catch (error) {
      if (generation !== this.generation || epoch !== this.epoch) {
        return 0;
      }
      this.pollFailures += 1;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.pollInFlight = false;
      }
    }
  }

  public async flushConfirmation(): Promise<number> {
    if (
      this.confirmationInFlight
      || this.contiguousRemoteFrame <= this.confirmationSentThrough
    ) {
      return 0;
    }
    const generation = this.generation;
    const epoch = this.epoch;
    const confirmedThrough = this.contiguousRemoteFrame;
    this.confirmationInFlight = true;
    this.confirmationAttempts += 1;
    try {
      const response = await this.transport.confirmFrames(epoch, confirmedThrough);
      if (generation !== this.generation || epoch !== this.epoch) {
        return 0;
      }
      if (response.confirmedThrough < confirmedThrough) {
        throw new OnlineFrameProtocolError(
          `Frame relay confirmed only through ${response.confirmedThrough}; expected ${confirmedThrough}.`,
        );
      }
      this.confirmationSentThrough = Math.max(
        this.confirmationSentThrough,
        response.confirmedThrough,
      );
      return this.confirmationSentThrough;
    } catch (error) {
      if (generation !== this.generation || epoch !== this.epoch) {
        return 0;
      }
      this.confirmationFailures += 1;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.confirmationInFlight = false;
      }
    }
  }

  public getDiagnostics(): OnlineInputPumpDiagnostics {
    return {
      epoch: this.epoch,
      outboundFrames: this.outbound.size,
      pendingRemoteFrames: this.pendingRemote.size,
      contiguousRemoteFrame: this.contiguousRemoteFrame,
      peerConfirmedThrough: this.peerConfirmedThrough,
      confirmationSentThrough: this.confirmationSentThrough,
      uploadAttempts: this.uploadAttempts,
      uploadFailures: this.uploadFailures,
      uploadRetries: this.uploadRetries,
      pollAttempts: this.pollAttempts,
      pollFailures: this.pollFailures,
      duplicateRemoteFrames: this.duplicateRemoteFrames,
      staleEpochFrames: this.staleEpochFrames,
      confirmationAttempts: this.confirmationAttempts,
      confirmationFailures: this.confirmationFailures,
    };
  }

  private pruneAcceptedHistory(): void {
    const floor = Math.max(0, this.contiguousRemoteFrame - 1_200);
    for (const frame of this.acceptedRemote.keys()) {
      if (frame < floor) {
        this.acceptedRemote.delete(frame);
      }
    }
  }
}
