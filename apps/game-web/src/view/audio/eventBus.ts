import type { AudioEvent } from './types';

export type AudioEventListener = (event: AudioEvent) => void;

export interface AudioEventBus {
  emit(event: AudioEvent): void;
  subscribe(listener: AudioEventListener): () => void;
}

export function createAudioEventBus(): AudioEventBus {
  const listeners = new Set<AudioEventListener>();
  return {
    emit(event: AudioEvent): void {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener: AudioEventListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

