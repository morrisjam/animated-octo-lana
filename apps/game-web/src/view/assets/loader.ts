import type {
  AssetFileEntry,
  AssetKind,
  AssetManifest,
  AssetManifestEntryBase,
  AssetShaderEntry,
} from './types';

export interface AssetPreloadProgress {
  loaded: number;
  total: number;
  kind: AssetKind;
  id: string;
}

export interface LoadedAssetEntry {
  kind: AssetKind;
  id: string;
  sources: string[];
  bytes: number;
  contentTypes: string[];
}

export interface AssetPreloadResult {
  total: number;
  loaded: number;
  entries: LoadedAssetEntry[];
}

export interface AssetImageDimensions {
  width: number;
  height: number;
}

export type AssetImageDimensionDecoder = (
  body: ArrayBuffer,
  contentType: string,
) => AssetImageDimensions | Promise<AssetImageDimensions>;

export interface AssetLoaderOptions {
  onProgress?: (progress: AssetPreloadProgress) => void;
  fetchImpl?: typeof fetch;
  imageDimensionDecoder?: AssetImageDimensionDecoder;
}

interface PreloadTarget {
  kind: AssetKind;
  id: string;
  sources: string[];
  expectedContentTypes?: string[];
  expectedImage?: AssetImageDimensions;
}

interface SourceLoadResult {
  bytes: number;
  contentType: string;
}

export class AssetManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetManifestValidationError';
  }
}

export class AssetLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetLoadError';
  }
}

function normaliseText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function normaliseContentType(value: unknown): string {
  return normaliseText(value).split(';', 1)[0].trim().toLowerCase();
}

function assertManifestEntryBase(kind: AssetKind, entry: AssetManifestEntryBase, index: number): void {
  if (normaliseText(entry.id).length === 0) {
    throw new AssetManifestValidationError(`Invalid asset manifest: ${kind}[${index}] is missing a non-empty id.`);
  }
  if (
    entry.readiness !== undefined
    && entry.readiness !== 'prototype'
    && entry.readiness !== 'alpha'
    && entry.readiness !== 'production'
  ) {
    throw new AssetManifestValidationError(
      `Invalid asset manifest: ${kind}[${index}] (${entry.id}) has invalid readiness.`,
    );
  }
  if (!entry.budget) {
    return;
  }
  const budgetEntries = Object.entries(entry.budget);
  for (const [field, value] of budgetEntries) {
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new AssetManifestValidationError(
        `Invalid asset manifest: ${kind}[${index}] (${entry.id}) has invalid budget.${field}.`,
      );
    }
  }
}

function assertAssetFileEntry(kind: Exclude<AssetKind, 'shader'>, entry: AssetFileEntry, index: number): void {
  assertManifestEntryBase(kind, entry, index);
  if (normaliseText(entry.src).length === 0) {
    throw new AssetManifestValidationError(`Invalid asset manifest: ${kind}[${index}] (${entry.id}) is missing src.`);
  }
  if (entry.contentTypes !== undefined) {
    if (!Array.isArray(entry.contentTypes) || entry.contentTypes.length === 0) {
      throw new AssetManifestValidationError(
        `Invalid asset manifest: ${kind}[${index}] (${entry.id}) has invalid contentTypes.`,
      );
    }
    const seenContentTypes = new Set<string>();
    for (let contentTypeIndex = 0; contentTypeIndex < entry.contentTypes.length; contentTypeIndex += 1) {
      const declaredContentType = normaliseText(entry.contentTypes[contentTypeIndex]);
      const contentType = normaliseContentType(declaredContentType);
      if (
        declaredContentType !== contentType
        || !MIME_TYPE_PATTERN.test(contentType)
        || seenContentTypes.has(contentType)
      ) {
        throw new AssetManifestValidationError(
          `Invalid asset manifest: ${kind}[${index}] (${entry.id}) has invalid contentTypes[${contentTypeIndex}].`,
        );
      }
      seenContentTypes.add(contentType);
    }
  }
  if (entry.image !== undefined) {
    const image = entry.image as AssetImageDimensions | null;
    if (
      image === null
      || typeof image !== 'object'
      || !Number.isInteger(image.width)
      || image.width <= 0
      || !Number.isInteger(image.height)
      || image.height <= 0
    ) {
      throw new AssetManifestValidationError(
        `Invalid asset manifest: ${kind}[${index}] (${entry.id}) has invalid image dimensions.`,
      );
    }
    if (
      !entry.contentTypes
      || entry.contentTypes.some((contentType) => !normaliseContentType(contentType).startsWith('image/'))
    ) {
      throw new AssetManifestValidationError(
        `Invalid asset manifest: ${kind}[${index}] (${entry.id}) image metadata requires image contentTypes.`,
      );
    }
  }
}

