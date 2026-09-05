import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { DEFAULT_ASSET_MANIFEST } from '../src/view/assets/defaultManifest';
import { inspectGlb, type GlbInspection } from '../src/view/assets/glbInspection';
import { parseStaticStageGlb } from '../src/view/assets/staticGlbRuntime';

interface AuthoredStageModelDefinition {
  assetId: string;
  source: string;
  metricsFile: string;
}

const AUTHORED_STAGE_MODELS: AuthoredStageModelDefinition[] = [
  {
    assetId: 'wormhole_nebula_v5',
    source: '/assets/stages/wormhole/wormhole-nebula-v5.glb',
    metricsFile: 'wormhole_nebula_v5.metrics.json',
  },
  {
    assetId: 'wormhole_arena_lip_v1',
    source: '/assets/stages/wormhole/wormhole-arena-lip-v1.glb',
    metricsFile: 'wormhole_arena_lip_v1.metrics.json',
  },
  {
    assetId: 'wormhole_arena_depth_v2',
    source: '/assets/stages/wormhole/wormhole-arena-depth-v2.glb',
    metricsFile: 'wormhole_arena_depth_v2.metrics.json',
  },
  {
    assetId: 'wormhole_arena_funnel_v3',
    source: '/assets/stages/wormhole/wormhole-arena-funnel-v3.glb',
    metricsFile: 'wormhole_arena_funnel_v3.metrics.json',
  },
  {
    assetId: 'wormhole_arena_rift_v4',
    source: '/assets/stages/wormhole/wormhole-arena-rift-v4.glb',
    metricsFile: 'wormhole_arena_rift_v4.metrics.json',
  },
];

interface SourceMetrics {
  schemaVersion?: unknown;
  assetId?: unknown;
  metrics?: {
    vertices?: unknown;
    triangles?: unknown;
    glbBytes?: unknown;
    glbSha256?: unknown;
  };
}

interface StageModelValidationEntry {
  assetId: string;
  source: string;
  valid: boolean;
  inspection: GlbInspection | null;
  runtimeParseValid: boolean;
  sourceSha256: string | null;
  issues: string[];
}

interface StageModelValidationReport {
  schemaVersion: 'gw.stage-model-validation.v2';
  generatedAt: string;
  valid: boolean;
  models: StageModelValidationEntry[];
}

function disposeParsedModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
}

