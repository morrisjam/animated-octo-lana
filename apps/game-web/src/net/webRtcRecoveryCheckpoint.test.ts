import { afterEach, describe, expect, test, vi } from 'vitest';
import { fingerprintDeterministicValue } from '../sim/fingerprint';
import {
  exchangeWebRtcRecoveryCheckpoint,
  WEB_RTC_RECOVERY_PROTOCOL_VERSION,
  type WebRtcRecoveryCheckpoint,
} from './webRtcRecoveryCheckpoint';
import type {
  WebRtcDataChannelAdapter,
  WebRtcDataChannelEvent,
  WebRtcDataChannelEventListener,
} from './webRtcFrameTransport';

type ChannelEventType = 'message' | 'close' | 'error';

class LinkedChannel implements WebRtcDataChannelAdapter {
  public readonly sent: string[] = [];
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
    this.sent.push(data);
    queueMicrotask(() => this.peer?.dispatch('message', { data }));
  }

  public receive(data: unknown): void { this.dispatch('message', { data: JSON.stringify(data) }); }

  public listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
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
  afterEach(() => vi.useRealTimers());

  const proposal = (value: WebRtcRecoveryCheckpoint) => ({
    protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION, type: 'recovery-checkpoint', checkpoint: value,
  });
  const ready = (value: WebRtcRecoveryCheckpoint) => ({
    protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION, type: 'recovery-ready', checkpoint: value,
    checkpointFingerprint: fingerprintDeterministicValue(value),
  });

  test.each([
    { transportAttemptId: 'previous-session-attempt' }, { roundEpoch: 0 }, { p1Rounds: 0 }, { p2Rounds: 1 },
  ])('rejects stale timeline proposal %j before announcing readiness', async (oldTimeline) => {
    vi.useFakeTimers();
    const channel = new LinkedChannel();
    const onCheckpointAgreed = vi.fn();
    const pending = exchangeWebRtcRecoveryCheckpoint(channel, checkpoint(), { timeoutMs: 250, onCheckpointAgreed });
    const rejected = expect(pending).rejects.toThrow('does not match the local match timeline');
    channel.receive(proposal(checkpoint(oldTimeline)));
    await rejected;
    expect(onCheckpointAgreed).not.toHaveBeenCalled();
    expect(channel.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([{ transportAttemptId: 'previous-attempt' }, { roundEpoch: 0 }])('old readiness %j cannot complete a new exchange', async (oldTimeline) => {
    vi.useFakeTimers();
    const channel = new LinkedChannel();
    const pending = exchangeWebRtcRecoveryCheckpoint(channel, checkpoint(), { timeoutMs: 250 });
    const rejected = expect(pending).rejects.toThrow('references a different checkpoint');
    channel.receive(proposal(checkpoint()));
    channel.receive(ready(checkpoint(oldTimeline)));
    await rejected;
    expect(channel.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('peer readiness cannot skip the proposal or the pending local readiness callback', async () => {
    vi.useFakeTimers();
    const channel = new LinkedChannel();
    let release!: () => void;
    const localReady = new Promise<void>((resolve) => { release = resolve; });
    const onCheckpointAgreed = vi.fn(() => localReady);
    const finished = vi.fn();
    const pending = exchangeWebRtcRecoveryCheckpoint(channel, checkpoint(), {
      timeoutMs: 500, resendIntervalMs: 25, onCheckpointAgreed,
    }).then(finished);
    channel.receive(ready(checkpoint()));
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).not.toHaveBeenCalled();
    expect(onCheckpointAgreed).not.toHaveBeenCalled();
    channel.receive(proposal(checkpoint()));
    channel.receive(proposal(checkpoint()));
    await vi.advanceTimersByTimeAsync(100);
    expect(onCheckpointAgreed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(finished).toHaveBeenCalledExactlyOnceWith(checkpoint());
    expect(channel.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('timed-out readiness cannot announce itself during a subsequent exchange on the same channel', async () => {
    vi.useFakeTimers();
    const channel = new LinkedChannel();
    let releaseOld!: () => void;
    const oldReady = new Promise<void>((resolve) => { releaseOld = resolve; });
    const old = exchangeWebRtcRecoveryCheckpoint(channel, checkpoint(), {
      timeoutMs: 250, resendIntervalMs: 25, onCheckpointAgreed: () => oldReady,
    });
    const rejected = expect(old).rejects.toThrow('timed out after 250ms');
    channel.receive(proposal(checkpoint()));
    channel.receive(ready(checkpoint()));
    await vi.advanceTimersByTimeAsync(250);
    await rejected;
    expect(channel.listenerCount()).toBe(0);
    const next = checkpoint({ transportAttemptId: 'next-match', roundEpoch: 0, p1Rounds: 0 });
    channel.sent.length = 0;
    const current = exchangeWebRtcRecoveryCheckpoint(channel, next, { timeoutMs: 250, resendIntervalMs: 25 });
    releaseOld();
    channel.receive(proposal(next));
    channel.receive(ready(next));
    await vi.advanceTimersByTimeAsync(50);
    await expect(current).resolves.toEqual(next);
    expect(channel.sent.every((message) => JSON.parse(message).checkpoint.transportAttemptId === 'next-match')).toBe(true);
    expect(channel.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

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
