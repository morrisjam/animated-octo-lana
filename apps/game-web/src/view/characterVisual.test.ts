import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import type { PlayerRenderSnapshot } from '../sim/types';
import {
  createCharacterVisualHandle,
  disposeCharacterVisualNode,
  updateCharacterVisualHandle,
} from './characterVisual';

function makeSnapshot(characterId: PlayerRenderSnapshot['characterId']): PlayerRenderSnapshot {
  return {
    id: 'P1',
    characterId,
    pos: { x: 0, y: 0 },
    maxFuel: 100,
    fuel: 100,
    launchBreaks: 3,
    boostActive: false,
    superBoost: 0,
    helpless: 0,
    parry: 0,
    launchFlash: 0,
    parryFlash: 0,
    specialFlash: 0,
    breakFlash: 0,
    dunkFlash: 0,
    recovering: 0,
    recoveryProgress: 0,
    presentationAction: 'idle',
    presentationPhase: 'none',
  };
}

describe('character visual adapters', () => {
  test('supports 3d, sprite, and hybrid visual presentations behind one interface', () => {
    const threeD = createCharacterVisualHandle('warden', 'P1');
    const vanguardSprite = createCharacterVisualHandle('vanguard', 'P1');
    const duelistSprite = createCharacterVisualHandle('duelist', 'P2');
    const hybrid = createCharacterVisualHandle('ace', 'P1');

    expect(threeD.adapter.presentation).toBe('3d');
    expect(vanguardSprite.adapter.presentation).toBe('sprite');
    expect(duelistSprite.adapter.presentation).toBe('sprite');
    expect(hybrid.adapter.presentation).toBe('hybrid');

    expect(threeD.node).toBeInstanceOf(THREE.Group);
    expect(vanguardSprite.node).toBeInstanceOf(THREE.Group);
    expect(duelistSprite.node).toBeInstanceOf(THREE.Group);
    expect(vanguardSprite.node.children.some((child) => child.name === 'sprite-body')).toBe(true);
    expect(duelistSprite.node.children.some((child) => child.name === 'sprite-body')).toBe(true);
    expect(hybrid.node).toBeInstanceOf(THREE.Group);
    expect(hybrid.node.children.some((child) => child instanceof THREE.Sprite)).toBe(true);
  });

  test('updates and disposes existing placeholder character visuals safely', () => {
    const handles = [
      createCharacterVisualHandle('vanguard', 'P1'),
      createCharacterVisualHandle('duelist', 'P2'),
      createCharacterVisualHandle('ace', 'P1'),
      createCharacterVisualHandle('warden', 'P2'),
    ];

    for (const handle of handles) {
      const own = makeSnapshot(handle.characterId);
      const opponent = makeSnapshot(handle.characterId === 'vanguard' ? 'duelist' : 'vanguard');
      expect(() => updateCharacterVisualHandle(handle, own, opponent, 1.25)).not.toThrow();
      expect(() => disposeCharacterVisualNode(handle.node)).not.toThrow();
    }
  });

  test('anchors sprite characters at their feet with contact shadows and player-coloured glows', () => {
    const p1 = createCharacterVisualHandle('vanguard', 'P1');
    const p2 = createCharacterVisualHandle('duelist', 'P2');
    const p1Shadow = p1.node.getObjectByName('sprite-contact-shadow');
    const p2Shadow = p2.node.getObjectByName('sprite-contact-shadow');
    const p1Glow = p1.node.getObjectByName('sprite-ground-glow');
    const p2Glow = p2.node.getObjectByName('sprite-ground-glow');
    const p1Body = p1.node.getObjectByName('sprite-body');
    const p2Body = p2.node.getObjectByName('sprite-body');

    expect(p1Shadow).toBeInstanceOf(THREE.Mesh);
    expect(p2Shadow).toBeInstanceOf(THREE.Mesh);
    expect(p1Glow).toBeInstanceOf(THREE.Mesh);
    expect(p2Glow).toBeInstanceOf(THREE.Mesh);
    expect(p1Body).toBeInstanceOf(THREE.Sprite);
    expect(p2Body).toBeInstanceOf(THREE.Sprite);
    const p1Material = (p1Shadow as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const p2Material = (p2Shadow as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const p1GlowMaterial = (p1Glow as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const p2GlowMaterial = (p2Glow as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(p1Material.color.getHexString()).toBe('01040c');
    expect(p2Material.color.getHexString()).toBe('01040c');
    expect(p1Material.opacity).toBeCloseTo(0.34);
    expect(p1GlowMaterial.color.getHexString()).toBe('58b6ff');
    expect(p2GlowMaterial.color.getHexString()).toBe('ff74b8');
    expect(p1GlowMaterial.blending).toBe(THREE.AdditiveBlending);
    expect((p1Body as THREE.Sprite).center.y).toBeCloseTo(0.1);
    expect((p2Body as THREE.Sprite).center.y).toBeCloseTo(0.1);

    const recovering = { ...makeSnapshot('vanguard'), recovering: 0.4, recoveryProgress: 0.5 };
    updateCharacterVisualHandle(p1, recovering, makeSnapshot('duelist'), 1);
    expect(p1Material.opacity).toBeCloseTo(0.06);
    expect(p1GlowMaterial.opacity).toBeCloseTo(0.04);

    disposeCharacterVisualNode(p1.node);
    disposeCharacterVisualNode(p2.node);
  });
});
