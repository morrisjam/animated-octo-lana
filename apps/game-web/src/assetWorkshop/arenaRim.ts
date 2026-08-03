import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createGravityWellArenaRimV1Environment,
  createGravityWellArenaRimV1LookDevLights,
  frameGravityWellArenaRimV1Camera,
} from './generated/createGravityWellArenaRimV1Model';
import { createOptimizedGravityWellArenaRimV1Model } from './createOptimizedArenaRim';

type ReviewView = 'reference' | 'front' | 'left' | 'right';
type ReviewLight = 'reference' | 'neutral' | 'grazing';

declare global {
  interface Window {
    __arenaRimReviewReady?: boolean;
    __arenaRimReview?: {
      setView(view: ReviewView): void;
      setLight(light: ReviewLight): void;
    };
  }
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Arena Rim Workshop is missing #${id}.`);
  }
  return element as T;
}

const canvas = requiredElement<HTMLCanvasElement>('modelCanvas');
const viewLabel = requiredElement<HTMLElement>('viewLabel');
const triangleCount = requiredElement<HTMLElement>('triangleCount');
const drawCallCount = requiredElement<HTMLElement>('drawCallCount');
const meshCount = requiredElement<HTMLElement>('meshCount');
const materialCount = requiredElement<HTMLElement>('materialCount');
const status = requiredElement<HTMLElement>('workshopStatus');
const wireframeButton = requiredElement<HTMLButtonElement>('wireframeButton');
const saveFrameButton = requiredElement<HTMLButtonElement>('saveFrameButton');
const referenceImage = requiredElement<HTMLImageElement>('referenceImage');

referenceImage.src = new URL(
  '../../../../art/source/generated/arena-rim-v1/arena-rim-concept-v1.png',
  import.meta.url,
).href;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070c);
scene.environment = createGravityWellArenaRimV1Environment(renderer);

const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
const model = createOptimizedGravityWellArenaRimV1Model({
  castShadow: true,
  receiveShadow: true,
  textureSize: 512,
  textureAnisotropy: 4,
  qualityPriority: 'balanced',
});
scene.add(model);

let lightRig = createGravityWellArenaRimV1LookDevLights('reference');
scene.add(lightRig);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 4;
controls.maxDistance = 24;
controls.enablePan = false;

const viewSettings: Record<ReviewView, {
  label: string;
  azimuthDeg: number;
  elevationDeg: number;
}> = {
  reference: {
    label: 'Reference three-quarter',
    azimuthDeg: -10,
    elevationDeg: -24,
  },
  front: {
    label: 'Front orthographic read',
    azimuthDeg: 0,
    elevationDeg: 0,
  },
  left: {
    label: 'Left orbit / 30 degrees',
    azimuthDeg: -30,
    elevationDeg: -16,
  },
  right: {
    label: 'Right orbit / 30 degrees',
    azimuthDeg: 30,
    elevationDeg: -16,
  },
};

function frameView(view: ReviewView): void {
  const settings = viewSettings[view];
  frameGravityWellArenaRimV1Camera(camera, model, {
    margin: 1.22,
    azimuthDeg: settings.azimuthDeg,
    elevationDeg: settings.elevationDeg,
  });
  const bounds = new THREE.Box3().setFromObject(model);
  controls.target.copy(bounds.getCenter(new THREE.Vector3()));
  controls.update();
  viewLabel.textContent = settings.label;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}

function setLight(light: ReviewLight): void {
  scene.remove(lightRig);
  lightRig = createGravityWellArenaRimV1LookDevLights(light);
  scene.add(lightRig);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-light]')) {
    button.setAttribute('aria-pressed', String(button.dataset.light === light));
  }
}

function toggleWireframe(): void {
  const enabled = wireframeButton.getAttribute('aria-pressed') !== 'true';
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.wireframe = enabled;
      }
    }
  });
  wireframeButton.setAttribute('aria-pressed', String(enabled));
}

function saveFrame(): void {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = 'gravity-well-arena-rim-pilot.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function measureModel(): void {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) {
      return;
    }
    const opacity = Array.isArray(object.material)
      ? Math.max(...object.material.map((material) => material.opacity))
      : object.material.opacity;
    if (opacity <= 0) {
      return;
    }
    meshes += 1;
    const geometry = object.geometry;
    const geometryTriangles = geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;
    const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
    triangles += geometryTriangles * instanceCount;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      materials.add(material);
    }
  });
  triangleCount.textContent = Math.round(triangles).toLocaleString();
  meshCount.textContent = String(meshes);
  materialCount.textContent = String(materials.size);
}

function resizeRenderer(): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = renderer.getPixelRatio();
  const targetWidth = Math.floor(width * pixelRatio);
  const targetHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => frameView(button.dataset.view as ReviewView));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-light]')) {
  button.addEventListener('click', () => setLight(button.dataset.light as ReviewLight));
}
wireframeButton.addEventListener('click', toggleWireframe);
saveFrameButton.addEventListener('click', saveFrame);

frameView('reference');
measureModel();

let measuredDrawCalls = false;
let animationFrameId = 0;
function animate(): void {
  resizeRenderer();
  controls.update();
  renderer.render(scene, camera);
  if (!measuredDrawCalls) {
    drawCallCount.textContent = String(renderer.info.render.calls);
    measuredDrawCalls = true;
    status.textContent = 'Pilot model ready for visual and budget review.';
    window.__arenaRimReviewReady = true;
  }
  animationFrameId = requestAnimationFrame(animate);
}

window.__arenaRimReview = {
  setView: frameView,
  setLight,
};
animationFrameId = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(animationFrameId);
    controls.dispose();
    renderer.dispose();
  });
}
