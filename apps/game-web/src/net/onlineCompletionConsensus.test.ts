import { describe, expect, test, vi } from 'vitest';
import { reconcileOnlineCompletionConsensus } from './onlineCompletionConsensus';

describe('reconcileOnlineCompletionConsensus', () => {
  test('exhausts exactly the configured bound when both completion and fallback reads fail', async () => {
    const failure = new Error('offline');
    const attest = vi.fn().mockRejectedValue(failure);
    const read = vi.fn().mockRejectedValue(failure);
    const wait = vi.fn(async () => {});
    const onAttempt = vi.fn();
    const result = await reconcileOnlineCompletionConsensus({ attest, read, wait, onAttempt, maxAttempts: 3, retryIntervalMs: 100 });
    expect(result).toEqual({ status: 'grace_expired', attempts: 3, session: null, lastError: failure });
    expect(attest).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[100], [100]]);
    expect(onAttempt.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  test('overlapping old-match and rematch completion calls keep independent results and retry budgets', async () => {
    const completed = (sessionId: string) => ({ sessionId, status: 'resolved' as const, resolvedReason: 'completed' });
    let finishOld!: (value: ReturnType<typeof completed>) => void;
    let finishNew!: (value: ReturnType<typeof completed>) => void;
    const oldRead = vi.fn(() => new Promise<ReturnType<typeof completed>>((resolve) => { finishOld = resolve; }));
    const nextAttest = vi.fn().mockResolvedValueOnce({ sessionId: 'new', status: 'active' })
      .mockImplementationOnce(() => new Promise<ReturnType<typeof completed>>((resolve) => { finishNew = resolve; }));
    const oldAttempt = vi.fn();
    const nextAttempt = vi.fn();
    const oldResult = reconcileOnlineCompletionConsensus({
      attest: vi.fn().mockRejectedValue(new Error('old response lost')), read: oldRead,
      maxAttempts: 2, retryIntervalMs: 100, wait: async () => {}, onAttempt: oldAttempt,
    });
    const nextResult = reconcileOnlineCompletionConsensus({
      attest: nextAttest, read: vi.fn(), maxAttempts: 2, retryIntervalMs: 100,
      wait: async () => {}, onAttempt: nextAttempt,
    });
    await vi.waitFor(() => expect(nextAttest).toHaveBeenCalledTimes(2));
    finishOld(completed('old'));
    await expect(oldResult).resolves.toMatchObject({ status: 'consensus', attempts: 1, session: { sessionId: 'old' } });
    expect(nextAttempt).toHaveBeenCalledTimes(1);
    finishNew(completed('new'));
    await expect(nextResult).resolves.toMatchObject({ status: 'consensus', attempts: 2, session: { sessionId: 'new' } });
    expect(oldAttempt.mock.calls.every((call) => call[2].sessionId === 'old')).toBe(true);
    expect(nextAttempt.mock.calls.every((call) => call[2].sessionId === 'new')).toBe(true);
  });

  test('re-attests until the peer reaches completed consensus', async () => {
    const attest = vi.fn()
      .mockResolvedValueOnce({ status: 'active' as const })
      .mockResolvedValueOnce({ status: 'resolved' as const, resolvedReason: 'completed' });
    const wait = vi.fn(async () => undefined);

    const result = await reconcileOnlineCompletionConsensus({
      attest,
      read: vi.fn(),
      maxAttempts: 4,
      retryIntervalMs: 250,
      wait,
    });

    expect(result).toMatchObject({ status: 'consensus', attempts: 2 });
    expect(attest).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  test('polls after a failed attestation and stops at grace expiry', async () => {
    const transient = new Error('complete request timed out');
    const attest = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValue({ status: 'active' as const });
    const read = vi.fn(async () => ({ status: 'active' as const }));

    const result = await reconcileOnlineCompletionConsensus({
      attest,
      read,
      maxAttempts: 3,
      retryIntervalMs: 100,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({ status: 'grace_expired', attempts: 3 });
    expect(attest).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledOnce();
  });

  test('does not mistake a non-completion terminal state for consensus', async () => {
    const result = await reconcileOnlineCompletionConsensus({
      attest: async () => ({ status: 'resolved' as const, resolvedReason: 'peer_left' }),
      read: vi.fn(),
      maxAttempts: 2,
      retryIntervalMs: 100,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'terminal',
      session: { resolvedReason: 'peer_left' },
    });
  });
});
