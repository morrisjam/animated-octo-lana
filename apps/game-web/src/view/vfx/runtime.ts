import * as THREE from 'three';
import { resolveCombatVfxPreset } from './presets';
import type {
  CombatVfxEvent,
  VfxFlashPreset,
  VfxParticlePreset,
  VfxSoundCuePreset,
  VfxTrailPreset,
} from './types';

const MAX_ACTIVE_VFX = 120;
const EPSILON = 1e-6;

type VfxRenderObject = THREE.Mesh | THREE.Line;

interface ActiveCombatVfx {
  node: VfxRenderObject;
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  origin: THREE.Vector3;
  driftPerSecond: THREE.Vector3;
  startTimeSeconds: number;
  lifetimeSeconds: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  endOpacity: number;
  ownedTexture: THREE.Texture | null;
  flipbook: VfxParticlePreset['flipbook'] | null;
}

export interface CombatVfxRuntimeOptions {
  onAudioCue?: (event: CombatVfxEvent, cue: VfxSoundCuePreset) => void;
  resolveTexture?: (textureId: string) => THREE.Texture | null;
}

export interface CombatVfxRuntime {
  scene: THREE.Scene;
  active: ActiveCombatVfx[];
  onAudioCue?: (event: CombatVfxEvent, cue: VfxSoundCuePreset) => void;
  resolveTexture?: (textureId: string) => THREE.Texture | null;
}

function createEffectMaterial(
  color: string,
  opacity: number,
  map: THREE.Texture | null = null,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    alphaTest: map ? 0.01 : 0,
  });
}

function cloneEffectTexture(
  runtime: CombatVfxRuntime,
  preset: VfxParticlePreset,
): THREE.Texture | null {
  if (!preset.textureId || !runtime.resolveTexture) {
    return null;
  }
  const source = runtime.resolveTexture(preset.textureId);
  if (!source) {
    return null;
  }
  const texture = source.clone();
  texture.needsUpdate = true;
  if (preset.flipbook) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1 / preset.flipbook.columns, 1 / preset.flipbook.rows);
  }
  return texture;
}

function createParticleNode(
  runtime: CombatVfxRuntime,
  event: CombatVfxEvent,
  preset: VfxParticlePreset,
): ActiveCombatVfx {
  const texture = cloneEffectTexture(runtime, preset);
  const geometry = texture
    ? new THREE.PlaneGeometry(2, 2)
    : new THREE.SphereGeometry(1, 16, 16);
  const material = createEffectMaterial(preset.color, preset.startOpacity, texture);
  const node = new THREE.Mesh(geometry, material);
  node.position.set(event.position.x, event.position.y, 0.28);
  node.scale.setScalar(preset.startScale);

  const direction = new THREE.Vector3(event.direction.x, event.direction.y, 0);
  direction.multiplyScalar(preset.driftAlongDirection);
  direction.z = preset.driftVertical;

  return {
    node,
    material,
    geometry,
    origin: node.position.clone(),
    driftPerSecond: direction,
    startTimeSeconds: 0,
    lifetimeSeconds: Math.max(0.05, preset.lifetimeSeconds),
    startScale: preset.startScale,
    endScale: preset.endScale,
    startOpacity: preset.startOpacity,
    endOpacity: preset.endOpacity,
    ownedTexture: texture,
    flipbook: preset.flipbook ?? null,
  };
}

function createTrailNode(event: CombatVfxEvent, preset: VfxTrailPreset): ActiveCombatVfx {
  const geometry = new THREE.PlaneGeometry(preset.length, preset.width);
  const material = createEffectMaterial(preset.color, preset.startOpacity);
  const node = new THREE.Mesh(geometry, material);
  const angle = Math.atan2(event.direction.y, event.direction.x);
  const halfLength = preset.length * 0.5;
  node.position.set(
    event.position.x - event.direction.x * halfLength,
    event.position.y - event.direction.y * halfLength,
    0.21,
  );
  node.rotation.z = angle;
  node.scale.setScalar(1);

  return {
    node,
    material,
    geometry,
    origin: node.position.clone(),
    driftPerSecond: new THREE.Vector3(event.direction.x, event.direction.y, 0).multiplyScalar(2.2),
    startTimeSeconds: 0,
    lifetimeSeconds: Math.max(0.05, preset.lifetimeSeconds),
    startScale: 1,
    endScale: 1.1,
    startOpacity: preset.startOpacity,
    endOpacity: preset.endOpacity,
    ownedTexture: null,
    flipbook: null,
  };
}

