import * as THREE from 'three';
import type { PlayersById } from '../sim/types';
import { ARENA_RADIUS } from '../sim/constants';

const MAX_RENDER_PIXEL_RATIO = 1.25;

interface PlayerIndicatorMeshes {
  parry: THREE.Mesh;
  launch: THREE.Mesh;
  special: THREE.Mesh;
  break: THREE.Mesh;
  dunk: THREE.Mesh;
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
  playerMeshes: PlayersById<THREE.Group>;
  playerIndicators: PlayersById<PlayerIndicatorMeshes>;
  projectileMeshes: Map<number, THREE.Mesh>;
}

function getClampedPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
}

function makeMech(color: string, wingColor: string): THREE.Group {
  const mech = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.4, 2.7, 8, 14),
    new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55 }),
  );
  body.rotation.z = Math.PI / 2;
  mech.add(body);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 16, 16),
    new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 1.6 }),
  );
  core.position.z = 1;
  mech.add(core);

  const wingGeo = new THREE.ConeGeometry(1.2, 3.4, 3);
  const wingMat = new THREE.MeshStandardMaterial({
    color: wingColor,
    transparent: true,
    opacity: 0.6,
    emissive: wingColor,
    emissiveIntensity: 0.25,
  });

  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(-0.8, 0, -0.2);
  leftWing.rotation.set(Math.PI / 2, 0, Math.PI * 0.2);
  mech.add(leftWing);

  const rightWing = leftWing.clone();
  rightWing.position.x *= -1;
  rightWing.rotation.z *= -1;
  mech.add(rightWing);

  return mech;
}

function addArena(scene: THREE.Scene): { gravityWell: THREE.Mesh; ring: THREE.Mesh } {
  const boundaryPoints: THREE.Vector3[] = [];
  const segments = 128;
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    boundaryPoints.push(new THREE.Vector3(Math.cos(t) * ARENA_RADIUS, Math.sin(t) * ARENA_RADIUS, 0));
  }

  const boundary = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(boundaryPoints),
    new THREE.LineBasicMaterial({ color: '#4766a8' }),
  );
  scene.add(boundary);

  const gravityWell = new THREE.Mesh(
    new THREE.SphereGeometry(7, 32, 32),
    new THREE.MeshStandardMaterial({
      color: '#7f3fff',
      emissive: '#5b1fcf',
      emissiveIntensity: 1.2,
      metalness: 0.2,
      roughness: 0.6,
    }),
  );
  scene.add(gravityWell);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(12, 0.45, 20, 64),
    new THREE.MeshBasicMaterial({ color: '#9f82ff', transparent: true, opacity: 0.5 }),
  );
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  return { gravityWell, ring };
}

function addStars(scene: THREE.Scene): void {
  const stars = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: '#99a8ff', size: 0.35 }),
  );
  const points: number[] = [];
  for (let i = 0; i < 1500; i += 1) {
    points.push((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, -10 - Math.random() * 120);
  }
  stars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  scene.add(stars);
}

function createPlayerMeshes(scene: THREE.Scene): PlayersById<THREE.Group> {
  const p1Mesh = makeMech('#58b6ff', '#7db7ff');
  const p2Mesh = makeMech('#ff74b8', '#ff9fd0');
  scene.add(p1Mesh, p2Mesh);
  return {
    P1: p1Mesh,
    P2: p2Mesh,
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

export function createScene(canvas: HTMLCanvasElement): SceneContext {
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

  const { gravityWell, ring } = addArena(scene);
  addStars(scene);
  const playerMeshes = createPlayerMeshes(scene);
  const playerIndicators = createPlayerIndicators(scene);

  return {
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
    playerMeshes,
    playerIndicators,
    projectileMeshes: new Map<number, THREE.Mesh>(),
  };
}

export function resizeScene(context: SceneContext): void {
  context.renderer.setPixelRatio(getClampedPixelRatio());
  context.renderer.setSize(window.innerWidth, window.innerHeight);
  context.camera.aspect = window.innerWidth / window.innerHeight;
  context.camera.updateProjectionMatrix();
}
