import { afterEach, describe, expect, test, vi } from 'vitest';
import { toRankedViewState, toRoomViewState } from './onlineMenuState';

afterEach(() => vi.useRealTimers());

describe('deferred online menu status', () => {
  const ticket = { ticketId: 'ticket', queueType: 'ranked', status: 'queued' as const, queuedAt: '2026-09-05T00:00:00Z' };

  test('preserves idle, waiting, invalid-clock and closed ranked states', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:15Z'));
    expect(toRankedViewState(null, null, true).headline).toBe('Not queued');
    expect(toRankedViewState(ticket, null, true)).toMatchObject({
      headline: 'Searching for match', detail: 'Ticket: ticket\nQueue: ranked\nWait: 15s',
    });
    expect(toRankedViewState({ ...ticket, queuedAt: 'invalid' }, null, true).detail).toContain('Wait: unknown');
    expect(toRankedViewState({ ...ticket, queuedAt: '2026-09-06' }, null, true).detail).toContain('Wait: 0s');
    expect(toRankedViewState({ ...ticket, status: 'closed', closedReason: 'expired' }, null, true)).toMatchObject({
      headline: 'Queue closed', detail: 'Ticket: ticket\nReason: expired', tone: 'warning',
    });
  });

  test.each([true, false])('preserves matched diagnostics and runtime visibility (%s)', (enabled) => {
    const result = toRankedViewState({
      ...ticket, status: 'matched', matchStart: {
        sessionId: 'session', diagnostics: { skillTrack: 'rating', matchedGap: 300, expectedGap: 310 },
      },
    }, { sessionId: 'session', status: 'active', participants: [{ accountId: 'A' }, { accountId: 'B' }] }, enabled);
    expect(result.headline).toBe('Match found (session created)');
    expect(result.detail).toContain('Participants: A, B\nBand: rating | Gap: 300 / 310\nSession: session\nPhase: active');
    expect(result.tone).toBe(enabled ? 'success' : 'warning');
    expect(result.hint).toContain(enabled ? 'transition into the online session' : 'intentionally hidden');
    const pending = toRankedViewState({ ...ticket, status: 'matched' }, null, enabled);
    expect(pending.detail).toContain('Participants: pending\nBand: pending\nSession: pending');
  });

  test('preserves room participant counts, fallback codes and session hints', () => {
    expect(toRoomViewState(null, true, 'ABC123')).toMatchObject({ headline: 'No room loaded', roomCode: 'ABC123' });
    const room = {
      roomCode: 'ABC123', status: 'open', hostAccountId: 'A',
      participants: [{ role: 'player' }, { role: 'player' }, { role: 'spectator' }],
    };
    expect(toRoomViewState(room, true)).toMatchObject({
      headline: 'Room ABC123 (open)', detail: 'Host: A\nPlayers: 2\nSpectators: 1\nSession: none', tone: 'neutral',
    });
    expect(toRoomViewState({ ...room, status: 'closed' }, true).tone).toBe('warning');
    expect(toRoomViewState({ ...room, activeSession: { sessionId: 'session', phase: 'in_match' } }, true)).toMatchObject({
      tone: 'success', hint: 'Room session is live. Refresh if participant or session state looks stale.',
    });
    expect(toRoomViewState({ ...room, activeSession: { sessionId: 'session', phase: 'staged' } }, false).hint).toContain('Room session is staged');
  });
});
