import * as THREE from 'three';
import { describe, expect, test, vi } from 'vitest';
import type { AssetFileEntry } from './assets/types';
import {
  applyStageModelSelection,
  createStageModelRuntime,
  disposeStageModelRuntime,
  getStageModelRuntimeSnapshot,
  loadStageModelAssets,
} from './stageModelRuntime';

const AUTHORED_ENTRY: AssetFileEntry = {
  id: 'wormhole_arena_lip_v1',
  src: '/assets/stages/wormhole/wormhole-arena-lip-v1.glb',
  contentTypes: ['model/gltf-binary'],
};

function createLoadedModel(): THREE.Object3D {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#80c0ff', emissive: '#402080' }),
  ));
  return group;
}

describe('stage model runtime', () => {
  test('applies a pending selection when the authored GLB finishes loading', async () => {
    const scene = new THREE.Scene();
    const runtime = createStageModelRuntime(scene, [AUTHORED_ENTRY]);
    applyStageModelSelection(runtime, AUTHORED_ENTRY.id, '#ffffff', 0.75);
    expect(getStageModelRuntimeSnapshot(runtime)).toMatchObject({
      status: 'idle',
      selectedId: AUTHORED_ENTRY.id,
      visibleId: null,
    });

    await loadStageModelAssets(runtime, { loadEntry: async () => createLoadedModel() });
    expect(getStageModelRuntimeSnapshot(runtime)).toMatchObject({
      status: 'ready',
      selectedId: AUTHORED_ENTRY.id,
      visibleId: AUTHORED_ENTRY.id,
      loadedIds: [AUTHORED_ENTRY.id],
    });
    const mesh = runtime.root.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    expect((mesh.material as THREE.Material).opacity).toBeCloseTo(0.75);
    expect((mesh.material as THREE.Material).depthWrite).toBe(false);
  });

  test('preserves legacy stage placeholders without substituting one for an authored model', async () => {
    const scene = new THREE.Scene();
    const runtime = createStageModelRuntime(scene, [
      AUTHORED_ENTRY,
      { id: 'stage_spire_model', src: 'data:application/octet-stream;base64,AA==' },
    ]);
    applyStageModelSelection(runtime, AUTHORED_ENTRY.id, '#ffffff', 1);
    expect(getStageModelRuntimeSnapshot(runtime).visibleId).toBeNull();
    applyStageModelSelection(runtime, 'stage_spire_model', '#80c0ff', 0.5);
    expect(getStageModelRuntimeSnapshot(runtime).visibleId).toBe('stage_spire_model');

    await loadStageModelAssets(runtime, { loadEntry: async () => createLoadedModel() });
    expect(getStageModelRuntimeSnapshot(runtime).visibleId).toBe('stage_spire_model');
  });

  test('fails closed on parser errors and disposes cleanly', async () => {
    const scene = new THREE.Scene();
    const runtime = createStageModelRuntime(scene, [AUTHORED_ENTRY]);
    const loadEntry = vi.fn(async () => {
      throw new Error('invalid GLB');
    });
    await expect(loadStageModelAssets(runtime, { loadEntry })).rejects.toThrow('invalid GLB');
    expect(getStageModelRuntimeSnapshot(runtime)).toMatchObject({
      status: 'failed',
      visibleId: null,
      errorMessage: 'invalid GLB',
    });
    disposeStageModelRuntime(runtime);
    expect(getStageModelRuntimeSnapshot(runtime).status).toBe('disposed');
    expect(scene.children).not.toContain(runtime.root);
  });
});
