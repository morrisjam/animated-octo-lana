import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { optimizeStaticModelByMaterial } from './optimizeStaticModel';

describe('static model optimizer', () => {
  test('bakes transforms and instances into one mesh per visible material', () => {
    const source = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: 0x223344 });
    armor.name = 'armor';
    const energy = new THREE.MeshStandardMaterial({ color: 0x33ddff });
    energy.name = 'energy';
    const hidden = new THREE.MeshStandardMaterial({ opacity: 0, transparent: true });

    const left = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), armor);
    left.position.x = -2;
    source.add(left);

    const repeated = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), armor, 2);
    repeated.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, 0));
    repeated.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 0, 0));
    source.add(repeated);

    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), energy));
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hidden));

    const { model, report } = optimizeStaticModelByMaterial(source);
    expect(report).toEqual({
      sourceDrawCalls: 4,
      sourceInstances: 4,
      skippedTransparentDrawCalls: 1,
      mergedDrawCalls: 2,
      triangleCount: 48,
    });
    expect(model.children).toHaveLength(2);

    const box = new THREE.Box3().setFromObject(model);
    expect(box.min.x).toBeCloseTo(-2.5);
    expect(box.max.x).toBeCloseTo(3.5);
  });
});
