import * as THREE from 'three';
import type { PlayerId, RenderSnapshot } from '../sim/types';
import type { SceneContext } from './scene';
import { ARENA_RADIUS, DUNK_RECOVERY_ARC_DEPTH, DUNK_RECOVERY_MIN_SCALE } from '../sim/constants';
import {
  createCharacterVisualHandle,
  disposeCharacterVisualNode,
  updateCharacterVisualHandle,
} from './characterVisual';
import { extractCombatVfxEvents } from './vfx/events';
import {
  clearCombatVfxRuntime,
  disposeCombatVfxRuntime,
  emitCombatVfxEvents,
  updateCombatVfxRuntime,
} from './vfx/runtime';
import {
  resolveStageCameraPitchDegrees,
  resolveStageCameraYOffset,
  resolveWormholeCoreOpacity,
  resolveWormholeLayerDepth,
  resolveWormholeParticleDepth,
} from './stagePresentation';

const LIVE_PROJECTILE_IDS = new Set<number>();

function updateWormholeBackdrop(context: SceneContext, snapshot: RenderSnapshot): void {
  const backdrop = context.wormholeBackdrop;
  if (!backdrop.group.visible) {
    return;
  }

  const effectSpeed = typeof backdrop.group.userData.effectSpeed === 'number'
    ? backdrop.group.userData.effectSpeed as number
    : 1;
  const effectOpacity = typeof backdrop.group.userData.effectOpacity === 'number'
    ? backdrop.group.userData.effectOpacity as number
    : 0.8;
  const effectCoreOpacity = typeof backdrop.group.userData.effectCoreOpacity === 'number'
    ? backdrop.group.userData.effectCoreOpacity as number
    : 0.14;
  const effectDepthTravel = typeof backdrop.group.userData.effectDepthTravel === 'number'
    ? backdrop.group.userData.effectDepthTravel as number
    : 0;
  const launchActive = snapshot.players.P1.helpless > 0 || snapshot.players.P2.helpless > 0;
  const time = snapshot.gameTime * effectSpeed;

  backdrop.group.rotation.set(0, 0, 0);
  backdrop.group.position.set(0, 0, 0);

  backdrop.core.rotation.z = 0;
  const corePulse = 1 + Math.sin(time * 1.25) * 0.03;
  backdrop.core.scale.setScalar(corePulse);
  const coreMaterial = backdrop.core.material as THREE.MeshBasicMaterial;
  coreMaterial.opacity = resolveWormholeCoreOpacity(effectOpacity, effectCoreOpacity, time);

  backdrop.rings.forEach((ring, index) => {
    const baseScale = ring.userData.baseScale as number;
    const baseDepth = ring.userData.baseDepth as number;
    const scalePulse = 1 + Math.sin(time * (0.55 + index * 0.025) + index * 0.35) * 0.015;
    ring.rotation.z = 0;
    ring.position.z = resolveWormholeLayerDepth({
      baseDepth,
      layerIndex: index,
      gameTime: snapshot.gameTime,
      effectSpeed,
      depthTravel: effectDepthTravel,
    });
    ring.scale.setScalar(baseScale * scalePulse);
    const material = ring.material as THREE.MeshBasicMaterial;
    material.opacity = effectOpacity * (0.03 + (backdrop.rings.length - index) * 0.01 + Math.abs(Math.sin(time * 0.8 + index)) * 0.01);
  });

  backdrop.spiralArms.forEach((arm, index) => {
    const baseRotation = arm.userData.baseRotation as number;
    const rotationSpeed = arm.userData.rotationSpeed as number;
    arm.rotation.z = baseRotation + time * rotationSpeed;
    const material = arm.material as THREE.MeshBasicMaterial;
    material.opacity = effectOpacity * (0.06 + (backdrop.spiralArms.length - index) * 0.012 + Math.abs(Math.sin(time * 0.9 + index)) * 0.025);
  });

  backdrop.particles.rotation.z = time * 0.02;
  backdrop.particles.rotation.y = 0;
  const particlePositions = backdrop.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
  const particleBaseDepths = backdrop.particles.userData.baseDepths as Float32Array | undefined;
  if (particleBaseDepths && particlePositions.count === particleBaseDepths.length) {
    const positions = particlePositions.array as Float32Array;
    for (let index = 0; index < particleBaseDepths.length; index += 1) {
      positions[index * 3 + 2] = resolveWormholeParticleDepth({
        baseDepth: particleBaseDepths[index] ?? -198,
        gameTime: snapshot.gameTime,
        effectSpeed,
        depthTravel: effectDepthTravel,
        launchActive,
      });
    }
    particlePositions.needsUpdate = true;
  }
  const particleMaterial = backdrop.particles.material as THREE.PointsMaterial;
  particleMaterial.opacity = effectOpacity * (
    0.28
    + Math.abs(Math.sin(time * 0.7)) * 0.08
    + (launchActive ? 0.12 : 0)
  );
}

