import * as THREE from 'three';
import type { AssetFileEntry } from './assets/types';

export type StageModelLoadStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'disposed';

export interface StageModelRuntime {
  root: THREE.Group;
  status: StageModelLoadStatus;
  selectedId: string | null;
  loadedIds: string[];
  errorMessage: string | null;
}

export interface StageModelLoadResult {
  loadedIds: string[];
}

export interface StageModelLoadOptions {
  fetchImpl?: typeof fetch;
  loadEntry?: StageModelAssetLoader;
}

export interface StageModelRuntimeSnapshot {
  status: StageModelLoadStatus;
  selectedId: string | null;
  visibleId: string | null;
  loadedIds: string[];
  errorMessage: string | null;
}

export type StageModelAssetLoader = (entry: AssetFileEntry) => Promise<THREE.Object3D>;

interface MaterialBaseline {
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

interface StageModelRuntimeState {
  entriesById: Map<string, AssetFileEntry>;
  authoredIds: Set<string>;
  objectsById: Map<string, THREE.Group>;
  materialBaselines: Map<THREE.Material, MaterialBaseline>;
  selectedTint: THREE.Color;
  selectedOpacity: number;
  loadPromise: Promise<StageModelLoadResult> | null;
  disposed: boolean;
}

const RUNTIME_STATE = new WeakMap<StageModelRuntime, StageModelRuntimeState>();

function stateFor(runtime: StageModelRuntime): StageModelRuntimeState {
  const state = RUNTIME_STATE.get(runtime);
  if (!state) {
    throw new Error('Unknown stage model runtime.');
  }
  return state;
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function readMaterialColor(material: THREE.Material, property: 'color' | 'emissive'): THREE.Color | null {
  if (property === 'color' && material instanceof THREE.ShaderMaterial
    && material.uniforms.uTint?.value instanceof THREE.Color) return material.uniforms.uTint.value;
  const value = (material as THREE.Material & Record<'color' | 'emissive', unknown>)[property];
  return value instanceof THREE.Color ? value : null;
}

function recordMaterialBaseline(state: StageModelRuntimeState, material: THREE.Material): void {
  state.materialBaselines.set(material, {
    color: readMaterialColor(material, 'color')?.clone() ?? null,
    emissive: readMaterialColor(material, 'emissive')?.clone() ?? null,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
  });
}

function cloneObjectMaterials(state: StageModelRuntimeState, object: THREE.Object3D): void {
  const materialClones = new Map<THREE.Material, THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const cloneMaterial = (material: THREE.Material): THREE.Material => {
      const existing = materialClones.get(material);
      if (existing) {
        return existing;
      }
      const clone = material.clone();
      materialClones.set(material, clone);
      recordMaterialBaseline(state, clone);
      return clone;
    };
    child.material = Array.isArray(child.material)
      ? child.material.map(cloneMaterial)
      : cloneMaterial(child.material);
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = -1;
  });
  for (const original of materialClones.keys()) {
    original.dispose();
  }
}

function styleMaterial(
  material: THREE.Material,
  baseline: MaterialBaseline,
  tint: THREE.Color,
  opacity: number,
): void {
  const color = readMaterialColor(material, 'color');
  if (color && baseline.color) {
    color.copy(baseline.color).multiply(tint);
  }
  const emissive = readMaterialColor(material, 'emissive');
  if (emissive && baseline.emissive) {
    emissive.copy(baseline.emissive).multiply(tint);
  }
  const resolvedOpacity = clampOpacity(baseline.opacity * opacity);
  const transparent = baseline.transparent || resolvedOpacity < 0.999;
  const depthWrite = transparent ? false : baseline.depthWrite;
  const materialModeChanged = material.transparent !== transparent || material.depthWrite !== depthWrite;
  material.opacity = resolvedOpacity;
  material.transparent = transparent;
  material.depthWrite = depthWrite;
  if (materialModeChanged) {
    material.needsUpdate = true;
  }
}

function applySelection(runtime: StageModelRuntime): void {
  const state = stateFor(runtime);
  let visibleId: string | null = null;
  for (const [id, object] of state.objectsById) {
    const visible = id === runtime.selectedId && state.selectedOpacity > 0;
    object.visible = visible;
    if (visible) {
      visibleId = id;
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
          return;
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          const baseline = state.materialBaselines.get(material);
          if (baseline) {
            styleMaterial(material, baseline, state.selectedTint, state.selectedOpacity);
          }
        }
      });
    }
  }
  runtime.root.visible = visibleId !== null;
  runtime.root.userData.modelId = runtime.selectedId;
  runtime.root.userData.visibleModelId = visibleId;
}

function updateLoadedIds(runtime: StageModelRuntime): void {
  runtime.loadedIds = [...stateFor(runtime).objectsById.keys()].sort();
}

function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
}

function registerObject(runtime: StageModelRuntime, id: string, object: THREE.Object3D): void {
  const state = stateFor(runtime);
  if (state.disposed) {
    disposeObject(object);
    return;
  }
  cloneObjectMaterials(state, object);
  const container = new THREE.Group();
  container.name = `stage-model-${id}`;
  container.userData.modelId = id;
  container.visible = false;
  container.add(object);
  runtime.root.add(container);
  state.objectsById.set(id, container);
  updateLoadedIds(runtime);
  applySelection(runtime);
}

