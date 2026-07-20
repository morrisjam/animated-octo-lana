import { detectGamepadFamily, type GamepadFamily } from '../../input/controllerGlyphs';
import {
  createControllerOwnership,
  type ControllerAssignments,
  type ControllerPlayerSlot,
} from '../../input/controllerOwnership';
import { createControllerRegistry } from '../../input/controllerRegistry';
import {
  createControllerLossMessage,
  createControllerRecoveredMessage,
  type ControllerRecoveryMessage,
} from './recoveryMessage';
import {
  ControllerNavigationRepeater,
  resolveControllerNavigationSample,
  type ControllerNavigationAction,
} from './navigation';
import { applySafeAreaPreference } from './safeArea';

export interface BrowserControllerRuntimeOptions {
  onRecoveryMessage?(message: ControllerRecoveryMessage): void;
  onControllerDisconnected?(controllerIndex: number, controllerId: string): void;
}

export interface BrowserControllerRuntime {
  getMenuGamepad(): Gamepad | null;
  getMenuGamepadActions(gamepad: Gamepad, nowMs: number): readonly ControllerNavigationAction[];
  recordActivity(gamepad: Gamepad): void;
  getAssignments(): ControllerAssignments;
  getPlayerFamily(player: ControllerPlayerSlot): GamepadFamily;
  refresh(): void;
  dispose(): void;
}

function getBrowserGamepad(index: number | null): Gamepad | null {
  if (index === null || typeof navigator.getGamepads !== 'function') {
    return null;
  }
  return navigator.getGamepads()[index] ?? null;
}

export function createBrowserControllerRuntime(
  options: BrowserControllerRuntimeOptions = {},
): BrowserControllerRuntime {
  const registry = createControllerRegistry();
  const ownership = createControllerOwnership();
  const navigationRepeater = new ControllerNavigationRepeater();
  let navigationControllerIndex: number | null = null;
  let recoveryPending = false;

  const applySafeArea = (): void => {
    applySafeAreaPreference(document.documentElement.style, {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preference: 'comfortable',
    });
  };

  const disposeRegistrySubscription = registry.subscribe((snapshot) => {
    const change = snapshot.lastChange;
    if (!change) {
      return;
    }
    const controller = change.controller;
    if (change.kind === 'disconnected') {
      const result = ownership.disconnect(controller.index);
      recoveryPending = recoveryPending || result.lostPlayers.length > 0;
      options.onControllerDisconnected?.(controller.index, controller.id);
      options.onRecoveryMessage?.(createControllerLossMessage({
        family: controller.family,
        lostPlayers: result.lostPlayers,
        replacementControllerCount: snapshot.connectedCount,
        keyboardAvailable: true,
      }));
      return;
    }

    ownership.connect(controller.index);
    const player = ownership.claimAvailablePlayer(controller.index);
    if (recoveryPending) {
      recoveryPending = false;
      options.onRecoveryMessage?.(createControllerRecoveredMessage(player, controller.family));
    }
  });

  applySafeArea();
  window.addEventListener('resize', applySafeArea);
  registry.start();

  return {
    getMenuGamepad(): Gamepad | null {
      const active = ownership.getState().activeControllerIndex;
      return getBrowserGamepad(active)
        ?? registry.getConnectedControllers()
          .map((controller) => getBrowserGamepad(controller.index))
          .find((gamepad): gamepad is Gamepad => gamepad !== null)
        ?? null;
    },
    getMenuGamepadActions(gamepad: Gamepad, nowMs: number): readonly ControllerNavigationAction[] {
      if (navigationControllerIndex !== gamepad.index) {
        navigationControllerIndex = gamepad.index;
        navigationRepeater.reset();
      }
      return navigationRepeater.poll(
        resolveControllerNavigationSample(gamepad, detectGamepadFamily(gamepad.id)),
        nowMs,
      );
    },
    recordActivity(gamepad: Gamepad): void {
      registry.connect(gamepad);
      ownership.connect(gamepad.index);
      ownership.claimAvailablePlayer(gamepad.index);
      ownership.recordActivity(gamepad.index);
    },
    getAssignments(): ControllerAssignments {
      return { ...ownership.getState().assignments };
    },
    getPlayerFamily(player: ControllerPlayerSlot): GamepadFamily {
      const index = ownership.getState().assignments[player];
      const controller = index === null ? null : registry.getController(index);
      return controller?.family ?? detectGamepadFamily('generic');
    },
    refresh(): void {
      registry.refresh();
    },
    dispose(): void {
      navigationRepeater.reset();
      disposeRegistrySubscription();
      registry.dispose();
      window.removeEventListener('resize', applySafeArea);
    },
  };
}
