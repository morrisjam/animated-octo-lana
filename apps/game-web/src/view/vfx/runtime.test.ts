import * as THREE from 'three';
import { describe, expect, test, vi } from 'vitest';
import {
  createCombatVfxRuntime,
  disposeCombatVfxRuntime,
  emitCombatVfxEvents,
  updateCombatVfxRuntime,
} from './runtime';
import { COMBAT_VFX_PRESET_LIBRARY } from './presets';

describe('combat VFX runtime', () => {
  test('uses an authored texture and advances its flipbook without mutating the library texture', () => {
    const scene = new THREE.Scene();
    const sourceTexture = new THREE.Texture();
    const originalPreset = COMBAT_VFX_PRESET_LIBRARY.boost_core.particles;
    COMBAT_VFX_PRESET_LIBRARY.boost_core.particles = {
      ...originalPreset!,
      textureId: 'vfx_action_burst',
      flipbook: {
        columns: 4,
        rows: 1,
        frameCount: 4,
        framesPerSecond: 20,
      },
    };
    const runtime = createCombatVfxRuntime(scene, {
      resolveTexture: (id) => id === 'vfx_action_burst' ? sourceTexture : null,
    });

    try {
      emitCombatVfxEvents(runtime, [{
        type: 'boost',
        playerId: 'P1',
        characterId: 'vanguard',
        position: { x: 2, y: 3 },
        direction: { x: 1, y: 0 },
      }], 1);

      const texturedEffect = runtime.active.find((effect) => (
        effect.node instanceof THREE.Mesh
        && effect.node.material instanceof THREE.MeshBasicMaterial
        && effect.node.material.map !== null
      ));
      expect(texturedEffect).toBeTruthy();
      const material = texturedEffect?.node.material as THREE.MeshBasicMaterial;
      expect(material.map).not.toBe(sourceTexture);
      expect(sourceTexture.offset.x).toBe(0);

      updateCombatVfxRuntime(runtime, 1.11);
      expect(material.map?.repeat.x).toBeCloseTo(0.25);
      expect(material.map?.offset.x).toBeCloseTo(0.5);
      expect(sourceTexture.offset.x).toBe(0);
    } finally {
      COMBAT_VFX_PRESET_LIBRARY.boost_core.particles = originalPreset;
      disposeCombatVfxRuntime(runtime);
      sourceTexture.dispose();
    }
  });

  test('falls back to procedural geometry when an authored texture is unavailable', () => {
    const scene = new THREE.Scene();
    const runtime = createCombatVfxRuntime(scene, { resolveTexture: () => null });
    const audioCue = vi.fn();
    runtime.onAudioCue = audioCue;

    emitCombatVfxEvents(runtime, [{
      type: 'boost',
      playerId: 'P1',
      characterId: 'vanguard',
      position: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    }], 0);

    expect(runtime.active.some((effect) => effect.node instanceof THREE.Mesh)).toBe(true);
    expect(audioCue).toHaveBeenCalledOnce();
    disposeCombatVfxRuntime(runtime);
  });
});
