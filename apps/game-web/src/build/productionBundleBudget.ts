import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

export const PRODUCTION_BUNDLE_BUDGET_SCHEMA_VERSION = 'gw.production-bundle-budget.v1';

export interface ProductionBundleLimits {
  maxInitialJavaScriptBytes: number;
  maxInitialJavaScriptGzipBytes: number;
  maxEntryChunkBytes: number;
  maxJavaScriptChunkBytes: number;
}

export const DEFAULT_PRODUCTION_BUNDLE_LIMITS: ProductionBundleLimits = {
  // Alpha runtime persistence, support diagnostics, and Steam release identity add
  // entry-point coordination while their heavier implementations remain lazy.
  // Raised for the well hazard experiment: five tuning knobs plus a balance
  // profile live in the entry (sanitiser, fingerprints, profile content).
  maxInitialJavaScriptBytes: 1_130_000,
  // Raised for the animated character presentation clips (multi-frame atlas
  // definitions live in the entry via the presentation registry).
  maxInitialJavaScriptGzipBytes: 308_000,
  // Entry raised for the luminous vortex V8 procedural shader, which replaces
  // the authored wormhole GLB download outright.
  maxEntryChunkBytes: 492_000,
  maxJavaScriptChunkBytes: 510_000,
};

export const REQUIRED_LAZY_CHUNK_PREFIXES = [
  'pauseMenu-',
  'replayViewer-',
  'onlineDevMenu-',
  'balanceLab-',
  'replayReview-',
  'rankedProofReview-',
] as const;

export interface InitialJavaScriptReference {
  kind: 'entry' | 'modulepreload';
  href: string;
  external: boolean;
}

export interface ProductionBundleAsset {
  path: string;
  bytes: number;
  gzipBytes: number;
  initial: boolean;
  entry: boolean;
}

export interface ProductionBundleCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ProductionBundleBudgetReport {
  schemaVersion: typeof PRODUCTION_BUNDLE_BUDGET_SCHEMA_VERSION;
  capturedAt: string;
  localOnly: true;
  hostedServicesContacted: false;
  buildProfile: string;
  distDirectory: string;
  limits: ProductionBundleLimits;
  totals: {
    initialJavaScriptBytes: number;
    initialJavaScriptGzipBytes: number;
    entryChunkBytes: number;
    largestJavaScriptChunkBytes: number;
  };
  initialReferences: InitialJavaScriptReference[];
  assets: ProductionBundleAsset[];
  checks: ProductionBundleCheck[];
  ok: boolean;
}

function readAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  return pattern.exec(attributes)?.[2] ?? null;
}

function isExternalReference(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(href) || /^(?:data|blob):/i.test(href);
}

