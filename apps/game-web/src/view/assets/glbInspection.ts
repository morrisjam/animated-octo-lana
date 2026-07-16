const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

interface GlbAccessor {
  count?: unknown;
}

interface GlbPrimitive {
  attributes?: Record<string, unknown>;
  indices?: unknown;
  mode?: unknown;
}

interface GlbDocument {
  accessors?: GlbAccessor[];
  animations?: unknown[];
  buffers?: Array<{ uri?: unknown }>;
  images?: Array<{ uri?: unknown }>;
  materials?: unknown[];
  meshes?: Array<{ primitives?: GlbPrimitive[] }>;
  nodes?: unknown[];
  scenes?: unknown[];
  skins?: unknown[];
}

export interface GlbInspection {
  version: number;
  byteLength: number;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  animationCount: number;
  skinCount: number;
  vertexCount: number;
  triangleCount: number;
  externalUris: string[];
  hasBinaryChunk: boolean;
}

export class GlbInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlbInspectionError';
  }
}

function asUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
}

function assertArrayIndex(value: unknown, length: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length) {
    throw new GlbInspectionError(`${label} references an invalid accessor.`);
  }
  return value as number;
}

function accessorCount(accessors: GlbAccessor[], index: unknown, label: string): number {
  const accessorIndex = assertArrayIndex(index, accessors.length, label);
  const count = accessors[accessorIndex]?.count;
  if (!Number.isInteger(count) || (count as number) <= 0) {
    throw new GlbInspectionError(`${label} accessor has an invalid count.`);
  }
  return count as number;
}

function collectExternalUris(document: GlbDocument): string[] {
  const uris: string[] = [];
  for (const entry of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (typeof entry.uri === 'string' && !entry.uri.startsWith('data:')) {
      uris.push(entry.uri);
    }
  }
  return uris;
}

export function inspectGlb(value: ArrayBuffer | Uint8Array): GlbInspection {
  const bytes = asUint8Array(value);
  if (bytes.byteLength < 20) {
    throw new GlbInspectionError('GLB is too short to contain a header and JSON chunk.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new GlbInspectionError('GLB magic header is invalid.');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new GlbInspectionError(`GLB version ${version} is unsupported; expected version 2.`);
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== bytes.byteLength) {
    throw new GlbInspectionError(
      `GLB declared length ${declaredLength} does not match ${bytes.byteLength} bytes.`,
    );
  }

  let offset = 12;
  let jsonChunk: Uint8Array | null = null;
  let hasBinaryChunk = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new GlbInspectionError('GLB has a truncated chunk header.');
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > bytes.byteLength) {
      throw new GlbInspectionError('GLB has a chunk that exceeds the declared file length.');
    }
    if (chunkType === GLB_JSON_CHUNK) {
      if (jsonChunk !== null) {
        throw new GlbInspectionError('GLB contains more than one JSON chunk.');
      }
      jsonChunk = bytes.subarray(chunkStart, chunkEnd);
    } else if (chunkType === GLB_BIN_CHUNK) {
      hasBinaryChunk = true;
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.byteLength || jsonChunk === null) {
    throw new GlbInspectionError('GLB is missing a complete JSON chunk.');
  }

  let document: GlbDocument;
  try {
    const json = new TextDecoder().decode(jsonChunk).replace(/[\u0000\u0020]+$/g, '');
    document = JSON.parse(json) as GlbDocument;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown JSON error';
    throw new GlbInspectionError(`GLB JSON chunk is invalid: ${reason}`);
  }

  const accessors = Array.isArray(document.accessors) ? document.accessors : [];
  const meshes = Array.isArray(document.meshes) ? document.meshes : [];
  let primitiveCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const primitives = meshes[meshIndex]?.primitives;
    if (!Array.isArray(primitives) || primitives.length === 0) {
      throw new GlbInspectionError(`mesh[${meshIndex}] has no primitives.`);
    }
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      const primitive = primitives[primitiveIndex];
      const label = `mesh[${meshIndex}].primitive[${primitiveIndex}]`;
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        throw new GlbInspectionError(`${label} uses unsupported mode ${String(primitive.mode)}.`);
      }
      const positionAccessor = primitive.attributes?.POSITION;
      const positions = accessorCount(accessors, positionAccessor, `${label}.POSITION`);
      const elements = primitive.indices === undefined
        ? positions
        : accessorCount(accessors, primitive.indices, `${label}.indices`);
      if (elements % 3 !== 0) {
        throw new GlbInspectionError(`${label} element count ${elements} is not divisible by 3.`);
      }
      primitiveCount += 1;
      vertexCount += positions;
      triangleCount += elements / 3;
    }
  }

  return {
    version,
    byteLength: bytes.byteLength,
    sceneCount: Array.isArray(document.scenes) ? document.scenes.length : 0,
    nodeCount: Array.isArray(document.nodes) ? document.nodes.length : 0,
    meshCount: meshes.length,
    primitiveCount,
    materialCount: Array.isArray(document.materials) ? document.materials.length : 0,
    animationCount: Array.isArray(document.animations) ? document.animations.length : 0,
    skinCount: Array.isArray(document.skins) ? document.skins.length : 0,
    vertexCount,
    triangleCount,
    externalUris: collectExternalUris(document),
    hasBinaryChunk,
  };
}
