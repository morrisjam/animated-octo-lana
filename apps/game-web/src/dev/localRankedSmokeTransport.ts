import type {
  OnlineFrameEnvelope,
  OnlineFrameSubmission,
  OnlineFrameTransport,
} from '../net/onlineInputPump';

export interface LocalRankedSmokeTransportDiagnostics {
  inboundDelayPolls: number;
  pollCount: number;
  bufferedFrames: number;
  releasedFrames: number;
  maxBufferedFrames: number;
}

export interface LocalRankedSmokeFrameTransportOptions {
  transport: OnlineFrameTransport;
  inboundDelayPolls: number;
}

interface BufferedFrame {
  envelope: OnlineFrameEnvelope;
  releaseAfterPoll: number;
}

interface EpochBuffer {
  pollCount: number;
  releasedFrames: number;
  maxBufferedFrames: number;
  delayReleasePoll: number | null;
  delaySatisfied: boolean;
  frames: Map<number, BufferedFrame>;
}

function cloneEnvelope(frame: OnlineFrameEnvelope): OnlineFrameEnvelope {
  return {
    epoch: frame.epoch,
    frame: frame.frame,
    accountId: frame.accountId,
    receivedAt: frame.receivedAt,
    input: { ...frame.input },
  };
}

/** Adds deterministic inbound latency only to the loopback ranked-root smoke. */
export class LocalRankedSmokeFrameTransport implements OnlineFrameTransport {
  private readonly transport: OnlineFrameTransport;

  private readonly inboundDelayPolls: number;

  private readonly epochs = new Map<number, EpochBuffer>();

  public constructor(options: LocalRankedSmokeFrameTransportOptions) {
    if (!Number.isInteger(options.inboundDelayPolls) || options.inboundDelayPolls < 1) {
      throw new Error('Local ranked smoke inboundDelayPolls must be a positive integer.');
    }
    this.transport = options.transport;
    this.inboundDelayPolls = options.inboundDelayPolls;
  }

  public submitFrames(frames: OnlineFrameSubmission[]): Promise<{ acceptedFrames: number }> {
    return this.transport.submitFrames(frames);
  }

  public async pollFrames(
    epoch: number,
    sinceFrame: number,
  ): Promise<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough?: number }> {
    const state = this.getEpoch(epoch);
    state.pollCount += 1;
    const response = await this.transport.pollFrames(epoch, sinceFrame);
    const freshFrames = response.frames.filter((frame) => (
      frame.epoch === epoch && frame.frame > sinceFrame && !state.frames.has(frame.frame)
    ));
    if (!state.delaySatisfied && state.delayReleasePoll === null && freshFrames.length > 0) {
      state.delayReleasePoll = state.pollCount + this.inboundDelayPolls;
    }

    for (const frame of freshFrames) {
      state.frames.set(frame.frame, {
        envelope: cloneEnvelope(frame),
        releaseAfterPoll: state.delaySatisfied
          ? state.pollCount
          : state.delayReleasePoll as number,
      });
    }
    state.maxBufferedFrames = Math.max(state.maxBufferedFrames, state.frames.size);

    for (const frame of state.frames.keys()) {
      if (frame <= sinceFrame) {
        state.frames.delete(frame);
      }
    }

    const released: OnlineFrameEnvelope[] = [];
    let nextFrame = sinceFrame + 1;
    while (true) {
      const buffered = state.frames.get(nextFrame);
      if (!buffered || buffered.releaseAfterPoll > state.pollCount) {
        break;
      }
      released.push(cloneEnvelope(buffered.envelope));
      state.frames.delete(nextFrame);
      nextFrame += 1;
    }
    state.releasedFrames += released.length;
    if (!state.delaySatisfied && released.length > 0) {
      state.delaySatisfied = true;
    }

    return {
      frames: released,
      peerConfirmedThrough: response.peerConfirmedThrough,
    };
  }

  public confirmFrames(
    epoch: number,
    confirmedThrough: number,
  ): Promise<{ confirmedThrough: number }> {
    return this.transport.confirmFrames(epoch, confirmedThrough);
  }

  public getDiagnostics(): LocalRankedSmokeTransportDiagnostics {
    let pollCount = 0;
    let bufferedFrames = 0;
    let releasedFrames = 0;
    let maxBufferedFrames = 0;
    for (const state of this.epochs.values()) {
      pollCount += state.pollCount;
      bufferedFrames += state.frames.size;
      releasedFrames += state.releasedFrames;
      maxBufferedFrames = Math.max(maxBufferedFrames, state.maxBufferedFrames);
    }
    return {
      inboundDelayPolls: this.inboundDelayPolls,
      pollCount,
      bufferedFrames,
      releasedFrames,
      maxBufferedFrames,
    };
  }

  private getEpoch(epoch: number): EpochBuffer {
    const existing = this.epochs.get(epoch);
    if (existing) {
      return existing;
    }
    const created: EpochBuffer = {
      pollCount: 0,
      releasedFrames: 0,
      maxBufferedFrames: 0,
      delayReleasePoll: null,
      delaySatisfied: false,
      frames: new Map(),
    };
    this.epochs.set(epoch, created);
    return created;
  }
}
