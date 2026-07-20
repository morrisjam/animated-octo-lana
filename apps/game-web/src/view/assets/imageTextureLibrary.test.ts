import * as THREE from 'three';
import { describe, expect, test, vi } from 'vitest';
import {
  createImageTextureLibrary,
  disposeImageTextureLibrary,
  getImageTexture,
  getImageTextureLibrarySnapshot,
  loadImageTextureAssets,
} from './imageTextureLibrary';

const ENTRIES = [
  { id: 'stage_nebula', src: '/stage-nebula.png' },
  { id: 'vfx_burst', src: '/vfx-burst.png' },
];

describe('image texture library', () => {
  test('loads each texture once and resolves it by manifest id', async () => {
    const library = createImageTextureLibrary(ENTRIES);
    const textures = new Map(ENTRIES.map((entry) => [entry.id, new THREE.Texture()]));
    const loadEntry = vi.fn(async (entry: (typeof ENTRIES)[number]) => textures.get(entry.id) as THREE.Texture);

    const firstLoad = loadImageTextureAssets(library, { loadEntry });
    const secondLoad = loadImageTextureAssets(library, { loadEntry });
    expect(secondLoad).toBe(firstLoad);

    await expect(firstLoad).resolves.toMatchObject({
      status: 'ready',
      loadedIds: ['stage_nebula', 'vfx_burst'],
      errorMessage: null,
    });
    expect(loadEntry).toHaveBeenCalledTimes(2);
    expect(getImageTexture(library, 'vfx_burst')).toBe(textures.get('vfx_burst'));
    expect(getImageTexture(library, 'missing')).toBeNull();
    expect(textures.get('stage_nebula')?.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  test('fails atomically and disposes textures loaded before another entry fails', async () => {
    const library = createImageTextureLibrary(ENTRIES);
    const loadedTexture = new THREE.Texture();
    const dispose = vi.spyOn(loadedTexture, 'dispose');

    await expect(loadImageTextureAssets(library, {
      loadEntry: async (entry) => {
        if (entry.id === 'vfx_burst') {
          throw new Error('decode failed');
        }
        return loadedTexture;
      },
    })).rejects.toThrow('decode failed');

    expect(dispose).toHaveBeenCalledOnce();
    expect(getImageTexture(library, 'stage_nebula')).toBeNull();
    expect(getImageTextureLibrarySnapshot(library)).toMatchObject({
      status: 'failed',
      loadedIds: [],
      errorMessage: 'decode failed',
    });
  });

  test('owns and disposes loaded GPU textures', async () => {
    const library = createImageTextureLibrary([ENTRIES[0]]);
    const texture = new THREE.Texture();
    const dispose = vi.spyOn(texture, 'dispose');
    await loadImageTextureAssets(library, { loadEntry: async () => texture });

    disposeImageTextureLibrary(library);

    expect(dispose).toHaveBeenCalledOnce();
    expect(getImageTexture(library, 'stage_nebula')).toBeNull();
    expect(getImageTextureLibrarySnapshot(library).status).toBe('disposed');
  });

  test('rejects duplicate manifest ids before allocating resources', () => {
    expect(() => createImageTextureLibrary([ENTRIES[0], ENTRIES[0]])).toThrow(
      'Duplicate image texture id',
    );
  });
});
