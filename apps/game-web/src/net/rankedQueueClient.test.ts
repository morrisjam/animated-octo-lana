import { describe, expect, test, vi } from 'vitest';
import { decideMatchedTicketBootstrap } from './onlineSessionLifecycle';
import { RankedQueueClient, type RankedQueueTicket } from './rankedQueueClient';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const queued: RankedQueueTicket = { ticketId: 'ticket-a', accountId: 'A', status: 'queued' };
const matched: RankedQueueTicket = { ...queued, status: 'matched', matchStart: { sessionId: 'session-a' } };
const session = { sessionId: 'session-a', status: 'active' as const };

function fixture() {
  const options = {
    join: vi.fn(async (_accountId: string): Promise<RankedQueueTicket> => ({ ...queued, joinDisposition: 'created' })),
    readTicket: vi.fn(async (_id: string, _account: string) => matched),
    readSession: vi.fn(async (_id: string, _account: string) => session),
    leave: vi.fn(async (_id: string, _account: string): Promise<unknown> => ({ ...queued, status: 'closed' })),
    onState: vi.fn(),
    onMatched: vi.fn(),
  };
  return { options, client: new RankedQueueClient(options) };
}

function bootstrapDecision(options: ReturnType<typeof fixture>['options']) {
  const [ticket, value, bootstrap] = options.onMatched.mock.lastCall!;
  return decideMatchedTicketBootstrap({
    previousTicket: bootstrap.previousTicket ? {
      ...bootstrap.previousTicket, sessionId: bootstrap.previousTicket.matchStart?.sessionId ?? null,
    } : null,
    currentTicket: { ...ticket, sessionId: ticket.matchStart?.sessionId ?? null },
    sessionStatus: value.status,
    serverCreatedTicket: bootstrap.serverCreatedTicket,
  });
}

