import { describe, expect, test, vi } from 'vitest';
import type { PlayerFrameInput } from '../sim/types';
import { OnlineFrameProtocolError, type OnlineFrameSubmission } from './onlineInputPump';
import {
  WEB_RTC_FRAME_PROTOCOL_VERSION,
  WebRtcFrameAckTimeoutError,
  WebRtcFrameTransport,
  WebRtcFrameTransportClosedError,
  type WebRtcDataChannelAdapter,
  type WebRtcDataChannelEvent,
  type WebRtcDataChannelEventListener,
  type WebRtcFrameTimerApi,
  type WebRtcFrameTransportOptions,
} from './webRtcFrameTransport';
import { WEB_RTC_RECOVERY_PROTOCOL_VERSION } from './webRtcRecoveryCheckpoint';

const ALICE_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const BOB_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const RECEIVED_AT_MS = Date.UTC(2026, 6, 13, 12, 30, 0);

type ChannelEventType = 'message' | 'close' | 'error';

class LinkedFakeChannel implements WebRtcDataChannelAdapter {
  public readyState = 'open';

  public ordered = true;

  public maxPacketLifeTime: number | null = null;

  public maxRetransmits: number | null = null;

  public readonly sent: string[] = [];

  public closeCalls = 0;

  private peer: LinkedFakeChannel | null = null;

  private readonly outbound: string[] = [];

  private readonly listeners = new Map<ChannelEventType, Set<WebRtcDataChannelEventListener>>();

  public link(peer: LinkedFakeChannel): void {
    this.peer = peer;
  }

  public send(data: string): void {
    if (this.readyState !== 'open') {
      throw new Error('fake channel is closed');
    }
    this.sent.push(data);
    this.outbound.push(data);
  }

  public close(): void {
    this.closeCalls += 1;
    this.transitionToClosed();
    this.peer?.transitionToClosed();
  }

