import * as THREE from 'three';
import type { PlayersById, RenderSnapshot } from '../sim/types';
import { ARENA_RADIUS } from '../sim/constants';
import { DEFAULT_CHARACTER_LOADOUT } from '../sim/characters';
import { createCharacterVisualHandle, type CharacterVisualHandle } from './characterVisual';
import { createCombatVfxRuntime, type CombatVfxRuntime } from './vfx/runtime';
import type { CombatVfxEvent, VfxSoundCuePreset } from './vfx/types';
import {
  DEFAULT_STAGE_ATMOSPHERE_ID,
  resolveStageAtmosphere,
} from './stageAtmosphere';

const MAX_RENDER_PIXEL_RATIO = 1.25;

interface PlayerIndicatorMeshes {
  parry: THREE.Mesh;
  launch: THREE.Mesh;
  special: THREE.Mesh;
  break: THREE.Mesh;
  dunk: THREE.Mesh;
}

interface WormholeBackdrop {
  group: THREE.Group;
  core: THREE.Mesh;
  rings: THREE.Mesh[];
  spiralArms: THREE.Mesh[];
  particles: THREE.Points;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  lookAtTarget: THREE.Vector3;
  cameraPlayerTracks: PlayersById<THREE.Vector2>;
  launchCameraActive: boolean;
  gravityWell: THREE.Mesh;
  ring: THREE.Mesh;
  playerVisuals: PlayersById<CharacterVisualHandle>;
  playerMeshes: PlayersById<THREE.Object3D>;
  playerIndicators: PlayersById<PlayerIndicatorMeshes>;
  projectileMeshes: Map<number, THREE.Mesh>;
  combatVfxRuntime: CombatVfxRuntime;
  lastRenderSnapshot: RenderSnapshot | null;
  ambientLight: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  arenaBoundary: THREE.LineLoop;
  stars: THREE.Points;
  stageBackgroundImage: THREE.Mesh;
  stageBackgroundModel: THREE.Mesh;
  wormholeBackdrop: WormholeBackdrop;
  stageAtmosphereId: string;
}

export interface SceneOptions {
  onCombatAudioCue?: (event: CombatVfxEvent, cue: VfxSoundCuePreset) => void;
}

function getClampedPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
}

function addArena(scene: THREE.Scene): {
  boundary: THREE.LineLoop;
  gravityWell: THREE.Mesh;
  ring: THREE.Mesh;
} {
  const boundaryPoints: THREE.Vector3[] = [];
  const segments = 128;
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    boundaryPoints.push(new THREE.Vector3(Math.cos(t) * ARENA_RADIUS, Math.sin(t) * ARENA_RADIUS, 0));
  }

  const boundary = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(boundaryPoints),
    new THREE.LineBasicMaterial({ color: '#4766a8', transparent: true, opacity: 0.26 }),
  );
  boundary.position.z = 0.2;
  scene.add(boundary);

  const gravityWell = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS * 1.02, 16, 220, 96, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#27388e',
      emissive: '#5b1fcf',
      emissiveIntensity: 1.2,
      metalness: 0.2,
      roughness: 0.62,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  gravityWell.rotation.x = Math.PI / 2;
  gravityWell.position.z = -108;
  scene.add(gravityWell);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS * 1.005, 0.95, 24, 128),
    new THREE.MeshBasicMaterial({ color: '#9f82ff', transparent: true, opacity: 0.26 }),
  );
  ring.position.z = 0.1;
  scene.add(ring);

  return { boundary, gravityWell, ring };
}

function addStars(scene: THREE.Scene): THREE.Points {
  const stars = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: '#99a8ff', size: 0.46, transparent: true, opacity: 0.9 }),
  );
  const points: number[] = [];
  for (let i = 0; i < 1500; i += 1) {
    points.push((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, -10 - Math.random() * 120);
  }
  stars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  scene.add(stars);
  return stars;
}

