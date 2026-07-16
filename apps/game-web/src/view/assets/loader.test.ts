import { describe, expect, test, vi } from 'vitest';
import type { AssetFileEntry, AssetManifest } from './types';
import {
  AssetLoadError,
  AssetManifestValidationError,
  decodeAssetImageDimensions,
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

function makeTextureManifest(overrides: Partial<AssetFileEntry> = {}): AssetManifest {
  return {
    models: [],
    sprites: [],
    textures: [{
      id: 'texture_metadata',
      src: 'https://assets.example.com/texture_metadata.png',
      ...overrides,
    }],
    audio: [],
    shaders: [],
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

  test('rejects unknown asset readiness labels', async () => {
    const invalidManifest = makeManifest();
    invalidManifest.models[0].readiness = 'beta' as 'alpha';

    await expect(preloadAssetManifest(invalidManifest)).rejects.toBeInstanceOf(AssetManifestValidationError);
    await expect(preloadAssetManifest(invalidManifest)).rejects.toThrow('invalid readiness');
  });

  test.each([
    ['an empty content type list', { contentTypes: [] }, 'contentTypes'],
    ['a malformed content type', { contentTypes: ['image'] }, 'contentTypes[0]'],
    ['an unnormalized content type', { contentTypes: ['IMAGE/PNG; charset=binary'] }, 'contentTypes[0]'],
    [
      'duplicate content types',
      { contentTypes: ['image/png', 'image/png'] },
      'contentTypes[1]',
    ],
    ['a zero image width', { image: { width: 0, height: 64 } }, 'image dimensions'],
    ['a fractional image height', { image: { width: 64, height: 63.5 } }, 'image dimensions'],
    [
      'image dimensions without an image MIME declaration',
      { image: { width: 64, height: 64 } },
      'image metadata requires image contentTypes',
    ],
    [
      'image dimensions with a non-image MIME declaration',
      { contentTypes: ['application/octet-stream'], image: { width: 64, height: 64 } },
      'image metadata requires image contentTypes',
    ],
  ] satisfies Array<[string, Partial<AssetFileEntry>, string]>)('rejects invalid metadata: %s', async (_, metadata, diagnostic) => {
    const manifest = makeTextureManifest(metadata);

    await expect(preloadAssetManifest(manifest)).rejects.toBeInstanceOf(AssetManifestValidationError);
    await expect(preloadAssetManifest(manifest)).rejects.toThrow(diagnostic);
  });

  test('rejects response MIME types outside the expected list', async () => {
    const manifest = makeTextureManifest({ contentTypes: ['image/png', 'image/webp'] });
    const fetchImpl: typeof fetch = async () => new Response('not an image', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const load = preloadAssetManifest(manifest, { fetchImpl });

    await expect(load).rejects.toBeInstanceOf(AssetLoadError);
    await expect(load).rejects.toThrow('[texture:texture_metadata]');
    await expect(load).rejects.toThrow('expected content type image/png or image/webp, received text/plain');
  });

  test('accepts MIME type case differences and response parameters', async () => {
    const manifest = makeTextureManifest({ contentTypes: ['image/png'] });
    const fetchImpl: typeof fetch = async () => new Response('png', {
      status: 200,
      headers: { 'content-type': 'IMAGE/PNG; charset=binary' },
    });

    const result = await preloadAssetManifest(manifest, { fetchImpl });

    expect(result.entries[0].contentTypes).toEqual(['IMAGE/PNG; charset=binary']);
  });

  test('rejects decoded image dimension mismatches with asset context', async () => {
    const manifest = makeTextureManifest({
      contentTypes: ['image/png'],
      image: { width: 64, height: 64 },
    });
    const fetchImpl: typeof fetch = async () => new Response('png', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    const imageDimensionDecoder = vi.fn(async () => ({ width: 63, height: 64 }));
    const load = preloadAssetManifest(manifest, { fetchImpl, imageDimensionDecoder });

    await expect(load).rejects.toBeInstanceOf(AssetLoadError);
    await expect(load).rejects.toThrow('[texture:texture_metadata]');
    await expect(load).rejects.toThrow('expected image dimensions 64x64, received 63x64');
    expect(imageDimensionDecoder).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/png');
  });

  test.each([
    ['intrinsic dimensions', '<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="24"></svg>', 48, 24],
    [
      'viewBox dimensions',
      '<svg xmlns="http://www.w3.org/2000/svg" data-width="1" data-height="1" viewBox="-4 -2 48 24"></svg>',
      48,
      24,
    ],
  ])('decodes SVG %s deterministically', async (_, svg, width, height) => {
    const manifest = makeTextureManifest({
      contentTypes: ['image/svg+xml'],
      image: { width, height },
    });
    const fetchImpl: typeof fetch = async () => new Response(svg, {
      status: 200,
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
    });

    await expect(preloadAssetManifest(manifest, { fetchImpl })).resolves.toMatchObject({ loaded: 1 });
  });

  test('exports the default decoder with MIME normalization', async () => {
    const body = new TextEncoder().encode('<svg viewBox="0 0 96 48"></svg>').buffer;

    await expect(decodeAssetImageDimensions(body, 'IMAGE/SVG+XML; charset=utf-8'))
      .resolves.toEqual({ width: 96, height: 48 });
  });

  test('uses createImageBitmap for non-SVG images when available', async () => {
    const manifest = makeTextureManifest({
      contentTypes: ['image/webp'],
      image: { width: 80, height: 40 },
    });
    const fetchImpl: typeof fetch = async () => new Response('webp', {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    });
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 80, height: 40, close }));
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    try {
      await expect(preloadAssetManifest(manifest, { fetchImpl })).resolves.toMatchObject({ loaded: 1 });
      expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob));
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
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
