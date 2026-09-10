import { describe, expect, test, vi } from 'vitest';
import { createEmptyPlayerInput } from '../input/frame';
import { OnlineInputPump, type OnlineFrameEnvelope } from './onlineInputPump';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function remote(epoch: number, moveX = 1): OnlineFrameEnvelope {
  return { epoch, frame: 0, input: { ...createEmptyPlayerInput(), moveX }, accountId: 'peer', receivedAt: '2026-09-05T00:00:00Z' };
}

describe('online input generation isolation', () => {
  test.each([
    ['round', false], ['round', true], ['rematch', false], ['rematch', true], ['recovery', false], ['recovery', true],
  ] as const)('%s ignores old upload/poll/confirmation %s while new requests remain in flight', async (transition, rejectOld) => {
    const oldUpload = deferred<{ acceptedFrames: number }>();
    const newUpload = deferred<{ acceptedFrames: number }>();
    const oldPoll = deferred<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough: number }>();
    const newPoll = deferred<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough: number }>();
    const oldConfirmation = deferred<{ confirmedThrough: number }>();
    const newConfirmation = deferred<{ confirmedThrough: number }>();
    const submitFrames = vi.fn().mockReturnValueOnce(oldUpload.promise).mockReturnValueOnce(newUpload.promise);
    const pollFrames = vi.fn().mockResolvedValueOnce({ frames: [remote(0)], peerConfirmedThrough: -1 })
      .mockReturnValueOnce(oldPoll.promise).mockReturnValueOnce(newPoll.promise);
    const confirmFrames = vi.fn().mockReturnValueOnce(oldConfirmation.promise).mockReturnValueOnce(newConfirmation.promise);
    const pump = new OnlineInputPump({ remoteAccountId: 'peer', transport: { submitFrames, pollFrames, confirmFrames } });
    await pump.pollIncoming();
    pump.enqueueLocalInput(0, { ...createEmptyPlayerInput(), moveX: -1 });
    const obsolete = [pump.flushOutgoing(), pump.pollIncoming(), pump.flushConfirmation()];
    if (transition === 'round') pump.startEpoch(1);
    if (transition === 'rematch') { pump.clear(); pump.startEpoch(0); }
    if (transition === 'recovery') pump.resumeAfterTransportRecovery();
    const epoch = pump.getEpoch();
    if (transition !== 'recovery') {
      // Seed the new remote input before starting its independently delayed poll.
      // The old request already owns its promise; configure only subsequent responses.
      pollFrames.mockReset().mockResolvedValueOnce({ frames: [remote(epoch)], peerConfirmedThrough: -1 })
        .mockReturnValueOnce(newPoll.promise);
      await pump.pollIncoming();
      pump.enqueueLocalInput(0, { ...createEmptyPlayerInput(), moveX: 0.5 });
    }
    const current = [pump.flushOutgoing(), pump.pollIncoming(), pump.flushConfirmation()];
    if (rejectOld) {
      for (const request of [oldUpload, oldPoll, oldConfirmation]) request.reject(new Error('old generation failed'));
    } else {
      oldUpload.resolve({ acceptedFrames: 1 });
      oldPoll.resolve({ frames: [remote(0, -0.5)], peerConfirmedThrough: 999 });
      oldConfirmation.resolve({ confirmedThrough: 999 });
    }
    await expect(Promise.all(obsolete)).resolves.toEqual([0, 0, 0]);
    expect(pump.getOutboundFrameCount()).toBe(1);
    expect(pump.getPendingRemoteInputs().get(0)?.moveX).toBe(1);
    expect(pump.getDiagnostics()).toMatchObject({
      peerConfirmedThrough: -1, confirmationSentThrough: -1, uploadFailures: 0, pollFailures: 0, confirmationFailures: 0,
    });
    const calls = [submitFrames.mock.calls.length, pollFrames.mock.calls.length, confirmFrames.mock.calls.length];
    // A stale finally must not release the new generation's single-flight guards.
    await Promise.all([pump.flushOutgoing(), pump.pollIncoming(), pump.flushConfirmation()]);
    expect([submitFrames.mock.calls.length, pollFrames.mock.calls.length, confirmFrames.mock.calls.length]).toEqual(calls);
    newUpload.resolve({ acceptedFrames: 1 });
    newPoll.resolve({ frames: [], peerConfirmedThrough: 0 });
    newConfirmation.resolve({ confirmedThrough: 0 });
    await Promise.all(current);
    expect(pump.isSynchronizedThrough(0)).toBe(true);
  });
});
