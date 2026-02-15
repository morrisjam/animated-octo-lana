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
}

export interface CharacterVisualProfile {
  presentation: CharacterVisualPresentation;
  modelId: string;
  animationSetId: string;
  vfxProfileId: string;
  projectileVisualId: string;
  hudPortraitId: string;
}

export type CharacterVisualPresentation = '3d' | 'sprite' | 'hybrid';

export interface CharacterAudioProfile {
  sfxProfileId: string;
  voiceProfileId: string;
  musicThemeId: string;
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

function baseMoves(projectileVisualId: string): MoveFrameData {
  return createMoveFrameData(projectileVisualId);
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
  makePlaceholderCharacter('vanguard', 'Vanguard', 'future: defensive kit'),
  makePlaceholderCharacter('duelist', 'Duelist', 'future: pressure kit'),
  makePlaceholderCharacter('ace', 'Ace', 'future: mobility kit'),
  makePlaceholderCharacter('warden', 'Warden', 'future: control kit'),
];

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
  return [...byId.values()];
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