function ensurePlayerVisual(
  context: SceneContext,
  playerId: PlayerId,
  characterId: RenderSnapshot['players']['P1']['characterId'],
): void {
  const current = context.playerVisuals[playerId];
  if (current.characterId === characterId) {
    return;
  }

  context.scene.remove(current.node);
  disposeCharacterVisualNode(current.node);
  const next = createCharacterVisualHandle(characterId, playerId);
  context.playerVisuals[playerId] = next;
  context.playerMeshes[playerId] = next.node;
  context.scene.add(next.node);
}

function updatePlayerMeshes(context: SceneContext, snapshot: RenderSnapshot): void {
  const p1 = snapshot.players.P1;
  const p2 = snapshot.players.P2;
  ensurePlayerVisual(context, 'P1', p1.characterId);
  ensurePlayerVisual(context, 'P2', p2.characterId);
  const p1Arc = p1.recovering > 0 ? Math.sin(p1.recoveryProgress * Math.PI) : 0;
  const p2Arc = p2.recovering > 0 ? Math.sin(p2.recoveryProgress * Math.PI) : 0;
  const p1Z = -p1Arc * DUNK_RECOVERY_ARC_DEPTH;
  const p2Z = -p2Arc * DUNK_RECOVERY_ARC_DEPTH;
  const p1Scale = 1 - p1Arc * (1 - DUNK_RECOVERY_MIN_SCALE);
  const p2Scale = 1 - p2Arc * (1 - DUNK_RECOVERY_MIN_SCALE);

  const p1Mesh = context.playerMeshes.P1;
  p1Mesh.position.set(p1.pos.x, p1.pos.y, p1Z);
  p1Mesh.scale.setScalar(p1Scale);
  updateCharacterVisualHandle(context.playerVisuals.P1, p1, p2, snapshot.gameTime);

  const p2Mesh = context.playerMeshes.P2;
  p2Mesh.position.set(p2.pos.x, p2.pos.y, p2Z);
  p2Mesh.scale.setScalar(p2Scale);
  updateCharacterVisualHandle(context.playerVisuals.P2, p2, p1, snapshot.gameTime);
}

function setIndicatorState(mesh: THREE.Mesh, x: number, y: number, opacity: number, scale: number): void {
  const visible = opacity > 0.01;
  mesh.visible = visible;
  if (!visible) {
    return;
  }

  mesh.position.set(x, y, 0.18);
  mesh.scale.setScalar(scale);
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
}

function updatePlayerIndicators(context: SceneContext, snapshot: RenderSnapshot): void {
  const playerIds: PlayerId[] = ['P1', 'P2'];
  for (const playerId of playerIds) {
    const player = snapshot.players[playerId];
    const indicators = context.playerIndicators[playerId];

    const parryOpacity = Math.max(
      player.parry > 0 ? 0.55 : 0,
      THREE.MathUtils.clamp(player.parryFlash / 0.2, 0, 1) * 0.9,
    );
    const parryScale = 1 + player.parryFlash * 2.5;
    setIndicatorState(indicators.parry, player.pos.x, player.pos.y, parryOpacity, parryScale);

    const launchPulse = player.helpless > 0 ? 0.1 + Math.abs(Math.sin(snapshot.gameTime * 14)) * 0.12 : 0;
    const launchOpacity = Math.max(
      player.helpless > 0 ? 0.45 + launchPulse : 0,
      THREE.MathUtils.clamp(player.launchFlash / 0.24, 0, 1) * 0.95,
    );
    const launchScale = 1 + player.launchFlash * 2.8 + launchPulse * 0.8;
    setIndicatorState(indicators.launch, player.pos.x, player.pos.y, launchOpacity, launchScale);

    const specialOpacity = THREE.MathUtils.clamp(player.specialFlash / 0.16, 0, 1) * 0.9;
    const specialScale = 1 + player.specialFlash * 3.2;
    setIndicatorState(indicators.special, player.pos.x, player.pos.y, specialOpacity, specialScale);

    const breakOpacity = THREE.MathUtils.clamp(player.breakFlash / 0.28, 0, 1) * 0.95;
    const breakScale = 1 + player.breakFlash * 3.4;
    setIndicatorState(indicators.break, player.pos.x, player.pos.y, breakOpacity, breakScale);

    const dunkOpacity = THREE.MathUtils.clamp(player.dunkFlash / 0.24, 0, 1) * 0.95;
    const dunkScale = 1 + player.dunkFlash * 3.2;
    setIndicatorState(indicators.dunk, player.pos.x, player.pos.y, dunkOpacity, dunkScale);
  }
}

