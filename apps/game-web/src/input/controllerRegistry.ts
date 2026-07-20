import {
  detectGamepadFamily,
  type GamepadFamily,
} from './controllerGlyphs';

export interface ControllerGamepadIdentity {
  index: number;
  id: string;
  mapping?: string;
  connected?: boolean;
}

export type ControllerConnectionState = 'connected' | 'disconnected';
export type ControllerRegistryChangeKind = 'connected' | 'disconnected' | 'replaced';

export interface ControllerDeviceState {
  index: number;
  id: string;
  mapping: string;
  family: GamepadFamily;
  connection: ControllerConnectionState;
  connectedAt: number | null;
  disconnectedAt: number | null;
}

export interface ControllerRegistryChange {
  kind: ControllerRegistryChangeKind;
  controller: ControllerDeviceState;
}

export interface ControllerRegistrySnapshot {
  revision: number;
  connectedCount: number;
  controllers: readonly ControllerDeviceState[];
  lastChange: ControllerRegistryChange | null;
}

export type ControllerRegistryListener = (snapshot: ControllerRegistrySnapshot) => void;
export type ControllerGamepadSource = () => ArrayLike<ControllerGamepadIdentity | null> | null;

export interface ControllerHotPlugTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface ControllerRegistryOptions {
  gamepadSource?: ControllerGamepadSource | null;
  eventTarget?: ControllerHotPlugTarget | null;
  now?: () => number;
}

function resolveBrowserGamepadSource(): ControllerGamepadSource | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return null;
  }
  return () => navigator.getGamepads();
}

function resolveBrowserHotPlugTarget(): ControllerHotPlugTarget | null {
  return typeof window === 'undefined'
    ? null
    : window as unknown as ControllerHotPlugTarget;
}

function cloneControllerState(state: ControllerDeviceState): ControllerDeviceState {
  return { ...state };
}

function readGamepadFromEvent(event: Event): ControllerGamepadIdentity | null {
  const gamepad = (event as GamepadEvent).gamepad;
  return gamepad
    ? {
        index: gamepad.index,
        id: gamepad.id,
        mapping: gamepad.mapping,
        connected: gamepad.connected,
      }
    : null;
}

function isUsableControllerIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0;
}

export class ControllerRegistry {
  private readonly controllers = new Map<number, ControllerDeviceState>();
  private readonly listeners = new Set<ControllerRegistryListener>();
  private readonly gamepadSource: ControllerGamepadSource | null;
  private readonly eventTarget: ControllerHotPlugTarget | null;
  private readonly now: () => number;
  private revision = 0;
  private lastChange: ControllerRegistryChange | null = null;
  private started = false;

  private readonly connectedHandler: EventListener = (event) => {
    const gamepad = readGamepadFromEvent(event);
    if (gamepad) {
      this.connect(gamepad);
    }
  };

  private readonly disconnectedHandler: EventListener = (event) => {
    const gamepad = readGamepadFromEvent(event);
    if (gamepad) {
      this.disconnect(gamepad);
    }
  };

  constructor(options: ControllerRegistryOptions = {}) {
    this.gamepadSource = options.gamepadSource === undefined
      ? resolveBrowserGamepadSource()
      : options.gamepadSource;
    this.eventTarget = options.eventTarget === undefined
      ? resolveBrowserHotPlugTarget()
      : options.eventTarget;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.eventTarget?.addEventListener('gamepadconnected', this.connectedHandler);
    this.eventTarget?.addEventListener('gamepaddisconnected', this.disconnectedHandler);
    this.refresh();
  }

  refresh(gamepads?: ArrayLike<ControllerGamepadIdentity | null> | null): void {
    const sampledGamepads = gamepads === undefined ? this.gamepadSource?.() : gamepads;
    if (!sampledGamepads) {
      return;
    }
    const connectedIndices = new Set<number>();
    for (let index = 0; index < sampledGamepads.length; index += 1) {
      const gamepad = sampledGamepads[index];
      if (!gamepad || gamepad.connected === false || !isUsableControllerIndex(gamepad.index)) {
        continue;
      }
      connectedIndices.add(gamepad.index);
      this.connect(gamepad);
    }
    for (const controller of this.controllers.values()) {
      if (controller.connection === 'connected' && !connectedIndices.has(controller.index)) {
        this.disconnect({
          index: controller.index,
          id: controller.id,
          mapping: controller.mapping,
          connected: false,
        });
      }
    }
  }

  connect(gamepad: ControllerGamepadIdentity): void {
    if (!isUsableControllerIndex(gamepad.index)) {
      return;
    }
    const existing = this.controllers.get(gamepad.index);
    const id = gamepad.id.trim() || `Controller ${gamepad.index + 1}`;
    const mapping = String(gamepad.mapping ?? '');
    if (
      existing
      && existing.connection === 'connected'
      && existing.id === id
      && existing.mapping === mapping
    ) {
      return;
    }
    const connectedAt = this.now();
    const state: ControllerDeviceState = {
      index: gamepad.index,
      id,
      mapping,
      family: detectGamepadFamily(id),
      connection: 'connected',
      connectedAt,
      disconnectedAt: null,
    };
    this.controllers.set(gamepad.index, state);
    this.publish(existing?.connection === 'connected' ? 'replaced' : 'connected', state);
  }

  disconnect(gamepad: ControllerGamepadIdentity): void {
    if (!isUsableControllerIndex(gamepad.index)) {
      return;
    }
    const existing = this.controllers.get(gamepad.index);
    if (existing?.connection === 'disconnected') {
      return;
    }
    const id = existing?.id ?? (gamepad.id.trim() || `Controller ${gamepad.index + 1}`);
    const mapping = existing?.mapping ?? String(gamepad.mapping ?? '');
    const state: ControllerDeviceState = {
      index: gamepad.index,
      id,
      mapping,
      family: existing?.family ?? detectGamepadFamily(id),
      connection: 'disconnected',
      connectedAt: existing?.connectedAt ?? null,
      disconnectedAt: this.now(),
    };
    this.controllers.set(gamepad.index, state);
    this.publish('disconnected', state);
  }

  getController(index: number): ControllerDeviceState | null {
    const controller = this.controllers.get(index);
    return controller ? cloneControllerState(controller) : null;
  }

  getConnectedControllers(): ControllerDeviceState[] {
    return [...this.controllers.values()]
      .filter((controller) => controller.connection === 'connected')
      .sort((a, b) => a.index - b.index)
      .map(cloneControllerState);
  }

  getSnapshot(): ControllerRegistrySnapshot {
    const controllers = [...this.controllers.values()]
      .sort((a, b) => a.index - b.index)
      .map(cloneControllerState);
    return {
      revision: this.revision,
      connectedCount: controllers.filter((controller) => controller.connection === 'connected').length,
      controllers,
      lastChange: this.lastChange
        ? {
            kind: this.lastChange.kind,
            controller: cloneControllerState(this.lastChange.controller),
          }
        : null,
    };
  }

  subscribe(listener: ControllerRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.started) {
      this.started = false;
      this.eventTarget?.removeEventListener('gamepadconnected', this.connectedHandler);
      this.eventTarget?.removeEventListener('gamepaddisconnected', this.disconnectedHandler);
    }
    this.listeners.clear();
  }

  private publish(kind: ControllerRegistryChangeKind, controller: ControllerDeviceState): void {
    this.revision += 1;
    this.lastChange = { kind, controller: cloneControllerState(controller) };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createControllerRegistry(options?: ControllerRegistryOptions): ControllerRegistry {
  return new ControllerRegistry(options);
}
