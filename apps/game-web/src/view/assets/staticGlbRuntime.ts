import * as THREE from 'three';
import { GlbInspectionError, inspectGlb } from './glbInspection';

const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

interface GlbBufferView {
  buffer?: unknown;
  byteOffset?: unknown;
  byteLength?: unknown;
  byteStride?: unknown;
}

interface GlbAccessor {
  bufferView?: unknown;
  byteOffset?: unknown;
  componentType?: unknown;
  count?: unknown;
  type?: unknown;
  normalized?: unknown;
  sparse?: unknown;
}

interface GlbMaterial {
  name?: unknown;
  alphaMode?: unknown;
  alphaCutoff?: unknown;
  doubleSided?: unknown;
  emissiveFactor?: unknown;
  emissiveTexture?: unknown;
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  pbrMetallicRoughness?: {
    baseColorFactor?: unknown;
    baseColorTexture?: unknown;
    metallicFactor?: unknown;
    metallicRoughnessTexture?: unknown;
    roughnessFactor?: unknown;
  };
}

interface GlbPrimitive {
  attributes?: Record<string, unknown>;
  indices?: unknown;
  material?: unknown;
  mode?: unknown;
  targets?: unknown;
}

interface GlbMesh {
  name?: unknown;
  primitives?: GlbPrimitive[];
}

interface GlbNode {
  name?: unknown;
  mesh?: unknown;
  children?: unknown;
  matrix?: unknown;
  translation?: unknown;
  rotation?: unknown;
  scale?: unknown;
  extras?: unknown;
  camera?: unknown;
  skin?: unknown;
}

interface StaticGlbDocument {
  asset?: { version?: unknown };
  scene?: unknown;
  scenes?: Array<{ name?: unknown; nodes?: unknown }>;
  nodes?: GlbNode[];
  meshes?: GlbMesh[];
  materials?: GlbMaterial[];
  accessors?: GlbAccessor[];
  bufferViews?: GlbBufferView[];
  buffers?: Array<{ byteLength?: unknown; uri?: unknown }>;
  images?: unknown[];
  textures?: unknown[];
  animations?: unknown[];
  skins?: unknown[];
}

export interface StaticGlbParseOptions {
  expectedAssetId?: string;
}

interface DecodedStaticGlb {
  document: StaticGlbDocument;
  binary: Uint8Array;
}

function asBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function asIndex(value: unknown, length: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length) {
    throw new GlbInspectionError(`${label} is out of range.`);
  }
  return value as number;
}

function asNonNegativeInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || (resolved as number) < 0) {
    throw new GlbInspectionError(`${label} must be a non-negative integer.`);
  }
  return resolved as number;
}

function asFiniteFactor(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(resolved)) {
    throw new GlbInspectionError(`${label} must be finite.`);
  }
  return resolved;
}

function asFactorArray(value: unknown, length: number, fallback: number[], label: string): number[] {
  if (value === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(value) || value.length !== length) {
    throw new GlbInspectionError(`${label} must contain ${length} values.`);
  }
  return value.map((entry, index) => asFiniteFactor(entry, fallback[index], `${label}[${index}]`));
}

