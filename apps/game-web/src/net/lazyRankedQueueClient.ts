interface QueueActions {
  join(accountId: string): Promise<void>;
  refresh(accountId: string): Promise<void>;
  cancel(leaveTicket?: boolean): Promise<void>;
}

export function createLazyRankedQueueClient(load: () => Promise<QueueActions>): QueueActions {
  let client: QueueActions | null = null;
  let loading: Promise<QueueActions> | null = null;
  let generation = 0;

  async function run(action: 'join' | 'refresh', accountId: string): Promise<void> {
    const requestedGeneration = generation;
    const delegate = client ?? await (loading ??= load().then((loaded) => {
      client = loaded;
      return loaded;
    }).catch((error: unknown) => {
      loading = null;
      throw error;
    }));
    // Leaving during chunk loading must never create a ticket with stale credentials.
    if (requestedGeneration === generation) await delegate[action](accountId);
  }

  return {
    join: (accountId) => run('join', accountId),
    refresh: (accountId) => run('refresh', accountId),
    cancel: (leaveTicket = true) => {
      generation += 1;
      return client?.cancel(leaveTicket) ?? Promise.resolve();
    },
  };
}