function createFlashNode(event: CombatVfxEvent, preset: VfxFlashPreset): ActiveCombatVfx {
  const geometry = new THREE.RingGeometry(
    Math.max(0.05, preset.radius - preset.thickness),
    Math.max(0.06, preset.radius + preset.thickness),
    36,
  );
  const material = createEffectMaterial(preset.color, preset.startOpacity);
  const node = new THREE.Mesh(geometry, material);
  node.position.set(event.position.x, event.position.y, 0.19);
  node.scale.setScalar(preset.startScale);

  return {
    node,
    material,
    geometry,
    origin: node.position.clone(),
    driftPerSecond: new THREE.Vector3(),
    startTimeSeconds: 0,
    lifetimeSeconds: Math.max(0.05, preset.lifetimeSeconds),
    startScale: preset.startScale,
    endScale: preset.endScale,
    startOpacity: preset.startOpacity,
    endOpacity: preset.endOpacity,
    ownedTexture: null,
    flipbook: null,
  };
}

function setEffectOpacity(effect: ActiveCombatVfx, opacity: number): void {
  if ('opacity' in effect.material) {
    (effect.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(opacity, 0, 1);
  }
}

function spawnEffect(runtime: CombatVfxRuntime, effect: ActiveCombatVfx, gameTimeSeconds: number): void {
  if (runtime.active.length >= MAX_ACTIVE_VFX) {
    const oldest = runtime.active.shift();
    if (oldest) {
      runtime.scene.remove(oldest.node);
      oldest.geometry.dispose();
      oldest.material.dispose();
      oldest.ownedTexture?.dispose();
    }
  }
  effect.startTimeSeconds = gameTimeSeconds;
  runtime.active.push(effect);
  runtime.scene.add(effect.node);
}

function disposeEffect(runtime: CombatVfxRuntime, effect: ActiveCombatVfx): void {
  runtime.scene.remove(effect.node);
  effect.geometry.dispose();
  effect.material.dispose();
  effect.ownedTexture?.dispose();
}

export function createCombatVfxRuntime(scene: THREE.Scene, options?: CombatVfxRuntimeOptions): CombatVfxRuntime {
  return {
    scene,
    active: [],
    onAudioCue: options?.onAudioCue,
    resolveTexture: options?.resolveTexture,
  };
}

function updateFlipbook(effect: ActiveCombatVfx, ageSeconds: number): void {
  if (!effect.ownedTexture || !effect.flipbook) {
    return;
  }
  const { columns, rows, frameCount, framesPerSecond, loop = false } = effect.flipbook;
  const rawFrame = Math.max(0, Math.floor(ageSeconds * framesPerSecond));
  const frame = loop
    ? rawFrame % frameCount
    : Math.min(frameCount - 1, rawFrame);
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  effect.ownedTexture.offset.set(column / columns, 1 - ((row + 1) / rows));
}

export function clearCombatVfxRuntime(runtime: CombatVfxRuntime): void {
  for (const effect of runtime.active) {
    disposeEffect(runtime, effect);
  }
  runtime.active.length = 0;
}

export function updateCombatVfxRuntime(runtime: CombatVfxRuntime, gameTimeSeconds: number): void {
  for (let index = runtime.active.length - 1; index >= 0; index -= 1) {
    const effect = runtime.active[index];
    const age = gameTimeSeconds - effect.startTimeSeconds;
    if (age < -EPSILON || age >= effect.lifetimeSeconds) {
      disposeEffect(runtime, effect);
      runtime.active.splice(index, 1);
      continue;
    }

    const t = THREE.MathUtils.clamp(age / effect.lifetimeSeconds, 0, 1);
    const scale = THREE.MathUtils.lerp(effect.startScale, effect.endScale, t);
    const opacity = THREE.MathUtils.lerp(effect.startOpacity, effect.endOpacity, t);
    effect.node.position.set(
      effect.origin.x + effect.driftPerSecond.x * age,
      effect.origin.y + effect.driftPerSecond.y * age,
      effect.origin.z + effect.driftPerSecond.z * age,
    );
    effect.node.scale.setScalar(scale);
    setEffectOpacity(effect, opacity);
    updateFlipbook(effect, age);
  }
}

export function emitCombatVfxEvents(
  runtime: CombatVfxRuntime,
  events: CombatVfxEvent[],
  gameTimeSeconds: number,
): void {
  for (const event of events) {
    const preset = resolveCombatVfxPreset(event);
    if (!preset) {
      continue;
    }

    if (preset.particles) {
      spawnEffect(runtime, createParticleNode(runtime, event, preset.particles), gameTimeSeconds);
    }
    if (preset.trail) {
      spawnEffect(runtime, createTrailNode(event, preset.trail), gameTimeSeconds);
    }
    if (preset.flash) {
      spawnEffect(runtime, createFlashNode(event, preset.flash), gameTimeSeconds);
    }
    if (preset.sound && runtime.onAudioCue) {
      runtime.onAudioCue(event, preset.sound);
    }
  }
}

export function disposeCombatVfxRuntime(runtime: CombatVfxRuntime): void {
  clearCombatVfxRuntime(runtime);
}

