import { describe, expect, test, vi } from 'vitest';
import type { PlayerFrameInput } from '../sim/types';
import {
  OnlineFrameProtocolError,
  OnlineInputPump,
  type OnlineFrameEnvelope,
  type OnlineFrameTransport,
} from './onlineInputPump';

const REMOTE_ACCOUNT = '22222222-2222-4222-8222-222222222222';

function input(moveX: number): PlayerFrameInput {
  return {
    moveX,
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

function envelope(epoch: number, frame: number, moveX: number): OnlineFrameEnvelope {
  return {
    epoch,
    frame,
    accountId: REMOTE_ACCOUNT,
    input: input(moveX),
    receivedAt: '2026-07-13T00:00:00.000Z',
  };
}

function transport(overrides?: Partial<OnlineFrameTransport>): OnlineFrameTransport {
  return {
    submitFrames: vi.fn(async (frames) => ({ acceptedFrames: frames.length })),
    pollFrames: vi.fn(async () => ({ frames: [] })),
    confirmFrames: vi.fn(async (_epoch, confirmedThrough) => ({ confirmedThrough })),
    ...overrides,
  };
}

describe('online input pump', () => {
  test('retains an unacknowledged upload and retries it', async () => {
    let attempt = 0;
    const submitFrames = vi.fn(async (frames) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('transient relay failure');
      }
      return { acceptedFrames: frames.length };
    });
    const pump = new OnlineInputPump({
      epoch: 3,
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ submitFrames }),
    });
    pump.enqueueLocalInput(0, input(1));

    await expect(pump.flushOutgoing()).rejects.toThrow('transient relay failure');
    expect(pump.getOutboundFrameCount()).toBe(1);
    await expect(pump.flushOutgoing()).resolves.toBe(1);
    expect(pump.getOutboundFrameCount()).toBe(0);
    expect(pump.getDiagnostics()).toMatchObject({ uploadFailures: 1, uploadRetries: 1 });
    expect(submitFrames).toHaveBeenNthCalledWith(2, [{ epoch: 3, frame: 0, input: input(1) }]);
  });

  test('fails closed before an unacknowledged outbound backlog can grow without bound', () => {
    const pump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport(),
      maxUploadBatchFrames: 2,
      maxOutboundFrames: 3,
    });
    pump.enqueueLocalInput(0, input(0));
    pump.enqueueLocalInput(1, input(0));
    pump.enqueueLocalInput(2, input(0));

    expect(() => pump.enqueueLocalInput(3, input(0))).toThrow(OnlineFrameProtocolError);
    expect(pump.getOutboundFrameCount()).toBe(3);
  });

  test('advances its poll cursor only across contiguous remote frames', async () => {
    const pollFrames = vi.fn()
      .mockResolvedValueOnce({ frames: [envelope(0, 0, 0), envelope(0, 2, 2)] })
      .mockResolvedValueOnce({ frames: [envelope(0, 1, 1), envelope(0, 2, 2)] });
    const pump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ pollFrames }),
    });

    await pump.pollIncoming();
    expect(pump.getContiguousRemoteFrame()).toBe(0);
    await pump.pollIncoming();
    expect(pump.getContiguousRemoteFrame()).toBe(2);
    expect(pollFrames).toHaveBeenNthCalledWith(1, 0, -1);
    expect(pollFrames).toHaveBeenNthCalledWith(2, 0, 0);
    expect([...pump.getPendingRemoteInputs().keys()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  test('isolates stale responses when a new round epoch starts', async () => {
    let resolvePoll: ((value: { frames: OnlineFrameEnvelope[] }) => void) | null = null;
    const pollFrames = vi.fn(() => new Promise<{ frames: OnlineFrameEnvelope[] }>((resolve) => {
      resolvePoll = resolve;
    }));
    const pump = new OnlineInputPump({
      epoch: 0,
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ pollFrames }),
    });

    const pendingPoll = pump.pollIncoming();
    pump.startEpoch(1);
    resolvePoll?.({ frames: [envelope(0, 0, 1)] });
    await expect(pendingPoll).resolves.toBe(0);
    expect(pump.getPendingRemoteInputs().size).toBe(0);
    expect(pump.getEpoch()).toBe(1);
  });

  test('rejects a conflicting remote frame or unexpected sender', async () => {
    const conflictingPoll = vi.fn()
      .mockResolvedValueOnce({ frames: [envelope(0, 0, 1)] })
      .mockResolvedValueOnce({ frames: [envelope(0, 0, -1)] });
    const pump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ pollFrames: conflictingPoll }),
    });
    await pump.pollIncoming();
    await expect(pump.pollIncoming()).rejects.toBeInstanceOf(OnlineFrameProtocolError);

    const wrongPeerPump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({
        pollFrames: vi.fn(async () => ({
          frames: [{ ...envelope(0, 0, 1), accountId: 'unexpected-account' }],
        })),
      }),
    });
    await expect(wrongPeerPump.pollIncoming()).rejects.toBeInstanceOf(OnlineFrameProtocolError);
  });

  test('reports synchronization only after both peers confirm the decisive frame', async () => {
    const pollFrames = vi.fn()
      .mockResolvedValueOnce({
        frames: [envelope(0, 0, 1), envelope(0, 1, 1)],
        peerConfirmedThrough: 0,
      })
      .mockResolvedValueOnce({ frames: [], peerConfirmedThrough: 1 });
    const confirmFrames = vi.fn(async (_epoch, confirmedThrough) => ({ confirmedThrough }));
    const pump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ pollFrames, confirmFrames }),
    });
    pump.enqueueLocalInput(0, input(1));
    pump.enqueueLocalInput(1, input(1));

    await pump.flushOutgoing();
    await pump.pollIncoming();
    await pump.flushConfirmation();
    expect(pump.isSynchronizedThrough(1)).toBe(false);
    await pump.pollIncoming();
    expect(pump.isSynchronizedThrough(1)).toBe(true);
    expect(confirmFrames).toHaveBeenCalledWith(0, 1);
  });

  test('retains a mutually confirmed prefix while an outbound tail is unacknowledged', async () => {
    const pollFrames = vi.fn(async () => ({
      frames: [envelope(0, 0, 1)],
      peerConfirmedThrough: 0,
    }));
    const pump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ pollFrames }),
    });
    pump.enqueueLocalInput(0, input(1));
    await pump.flushOutgoing();
    await pump.pollIncoming();
    await pump.flushConfirmation();

    pump.enqueueLocalInput(1, input(-1));

    expect(pump.getOutboundFrameCount()).toBe(1);
    expect(pump.isSynchronizedThrough(0)).toBe(false);
    expect(pump.getMutuallyConfirmedThrough()).toBe(0);
  });

  test('preserves frame state but re-advertises confirmation after transport recovery', async () => {
    const pollFrames = vi.fn()
      .mockResolvedValueOnce({
        frames: [envelope(0, 0, 1)],
        peerConfirmedThrough: 0,
      })
      .mockResolvedValueOnce({ frames: [], peerConfirmedThrough: 0 });
    const confirmFrames = vi.fn(async (_epoch, confirmedThrough) => ({ confirmedThrough }));
    const pump = new OnlineInputPump({
      remoteAccountId: REMOTE_ACCOUNT,
      transport: transport({ pollFrames, confirmFrames }),
    });
    pump.enqueueLocalInput(0, input(1));

    await pump.flushOutgoing();
    await pump.pollIncoming();
    await pump.flushConfirmation();
    expect(pump.isSynchronizedThrough(0)).toBe(true);

    pump.resumeAfterTransportRecovery();

    expect(pump.getPendingRemoteInputs().get(0)).toEqual(input(1));
    expect(pump.getDiagnostics()).toMatchObject({
      peerConfirmedThrough: -1,
      confirmationSentThrough: -1,
    });
    await pump.flushConfirmation();
    await pump.pollIncoming();
    expect(confirmFrames).toHaveBeenCalledTimes(2);
    expect(pump.isSynchronizedThrough(0)).toBe(true);
  });
});
