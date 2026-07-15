import type { PlayersById } from './types';
import type { MoveFrameData } from './moveData';
import { createMoveFrameData } from './moveData';
import { loadCharacterPackagesFromContent } from '../content/characterPackageLoader';

export type CharacterId = string;
type CoreCharacterId = 'vanguard' | 'duelist' | 'ace' | 'warden';

export interface CharacterStats {
  fuelCapacityMultiplier: number;
  moveAccelMultiplier: number;
  boostSpeedMultiplier: number;
  superBoostSpeedMultiplier: number;
  launchBasePowerMultiplier: number;
  launchChainBonusMultiplier: number;
  launchDurationTakenMultiplier: number;
  naturalRecoveryResetMultiplier: number;
  specialFuelCostMultiplier: number;
  superFuelMultiplier: number;
  dunkRecoveryFuelMultiplier: number;
}

export interface CharacterDefinition {
  id: CharacterId;
  displayName: string;
  blurb: string;
  mechanicsTag: string;
  stats: CharacterStats;
  visuals: CharacterVisualProfile;
  audio: CharacterAudioProfile;
  moves: MoveFrameData;
  specials: CharacterSpecialMoveDefinition[];
  package?: CharacterPackageIdentity;
}

export interface CharacterPackageIdentity {
  schemaVersion: string;
  version: string;
  author: string;
  tags: string[];
  source: string;
}

export interface CharacterVisualProfile {
  presentation: CharacterVisualPresentation;
  modelId: string | null;
  animationSetId: string | null;
  vfxProfileId: string | null;
  projectileVisualId: string | null;
  hudPortraitId: string;
}

export type CharacterVisualPresentation = '3d' | 'sprite' | 'hybrid';

export interface CharacterAudioProfile {
  sfxProfileId: string | null;
  voiceProfileId: string | null;
  musicThemeId: string | null;
}

export interface CharacterSpecialMoveDefinition {
  id: string;
  label: string;
  enabled: boolean;
}

function baseStats(): CharacterStats {
  return {
    fuelCapacityMultiplier: 1,
    moveAccelMultiplier: 1,
    boostSpeedMultiplier: 1,
    superBoostSpeedMultiplier: 1,
    launchBasePowerMultiplier: 1,
    launchChainBonusMultiplier: 1,
    launchDurationTakenMultiplier: 1,
    naturalRecoveryResetMultiplier: 1,
    specialFuelCostMultiplier: 1,
    superFuelMultiplier: 1,
    dunkRecoveryFuelMultiplier: 1,
  };
}

function baseVisuals(id: CoreCharacterId): CharacterVisualProfile {
  const presentationByCharacterId: Record<CoreCharacterId, CharacterVisualPresentation> = {
    vanguard: '3d',
    duelist: 'sprite',
    ace: 'hybrid',
    warden: '3d',
  };
  return {
    presentation: presentationByCharacterId[id],
    modelId: `character_${id}_model`,
    animationSetId: `character_${id}_animset`,
    vfxProfileId: `character_${id}_vfx`,
    projectileVisualId: `character_${id}_projectile`,
    hudPortraitId: `character_${id}_portrait`,
  };
}

function baseAudio(id: CoreCharacterId): CharacterAudioProfile {
  return {
    sfxProfileId: `character_${id}_sfx`,
    voiceProfileId: `character_${id}_voice`,
    musicThemeId: `character_${id}_theme`,
  };
}

function baseMoves(projectileVisualId: string | null): MoveFrameData {
  return createMoveFrameData(projectileVisualId ?? undefined);
}

function baseSpecials(): CharacterSpecialMoveDefinition[] {
  return [
    { id: 'special_alpha', label: 'Special Alpha', enabled: false },
    { id: 'special_beta', label: 'Special Beta', enabled: false },
  ];
}

function makePlaceholderCharacter(
  id: CoreCharacterId,
  displayName: string,
  mechanicsTag: string,
): CharacterDefinition {
  const visuals = baseVisuals(id);
  return {
    id,
    displayName,
    blurb: 'Placeholder all-round archetype.',
    mechanicsTag,
    stats: baseStats(),
    visuals,
    audio: baseAudio(id),
    moves: baseMoves(visuals.projectileVisualId),
    specials: baseSpecials(),
  };
}

