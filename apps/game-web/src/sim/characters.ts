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

function makeVanguardCharacter(): CharacterDefinition {
  const visuals = baseVisuals('vanguard');
  const moves = baseMoves(visuals.projectileVisualId);
  moves.launch.startupFrames = 7;
  moves.launch.recoveryOnHitFrames = 28;
  moves.launch.recoveryOnWhiffFrames = 40;
  moves.dunk.startupFrames = 31;
  moves.dunk.recoveryOnWhiffFrames = 62;
  moves.dunk.hitRange = 8.2;
  moves.parry.activeFrames = 14;
  moves.parry.recoveryFrames = 11;
  moves.break.recoveryFrames = 18;
  moves.break.velocityRetain = 0.18;
  moves.movement.fuelPerSecond = 0.58;
  moves.special = {
    id: 'guard_bastion',
    label: 'Guard Bastion',
    behaviorId: 'special.block_guard.v1',
    kind: 'block',
    fuelCost: 7,
    timing: {
      startupFrames: 4,
      activeFrames: 10,
      recoveryFrames: 18,
      cooldownFrames: 40,
    },
    size: {
      range: 10,
      radius: 1.5,
      width: 2.4,
      length: 2.4,
    },
    block: {
      guardFrames: 20,
    },
  };
  moves.boost.holdSpeedMultiplier = 0.95;
  moves.boost.holdFuelPerSecond = 0.18;
  moves.superBoost.holdSpeedMultiplier = 0.94;
  moves.superBoost.startFuelCost = 6.5;
  moves.superBoost.travelFuelPerDistance = 0.052;
  moves.superBoost.nonCommitPenalty = 2.2;
  return {
    id: 'vanguard',
    displayName: 'Vanguard',
    blurb: 'Defensive anchor that absorbs pressure, resets spacing, and punishes overextension.',
    mechanicsTag: 'defensive anchor',
    stats: {
      fuelCapacityMultiplier: 1.1,
      moveAccelMultiplier: 0.92,
      boostSpeedMultiplier: 0.95,
      superBoostSpeedMultiplier: 0.96,
      launchBasePowerMultiplier: 1.08,
      launchChainBonusMultiplier: 1,
      launchDurationTakenMultiplier: 0.92,
      specialFuelCostMultiplier: 1.05,
      superFuelMultiplier: 1.02,
      dunkRecoveryFuelMultiplier: 1.1,
    },
    visuals,
    audio: baseAudio('vanguard'),
    moves,
    specials: [
      { id: 'guard_bastion', label: 'Guard Bastion', enabled: true },
      { id: 'special_beta', label: 'Special Beta', enabled: false },
    ],
  };
}

function makeDuelistCharacter(): CharacterDefinition {
  const visuals = baseVisuals('duelist');
  const moves = baseMoves(visuals.projectileVisualId);
  moves.launch.startupFrames = 5;
  moves.launch.recoveryOnHitFrames = 26;
  moves.launch.recoveryOnWhiffFrames = 38;
  moves.dunk.startupFrames = 26;
  moves.dunk.recoveryOnHitFrames = 22;
  moves.dunk.recoveryOnWhiffFrames = 58;
  moves.dunk.hitRange = 8.8;
  moves.parry.activeFrames = 9;
  moves.parry.recoveryFrames = 15;
  moves.parry.counterStunFrames = 42;
  moves.break.recoveryFrames = 28;
  moves.break.velocityRetain = 0.36;
  moves.movement.fuelPerSecond = 0.72;
  moves.special = {
    id: 'pressure_dash',
    label: 'Pressure Dash',
    behaviorId: 'special.movement_dash.v1',
    kind: 'movement',
    fuelCost: 6,
    timing: {
      startupFrames: 3,
      activeFrames: 4,
      recoveryFrames: 14,
      cooldownFrames: 28,
    },
    size: {
      range: 14,
      radius: 1.2,
      width: 1.4,
      length: 6,
    },
    movement: {
      dashSpeed: 62,
    },
  };
  moves.boost.holdSpeedMultiplier = 1.18;
  moves.boost.holdFuelPerSecond = 0.24;
  moves.superBoost.holdSpeedMultiplier = 1.12;
  moves.superBoost.steerLerpMultiplier = 1.2;
  moves.superBoost.velocityBlendMultiplier = 1.12;
  moves.superBoost.startFuelCost = 5.5;
  moves.superBoost.travelFuelPerDistance = 0.046;
  moves.superBoost.nonCommitPenalty = 2.8;
  moves.superBoost.turnPenaltyGainMultiplier = 0.9;
  return {
    id: 'duelist',
    displayName: 'Duelist',
    blurb: 'Fast pressure fighter that turns one clean read into chase momentum.',
    mechanicsTag: 'pressure chase',
    stats: {
      fuelCapacityMultiplier: 0.96,
      moveAccelMultiplier: 1.14,
      boostSpeedMultiplier: 1.14,
      superBoostSpeedMultiplier: 1.1,
      launchBasePowerMultiplier: 0.97,
      launchChainBonusMultiplier: 1.14,
      launchDurationTakenMultiplier: 1.08,
      specialFuelCostMultiplier: 0.92,
      superFuelMultiplier: 0.96,
      dunkRecoveryFuelMultiplier: 0.9,
    },
    visuals,
    audio: baseAudio('duelist'),
    moves,
    specials: [
      { id: 'pressure_dash', label: 'Pressure Dash', enabled: true },
      { id: 'special_beta', label: 'Special Beta', enabled: false },
    ],
  };
}

const CORE_CHARACTERS: CharacterDefinition[] = [
  makeVanguardCharacter(),
  makeDuelistCharacter(),
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
