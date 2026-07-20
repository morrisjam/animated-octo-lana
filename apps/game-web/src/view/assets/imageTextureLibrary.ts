import * as THREE from 'three';
import type { AssetFileEntry } from './types';

export type ImageTextureLibraryStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'disposed';

export interface ImageTextureLibrary {
  status: ImageTextureLibraryStatus;
  loadedIds: string[];
  errorMessage: string | null;
}

export interface ImageTextureLibrarySnapshot {
  status: ImageTextureLibraryStatus;
  loadedIds: string[];
  errorMessage: string | null;
}

export type ImageTextureAssetLoader = (entry: AssetFileEntry) => Promise<THREE.Texture>;

export interface ImageTextureLoadOptions {
  loadEntry?: ImageTextureAssetLoader;
}

interface ImageTextureLibraryState {
  entries: AssetFileEntry[];
  texturesById: Map<string, THREE.Texture>;
  loadPromise: Promise<ImageTextureLibrarySnapshot> | null;
  disposed: boolean;
}

const LIBRARY_STATE = new WeakMap<ImageTextureLibrary, ImageTextureLibraryState>();

function stateFor(library: ImageTextureLibrary): ImageTextureLibraryState {
  const state = LIBRARY_STATE.get(library);
  if (!state) {
    throw new Error('Unknown image texture library.');
  }
  return state;
}

function normaliseTexture(texture: THREE.Texture, entry: AssetFileEntry): THREE.Texture {
  texture.name = entry.id;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

async function defaultLoadEntry(entry: AssetFileEntry): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(entry.src);
  return normaliseTexture(texture, entry);
}

function createSnapshot(library: ImageTextureLibrary): ImageTextureLibrarySnapshot {
  return {
    status: library.status,
    loadedIds: [...library.loadedIds],
    errorMessage: library.errorMessage,
  };
}

export function createImageTextureLibrary(entries: AssetFileEntry[]): ImageTextureLibrary {
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate image texture id "${entry.id}".`);
    }
    seenIds.add(entry.id);
  }

  const library: ImageTextureLibrary = {
    status: 'idle',
    loadedIds: [],
    errorMessage: null,
  };
  LIBRARY_STATE.set(library, {
    entries: [...entries],
    texturesById: new Map(),
    loadPromise: null,
    disposed: false,
  });
  return library;
}

export function loadImageTextureAssets(
  library: ImageTextureLibrary,
  options: ImageTextureLoadOptions = {},
): Promise<ImageTextureLibrarySnapshot> {
  const state = stateFor(library);
  if (state.disposed) {
    return Promise.reject(new Error('Image texture library is disposed.'));
  }
  if (state.loadPromise) {
    return state.loadPromise;
  }

  library.status = 'loading';
  library.errorMessage = null;
  const loadEntry = options.loadEntry ?? defaultLoadEntry;
  state.loadPromise = Promise.allSettled(
    state.entries.map(async (entry) => ({
      entry,
      texture: normaliseTexture(await loadEntry(entry), entry),
    })),
  ).then((results) => {
    const loaded = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (state.disposed || failure) {
      loaded.forEach(({ texture }) => texture.dispose());
      if (state.disposed) {
        throw new Error('Image texture library was disposed while loading.');
      }
      const reason = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
      library.status = 'failed';
      library.errorMessage = reason;
      throw new Error(`Image texture load failed: ${reason}`);
    }

    for (const { entry, texture } of loaded) {
      state.texturesById.set(entry.id, texture);
    }
    library.loadedIds = loaded.map(({ entry }) => entry.id).sort();
    library.status = 'ready';
    return createSnapshot(library);
  });
  return state.loadPromise;
}

export function getImageTexture(library: ImageTextureLibrary, id: string | null | undefined): THREE.Texture | null {
  if (!id) {
    return null;
  }
  const state = stateFor(library);
  return state.disposed ? null : state.texturesById.get(id) ?? null;
}

export function getImageTextureLibrarySnapshot(library: ImageTextureLibrary): ImageTextureLibrarySnapshot {
  return createSnapshot(library);
}

export function disposeImageTextureLibrary(library: ImageTextureLibrary): void {
  const state = stateFor(library);
  if (state.disposed) {
    return;
  }
  state.disposed = true;
  for (const texture of state.texturesById.values()) {
    texture.dispose();
  }
  state.texturesById.clear();
  library.loadedIds = [];
  library.status = 'disposed';
  library.errorMessage = null;
}
