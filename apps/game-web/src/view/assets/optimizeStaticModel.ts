import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface StaticModelOptimizationReport {
  sourceDrawCalls: number;
  sourceInstances: number;
  skippedTransparentDrawCalls: number;
  mergedDrawCalls: number;
  triangleCount: number;
}

export interface OptimizedStaticModel {
  model: THREE.Group;
  report: StaticModelOptimizationReport;
}

function isEffectivelyVisible(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    if (current === root) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function prepareGeometry(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.clearGroups();

  for (const attributeName of Object.keys(geometry.attributes)) {
    if (!['position', 'normal', 'uv'].includes(attributeName)) {
      geometry.deleteAttribute(attributeName);
    }
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  if (!geometry.getAttribute('uv')) {
    const vertexCount = geometry.getAttribute('position').count;
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(vertexCount * 2, 2));
  }

  geometry.applyMatrix4(matrix);
  return geometry;
}

/**
 * Bakes a static hierarchy into one mesh per visible material. This is intended
 * for generated stage props, not animated, skinned, or destructible objects.
 */
export function optimizeStaticModelByMaterial(
  source: THREE.Object3D,
  name = `${source.name || 'Static model'} (optimized)`,
): OptimizedStaticModel {
  source.updateMatrixWorld(true);
  const buckets = new Map<string, {
    material: THREE.Material;
    geometries: THREE.BufferGeometry[];
    castShadow: boolean;
    receiveShadow: boolean;
  }>();
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  const instanceMatrix = new THREE.Matrix4();
  const bakedMatrix = new THREE.Matrix4();
  let sourceDrawCalls = 0;
  let sourceInstances = 0;
  let skippedTransparentDrawCalls = 0;
  let triangleCount = 0;

  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !isEffectivelyVisible(object, source)) {
      return;
    }
    if (Array.isArray(object.material)) {
      throw new Error(`Static optimizer does not support multi-material mesh "${object.name}".`);
    }

    sourceDrawCalls += 1;
    sourceGeometries.add(object.geometry);
    if (object.material.opacity <= 0) {
      skippedTransparentDrawCalls += 1;
      return;
    }

    const bucket = buckets.get(object.material.uuid) ?? {
      material: object.material,
      geometries: [],
      castShadow: false,
      receiveShadow: false,
    };
    bucket.castShadow ||= object.castShadow;
    bucket.receiveShadow ||= object.receiveShadow;

    const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
    sourceInstances += instanceCount;
    for (let index = 0; index < instanceCount; index += 1) {
      if (object instanceof THREE.InstancedMesh) {
        object.getMatrixAt(index, instanceMatrix);
        bakedMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      } else {
        bakedMatrix.copy(object.matrixWorld);
      }
      const geometry = prepareGeometry(object.geometry, bakedMatrix);
      triangleCount += geometry.getAttribute('position').count / 3;
      bucket.geometries.push(geometry);
    }
    buckets.set(object.material.uuid, bucket);
  });

  const model = new THREE.Group();
  model.name = name;
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    if (!geometry) {
      throw new Error(`Unable to merge static geometry for material "${bucket.material.name}".`);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = `${bucket.material.name || bucket.material.type} batch`;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    model.add(mesh);
    for (const preparedGeometry of bucket.geometries) {
      preparedGeometry.dispose();
    }
  }

  for (const geometry of sourceGeometries) {
    geometry.dispose();
  }

  const report: StaticModelOptimizationReport = {
    sourceDrawCalls,
    sourceInstances,
    skippedTransparentDrawCalls,
    mergedDrawCalls: model.children.length,
    triangleCount,
  };
  model.userData.staticOptimization = report;
  return { model, report };
}