function getProjectilePalette(ownerId: PlayerId, visualId: string): { base: string; emissive: string } {
  if (visualId.includes('duelist')) {
    return {
      base: ownerId === 'P1' ? '#d5f6ff' : '#ffdbe9',
      emissive: ownerId === 'P1' ? '#4ad3ff' : '#ff6fa3',
    };
  }
  if (visualId.includes('ace')) {
    return {
      base: ownerId === 'P1' ? '#ffffff' : '#ffe9ff',
      emissive: ownerId === 'P1' ? '#8e7dff' : '#ff8be5',
    };
  }
  if (visualId.includes('warden')) {
    return {
      base: ownerId === 'P1' ? '#e6f0ff' : '#ffe2f4',
      emissive: ownerId === 'P1' ? '#5bb0ff' : '#ff5ca4',
    };
  }
  return {
    base: '#ffffff',
    emissive: ownerId === 'P1' ? '#58b6ff' : '#ff74b8',
  };
}

function createProjectileMesh(context: SceneContext, ownerId: PlayerId, visualId: string): THREE.Mesh {
  const palette = getProjectilePalette(ownerId, visualId);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 12, 12),
    new THREE.MeshStandardMaterial({
      color: palette.base,
      emissive: palette.emissive,
      emissiveIntensity: 2.2,
    }),
  );
  context.scene.add(mesh);
  return mesh;
}

function disposeProjectileMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose());
    return;
  }
  mesh.material.dispose();
}

function updateProjectileMeshes(context: SceneContext, snapshot: RenderSnapshot): void {
  LIVE_PROJECTILE_IDS.clear();

  for (const projectile of snapshot.projectiles) {
    LIVE_PROJECTILE_IDS.add(projectile.id);
    let mesh = context.projectileMeshes.get(projectile.id);
    if (!mesh) {
      mesh = createProjectileMesh(context, projectile.ownerId, projectile.visualId);
      context.projectileMeshes.set(projectile.id, mesh);
    }
    mesh.position.set(projectile.pos.x, projectile.pos.y, 0.4);
    const pulse = 1 + Math.sin(snapshot.gameTime * 30 + projectile.id) * 0.12;
    mesh.scale.setScalar(pulse);
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 2.1 + Math.abs(Math.sin(snapshot.gameTime * 22 + projectile.id)) * 0.8;
  }

  for (const [id, mesh] of context.projectileMeshes.entries()) {
    if (LIVE_PROJECTILE_IDS.has(id)) {
      continue;
    }
    context.scene.remove(mesh);
    disposeProjectileMesh(mesh);
    context.projectileMeshes.delete(id);
  }
}