describe('ranked queue lifecycle', () => {
  test.each(['refresh', 'join'] as const)('retries failed session lookup through %s without losing fresh-match evidence', async (retry) => {
    const { client, options } = fixture();
    await client.join('A');
    options.readSession.mockRejectedValueOnce(new Error('session temporarily unavailable'));
    await expect(client.refresh('A')).rejects.toThrow('temporarily unavailable');
    expect(options.onState).toHaveBeenLastCalledWith(matched, null);
    expect(options.onMatched).not.toHaveBeenCalled();
    options.join.mockResolvedValue({ ...matched, joinDisposition: 'existing' });
    await client[retry]('A');
    expect(bootstrapDecision(options)).toBe('start_fresh');
    await client.refresh('A');
    expect(options.onMatched).toHaveBeenCalledTimes(1);
  });

  test('retains fresh evidence when the initial join immediately matches', async () => {
    const { client, options } = fixture();
    options.join.mockResolvedValue({ ...matched, joinDisposition: 'created' });
    options.readSession.mockRejectedValueOnce(new Error('offline'));
    await expect(client.join('A')).rejects.toThrow('offline');
    await client.refresh('A');
    expect(bootstrapDecision(options)).toBe('start_fresh');
  });

  test('does not invent fresh-match evidence for an existing matched ticket', async () => {
    const { client, options } = fixture();
    options.join.mockResolvedValue({ ...matched, joinDisposition: 'existing' });
    await client.join('A');
    expect(bootstrapDecision(options)).toBe('resume_or_rejoin');
  });

  test('recovers from failed join and ticket polling requests', async () => {
    const { client, options } = fixture();
    options.join.mockRejectedValueOnce(new Error('join unavailable'));
    await expect(client.join('A')).rejects.toThrow('join unavailable');
    await client.join('A');
    options.readTicket.mockRejectedValueOnce(new Error('poll unavailable'));
    await expect(client.refresh('A')).rejects.toThrow('poll unavailable');
    await client.refresh('A');
    expect(bootstrapDecision(options)).toBe('start_fresh');
  });

  test('retries failed bootstrap dispatch without losing the observed transition', async () => {
    const { client, options } = fixture();
    await client.join('A');
    options.onMatched.mockImplementationOnce(() => { throw new Error('dispatch failed'); });
    await expect(client.refresh('A')).rejects.toThrow('dispatch failed');
    await client.refresh('A');
    expect(bootstrapDecision(options)).toBe('start_fresh');
  });

  test('cancels a queued ticket before local play without needing a session', async () => {
    const { client, options } = fixture();
    await client.join('A');
    await client.cancel();
    await client.refresh('A');
    expect(options.leave).toHaveBeenCalledExactlyOnceWith('ticket-a', 'A');
    expect(options.onState).toHaveBeenLastCalledWith(null, null);
    expect(options.readTicket).not.toHaveBeenCalled();
  });

  test('waits for an in-flight join and leaves its ticket before logout can replace credentials', async () => {
    const { client, options } = fixture();
    const response = deferred<RankedQueueTicket>();
    options.join.mockReturnValueOnce(response.promise);
    const joining = client.join('A');
    await vi.waitFor(() => expect(options.join).toHaveBeenCalled());
    const signedOut = vi.fn();
    const leaving = client.cancel().then(signedOut);
    expect(signedOut).not.toHaveBeenCalled();
    response.resolve(matched);
    await Promise.all([joining, leaving]);
    expect(options.leave).toHaveBeenCalledExactlyOnceWith('ticket-a', 'A');
    expect(options.onMatched).not.toHaveBeenCalled();
    expect(options.onState).toHaveBeenLastCalledWith(null, null);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  test.each(['readTicket', 'readSession'] as const)('ignores a late %s response after cancellation', async (boundary) => {
    const { client, options } = fixture();
    await client.join('A');
    const response = deferred<any>();
    options[boundary].mockReturnValueOnce(response.promise);
    const refreshing = client.refresh('A');
    await vi.waitFor(() => expect(options[boundary]).toHaveBeenCalled());
    const leaving = client.cancel();
    response.resolve(boundary === 'readTicket' ? matched : session);
    await Promise.all([refreshing, leaving]);
    expect(options.onMatched).not.toHaveBeenCalled();
    expect(options.onState).toHaveBeenLastCalledWith(null, null);
  });

  test('serializes repeated departures and retries a failed leave before a new join', async () => {
    const { client, options } = fixture();
    await client.join('A');
    const response = deferred<unknown>();
    options.leave.mockReturnValueOnce(response.promise);
    const first = client.cancel();
    const second = client.cancel();
    expect(options.leave).toHaveBeenCalledTimes(1);
    response.resolve({});
    await Promise.all([first, second]);
    await client.join('A');
    options.leave.mockRejectedValueOnce(new Error('leave unavailable'));
    await expect(client.cancel()).rejects.toThrow('leave unavailable');
    await client.join('B');
    expect(options.leave).toHaveBeenLastCalledWith('ticket-a', 'A');
    expect(options.leave.mock.invocationCallOrder.at(-1)).toBeLessThan(options.join.mock.invocationCallOrder.at(-1)!);
  });

  test('detaches completed matches without sending a forfeit and accepts a rematch', async () => {
    const { client, options } = fixture();
    await client.join('A');
    await client.refresh('A');
    await client.cancel(false);
    expect(options.leave).not.toHaveBeenCalled();
    options.join.mockResolvedValue({ ...matched, ticketId: 'rematch', matchStart: { sessionId: 'session-b' }, joinDisposition: 'created' });
    await client.join('A');
    expect(options.onMatched).toHaveBeenCalledTimes(2);
    expect(bootstrapDecision(options)).toBe('start_fresh');
  });

  test('closed tickets and wrong-account polls cannot bootstrap', async () => {
    const { client, options } = fixture();
    await client.join('A');
    await client.refresh('B');
    expect(options.readTicket).not.toHaveBeenCalled();
    options.readTicket.mockResolvedValue({ ...queued, status: 'closed' });
    await client.refresh('A');
    await client.refresh('A');
    expect(options.readTicket).toHaveBeenCalledTimes(1);
    expect(options.onMatched).not.toHaveBeenCalled();
  });
});
