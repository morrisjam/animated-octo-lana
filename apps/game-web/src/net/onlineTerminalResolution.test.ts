import { describe, expect, it } from 'vitest';
import {
  pollOnlineTerminalSession,
  resolveOnlineTerminalResolution,
} from './onlineTerminalResolution';

const LOCAL_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const REMOTE_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function resolve(
  session: Parameters<typeof resolveOnlineTerminalResolution>[0]['session'],
  queueType: 'ranked' | 'unranked' = 'ranked',
) {
  return resolveOnlineTerminalResolution({
    queueType,
    localAccountId: LOCAL_ACCOUNT_ID,
    remoteAccountId: REMOTE_ACCOUNT_ID,
    session,
  });
}

describe('resolveOnlineTerminalResolution', () => {
  it('does not invent an outcome while the server session remains active', () => {
    expect(resolve({ status: 'active' })).toMatchObject({
      kind: 'transport_interrupted',
      winnerAccountId: null,
      shouldPollRankedResult: false,
    });
  });

  it('reports a ranked victory when the server attributes the peer forfeit', () => {
    expect(resolve({
      status: 'resolved',
      resolvedReason: 'reconnect_timeout',
      forfeitingAccountId: REMOTE_ACCOUNT_ID,
    })).toEqual({
      kind: 'ranked_forfeit_win',
      title: 'Ranked Victory by Forfeit',
      outcomeLine: 'The server attributed the disconnect or departure to your opponent.',
      winnerAccountId: LOCAL_ACCOUNT_ID,
      ratingDisposition: 'authoritative_settlement_pending',
      shouldPollRankedResult: true,
    });
  });

  it('reports a ranked defeat when the local player forfeits', () => {
    expect(resolve({
      status: 'resolved',
      resolvedReason: 'peer_left',
      forfeitingAccountId: LOCAL_ACCOUNT_ID,
    })).toMatchObject({
      kind: 'ranked_forfeit_loss',
      title: 'Ranked Defeat by Forfeit',
      winnerAccountId: REMOTE_ACCOUNT_ID,
      shouldPollRankedResult: true,
    });
  });

  it.each([
    ['session_expired' as const, 'the session expired'],
    ['reconnect_timeout' as const, 'the reconnect window expired'],
  ])('keeps unattributed %s resolutions as no-contest', (resolvedReason, reasonText) => {
    const result = resolve({ status: 'resolved', resolvedReason });

    expect(result).toMatchObject({
      kind: 'ranked_no_contest',
      title: 'Ranked Match No Contest',
      winnerAccountId: null,
      ratingDisposition: 'unchanged',
      shouldPollRankedResult: false,
    });
    expect(result.outcomeLine).toContain(reasonText);
  });

  it('keeps completed ranked sessions pending proof settlement instead of calling them no-contest', () => {
    expect(resolve({ status: 'resolved', resolvedReason: 'completed' })).toMatchObject({
      kind: 'ranked_completion_pending',
      ratingDisposition: 'proof_settlement_pending',
      shouldPollRankedResult: true,
    });
  });

  it('does not apply ranked semantics to a casual session', () => {
    expect(resolve({
      status: 'resolved',
      resolvedReason: 'peer_left',
      forfeitingAccountId: REMOTE_ACCOUNT_ID,
    }, 'unranked')).toMatchObject({
      kind: 'casual_session_ended',
      ratingDisposition: 'not_applicable',
      shouldPollRankedResult: false,
    });
  });
});

describe('pollOnlineTerminalSession', () => {
  it('keeps polling active sessions until the server resolves them', async () => {
    let reads = 0;
    const result = await pollOnlineTerminalSession({
      read: async () => {
        reads += 1;
        return reads < 3
          ? { status: 'active' as const }
          : { status: 'resolved' as const, resolvedReason: 'reconnect_timeout' as const };
      },
      maxAttempts: 4,
      retryIntervalMs: 250,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({ status: 'resolved', attempts: 3 });
    expect(reads).toBe(3);
  });

  it('returns grace expiry only after exhausting the bounded poll window', async () => {
    let waits = 0;
    const result = await pollOnlineTerminalSession({
      read: async () => ({ status: 'active' as const }),
      maxAttempts: 3,
      retryIntervalMs: 250,
      wait: async () => { waits += 1; },
    });

    expect(result).toMatchObject({ status: 'grace_expired', attempts: 3 });
    expect(waits).toBe(2);
  });
});
