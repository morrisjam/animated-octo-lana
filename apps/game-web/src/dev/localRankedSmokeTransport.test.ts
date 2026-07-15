import { describe, expect, it, vi } from 'vitest';
import type {
  OnlineFrameEnvelope,
  OnlineFrameSubmission,
  OnlineFrameTransport,
} from '../net/onlineInputPump';
import { LocalRankedSmokeFrameTransport } from './localRankedSmokeTransport';

function frame(frameNumber: number): OnlineFrameEnvelope {
  return {
    epoch: 0,
    frame: frameNumber,
    accountId: 'remote-account',
    receivedAt: '2026-07-15T00:00:00.000Z',
    input: {
      moveX: frameNumber / 10,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
  };
}

describe('LocalRankedSmokeFrameTransport', () => {
  it('holds contiguous inbound frames for deterministic poll cycles and releases the tail', async () => {
    const available = [frame(0), frame(1)];
    const transport: OnlineFrameTransport = {
      submitFrames: vi.fn(async (frames: OnlineFrameSubmission[]) => ({
        acceptedFrames: frames.length,
      })),
      pollFrames: vi.fn(async (_epoch: number, sinceFrame: number) => ({
        frames: available.filter((entry) => entry.frame > sinceFrame),
        peerConfirmedThrough: 9,
      })),
      confirmFrames: vi.fn(async (_epoch: number, confirmedThrough: number) => ({
        confirmedThrough,
      })),
    };
    const delayed = new LocalRankedSmokeFrameTransport({
      transport,
      inboundDelayPolls: 1,
    });

    expect(await delayed.pollFrames(0, -1)).toEqual({
      frames: [],
      peerConfirmedThrough: 9,
    });
    expect((await delayed.pollFrames(0, -1)).frames).toEqual(available);
    available.push(frame(2));
    expect(await delayed.pollFrames(0, 1)).toEqual({
      frames: [frame(2)],
      peerConfirmedThrough: 9,
    });
    expect(delayed.getDiagnostics()).toEqual({
      inboundDelayPolls: 1,
      pollCount: 3,
      bufferedFrames: 0,
      releasedFrames: 3,
      maxBufferedFrames: 2,
    });
  });

  it('delegates outbound submissions and confirmations without impairment', async () => {
    const transport: OnlineFrameTransport = {
      submitFrames: vi.fn(async (frames) => ({ acceptedFrames: frames.length })),
      pollFrames: vi.fn(async () => ({ frames: [], peerConfirmedThrough: -1 })),
      confirmFrames: vi.fn(async (_epoch, confirmedThrough) => ({ confirmedThrough })),
    };
    const delayed = new LocalRankedSmokeFrameTransport({
      transport,
      inboundDelayPolls: 1,
    });
    const submission = { epoch: 0, frame: 0, input: frame(0).input };

    await expect(delayed.submitFrames([submission])).resolves.toEqual({ acceptedFrames: 1 });
    await expect(delayed.confirmFrames(0, 7)).resolves.toEqual({ confirmedThrough: 7 });
    expect(transport.submitFrames).toHaveBeenCalledWith([submission]);
    expect(transport.confirmFrames).toHaveBeenCalledWith(0, 7);
  });

  it('rejects an ineffective delay policy', () => {
    const transport = {} as OnlineFrameTransport;
    expect(() => new LocalRankedSmokeFrameTransport({
      transport,
      inboundDelayPolls: 0,
    })).toThrow(/positive integer/);
  });
});