function decodeStaticGlb(value: ArrayBuffer | Uint8Array): DecodedStaticGlb {
  const bytes = asBytes(value);
  inspectGlb(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let document: StaticGlbDocument | null = null;
  let binary: Uint8Array | null = null;
  while (offset < bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkType === GLB_JSON_CHUNK) {
      const source = new TextDecoder().decode(bytes.subarray(chunkStart, chunkEnd)).replace(/[\u0000\u0020]+$/g, '');
      document = JSON.parse(source) as StaticGlbDocument;
    } else if (chunkType === GLB_BIN_CHUNK) {
      binary = bytes.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd;
  }
  if (!document || !binary) {
    throw new GlbInspectionError('Static stage GLB requires JSON and embedded binary chunks.');
  }
  if (document.asset?.version !== '2.0') {
    throw new GlbInspectionError('Static stage GLB asset version must be 2.0.');
  }
  if ((document.buffers?.length ?? 0) !== 1 || document.buffers?.[0]?.uri !== undefined) {
    throw new GlbInspectionError('Static stage GLB requires exactly one embedded buffer.');
  }
  const declaredBinaryBytes = asNonNegativeInteger(
    document.buffers?.[0]?.byteLength,
    -1,
    'buffers[0].byteLength',
  );
  if (declaredBinaryBytes > binary.byteLength) {
    throw new GlbInspectionError('Static stage GLB binary chunk is shorter than its buffer declaration.');
  }
  if ((document.images?.length ?? 0) > 0 || (document.textures?.length ?? 0) > 0) {
    throw new GlbInspectionError('Static stage GLB does not support embedded textures.');
  }
  if ((document.animations?.length ?? 0) > 0 || (document.skins?.length ?? 0) > 0) {
    throw new GlbInspectionError('Static stage GLB does not support animation or skins.');
  }
  return { document, binary };
}

function accessorLayout(
  decoded: DecodedStaticGlb,
  accessorIndex: unknown,
  expectedType: 'SCALAR' | 'VEC3',
  expectedComponentTypes: number[],
  label: string,
): {
  accessor: GlbAccessor;
  count: number;
  componentType: number;
  start: number;
  stride: number;
  componentBytes: number;
  components: number;
} {
  const accessors = decoded.document.accessors ?? [];
  const bufferViews = decoded.document.bufferViews ?? [];
  const accessor = accessors[asIndex(accessorIndex, accessors.length, label)];
  if (accessor.type !== expectedType) {
    throw new GlbInspectionError(`${label} must use accessor type ${expectedType}.`);
  }
  const componentType = Number(accessor.componentType);
  if (!expectedComponentTypes.includes(componentType)) {
    throw new GlbInspectionError(`${label} uses unsupported component type ${String(accessor.componentType)}.`);
  }
  if (accessor.normalized === true || accessor.sparse !== undefined) {
    throw new GlbInspectionError(`${label} cannot be normalized or sparse.`);
  }
  const count = asNonNegativeInteger(accessor.count, -1, `${label}.count`);
  if (count <= 0) {
    throw new GlbInspectionError(`${label}.count must be positive.`);
  }
  const viewIndex = asIndex(accessor.bufferView, bufferViews.length, `${label}.bufferView`);
  const bufferView = bufferViews[viewIndex];
  if (bufferView.buffer !== 0) {
    throw new GlbInspectionError(`${label} must reference embedded buffer 0.`);
  }
  const componentBytes = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const components = expectedType === 'SCALAR' ? 1 : 3;
  const elementBytes = componentBytes * components;
  const viewOffset = asNonNegativeInteger(bufferView.byteOffset, 0, `bufferViews[${viewIndex}].byteOffset`);
  const accessorOffset = asNonNegativeInteger(accessor.byteOffset, 0, `${label}.byteOffset`);
  const viewLength = asNonNegativeInteger(bufferView.byteLength, -1, `bufferViews[${viewIndex}].byteLength`);
  const stride = asNonNegativeInteger(bufferView.byteStride, elementBytes, `bufferViews[${viewIndex}].byteStride`);
  if (stride < elementBytes) {
    throw new GlbInspectionError(`${label} byte stride is shorter than one element.`);
  }
  const usedBytes = (count - 1) * stride + elementBytes;
  if (accessorOffset + usedBytes > viewLength || viewOffset + accessorOffset + usedBytes > decoded.binary.byteLength) {
    throw new GlbInspectionError(`${label} exceeds its embedded buffer view.`);
  }
  return {
    accessor,
    count,
    componentType,
    start: viewOffset + accessorOffset,
    stride,
    componentBytes,
    components,
  };
}

function readVector3Attribute(
  decoded: DecodedStaticGlb,
  accessorIndex: unknown,
  label: string,
): THREE.BufferAttribute {
  const layout = accessorLayout(decoded, accessorIndex, 'VEC3', [5126], label);
  const source = new DataView(decoded.binary.buffer, decoded.binary.byteOffset, decoded.binary.byteLength);
  const values = new Float32Array(layout.count * 3);
  for (let index = 0; index < layout.count; index += 1) {
    for (let component = 0; component < 3; component += 1) {
      values[index * 3 + component] = source.getFloat32(
        layout.start + index * layout.stride + component * 4,
        true,
      );
    }
  }
  return new THREE.BufferAttribute(values, 3);
}

function readIndexAttribute(
  decoded: DecodedStaticGlb,
  accessorIndex: unknown,
  label: string,
): THREE.BufferAttribute {
  const layout = accessorLayout(decoded, accessorIndex, 'SCALAR', [5121, 5123, 5125], label);
  if (layout.count % 3 !== 0) {
    throw new GlbInspectionError(`${label} count must be divisible by 3.`);
  }
  const source = new DataView(decoded.binary.buffer, decoded.binary.byteOffset, decoded.binary.byteLength);
  const values = layout.componentType === 5125
    ? new Uint32Array(layout.count)
    : new Uint16Array(layout.count);
  for (let index = 0; index < layout.count; index += 1) {
    const offset = layout.start + index * layout.stride;
    values[index] = layout.componentType === 5121
      ? source.getUint8(offset)
      : layout.componentType === 5123
        ? source.getUint16(offset, true)
        : source.getUint32(offset, true);
  }
  return new THREE.BufferAttribute(values, 1);
}

function createMaterial(definition: GlbMaterial | undefined, index: number): THREE.MeshStandardMaterial {
  const pbr = definition?.pbrMetallicRoughness ?? {};
  if (
    pbr.baseColorTexture !== undefined
    || pbr.metallicRoughnessTexture !== undefined
    || definition?.emissiveTexture !== undefined
    || definition?.normalTexture !== undefined
    || definition?.occlusionTexture !== undefined
  ) {
    throw new GlbInspectionError(`materials[${index}] uses unsupported textures.`);
  }
  const base = asFactorArray(pbr.baseColorFactor, 4, [1, 1, 1, 1], `materials[${index}].baseColorFactor`);
  const emissive = asFactorArray(definition?.emissiveFactor, 3, [0, 0, 0], `materials[${index}].emissiveFactor`);
  const alphaMode = definition?.alphaMode ?? 'OPAQUE';
  if (alphaMode !== 'OPAQUE' && alphaMode !== 'BLEND' && alphaMode !== 'MASK') {
    throw new GlbInspectionError(`materials[${index}] uses unsupported alpha mode ${String(alphaMode)}.`);
  }
  const material = new THREE.MeshStandardMaterial({
    name: typeof definition?.name === 'string' ? definition.name : `stage-material-${index}`,
    color: new THREE.Color(base[0], base[1], base[2]),
    emissive: new THREE.Color(emissive[0], emissive[1], emissive[2]),
    metalness: asFiniteFactor(pbr.metallicFactor, 1, `materials[${index}].metallicFactor`),
    roughness: asFiniteFactor(pbr.roughnessFactor, 1, `materials[${index}].roughnessFactor`),
    opacity: base[3],
    transparent: alphaMode === 'BLEND',
    alphaTest: alphaMode === 'MASK'
      ? asFiniteFactor(definition?.alphaCutoff, 0.5, `materials[${index}].alphaCutoff`)
      : 0,
    side: definition?.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.depthWrite = alphaMode !== 'BLEND';
  return material;
}

function applyNodeTransform(object: THREE.Object3D, node: GlbNode, label: string): void {
  if (node.matrix !== undefined) {
    const matrix = asFactorArray(node.matrix, 16, new Array(16).fill(0), `${label}.matrix`);
    object.matrix.fromArray(matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    return;
  }
  const translation = asFactorArray(node.translation, 3, [0, 0, 0], `${label}.translation`);
  const rotation = asFactorArray(node.rotation, 4, [0, 0, 0, 1], `${label}.rotation`);
  const scale = asFactorArray(node.scale, 3, [1, 1, 1], `${label}.scale`);
  object.position.fromArray(translation);
  object.quaternion.fromArray(rotation);
  object.scale.fromArray(scale);
}

export function parseStaticStageGlb(
  value: ArrayBuffer | Uint8Array,
  options: StaticGlbParseOptions = {},
): THREE.Group {
  const decoded = decodeStaticGlb(value);
  const document = decoded.document;
  const materials = (document.materials ?? []).map(createMaterial);
  const meshes = document.meshes ?? [];
  const nodes = document.nodes ?? [];

  const createMesh = (meshIndex: number): THREE.Group => {
    const definition = meshes[asIndex(meshIndex, meshes.length, 'node.mesh')];
    if (!Array.isArray(definition.primitives) || definition.primitives.length === 0) {
      throw new GlbInspectionError(`meshes[${meshIndex}] has no primitives.`);
    }
    const group = new THREE.Group();
    group.name = typeof definition.name === 'string' ? definition.name : `stage-mesh-${meshIndex}`;
    for (let primitiveIndex = 0; primitiveIndex < definition.primitives.length; primitiveIndex += 1) {
      const primitive = definition.primitives[primitiveIndex];
      const label = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        throw new GlbInspectionError(`${label} must contain triangles.`);
      }
      if (primitive.targets !== undefined) {
        throw new GlbInspectionError(`${label} cannot contain morph targets.`);
      }
      const attributeNames = Object.keys(primitive.attributes ?? {});
      if (!attributeNames.includes('POSITION') || attributeNames.some((name) => name !== 'POSITION' && name !== 'NORMAL')) {
        throw new GlbInspectionError(`${label} must contain only POSITION and optional NORMAL attributes.`);
      }
      const geometry = new THREE.BufferGeometry();
      const position = readVector3Attribute(decoded, primitive.attributes?.POSITION, `${label}.POSITION`);
      geometry.setAttribute('position', position);
      if (primitive.attributes?.NORMAL !== undefined) {
        const normal = readVector3Attribute(decoded, primitive.attributes.NORMAL, `${label}.NORMAL`);
        if (normal.count !== position.count) {
          throw new GlbInspectionError(`${label} POSITION and NORMAL counts differ.`);
        }
        geometry.setAttribute('normal', normal);
      } else {
        geometry.computeVertexNormals();
      }
      if (primitive.indices !== undefined) {
        geometry.setIndex(readIndexAttribute(decoded, primitive.indices, `${label}.indices`));
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const materialIndex = primitive.material === undefined
        ? -1
        : asIndex(primitive.material, materials.length, `${label}.material`);
      const material = materialIndex >= 0
        ? materials[materialIndex]
        : new THREE.MeshStandardMaterial({ color: '#ffffff' });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${group.name}-primitive-${primitiveIndex}`;
      group.add(mesh);
    }
    return group;
  };

  const builtNodes = new Set<number>();
  const buildNode = (nodeIndex: number, ancestors: Set<number>): THREE.Object3D => {
    const resolvedIndex = asIndex(nodeIndex, nodes.length, 'scene node');
    if (ancestors.has(resolvedIndex) || builtNodes.has(resolvedIndex)) {
      throw new GlbInspectionError(`nodes[${resolvedIndex}] is cyclic or referenced more than once.`);
    }
    const node = nodes[resolvedIndex];
    if (node.camera !== undefined || node.skin !== undefined) {
      throw new GlbInspectionError(`nodes[${resolvedIndex}] cannot contain a camera or skin.`);
    }
    const object = new THREE.Group();
    object.name = typeof node.name === 'string' ? node.name : `stage-node-${resolvedIndex}`;
    if (node.extras && typeof node.extras === 'object' && !Array.isArray(node.extras)) {
      Object.assign(object.userData, node.extras);
    }
    applyNodeTransform(object, node, `nodes[${resolvedIndex}]`);
    if (node.mesh !== undefined) {
      object.add(createMesh(asIndex(node.mesh, meshes.length, `nodes[${resolvedIndex}].mesh`)));
    }
    builtNodes.add(resolvedIndex);
    const nextAncestors = new Set(ancestors).add(resolvedIndex);
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        throw new GlbInspectionError(`nodes[${resolvedIndex}].children must be an array.`);
      }
      for (const childIndex of node.children) {
        object.add(buildNode(Number(childIndex), nextAncestors));
      }
    }
    return object;
  };

  const scenes = document.scenes ?? [];
  const sceneIndex = asIndex(document.scene ?? 0, scenes.length, 'scene');
  const sceneDefinition = scenes[sceneIndex];
  if (!Array.isArray(sceneDefinition.nodes) || sceneDefinition.nodes.length === 0) {
    throw new GlbInspectionError(`scenes[${sceneIndex}] has no root nodes.`);
  }
  const root = new THREE.Group();
  root.name = typeof sceneDefinition.name === 'string' ? sceneDefinition.name : 'static-stage-model';
  for (const nodeIndex of sceneDefinition.nodes) {
    root.add(buildNode(Number(nodeIndex), new Set()));
  }

  if (options.expectedAssetId) {
    let foundAssetId: string | null = null;
    root.traverse((object) => {
      if (typeof object.userData.asset_id === 'string') {
        foundAssetId = object.userData.asset_id;
      }
    });
    if (foundAssetId !== options.expectedAssetId) {
      throw new GlbInspectionError(
        `Static stage GLB asset id ${foundAssetId ?? 'missing'} does not match ${options.expectedAssetId}.`,
      );
    }
  }
  return root;
}
