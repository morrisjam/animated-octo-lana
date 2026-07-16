import type { CharacterDefinition } from '../sim/characters';
import type { AssetFileEntry } from '../view/assets/types';
import {
  CharacterPresentationValidationError,
  parseCharacterPresentationManifest,
  type CharacterPresentationManifestV1,
} from './characterPresentationSchema';

const CHARACTER_PRESENTATION_SOURCE_ROOT = '../../content/characters';
const CHARACTER_PRESENTATION_FILE_SUFFIX = '.character.presentation.json';

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

export interface CharacterPresentationDefinition extends CharacterPresentationManifestV1 {
  source: string;
}

export interface CharacterPresentationAssetEntries {
  sprites: AssetFileEntry[];
  textures: AssetFileEntry[];
}

export interface NodeCharacterPresentationDiscoveryOptions {
  rootUrl?: URL;
  sourceRoot?: string;
}

export interface DiscoveredCharacterPresentationFile {
  source: string;
  url: URL;
}

export class CharacterPresentationDiscoveryError extends Error {
  constructor(message: string) {
    super(`[character-presentation] ${message}`);
    this.name = 'CharacterPresentationDiscoveryError';
  }
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
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

export function canDiscoverCharacterPresentationsFromNode(): boolean {
  return resolveNodeFileSystem() !== null;
}

export function discoverNodeCharacterPresentationFiles(
  options: NodeCharacterPresentationDiscoveryOptions = {},
): DiscoveredCharacterPresentationFile[] {
  const fileSystem = resolveNodeFileSystem();
  if (!fileSystem) {
    throw new CharacterPresentationDiscoveryError('Node presentation discovery is unavailable in this runtime.');
  }
  const rootUrl = options.rootUrl ?? new URL(`${CHARACTER_PRESENTATION_SOURCE_ROOT}/`, import.meta.url);
  const sourceRoot = normalizeSourcePath(options.sourceRoot ?? CHARACTER_PRESENTATION_SOURCE_ROOT);
  const discovered: DiscoveredCharacterPresentationFile[] = [];

  function walk(directoryUrl: URL, relativeDirectory: string): void {
    let entries: NodeDirectoryEntry[];
    try {
      entries = fileSystem!.readdirSync(directoryUrl, { withFileTypes: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown filesystem error';
      throw new CharacterPresentationDiscoveryError(
        `unable to read presentation directory "${sourceRoot}${relativeDirectory ? `/${relativeDirectory}` : ''}": ${detail}`,
      );
    }
    for (const entry of [...entries].sort((first, second) => compareText(first.name, second.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(childUrl(directoryUrl, entry.name, true), relativePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(CHARACTER_PRESENTATION_FILE_SUFFIX)) {
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

export function readNodeCharacterPresentationModules(
  options: NodeCharacterPresentationDiscoveryOptions = {},
): Record<string, unknown> {
  const fileSystem = resolveNodeFileSystem();
  if (!fileSystem) {
    throw new CharacterPresentationDiscoveryError('Node presentation discovery is unavailable in this runtime.');
  }
  const modules: Record<string, unknown> = {};
  for (const file of discoverNodeCharacterPresentationFiles(options)) {
    try {
      modules[file.source] = JSON.parse(fileSystem.readFileSync(file.url, 'utf8')) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown JSON parse error';
      throw new CharacterPresentationDiscoveryError(`invalid JSON in "${file.source}": ${detail}`);
    }
  }
  return modules;
}

export function readViteCharacterPresentationModules(): Record<string, unknown> | null {
  if (typeof import.meta.env === 'undefined') {
    return null;
  }
  return import.meta.glob('../../content/characters/**/*.character.presentation.json', {
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
      throw new CharacterPresentationDiscoveryError(`duplicate presentation source "${source}".`);
    }
    normalized.set(source, payload);
  }
  return [...normalized.entries()].sort(([firstPath], [secondPath]) => compareText(firstPath, secondPath));
}

export function assertCharacterPresentationModuleParity(
  firstLabel: string,
  firstModules: Record<string, unknown>,
  secondLabel: string,
  secondModules: Record<string, unknown>,
): void {
  const firstEntries = normalizedModuleEntries(firstModules);
  const secondEntries = normalizedModuleEntries(secondModules);
  if (canonicalJson(firstEntries.map(([path]) => path)) !== canonicalJson(secondEntries.map(([path]) => path))) {
    throw new CharacterPresentationDiscoveryError(`${firstLabel}/${secondLabel} presentation sets diverge.`);
  }
  for (let index = 0; index < firstEntries.length; index += 1) {
    if (canonicalJson(firstEntries[index][1]) !== canonicalJson(secondEntries[index][1])) {
      throw new CharacterPresentationDiscoveryError(
        `${firstLabel}/${secondLabel} presentation payloads diverge at "${firstEntries[index][0]}".`,
      );
    }
  }
}

export function loadCharacterPresentationsFromModules(
  modules: Record<string, unknown>,
): CharacterPresentationDefinition[] {
  const entries = normalizedModuleEntries(modules);
  if (entries.length === 0) {
    throw new CharacterPresentationDiscoveryError('no character presentation files were discovered.');
  }
  const definitions: CharacterPresentationDefinition[] = [];
  const sourceByCharacterId = new Map<string, string>();
  const sourceByAnimationSetId = new Map<string, string>();
  const sourceByAssetId = new Map<string, string>();
  for (const [source, payload] of entries) {
    let parsed: CharacterPresentationManifestV1;
    try {
      parsed = parseCharacterPresentationManifest(payload);
    } catch (error) {
      if (error instanceof CharacterPresentationValidationError) {
        const detail = error.issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ');
        throw new CharacterPresentationDiscoveryError(`invalid presentation "${source}": ${detail}`);
      }
      throw error;
    }
    const previousCharacter = sourceByCharacterId.get(parsed.characterId);
    if (previousCharacter) {
      throw new CharacterPresentationDiscoveryError(
        `duplicate character id "${parsed.characterId}" in "${previousCharacter}" and "${source}".`,
      );
    }
    const previousAnimation = sourceByAnimationSetId.get(parsed.animationSet.id);
    if (previousAnimation) {
      throw new CharacterPresentationDiscoveryError(
        `duplicate animation set id "${parsed.animationSet.id}" in "${previousAnimation}" and "${source}".`,
      );
    }
    for (const assetId of [parsed.animationSet.atlas.id, parsed.portrait.id]) {
      const previousAsset = sourceByAssetId.get(assetId);
      if (previousAsset) {
        throw new CharacterPresentationDiscoveryError(
          `duplicate asset id "${assetId}" in "${previousAsset}" and "${source}".`,
        );
      }
      sourceByAssetId.set(assetId, source);
    }
    sourceByCharacterId.set(parsed.characterId, source);
    sourceByAnimationSetId.set(parsed.animationSet.id, source);
    definitions.push({ ...parsed, source });
  }
  return definitions;
}

function readCharacterPresentationModules(): Record<string, unknown> {
  const viteModules = readViteCharacterPresentationModules();
  const nodeModules = canDiscoverCharacterPresentationsFromNode()
    ? readNodeCharacterPresentationModules()
    : null;
  if (viteModules && nodeModules) {
    assertCharacterPresentationModuleParity('vite', viteModules, 'node', nodeModules);
  }
  if (viteModules) {
    return viteModules;
  }
  if (nodeModules) {
    return nodeModules;
  }
  throw new CharacterPresentationDiscoveryError('no supported presentation discovery provider is available.');
}

export function loadCharacterPresentationsFromContent(): CharacterPresentationDefinition[] {
  return loadCharacterPresentationsFromModules(readCharacterPresentationModules());
}

export function assertCharacterPresentationCoverage(
  characters: CharacterDefinition[],
  presentations: CharacterPresentationDefinition[],
): void {
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const presentationByCharacterId = new Map(presentations.map((presentation) => [
    presentation.characterId,
    presentation,
  ]));
  for (const presentation of presentations) {
    if (!characterById.has(presentation.characterId)) {
      throw new CharacterPresentationDiscoveryError(
        `presentation "${presentation.source}" references unknown character "${presentation.characterId}".`,
      );
    }
  }
  for (const character of characters) {
    if (character.visuals.presentation !== 'sprite' && character.visuals.presentation !== 'hybrid') {
      continue;
    }
    const presentation = presentationByCharacterId.get(character.id);
    if (!presentation) {
      throw new CharacterPresentationDiscoveryError(`character "${character.id}" has no presentation manifest.`);
    }
    if (presentation.animationSet.id !== character.visuals.animationSetId) {
      throw new CharacterPresentationDiscoveryError(
        `character "${character.id}" animation set differs between package and presentation manifest.`,
      );
    }
    if (presentation.portrait.id !== character.visuals.hudPortraitId) {
      throw new CharacterPresentationDiscoveryError(
        `character "${character.id}" portrait differs between package and presentation manifest.`,
      );
    }
    if (presentation.vfxProfileId !== character.visuals.vfxProfileId) {
      throw new CharacterPresentationDiscoveryError(
        `character "${character.id}" VFX profile differs between package and presentation manifest.`,
      );
    }
  }
}

export function buildCharacterPresentationAssetEntries(
  presentations: CharacterPresentationDefinition[],
): CharacterPresentationAssetEntries {
  return {
    sprites: presentations.map(({ animationSet }) => ({
      id: animationSet.atlas.id,
      src: animationSet.atlas.src,
      preload: true,
      readiness: animationSet.atlas.readiness,
      contentTypes: [animationSet.atlas.contentType],
      image: {
        width: animationSet.atlas.widthPixels,
        height: animationSet.atlas.heightPixels,
      },
      budget: { ...animationSet.atlas.budget },
    })),
    textures: presentations.map(({ portrait }) => ({
      id: portrait.id,
      src: portrait.src,
      preload: true,
      readiness: portrait.readiness,
      contentTypes: [portrait.contentType],
      image: { width: portrait.widthPixels, height: portrait.heightPixels },
      budget: { ...portrait.budget },
    })),
  };
}
