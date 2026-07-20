import type {
  PlatformEntitlementAccess,
  PlatformLifecycleEvent,
  PlatformLifecycleHooks,
  PlatformLifecycleListener,
  PlatformLifecycleService,
  PlatformLifecycleState,
  PlatformLifecycleStatus,
  PlatformResumeReason,
  PlatformSuspendReason,
} from './types';

export interface PlatformLifecycleAdapter {
  service: PlatformLifecycleService;
  hooks: PlatformLifecycleHooks;
  dispose(): void;
}

export interface PlatformLifecycleAdapterOptions {
  initialStatus?: PlatformLifecycleStatus;
  initialUserId?: string | null;
  initialEntitlementAccountId?: string | null;
  initialEntitlement?: PlatformEntitlementAccess | null;
  now?: () => Date;
}

interface BrowserLifecycleEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface BrowserLifecycleDocument extends BrowserLifecycleEventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

export interface BrowserLifecycleAdapterOptions extends PlatformLifecycleAdapterOptions {
  document?: BrowserLifecycleDocument | null;
  window?: BrowserLifecycleEventTarget | null;
}

export interface PlatformLifecycleTestFake extends PlatformLifecycleAdapter {
  readonly events: readonly PlatformLifecycleEvent[];
  clearEvents(): void;
}

type LifecycleEventInput<T extends PlatformLifecycleEvent = PlatformLifecycleEvent> =
  T extends PlatformLifecycleEvent ? Omit<T, 'occurredAt' | 'sequence'> : never;

function sameEntitlement(
  left: PlatformEntitlementAccess | null,
  right: PlatformEntitlementAccess,
): boolean {
  return left?.allowed === right.allowed
    && left.status === right.status
    && left.code === right.code
    && left.message === right.message;
}

function copyEvent(event: PlatformLifecycleEvent): PlatformLifecycleEvent {
  if (event.type === 'entitlement_change') {
    return {
      ...event,
      previous: event.previous ? { ...event.previous } : null,
      current: { ...event.current },
    };
  }
  return { ...event };
}

function copyState(state: PlatformLifecycleState): PlatformLifecycleState {
  return {
    ...state,
    entitlement: state.entitlement ? { ...state.entitlement } : null,
    lastEvent: state.lastEvent ? copyEvent(state.lastEvent) : null,
  };
}

