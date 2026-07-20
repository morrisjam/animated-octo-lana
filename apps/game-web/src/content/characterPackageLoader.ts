import type { CharacterDefinition } from '../sim/characters';
import {
  CharacterPackageValidationError,
  parseCharacterPackage,
} from './characterPackageSchema';

const CHARACTER_PACKAGE_SOURCE_ROOT = '../../content/characters';
const CHARACTER_PACKAGE_FILE_SUFFIX = '.character.package.json';

interface NodeDirectoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface NodeFileSystem {
  readFileSync(path: URL, encoding: 'utf8'): string;
  readdirSync(path: URL, options: { withFileTypes: true }): NodeDirectoryEntry[];
}

interface NodeRuntimeProcess {
  getBuiltinModule?: (id: string) => unknown;
}

export interface NodeCharacterPackageDiscoveryOptions {
  rootUrl?: URL;
  sourceRoot?: string;
}

export interface DiscoveredCharacterPackageFile {
  source: string;
  url: URL;
}

export class CharacterPackageDiscoveryError extends Error {
  constructor(message: string) {
    super(`[character-package] ${message}`);
    this.name = 'CharacterPackageDiscoveryError';
  }
}

function compareText(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
}

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '');
}

function childUrl(parent: URL, name: string, directory: boolean): URL {
  return new URL(`${encodeURIComponent(name)}${directory ? '/' : ''}`, parent);
}

function resolveNodeFileSystem(): NodeFileSystem | null {
  const runtimeProcess = (globalThis as typeof globalThis & { process?: NodeRuntimeProcess }).process;
  if (typeof runtimeProcess?.getBuiltinModule !== 'function') {
    return null;
  }
  return runtimeProcess.getBuiltinModule('node:fs') as NodeFileSystem;
}

export function canDiscoverCharacterPackagesFromNode(): boolean {
  return resolveNodeFileSystem() !== null;
}

