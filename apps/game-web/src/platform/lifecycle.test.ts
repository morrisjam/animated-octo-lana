import { describe, expect, test } from 'vitest';
import {
  createBrowserPlatformLifecycleAdapter,
  createPlatformLifecycleTestFake,
} from './lifecycle';

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event = { type } as Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeDocument extends FakeEventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

describe('platform lifecycle service', () => {
  test('publishes stateful platform events and suppresses duplicate state transitions', () => {
    const fake = createPlatformLifecycleTestFake({
      now: () => new Date('2026-07-20T12:00:00.000Z'),
    });

    fake.hooks.suspend();
    fake.hooks.suspend();
    fake.hooks.resume();
    fake.hooks.userChanged('user-a');
    fake.hooks.userChanged('user-a');
    fake.hooks.entitlementChanged('user-a', {
      allowed: true,
      status: 'granted',
      code: 'owned',
      message: 'Access granted.',
    });
    fake.hooks.controllerDisconnected(2, 'Standard Controller');

    expect(fake.events.map((event) => event.type)).toEqual([
      'suspend',
      'resume',
      'user_change',
      'entitlement_change',
      'controller_disconnect',
    ]);
    expect(fake.events[4]).toMatchObject({
      controllerIndex: 2,
      userId: 'user-a',
      occurredAt: '2026-07-20T12:00:00.000Z',
      sequence: 5,
    });
    expect(fake.service.getState()).toMatchObject({
      status: 'active',
      activeUserId: 'user-a',
      sequence: 5,
      entitlement: { allowed: true, code: 'owned' },
    });
    fake.dispose();
  });

  test('supports unsubscribe and deterministic event reset in tests', () => {
    const fake = createPlatformLifecycleTestFake();
    const received: string[] = [];
    const unsubscribe = fake.service.subscribe((event) => received.push(event.type));
    fake.hooks.userChanged('user-a');
    unsubscribe();
    fake.hooks.suspend();
    expect(received).toEqual(['user_change']);
    expect(fake.events).toHaveLength(2);
    fake.clearEvents();
    expect(fake.events).toHaveLength(0);
    fake.dispose();
  });
});

describe('browser lifecycle adapter', () => {
  test('maps browser visibility, page, and gamepad hooks to platform events', () => {
    const fakeDocument = new FakeDocument();
    const fakeWindow = new FakeEventTarget();
    const adapter = createBrowserPlatformLifecycleAdapter({
      document: fakeDocument,
      window: fakeWindow,
    });
    const events: string[] = [];
    adapter.service.subscribe((event) => events.push(event.type));

    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');
    fakeWindow.dispatch('pagehide');
    fakeWindow.dispatch('pageshow');
    fakeWindow.dispatch('gamepaddisconnected', {
      type: 'gamepaddisconnected',
      gamepad: { index: 1, id: 'Xbox Controller' },
    } as unknown as Event);

    expect(events).toEqual(['suspend', 'resume', 'controller_disconnect']);
    adapter.dispose();
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');
    expect(events).toHaveLength(3);
  });
});