const CORE_CHARACTERS: CharacterDefinition[] = [
  makePlaceholderCharacter('ace', 'Ace', 'future: mobility kit'),
  makePlaceholderCharacter('warden', 'Warden', 'future: control kit'),
];

const DEFAULT_CHARACTER_ORDER = ['vanguard', 'duelist', 'ace', 'warden'];

function mergeCharacters(
  coreCharacters: CharacterDefinition[],
  packagedCharacters: CharacterDefinition[],
): CharacterDefinition[] {
  const byId = new Map<string, CharacterDefinition>();
  for (const character of coreCharacters) {
    byId.set(character.id, character);
  }
  for (const packagedCharacter of packagedCharacters) {
    if (byId.has(packagedCharacter.id)) {
      console.warn(`[character-package] overriding character id "${packagedCharacter.id}" from package.`);
    }
    byId.set(packagedCharacter.id, packagedCharacter);
  }
  const orderById = new Map(DEFAULT_CHARACTER_ORDER.map((id, index) => [id, index]));
  return [...byId.values()].sort((first, second) => {
    const firstOrder = orderById.get(first.id) ?? Number.MAX_SAFE_INTEGER;
    const secondOrder = orderById.get(second.id) ?? Number.MAX_SAFE_INTEGER;
    return firstOrder - secondOrder || first.id.localeCompare(second.id);
  });
}

function buildCharacterById(characters: CharacterDefinition[]): Record<string, CharacterDefinition> {
  const byId: Record<string, CharacterDefinition> = {};
  for (const character of characters) {
    byId[character.id] = character;
  }
  return byId;
}

const PACKAGED_CHARACTERS: CharacterDefinition[] = loadCharacterPackagesFromContent();

export const CHARACTERS: CharacterDefinition[] = mergeCharacters(CORE_CHARACTERS, PACKAGED_CHARACTERS);
export const CHARACTER_BY_ID: Record<string, CharacterDefinition> = buildCharacterById(CHARACTERS);
export const CHARACTER_IDS: CharacterId[] = CHARACTERS.map((character) => character.id);
export const CHARACTER_REGISTRY_SCHEMA_VERSION = 'gw.character-registry.v1';
export const CHARACTER_PACKAGE_VERSION_BY_ID: Record<string, string> = Object.fromEntries(
  CHARACTERS.map((character) => [character.id, character.package?.version ?? 'builtin']),
);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const CHARACTER_RULES_MANIFEST = CHARACTERS.map((character) => ({
  id: character.id,
  packageVersion: CHARACTER_PACKAGE_VERSION_BY_ID[character.id],
  stats: character.stats,
  moves: character.moves,
  specials: character.specials.map((special) => ({ id: special.id, enabled: special.enabled })),
}));

export const CHARACTER_REGISTRY_FINGERPRINT = `${CHARACTER_REGISTRY_SCHEMA_VERSION}:${fnv1a32(
  canonicalJson(CHARACTER_RULES_MANIFEST),
)}`;

function resolveDefaultCharacterId(preferred: string, fallback: string): CharacterId {
  if (CHARACTER_BY_ID[preferred]) {
    return preferred;
  }
  if (CHARACTER_BY_ID[fallback]) {
    return fallback;
  }
  return CHARACTER_IDS[0] ?? 'vanguard';
}

function resolveDefaultOpponentId(playerId: CharacterId): CharacterId {
  if (CHARACTER_BY_ID.duelist && playerId !== 'duelist') {
    return 'duelist';
  }
  for (const id of CHARACTER_IDS) {
    if (id !== playerId) {
      return id;
    }
  }
  return playerId;
}

export const DEFAULT_CHARACTER_LOADOUT: PlayersById<CharacterId> = {
  P1: resolveDefaultCharacterId('vanguard', 'duelist'),
  P2: resolveDefaultOpponentId(resolveDefaultCharacterId('vanguard', 'duelist')),
};

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && Boolean(CHARACTER_BY_ID[value]);
}
