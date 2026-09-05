import * as THREE from 'three';
import type {
  PlayerId,
  PlayerPresentationPhase,
  PlayerRenderSnapshot,
  RenderSnapshot,
} from '../sim/types';
import type { SceneContext } from './scene';
import { DUNK_RECOVERY_ARC_DEPTH, DUNK_RECOVERY_MIN_SCALE } from '../sim/constants';
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
import { disposeImageTextureLibrary } from './assets/imageTextureLibrary';
import {
  resolveStageCameraPitchDegrees,
  resolveWormholeCoreOpacity,
  resolveWormholeLayerDepth,
  resolveWormholeParticleDepth,
} from './stagePresentation';
import { disposeStageModelRuntime } from './stageModelRuntime';
import {
  resolvePlayerActionReadability,
  type ActionReadabilityId,
} from './actionReadability';
import { cameraDampingAlpha, fitCombatCameraDistance, syncCameraTrackToWorld } from './cameraTracking';

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
  const luminousWormhole = backdrop.group.userData.effectId === 'wormhole_luminous_v2';
  const launchActive = snapshot.players.P1.helpless > 0 || snapshot.players.P2.helpless > 0;
  const time = snapshot.gameTime * effectSpeed;

  backdrop.group.rotation.set(0, 0, 0);
  backdrop.group.position.set(0, 0, 0);

  backdrop.core.rotation.z = luminousWormhole ? time * 0.018 : 0;
  backdrop.core.position.z = -185;
  backdrop.core.visible = !luminousWormhole;
  const corePulse = 1 + Math.sin(time * 1.25) * 0.03;
  backdrop.core.scale.setScalar(corePulse);
  const coreMaterial = backdrop.core.material as THREE.MeshBasicMaterial;
  coreMaterial.opacity = resolveWormholeCoreOpacity(effectOpacity, effectCoreOpacity, time);

  backdrop.rings.forEach((ring, index) => {
    ring.visible = !luminousWormhole;
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
    arm.visible = !luminousWormhole;
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

function setIndicatorState(
  indicator: THREE.Group,
  x: number,
  y: number,
  opacity: number,
  scale: number,
  rotation: number,
): void {
  const visible = opacity > 0.01;
  indicator.visible = visible;
  if (!visible) {
    return;
  }

  indicator.position.set(x, y, 0.28);
  indicator.rotation.z = rotation;
  indicator.scale.setScalar(scale);
  indicator.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
      child.material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
    }
  });
}

function resolveIndicatorPulse(
  phase: PlayerPresentationPhase,
  gameTime: number,
): { opacity: number; scale: number } {
  switch (phase) {
    case 'startup': {
      const pulse = 0.5 + Math.sin(gameTime * 18) * 0.5;
      return { opacity: 0.68 + pulse * 0.24, scale: 0.92 + pulse * 0.12 };
    }
    case 'active': {
      const pulse = 0.5 + Math.sin(gameTime * 11) * 0.5;
      return { opacity: 0.84 + pulse * 0.12, scale: 1 + pulse * 0.05 };
    }
    case 'sustain': {
      const pulse = 0.5 + Math.sin(gameTime * 6) * 0.5;
      return { opacity: 0.58 + pulse * 0.2, scale: 0.98 + pulse * 0.06 };
    }
    case 'recovery':
      return { opacity: 0.42, scale: 1.04 };
    case 'none':
    default:
      return { opacity: 0.7, scale: 1 };
  }
}

function resolveIndicatorFlash(
  player: PlayerRenderSnapshot,
  id: ActionReadabilityId,
): number {
  switch (id) {
    case 'launch':
      return THREE.MathUtils.clamp(player.launchFlash / 0.24, 0, 1);
    case 'special':
      return THREE.MathUtils.clamp(player.specialFlash / 0.16, 0, 1);
    case 'launch_break':
      return THREE.MathUtils.clamp(player.breakFlash / 0.28, 0, 1);
    case 'dunk':
      return THREE.MathUtils.clamp(player.dunkFlash / 0.24, 0, 1);
    case 'parry':
      return THREE.MathUtils.clamp(player.parryFlash / 0.2, 0, 1);
    case 'boost':
    case 'super_boost':
    default:
      return 0;
  }
}