export function createPlatformLifecycleAdapter(
  options: PlatformLifecycleAdapterOptions = {},
): PlatformLifecycleAdapter {
  const listeners = new Set<PlatformLifecycleListener>();
  const now = options.now ?? (() => new Date());
  let disposed = false;
  let state: PlatformLifecycleState = {
    status: options.initialStatus ?? 'active',
    activeUserId: options.initialUserId ?? null,
    entitlementAccountId: options.initialEntitlementAccountId ?? null,
    entitlement: options.initialEntitlement ? { ...options.initialEntitlement } : null,
    sequence: 0,
    lastEvent: null,
  };

  function publish(event: LifecycleEventInput): void {
    if (disposed) {
      return;
    }
    const nextEvent = {
      ...event,
      occurredAt: now().toISOString(),
      sequence: state.sequence + 1,
    } as PlatformLifecycleEvent;
    state = {
      ...state,
      sequence: nextEvent.sequence,
      lastEvent: nextEvent,
    };
    for (const listener of [...listeners]) {
      listener(copyEvent(nextEvent), copyState(state));
    }
  }

  const hooks: PlatformLifecycleHooks = {
    suspend(reason: PlatformSuspendReason = 'platform'): void {
      if (state.status === 'suspended') {
        return;
      }
      state = { ...state, status: 'suspended' };
      publish({ type: 'suspend', reason });
    },
    resume(reason: PlatformResumeReason = 'platform'): void {
      if (state.status === 'active') {
        return;
      }
      state = { ...state, status: 'active' };
      publish({ type: 'resume', reason });
    },
    userChanged(currentUserId: string | null): void {
      const normalisedUserId = currentUserId?.trim() || null;
      if (state.activeUserId === normalisedUserId) {
        return;
      }
      const previousUserId = state.activeUserId;
      state = { ...state, activeUserId: normalisedUserId };
      publish({
        type: 'user_change',
        previousUserId,
        currentUserId: normalisedUserId,
      });
    },
    entitlementChanged(accountId: string | null, access: PlatformEntitlementAccess): void {
      const normalisedAccountId = accountId?.trim() || null;
      if (state.entitlementAccountId === normalisedAccountId && sameEntitlement(state.entitlement, access)) {
        return;
      }
      const previous = state.entitlement ? { ...state.entitlement } : null;
      state = {
        ...state,
        entitlementAccountId: normalisedAccountId,
        entitlement: { ...access },
      };
      publish({
        type: 'entitlement_change',
        accountId: normalisedAccountId,
        previous,
        current: { ...access },
      });
    },
    controllerDisconnected(controllerIndex: number, controllerId: string, userId?: string | null): void {
      publish({
        type: 'controller_disconnect',
        controllerIndex,
        controllerId: controllerId.trim(),
        userId: userId === undefined ? state.activeUserId : userId?.trim() || null,
      });
    },
  };

  return {
    service: {
      getState(): PlatformLifecycleState {
        return copyState(state);
      },
      subscribe(listener: PlatformLifecycleListener): () => void {
        if (disposed) {
          return () => undefined;
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    hooks,
    dispose(): void {
      disposed = true;
      listeners.clear();
    },
  };
}

export function createBrowserPlatformLifecycleAdapter(
  options: BrowserLifecycleAdapterOptions = {},
): PlatformLifecycleAdapter {
  const browserDocument = options.document === undefined
    ? (typeof document === 'undefined' ? null : document)
    : options.document;
  const browserWindow = options.window === undefined
    ? (typeof window === 'undefined' ? null : window)
    : options.window;
  const adapter = createPlatformLifecycleAdapter({
    ...options,
    initialStatus: options.initialStatus
      ?? (browserDocument?.visibilityState === 'hidden' ? 'suspended' : 'active'),
  });

  const onVisibilityChange: EventListener = () => {
    if (browserDocument?.visibilityState === 'hidden') {
      adapter.hooks.suspend('visibility_hidden');
    } else {
      adapter.hooks.resume('visibility_visible');
    }
  };
  const onPageHide: EventListener = () => adapter.hooks.suspend('page_hidden');
  const onPageShow: EventListener = () => adapter.hooks.resume('page_shown');
  const onGamepadDisconnected: EventListener = (event) => {
    const gamepad = (event as GamepadEvent).gamepad;
    if (!gamepad) {
      return;
    }
    adapter.hooks.controllerDisconnected(gamepad.index, gamepad.id);
  };

  browserDocument?.addEventListener('visibilitychange', onVisibilityChange);
  browserWindow?.addEventListener('pagehide', onPageHide);
  browserWindow?.addEventListener('pageshow', onPageShow);
  browserWindow?.addEventListener('gamepaddisconnected', onGamepadDisconnected);

  return {
    service: adapter.service,
    hooks: adapter.hooks,
    dispose(): void {
      browserDocument?.removeEventListener('visibilitychange', onVisibilityChange);
      browserWindow?.removeEventListener('pagehide', onPageHide);
      browserWindow?.removeEventListener('pageshow', onPageShow);
      browserWindow?.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      adapter.dispose();
    },
  };
}

export function createPlatformLifecycleTestFake(
  options: PlatformLifecycleAdapterOptions = {},
): PlatformLifecycleTestFake {
  const adapter = createPlatformLifecycleAdapter(options);
  const events: PlatformLifecycleEvent[] = [];
  const unsubscribe = adapter.service.subscribe((event) => events.push(copyEvent(event)));

  return {
    ...adapter,
    events,
    clearEvents(): void {
      events.length = 0;
    },
    dispose(): void {
      unsubscribe();
      adapter.dispose();
    },
  };
}
