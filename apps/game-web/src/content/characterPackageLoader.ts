import type { CharacterDefinition } from '../sim/characters';
import {
  CharacterPackageValidationError,
  parseCharacterPackage,
} from './characterPackageSchema';

interface ImportMetaWithOptionalGlob extends ImportMeta {
  glob?: (
    pattern: string,
    options?: {
      eager?: boolean;
      import?: string;
    },
  ) => Record<string, unknown>;
}

function readCharacterPackageModules(): Record<string, unknown> {
  const meta = import.meta as ImportMetaWithOptionalGlob;
  if (typeof meta.glob !== 'function') {
    return {};
  }
  return import.meta.glob('../../content/characters/**/*.character.package.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>;
}

function toCharacterDefinition(path: string, payload: unknown): CharacterDefinition | null {
  try {
    const parsed = parseCharacterPackage(payload);
    return {
      id: parsed.id,
      displayName: parsed.displayName,
      blurb: parsed.blurb,
      mechanicsTag: parsed.mechanicsTag,
      stats: parsed.stats,
      visuals: parsed.visuals,
      audio: parsed.audio,
      moves: parsed.moves,
      specials: parsed.specials,
    };
  } catch (error) {
    if (error instanceof CharacterPackageValidationError) {
      console.warn(`[character-package] skipping invalid package: ${path}`);
      for (const issue of error.issues) {
        console.warn(`[character-package] ${path} ${issue.path}: ${issue.message}`);
      }
      return null;
    }
    console.warn(`[character-package] skipping package due to parse error: ${path}`);
    console.warn(error);
    return null;
  }
}

export function loadCharacterPackagesFromContent(): CharacterDefinition[] {
  const modules = readCharacterPackageModules();
  const loaded: CharacterDefinition[] = [];
  for (const [path, payload] of Object.entries(modules)) {
    const character = toCharacterDefinition(path, payload);
    if (!character) {
      continue;
    }
    loaded.push(character);
  }
  return loaded;
}