function writeReport(report: StageModelValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'stage-model-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function validateModel(definition: AuthoredStageModelDefinition): StageModelValidationEntry {
  const issues: string[] = [];
  const manifestEntry = DEFAULT_ASSET_MANIFEST.models.find((entry) => entry.id === definition.assetId);
  let inspection: GlbInspection | null = null;
  let runtimeParseValid = false;
  let sourceSha256: string | null = null;

  if (!manifestEntry) {
    issues.push(`DEFAULT_ASSET_MANIFEST.models is missing ${definition.assetId}.`);
  } else {
    if (manifestEntry.src !== definition.source) {
      issues.push(`manifest source must be ${definition.source}.`);
    }
    if (manifestEntry.readiness !== 'prototype') {
      issues.push('new authored model must remain prototype until visual review is accepted.');
    }
    if (!manifestEntry.contentTypes?.includes('model/gltf-binary')) {
      issues.push('manifest must require model/gltf-binary content type.');
    }
  }

  const glbPath = resolve(process.cwd(), 'public', definition.source.replace(/^\/assets\//, 'assets/'));
  let glb: Buffer | null = null;
  try {
    glb = readFileSync(glbPath);
    inspection = inspectGlb(glb);
    const parsedModel = parseStaticStageGlb(glb, { expectedAssetId: definition.assetId });
    disposeParsedModel(parsedModel);
    runtimeParseValid = true;
    sourceSha256 = createHash('sha256').update(glb).digest('hex');
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'unable to inspect GLB.');
  }

  if (inspection) {
    if (inspection.sceneCount !== 1) {
      issues.push(`GLB must contain exactly one scene; received ${inspection.sceneCount}.`);
    }
    if (inspection.meshCount < 1 || inspection.primitiveCount < 1) {
      issues.push('GLB must contain renderable mesh primitives.');
    }
    if (!inspection.hasBinaryChunk) {
      issues.push('GLB must contain an embedded binary chunk.');
    }
    if (inspection.externalUris.length > 0) {
      issues.push(`GLB must not reference external resources: ${inspection.externalUris.join(', ')}.`);
    }
    if (inspection.animationCount !== 0 || inspection.skinCount !== 0) {
      issues.push('static stage model must not contain animations or skins.');
    }
    if (inspection.materialCount > 8) {
      issues.push(`GLB material count ${inspection.materialCount} exceeds 8.`);
    }
    const budget = manifestEntry?.budget;
    if (!budget?.estimatedBytes || inspection.byteLength > budget.estimatedBytes) {
      issues.push(`GLB bytes ${inspection.byteLength} exceed manifest estimate ${budget?.estimatedBytes ?? 0}.`);
    }
    if (!budget?.estimatedVertices || inspection.vertexCount > budget.estimatedVertices) {
      issues.push(`GLB vertices ${inspection.vertexCount} exceed manifest estimate ${budget?.estimatedVertices ?? 0}.`);
    }
    if (!budget?.estimatedTriangles || inspection.triangleCount > budget.estimatedTriangles) {
      issues.push(`GLB triangles ${inspection.triangleCount} exceed manifest estimate ${budget?.estimatedTriangles ?? 0}.`);
    }
  }

  try {
    const metricsPath = resolve(process.cwd(), '..', '..', 'art', 'review', definition.metricsFile);
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as SourceMetrics;
    if (
      metrics.schemaVersion !== 'gw.blender-stage-source-metrics.v1'
      || metrics.assetId !== definition.assetId
    ) {
      issues.push('Blender source metrics identity is invalid.');
    }
    if (inspection && metrics.metrics?.vertices !== inspection.vertexCount) {
      issues.push('Blender source vertex metrics do not match the runtime GLB.');
    }
    if (inspection && metrics.metrics?.triangles !== inspection.triangleCount) {
      issues.push('Blender source triangle metrics do not match the runtime GLB.');
    }
    if (inspection && metrics.metrics?.glbBytes !== inspection.byteLength) {
      issues.push('Blender source byte metrics do not match the runtime GLB.');
    }
    if (sourceSha256 && metrics.metrics?.glbSha256 !== sourceSha256) {
      issues.push('Blender source SHA-256 does not match the runtime GLB.');
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'unable to read Blender source metrics.');
  }

  return {
    assetId: definition.assetId,
    source: definition.source,
    valid: issues.length === 0,
    inspection,
    runtimeParseValid,
    sourceSha256,
    issues,
  };
}

function validate(): StageModelValidationReport {
  const models = AUTHORED_STAGE_MODELS.map(validateModel);
  return {
    schemaVersion: 'gw.stage-model-validation.v2',
    generatedAt: new Date().toISOString(),
    valid: models.every((model) => model.valid),
    models,
  };
}

const report = validate();
const reportPath = writeReport(report);
console.info(`[stage-model] report written ${reportPath}`);
for (const model of report.models) {
  if (model.inspection) {
    console.info(
      `[stage-model] ${model.assetId}: ${model.inspection.meshCount} meshes, `
        + `${model.inspection.vertexCount} vertices, ${model.inspection.triangleCount} triangles, `
        + `${model.inspection.byteLength} bytes`,
    );
  }
  for (const issue of model.issues) {
    console.error(`[stage-model] ${model.assetId} invalid: ${issue}`);
  }
}
if (!report.valid) {
  process.exitCode = 1;
} else {
  console.info('[stage-model] pass');
}
