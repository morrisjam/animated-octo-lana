import type { PlayersById } from './types';
import type { MoveFrameData } from './moveData';
import { createMoveFrameData } from './moveData';

export type CharacterId = 'vanguard' | 'duelist' | 'ace' | 'warden';

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
  modelId: string;
  animationSetId: string;
  vfxProfileId: string;
  projectileVisualId: string;
  hudPortraitId: string;
}

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

function baseVisuals(id: CharacterId): CharacterVisualProfile {
  return {
    modelId: `character_${id}_model`,
    animationSetId: `character_${id}_animset`,
    vfxProfileId: `character_${id}_vfx`,
    projectileVisualId: `character_${id}_projectile`,
    hudPortraitId: `character_${id}_portrait`,
  };
}

function baseAudio(id: CharacterId): CharacterAudioProfile {
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
  id: CharacterId,
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

export const CHARACTERS: CharacterDefinition[] = [
  makePlaceholderCharacter('vanguard', 'Vanguard', 'future: defensive kit'),
  makePlaceholderCharacter('duelist', 'Duelist', 'future: pressure kit'),
  makePlaceholderCharacter('ace', 'Ace', 'future: mobility kit'),
  makePlaceholderCharacter('warden', 'Warden', 'future: control kit'),
];

export const CHARACTER_BY_ID: Record<CharacterId, CharacterDefinition> = {
  vanguard: CHARACTERS[0],
  duelist: CHARACTERS[1],
  ace: CHARACTERS[2],
  warden: CHARACTERS[3],
};

export const CHARACTER_IDS: CharacterId[] = CHARACTERS.map((character) => character.id);

export const DEFAULT_CHARACTER_LOADOUT: PlayersById<CharacterId> = {
  P1: 'vanguard',
  P2: 'duelist',
};
