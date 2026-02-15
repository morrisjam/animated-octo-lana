import { describe, expect, test } from 'vitest';
import type { AssetManifest } from './types';
import {
  AssetLoadError,
  AssetManifestValidationError,
  preloadAssetManifest,
} from './loader';

function makeManifest(): AssetManifest {
  return {
    models: [{ id: 'model_alpha', src: 'https://assets.example.com/model_alpha.bin' }],
    sprites: [{ id: 'sprite_alpha', src: 'https://assets.example.com/sprite_alpha.png' }],
    textures: [{ id: 'texture_alpha', src: 'https://assets.example.com/texture_alpha.png' }],
    audio: [{ id: 'audio_alpha', src: 'https://assets.example.com/audio_alpha.ogg' }],
    shaders: [{
      id: 'shader_alpha',
      vertexSrc: 'https://assets.example.com/shader_alpha.vert',
      fragmentSrc: 'https://assets.example.com/shader_alpha.frag',
    }],
  };
}

describe('asset manifest loader', () => {
  test('preloads manifest entries and emits progress updates', async () => {
    const manifest = makeManifest();
    const progressEvents: Array<{ loaded: number; total: number; id: string }> = [];
    const fetchCalls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push(url);
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    };

    const result = await preloadAssetManifest(manifest, {
      fetchImpl,
      onProgress: (progress) => {
        progressEvents.push({ loaded: progress.loaded, total: progress.total, id: progress.id });
      },
    });

    expect(result.total).toBe(5);
    expect(result.loaded).toBe(5);
    expect(result.entries).toHaveLength(5);
    expect(progressEvents).toHaveLength(5);
    expect(progressEvents.at(-1)).toEqual({ loaded: 5, total: 5, id: 'shader_alpha' });
    expect(fetchCalls).toContain('https://assets.example.com/shader_alpha.vert');
    expect(fetchCalls).toContain('https://assets.example.com/shader_alpha.frag');
  });

  test('rejects invalid manifest entries with clear validation diagnostics', async () => {
    const invalidManifest = makeManifest();
    invalidManifest.textures[0].src = '';

    await expect(preloadAssetManifest(invalidManifest)).rejects.toBeInstanceOf(AssetManifestValidationError);
    await expect(preloadAssetManifest(invalidManifest)).rejects.toThrow('texture[0]');
  });

  test('rejects invalid manifest budget hint values with clear diagnostics', async () => {
    const invalidManifest = makeManifest();
    invalidManifest.models[0].budget = {
      estimatedTriangles: -10,
    };

    await expect(preloadAssetManifest(invalidManifest)).rejects.toBeInstanceOf(AssetManifestValidationError);
    await expect(preloadAssetManifest(invalidManifest)).rejects.toThrow('budget.estimatedTriangles');
  });

  test('reports missing asset loads with explicit kind and id context', async () => {
    const manifest = makeManifest();
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('texture_alpha')) {
        return new Response('not found', { status: 404, statusText: 'Not Found' });
      }
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    };

    await expect(preloadAssetManifest(manifest, { fetchImpl })).rejects.toBeInstanceOf(AssetLoadError);
    await expect(preloadAssetManifest(manifest, { fetchImpl })).rejects.toThrow('[texture:texture_alpha]');
    await expect(preloadAssetManifest(manifest, { fetchImpl })).rejects.toThrow('HTTP 404');
  });
});