export function extractInitialJavaScriptReferences(html: string): InitialJavaScriptReference[] {
  const references: InitialJavaScriptReference[] = [];
  const seen = new Set<string>();
  const tagPattern = /<(script|link)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    const rel = readAttribute(attributes, 'rel')?.toLowerCase() ?? '';
    const kind = tag === 'script'
      ? 'entry'
      : rel.split(/\s+/).includes('modulepreload')
        ? 'modulepreload'
        : null;
    if (!kind) {
      continue;
    }
    const href = readAttribute(attributes, tag === 'script' ? 'src' : 'href');
    if (!href || !/\.js(?:[?#]|$)/i.test(href)) {
      continue;
    }
    const key = `${kind}:${href}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({ kind, href, external: isExternalReference(href) });
  }

  return references;
}

async function listJavaScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveLocalAsset(distDirectory: string, href: string): string {
  const withoutQuery = href.split(/[?#]/, 1)[0];
  const decoded = decodeURIComponent(withoutQuery).replace(/^\/+/, '');
  const fullPath = resolve(distDirectory, decoded);
  const relativePath = relative(distDirectory, fullPath);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || relativePath.includes(`..${sep}`)) {
    throw new Error(`Initial bundle asset escapes the dist directory: ${href}`);
  }
  return fullPath;
}

function reportPath(distDirectory: string, fullPath: string): string {
  return relative(distDirectory, fullPath).split(sep).join('/');
}

function bytesDetail(actual: number, limit: number): string {
  return `${actual.toLocaleString('en-US')} bytes (limit ${limit.toLocaleString('en-US')})`;
}

export async function inspectProductionBundle(
  distDirectoryInput: string,
  limits: ProductionBundleLimits = DEFAULT_PRODUCTION_BUNDLE_LIMITS,
  buildProfile = 'production',
): Promise<ProductionBundleBudgetReport> {
  const distDirectory = resolve(distDirectoryInput);
  const html = await readFile(join(distDirectory, 'index.html'), 'utf8');
  const initialReferences = extractInitialJavaScriptReferences(html);
  const externalReferences = initialReferences.filter((reference) => reference.external);
  const localReferences = initialReferences.filter((reference) => !reference.external);
  const initialPathKinds = new Map<string, Set<'entry' | 'modulepreload'>>();
  for (const reference of localReferences) {
    const fullPath = resolveLocalAsset(distDirectory, reference.href);
    const kinds = initialPathKinds.get(fullPath) ?? new Set<'entry' | 'modulepreload'>();
    kinds.add(reference.kind);
    initialPathKinds.set(fullPath, kinds);
  }

  const javascriptFiles = (await listJavaScriptFiles(distDirectory)).sort();
  const assets: ProductionBundleAsset[] = [];
  for (const fullPath of javascriptFiles) {
    const content = await readFile(fullPath);
    const kinds = initialPathKinds.get(fullPath);
    assets.push({
      path: reportPath(distDirectory, fullPath),
      bytes: content.byteLength,
      gzipBytes: gzipSync(content, { level: 9 }).byteLength,
      initial: Boolean(kinds),
      entry: kinds?.has('entry') ?? false,
    });
  }

  const initialAssets = assets.filter((asset) => asset.initial);
  const entryAssets = assets.filter((asset) => asset.entry);
  const initialJavaScriptBytes = initialAssets.reduce((total, asset) => total + asset.bytes, 0);
  const initialJavaScriptGzipBytes = initialAssets.reduce((total, asset) => total + asset.gzipBytes, 0);
  const entryChunkBytes = entryAssets.reduce((total, asset) => total + asset.bytes, 0);
  const largestJavaScriptChunkBytes = assets.reduce((largest, asset) => Math.max(largest, asset.bytes), 0);
  const checks: ProductionBundleCheck[] = [
    {
      id: 'entry-present',
      passed: entryAssets.length === 1,
      detail: `Found ${entryAssets.length} initial module entry chunk(s).`,
    },
    {
      id: 'no-external-initial-javascript',
      passed: externalReferences.length === 0,
      detail: externalReferences.length === 0
        ? 'All initial JavaScript is emitted by the local production build.'
        : `External initial JavaScript: ${externalReferences.map((item) => item.href).join(', ')}`,
    },
    {
      id: 'initial-javascript-bytes',
      passed: initialJavaScriptBytes <= limits.maxInitialJavaScriptBytes,
      detail: bytesDetail(initialJavaScriptBytes, limits.maxInitialJavaScriptBytes),
    },
    {
      id: 'initial-javascript-gzip-bytes',
      passed: initialJavaScriptGzipBytes <= limits.maxInitialJavaScriptGzipBytes,
      detail: bytesDetail(initialJavaScriptGzipBytes, limits.maxInitialJavaScriptGzipBytes),
    },
    {
      id: 'entry-chunk-bytes',
      passed: entryChunkBytes <= limits.maxEntryChunkBytes,
      detail: bytesDetail(entryChunkBytes, limits.maxEntryChunkBytes),
    },
    {
      id: 'largest-javascript-chunk-bytes',
      passed: largestJavaScriptChunkBytes <= limits.maxJavaScriptChunkBytes,
      detail: bytesDetail(largestJavaScriptChunkBytes, limits.maxJavaScriptChunkBytes),
    },
  ];

  for (const prefix of REQUIRED_LAZY_CHUNK_PREFIXES) {
    const matchingAssets = assets.filter((asset) => basename(asset.path).startsWith(prefix));
    checks.push({
      id: `lazy-${prefix.slice(0, -1)}`,
      passed: matchingAssets.length === 1 && matchingAssets.every((asset) => !asset.initial),
      detail: matchingAssets.length === 0
        ? `Missing required ${prefix}*.js chunk.`
        : matchingAssets.map((asset) => `${asset.path} initial=${asset.initial}`).join(', '),
    });
  }

  return {
    schemaVersion: PRODUCTION_BUNDLE_BUDGET_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    localOnly: true,
    hostedServicesContacted: false,
    buildProfile: buildProfile.trim() || 'production',
    distDirectory,
    limits,
    totals: {
      initialJavaScriptBytes,
      initialJavaScriptGzipBytes,
      entryChunkBytes,
      largestJavaScriptChunkBytes,
    },
    initialReferences,
    assets,
    checks,
    ok: checks.every((check) => check.passed),
  };
}