function assertAssetShaderEntry(entry: AssetShaderEntry, index: number): void {
  assertManifestEntryBase('shader', entry, index);
  if (normaliseText(entry.vertexSrc).length === 0) {
    throw new AssetManifestValidationError(`Invalid asset manifest: shaders[${index}] (${entry.id}) is missing vertexSrc.`);
  }
  if (normaliseText(entry.fragmentSrc).length === 0) {
    throw new AssetManifestValidationError(`Invalid asset manifest: shaders[${index}] (${entry.id}) is missing fragmentSrc.`);
  }
}

function assertNoDuplicateIds(kind: AssetKind, entries: AssetManifestEntryBase[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = normaliseText(entry.id);
    if (seen.has(id)) {
      throw new AssetManifestValidationError(`Invalid asset manifest: duplicate id "${id}" found in ${kind} entries.`);
    }
    seen.add(id);
  }
}

function validateManifest(manifest: AssetManifest): void {
  manifest.models.forEach((entry, index) => assertAssetFileEntry('model', entry, index));
  manifest.sprites.forEach((entry, index) => assertAssetFileEntry('sprite', entry, index));
  manifest.textures.forEach((entry, index) => assertAssetFileEntry('texture', entry, index));
  manifest.audio.forEach((entry, index) => assertAssetFileEntry('audio', entry, index));
  manifest.shaders.forEach((entry, index) => assertAssetShaderEntry(entry, index));

  assertNoDuplicateIds('model', manifest.models);
  assertNoDuplicateIds('sprite', manifest.sprites);
  assertNoDuplicateIds('texture', manifest.textures);
  assertNoDuplicateIds('audio', manifest.audio);
  assertNoDuplicateIds('shader', manifest.shaders);
}

function getPreloadTargets(manifest: AssetManifest): PreloadTarget[] {
  const targets: PreloadTarget[] = [];
  const addFileTarget = (kind: Exclude<AssetKind, 'shader'>, entry: AssetFileEntry): void => {
    targets.push({
      kind,
      id: entry.id,
      sources: [entry.src],
      expectedContentTypes: entry.contentTypes ? [...entry.contentTypes] : undefined,
      expectedImage: entry.image ? { ...entry.image } : undefined,
    });
  };
  for (const entry of manifest.models) {
    if (entry.preload === false) {
      continue;
    }
    addFileTarget('model', entry);
  }
  for (const entry of manifest.sprites) {
    if (entry.preload === false) {
      continue;
    }
    addFileTarget('sprite', entry);
  }
  for (const entry of manifest.textures) {
    if (entry.preload === false) {
      continue;
    }
    addFileTarget('texture', entry);
  }
  for (const entry of manifest.audio) {
    if (entry.preload === false) {
      continue;
    }
    addFileTarget('audio', entry);
  }
  for (const entry of manifest.shaders) {
    if (entry.preload === false) {
      continue;
    }
    targets.push({ kind: 'shader', id: entry.id, sources: [entry.vertexSrc, entry.fragmentSrc] });
  }
  return targets;
}

