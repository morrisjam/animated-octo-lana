import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_ASSET_MANIFEST } from '../src/view/assets/defaultManifest';
import { inspectGlb, type GlbInspection } from '../src/view/assets/glbInspection';

const ASSET_ID = 'wormhole_arena_lip_v1';
const EXPECTED_SOURCE = '/assets/stages/wormhole/wormhole-arena-lip-v1.glb';
const METRICS_PATH = resolve(process.cwd(), '..', '..', 'art', 'review', 'wormhole_arena_lip_v1.metrics.json');

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

interface StageModelValidationReport {
  generatedAt: string;
  assetId: string;
  source: string;
  valid: boolean;
  inspection: GlbInspection | null;
  sourceSha256: string | null;
  issues: string[];
}

function writeReport(report: StageModelValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'stage-model-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function validate(): StageModelValidationReport {
  const issues: string[] = [];
  const manifestEntry = DEFAULT_ASSET_MANIFEST.models.find((entry) => entry.id === ASSET_ID);
  let inspection: GlbInspection | null = null;
  let sourceSha256: string | null = null;

  if (!manifestEntry) {
    issues.push(`DEFAULT_ASSET_MANIFEST.models is missing ${ASSET_ID}.`);
  } else {
    if (manifestEntry.src !== EXPECTED_SOURCE) {
      issues.push(`manifest source must be ${EXPECTED_SOURCE}.`);
    }
    if (manifestEntry.readiness !== 'prototype') {
      issues.push('new authored model must remain prototype until visual review is accepted.');
    }
    if (!manifestEntry.contentTypes?.includes('model/gltf-binary')) {
      issues.push('manifest must require model/gltf-binary content type.');
    }
  }

  const glbPath = resolve(process.cwd(), 'public', EXPECTED_SOURCE.replace(/^\/assets\//, 'assets/'));
  let glb: Buffer | null = null;
  try {
    glb = readFileSync(glbPath);
    inspection = inspectGlb(glb);
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
      issues.push('static stage lip must not contain animations or skins.');
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
    const metrics = JSON.parse(readFileSync(METRICS_PATH, 'utf8')) as SourceMetrics;
    if (metrics.schemaVersion !== 'gw.blender-stage-source-metrics.v1' || metrics.assetId !== ASSET_ID) {
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
    generatedAt: new Date().toISOString(),
    assetId: ASSET_ID,
    source: EXPECTED_SOURCE,
    valid: issues.length === 0,
    inspection,
    sourceSha256,
    issues,
  };
}

const report = validate();
const reportPath = writeReport(report);
console.info(`[stage-model] report written ${reportPath}`);
if (report.inspection) {
  console.info(
    `[stage-model] ${report.inspection.meshCount} meshes, ${report.inspection.vertexCount} vertices, `
      + `${report.inspection.triangleCount} triangles, ${report.inspection.byteLength} bytes`,
  );
}
if (!report.valid) {
  for (const issue of report.issues) {
    console.error(`[stage-model] invalid: ${issue}`);
  }
  process.exitCode = 1;
} else {
  console.info('[stage-model] pass');
}
