import type { FrameInput, PlayerFrameInput } from '../sim/types';
import type { ButtonPlayerBindings, InputBindingStore } from './bindings';
import { GAMEPLAY_ACTIONS } from './bindings';
import { createEmptyFrameInput } from './frame';

export function mapMouseButtonsToPlayerInput(
  buttons: ReadonlySet<number>,
  bindings: ButtonPlayerBindings,
  output: PlayerFrameInput,
): void {
  output.moveX = 0;
  output.moveY = 0;
  for (const action of GAMEPLAY_ACTIONS) {
    const button = bindings[action];
    output[action] = button !== null && buttons.has(button);
  }
}

export class MouseInput {
  private readonly buttons = new Set<number>();
  private readonly frameInput = createEmptyFrameInput();

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.target !== this.target) {
      return;
    }
    this.buttons.add(event.button);
    if (this.isButtonBound(event.button)) {
      event.preventDefault();
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.buttons.delete(event.button);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (event.target === this.target && this.isButtonBound(2)) {
      event.preventDefault();
    }
  };

  private readonly clearButtons = (): void => {
    this.buttons.clear();
  };

  constructor(
    private readonly target: HTMLElement,
    private readonly bindingStore: InputBindingStore,
  ) {
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.clearButtons);
  }

  dispose(): void {
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.clearButtons);
  }

  getFrameInput(): FrameInput {
    const bindings = this.bindingStore.getProfile().mouse;
    mapMouseButtonsToPlayerInput(this.buttons, bindings.P1, this.frameInput.p1);
    mapMouseButtonsToPlayerInput(this.buttons, bindings.P2, this.frameInput.p2);
    return this.frameInput;
  }

  private isButtonBound(button: number): boolean {
    const bindings = this.bindingStore.getProfile().mouse;
    return GAMEPLAY_ACTIONS.some(
      (action) => bindings.P1[action] === button || bindings.P2[action] === button,
    );
  }
}

export function createMouseInput(target: HTMLElement, bindingStore: InputBindingStore): MouseInput {
  return new MouseInput(target, bindingStore);
}
