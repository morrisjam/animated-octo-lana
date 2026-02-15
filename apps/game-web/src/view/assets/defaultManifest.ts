import type { AssetManifest } from './types';

// Placeholder manifest to exercise preloading flow until concrete art/audio packs land.
export const DEFAULT_ASSET_MANIFEST: AssetManifest = {
  models: [
    {
      id: 'fighter_placeholder_model',
      src: 'data:application/octet-stream;base64,AA==',
    },
  ],
  sprites: [
    {
      id: 'fighter_placeholder_sprite',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
    },
  ],
  textures: [
    {
      id: 'arena_placeholder_texture',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
    },
  ],
  audio: [
    {
      id: 'menu_placeholder_audio',
      src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAABCxAgAEABAAZGF0YQAAAAA=',
    },
  ],
  shaders: [
    {
      id: 'gravity_well_default_shader',
      vertexSrc: 'data:text/plain;base64,YXR0cmlidXRlIHZlYzMgcG9zaXRpb247IHZvaWQgbWFpbigpeyBnbF9Qb3NpdGlvbiA9IHZlYzQocG9zaXRpb24sIDEuMCk7IH0=',
      fragmentSrc: 'data:text/plain;base64,dm9pZCBtYWluKCl7IGdsX0ZyYWdDb2xvciA9IHZlYzQoMS4wKTsgfQ==',
    },
  ],
};