export function discoverNodeCharacterPackageFiles(
  options: NodeCharacterPackageDiscoveryOptions = {},
): DiscoveredCharacterPackageFile[] {
  const fileSystem = resolveNodeFileSystem();
  if (!fileSystem) {
    throw new CharacterPackageDiscoveryError('Node package discovery is unavailable in this runtime.');
  }
  const nodeFileSystem = fileSystem;

  const rootUrl = options.rootUrl ?? new URL(`${CHARACTER_PACKAGE_SOURCE_ROOT}/`, import.meta.url);
  const sourceRoot = normalizeSourcePath(options.sourceRoot ?? CHARACTER_PACKAGE_SOURCE_ROOT);
  const discovered: DiscoveredCharacterPackageFile[] = [];

  function walk(directoryUrl: URL, relativeDirectory: string): void {
    let entries: NodeDirectoryEntry[];
    try {
      entries = nodeFileSystem.readdirSync(directoryUrl, { withFileTypes: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown filesystem error';
      throw new CharacterPackageDiscoveryError(
        `unable to read package directory "${sourceRoot}${relativeDirectory ? `/${relativeDirectory}` : ''}": ${detail}`,
      );
    }

    for (const entry of [...entries].sort((first, second) => compareText(first.name, second.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(childUrl(directoryUrl, entry.name, true), relativePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(CHARACTER_PACKAGE_FILE_SUFFIX)) {
        continue;
      }
      discovered.push({
        source: `${sourceRoot}/${relativePath}`,
        url: childUrl(directoryUrl, entry.name, false),
      });
    }
  }

  walk(rootUrl, '');
  return discovered.sort((first, second) => compareText(first.source, second.source));
}

export function readNodeCharacterPackageModules(
  options: NodeCharacterPackageDiscoveryOptions = {},
): Record<string, unknown> {
  const fileSystem = resolveNodeFileSystem();
  if (!fileSystem) {
    throw new CharacterPackageDiscoveryError('Node package discovery is unavailable in this runtime.');
  }

  const modules: Record<string, unknown> = {};
  for (const file of discoverNodeCharacterPackageFiles(options)) {
    try {
      modules[file.source] = JSON.parse(fileSystem.readFileSync(file.url, 'utf8')) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown JSON parse error';
      throw new CharacterPackageDiscoveryError(`invalid JSON in "${file.source}": ${detail}`);
    }
  }
  return modules;
}

export function readViteCharacterPackageModules(): Record<string, unknown> | null {
  // Vite replaces the glob call at build time. Raw Node has no import.meta.env and uses filesystem discovery.
  if (typeof import.meta.env === 'undefined') {
    return null;
  }
  return import.meta.glob('../../content/characters/**/*.character.package.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([firstKey], [secondKey]) => compareText(firstKey, secondKey));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedModuleEntries(modules: Record<string, unknown>): Array<[string, unknown]> {
  const normalized = new Map<string, unknown>();
  for (const [path, payload] of Object.entries(modules)) {
    const source = normalizeSourcePath(path);
    if (normalized.has(source)) {
      throw new CharacterPackageDiscoveryError(`duplicate package source "${source}".`);
    }
    normalized.set(source, payload);
  }
  return [...normalized.entries()].sort(([firstPath], [secondPath]) => compareText(firstPath, secondPath));
}

export function assertCharacterPackageModuleParity(
  firstLabel: string,
  firstModules: Record<string, unknown>,
  secondLabel: string,
  secondModules: Record<string, unknown>,
): void {
  const firstEntries = normalizedModuleEntries(firstModules);
  const secondEntries = normalizedModuleEntries(secondModules);
  const firstPaths = firstEntries.map(([path]) => path);
  const secondPaths = secondEntries.map(([path]) => path);

  if (canonicalJson(firstPaths) !== canonicalJson(secondPaths)) {
    throw new CharacterPackageDiscoveryError(
      `${firstLabel}/${secondLabel} package sets diverge: ${firstLabel}=[${firstPaths.join(', ')}], ${secondLabel}=[${secondPaths.join(', ')}].`,
    );
  }

  for (let index = 0; index < firstEntries.length; index += 1) {
    const [path, firstPayload] = firstEntries[index];
    const secondPayload = secondEntries[index][1];
    if (canonicalJson(firstPayload) !== canonicalJson(secondPayload)) {
      throw new CharacterPackageDiscoveryError(
        `${firstLabel}/${secondLabel} package payloads diverge at "${path}".`,
      );
    }
  }
}

function toCharacterDefinition(path: string, payload: unknown): CharacterDefinition {
  try {
    const parsed = parseCharacterPackage(payload);
    return {
      id: parsed.id,
      displayName: parsed.displayName,
      blurb: parsed.blurb,
      mechanicsTag: parsed.mechanicsTag,
      stats: parsed.stats,
      ai: parsed.ai,
      visuals: parsed.visuals,
      audio: parsed.audio,
      moves: parsed.moves,
      specials: parsed.specials,
      package: {
        schemaVersion: parsed.schemaVersion,
        version: parsed.metadata.version,
        author: parsed.metadata.author,
        tags: [...parsed.metadata.tags],
        source: path,
      },
    };
  } catch (error) {
    if (error instanceof CharacterPackageValidationError) {
      const issues = error.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ');
      throw new CharacterPackageDiscoveryError(`invalid package "${path}": ${issues}`);
    }
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    throw new CharacterPackageDiscoveryError(`unable to parse package "${path}": ${detail}`);
  }
}

export function loadCharacterPackagesFromModules(
  modules: Record<string, unknown>,
): CharacterDefinition[] {
  const entries = normalizedModuleEntries(modules);
  if (entries.length === 0) {
    throw new CharacterPackageDiscoveryError('no character package files were discovered.');
  }

  const loaded: CharacterDefinition[] = [];
  const sourceById = new Map<string, string>();
  for (const [path, payload] of entries) {
    const character = toCharacterDefinition(path, payload);
    const previousSource = sourceById.get(character.id);
    if (previousSource) {
      throw new CharacterPackageDiscoveryError(
        `duplicate character id "${character.id}" in "${previousSource}" and "${path}".`,
      );
    }
    sourceById.set(character.id, path);
    loaded.push(character);
  }
  return loaded;
}

function readCharacterPackageModules(): Record<string, unknown> {
  const viteModules = readViteCharacterPackageModules();
  const nodeModules = canDiscoverCharacterPackagesFromNode()
    ? readNodeCharacterPackageModules()
    : null;

  if (viteModules && nodeModules) {
    assertCharacterPackageModuleParity('vite', viteModules, 'node', nodeModules);
  }
  if (viteModules) {
    return viteModules;
  }
  if (nodeModules) {
    return nodeModules;
  }
  throw new CharacterPackageDiscoveryError('no supported character package discovery provider is available.');
}

export function loadCharacterPackagesFromContent(): CharacterDefinition[] {
  return loadCharacterPackagesFromModules(readCharacterPackageModules());
}
