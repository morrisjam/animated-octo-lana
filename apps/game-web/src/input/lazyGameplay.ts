import type { FrameInput } from '../sim/types';
import type { InputBindingStore } from './bindings';
import type { FrameInputSource } from './combined';
import { createEmptyFrameInput } from './frame';

export class LazyGameplayInput implements FrameInputSource {
  private readonly emptyInput = createEmptyFrameInput();
  private delegate: FrameInputSource | null = null;
  private disposed = false;

  constructor(target: HTMLElement, bindingStore: InputBindingStore) {
    void import('./gameplay')
      .then(({ createGameplayInput }) => {
        if (!this.disposed) {
          this.delegate = createGameplayInput(target, bindingStore);
        }
      })
      .catch((error: unknown) => {
        console.error('[input] Gameplay controls failed to load.', error);
      });
  }

  getFrameInput(): FrameInput {
    return this.delegate?.getFrameInput() ?? this.emptyInput;
  }

  dispose(): void {
    this.disposed = true;
    this.delegate?.dispose?.();
  }
}

export function createLazyGameplayInput(
  target: HTMLElement,
  bindingStore: InputBindingStore,
): LazyGameplayInput {
  return new LazyGameplayInput(target, bindingStore);
}