function addStageBackgroundImage(scene: THREE.Scene): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 250),
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, 0, -180);
  mesh.visible = false;
  mesh.userData.textureId = null;
  scene.add(mesh);
  return mesh;
}

function addStageBackgroundModel(scene: THREE.Scene): THREE.Mesh {
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
  mesh.position.set(0, -6, -116);
  mesh.visible = false;
  mesh.userData.modelId = null;
  scene.add(mesh);
  return mesh;
}

function createWormholeRing(index: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: index % 2 === 0 ? '#63d8ff' : '#af5cff',
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const radius = Math.max(16, ARENA_RADIUS * 0.9 - index * 5.4);
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(0.22, 0.8 - index * 0.05), 18, 96),
    material,
  );
  mesh.position.z = -18 - index * 14;
  mesh.userData.baseScale = 1;
  return mesh;
}

function createSpiralArm(index: number): THREE.Mesh {
  const phase = (index / 4) * Math.PI * 2;
  const points: THREE.Vector3[] = [];
  for (let step = 0; step <= 18; step += 1) {
    const t = step / 18;
    const radius = THREE.MathUtils.lerp(ARENA_RADIUS * 0.82, 10, t);
    const angle = phase + t * Math.PI * 4.8;
    const wobble = 1 + Math.sin(t * Math.PI * 3 + index) * 0.08;
    points.push(new THREE.Vector3(
      Math.cos(angle) * radius * wobble,
      Math.sin(angle) * radius * 0.84 * wobble,
      -8 - t * 178,
    ));
  }
  const geometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points),
    96,
    1.8 - index * 0.16,
    10,
    false,
  );
  const material = new THREE.MeshBasicMaterial({
    color: index % 2 === 0 ? '#8b6bff' : '#4fcfff',
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.baseRotation = phase * 0.15;
  mesh.userData.rotationSpeed = 0.035 + index * 0.008;
  return mesh;
}

function addWormholeBackdrop(scene: THREE.Scene): WormholeBackdrop {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.visible = false;

  const core = new THREE.Mesh(
    new THREE.RingGeometry(5, 11, 96),
    new THREE.MeshBasicMaterial({
      color: '#8e6bff',
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  core.position.z = -198;
  group.add(core);

  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i += 1) {
    const ring = createWormholeRing(i);
    rings.push(ring);
    group.add(ring);
  }

  const spiralArms: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const arm = createSpiralArm(i);
    spiralArms.push(arm);
    group.add(arm);
  }

  const particlePoints: number[] = [];
  for (let i = 0; i < 420; i += 1) {
    const radius = 12 + Math.random() * (ARENA_RADIUS * 0.82);
    const angle = Math.random() * Math.PI * 2;
    const depth = -18 - Math.random() * 180;
    particlePoints.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      depth,
    );
  }
  const particles = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color: '#67d4ff',
      size: 0.72,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  particles.geometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePoints, 3));
  group.add(particles);

  scene.add(group);
  return {
    group,
    core,
    rings,
    spiralArms,
    particles,
  };
}

function createPlayerVisuals(scene: THREE.Scene): {
  playerVisuals: PlayersById<CharacterVisualHandle>;
  playerMeshes: PlayersById<THREE.Object3D>;
} {
  const p1Visual = createCharacterVisualHandle(DEFAULT_CHARACTER_LOADOUT.P1, 'P1');
  const p2Visual = createCharacterVisualHandle(DEFAULT_CHARACTER_LOADOUT.P2, 'P2');
  scene.add(p1Visual.node, p2Visual.node);
  return {
    playerVisuals: {
      P1: p1Visual,
      P2: p2Visual,
    },
    playerMeshes: {
      P1: p1Visual.node,
      P2: p2Visual.node,
    },
  };
}

