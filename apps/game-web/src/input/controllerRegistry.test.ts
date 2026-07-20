import { describe, expect, test } from 'vitest';
import {
  ControllerRegistry,
  type ControllerGamepadIdentity,
  type ControllerHotPlugTarget,
} from './controllerRegistry';

class FakeHotPlugTarget implements ControllerHotPlugTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, gamepad: ControllerGamepadIdentity): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ gamepad } as unknown as Event);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function controller(index: number, id: string, connected = true): ControllerGamepadIdentity {
  return { index, id, connected, mapping: 'standard' };
}

describe('controller registry', () => {
  test('captures controllers already connected before listeners start', () => {
    const registry = new ControllerRegistry({
      gamepadSource: () => [controller(0, 'Xbox Wireless Controller')],
      eventTarget: null,
      now: () => 100,
    });

    registry.start();

    expect(registry.getSnapshot()).toMatchObject({
      revision: 1,
      connectedCount: 1,
      controllers: [{ index: 0, family: 'xbox', connection: 'connected', connectedAt: 100 }],
    });
  });

  test('tracks hot-plug connection, replacement, and disconnection events', () => {
    let now = 10;
    const target = new FakeHotPlugTarget();
    const changes: string[] = [];
    const registry = new ControllerRegistry({
      gamepadSource: () => [],
      eventTarget: target,
      now: () => now,
    });
    registry.subscribe((snapshot) => changes.push(snapshot.lastChange?.kind ?? 'none'));
    registry.start();

    target.dispatch('gamepadconnected', controller(1, 'DualSense Wireless Controller'));
    now = 20;
    target.dispatch('gamepadconnected', controller(1, 'Nintendo Switch Pro Controller'));
    now = 30;
    target.dispatch('gamepaddisconnected', controller(1, 'Nintendo Switch Pro Controller', false));

    expect(changes).toEqual(['connected', 'replaced', 'disconnected']);
    expect(registry.getController(1)).toMatchObject({
      family: 'nintendo',
      connection: 'disconnected',
      connectedAt: 20,
      disconnectedAt: 30,
    });
    registry.dispose();
    expect(target.listenerCount('gamepadconnected')).toBe(0);
  });

  test('reconciles controllers missed while the page was backgrounded', () => {
    const registry = new ControllerRegistry({ gamepadSource: null, eventTarget: null });
    registry.refresh([
      controller(0, 'Xbox Wireless Controller'),
      controller(2, 'Generic USB Pad'),
    ]);
    registry.refresh([controller(2, 'Generic USB Pad')]);

    expect(registry.getSnapshot()).toMatchObject({
      connectedCount: 1,
      controllers: [
        { index: 0, connection: 'disconnected' },
        { index: 2, connection: 'connected' },
      ],
    });
  });

  test('clears subscribers even when disposed before browser listeners start', () => {
    const registry = new ControllerRegistry({ gamepadSource: null, eventTarget: null });
    let updateCount = 0;
    registry.subscribe(() => {
      updateCount += 1;
    });

    registry.dispose();
    registry.connect(controller(0, 'Xbox Wireless Controller'));

    expect(updateCount).toBe(0);
  });
});
