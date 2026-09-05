export interface RankedQueueTicket {
  ticketId: string;
  accountId: string;
  status: 'queued' | 'matched' | 'closed';
  matchStart?: { sessionId: string };
  joinDisposition?: 'created' | 'existing';
}

interface RankedQueueClientOptions<T extends RankedQueueTicket, S> {
  join(accountId: string): Promise<T>;
  readTicket(ticketId: string, accountId: string): Promise<T>;
  readSession(sessionId: string, accountId: string): Promise<S>;
  leave(ticketId: string, accountId: string): Promise<unknown>;
  onState(ticket: T | null, session: S | null): void;
  onMatched(ticket: T, session: S, bootstrap: {
    previousTicket: T | null;
    serverCreatedTicket: boolean;
  }): void;
}

interface HttpRankedQueueClientOptions<T extends RankedQueueTicket, S>
  extends Pick<RankedQueueClientOptions<T, S>, 'onState' | 'onMatched'> {
  requestJson<R>(method: 'GET' | 'POST', path: string, accountId: string, body?: unknown,
    options?: { keepalive?: boolean; signal?: AbortSignal }): Promise<R>;
  getJoinIdentity(): { buildVersion: string; rulesetVersion: string; balanceProfileId: string; characterId: string };
}

export function createHttpRankedQueueClient<T extends RankedQueueTicket, S>(
  options: HttpRankedQueueClientOptions<T, S>,
): RankedQueueClient<T, S> {
  const request = <R>(method: 'GET' | 'POST', path: string, accountId: string, body?: unknown, keepalive = false) => (
    options.requestJson<R>(method, path, accountId, body, { keepalive, signal: AbortSignal.timeout(10_000) })
  );
  return new RankedQueueClient<T, S>({
    join: (accountId) => request<T>('POST', '/matchmaking/queue/join', accountId, {
      queueType: 'ranked', regionPreferences: ['us-east', 'us-west', 'eu-west'], platform: 'web',
      ...options.getJoinIdentity(),
    }),
    readTicket: (ticketId, accountId) => request<T>('GET', `/matchmaking/queue/tickets/${ticketId}`, accountId),
    readSession: (sessionId, accountId) => request<S>('GET', `/matchmaking/sessions/${sessionId}`, accountId),
    leave: (ticketId, accountId) => request<T>('POST', '/matchmaking/queue/leave', accountId, { ticketId }, true),
    onState: options.onState,
    onMatched: options.onMatched,
  });
}

export class RankedQueueClient<T extends RankedQueueTicket, S> {
  private ticket: T | null = null;
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();
  private freshMatch: { sessionId: string; previousTicket: T | null; created: boolean } | null = null;
  private departures = new Map<string, T>();
  private departurePending: Promise<void> | null = null;
  private deliveredSessionId: string | null = null;

  constructor(private readonly options: RankedQueueClientOptions<T, S>) {}

  join(accountId: string): Promise<void> {
    return this.enqueue(async (generation) => {
      const previous = this.ticket;
      const ticket = await this.options.join(accountId);
      if (generation !== this.generation) {
        // A join response can arrive after the user has already left the menu.
        if (ticket.status !== 'closed') {
          this.departures.set(ticket.ticketId, ticket);
          await this.leaveDepartures();
        }
        return;
      }
      await this.accept(ticket, previous, ticket.joinDisposition === 'created', generation);
    });
  }

  refresh(accountId: string): Promise<void> {
    return this.enqueue(async (generation) => {
      const previous = this.ticket;
      if (!previous || previous.accountId !== accountId || previous.status === 'closed') return;
      const ticket = await this.options.readTicket(previous.ticketId, accountId);
      if (generation !== this.generation) return;
      await this.accept(ticket, previous, false, generation);
    });
  }

  cancel(leaveTicket = true): Promise<void> {
    this.generation += 1;
    const ticket = this.ticket;
    this.ticket = null;
    this.freshMatch = null;
    this.deliveredSessionId = null;
    this.options.onState(null, null);
    const pending = this.pending;
    if (leaveTicket && ticket && ticket.status !== 'closed') this.departures.set(ticket.ticketId, ticket);
    const leave = this.leaveDepartures();
    // Await stale joins too, before logout replaces the credentials used to leave.
    this.pending = Promise.all([pending.catch(() => undefined), leave])
      .then(() => this.leaveDepartures());
    return this.pending;
  }

  private enqueue(operation: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation;
    const next = this.pending.catch(() => undefined).then(async () => {
      if (generation !== this.generation) return;
      await this.leaveDepartures();
      if (generation === this.generation) await operation(generation);
    });
    this.pending = next;
    return next;
  }

  private async accept(ticket: T, previous: T | null, created: boolean, generation: number): Promise<void> {
    this.ticket = ticket;
    const sessionId = ticket.status === 'matched' ? ticket.matchStart?.sessionId : undefined;
    if (sessionId && (created || (previous?.ticketId === ticket.ticketId && previous.status === 'queued'))) {
      this.freshMatch = { sessionId, previousTicket: previous, created };
    }
    if (!sessionId) this.freshMatch = null;
    if (sessionId && sessionId === this.deliveredSessionId) return;
    this.options.onState(ticket, null);
    if (!sessionId) return;
    const session = await this.options.readSession(sessionId, ticket.accountId);
    if (generation !== this.generation) return;
    this.options.onState(ticket, session);
    const fresh = this.freshMatch?.sessionId === sessionId ? this.freshMatch : null;
    this.options.onMatched(ticket, session, {
      previousTicket: fresh?.previousTicket ?? previous,
      serverCreatedTicket: fresh?.created ?? false,
    });
    if (generation === this.generation) this.deliveredSessionId = sessionId;
  }

  private leaveDepartures(): Promise<void> {
    if (this.departurePending) return this.departurePending;
    const pending = (async () => {
      for (const [id, ticket] of this.departures) {
        await this.options.leave(id, ticket.accountId);
        this.departures.delete(id);
      }
    })();
    this.departurePending = pending.finally(() => { this.departurePending = null; });
    return this.departurePending;
  }
}
