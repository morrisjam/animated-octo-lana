import { CHARACTER_PRESENTATION_ASSET_ENTRIES } from '../../content/characterPresentationRegistry';
import type { AssetManifest } from './types';

// Mixed alpha assets and explicit prototype placeholders. Omitted readiness is prototype.
export const DEFAULT_ASSET_MANIFEST: AssetManifest = {
  models: [
    {
      id: 'wormhole_arena_lip_v1',
      src: '/assets/stages/wormhole/wormhole-arena-lip-v1.glb',
      contentTypes: ['model/gltf-binary'],
      readiness: 'prototype',
      budget: {
        estimatedBytes: 56 * 1024,
        estimatedTriangles: 1_800,
        estimatedVertices: 1_600,
      },
    },
    {
      id: 'wormhole_arena_depth_v2',
      src: '/assets/stages/wormhole/wormhole-arena-depth-v2.glb',
      contentTypes: ['model/gltf-binary'],
      readiness: 'prototype',
      budget: {
        estimatedBytes: 132 * 1024,
        estimatedTriangles: 6_500,
        estimatedVertices: 3_600,
      },
    },
    {
      id: 'wormhole_arena_funnel_v3',
      src: '/assets/stages/wormhole/wormhole-arena-funnel-v3.glb',
      contentTypes: ['model/gltf-binary'],
      readiness: 'prototype',
      budget: {
        estimatedBytes: 64 * 1024,
        estimatedTriangles: 1_500,
        estimatedVertices: 1_800,
      },
    },
    {
      id: 'wormhole_arena_rift_v4',
      src: '/assets/stages/wormhole/wormhole-arena-rift-v4.glb',
      contentTypes: ['model/gltf-binary'],
      readiness: 'prototype',
      budget: {
        estimatedBytes: 64 * 1024,
        estimatedTriangles: 1_500,
        estimatedVertices: 1_800,
      },
    },
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
    ...CHARACTER_PRESENTATION_ASSET_ENTRIES.sprites,
    {
      id: 'fighter_placeholder_sprite',
      src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
      budget: {
        estimatedBytes: 4 * 1024,
      },
    },
  ],
  textures: [
    ...CHARACTER_PRESENTATION_ASSET_ENTRIES.textures,
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
