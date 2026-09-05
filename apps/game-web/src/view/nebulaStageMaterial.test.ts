import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_ASSET_MANIFEST } from './assets/defaultManifest';
import { parseStaticStageGlb } from './assets/staticGlbRuntime';
import { applyNebulaStageMaterial } from './nebulaStageMaterial';
import { applyStageModelSelection, createStageModelRuntime, disposeStageModelRuntime, loadStageModelAssets } from './stageModelRuntime';
import { ONLINE_ALPHA_STAGE_ATMOSPHERE_ID, resolveStageAtmosphere } from './stageAtmosphere';

const entry = DEFAULT_ASSET_MANIFEST.models.find((entry) => entry.id === 'wormhole_nebula_v5')!;
const bytes = readFileSync(new URL('../../public/assets/stages/wormhole/wormhole-nebula-v5.glb', import.meta.url));

describe('authored nebula stage', () => {
  test('keeps the trial opt-in and removes competing procedural effects', () => {
    const preset = resolveStageAtmosphere('wormhole_nebula_v9_candidate');
    expect(ONLINE_ALPHA_STAGE_ATMOSPHERE_ID).not.toBe(preset.id);
    expect(preset.tokens.backgroundModelId).toBe(entry.id);
    expect(preset.tokens.backgroundEffectOpacity).toBe(0);
    expect(preset.tokens.backgroundEffectId).toBeNull();
    expect(preset.tokens.ringOpacity).toBe(0);
    expect(preset.tokens.fogFar).toBeGreaterThan(500);
  });

  test('exports the fixed arena mouth and puts all authored geometry behind fighters', () => {
    const root = parseStaticStageGlb(bytes, { expectedAssetId: entry.id });
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    expect(bounds.max.z).toBeCloseTo(-2);
    expect(bounds.min.z).toBeCloseTo(-182);
    const mouth: THREE.Vector3[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        if (Math.abs(point.z + 2) < .001) mouth.push(point);
      }
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    });
    expect(mouth).toHaveLength(128);
    for (const point of mouth) expect(Math.hypot(point.x, point.y)).toBeCloseTo(72, 3);
  });

  test('updates cloned shader time on replay seeks without moving the model; tint and disposal work', async () => {
    const runtime = createStageModelRuntime(new THREE.Scene(), [entry]);
    const object = parseStaticStageGlb(bytes, { expectedAssetId: entry.id });
    applyNebulaStageMaterial(object);
    await loadStageModelAssets(runtime, { loadEntry: async () => object });
    applyStageModelSelection(runtime, entry.id, '#80c0ff', .65);
    const mesh = runtime.root.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    const material = mesh.material as THREE.ShaderMaterial;
    const position = mesh.geometry.getAttribute('position').array.slice();
    for (const time of [20, 20, 4, 0]) {
      runtime.root.userData.gameTime = time;
      (mesh.onBeforeRender as () => void)();
      expect(material.uniforms.uTime.value).toBe(time);
      expect(material.uniforms.uOpacity.value).toBe(.65);
    }
    expect(material.uniforms.uTint.value.getHexString()).toBe('80c0ff');
    expect(mesh.geometry.getAttribute('position').array).toEqual(position);
    expect(material.depthWrite).toBe(false);
    const disposed = vi.fn();
    material.addEventListener('dispose', disposed);
    disposeStageModelRuntime(runtime);
    expect(disposed).toHaveBeenCalledOnce();
  });

  test('loads the actual GLB and lazy shader through the production asset path', async () => {
    const runtime = createStageModelRuntime(new THREE.Scene(), [entry]);
    await loadStageModelAssets(runtime, { fetchImpl: vi.fn(async () => new Response(bytes, {
      headers: { 'content-type': 'model/gltf-binary' },
    })) as typeof fetch });
    applyStageModelSelection(runtime, entry.id, '#ffffff', 1);
    const mesh = runtime.root.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(runtime.root.userData.visibleModelId).toBe(entry.id);
    disposeStageModelRuntime(runtime);
  });
});
