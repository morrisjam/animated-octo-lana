import { describe, expect, test } from 'vitest';
import {
  decideMatchedTicketBootstrap,
  installOnlineSessionLifecycleListeners,
  OnlineSessionLifecycleController,
  resolveGameplayPauseRequest,
  shouldRecoverForPeerPresence,
  type OnlineSessionLifecycleEvent,
  type OnlineSessionLifecycleTarget,
} from './onlineSessionLifecycle';
import type { SessionHeartbeatLoopOptions } from './sessionHeartbeat';

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeHeartbeatLoop {
  private running = false;

  private inFlight = false;

  public constructor(private readonly options: SessionHeartbeatLoopOptions) {}

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.pulse();
  }

  public stop(): void {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async pulse(): Promise<void> {
    if (!this.running || this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      await this.options.heartbeat();
    } catch (error) {
      if (this.running) {
        this.options.onError?.(error);
      }
    } finally {
      this.inFlight = false;
    }
  }
}

function createTarget(sessionId = 'session-1'): OnlineSessionLifecycleTarget {
  return {
    sessionId,
    sessionToken: `token-${sessionId}`,
    localAccountId: `account-${sessionId}`,
    intervalMs: 5_000,
  };
}

describe('OnlineSessionLifecycleController', () => {
  test('deduplicates suspend/resume events and restarts heartbeat after reconnect', async () => {
    let heartbeatCalls = 0;
    let disconnectCalls = 0;
    let reconnectCalls = 0;
    const events: OnlineSessionLifecycleEvent[] = [];
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => { heartbeatCalls += 1; },
      disconnect: async () => { disconnectCalls += 1; },
      reconnect: async () => { reconnectCalls += 1; },
      isDisconnectedError: () => false,
      onEvent: (event) => events.push(event),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });

    controller.start(createTarget());
    await flushAsync();
    expect(heartbeatCalls).toBe(1);

    await Promise.all([
      controller.suspend('visibility_hidden'),
      controller.suspend('pagehide'),
    ]);
    expect(disconnectCalls).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'suspended',
      disconnectConfirmed: true,
      heartbeatRunning: false,
    });

    await Promise.all([
      controller.resume('visibility_visible'),
      controller.resume('visibility_visible'),
    ]);
    await flushAsync();
    expect(reconnectCalls).toBe(1);
    expect(heartbeatCalls).toBe(2);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      disconnectConfirmed: false,
      heartbeatRunning: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      'suspended',
      'reconnecting',
      'resumed',
    ]);
  });

  test('serializes an immediate resume behind an in-flight disconnect', async () => {
    const disconnect = deferred();
    let reconnectCalls = 0;
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => undefined,
      disconnect: async () => disconnect.promise,
      reconnect: async () => { reconnectCalls += 1; },
      isDisconnectedError: () => false,
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget());

    const suspend = controller.suspend('visibility_hidden');
    const resume = controller.resume('visibility_visible');
    await flushAsync();
    expect(controller.getSnapshot().phase).toBe('suspending');
    disconnect.resolve();
    await Promise.all([suspend, resume]);

    expect(reconnectCalls).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      desiredSuspended: false,
      heartbeatRunning: true,
    });
  });

  test('retries a transient reconnect failure while the page remains visible', async () => {
    const transientFailure = new Error('temporary reconnect outage');
    const events: OnlineSessionLifecycleEvent[] = [];
    const errors: unknown[] = [];
    const retryDelays: number[] = [];
    let reconnectCalls = 0;
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => undefined,
      disconnect: async () => undefined,
      reconnect: async () => {
        reconnectCalls += 1;
        if (reconnectCalls === 1) {
          throw transientFailure;
        }
      },
      isDisconnectedError: () => false,
      reconnectMaxAttempts: 3,
      reconnectRetryDelayMs: 250,
      isRetryableReconnectError: (error) => error === transientFailure,
      waitForReconnectRetry: async (milliseconds) => { retryDelays.push(milliseconds); },
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget());

    await controller.suspend('visibility_hidden');
    await controller.resume('visibility_visible');

    expect(reconnectCalls).toBe(2);
    expect(retryDelays).toEqual([250]);
    expect(errors).toEqual([]);
    expect(events.map((event) => event.type)).toEqual([
      'suspended',
      'reconnecting',
      'resumed',
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      disconnectConfirmed: false,
      heartbeatRunning: true,
    });
  });

  test('abandons a reconnect retry after a replacement session starts', async () => {
    const transientFailure = new Error('temporary reconnect outage');
    const retryGate = deferred();
    const reconnectSessions: string[] = [];
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => undefined,
      disconnect: async () => undefined,
      reconnect: async (target) => {
        reconnectSessions.push(target.sessionId);
        throw transientFailure;
      },
      isDisconnectedError: () => false,
      reconnectMaxAttempts: 3,
      reconnectRetryDelayMs: 250,
      isRetryableReconnectError: (error) => error === transientFailure,
      waitForReconnectRetry: async () => retryGate.promise,
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget('session-old'));
    await controller.suspend('visibility_hidden');
    const staleResume = controller.resume('visibility_visible');
    await flushAsync();

    controller.start(createTarget('session-new'));
    retryGate.resolve();
    await staleResume;

    expect(reconnectSessions).toEqual(['session-old']);
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: 'session-new',
      phase: 'active',
      heartbeatRunning: true,
    });
  });

  test('reports one terminal error after transient reconnect retries are exhausted', async () => {
    const transientFailure = new Error('reconnect service unavailable');
    const errors: Array<{ phase: string; error: unknown }> = [];
    const retryDelays: number[] = [];
    let reconnectCalls = 0;
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => undefined,
      disconnect: async () => undefined,
      reconnect: async () => {
        reconnectCalls += 1;
        throw transientFailure;
      },
      isDisconnectedError: () => false,
      reconnectMaxAttempts: 3,
      reconnectRetryDelayMs: 200,
      isRetryableReconnectError: (error) => error === transientFailure,
      waitForReconnectRetry: async (milliseconds) => { retryDelays.push(milliseconds); },
      onError: (error) => errors.push(error),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget());

    await controller.suspend('visibility_hidden');
    await controller.resume('visibility_visible');

    expect(reconnectCalls).toBe(3);
    expect(retryDelays).toEqual([200, 400]);
    expect(errors).toEqual([{
      phase: 'reconnect',
      source: 'visibility_visible',
      target: expect.any(Object),
      error: transientFailure,
    }]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'suspended',
      disconnectConfirmed: true,
      heartbeatRunning: false,
    });
  });

  test('lets a queued pagehide retry a failed visibility disconnect', async () => {
    let disconnectCalls = 0;
    const errors: Array<{ phase: string; error: unknown }> = [];
    const events: OnlineSessionLifecycleEvent[] = [];
    const firstFailure = new Error('visibility request cancelled');
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => undefined,
      disconnect: async () => {
        disconnectCalls += 1;
        if (disconnectCalls === 1) {
          throw firstFailure;
        }
      },
      reconnect: async () => undefined,
      isDisconnectedError: () => false,
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget());

    await Promise.all([
      controller.suspend('visibility_hidden'),
      controller.suspend('pagehide'),
    ]);

    expect(disconnectCalls).toBe(2);
    expect(errors).toEqual([{ phase: 'disconnect', source: 'visibility_hidden', target: expect.any(Object), error: firstFailure }]);
    expect(events.map((event) => `${event.type}:${event.source}`)).toEqual(['suspended:pagehide']);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'suspended',
      disconnectConfirmed: true,
      heartbeatRunning: false,
    });
  });

  test('ignores stale disconnect completion after a replacement session starts', async () => {
    const disconnect = deferred();
    const events: OnlineSessionLifecycleEvent[] = [];
    const heartbeatSessions: string[] = [];
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async (target) => { heartbeatSessions.push(target.sessionId); },
      disconnect: async () => disconnect.promise,
      reconnect: async () => undefined,
      isDisconnectedError: () => false,
      onEvent: (event) => events.push(event),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget('session-old'));
    const staleSuspend = controller.suspend('visibility_hidden');
    await flushAsync();

    controller.start(createTarget('session-new'));
    disconnect.resolve();
    await staleSuspend;
    await flushAsync();

    expect(controller.getSnapshot()).toMatchObject({
      sessionId: 'session-new',
      phase: 'active',
      heartbeatRunning: true,
    });
    expect(events).toEqual([]);
    expect(heartbeatSessions).toContain('session-new');
  });

  test('recovers a server-detected heartbeat timeout with a nonce reconnect', async () => {
    const disconnected = new Error('participant disconnected');
    let heartbeatCalls = 0;
    const reconnectSources: string[] = [];
    const events: OnlineSessionLifecycleEvent[] = [];
    const errors: unknown[] = [];
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => {
        heartbeatCalls += 1;
        if (heartbeatCalls === 1) {
          throw disconnected;
        }
      },
      disconnect: async () => undefined,
      reconnect: async (_target, source) => { reconnectSources.push(source); },
      isDisconnectedError: (error) => error === disconnected,
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });

    controller.start(createTarget());
    await flushAsync();
    await flushAsync();

    expect(reconnectSources).toEqual(['heartbeat_timeout']);
    expect(events.map((event) => event.type)).toEqual([
      'reconnecting',
      'heartbeat_recovered',
    ]);
    expect(errors).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', heartbeatRunning: true });
  });

  test('reports reconnect failures and remains suspended', async () => {
    const failure = new Error('reconnect unavailable');
    const events: OnlineSessionLifecycleEvent[] = [];
    const errors: Array<{ phase: string; error: unknown }> = [];
    let reconnectCalls = 0;
    let retryWaits = 0;
    const controller = new OnlineSessionLifecycleController({
      heartbeat: async () => undefined,
      disconnect: async () => undefined,
      reconnect: async () => {
        reconnectCalls += 1;
        throw failure;
      },
      isDisconnectedError: () => false,
      reconnectMaxAttempts: 3,
      reconnectRetryDelayMs: 250,
      isRetryableReconnectError: () => false,
      waitForReconnectRetry: async () => { retryWaits += 1; },
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
      createHeartbeatLoop: (options) => new FakeHeartbeatLoop(options),
    });
    controller.start(createTarget());
    await controller.suspend('visibility_hidden');
    await controller.resume('visibility_visible');

    expect(events.map((event) => event.type)).toEqual(['suspended', 'reconnecting']);
    expect(reconnectCalls).toBe(1);
    expect(retryWaits).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ phase: 'reconnect', error: failure });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'suspended',
      disconnectConfirmed: true,
      heartbeatRunning: false,
    });
  });
});

