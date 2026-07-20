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
import {
  createArenaLipDepthSegmentPoints,
  createArenaLipShelfTriangleVertices,
  createArenaLipSegmentPoints,
  createArenaGuideSegmentPoints,
  MAX_STAGE_CAMERA_PITCH_DEGREES,
} from './stagePresentation';
import type { AssetFileEntry } from './assets/types';
import {
  createImageTextureLibrary,
  getImageTexture,
  type ImageTextureLibrary,
} from './assets/imageTextureLibrary';
import {
  applyStageModelSelection,
  createStageModelRuntime,
  type StageModelRuntime,
} from './stageModelRuntime';
import {
  ACTION_READABILITY_BY_ID,
  ACTION_READABILITY_DEFINITIONS,
  type ActionReadabilityId,
} from './actionReadability';

const MIN_RENDER_PIXEL_RATIO = 0.25;
const MAX_RENDER_PIXEL_RATIO = 2;

type PlayerIndicatorMeshes = Record<ActionReadabilityId, THREE.Group>;

interface WormholeBackdrop {
  group: THREE.Group;
  core: THREE.Mesh;
  rings: THREE.Mesh[];
  spiralArms: THREE.Mesh[];
  particles: THREE.Points;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  renderPixelRatio: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  lookAtTarget: THREE.Vector3;
  cameraPlayerTracks: PlayersById<THREE.Vector2>;
  launchCameraActive: boolean;
  cameraPitchDegrees: number;
  cameraLaunchPitchBoostDegrees: number;
  cameraLookAtYOffset: number;
  gravityWell: THREE.Mesh;
  ring: THREE.Mesh;
  arenaMouth: THREE.Mesh;
  arenaRim: THREE.LineSegments;
  arenaLipShelf: THREE.Mesh;
  arenaLipDepth: THREE.LineSegments;
  arenaDepthTicks: THREE.LineSegments;
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
  imageTextureLibrary: ImageTextureLibrary;
  stageBackgroundModel: StageModelRuntime;
  wormholeBackdrop: WormholeBackdrop;
  stageAtmosphereId: string;
}

export interface SceneOptions {
  onCombatAudioCue?: (event: CombatVfxEvent, cue: VfxSoundCuePreset) => void;
  stageModelEntries?: AssetFileEntry[];
  textureEntries?: AssetFileEntry[];
}

function getClampedPixelRatio(requestedPixelRatio = 1): number {
  return Math.max(
    MIN_RENDER_PIXEL_RATIO,
    Math.min(
      requestedPixelRatio,
      window.devicePixelRatio || 1,
      MAX_RENDER_PIXEL_RATIO,
    ),
  );
}

function createGravityWellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.34 },
      uFarFade: { value: 0.46 },
      uColorA: { value: new THREE.Color('#27388e') },
      uColorB: { value: new THREE.Color('#5b1fcf') },
      uHighlight: { value: new THREE.Color('#61d9ff') },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        vUv = uv;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform float uOpacity;
      uniform float uFarFade;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uHighlight;
      varying vec2 vUv;
      varying vec3 vPosition;

      float filament(float value, float width) {
        return pow(0.5 + 0.5 * sin(value), width);
      }

      void main() {
        float depth = clamp(1.0 - vUv.y, 0.0, 1.0);
        float circumference = vUv.x * 6.28318530718;
        float slowTime = uTime * 0.34;
        float twistA = filament(circumference * 3.0 + depth * 18.0 - slowTime, 7.0);
        float twistB = filament(-circumference * 5.0 + depth * 27.0 + slowTime * 0.72, 10.0);
        float rib = filament(depth * 92.0 + sin(circumference * 4.0) * 2.4 - slowTime * 0.45, 12.0);
        float turbulence = 0.5 + 0.5 * sin(
          circumference * 11.0
          + depth * 43.0
          + sin(circumference * 3.0 + depth * 9.0) * 2.0
        );
        float energy = clamp(twistA * 0.78 + twistB * 0.48 + rib * 0.34 + turbulence * 0.12, 0.0, 1.0);
        float mouthFade = smoothstep(0.015, 0.14, depth);
        float deepFade = 1.0 - smoothstep(0.72, 1.0, depth) * uFarFade;
        vec3 baseColor = mix(uColorA, uColorB, clamp(depth * 0.9 + twistA * 0.2, 0.0, 1.0));
        vec3 color = mix(baseColor, uHighlight, energy * 0.46);
        float alpha = uOpacity * mouthFade * deepFade * (0.18 + energy * 0.78);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function createArenaMouthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uColorA: { value: new THREE.Color('#56bfff') },
      uColorB: { value: new THREE.Color('#8d4cff') },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uOpacity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;

      float filament(float value, float width) {
        return pow(0.5 + 0.5 * sin(value), width);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float radius = length(p);
        float angle = atan(p.y, p.x);
        float warpedRadius = radius
          + sin(angle * 5.0) * 0.012
          + sin(angle * 11.0 + radius * 3.0) * 0.006;
        float outerFade = 1.0 - smoothstep(0.84, 0.99, warpedRadius);
        float pitFade = smoothstep(0.12, 0.36, warpedRadius);
        float shearA = filament(angle * 6.0 - warpedRadius * 23.0 + sin(angle * 3.0) * 0.9, 15.0);
        float shearB = filament(-angle * 9.0 - warpedRadius * 17.0, 19.0);
        float dash = 0.35 + filament(warpedRadius * 78.0 + angle * 2.0, 18.0) * 0.65;
        float lane = filament(angle * 14.0 + warpedRadius * 6.0, 34.0) * dash;
        float contour = filament(warpedRadius * 54.0 + sin(angle * 4.0) * 1.4, 28.0);
        float sectorBreak = smoothstep(0.18, 0.82, 0.5 + 0.5 * sin(angle * 11.0 + warpedRadius * 5.0));
        float energy = 0.032
          + shearA * 0.2
          + shearB * 0.09
          + lane * 0.3
          + contour * sectorBreak * 0.24;
        vec3 color = mix(uColorA, uColorB, 0.42 + 0.28 * sin(angle * 2.0 + radius * 5.0));
        float alpha = uOpacity * outerFade * pitFade * energy;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function createArenaLipShelfMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.24 },
      uOuterColor: { value: new THREE.Color('#56bfff') },
      uInnerColor: { value: new THREE.Color('#231b58') },
    },
    vertexShader: `
      attribute float aBand;
      varying float vBand;
      varying vec3 vPosition;

      void main() {
        vBand = aBand;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uOpacity;
      uniform vec3 uOuterColor;
      uniform vec3 uInnerColor;
      varying float vBand;
      varying vec3 vPosition;

      void main() {
        float outerEnergy = smoothstep(0.0, 1.0, vBand);
        float striation = 0.78 + 0.22 * sin(vPosition.x * 0.42 + vPosition.y * 0.18);
        vec3 color = mix(uInnerColor, uOuterColor, outerEnergy);
        float alpha = uOpacity * mix(0.16, 0.72, outerEnergy) * striation;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function addArena(scene: THREE.Scene): {
  boundary: THREE.LineLoop;
  gravityWell: THREE.Mesh;
  ring: THREE.Mesh;
  arenaMouth: THREE.Mesh;
  arenaRim: THREE.LineSegments;
  arenaLipShelf: THREE.Mesh;
  arenaLipDepth: THREE.LineSegments;
  arenaDepthTicks: THREE.LineSegments;
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

  const arenaMouth = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS * 1.01, 160),
    createArenaMouthMaterial(),
  );
  arenaMouth.name = 'arena-mouth-shear';
  arenaMouth.position.z = -0.12;
  arenaMouth.renderOrder = -2;
  scene.add(arenaMouth);

  const arenaLipShelfVertices = createArenaLipShelfTriangleVertices(ARENA_RADIUS);
  const arenaLipShelfGeometry = new THREE.BufferGeometry();
  arenaLipShelfGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      arenaLipShelfVertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
      3,
    ),
  );
  arenaLipShelfGeometry.setAttribute(
    'aBand',
    new THREE.Float32BufferAttribute(arenaLipShelfVertices.map((vertex) => vertex.band), 1),
  );
  const arenaLipShelf = new THREE.Mesh(arenaLipShelfGeometry, createArenaLipShelfMaterial());
  arenaLipShelf.name = 'arena-broken-lip-shelf';
  arenaLipShelf.renderOrder = -1;
  scene.add(arenaLipShelf);

  const arenaLipPoints = createArenaLipSegmentPoints(ARENA_RADIUS).map(
    (point) => new THREE.Vector3(point.x, point.y, point.z),
  );
  const arenaRim = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(arenaLipPoints),
    new THREE.LineBasicMaterial({
      color: '#8f78ff',
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  arenaRim.name = 'arena-broken-lip';
  arenaRim.position.z = -0.32;
  scene.add(arenaRim);

  const arenaLipDepthPoints = createArenaLipDepthSegmentPoints(ARENA_RADIUS).map(
    (point) => new THREE.Vector3(point.x, point.y, point.z),
  );
  const arenaLipDepth = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(arenaLipDepthPoints),
    new THREE.LineBasicMaterial({
      color: '#56bfff',
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  arenaLipDepth.name = 'arena-broken-lip-depth';
  arenaLipDepth.renderOrder = -1;
  scene.add(arenaLipDepth);

  const tickPoints = createArenaGuideSegmentPoints(ARENA_RADIUS).map(
    (point) => new THREE.Vector3(point.x, point.y, point.z),
  );
  const arenaDepthTicks = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(tickPoints),
    new THREE.LineBasicMaterial({
      color: '#8f78ff',
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  arenaDepthTicks.name = 'arena-broken-depth-guides';
  scene.add(arenaDepthTicks);

  const gravityWell = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS * 1.02, 8, 220, 128, 32, true),
    createGravityWellMaterial(),
  );
  gravityWell.rotation.x = Math.PI / 2;
  gravityWell.position.z = -108;
  scene.add(gravityWell);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS * 1.005, 0.32, 12, 160),
    new THREE.MeshBasicMaterial({
      color: '#9f82ff',
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.position.z = 0.1;
  scene.add(ring);

  return {
    boundary,
    gravityWell,
    ring,
    arenaMouth,
    arenaRim,
    arenaLipShelf,
    arenaLipDepth,
    arenaDepthTicks,
  };
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
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  mesh.position.set(0, 0, -180);
  mesh.visible = false;
  mesh.renderOrder = -100;
  mesh.userData.textureId = null;
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
  const radius = Math.max(12, ARENA_RADIUS * 0.9 - index * 5.4);
  const phase = index * 0.83;
  const points: THREE.Vector3[] = [];
  for (let segment = 0; segment < 96; segment += 1) {
    const angle = (segment / 96) * Math.PI * 2;
    const wobble = 1
      + Math.sin(angle * 3 + phase) * 0.024
      + Math.sin(angle * 7 - phase * 0.7) * 0.012;
    points.push(new THREE.Vector3(
      Math.cos(angle) * radius * wobble,
      Math.sin(angle) * radius * wobble,
      Math.sin(angle * 5 + phase) * 0.55,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 128, Math.max(0.18, 0.58 - index * 0.035), 7, true),
    material,
  );
  const baseDepth = -18 - index * 14;
  mesh.position.z = baseDepth;
  mesh.userData.baseScale = 1;
  mesh.userData.baseDepth = baseDepth;
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
    new THREE.CircleGeometry(18, 96),
    new THREE.MeshBasicMaterial({
      color: '#8e6bff',
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  core.position.z = -185;
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
  const particleBaseDepths = new Float32Array(420);
  for (let i = 0; i < 420; i += 1) {
    const radius = 12 + Math.random() * (ARENA_RADIUS * 0.82);
    const angle = Math.random() * Math.PI * 2;
    const depth = -18 - Math.random() * 180;
    particlePoints.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      depth,
    );
    particleBaseDepths[i] = depth;
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
  particles.userData.baseDepths = particleBaseDepths;
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

function createIndicatorMaterial(color: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function addIndicatorRing(
  group: THREE.Group,
  color: string,
  innerRadius: number,
  outerRadius: number,
  segments: number,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
): void {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(innerRadius, outerRadius, segments, 1, thetaStart, thetaLength),
    createIndicatorMaterial(color),
  );
  mesh.renderOrder = 5;
  group.add(mesh);
}

function createIndicator(scene: THREE.Scene, id: ActionReadabilityId): THREE.Group {
  const definition = ACTION_READABILITY_BY_ID[id];
  const group = new THREE.Group();
  group.name = `action-indicator-${id}`;
  group.visible = false;
  let baseRotation = 0;
  let rotationSpeed = 0;

  switch (id) {
    case 'boost':
      addIndicatorRing(group, definition.color, 4.0, 4.55, 48, -Math.PI * 0.72, Math.PI * 1.45);
      rotationSpeed = 1.25;
      break;
    case 'super_boost':
      addIndicatorRing(group, definition.color, 3.75, 4.05, 48);
      addIndicatorRing(group, definition.color, 4.48, 4.82, 48);
      rotationSpeed = -1.75;
      break;
    case 'special':
      addIndicatorRing(group, definition.color, 3.85, 4.65, 3);
      baseRotation = Math.PI / 2;
      rotationSpeed = 0.45;
      break;
    case 'launch':
      addIndicatorRing(group, definition.color, 3.9, 4.72, 4);
      baseRotation = Math.PI / 4;
      break;
    case 'dunk':
      addIndicatorRing(group, definition.color, 4.0, 4.82, 3);
      baseRotation = -Math.PI / 2;
      break;
    case 'parry':
      addIndicatorRing(group, definition.color, 3.9, 4.55, 6);
      baseRotation = Math.PI / 6;
      rotationSpeed = -0.35;
      break;
    case 'launch_break':
      addIndicatorRing(group, definition.color, 4.05, 5.0, 8);
      baseRotation = Math.PI / 8;
      rotationSpeed = 1.8;
      break;
  }

  group.userData.motion = [baseRotation, rotationSpeed];
  scene.add(group);
  return group;
}

function createPlayerIndicatorSet(scene: THREE.Scene): PlayerIndicatorMeshes {
  return Object.fromEntries(
    ACTION_READABILITY_DEFINITIONS.map((definition) => [
      definition.id,
      createIndicator(scene, definition.id),
    ]),
  ) as PlayerIndicatorMeshes;
}

function createPlayerIndicators(scene: THREE.Scene): PlayersById<PlayerIndicatorMeshes> {
  return {
    P1: createPlayerIndicatorSet(scene),
    P2: createPlayerIndicatorSet(scene),
  };
}

export function createScene(canvas: HTMLCanvasElement, options?: SceneOptions): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const renderPixelRatio = getClampedPixelRatio();
  renderer.setPixelRatio(renderPixelRatio);
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

  const {
    boundary,
    gravityWell,
    ring,
    arenaMouth,
    arenaRim,
    arenaLipShelf,
    arenaLipDepth,
    arenaDepthTicks,
  } = addArena(scene);
  const stars = addStars(scene);
  const stageBackgroundImage = addStageBackgroundImage(scene);
  const imageTextureLibrary = createImageTextureLibrary(options?.textureEntries ?? []);
  const stageBackgroundModel = createStageModelRuntime(scene, options?.stageModelEntries ?? []);
  const wormholeBackdrop = addWormholeBackdrop(scene);
  const { playerVisuals, playerMeshes } = createPlayerVisuals(scene);
  const playerIndicators = createPlayerIndicators(scene);
  const combatVfxRuntime = createCombatVfxRuntime(scene, {
    onAudioCue: options?.onCombatAudioCue,
    resolveTexture: (textureId) => getImageTexture(imageTextureLibrary, textureId),
  });

  const context: SceneContext = {
    renderer,
    renderPixelRatio,
    scene,
    camera,
    cameraTarget: camera.position.clone(),
    lookAtTarget: new THREE.Vector3(),
    cameraPlayerTracks: {
      P1: new THREE.Vector2(-30, 6),
      P2: new THREE.Vector2(30, -6),
    },
    launchCameraActive: false,
    cameraPitchDegrees: 8,
    cameraLaunchPitchBoostDegrees: 1.5,
    cameraLookAtYOffset: 2.2,
    gravityWell,
    ring,
    arenaMouth,
    arenaRim,
    arenaLipShelf,
    arenaLipDepth,
    arenaDepthTicks,
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
    imageTextureLibrary,
    stageBackgroundModel,
    wormholeBackdrop,
    stageAtmosphereId: DEFAULT_STAGE_ATMOSPHERE_ID,
  };
  applyStageAtmospherePreset(context, DEFAULT_STAGE_ATMOSPHERE_ID);
  return context;
}

export function resizeScene(context: SceneContext): void {
  context.renderer.setPixelRatio(context.renderPixelRatio);
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
  context.renderer.domElement.dataset.stageAtmosphereId = preset.id;
  context.renderer.domElement.dataset.stageModelId = tokens.backgroundModelId ?? '';
  context.scene.background = new THREE.Color(tokens.sceneBackgroundColor);
  context.scene.fog = new THREE.Fog(tokens.fogColor, tokens.fogNear, tokens.fogFar);

  context.ambientLight.color.set(tokens.ambientLightColor);
  context.ambientLight.intensity = tokens.ambientLightIntensity;
  context.keyLight.color.set(tokens.keyLightColor);
  context.keyLight.intensity = tokens.keyLightIntensity;
  context.keyLight.position.set(tokens.keyLightPositionX, tokens.keyLightPositionY, tokens.keyLightPositionZ);
  context.cameraPitchDegrees = THREE.MathUtils.clamp(
    tokens.cameraPitchDegrees,
    0,
    MAX_STAGE_CAMERA_PITCH_DEGREES,
  );
  context.cameraLaunchPitchBoostDegrees = THREE.MathUtils.clamp(
    tokens.cameraLaunchPitchBoostDegrees,
    0,
    10,
  );
  context.cameraLookAtYOffset = THREE.MathUtils.clamp(tokens.cameraLookAtYOffset, -12, 12);

  const boundaryMaterial = context.arenaBoundary.material as THREE.LineBasicMaterial;
  boundaryMaterial.color.set(tokens.ringColor);
  boundaryMaterial.opacity = clampOpacity(tokens.ringOpacity) * 0.24;
  context.arenaBoundary.visible = boundaryMaterial.opacity > 0;

  const arenaMouthMaterial = context.arenaMouth.material;
  if (arenaMouthMaterial instanceof THREE.ShaderMaterial) {
    arenaMouthMaterial.uniforms.uColorA.value.set(tokens.backgroundEffectTint);
    arenaMouthMaterial.uniforms.uColorB.value.set(tokens.backgroundEffectSecondaryTint);
    arenaMouthMaterial.uniforms.uOpacity.value = clampOpacity(tokens.arenaMouthOpacity);
  }
  context.arenaMouth.visible = tokens.arenaMouthOpacity > 0;

  const arenaRimMaterial = context.arenaRim.material as THREE.LineBasicMaterial;
  arenaRimMaterial.color.set(tokens.ringColor);
  arenaRimMaterial.opacity = clampOpacity(tokens.arenaRimOpacity);
  context.arenaRim.visible = arenaRimMaterial.opacity > 0;

  const arenaLipShelfMaterial = context.arenaLipShelf.material;
  if (arenaLipShelfMaterial instanceof THREE.ShaderMaterial) {
    arenaLipShelfMaterial.uniforms.uOuterColor.value.set(tokens.backgroundEffectTint);
    arenaLipShelfMaterial.uniforms.uInnerColor.value.set(tokens.backgroundEffectSecondaryTint);
    arenaLipShelfMaterial.uniforms.uOpacity.value = clampOpacity(tokens.arenaRimOpacity * 0.9);
  }
  context.arenaLipShelf.visible = tokens.arenaRimOpacity > 0;

  const arenaLipDepthMaterial = context.arenaLipDepth.material as THREE.LineBasicMaterial;
  arenaLipDepthMaterial.color.set(tokens.backgroundEffectTint);
  arenaLipDepthMaterial.opacity = clampOpacity(tokens.arenaRimOpacity * 0.72);
  context.arenaLipDepth.visible = arenaLipDepthMaterial.opacity > 0;

  const arenaDepthTickMaterial = context.arenaDepthTicks.material as THREE.LineBasicMaterial;
  arenaDepthTickMaterial.color.set(tokens.ringColor);
  arenaDepthTickMaterial.opacity = clampOpacity(tokens.arenaDepthTickOpacity);
  context.arenaDepthTicks.visible = arenaDepthTickMaterial.opacity > 0;

  const gravityWellMaterial = context.gravityWell.material;
  if (gravityWellMaterial instanceof THREE.ShaderMaterial) {
    gravityWellMaterial.uniforms.uColorA.value.set(tokens.gravityWellColor);
    gravityWellMaterial.uniforms.uColorB.value.set(tokens.gravityWellEmissive);
    gravityWellMaterial.uniforms.uHighlight.value.set(tokens.backgroundEffectTint);
    gravityWellMaterial.uniforms.uOpacity.value = clampOpacity(tokens.backgroundEffectOpacity) * 0.5;
    gravityWellMaterial.uniforms.uFarFade.value = THREE.MathUtils.clamp(
      tokens.backgroundEffectFarFade,
      0,
      1,
    );
  }

  const ringMaterial = context.ring.material as THREE.MeshBasicMaterial;
  ringMaterial.color.set(tokens.ringColor);
  ringMaterial.opacity = clampOpacity(tokens.ringOpacity);
  context.ring.visible = ringMaterial.opacity > 0;
  context.ring.userData.baseOpacity = ringMaterial.opacity;

  const starsMaterial = context.stars.material as THREE.PointsMaterial;
  starsMaterial.color.set(tokens.starsColor);
  starsMaterial.size = tokens.starsSize * 1.5;
  starsMaterial.opacity = 0.92;
  context.stars.userData.baseSize = starsMaterial.size;
  context.stars.userData.baseOpacity = starsMaterial.opacity;

  const imageMaterial = context.stageBackgroundImage.material as THREE.MeshBasicMaterial;
  const backgroundTexture = getImageTexture(context.imageTextureLibrary, tokens.backgroundImageTextureId);
  if (imageMaterial.map !== backgroundTexture) {
    imageMaterial.map = backgroundTexture;
    imageMaterial.needsUpdate = true;
  }
  imageMaterial.color.set(tokens.backgroundImageTint);
  imageMaterial.opacity = clampOpacity(tokens.backgroundImageOpacity);
  context.stageBackgroundImage.visible = Boolean(backgroundTexture) && imageMaterial.opacity > 0;
  context.stageBackgroundImage.userData.textureId = tokens.backgroundImageTextureId ?? null;
  context.stageBackgroundImage.userData.visibleTextureId = backgroundTexture
    ? tokens.backgroundImageTextureId
    : null;
  context.renderer.domElement.dataset.stageTextureId = tokens.backgroundImageTextureId ?? '';
  context.renderer.domElement.dataset.stageTextureVisibleId = backgroundTexture
    ? tokens.backgroundImageTextureId ?? ''
    : '';

  applyStageModelSelection(
    context.stageBackgroundModel,
    tokens.backgroundModelId,
    tokens.backgroundModelTint,
    tokens.backgroundModelOpacity,
  );
  context.renderer.domElement.dataset.stageModelVisibleId = typeof context.stageBackgroundModel.root.userData.visibleModelId === 'string'
    ? context.stageBackgroundModel.root.userData.visibleModelId
    : '';

  const wormholeVisible = tokens.backgroundEffectId === 'wormhole_v1';
  context.wormholeBackdrop.group.visible = wormholeVisible;
  context.wormholeBackdrop.group.scale.setScalar(tokens.backgroundEffectScale);
  context.wormholeBackdrop.group.userData.effectId = tokens.backgroundEffectId ?? null;
  context.wormholeBackdrop.group.userData.effectOpacity = clampOpacity(tokens.backgroundEffectOpacity);
  context.wormholeBackdrop.group.userData.effectCoreOpacity = clampOpacity(
    tokens.backgroundEffectCoreOpacity,
  );
  context.wormholeBackdrop.group.userData.effectSpeed = Math.max(0, tokens.backgroundEffectSpeed);
  context.wormholeBackdrop.group.userData.effectDepthTravel = Math.max(
    0,
    tokens.backgroundEffectDepthTravel,
  );

  const coreMaterial = context.wormholeBackdrop.core.material as THREE.MeshBasicMaterial;
  coreMaterial.color.set(tokens.backgroundEffectSecondaryTint);
  coreMaterial.opacity = clampOpacity(tokens.backgroundEffectOpacity)
    * clampOpacity(tokens.backgroundEffectCoreOpacity);

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

export function setScenePixelRatio(context: SceneContext, pixelRatio: number): number {
  const resolvedPixelRatio = getClampedPixelRatio(pixelRatio);
  context.renderPixelRatio = resolvedPixelRatio;
  context.renderer.setPixelRatio(resolvedPixelRatio);
  context.renderer.setSize(window.innerWidth, window.innerHeight);
  return resolvedPixelRatio;
}