function createIndicator(scene: THREE.Scene, radius: number, thickness: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, thickness, 16, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

function createPlayerIndicators(scene: THREE.Scene): PlayersById<PlayerIndicatorMeshes> {
  return {
    P1: {
      parry: createIndicator(scene, 3.0, 0.14, '#b4fbff'),
      launch: createIndicator(scene, 3.35, 0.2, '#ffcb61'),
      special: createIndicator(scene, 2.6, 0.12, '#58b6ff'),
      break: createIndicator(scene, 3.8, 0.16, '#ff9f48'),
      dunk: createIndicator(scene, 4.3, 0.2, '#8affb6'),
    },
    P2: {
      parry: createIndicator(scene, 3.0, 0.14, '#ffd9f0'),
      launch: createIndicator(scene, 3.35, 0.2, '#ffcb61'),
      special: createIndicator(scene, 2.6, 0.12, '#ff74b8'),
      break: createIndicator(scene, 3.8, 0.16, '#ff9f48'),
      dunk: createIndicator(scene, 4.3, 0.2, '#8affb6'),
    },
  };
}

export function createScene(canvas: HTMLCanvasElement, options?: SceneOptions): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(getClampedPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#040816');

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 0, 90);

  const ambient = new THREE.AmbientLight('#b6c8ff', 0.5);
  const keyLight = new THREE.DirectionalLight('#d5e4ff', 1.3);
  keyLight.position.set(24, 16, 35);
  scene.add(ambient, keyLight);

  const { boundary, gravityWell, ring } = addArena(scene);
  const stars = addStars(scene);
  const stageBackgroundImage = addStageBackgroundImage(scene);
  const stageBackgroundModel = addStageBackgroundModel(scene);
  const wormholeBackdrop = addWormholeBackdrop(scene);
  const { playerVisuals, playerMeshes } = createPlayerVisuals(scene);
  const playerIndicators = createPlayerIndicators(scene);
  const combatVfxRuntime = createCombatVfxRuntime(scene, {
    onAudioCue: options?.onCombatAudioCue,
  });

  const context: SceneContext = {
    renderer,
    scene,
    camera,
    cameraTarget: camera.position.clone(),
    lookAtTarget: new THREE.Vector3(),
    cameraPlayerTracks: {
      P1: new THREE.Vector2(-30, 6),
      P2: new THREE.Vector2(30, -6),
    },
    launchCameraActive: false,
    gravityWell,
    ring,
    playerVisuals,
    playerMeshes,
    playerIndicators,
    projectileMeshes: new Map<number, THREE.Mesh>(),
    combatVfxRuntime,
    lastRenderSnapshot: null,
    ambientLight: ambient,
    keyLight,
    arenaBoundary: boundary,
    stars,
    stageBackgroundImage,
    stageBackgroundModel,
    wormholeBackdrop,
    stageAtmosphereId: DEFAULT_STAGE_ATMOSPHERE_ID,
  };
  applyStageAtmospherePreset(context, DEFAULT_STAGE_ATMOSPHERE_ID);
  return context;
}

