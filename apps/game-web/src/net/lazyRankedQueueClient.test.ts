import { describe, expect, test, vi } from 'vitest';
import { createLazyRankedQueueClient } from './lazyRankedQueueClient';
import { createHttpRankedQueueClient, RankedQueueClient, type RankedQueueTicket } from './rankedQueueClient';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function fixture() {
  const ticket: RankedQueueTicket = { ticketId: 'ticket-A', accountId: 'A', status: 'queued' };
  const options = {
    join: vi.fn(async (accountId: string): Promise<RankedQueueTicket> => ({ ...ticket, accountId })),
    readTicket: vi.fn(async () => ticket), readSession: vi.fn(async () => ({})),
    leave: vi.fn(async () => ({})), onState: vi.fn(), onMatched: vi.fn(),
  };
  const client = new RankedQueueClient(options);
  const chunk = deferred<typeof client>();
  const load = vi.fn(() => chunk.promise);
  return { ticket, options, client, chunk, load, lazy: createLazyRankedQueueClient(load) };
}

describe('lazy ranked queue', () => {
  test('does not load for construction, local navigation or logout without ranked activity', async () => {
    const { lazy, load } = fixture();
    await lazy.cancel();
    await lazy.cancel(false);
    expect(load).not.toHaveBeenCalled();
  });

  test('shares one module load for concurrent actions and reuses the delegate', async () => {
    const { lazy, load, chunk, client, options } = fixture();
    const joining = lazy.join('A');
    const refreshing = lazy.refresh('A');
    expect(load).toHaveBeenCalledTimes(1);
    chunk.resolve(client);
    await Promise.all([joining, refreshing]);
    await lazy.refresh('A');
    expect(load).toHaveBeenCalledTimes(1);
    expect(options.join).toHaveBeenCalledTimes(1);
    expect(options.readTicket).toHaveBeenCalledTimes(2);
  });

  test('navigation during loading invalidates pending join and refresh without creating a ticket', async () => {
    const { lazy, chunk, client, options } = fixture();
    const joining = lazy.join('A');
    const refreshing = lazy.refresh('A');
    await lazy.cancel();
    chunk.resolve(client);
    await Promise.all([joining, refreshing]);
    expect(options.join).not.toHaveBeenCalled();
    expect(options.readTicket).not.toHaveBeenCalled();
    expect(options.leave).not.toHaveBeenCalled();
    expect(options.onState).not.toHaveBeenCalled();
  });

  test('account switching while loading only permits the new identity to join', async () => {
    const { lazy, chunk, client, options } = fixture();
    const oldJoin = lazy.join('A');
    await lazy.cancel();
    const newJoin = lazy.join('B');
    chunk.resolve(client);
    await Promise.all([oldJoin, newJoin]);
    expect(options.join).toHaveBeenCalledExactlyOnceWith('B');
  });

  test('cancel waits for an already-started join and its departure before logout', async () => {
    const { lazy, chunk, client, options, ticket } = fixture();
    const response = deferred<RankedQueueTicket>();
    options.join.mockReturnValueOnce(response.promise);
    const joining = lazy.join('A');
    chunk.resolve(client);
    await vi.waitFor(() => expect(options.join).toHaveBeenCalled());
    const loggedOut = vi.fn();
    const leaving = lazy.cancel().then(loggedOut);
    expect(loggedOut).not.toHaveBeenCalled();
    response.resolve(ticket);
    await Promise.all([joining, leaving]);
    expect(options.leave).toHaveBeenCalledExactlyOnceWith('ticket-A', 'A');
    expect(options.onState).toHaveBeenLastCalledWith(null, null);
    expect(loggedOut).toHaveBeenCalledTimes(1);
  });

  test('loaded cancellation remains synchronous and preserves completed-match no-forfeit behavior', async () => {
    const { lazy, chunk, client, options } = fixture();
    chunk.resolve(client);
    await lazy.join('A');
    const leaving = lazy.cancel(false);
    expect(options.onState).toHaveBeenLastCalledWith(null, null);
    await leaving;
    expect(options.leave).not.toHaveBeenCalled();
  });

  test('failed chunk loads can be retried', async () => {
    const { client, options } = fixture();
    const load = vi.fn().mockRejectedValueOnce(new Error('chunk unavailable')).mockResolvedValue(client);
    const lazy = createLazyRankedQueueClient(load);
    await expect(lazy.join('A')).rejects.toThrow('chunk unavailable');
    await lazy.join('A');
    expect(load).toHaveBeenCalledTimes(2);
    expect(options.join).toHaveBeenCalledExactlyOnceWith('A');
  });

  test('failed departure blocks logout and is retried before the next join', async () => {
    const { lazy, chunk, client, options } = fixture();
    chunk.resolve(client);
    await lazy.join('A');
    options.leave.mockRejectedValueOnce(new Error('leave unavailable'));
    await expect(lazy.cancel()).rejects.toThrow('leave unavailable');
    await lazy.join('B');
    expect(options.leave).toHaveBeenCalledTimes(2);
    expect(options.join).toHaveBeenLastCalledWith('B');
  });
});

test('deferred HTTP wiring keeps dynamic identity, request deadlines and keepalive cleanup', async () => {
  const ticket: RankedQueueTicket = { ticketId: 'ticket-A', accountId: 'A', status: 'queued' };
  const matched = { ...ticket, status: 'matched', matchStart: { sessionId: 'session-A' } };
  const requestJson = vi.fn().mockResolvedValueOnce(ticket).mockResolvedValueOnce(matched)
    .mockResolvedValueOnce({ sessionId: 'session-A' }).mockResolvedValueOnce({ ...ticket, status: 'closed' });
  let characterId = 'vanguard';
  const client = createHttpRankedQueueClient({
    requestJson,
    getJoinIdentity: () => ({ buildVersion: 'build', rulesetVersion: 'ruleset', balanceProfileId: 'default', characterId }),
    onState: vi.fn(), onMatched: vi.fn(),
  });
  characterId = 'duelist';
  await client.join('A');
  await client.refresh('A');
  await client.cancel();
  expect(requestJson.mock.calls.map(([method, path, account]) => [method, path, account])).toEqual([
    ['POST', '/matchmaking/queue/join', 'A'], ['GET', '/matchmaking/queue/tickets/ticket-A', 'A'],
    ['GET', '/matchmaking/sessions/session-A', 'A'], ['POST', '/matchmaking/queue/leave', 'A'],
  ]);
  expect(requestJson.mock.calls[0][3]).toEqual({
    queueType: 'ranked', regionPreferences: ['us-east', 'us-west', 'eu-west'], platform: 'web',
    buildVersion: 'build', rulesetVersion: 'ruleset', balanceProfileId: 'default', characterId: 'duelist',
  });
  for (const call of requestJson.mock.calls) expect(call[4].signal).toBeInstanceOf(AbortSignal);
  expect(requestJson.mock.lastCall?.[4].keepalive).toBe(true);
});
