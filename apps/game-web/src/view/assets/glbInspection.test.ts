import { describe, expect, test } from 'vitest';
import { GlbInspectionError, inspectGlb } from './glbInspection';

function createGlb(document: Record<string, unknown>, binaryBytes = 12): Uint8Array {
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = Math.ceil(encodedJson.length / 4) * 4;
  const paddedBinaryLength = Math.ceil(binaryBytes / 4) * 4;
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
  return bytes;
}

const VALID_DOCUMENT = {
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  buffers: [{ byteLength: 12 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
    { bufferView: 0, componentType: 5123, count: 6, type: 'SCALAR' },
  ],
  materials: [{}],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
};

describe('GLB inspection', () => {
  test('reports embedded indexed triangle geometry', () => {
    expect(inspectGlb(createGlb(VALID_DOCUMENT))).toMatchObject({
      version: 2,
      sceneCount: 1,
      nodeCount: 1,
      meshCount: 1,
      primitiveCount: 1,
      materialCount: 1,
      vertexCount: 4,
      triangleCount: 2,
      externalUris: [],
      hasBinaryChunk: true,
    });
  });

  test('reports external model dependencies for fail-closed build validation', () => {
    const document = {
      ...VALID_DOCUMENT,
      buffers: [{ byteLength: 12, uri: 'mesh.bin' }],
      images: [{ uri: 'https://assets.example.com/rim.png' }, { uri: 'data:image/png;base64,AA==' }],
    };
    expect(inspectGlb(createGlb(document)).externalUris).toEqual([
      'mesh.bin',
      'https://assets.example.com/rim.png',
    ]);
  });

  test('rejects truncated and non-triangle payloads', () => {
    const truncated = createGlb(VALID_DOCUMENT).subarray(0, 18);
    expect(() => inspectGlb(truncated)).toThrow(GlbInspectionError);
    const lineDocument = {
      ...VALID_DOCUMENT,
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }],
    };
    expect(() => inspectGlb(createGlb(lineDocument))).toThrow('unsupported mode 1');
  });
});
