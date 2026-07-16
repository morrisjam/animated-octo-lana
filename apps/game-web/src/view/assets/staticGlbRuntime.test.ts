import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { parseStaticStageGlb } from './staticGlbRuntime';

function createStaticGlb({ externalBuffer = false } = {}): Uint8Array {
  const positions = new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const binaryLength = 36 + 36 + 6;
  const paddedBinaryLength = Math.ceil(binaryLength / 4) * 4;
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', extras: { asset_id: 'test_stage' }, children: [1] },
      { name: 'lip', mesh: 0 },
    ],
    buffers: [{ byteLength: binaryLength, ...(externalBuffer ? { uri: 'mesh.bin' } : {}) }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [{
      alphaMode: 'BLEND',
      doubleSided: true,
      emissiveFactor: [0.1, 0.2, 0.3],
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 0.5] },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = Math.ceil(encodedJson.length / 4) * 4;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + paddedJsonLength);
  bytes.set(encodedJson, 20);
  const binaryHeader = 20 + paddedJsonLength;
  view.setUint32(binaryHeader, paddedBinaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  const binaryOffset = binaryHeader + 8;
  bytes.set(new Uint8Array(positions.buffer), binaryOffset);
  bytes.set(new Uint8Array(normals.buffer), binaryOffset + 36);
  bytes.set(new Uint8Array(indices.buffer), binaryOffset + 72);
  return bytes;
}

describe('static GLB runtime', () => {
  test('builds embedded static triangle meshes and PBR presentation', () => {
    const root = parseStaticStageGlb(createStaticGlb(), { expectedAssetId: 'test_stage' });
    let mesh: THREE.Mesh | null = null;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        mesh = object;
      }
    });
    expect(mesh).not.toBeNull();
    expect(mesh?.geometry.getAttribute('position').count).toBe(3);
    expect(mesh?.geometry.index?.count).toBe(3);
    const material = mesh?.material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBeCloseTo(0.5);
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
  });

  test('rejects identity mismatches and external buffers', () => {
    expect(() => parseStaticStageGlb(createStaticGlb(), { expectedAssetId: 'other_stage' }))
      .toThrow('does not match other_stage');
    expect(() => parseStaticStageGlb(createStaticGlb({ externalBuffer: true })))
      .toThrow('exactly one embedded buffer');
  });
});
