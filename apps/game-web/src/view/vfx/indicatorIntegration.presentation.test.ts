import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { createInitialState, getRenderSnapshot } from '../../sim/sim';
import { createPlayerIndicatorSet } from '../scene';
import { updatePlayerIndicators } from '../render';
import { COMBAT_READABILITY_LEGEND, COMBAT_READABILITY_PRESETS } from './readabilityPresets';

describe('live indicator integration', () => {
  test('renders a phase-local launch halo and replaces it with vulnerability brackets without stale indicators', () => {
    const scene = new THREE.Scene();
    const context = { playerIndicators: { P1: createPlayerIndicatorSet(scene), P2: createPlayerIndicatorSet(scene) } };
    const snapshot = getRenderSnapshot(createInitialState());
    snapshot.players.P1.presentationAction = 'launch';
    snapshot.players.P1.presentationPhase = 'startup';
    snapshot.players.P1.presentationElapsedSeconds = 0.04;
    updatePlayerIndicators(context, snapshot);
    const launch = context.playerIndicators.P1.launch;
    expect(launch.visible).toBe(true);
    const scale = launch.scale.x;
    const opacity = (launch.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity;
    snapshot.gameTime += 0.0005;
    updatePlayerIndicators(context, snapshot);
    expect(launch.scale.x).toBe(scale);
    expect((launch.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity).toBe(opacity);
    snapshot.players.P1.presentationAction = 'attack_recovery';
    updatePlayerIndicators(context, snapshot);
    expect(launch.visible).toBe(false);
    const vulnerability = context.playerIndicators.P1.vulnerability;
    expect(vulnerability.visible).toBe(true);
    expect(vulnerability.rotation.z).toBe(0);
    const material = (vulnerability.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
    expect(material.color.getHexString()).toBe('a8b4ca');
    snapshot.players.P1.presentationAction = 'helpless';
    updatePlayerIndicators(context, snapshot);
    expect(material.color.getHexString()).toBe('ff9b7a');
    snapshot.players.P1.presentationAction = 'idle';
    snapshot.players.P1.presentationPhase = 'none';
    updatePlayerIndicators(context, snapshot);
    expect(Object.values(context.playerIndicators.P1).some((indicator) => indicator.visible)).toBe(false);
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
  });

  test('the optional legend includes every outcome shape with its actual cue color', () => {
    expect(COMBAT_READABILITY_LEGEND.map((item) => item.cue).sort()).toEqual(Object.keys(COMBAT_READABILITY_PRESETS).sort());
    for (const item of COMBAT_READABILITY_LEGEND) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.path).toMatch(/^M/);
      expect(COMBAT_READABILITY_PRESETS[item.cue].flash!.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