class FakeLifecycleEventTarget {
  public visibilityState: DocumentVisibilityState = 'visible';

  private readonly listeners = new Map<string, Set<() => void>>();

  public addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

test('browser lifecycle listeners route visibility and pagehide events and dispose cleanly', async () => {
  const documentTarget = new FakeLifecycleEventTarget();
  const windowTarget = new FakeLifecycleEventTarget();
  const calls: string[] = [];
  const dispose = installOnlineSessionLifecycleListeners({
    controller: {
      suspend: async (source) => { calls.push(`suspend:${source}`); },
      resume: async (source) => { calls.push(`resume:${source}`); },
    },
    canManage: () => true,
    documentTarget,
    windowTarget,
  });

  documentTarget.visibilityState = 'hidden';
  documentTarget.emit('visibilitychange');
  windowTarget.emit('pagehide');
  documentTarget.visibilityState = 'visible';
  documentTarget.emit('visibilitychange');
  windowTarget.emit('pageshow');
  await flushAsync();
  expect(calls).toEqual([
    'suspend:visibility_hidden',
    'suspend:pagehide',
    'resume:visibility_visible',
    'resume:visibility_visible',
  ]);

  dispose();
  documentTarget.emit('visibilitychange');
  windowTarget.emit('pagehide');
  windowTarget.emit('pageshow');
  expect(calls).toHaveLength(4);
});

describe('online client lifecycle policies', () => {
  test('turns online pause into a non-pausing status response', () => {
    expect(resolveGameplayPauseRequest(true)).toMatchObject({
      togglePause: false,
      forceUnpaused: true,
      resetAccumulator: false,
      statusText: expect.stringContaining('continues in real time'),
    });
    expect(resolveGameplayPauseRequest(false)).toMatchObject({
      togglePause: true,
      resetAccumulator: true,
    });
  });

  test('fails closed for an already matched ticket without a verified checkpoint', () => {
    const matched = {
      ticketId: 'ticket-1',
      status: 'matched' as const,
      sessionId: 'session-1',
    };
    expect(decideMatchedTicketBootstrap({
      previousTicket: null,
      currentTicket: matched,
      sessionStatus: 'active',
    })).toBe('resume_or_rejoin');
    expect(decideMatchedTicketBootstrap({
      previousTicket: { ...matched, status: 'queued', sessionId: null },
      currentTicket: matched,
      sessionStatus: 'active',
    })).toBe('start_fresh');
    expect(decideMatchedTicketBootstrap({
      previousTicket: null,
      currentTicket: matched,
      sessionStatus: 'active',
      hasVerifiedCheckpoint: true,
    })).toBe('restore_checkpoint');
    expect(decideMatchedTicketBootstrap({
      previousTicket: {
        ticketId: 'closed-ticket',
        status: 'closed',
        sessionId: 'old-session',
      },
      currentTicket: matched,
      sessionStatus: 'active',
      serverCreatedTicket: true,
    })).toBe('start_fresh');
  });

  test('lets either connected side react to a peer-disconnected presence snapshot', () => {
    expect(shouldRecoverForPeerPresence({
      localSide: 'P1',
      peerConnectionStatus: 'disconnected',
      transportState: 'connected',
    })).toBe(true);
    expect(shouldRecoverForPeerPresence({
      localSide: 'P2',
      peerConnectionStatus: 'disconnected',
      transportState: 'connected',
    })).toBe(true);
    expect(shouldRecoverForPeerPresence({
      localSide: 'P1',
      peerConnectionStatus: 'disconnected',
      transportState: 'reconnecting',
    })).toBe(false);
  });
});
