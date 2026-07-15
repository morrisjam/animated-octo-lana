import { describe, expect, test, vi } from 'vitest';
import { reconcileOnlineCompletionConsensus } from './onlineCompletionConsensus';

describe('reconcileOnlineCompletionConsensus', () => {
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