function updateCamera(context: SceneContext, snapshot: RenderSnapshot): void {
  const launchActive = snapshot.players.P1.helpless > 0 || snapshot.players.P2.helpless > 0;
  if (!launchActive && context.launchCameraActive) {
    context.cameraPlayerTracks.P1.set(snapshot.players.P1.pos.x, snapshot.players.P1.pos.y);
    context.cameraPlayerTracks.P2.set(snapshot.players.P2.pos.x, snapshot.players.P2.pos.y);
  }
  context.launchCameraActive = launchActive;

  let desiredCameraX = 0;
  let desiredCameraY = 0;
  let desiredCameraZ = 168;
  let desiredLookAtX = 0;
  let desiredLookAtY = 0;

  if (launchActive) {
    desiredCameraX = 0;
    desiredCameraY = 0;
    desiredCameraZ = 168;
    desiredLookAtX = 0;
    desiredLookAtY = 0;
  } else {
    resolveCameraTrackedPosition(context.cameraPlayerTracks.P1, snapshot.players.P1.pos.x, snapshot.players.P1.pos.y);
    resolveCameraTrackedPosition(context.cameraPlayerTracks.P2, snapshot.players.P2.pos.x, snapshot.players.P2.pos.y);
    const p1 = context.cameraPlayerTracks.P1;
    const p2 = context.cameraPlayerTracks.P2;
    const midX = (p1.x + p2.x) * 0.5;
    const midY = (p1.y + p2.y) * 0.5;
    const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    desiredCameraX = midX * 0.22;
    desiredCameraY = midY * 0.32;
    desiredCameraZ = THREE.MathUtils.clamp(76 + distance * 0.45 + Math.abs(p1.y - p2.y) * 0.28, 76, 132);
    desiredLookAtX = midX * 0.2;
    desiredLookAtY = midY * 0.2;
  }

  // Stage-authored pitch changes presentation only; simulation coordinates remain strictly 2D.
  const cameraPitchDegrees = resolveStageCameraPitchDegrees(
    context.cameraPitchDegrees,
    context.cameraLaunchPitchBoostDegrees,
    launchActive,
  );
  desiredCameraY += resolveStageCameraYOffset(desiredCameraZ, cameraPitchDegrees);
  desiredLookAtY += context.cameraLookAtYOffset;

  const maxCameraStep = launchActive ? 5.4 : 3.2;
  context.cameraTarget.x += THREE.MathUtils.clamp(desiredCameraX - context.cameraTarget.x, -maxCameraStep, maxCameraStep);
  context.cameraTarget.y += THREE.MathUtils.clamp(desiredCameraY - context.cameraTarget.y, -maxCameraStep, maxCameraStep);
  context.cameraTarget.z += THREE.MathUtils.clamp(desiredCameraZ - context.cameraTarget.z, -maxCameraStep, maxCameraStep);
  context.camera.position.lerp(context.cameraTarget, launchActive ? 0.22 : 0.16);

  const maxLookAtStep = 2.8;
  context.lookAtTarget.x += THREE.MathUtils.clamp(desiredLookAtX - context.lookAtTarget.x, -maxLookAtStep, maxLookAtStep);
  context.lookAtTarget.y += THREE.MathUtils.clamp(desiredLookAtY - context.lookAtTarget.y, -maxLookAtStep, maxLookAtStep);
  context.camera.lookAt(context.lookAtTarget);
}

function resolveCameraTrackedPosition(previous: THREE.Vector2, actualX: number, actualY: number): void {
  const actualLengthSq = actualX * actualX + actualY * actualY;
  let dirX = 1;
  let dirY = 0;
  if (actualLengthSq > 1e-6) {
    const invLen = 1 / Math.sqrt(actualLengthSq);
    dirX = actualX * invLen;
    dirY = actualY * invLen;
  }

  const wrapX = dirX * ARENA_RADIUS * 2;
  const wrapY = dirY * ARENA_RADIUS * 2;

  const c0x = actualX;
  const c0y = actualY;
  const c1x = actualX + wrapX;
  const c1y = actualY + wrapY;
  const c2x = actualX - wrapX;
  const c2y = actualY - wrapY;

  let bestX = c0x;
  let bestY = c0y;
  let bestDistSq = (c0x - previous.x) * (c0x - previous.x) + (c0y - previous.y) * (c0y - previous.y);

  const c1DistSq = (c1x - previous.x) * (c1x - previous.x) + (c1y - previous.y) * (c1y - previous.y);
  if (c1DistSq < bestDistSq) {
    bestX = c1x;
    bestY = c1y;
    bestDistSq = c1DistSq;
  }

  const c2DistSq = (c2x - previous.x) * (c2x - previous.x) + (c2y - previous.y) * (c2y - previous.y);
  if (c2DistSq < bestDistSq) {
    bestX = c2x;
    bestY = c2y;
  }

  previous.set(bestX, bestY);
}

