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
    helpless: 0,
    parry: 0,
    launchFlash: 0,
    parryFlash: 0,
    specialFlash: 0,
    breakFlash: 0,
    dunkFlash: 0,
    recovering: 0,
    recoveryProgress: 0,
  };
}

describe('character visual adapters', () => {
  test('supports 3d, sprite, and hybrid visual presentations behind one interface', () => {
    const threeD = createCharacterVisualHandle('vanguard', 'P1');
    const sprite = createCharacterVisualHandle('duelist', 'P2');
    const hybrid = createCharacterVisualHandle('ace', 'P1');

    expect(threeD.adapter.presentation).toBe('3d');
    expect(sprite.adapter.presentation).toBe('sprite');
    expect(hybrid.adapter.presentation).toBe('hybrid');

    expect(threeD.node).toBeInstanceOf(THREE.Group);
    expect(sprite.node).toBeInstanceOf(THREE.Sprite);
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
});