  public addEventListener(
    type: ChannelEventType,
    listener: WebRtcDataChannelEventListener,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<WebRtcDataChannelEventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(
    type: ChannelEventType,
    listener: WebRtcDataChannelEventListener,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public deliverNext(): string {
    const data = this.outbound.shift();
    if (data === undefined) {
      throw new Error('fake channel has no queued message');
    }
    this.peer?.dispatch('message', { data });
    return data;
  }

  public peekNext(): string {
    const data = this.outbound[0];
    if (data === undefined) {
      throw new Error('fake channel has no queued message');
    }
    return data;
  }

  public dropNext(): string {
    const data = this.outbound.shift();
    if (data === undefined) {
      throw new Error('fake channel has no queued message');
    }
    return data;
  }

  public queuedMessages(): number {
    return this.outbound.length;
  }

  public listenerCount(): number {
    return [...this.listeners.values()]
      .reduce((total, listeners) => total + listeners.size, 0);
  }

  private transitionToClosed(): void {
    if (this.readyState === 'closed') {
      return;
    }
    this.readyState = 'closed';
    this.dispatch('close', {});
  }

  private dispatch(type: ChannelEventType, event: WebRtcDataChannelEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

class ManualTimers implements WebRtcFrameTimerApi {
  private nextHandle = 1;

  private readonly callbacks = new Map<number, () => void>();

  public setTimeout(callback: () => void): unknown {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  public clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  public runAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback();
    }
  }

  public size(): number {
    return this.callbacks.size;
  }
}

type TransportOverrides = Partial<Omit<
  WebRtcFrameTransportOptions,
  'channel' | 'localAccountId' | 'remoteAccountId'
>>;

function linkedChannels(): [LinkedFakeChannel, LinkedFakeChannel] {
  const first = new LinkedFakeChannel();
  const second = new LinkedFakeChannel();
  first.link(second);
  second.link(first);
  return [first, second];
}

function transportPair(options?: {
  alice?: TransportOverrides;
  bob?: TransportOverrides;
}): {
  alice: WebRtcFrameTransport;
  bob: WebRtcFrameTransport;
  aliceChannel: LinkedFakeChannel;
  bobChannel: LinkedFakeChannel;
} {
  const [aliceChannel, bobChannel] = linkedChannels();
  const alice = new WebRtcFrameTransport({
    channel: aliceChannel,
    localAccountId: ALICE_ACCOUNT,
    remoteAccountId: BOB_ACCOUNT,
    ...options?.alice,
  });
  const bob = new WebRtcFrameTransport({
    channel: bobChannel,
    localAccountId: BOB_ACCOUNT,
    remoteAccountId: ALICE_ACCOUNT,
    now: () => RECEIVED_AT_MS,
    ...options?.bob,
  });
  return { alice, bob, aliceChannel, bobChannel };
}

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

function frame(epoch: number, sequence: number, moveX = 0): OnlineFrameSubmission {
  return { epoch, frame: sequence, input: input(moveX) };
}

async function deliverBatchAndAck(
  pending: Promise<{ acceptedFrames: number }>,
  sender: LinkedFakeChannel,
  receiver: LinkedFakeChannel,
): Promise<{ acceptedFrames: number }> {
  sender.deliverNext();
  receiver.deliverNext();
  return pending;
}

function rawBatch(
  batchId: string,
  frames: OnlineFrameSubmission[],
  overrides?: Record<string, unknown>,
): string {
  return JSON.stringify({
    protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
    type: 'frame-batch',
    fromAccountId: ALICE_ACCOUNT,
    toAccountId: BOB_ACCOUNT,
    batchId,
    frames,
    ...overrides,
  });
}

// Keep the adapter structurally compatible with a browser RTCDataChannel.
function browserAdapterTypeCheck(channel: RTCDataChannel): WebRtcDataChannelAdapter {
  return channel;
}
void browserAdapterTypeCheck;

describe('WebRtcFrameTransport', () => {
  test('resolves a submission only after the matching peer ACK', async () => {
    const timers = new ManualTimers();
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      alice: { timers, createBatchId: () => 'alice-batch-1' },
    });
    let settled = false;
    const pending = alice.submitFrames([frame(3, 0, 1)])
      .then((result) => {
        settled = true;
        return result;
      });

    await Promise.resolve();
    expect(settled).toBe(false);
    aliceChannel.deliverNext();
    await expect(bob.pollFrames(3, -1)).resolves.toEqual({
      frames: [{
        epoch: 3,
        frame: 0,
        input: input(1),
        accountId: ALICE_ACCOUNT,
        receivedAt: '2026-07-13T12:30:00.000Z',
      }],
      peerConfirmedThrough: -1,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    bobChannel.deliverNext();
    await expect(pending).resolves.toEqual({ acceptedFrames: 1 });
    expect(timers.size()).toBe(0);
  });

  test('deduplicates an exact batch replay, re-ACKs it, and accepts duplicate ACKs', async () => {
    const timers = new ManualTimers();
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      alice: { timers, createBatchId: () => 'replayed-batch' },
    });
    const pending = alice.submitFrames([frame(0, 0, 1)]);
    const serializedBatch = aliceChannel.peekNext();

    aliceChannel.deliverNext();
    aliceChannel.send(serializedBatch);
    aliceChannel.deliverNext();

    const polled = await bob.pollFrames(0, -1);
    expect(polled.frames).toHaveLength(1);
    expect(bobChannel.queuedMessages()).toBe(2);
    expect(bobChannel.sent.map((message) => JSON.parse(message).type)).toEqual([
      'frame-ack',
      'frame-ack',
    ]);

    bobChannel.deliverNext();
    await expect(pending).resolves.toEqual({ acceptedFrames: 1 });
    bobChannel.deliverNext();
    expect(alice.isClosed()).toBe(false);
  });

  test('times out an unacknowledged batch and allows the pump to retry with a new id', async () => {
    const timers = new ManualTimers();
    const ids = ['attempt-1', 'attempt-2'];
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      alice: {
        timers,
        ackTimeoutMs: 25,
        createBatchId: () => ids.shift() ?? 'unexpected-id',
      },
    });
    const firstAttempt = alice.submitFrames([frame(0, 0, 1)]);
    aliceChannel.deliverNext();
    bobChannel.dropNext();

    const firstRejection = expect(firstAttempt).rejects.toBeInstanceOf(WebRtcFrameAckTimeoutError);
    timers.runAll();
    await firstRejection;
    expect(alice.isClosed()).toBe(false);

    const retry = alice.submitFrames([frame(0, 0, 1)]);
    await expect(deliverBatchAndAck(retry, aliceChannel, bobChannel)).resolves.toEqual({
      acceptedFrames: 1,
    });
    expect((await bob.pollFrames(0, -1)).frames).toHaveLength(1);
    expect(aliceChannel.sent.map((message) => JSON.parse(message).batchId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
  });

  test('fails closed when a duplicate frame changes content', async () => {
    const onProtocolError = vi.fn();
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      bob: { onProtocolError },
    });
    const accepted = alice.submitFrames([frame(0, 4, 1)]);
    await deliverBatchAndAck(accepted, aliceChannel, bobChannel);

    aliceChannel.send(rawBatch('conflicting-batch', [frame(0, 4, -1)]));
    aliceChannel.deliverNext();

    expect(bob.isClosed()).toBe(true);
    expect(bob.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
    expect(onProtocolError).toHaveBeenCalledOnce();
    expect(aliceChannel.readyState).toBe('closed');
    expect(bobChannel.readyState).toBe('closed');
  });

  test('fails closed when a known batch id is replayed with different content', async () => {
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      alice: { createBatchId: () => 'immutable-batch' },
    });
    const accepted = alice.submitFrames([frame(0, 0, 1)]);
    await deliverBatchAndAck(accepted, aliceChannel, bobChannel);

    aliceChannel.send(rawBatch('immutable-batch', [frame(0, 1, 1)]));
    aliceChannel.deliverNext();

    expect(bob.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
  });