export function renderFrame(context: SceneContext, snapshot: RenderSnapshot): void {
  if (context.lastRenderSnapshot && snapshot.gameTime < context.lastRenderSnapshot.gameTime) {
    clearCombatVfxRuntime(context.combatVfxRuntime);
    context.lastRenderSnapshot = null;
  }
  const combatEvents = extractCombatVfxEvents(context.lastRenderSnapshot, snapshot);
  emitCombatVfxEvents(context.combatVfxRuntime, combatEvents, snapshot.gameTime);
  updateCombatVfxRuntime(context.combatVfxRuntime, snapshot.gameTime);
  context.lastRenderSnapshot = snapshot;

  context.gravityWell.rotation.z = 0;
  const gravityWellMaterial = context.gravityWell.material;
  if (gravityWellMaterial instanceof THREE.ShaderMaterial) {
    gravityWellMaterial.uniforms.uTime.value = snapshot.gameTime;
  }
  context.ring.rotation.z = 0;
  const ringMaterial = context.ring.material as THREE.MeshBasicMaterial;
  const baseRingOpacity = typeof context.ring.userData.baseOpacity === 'number'
    ? context.ring.userData.baseOpacity as number
    : 0.5;
  ringMaterial.opacity = baseRingOpacity * (
    0.78 + Math.abs(Math.sin(snapshot.gameTime * 0.6)) * 0.16
  );
  const starsMaterial = context.stars.material as THREE.PointsMaterial;
  const launchActive = snapshot.players.P1.helpless > 0 || snapshot.players.P2.helpless > 0;
  const baseStarsSize = typeof context.stars.userData.baseSize === 'number'
    ? context.stars.userData.baseSize as number
    : 0.52;
  const baseStarsOpacity = typeof context.stars.userData.baseOpacity === 'number'
    ? context.stars.userData.baseOpacity as number
    : 0.88;
  starsMaterial.size = baseStarsSize * (launchActive ? 1.24 : 1);
  starsMaterial.opacity = Math.min(1, baseStarsOpacity * (launchActive ? 1.08 : 0.96));

  updatePlayerMeshes(context, snapshot);
  updatePlayerIndicators(context, snapshot);
  updateProjectileMeshes(context, snapshot);
  updateWormholeBackdrop(context, snapshot);
  updateCamera(context, snapshot);

  context.renderer.render(context.scene, context.camera);
}

export function cleanupRender(context: SceneContext): void {
  disposeCombatVfxRuntime(context.combatVfxRuntime);
  context.lastRenderSnapshot = null;

  const playerIds: PlayerId[] = ['P1', 'P2'];
  for (const playerId of playerIds) {
    const visual = context.playerVisuals[playerId];
    context.scene.remove(visual.node);
    disposeCharacterVisualNode(visual.node);
  }

  for (const mesh of context.projectileMeshes.values()) {
    context.scene.remove(mesh);
    disposeProjectileMesh(mesh);
  }
  context.projectileMeshes.clear();

  for (const playerId of playerIds) {
    const indicators = context.playerIndicators[playerId];
    const meshes = [indicators.parry, indicators.launch, indicators.special, indicators.break, indicators.dunk];
    for (const mesh of meshes) {
      context.scene.remove(mesh);
      mesh.geometry.dispose();
      const material = mesh.material as THREE.Material;
      material.dispose();
    }
  }

  context.scene.remove(context.stageBackgroundImage);
  context.stageBackgroundImage.geometry.dispose();
  (context.stageBackgroundImage.material as THREE.Material).dispose();

  context.scene.remove(context.stageBackgroundModel);
  context.stageBackgroundModel.geometry.dispose();
  (context.stageBackgroundModel.material as THREE.Material).dispose();

  context.scene.remove(context.wormholeBackdrop.group);
  context.wormholeBackdrop.core.geometry.dispose();
  (context.wormholeBackdrop.core.material as THREE.Material).dispose();
  for (const ring of context.wormholeBackdrop.rings) {
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
  }
  for (const arm of context.wormholeBackdrop.spiralArms) {
    arm.geometry.dispose();
    (arm.material as THREE.Material).dispose();
  }
  context.wormholeBackdrop.particles.geometry.dispose();
  (context.wormholeBackdrop.particles.material as THREE.Material).dispose();

  context.scene.remove(context.stars);
  context.stars.geometry.dispose();
  (context.stars.material as THREE.Material).dispose();

  context.scene.remove(context.arenaBoundary);
  context.arenaBoundary.geometry.dispose();
  (context.arenaBoundary.material as THREE.Material).dispose();

  context.scene.remove(context.arenaMouth);
  context.arenaMouth.geometry.dispose();
  (context.arenaMouth.material as THREE.Material).dispose();

  context.scene.remove(context.arenaRim);
  context.arenaRim.geometry.dispose();
  (context.arenaRim.material as THREE.Material).dispose();

  context.scene.remove(context.arenaLipShelf);
  context.arenaLipShelf.geometry.dispose();
  (context.arenaLipShelf.material as THREE.Material).dispose();

  context.scene.remove(context.arenaLipDepth);
  context.arenaLipDepth.geometry.dispose();
  (context.arenaLipDepth.material as THREE.Material).dispose();

  context.scene.remove(context.arenaDepthTicks);
  context.arenaDepthTicks.geometry.dispose();
  (context.arenaDepthTicks.material as THREE.Material).dispose();

  context.scene.remove(context.gravityWell);
  context.gravityWell.geometry.dispose();
  (context.gravityWell.material as THREE.Material).dispose();

  context.scene.remove(context.ring);
  context.ring.geometry.dispose();
  (context.ring.material as THREE.Material).dispose();
}