function updatePlayerIndicators(context: SceneContext, snapshot: RenderSnapshot): void {
  const playerIds: PlayerId[] = ['P1', 'P2'];
  for (const playerId of playerIds) {
    const player = snapshot.players[playerId];
    const indicators = context.playerIndicators[playerId];
    for (const indicator of Object.values(indicators)) {
      indicator.visible = false;
    }

    const action = resolvePlayerActionReadability(player);
    if (!action) {
      continue;
    }

    const id = action.definition.id;
    const indicator = indicators[id];
    const pulse = resolveIndicatorPulse(action.phase, snapshot.gameTime);
    const flash = resolveIndicatorFlash(player, id);
    const [baseRotation, rotationSpeed] = indicator.userData.motion as [number, number];
    setIndicatorState(
      indicator,
      player.pos.x,
      player.pos.y,
      pulse.opacity + flash * 0.08,
      pulse.scale + flash * 0.12,
      baseRotation + snapshot.gameTime * rotationSpeed,
    );
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

// Prefer close combat framing, but let the containment fit pull back as far
// as necessary for both fighters and the current viewport.
const NEUTRAL_CAMERA_MIN_Z = 52;
const LAUNCH_CAMERA_MIN_Z = 60;

function updateCamera(context: SceneContext, snapshot: RenderSnapshot, deltaSeconds: number, reset: boolean): void {
  const launchActive = snapshot.players.P1.helpless > 0 || snapshot.players.P2.helpless > 0;
  if (!launchActive && context.launchCameraActive) {
    context.cameraPlayerTracks.P1.set(snapshot.players.P1.pos.x, snapshot.players.P1.pos.y);
    context.cameraPlayerTracks.P2.set(snapshot.players.P2.pos.x, snapshot.players.P2.pos.y);
  }
  context.launchCameraActive = launchActive;

  syncCameraTrackToWorld(context.cameraPlayerTracks.P1, snapshot.players.P1.pos.x, snapshot.players.P1.pos.y);
  syncCameraTrackToWorld(context.cameraPlayerTracks.P2, snapshot.players.P2.pos.x, snapshot.players.P2.pos.y);
  const p1 = context.cameraPlayerTracks.P1;
  const p2 = context.cameraPlayerTracks.P2;
  const midX = (p1.x + p2.x) * 0.5;
  const midY = (p1.y + p2.y) * 0.5;
  const minZ = launchActive ? LAUNCH_CAMERA_MIN_Z : NEUTRAL_CAMERA_MIN_Z;

  // Stage-authored pitch changes presentation only; simulation coordinates remain strictly 2D.
  const cameraPitchDegrees = resolveStageCameraPitchDegrees(
    context.cameraPitchDegrees,
    context.cameraLaunchPitchBoostDegrees,
    launchActive,
  );
  const alpha = reset ? 1 : cameraDampingAlpha(deltaSeconds);
  context.lookAtTarget.x += (midX - context.lookAtTarget.x) * alpha;
  context.lookAtTarget.y += (midY + context.cameraLookAtYOffset - context.lookAtTarget.y) * alpha;
  context.lookAtTarget.z = 0;
  const pitch = THREE.MathUtils.degToRad(cameraPitchDegrees);
  // Refit around the smoothed target as well: a warp must never leave the
  // fighters outside the frame while the camera catches up.
  const requiredDistance = fitCombatCameraDistance({
    players: [p1, p2],
    center: context.lookAtTarget,
    pitchDegrees: cameraPitchDegrees,
    verticalFovDegrees: context.camera.fov,
    aspect: context.camera.aspect,
    minDistance: minZ / Math.cos(pitch),
  });
  const previousDistance = context.camera.position.distanceTo(context.lookAtTarget);
  const distance = Math.max(requiredDistance, previousDistance + (requiredDistance - previousDistance) * alpha);
  context.cameraTarget.set(context.lookAtTarget.x,
    context.lookAtTarget.y - Math.sin(pitch) * distance, Math.cos(pitch) * distance);
  context.camera.position.copy(context.cameraTarget);
  const far = Math.max(500, distance + 400);
  if (context.camera.far !== far) {
    context.camera.far = far;
    context.camera.updateProjectionMatrix();
  }
  context.camera.lookAt(context.lookAtTarget);
}

export function renderFrame(context: SceneContext, snapshot: RenderSnapshot): void {
  const previousTime = context.lastRenderSnapshot?.gameTime;
  const resetCamera = previousTime === undefined || snapshot.gameTime < previousTime;
  const cameraDelta = resetCamera ? 0 : Math.min(0.1, snapshot.gameTime - previousTime);
  if (context.lastRenderSnapshot && snapshot.gameTime < context.lastRenderSnapshot.gameTime) {
    clearCombatVfxRuntime(context.combatVfxRuntime);
    context.lastRenderSnapshot = null;
  }
  const combatEvents = extractCombatVfxEvents(context.lastRenderSnapshot, snapshot);
  emitCombatVfxEvents(context.combatVfxRuntime, combatEvents, snapshot.gameTime);
  updateCombatVfxRuntime(context.combatVfxRuntime, snapshot.gameTime);
  context.lastRenderSnapshot = snapshot;
  context.stageBackgroundModel.root.userData.gameTime = snapshot.gameTime;

  context.gravityWell.rotation.z = 0;
  const gravityWellMaterial = context.gravityWell.material;
  if (gravityWellMaterial instanceof THREE.ShaderMaterial) {
    gravityWellMaterial.uniforms.uTime.value = snapshot.gameTime
      * (context.wormholeBackdrop.group.userData.effectSpeed ?? 1);
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
  updateCamera(context, snapshot, cameraDelta, resetCamera);

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
    for (const indicator of Object.values(indicators)) {
      context.scene.remove(indicator);
      indicator.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
          return;
        }
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      });
    }
  }

  context.scene.remove(context.stageBackgroundImage);
  context.stageBackgroundImage.geometry.dispose();
  (context.stageBackgroundImage.material as THREE.Material).dispose();
  disposeImageTextureLibrary(context.imageTextureLibrary);

  disposeStageModelRuntime(context.stageBackgroundModel);

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