  test('polls only the requested epoch and cursor and reports peer confirmation', async () => {
    const { alice, bob, aliceChannel, bobChannel } = transportPair();
    const epochTwo = alice.submitFrames([frame(2, 0), frame(2, 2)]);
    await deliverBatchAndAck(epochTwo, aliceChannel, bobChannel);
    const epochThree = alice.submitFrames([frame(3, 0)]);
    await deliverBatchAndAck(epochThree, aliceChannel, bobChannel);
    await alice.confirmFrames(2, 1);
    aliceChannel.deliverNext();

    await expect(bob.pollFrames(2, 0)).resolves.toMatchObject({
      frames: [{ epoch: 2, frame: 2 }],
      peerConfirmedThrough: 1,
    });
    await expect(bob.pollFrames(3, -1)).resolves.toMatchObject({
      frames: [{ epoch: 3, frame: 0 }],
      peerConfirmedThrough: -1,
    });
    await expect(bob.pollFrames(9, -1)).resolves.toEqual({
      frames: [],
      peerConfirmedThrough: -1,
    });
  });

  test('sends confirmations monotonically and rejects an inbound regression', async () => {
    const { alice, bob, aliceChannel } = transportPair();

    await expect(alice.confirmFrames(4, 3)).resolves.toEqual({ confirmedThrough: 3 });
    await expect(alice.confirmFrames(4, 3)).resolves.toEqual({ confirmedThrough: 3 });
    await expect(alice.confirmFrames(4, 1)).resolves.toEqual({ confirmedThrough: 3 });
    expect(aliceChannel.queuedMessages()).toBe(1);
    aliceChannel.deliverNext();
    await expect(bob.pollFrames(4, -1)).resolves.toMatchObject({ peerConfirmedThrough: 3 });

    aliceChannel.send(JSON.stringify({
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-confirmation',
      fromAccountId: ALICE_ACCOUNT,
      toAccountId: BOB_ACCOUNT,
      epoch: 4,
      confirmedThrough: 2,
    }));
    aliceChannel.deliverNext();
    expect(bob.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
  });

  test.each([
    ['invalid JSON', '{not-json'],
    ['wrong protocol version', JSON.stringify({
      protocolVersion: 2,
      type: 'frame-confirmation',
      fromAccountId: ALICE_ACCOUNT,
      toAccountId: BOB_ACCOUNT,
      epoch: 0,
      confirmedThrough: 0,
    })],
    ['wrong sender account', JSON.stringify({
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-confirmation',
      fromAccountId: 'intruder',
      toAccountId: BOB_ACCOUNT,
      epoch: 0,
      confirmedThrough: 0,
    })],
    ['malformed message shape', JSON.stringify({
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-confirmation',
      fromAccountId: ALICE_ACCOUNT,
      toAccountId: BOB_ACCOUNT,
      epoch: 0,
      confirmedThrough: 0,
      unexpected: true,
    })],
  ])('fails closed on %s', (_description, serialized) => {
    const onProtocolError = vi.fn();
    const { bob, aliceChannel } = transportPair({ bob: { onProtocolError } });

    aliceChannel.send(serialized);
    aliceChannel.deliverNext();

    expect(bob.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
    expect(onProtocolError).toHaveBeenCalledOnce();
  });

  test('ignores valid recovery control packets multiplexed around channel activation', () => {
    const { bob, aliceChannel } = transportPair();

    for (const type of ['recovery-checkpoint', 'recovery-ready']) {
      aliceChannel.send(JSON.stringify({
        protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION,
        type,
      }));
      aliceChannel.deliverNext();
    }

    expect(bob.getCloseReason()).toBeNull();
  });

  test.each([1.0001, -1.0001])('fails closed on out-of-range movement input %s', (moveX) => {
    const { bob, aliceChannel } = transportPair();

    aliceChannel.send(rawBatch('invalid-axis', [frame(0, 0, moveX)]));
    aliceChannel.deliverNext();

    expect(bob.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
  });

  test('ignores a matching ACK that arrives after its batch timed out', async () => {
    const timers = new ManualTimers();
    const { alice, aliceChannel, bobChannel } = transportPair({ alice: { timers } });
    const pending = alice.submitFrames([frame(0, 0)]);
    aliceChannel.deliverNext();

    const rejection = expect(pending).rejects.toBeInstanceOf(WebRtcFrameAckTimeoutError);
    timers.runAll();
    await rejection;
    bobChannel.deliverNext();

    expect(alice.getCloseReason()).toBeNull();
  });

  test('fails closed when a late ACK changes the retired batch count', async () => {
    const timers = new ManualTimers();
    const { alice, bobChannel } = transportPair({
      alice: {
        timers,
        createBatchId: () => 'late-count-mismatch',
      },
    });
    const pending = alice.submitFrames([frame(0, 0)]);
    const rejection = expect(pending).rejects.toBeInstanceOf(WebRtcFrameAckTimeoutError);
    timers.runAll();
    await rejection;

    bobChannel.send(JSON.stringify({
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-ack',
      fromAccountId: BOB_ACCOUNT,
      toAccountId: ALICE_ACCOUNT,
      batchId: 'late-count-mismatch',
      acceptedFrames: 2,
    }));
    bobChannel.deliverNext();

    expect(alice.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
  });

  test('bounds retained frame and batch history and rejects replay beyond the window', async () => {
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      bob: { maxFrameHistory: 1, maxBatchHistory: 2 },
    });
    let firstBatch = '';
    for (let sequence = 0; sequence < 2; sequence += 1) {
      const pending = alice.submitFrames([frame(0, sequence)]);
      if (sequence === 0) {
        firstBatch = aliceChannel.peekNext();
      }
      await deliverBatchAndAck(pending, aliceChannel, bobChannel);
    }

    expect((await bob.pollFrames(0, -1)).frames.map((entry) => entry.frame)).toEqual([1]);
    aliceChannel.send(firstBatch);
    aliceChannel.deliverNext();
    expect(bob.getCloseReason()).toBeInstanceOf(OnlineFrameProtocolError);
  });

  test('cleanly closes, detaches listeners, and rejects pending submissions', async () => {
    const timers = new ManualTimers();
    const { alice, aliceChannel } = transportPair({ alice: { timers } });
    const pending = alice.submitFrames([frame(0, 0)]);
    expect(timers.size()).toBe(1);

    alice.close();
    await expect(pending).rejects.toBeInstanceOf(WebRtcFrameTransportClosedError);
    expect(alice.isClosed()).toBe(true);
    expect(aliceChannel.readyState).toBe('closed');
    expect(aliceChannel.listenerCount()).toBe(0);
    expect(timers.size()).toBe(0);

    alice.close();
    expect(aliceChannel.closeCalls).toBe(1);
    await expect(alice.pollFrames(0, -1)).rejects.toBeInstanceOf(WebRtcFrameTransportClosedError);
  });

  test('rebinds a failed channel without discarding received frame history', async () => {
    const aliceDisconnects: Error[] = [];
    const bobDisconnects: Error[] = [];
    const { alice, bob, aliceChannel, bobChannel } = transportPair({
      alice: {
        recoverOnChannelFailure: true,
        onRecoverableDisconnect: (error) => aliceDisconnects.push(error),
      },
      bob: {
        recoverOnChannelFailure: true,
        onRecoverableDisconnect: (error) => bobDisconnects.push(error),
      },
    });
    const delivered = alice.submitFrames([frame(0, 0, 0.25)]);
    await deliverBatchAndAck(delivered, aliceChannel, bobChannel);
    const interrupted = alice.submitFrames([frame(0, 1, 0.5)]);

    aliceChannel.close();

    await expect(interrupted).rejects.toBeInstanceOf(WebRtcFrameTransportClosedError);
    expect(alice.isRecovering()).toBe(true);
    expect(bob.isRecovering()).toBe(true);
    expect(alice.isClosed()).toBe(false);
    expect(aliceDisconnects).toHaveLength(1);
    expect(bobDisconnects).toHaveLength(1);
    expect(aliceChannel.listenerCount()).toBe(0);
    expect(bobChannel.listenerCount()).toBe(0);

    const [replacementAlice, replacementBob] = linkedChannels();
    alice.replaceChannel(replacementAlice);
    bob.replaceChannel(replacementBob);

    expect(alice.isRecovering()).toBe(false);
    expect((await bob.pollFrames(0, -1)).frames).toEqual([expect.objectContaining({
      epoch: 0,
      frame: 0,
      input: input(0.25),
    })]);
    const retried = alice.submitFrames([frame(0, 1, 0.5)]);
    await expect(deliverBatchAndAck(retried, replacementAlice, replacementBob)).resolves.toEqual({
      acceptedFrames: 1,
    });
    expect((await bob.pollFrames(0, 0)).frames).toEqual([expect.objectContaining({
      epoch: 0,
      frame: 1,
      input: input(0.5),
    })]);
  });

  test('rejects explicitly unordered or unreliable channel adapters', () => {
    const [unordered] = linkedChannels();
    unordered.ordered = false;
    expect(() => new WebRtcFrameTransport({
      channel: unordered,
      localAccountId: ALICE_ACCOUNT,
      remoteAccountId: BOB_ACCOUNT,
    })).toThrow('ordered RTCDataChannel');

    const [unreliable] = linkedChannels();
    unreliable.maxRetransmits = 0;
    expect(() => new WebRtcFrameTransport({
      channel: unreliable,
      localAccountId: ALICE_ACCOUNT,
      remoteAccountId: BOB_ACCOUNT,
    })).toThrow('reliable RTCDataChannel');
  });
});