function readSvgAttribute(rootAttributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(rootAttributes);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseSvgLength(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px)?$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSvgDimensions(body: ArrayBuffer): AssetImageDimensions {
  const source = new TextDecoder().decode(body);
  const rootMatch = /<svg\b([^>]*)>/i.exec(source);
  if (!rootMatch) {
    throw new Error('SVG root element is missing.');
  }
  const width = parseSvgLength(readSvgAttribute(rootMatch[1], 'width'));
  const height = parseSvgLength(readSvgAttribute(rootMatch[1], 'height'));
  if (width !== null && height !== null) {
    return { width, height };
  }

  const viewBox = readSvgAttribute(rootMatch[1], 'viewBox');
  const values = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (
    values.length !== 4
    || values.some((value) => !Number.isFinite(value))
    || values[2] <= 0
    || values[3] <= 0
  ) {
    throw new Error('SVG must declare positive width/height attributes or a valid viewBox.');
  }
  return { width: values[2], height: values[3] };
}

export async function decodeAssetImageDimensions(
  body: ArrayBuffer,
  contentType: string,
): Promise<AssetImageDimensions> {
  const normalisedType = normaliseContentType(contentType);
  if (normalisedType === 'image/svg+xml') {
    return parseSvgDimensions(body);
  }
  if (!normalisedType.startsWith('image/')) {
    throw new Error(`response content type "${normalisedType || contentType}" is not an image MIME type.`);
  }
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw new Error('createImageBitmap is unavailable.');
  }

  const bitmap = await globalThis.createImageBitmap(new Blob([body], { type: normalisedType }));
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function assertDecodedImageDimensions(
  dimensions: AssetImageDimensions,
  target: PreloadTarget,
  source: string,
): void {
  if (
    !dimensions
    || typeof dimensions !== 'object'
    || !Number.isFinite(dimensions.width)
    || dimensions.width <= 0
    || !Number.isFinite(dimensions.height)
    || dimensions.height <= 0
  ) {
    throw new AssetLoadError(
      `Asset load failed [${target.kind}:${target.id}] ${source}: image decoder returned invalid dimensions.`,
    );
  }
}

async function loadSource(
  fetchImpl: typeof fetch,
  imageDimensionDecoder: AssetImageDimensionDecoder,
  target: PreloadTarget,
  source: string,
): Promise<SourceLoadResult> {
  let response: Response;
  try {
    response = await fetchImpl(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown fetch error';
    throw new AssetLoadError(`Asset load failed [${target.kind}:${target.id}] ${source}: ${reason}`);
  }

  if (!response.ok) {
    throw new AssetLoadError(
      `Asset load failed [${target.kind}:${target.id}] ${source}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType = normaliseText(response.headers.get('content-type')) || 'application/octet-stream';
  const normalisedContentType = normaliseContentType(contentType);
  if (
    target.expectedContentTypes
    && !target.expectedContentTypes.some((expected) => normaliseContentType(expected) === normalisedContentType)
  ) {
    throw new AssetLoadError(
      `Asset load failed [${target.kind}:${target.id}] ${source}: expected content type ${target.expectedContentTypes.join(' or ')}, received ${contentType}.`,
    );
  }

  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown response body error';
    throw new AssetLoadError(`Asset load failed [${target.kind}:${target.id}] ${source}: ${reason}`);
  }

  if (target.expectedImage) {
    let dimensions: AssetImageDimensions;
    try {
      dimensions = await imageDimensionDecoder(body, normalisedContentType);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown image decode error';
      throw new AssetLoadError(
        `Asset load failed [${target.kind}:${target.id}] ${source}: unable to decode image dimensions: ${reason}`,
      );
    }
    assertDecodedImageDimensions(dimensions, target, source);
    if (
      dimensions.width !== target.expectedImage.width
      || dimensions.height !== target.expectedImage.height
    ) {
      throw new AssetLoadError(
        `Asset load failed [${target.kind}:${target.id}] ${source}: expected image dimensions ${target.expectedImage.width}x${target.expectedImage.height}, received ${dimensions.width}x${dimensions.height}.`,
      );
    }
  }

  return {
    bytes: body.byteLength,
    contentType,
  };
}

export async function preloadAssetManifest(
  manifest: AssetManifest,
  options?: AssetLoaderOptions,
): Promise<AssetPreloadResult> {
  validateManifest(manifest);

  const fetchImpl = options?.fetchImpl ?? fetch.bind(globalThis);
  const imageDimensionDecoder = options?.imageDimensionDecoder ?? decodeAssetImageDimensions;
  const targets = getPreloadTargets(manifest);
  const entries: LoadedAssetEntry[] = [];
  const total = targets.length;
  let loaded = 0;

  for (const target of targets) {
    const loadedSources = await Promise.all(
      target.sources.map((source) => loadSource(fetchImpl, imageDimensionDecoder, target, source)),
    );
    loaded += 1;
    options?.onProgress?.({
      loaded,
      total,
      kind: target.kind,
      id: target.id,
    });

    entries.push({
      kind: target.kind,
      id: target.id,
      sources: [...target.sources],
      bytes: loadedSources.reduce((sum, result) => sum + result.bytes, 0),
      contentTypes: loadedSources.map((result) => result.contentType),
    });
  }

  return {
    total,
    loaded,
    entries,
  };
}
