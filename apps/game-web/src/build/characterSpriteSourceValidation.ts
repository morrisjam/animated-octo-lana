import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface CharacterSpriteSourceDefinition {
  characterId: string;
  metricsPath: string;
  presentationPath: string;
}

export interface CharacterSpriteSourceValidationEntry {
  characterId: string;
  assetId: string | null;
  metricsPath: string;
  valid: boolean;
  sourceSha256: string | null;
  runtimeAtlasSha256: string | null;
  runtimePortraitSha256: string | null;
  reviewedFrameCount: number;
  issues: string[];
}

export interface CharacterSpriteSourceValidationReport {
  schemaVersion: 'gw.character-sprite-source-validation.v1';
  generatedAt: string;
  valid: boolean;
  characters: CharacterSpriteSourceValidationEntry[];
}

interface PngInspection {
  widthPixels: number;
  heightPixels: number;
  hasAlphaChannel: boolean;
}

interface ArtifactRecord {
  path: string;
  sha256: string;
  bytes: number;
  widthPixels: number;
  heightPixels: number;
}

interface ValidatedFile {
  buffer: Buffer;
  sha256: string;
}

export const DEFAULT_CHARACTER_SPRITE_SOURCE_DEFINITIONS: readonly CharacterSpriteSourceDefinition[] = [
  {
    characterId: 'vanguard',
    metricsPath: 'art/review/vanguard_sprite_v1.metrics.json',
    presentationPath: 'apps/game-web/content/characters/vanguard/vanguard.character.presentation.json',
  },
  {
    characterId: 'duelist',
    metricsPath: 'art/review/duelist_sprite_v1.metrics.json',
    presentationPath: 'apps/game-web/content/characters/duelist/duelist.character.presentation.json',
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizedRepoPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolveRepoPath(repoRoot: string, repoPath: string): string {
  if (!repoPath || isAbsolute(repoPath)) {
    throw new Error(`path must be repository-relative: ${repoPath || '<empty>'}`);
  }
  const root = resolve(repoRoot);
  const candidate = resolve(root, normalizedRepoPath(repoPath));
  const fromRoot = relative(root, candidate);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`path escapes the repository root: ${repoPath}`);
  }
  return candidate;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizedTextSha256(buffer: Buffer): string {
  const normalized = buffer.toString('utf8').replace(/\r\n?/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function readCheckedFile(
  repoRoot: string,
  repoPath: string,
  label: string,
  issues: string[],
): ValidatedFile | null {
  try {
    const absolutePath = resolveRepoPath(repoRoot, repoPath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      issues.push(`${label} is missing: ${normalizedRepoPath(repoPath)}.`);
      return null;
    }
    const buffer = readFileSync(absolutePath);
    return { buffer, sha256: sha256(buffer) };
  } catch (error) {
    issues.push(`${label} is invalid: ${error instanceof Error ? error.message : 'unknown file error'}.`);
    return null;
  }
}

function readJsonRecord(
  repoRoot: string,
  repoPath: string,
  label: string,
  issues: string[],
): Record<string, unknown> | null {
  const file = readCheckedFile(repoRoot, repoPath, label, issues);
  if (!file) {
    return null;
  }
  try {
    const record = asRecord(JSON.parse(file.buffer.toString('utf8')));
    if (!record) {
      issues.push(`${label} must contain a JSON object.`);
    }
    return record;
  } catch (error) {
    issues.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}.`);
    return null;
  }
}

function inspectPng(buffer: Buffer): PngInspection {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('file is not a PNG');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG does not begin with an IHDR chunk');
  }
  const widthPixels = buffer.readUInt32BE(16);
  const heightPixels = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  if (widthPixels < 1 || heightPixels < 1) {
    throw new Error(`PNG dimensions are invalid (${widthPixels}x${heightPixels})`);
  }
  return {
    widthPixels,
    heightPixels,
    hasAlphaChannel: colorType === 4 || colorType === 6,
  };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseArtifactRecord(
  artifacts: Record<string, unknown>,
  key: string,
  issues: string[],
): ArtifactRecord | null {
  const record = asRecord(artifacts[key]);
  if (!record) {
    issues.push(`metrics.artifacts.${key} must be an object.`);
    return null;
  }
  const path = readString(record, 'path');
  const expectedSha256 = readString(record, 'sha256');
  const bytes = readFiniteNumber(record, 'bytes');
  const widthPixels = readFiniteNumber(record, 'widthPixels');
  const heightPixels = readFiniteNumber(record, 'heightPixels');
  if (!path || !expectedSha256 || bytes === null || widthPixels === null || heightPixels === null) {
    issues.push(`metrics.artifacts.${key} has incomplete provenance fields.`);
    return null;
  }
  return { path, sha256: expectedSha256, bytes, widthPixels, heightPixels };
}

function validateHashedRecord(
  repoRoot: string,
  record: ArtifactRecord,
  label: string,
  issues: string[],
): { sha256: string; png: PngInspection } | null {
  const file = readCheckedFile(repoRoot, record.path, label, issues);
  if (!file) {
    return null;
  }
  if (file.buffer.length !== record.bytes) {
    issues.push(`${label} byte count is ${file.buffer.length}; metrics record ${record.bytes}.`);
  }
  if (file.sha256 !== record.sha256) {
    issues.push(`${label} SHA-256 does not match its source metrics.`);
  }
  try {
    const png = inspectPng(file.buffer);
    if (png.widthPixels !== record.widthPixels || png.heightPixels !== record.heightPixels) {
      issues.push(
        `${label} dimensions are ${png.widthPixels}x${png.heightPixels}; metrics record `
        + `${record.widthPixels}x${record.heightPixels}.`,
      );
    }
    if (!png.hasAlphaChannel) {
      issues.push(`${label} must use an alpha-capable PNG colour type.`);
    }
    return { sha256: file.sha256, png };
  } catch (error) {
    issues.push(`${label} is invalid: ${error instanceof Error ? error.message : 'PNG inspection failed'}.`);
    return null;
  }
}

function getNestedRecord(
  parent: Record<string, unknown>,
  key: string,
  label: string,
  issues: string[],
): Record<string, unknown> | null {
  const record = asRecord(parent[key]);
  if (!record) {
    issues.push(`${label} must be an object.`);
  }
  return record;
}

function publicSourceToRepoPath(source: string): string | null {
  const pathname = source.split('?')[0];
  if (!pathname.startsWith('/assets/')) {
    return null;
  }
  return `apps/game-web/public${pathname}`;
}

function validateManifestAsset(
  asset: Record<string, unknown>,
  label: string,
  expectedRecord: ArtifactRecord,
  issues: string[],
): void {
  const src = readString(asset, 'src');
  const expectedPath = normalizedRepoPath(expectedRecord.path);
  const manifestPath = src ? publicSourceToRepoPath(src) : null;
  if (!manifestPath || normalizedRepoPath(manifestPath) !== expectedPath) {
    issues.push(`${label}.src must resolve to ${expectedPath}.`);
  }
  if (asset.contentType !== 'image/png') {
    issues.push(`${label}.contentType must be image/png.`);
  }
  if (asset.readiness !== 'alpha' && asset.readiness !== 'production') {
    issues.push(`${label}.readiness must be alpha or production.`);
  }
  if (asset.widthPixels !== expectedRecord.widthPixels || asset.heightPixels !== expectedRecord.heightPixels) {
    issues.push(`${label} dimensions must be ${expectedRecord.widthPixels}x${expectedRecord.heightPixels}.`);
  }
  const budget = getNestedRecord(asset, 'budget', `${label}.budget`, issues);
  if (!budget) {
    return;
  }
  const estimatedBytes = readFiniteNumber(budget, 'estimatedBytes');
  const estimatedTextureBytes = readFiniteNumber(budget, 'estimatedTextureBytes');
  const decodedTextureBytes = expectedRecord.widthPixels * expectedRecord.heightPixels * 4;
  if (estimatedBytes === null || estimatedBytes < expectedRecord.bytes) {
    issues.push(`${label}.budget.estimatedBytes must cover ${expectedRecord.bytes} source bytes.`);
  }
  if (estimatedTextureBytes === null || estimatedTextureBytes < decodedTextureBytes) {
    issues.push(`${label}.budget.estimatedTextureBytes must cover ${decodedTextureBytes} decoded bytes.`);
  }
}

function validateDefinition(
  repoRoot: string,
  definition: CharacterSpriteSourceDefinition,
): CharacterSpriteSourceValidationEntry {
  const issues: string[] = [];
  let assetId: string | null = null;
  let sourceSha256: string | null = null;
  let runtimeAtlasSha256: string | null = null;
  let runtimePortraitSha256: string | null = null;
  let reviewedFrameCount = 0;

  const metrics = readJsonRecord(repoRoot, definition.metricsPath, 'source metrics', issues);
  if (!metrics) {
    return {
      characterId: definition.characterId,
      assetId,
      metricsPath: definition.metricsPath,
      valid: false,
      sourceSha256,
      runtimeAtlasSha256,
      runtimePortraitSha256,
      reviewedFrameCount,
      issues,
    };
  }

  if (metrics.schemaVersion !== 'gw.character-sprite-source-metrics.v1') {
    issues.push('metrics.schemaVersion must be gw.character-sprite-source-metrics.v1.');
  }
  assetId = readString(metrics, 'assetId');
  if (!assetId) {
    issues.push('metrics.assetId must be a non-empty string.');
  }
  if (metrics.characterId !== definition.characterId) {
    issues.push(`metrics.characterId must be ${definition.characterId}.`);
  }
  if (!readString(metrics, 'blenderVersion')) {
    issues.push('metrics.blenderVersion must be recorded.');
  }
  if (!readString(metrics, 'renderEngine')) {
    issues.push('metrics.renderEngine must be recorded.');
  }

  const sourcePath = readString(metrics, 'source');
  const recordedSourceSha256 = readString(metrics, 'sourceSha256');
  if (!sourcePath || !recordedSourceSha256) {
    issues.push('metrics source path and SHA-256 must be recorded.');
  } else {
    const sourceFile = readCheckedFile(repoRoot, sourcePath, 'Blender source script', issues);
    sourceSha256 = sourceFile ? normalizedTextSha256(sourceFile.buffer) : null;
    if (sourceSha256 && sourceSha256 !== recordedSourceSha256) {
      issues.push('Blender source script SHA-256 does not match its source metrics.');
    }
  }

  const sourceBlendPath = readString(metrics, 'sourceBlend');
  if (!sourceBlendPath) {
    issues.push('metrics.sourceBlend must be recorded.');
  } else {
    readCheckedFile(repoRoot, sourceBlendPath, 'Blender source file', issues);
  }

  const sharedRenderHelpers = readString(metrics, 'sharedRenderHelpers');
  const sharedRenderHelpersSha256 = readString(metrics, 'sharedRenderHelpersSha256');
  if (sharedRenderHelpers || sharedRenderHelpersSha256) {
    if (!sharedRenderHelpers || !sharedRenderHelpersSha256) {
      issues.push('shared render helper path and SHA-256 must be recorded together.');
    } else {
      const helper = readCheckedFile(repoRoot, sharedRenderHelpers, 'shared render helpers', issues);
      if (helper && normalizedTextSha256(helper.buffer) !== sharedRenderHelpersSha256) {
        issues.push('Shared render helper SHA-256 does not match its source metrics.');
      }
    }
  }

  const concept = getNestedRecord(metrics, 'conceptReference', 'metrics.conceptReference', issues);
  if (concept) {
    const conceptPath = readString(concept, 'path');
    const conceptSha256 = readString(concept, 'sha256');
    const conceptBytes = readFiniteNumber(concept, 'bytes');
    if (!conceptPath || !conceptSha256 || conceptBytes === null) {
      issues.push('metrics.conceptReference has incomplete provenance fields.');
    } else {
      const conceptFile = readCheckedFile(repoRoot, conceptPath, 'concept reference', issues);
      if (conceptFile && conceptFile.sha256 !== conceptSha256) {
        issues.push('Concept reference SHA-256 does not match its source metrics.');
      }
      if (conceptFile && conceptFile.buffer.length !== conceptBytes) {
        issues.push(`Concept reference byte count is ${conceptFile.buffer.length}; metrics record ${conceptBytes}.`);
      }
    }
  }

  const rawFrameOrder = Array.isArray(metrics.frameOrder) ? metrics.frameOrder : null;
  const frameOrder = rawFrameOrder
    ? rawFrameOrder.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  if (!rawFrameOrder || frameOrder.length === 0 || frameOrder.length !== rawFrameOrder.length) {
    issues.push('metrics.frameOrder must contain only non-empty frame names.');
  }
  if (new Set(frameOrder).size !== frameOrder.length) {
    issues.push('metrics.frameOrder must not contain duplicate frame names.');
  }

  const layout = getNestedRecord(metrics, 'runtimeLayout', 'metrics.runtimeLayout', issues);
  const columns = layout ? readFiniteNumber(layout, 'columns') : null;
  const rows = layout ? readFiniteNumber(layout, 'rows') : null;
  const frameWidthPixels = layout ? readFiniteNumber(layout, 'frameWidthPixels') : null;
  const frameHeightPixels = layout ? readFiniteNumber(layout, 'frameHeightPixels') : null;
  const anchorX = layout ? readFiniteNumber(layout, 'anchorX') : null;
  const anchorY = layout ? readFiniteNumber(layout, 'anchorY') : null;
  if (
    columns === null || rows === null || frameWidthPixels === null || frameHeightPixels === null
    || anchorX === null || anchorY === null
  ) {
    issues.push('metrics.runtimeLayout has incomplete numeric fields.');
  } else if (frameOrder.length !== columns * rows) {
    issues.push(`metrics.frameOrder has ${frameOrder.length} entries; layout requires ${columns * rows}.`);
  }

  const artifacts = getNestedRecord(metrics, 'artifacts', 'metrics.artifacts', issues);
  const reviewAtlas = artifacts ? parseArtifactRecord(artifacts, 'reviewAtlas', issues) : null;
  const reviewPortrait = artifacts ? parseArtifactRecord(artifacts, 'reviewPortrait', issues) : null;
  const runtimeAtlas = artifacts ? parseArtifactRecord(artifacts, 'runtimeAtlas', issues) : null;
  const runtimePortrait = artifacts ? parseArtifactRecord(artifacts, 'runtimePortrait', issues) : null;
  if (reviewAtlas) {
    validateHashedRecord(repoRoot, reviewAtlas, 'review atlas', issues);
  }
  if (reviewPortrait) {
    validateHashedRecord(repoRoot, reviewPortrait, 'review portrait', issues);
  }
  if (runtimeAtlas) {
    runtimeAtlasSha256 = validateHashedRecord(repoRoot, runtimeAtlas, 'runtime atlas', issues)?.sha256 ?? null;
  }
  if (runtimePortrait) {
    runtimePortraitSha256 = validateHashedRecord(repoRoot, runtimePortrait, 'runtime portrait', issues)?.sha256 ?? null;
  }

  if (runtimeAtlas && columns !== null && rows !== null && frameWidthPixels !== null && frameHeightPixels !== null) {
    if (
      runtimeAtlas.widthPixels !== columns * frameWidthPixels
      || runtimeAtlas.heightPixels !== rows * frameHeightPixels
    ) {
      issues.push('Runtime atlas dimensions do not match the declared grid and frame size.');
    }
  }

  if (assetId && reviewAtlas && columns !== null && rows !== null && columns > 0 && rows > 0) {
    const reviewFrameWidth = reviewAtlas.widthPixels / columns;
    const reviewFrameHeight = reviewAtlas.heightPixels / rows;
    if (!Number.isInteger(reviewFrameWidth) || !Number.isInteger(reviewFrameHeight)) {
      issues.push('Review atlas dimensions do not divide evenly into the runtime layout.');
    } else {
      for (let index = 0; index < frameOrder.length; index += 1) {
        const framePath = `art/review/${assetId}_frames/${String(index).padStart(2, '0')}_${frameOrder[index]}.png`;
        const frame = readCheckedFile(repoRoot, framePath, `review frame ${index}`, issues);
        if (!frame) {
          continue;
        }
        try {
          const png = inspectPng(frame.buffer);
          if (png.widthPixels !== reviewFrameWidth || png.heightPixels !== reviewFrameHeight) {
            issues.push(
              `review frame ${index} dimensions are ${png.widthPixels}x${png.heightPixels}; expected `
              + `${reviewFrameWidth}x${reviewFrameHeight}.`,
            );
          }
          if (!png.hasAlphaChannel) {
            issues.push(`review frame ${index} must use an alpha-capable PNG colour type.`);
          }
          reviewedFrameCount += 1;
        } catch (error) {
          issues.push(`review frame ${index} is invalid: ${error instanceof Error ? error.message : 'PNG inspection failed'}.`);
        }
      }
    }
  }

  const presentation = readJsonRecord(repoRoot, definition.presentationPath, 'presentation manifest', issues);
  if (presentation) {
    if (presentation.schemaVersion !== 'gw.character-presentation.v1') {
      issues.push('presentation.schemaVersion must be gw.character-presentation.v1.');
    }
    if (presentation.characterId !== definition.characterId) {
      issues.push(`presentation.characterId must be ${definition.characterId}.`);
    }
    const animationSet = getNestedRecord(presentation, 'animationSet', 'presentation.animationSet', issues);
    const atlas = animationSet
      ? getNestedRecord(animationSet, 'atlas', 'presentation.animationSet.atlas', issues)
      : null;
    const portrait = getNestedRecord(presentation, 'portrait', 'presentation.portrait', issues);
    if (atlas && runtimeAtlas) {
      validateManifestAsset(atlas, 'presentation.animationSet.atlas', runtimeAtlas, issues);
      if (
        (columns !== null && atlas.columns !== columns)
        || (rows !== null && atlas.rows !== rows)
        || (frameWidthPixels !== null && atlas.frameWidthPixels !== frameWidthPixels)
        || (frameHeightPixels !== null && atlas.frameHeightPixels !== frameHeightPixels)
        || (anchorX !== null && atlas.anchorX !== anchorX)
        || (anchorY !== null && atlas.anchorY !== anchorY)
      ) {
        issues.push('Presentation atlas layout does not match the Blender source metrics.');
      }
    }
    if (portrait && runtimePortrait) {
      validateManifestAsset(portrait, 'presentation.portrait', runtimePortrait, issues);
    }
  }

  return {
    characterId: definition.characterId,
    assetId,
    metricsPath: definition.metricsPath,
    valid: issues.length === 0,
    sourceSha256,
    runtimeAtlasSha256,
    runtimePortraitSha256,
    reviewedFrameCount,
    issues,
  };
}

export function validateCharacterSpriteSources(
  repoRoot: string,
  definitions: readonly CharacterSpriteSourceDefinition[] = DEFAULT_CHARACTER_SPRITE_SOURCE_DEFINITIONS,
  generatedAt = new Date().toISOString(),
): CharacterSpriteSourceValidationReport {
  const characters = definitions.map((definition) => validateDefinition(repoRoot, definition));
  return {
    schemaVersion: 'gw.character-sprite-source-validation.v1',
    generatedAt,
    valid: characters.length > 0 && characters.every((character) => character.valid),
    characters,
  };
}