function createLegacyPlaceholder(id: string): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(64, 40, 20),
    new THREE.MeshStandardMaterial({
      color: '#9fb7ff',
      transparent: true,
      opacity: 0.5,
      roughness: 0.75,
      metalness: 0.05,
    }),
  );
  mesh.name = `${id}-legacy-placeholder`;
  mesh.position.set(0, -6, -116);
  return mesh;
}

function normaliseContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

async function defaultLoadEntry(entry: AssetFileEntry, fetchImpl: typeof fetch): Promise<THREE.Object3D> {
  const response = await fetchImpl(entry.src, { cache: 'force-cache', credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`stage model ${entry.id} returned HTTP ${response.status}.`);
  }
  const contentType = normaliseContentType(response.headers.get('content-type'));
  if (entry.contentTypes && !entry.contentTypes.includes(contentType)) {
    throw new Error(
      `stage model ${entry.id} expected ${entry.contentTypes.join(' or ')}, received ${contentType || 'unknown'}.`,
    );
  }
  const body = await response.arrayBuffer();
  const { parseStaticStageGlb } = await import('./assets/staticGlbRuntime');
  const object = parseStaticStageGlb(body, { expectedAssetId: entry.id });
  if (entry.id === 'wormhole_nebula_v5') {
    try {
      const { applyNebulaStageMaterial } = await import('./nebulaStageMaterial');
      applyNebulaStageMaterial(object);
    } catch (error) {
      disposeObject(object);
      throw error;
    }
  }
  return object;
}

export function createStageModelRuntime(
  scene: THREE.Scene,
  entries: AssetFileEntry[],
): StageModelRuntime {
  const root = new THREE.Group();
  root.name = 'stage-background-models';
  root.visible = false;
  scene.add(root);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const authoredIds = new Set(
    entries
      .filter((entry) => entry.contentTypes?.includes('model/gltf-binary'))
      .map((entry) => entry.id),
  );
  const runtime: StageModelRuntime = {
    root,
    status: 'idle',
    selectedId: null,
    loadedIds: [],
    errorMessage: null,
  };
  RUNTIME_STATE.set(runtime, {
    entriesById,
    authoredIds,
    objectsById: new Map(),
    materialBaselines: new Map(),
    selectedTint: new THREE.Color('#ffffff'),
    selectedOpacity: 1,
    loadPromise: null,
    disposed: false,
  });
  for (const entry of entries) {
    if (!authoredIds.has(entry.id) && entry.id.startsWith('stage_')) {
      registerObject(runtime, entry.id, createLegacyPlaceholder(entry.id));
    }
  }
  return runtime;
}

export function applyStageModelSelection(
  runtime: StageModelRuntime,
  modelId: string | null,
  tint: string,
  opacity: number,
): void {
  const state = stateFor(runtime);
  if (state.disposed) {
    return;
  }
  runtime.selectedId = typeof modelId === 'string' && modelId.trim() ? modelId.trim() : null;
  state.selectedTint.set(tint);
  state.selectedOpacity = clampOpacity(opacity);
  applySelection(runtime);
}

export function loadStageModelAssets(
  runtime: StageModelRuntime,
  options: StageModelLoadOptions = {},
): Promise<StageModelLoadResult> {
  const state = stateFor(runtime);
  if (state.disposed) {
    return Promise.reject(new Error('Stage model runtime is disposed.'));
  }
  if (state.loadPromise) {
    return state.loadPromise;
  }
  const entries = [...state.authoredIds].map((id) => state.entriesById.get(id) as AssetFileEntry);
  runtime.status = 'loading';
  runtime.errorMessage = null;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const loadEntry = options.loadEntry ?? ((entry) => defaultLoadEntry(entry, fetchImpl));
  state.loadPromise = Promise.all(entries.map(async (entry) => {
    const object = await loadEntry(entry);
    registerObject(runtime, entry.id, object);
    return entry.id;
  })).then((loadedIds) => {
    if (state.disposed) {
      throw new Error('Stage model runtime was disposed while loading.');
    }
    runtime.status = 'ready';
    return { loadedIds: [...loadedIds].sort() };
  }).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (!state.disposed) {
      runtime.status = 'failed';
      runtime.errorMessage = reason;
    }
    throw error;
  });
  return state.loadPromise;
}

export function getStageModelRuntimeSnapshot(runtime: StageModelRuntime): StageModelRuntimeSnapshot {
  return {
    status: runtime.status,
    selectedId: runtime.selectedId,
    visibleId: typeof runtime.root.userData.visibleModelId === 'string'
      ? runtime.root.userData.visibleModelId
      : null,
    loadedIds: [...runtime.loadedIds],
    errorMessage: runtime.errorMessage,
  };
}

export function disposeStageModelRuntime(runtime: StageModelRuntime): void {
  const state = stateFor(runtime);
  if (state.disposed) {
    return;
  }
  state.disposed = true;
  runtime.status = 'disposed';
  runtime.root.removeFromParent();
  disposeObject(runtime.root);
  runtime.root.clear();
  state.objectsById.clear();
  state.materialBaselines.clear();
  runtime.loadedIds = [];
}
