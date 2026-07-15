import { describe, expect, test } from 'vitest';
import {
  exchangeWebRtcRecoveryCheckpoint,
  type WebRtcRecoveryCheckpoint,
} from './webRtcRecoveryCheckpoint';
import type {
  WebRtcDataChannelAdapter,
  WebRtcDataChannelEvent,
  WebRtcDataChannelEventListener,
} from './webRtcFrameTransport';

type ChannelEventType = 'message' | 'close' | 'error';

class LinkedChannel implements WebRtcDataChannelAdapter {
  public readyState = 'open';

  public ordered = true;

  public maxPacketLifeTime: number | null = null;

  public maxRetransmits: number | null = null;

  private peer: LinkedChannel | null = null;

  private readonly listeners = new Map<ChannelEventType, Set<WebRtcDataChannelEventListener>>();

  public link(peer: LinkedChannel): void {
    this.peer = peer;
  }

  public send(data: string): void {
    if (this.readyState !== 'open') {
      throw new Error('channel is closed');
    }
    queueMicrotask(() => this.peer?.dispatch('message', { data }));
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

  private dispatch(type: ChannelEventType, event: WebRtcDataChannelEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

function linkedChannels(): [LinkedChannel, LinkedChannel] {
  const first = new LinkedChannel();
  const second = new LinkedChannel();
  first.link(second);
  second.link(first);
  return [first, second];
}

function checkpoint(overrides: Partial<WebRtcRecoveryCheckpoint> = {}): WebRtcRecoveryCheckpoint {
  return {
    transportAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    roundEpoch: 2,
    confirmedThrough: 120,
    p1Rounds: 1,
    p2Rounds: 0,
    stateChecksum: 3_733_511_858,
    ...overrides,
  };
}

describe('exchangeWebRtcRecoveryCheckpoint', () => {
  test('requires both peers to acknowledge the exact confirmed deterministic checkpoint', async () => {
    const [first, second] = linkedChannels();

    const agreed = await Promise.all([
      exchangeWebRtcRecoveryCheckpoint(first, checkpoint(), {
        timeoutMs: 500,
        resendIntervalMs: 25,
      }),
      exchangeWebRtcRecoveryCheckpoint(second, checkpoint(), {
        timeoutMs: 500,
        resendIntervalMs: 25,
      }),
    ]);

    expect(agreed).toEqual([checkpoint(), checkpoint()]);
  });

  test('rejects a state checksum mismatch instead of resuming divergent peers', async () => {
    const [first, second] = linkedChannels();

    const results = await Promise.allSettled([
      exchangeWebRtcRecoveryCheckpoint(first, checkpoint(), {
        timeoutMs: 500,
        resendIntervalMs: 25,
      }),
      exchangeWebRtcRecoveryCheckpoint(second, checkpoint({ stateChecksum: 123 }), {
        timeoutMs: 500,
        resendIntervalMs: 25,
      }),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(results.map((result) => (
      result.status === 'rejected' ? String(result.reason) : ''
    )).join(' ')).toContain('does not match');
  });

  test('negotiates the lower mutually confirmed prefix while retaining newer local state', async () => {
    const [first, second] = linkedChannels();
    const presenceReconnects: string[] = [];

    const agreed = await Promise.all([
      exchangeWebRtcRecoveryCheckpoint(first, checkpoint({
        confirmedThrough: 120,
        stateChecksum: 1_200,
      }), {
        timeoutMs: 500,
        resendIntervalMs: 25,
        resolveStateChecksum: (frame) => frame === 119 ? 1_190 : null,
        onCheckpointAgreed: async () => { presenceReconnects.push('first'); },
      }),
      exchangeWebRtcRecoveryCheckpoint(second, checkpoint({
        confirmedThrough: 119,
        stateChecksum: 1_190,
      }), {
        timeoutMs: 500,
        resendIntervalMs: 25,
        resolveStateChecksum: () => null,
        onCheckpointAgreed: async () => { presenceReconnects.push('second'); },
      }),
    ]);

    expect(agreed).toEqual([
      checkpoint({ confirmedThrough: 119, stateChecksum: 1_190 }),
      checkpoint({ confirmedThrough: 119, stateChecksum: 1_190 }),
    ]);
    expect(presenceReconnects.sort()).toEqual(['first', 'second']);
  });

  test('supports the shared initial-state prefix before frame zero', async () => {
    const [first, second] = linkedChannels();
    const initial = checkpoint({ confirmedThrough: -1, stateChecksum: 42 });

    await expect(Promise.all([
      exchangeWebRtcRecoveryCheckpoint(first, initial, { timeoutMs: 500, resendIntervalMs: 25 }),
      exchangeWebRtcRecoveryCheckpoint(second, initial, { timeoutMs: 500, resendIntervalMs: 25 }),
    ])).resolves.toEqual([initial, initial]);
  });
});
