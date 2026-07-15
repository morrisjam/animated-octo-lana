import { describe, expect, test } from 'vitest';
import type { PlayerFrameInput } from '../sim/types';
import {
  RecoverableWebRtcTransport,
  WebRtcRecoveryExhaustedError,
  type WebRtcRecoverySnapshot,
} from './recoverableWebRtcTransport';
import {
  WebRtcFrameTransportClosedError,
  type WebRtcDataChannelAdapter,
  type WebRtcDataChannelEvent,
  type WebRtcDataChannelEventListener,
} from './webRtcFrameTransport';
import type { ConnectedWebRtcSession } from './webRtcSession';

type ChannelEventType = 'message' | 'close' | 'error';

class FakeChannel implements WebRtcDataChannelAdapter {
  public readyState = 'open';

  public ordered = true;

  public maxPacketLifeTime: number | null = null;

  public maxRetransmits: number | null = null;

  public readonly sent: string[] = [];

  private readonly listeners = new Map<ChannelEventType, Set<WebRtcDataChannelEventListener>>();

  public send(data: string): void {
    if (this.readyState !== 'open') {
      throw new Error('channel is closed');
    }
    this.sent.push(data);
  }

  public close(): void {
    if (this.readyState === 'closed') {
      return;
    }
    this.readyState = 'closed';
    this.dispatch('close', {});
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

  public receive(data: string): void {
    this.dispatch('message', { data });
  }

  private dispatch(type: ChannelEventType, event: WebRtcDataChannelEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

function session(channel = new FakeChannel()): ConnectedWebRtcSession & { closeCalls: number } {
  return {
    channel: channel as unknown as RTCDataChannel,
    connectionPath: 'direct',
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
      channel.close();
    },
  };
}

function input(): PlayerFrameInput {
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

describe('RecoverableWebRtcTransport', () => {
  test('automatically replaces a closed channel and resumes on preserved transport state', async () => {
    const initialChannel = new FakeChannel();
    const replacementChannel = new FakeChannel();
    const initialSession = session(initialChannel);
    const replacementSession = session(replacementChannel);
    const snapshots: WebRtcRecoverySnapshot[] = [];
    let recovered = 0;
    let prepared = 0;
    let validated = 0;
    const transport = new RecoverableWebRtcTransport({
      initialSession,
      localAccountId: 'account-p1',
      remoteAccountId: 'account-p2',
      connect: async () => replacementSession,
      prepareRecovery: async () => {
        prepared += 1;
      },
      validateReplacement: async (candidate) => {
        expect(candidate).toBe(replacementSession);
        validated += 1;
      },
      wait: async () => undefined,
      onStateChange: (snapshot) => snapshots.push(snapshot),
      onRecovered: () => {
        recovered += 1;
      },
    });

    initialChannel.close();
    await transport.waitForRecovery();

    expect(transport.getSnapshot()).toEqual({
      state: 'connected',
      attempt: 0,
      maxAttempts: 2,
      lastError: null,
    });
    expect(snapshots.map((snapshot) => snapshot.state)).toContain('reconnecting');
    expect(recovered).toBe(1);
    expect(prepared).toBe(1);
    expect(validated).toBe(1);
    expect(initialSession.closeCalls).toBe(1);
    expect(replacementSession.closeCalls).toBe(0);

    const pending = transport.submitFrames([{ epoch: 0, frame: 0, input: input() }]);
    expect(replacementChannel.sent).toHaveLength(1);
    transport.close();
    await expect(pending).rejects.toBeInstanceOf(WebRtcFrameTransportClosedError);
    expect(replacementSession.closeCalls).toBe(1);
  });

  test('fails closed after a bounded number of fresh signaling attempts', async () => {
    const initialChannel = new FakeChannel();
    const initialSession = session(initialChannel);
    const terminalFailures: Error[] = [];
    let connectCalls = 0;
    const transport = new RecoverableWebRtcTransport({
      initialSession,
      localAccountId: 'account-p1',
      remoteAccountId: 'account-p2',
      maxAttempts: 2,
      retryDelayMs: 1,
      wait: async () => undefined,
      connect: async () => {
        connectCalls += 1;
        throw new Error(`signaling failure ${connectCalls}`);
      },
      onTerminalFailure: (error) => terminalFailures.push(error),
    });

    transport.requestRecovery(new Error('ACK timed out'));
    await transport.waitForRecovery();

    expect(connectCalls).toBe(2);
    expect(transport.getSnapshot().state).toBe('failed');
    expect(transport.getSnapshot().lastError).toBeInstanceOf(WebRtcRecoveryExhaustedError);
    expect(terminalFailures).toHaveLength(1);
    expect(initialSession.closeCalls).toBe(1);
    await expect(transport.pollFrames(0, -1)).rejects.toBeInstanceOf(
      WebRtcFrameTransportClosedError,
    );
  });

  test('buffers the first resumed frame batch before replacement validation completes', async () => {
    const initialChannel = new FakeChannel();
    const replacementChannel = new FakeChannel();
    const transport = new RecoverableWebRtcTransport({
      initialSession: session(initialChannel),
      localAccountId: 'account-p1',
      remoteAccountId: 'account-p2',
      connect: async () => session(replacementChannel),
      validateReplacement: async () => {
        replacementChannel.receive(JSON.stringify({
          protocolVersion: 1,
          type: 'frame-batch',
          fromAccountId: 'account-p2',
          toAccountId: 'account-p1',
          batchId: 'first-resumed-batch',
          frames: [{ epoch: 0, frame: 7, input: input() }],
        }));
      },
      wait: async () => undefined,
    });

    initialChannel.close();
    await transport.waitForRecovery();

    await expect(transport.pollFrames(0, -1)).resolves.toMatchObject({
      frames: [{ epoch: 0, frame: 7, accountId: 'account-p2' }],
    });
    expect(replacementChannel.sent.map((message) => JSON.parse(message))).toContainEqual(
      expect.objectContaining({ type: 'frame-ack', batchId: 'first-resumed-batch' }),
    );
    transport.close();
  });

  test('turns an ACK timeout into the bounded recovery path', async () => {
    const initialChannel = new FakeChannel();
    const replacementChannel = new FakeChannel();
    let connectCalls = 0;
    const transport = new RecoverableWebRtcTransport({
      initialSession: session(initialChannel),
      localAccountId: 'account-p1',
      remoteAccountId: 'account-p2',
      maxAttempts: 1,
      connect: async () => {
        connectCalls += 1;
        return session(replacementChannel);
      },
      frameTransport: { ackTimeoutMs: 1 },
      wait: async () => undefined,
    });

    await expect(transport.submitFrames([{ epoch: 0, frame: 0, input: input() }]))
      .rejects.toBeInstanceOf(WebRtcFrameTransportClosedError);
    await transport.waitForRecovery();

    expect(connectCalls).toBe(1);
    expect(transport.getSnapshot()).toMatchObject({ state: 'connected', attempt: 0 });
    transport.close();
  });
});
