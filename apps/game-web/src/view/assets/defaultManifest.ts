import type { AssetManifest } from './types';

// Mixed alpha assets and explicit prototype placeholders. Omitted readiness is prototype.
export const DEFAULT_ASSET_MANIFEST: AssetManifest = {
  models: [
    {
      id: 'fighter_placeholder_model',
      src: 'data:application/octet-stream;base64,AA==',
      budget: {
        estimatedBytes: 16 * 1024,
        estimatedTriangles: 2_400,
        estimatedVertices: 1_600,
        estimatedVfxEmitters: 4,
      },
    },
    {
      id: 'stage_spire_model',
      src: 'data:application/octet-stream;base64,AA==',
      budget: {
        estimatedBytes: 24 * 1024,
        estimatedTriangles: 3_200,
        estimatedVertices: 2_100,
      },
    },
    {
      id: 'stage_ruins_model',
      src: 'data:application/octet-stream;base64,AA==',
      budget: {
        estimatedBytes: 28 * 1024,
        estimatedTriangles: 4_100,
        estimatedVertices: 2_800,
      },
    },
  ],
  sprites: [
    {
      id: 'character_vanguard_animset',
      src: new URL('../sprites/vanguard-alpha-atlas.svg', import.meta.url).href,
      readiness: 'alpha',
      budget: {
        estimatedBytes: 12 * 1024,
        estimatedTextureBytes: 512 * 256 * 4,
      },
    },
    {
      id: 'character_duelist_animset',
      src: new URL('../sprites/duelist-alpha-atlas.svg', import.meta.url).href,
      readiness: 'alpha',
      budget: {
        estimatedBytes: 12 * 1024,
        estimatedTextureBytes: 512 * 256 * 4,
      },
    },
    {
      id: 'fighter_placeholder_sprite',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
      budget: {
        estimatedBytes: 4 * 1024,
      },
    },
  ],
  textures: [
    {
      id: 'character_vanguard_portrait',
      src: new URL('../sprites/vanguard-alpha-portrait.svg', import.meta.url).href,
      readiness: 'alpha',
      budget: {
        estimatedBytes: 8 * 1024,
        estimatedTextureBytes: 256 * 256 * 4,
      },
    },
    {
      id: 'character_duelist_portrait',
      src: new URL('../sprites/duelist-alpha-portrait.svg', import.meta.url).href,
      readiness: 'alpha',
      budget: {
        estimatedBytes: 8 * 1024,
        estimatedTextureBytes: 256 * 256 * 4,
      },
    },
    {
      id: 'arena_placeholder_texture',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
      budget: {
        estimatedBytes: 1 * 1024 * 1024,
        estimatedTextureBytes: 1 * 1024 * 1024,
      },
    },
    {
      id: 'stage_nebula_texture',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
      budget: {
        estimatedBytes: 768 * 1024,
        estimatedTextureBytes: 768 * 1024,
      },
    },
    {
      id: 'stage_ion_clouds_texture',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
      budget: {
        estimatedBytes: 768 * 1024,
        estimatedTextureBytes: 768 * 1024,
      },
    },
    {
      id: 'stage_sunset_haze_texture',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
      budget: {
        estimatedBytes: 768 * 1024,
        estimatedTextureBytes: 768 * 1024,
      },
    },
  ],
  audio: [
    {
      id: 'menu_placeholder_audio',
      src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAABCxAgAEABAAZGF0YQAAAAA=',
      budget: {
        estimatedBytes: 32 * 1024,
      },
    },
  ],
  shaders: [
    {
      id: 'gravity_well_default_shader',
      vertexSrc: 'data:text/plain;base64,YXR0cmlidXRlIHZlYzMgcG9zaXRpb247IHZvaWQgbWFpbigpeyBnbF9Qb3NpdGlvbiA9IHZlYzQocG9zaXRpb24sIDEuMCk7IH0=',
      fragmentSrc: 'data:text/plain;base64,dm9pZCBtYWluKCl7IGdsX0ZyYWdDb2xvciA9IHZlYzQoMS4wKTsgfQ==',
      budget: {
        estimatedBytes: 3 * 1024,
      },
    },
  ],
};
