import * as THREE from 'three';
import { createScene, applyStageAtmospherePreset, resizeScene } from '../view/scene';
import { loadStageModelAssets } from '../view/stageModelRuntime';
import { DEFAULT_ASSET_MANIFEST } from '../view/assets/defaultManifest';
import { cleanupRender } from '../view/render';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const preset = document.querySelector<HTMLSelectElement>('#preset')!;
const tilt = document.querySelector<HTMLInputElement>('#tilt')!;
const distance = document.querySelector<HTMLInputElement>('#distance')!;
const motion = document.querySelector<HTMLButtonElement>('#motion')!;
const status = document.querySelector<HTMLElement>('#status')!;
const context = createScene(canvas, { stageModelEntries: DEFAULT_ASSET_MANIFEST.models });
context.camera.far = 1000;
context.camera.updateProjectionMatrix();
for (const node of Object.values(context.playerMeshes)) node.visible = false;
const markers: THREE.Mesh[] = [];
for (const [x, y, color] of [[-20, 6, '#54c5f5'], [20, -6, '#f35fae']] as const) {
  const marker = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), new THREE.MeshBasicMaterial({ color, fog: false }));
  marker.position.set(x, y, 1);
  context.scene.add(marker);
  markers.push(marker);
}
function selectStage(): void { applyStageAtmospherePreset(context, preset.value); }
selectStage();
preset.addEventListener('change', selectStage);
let paused = false;
motion.addEventListener('click', () => {
  paused = !paused;
  motion.setAttribute('aria-pressed', String(paused));
  motion.textContent = paused ? 'Resume motion' : 'Pause motion';
});
const resize = (): void => resizeScene(context);
window.addEventListener('resize', resize);
let time = 0;
let previous = performance.now();
let frame = 0;
function animate(now: number): void {
  if (!paused && document.visibilityState === 'visible') time += Math.min(.05, (now - previous) / 1000);
  previous = now;
  context.stageBackgroundModel.root.userData.gameTime = time;
  const well = context.gravityWell.material as THREE.ShaderMaterial;
  well.uniforms.uTime.value = time * .5;
  const pitch = THREE.MathUtils.degToRad(Number(tilt.value));
  const radius = Number(distance.value) * Math.max(1, 1 / context.camera.aspect);
  if (innerWidth < 700) {
    context.camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * .12, innerWidth, innerHeight);
  } else context.camera.clearViewOffset();
  context.camera.position.set(0, -Math.sin(pitch) * radius, Math.cos(pitch) * radius);
  context.camera.lookAt(0, 0, 0);
  document.querySelector<HTMLOutputElement>('#tiltValue')!.value = `${tilt.value} degrees`;
  context.renderer.render(context.scene, context.camera);
  frame = requestAnimationFrame(animate);
}
void loadStageModelAssets(context.stageBackgroundModel).then(() => {
  selectStage();
  status.textContent = 'Local GLB / 10,240 triangles / 184 KB';
  frame = requestAnimationFrame(animate);
}).catch((error: unknown) => {
  status.textContent = `Model failed: ${error instanceof Error ? error.message : String(error)}`;
});
window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(frame);
  window.removeEventListener('resize', resize);
  for (const marker of markers) { marker.geometry.dispose(); (marker.material as THREE.Material).dispose(); marker.removeFromParent(); }
  cleanupRender(context);
}, { once: true });
