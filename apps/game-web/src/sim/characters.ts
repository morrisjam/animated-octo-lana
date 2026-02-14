import type { PlayersById } from './types';
import type { MoveFrameData } from './moveData';
import { MOVE_FRAME_DATA } from './moveData';

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
  return {
    launch: {
      startupFrames: MOVE_FRAME_DATA.launch.startupFrames,
      activeFrames: MOVE_FRAME_DATA.launch.activeFrames,
      recoveryOnHitFrames: MOVE_FRAME_DATA.launch.recoveryOnHitFrames,
      recoveryOnWhiffFrames: MOVE_FRAME_DATA.launch.recoveryOnWhiffFrames,
    },
    dunk: {
      startupFrames: MOVE_FRAME_DATA.dunk.startupFrames,
      activeFrames: MOVE_FRAME_DATA.dunk.activeFrames,
      recoveryOnHitFrames: MOVE_FRAME_DATA.dunk.recoveryOnHitFrames,
      recoveryOnWhiffFrames: MOVE_FRAME_DATA.dunk.recoveryOnWhiffFrames,
      hitRange: MOVE_FRAME_DATA.dunk.hitRange,
    },
    parry: {
      activeFrames: MOVE_FRAME_DATA.parry.activeFrames,
      recoveryFrames: MOVE_FRAME_DATA.parry.recoveryFrames,
      counterStunFrames: MOVE_FRAME_DATA.parry.counterStunFrames,
    },
    break: {
      selfStunFrames: MOVE_FRAME_DATA.break.selfStunFrames,
      velocityRetain: MOVE_FRAME_DATA.break.velocityRetain,
    },
    movement: {
      fuelPerSecond: MOVE_FRAME_DATA.movement.fuelPerSecond,
    },
    special: {
      id: MOVE_FRAME_DATA.special.id,
      label: MOVE_FRAME_DATA.special.label,
      kind: MOVE_FRAME_DATA.special.kind,
      fuelCost: MOVE_FRAME_DATA.special.fuelCost,
      timing: {
        startupFrames: MOVE_FRAME_DATA.special.timing.startupFrames,
        activeFrames: MOVE_FRAME_DATA.special.timing.activeFrames,
        recoveryFrames: MOVE_FRAME_DATA.special.timing.recoveryFrames,
        cooldownFrames: MOVE_FRAME_DATA.special.timing.cooldownFrames,
      },
      size: {
        range: MOVE_FRAME_DATA.special.size.range,
        radius: MOVE_FRAME_DATA.special.size.radius,
        width: MOVE_FRAME_DATA.special.size.width,
        length: MOVE_FRAME_DATA.special.size.length,
      },
      projectile: {
        speed: MOVE_FRAME_DATA.special.projectile?.speed ?? 42,
        lifeSeconds: MOVE_FRAME_DATA.special.projectile?.lifeSeconds ?? 2,
        hitRadius: MOVE_FRAME_DATA.special.projectile?.hitRadius ?? 0.8,
        stunSeconds: MOVE_FRAME_DATA.special.projectile?.stunSeconds ?? 0.7,
        fuelDamage: MOVE_FRAME_DATA.special.projectile?.fuelDamage ?? 4,
        visualId: projectileVisualId,
      },
      commandGrab: MOVE_FRAME_DATA.special.commandGrab
        ? { stunFrames: MOVE_FRAME_DATA.special.commandGrab.stunFrames }
        : undefined,
      movement: MOVE_FRAME_DATA.special.movement
        ? { dashSpeed: MOVE_FRAME_DATA.special.movement.dashSpeed }
        : undefined,
      block: MOVE_FRAME_DATA.special.block
        ? { guardFrames: MOVE_FRAME_DATA.special.block.guardFrames }
        : undefined,
    },
    boost: {
      holdSpeedMultiplier: MOVE_FRAME_DATA.boost.holdSpeedMultiplier,
      holdFuelPerSecond: MOVE_FRAME_DATA.boost.holdFuelPerSecond,
    },
    superBoost: {
      holdSpeedMultiplier: MOVE_FRAME_DATA.superBoost.holdSpeedMultiplier,
      steerLerpMultiplier: MOVE_FRAME_DATA.superBoost.steerLerpMultiplier,
      velocityBlendMultiplier: MOVE_FRAME_DATA.superBoost.velocityBlendMultiplier,
      startFuelCost: MOVE_FRAME_DATA.superBoost.startFuelCost,
      travelFuelPerDistance: MOVE_FRAME_DATA.superBoost.travelFuelPerDistance,
      nonCommitPenalty: MOVE_FRAME_DATA.superBoost.nonCommitPenalty,
      turnPenaltyGainMultiplier: MOVE_FRAME_DATA.superBoost.turnPenaltyGainMultiplier,
    },
  };
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