export function resizeScene(context: SceneContext): void {
  context.renderer.setPixelRatio(getClampedPixelRatio());
  context.renderer.setSize(window.innerWidth, window.innerHeight);
  context.camera.aspect = window.innerWidth / window.innerHeight;
  context.camera.updateProjectionMatrix();
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

export function applyStageAtmospherePreset(context: SceneContext, atmosphereId: string): string {
  const preset = resolveStageAtmosphere(atmosphereId);
  const tokens = preset.tokens;

  context.stageAtmosphereId = preset.id;
  context.scene.background = new THREE.Color(tokens.sceneBackgroundColor);
  context.scene.fog = new THREE.Fog(tokens.fogColor, tokens.fogNear, tokens.fogFar);

  context.ambientLight.color.set(tokens.ambientLightColor);
  context.ambientLight.intensity = tokens.ambientLightIntensity;
  context.keyLight.color.set(tokens.keyLightColor);
  context.keyLight.intensity = tokens.keyLightIntensity;
  context.keyLight.position.set(tokens.keyLightPositionX, tokens.keyLightPositionY, tokens.keyLightPositionZ);

  const boundaryMaterial = context.arenaBoundary.material as THREE.LineBasicMaterial;
  boundaryMaterial.color.set(tokens.ringColor);
  boundaryMaterial.opacity = clampOpacity(tokens.ringOpacity) * 0.24;

  const gravityWellMaterial = context.gravityWell.material as THREE.MeshStandardMaterial;
  gravityWellMaterial.color.set(tokens.gravityWellColor);
  gravityWellMaterial.emissive.set(tokens.gravityWellEmissive);
  gravityWellMaterial.emissiveIntensity = tokens.gravityWellEmissiveIntensity * 0.42;
  gravityWellMaterial.opacity = clampOpacity(tokens.backgroundEffectOpacity) * 0.26;

  const ringMaterial = context.ring.material as THREE.MeshBasicMaterial;
  ringMaterial.color.set(tokens.ringColor);
  ringMaterial.opacity = clampOpacity(tokens.ringOpacity);

  const starsMaterial = context.stars.material as THREE.PointsMaterial;
  starsMaterial.color.set(tokens.starsColor);
  starsMaterial.size = tokens.starsSize * 1.5;
  starsMaterial.opacity = 0.92;

  const imageMaterial = context.stageBackgroundImage.material as THREE.MeshBasicMaterial;
  imageMaterial.color.set(tokens.backgroundImageTint);
  imageMaterial.opacity = clampOpacity(tokens.backgroundImageOpacity);
  context.stageBackgroundImage.visible = Boolean(tokens.backgroundImageTextureId);
  context.stageBackgroundImage.userData.textureId = tokens.backgroundImageTextureId ?? null;

  const modelMaterial = context.stageBackgroundModel.material as THREE.MeshStandardMaterial;
  modelMaterial.color.set(tokens.backgroundModelTint);
  modelMaterial.opacity = clampOpacity(tokens.backgroundModelOpacity);
  context.stageBackgroundModel.visible = Boolean(tokens.backgroundModelId);
  context.stageBackgroundModel.userData.modelId = tokens.backgroundModelId ?? null;

  const wormholeVisible = tokens.backgroundEffectId === 'wormhole_v1';
  context.wormholeBackdrop.group.visible = wormholeVisible;
  context.wormholeBackdrop.group.scale.setScalar(tokens.backgroundEffectScale);
  context.wormholeBackdrop.group.userData.effectId = tokens.backgroundEffectId ?? null;
  context.wormholeBackdrop.group.userData.effectOpacity = clampOpacity(tokens.backgroundEffectOpacity);
  context.wormholeBackdrop.group.userData.effectSpeed = Math.max(0, tokens.backgroundEffectSpeed);

  const coreMaterial = context.wormholeBackdrop.core.material as THREE.MeshBasicMaterial;
  coreMaterial.color.set(tokens.backgroundEffectSecondaryTint);
  coreMaterial.opacity = clampOpacity(tokens.backgroundEffectOpacity) * 0.24;

  context.wormholeBackdrop.rings.forEach((ring, index) => {
    const ringMaterial = ring.material as THREE.MeshBasicMaterial;
    ringMaterial.color.set(index % 2 === 0 ? tokens.backgroundEffectTint : tokens.backgroundEffectSecondaryTint);
    ringMaterial.opacity = clampOpacity(tokens.backgroundEffectOpacity) * (0.03 + index * 0.006);
  });

  context.wormholeBackdrop.spiralArms.forEach((arm, index) => {
    const armMaterial = arm.material as THREE.MeshBasicMaterial;
    armMaterial.color.set(index % 2 === 0 ? tokens.backgroundEffectSecondaryTint : tokens.backgroundEffectTint);
    armMaterial.opacity = clampOpacity(tokens.backgroundEffectOpacity) * (0.11 - index * 0.012);
  });

  const particleMaterial = context.wormholeBackdrop.particles.material as THREE.PointsMaterial;
  particleMaterial.color.set(tokens.backgroundEffectTint);
  particleMaterial.opacity = clampOpacity(tokens.backgroundEffectOpacity) * 0.72;

  return preset.id;
}
