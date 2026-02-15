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

export interface AssetLoaderOptions {
  onProgress?: (progress: AssetPreloadProgress) => void;
  fetchImpl?: typeof fetch;
}

interface PreloadTarget {
  kind: AssetKind;
  id: string;
  sources: string[];
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

function assertManifestEntryBase(kind: AssetKind, entry: AssetManifestEntryBase, index: number): void {
  if (normaliseText(entry.id).length === 0) {
    throw new AssetManifestValidationError(`Invalid asset manifest: ${kind}[${index}] is missing a non-empty id.`);
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
  for (const entry of manifest.models) {
    if (entry.preload === false) {
      continue;
    }
    targets.push({ kind: 'model', id: entry.id, sources: [entry.src] });
  }
  for (const entry of manifest.sprites) {
    if (entry.preload === false) {
      continue;
    }
    targets.push({ kind: 'sprite', id: entry.id, sources: [entry.src] });
  }
  for (const entry of manifest.textures) {
    if (entry.preload === false) {
      continue;
    }
    targets.push({ kind: 'texture', id: entry.id, sources: [entry.src] });
  }
  for (const entry of manifest.audio) {
    if (entry.preload === false) {
      continue;
    }
    targets.push({ kind: 'audio', id: entry.id, sources: [entry.src] });
  }
  for (const entry of manifest.shaders) {
    if (entry.preload === false) {
      continue;
    }
    targets.push({ kind: 'shader', id: entry.id, sources: [entry.vertexSrc, entry.fragmentSrc] });
  }
  return targets;
}

async function loadSource(fetchImpl: typeof fetch, target: PreloadTarget, source: string): Promise<SourceLoadResult> {
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

  const body = await response.arrayBuffer();
  const contentType = normaliseText(response.headers.get('content-type')) || 'application/octet-stream';
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
  const targets = getPreloadTargets(manifest);
  const entries: LoadedAssetEntry[] = [];
  const total = targets.length;
  let loaded = 0;

  for (const target of targets) {
    const loadedSources = await Promise.all(target.sources.map((source) => loadSource(fetchImpl, target, source)));
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
