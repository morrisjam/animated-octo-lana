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
}

class CombatVfxAudioCuePlayer {
  private context: AudioContext | null = null;

  play(cue: VfxSoundCuePreset, pan: number): void {
    const context = this.getContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }

    const oscillator = context.createOscillator();
    oscillator.type = cue.waveform;
    oscillator.frequency.value = cue.frequencyHz;

    const gain = context.createGain();
    const now = context.currentTime;
    const duration = Math.max(0.03, cue.durationSeconds);
    const peakGain = Math.max(0.0002, cue.gain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + Math.min(0.02, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    this.connectWithOptionalPan(context, gain, pan);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  dispose(): void {
    if (!this.context) {
      return;
    }
    void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private getContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    const globalWindow = globalThis as Window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    try {
      this.context = new AudioContextCtor();
    } catch {
      this.context = null;
    }
    return this.context;
  }

  private connectWithOptionalPan(context: AudioContext, source: AudioNode, pan: number): void {
    if ('createStereoPanner' in context) {
      const stereoPanner = context.createStereoPanner();
      stereoPanner.pan.value = THREE.MathUtils.clamp(pan, -1, 1);
      source.connect(stereoPanner);
      stereoPanner.connect(context.destination);
      return;
    }
    source.connect(context.destination);
  }
}

export interface CombatVfxRuntime {
  scene: THREE.Scene;
  active: ActiveCombatVfx[];
  audio: CombatVfxAudioCuePlayer;
}

function createRingMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createParticleNode(event: CombatVfxEvent, preset: VfxParticlePreset): ActiveCombatVfx {
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = createRingMaterial(preset.color, preset.startOpacity);
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
  };
}

function createTrailNode(event: CombatVfxEvent, preset: VfxTrailPreset): ActiveCombatVfx {
  const geometry = new THREE.PlaneGeometry(preset.length, preset.width);
  const material = createRingMaterial(preset.color, preset.startOpacity);
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
  };
}

function createFlashNode(event: CombatVfxEvent, preset: VfxFlashPreset): ActiveCombatVfx {
  const geometry = new THREE.RingGeometry(
    Math.max(0.05, preset.radius - preset.thickness),
    Math.max(0.06, preset.radius + preset.thickness),
    36,
  );
  const material = createRingMaterial(preset.color, preset.startOpacity);
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
}

export function createCombatVfxRuntime(scene: THREE.Scene): CombatVfxRuntime {
  return {
    scene,
    active: [],
    audio: new CombatVfxAudioCuePlayer(),
  };
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
      spawnEffect(runtime, createParticleNode(event, preset.particles), gameTimeSeconds);
    }
    if (preset.trail) {
      spawnEffect(runtime, createTrailNode(event, preset.trail), gameTimeSeconds);
    }
    if (preset.flash) {
      spawnEffect(runtime, createFlashNode(event, preset.flash), gameTimeSeconds);
    }
    if (preset.sound) {
      const pan = THREE.MathUtils.clamp(event.position.x / 30, -1, 1);
      runtime.audio.play(preset.sound, pan);
    }
  }
}

export function disposeCombatVfxRuntime(runtime: CombatVfxRuntime): void {
  clearCombatVfxRuntime(runtime);
  runtime.audio.dispose();
}

