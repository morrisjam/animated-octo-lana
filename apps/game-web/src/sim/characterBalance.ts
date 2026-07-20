import {
  CHARACTER_BY_ID,
  type CharacterAiProfile,
  type CharacterId,
  type CharacterStats,
} from './characters';
import { fingerprintDeterministicValue } from './fingerprint';
import type { MoveFrameData, SpecialMoveData } from './moveData';

export interface CharacterBalanceConfig {
  stats: CharacterStats;
  ai: CharacterAiProfile;
  moves: MoveFrameData;
}

export type CharacterBalanceOverrides = Partial<Record<CharacterId, CharacterBalanceConfig>>;

function cloneSpecialMove(special: SpecialMoveData): SpecialMoveData {
  const { projectile, commandGrab, movement, block, ...base } = special;
  return {
    ...base,
    timing: { ...special.timing },
    size: { ...special.size },
    ...(projectile ? { projectile: { ...projectile } } : {}),
    ...(commandGrab ? { commandGrab: { ...commandGrab } } : {}),
    ...(movement ? { movement: { ...movement } } : {}),
    ...(block ? { block: { ...block } } : {}),
  };
}

function cloneMoveFrameData(moves: MoveFrameData): MoveFrameData {
  return {
    launch: { ...moves.launch },
    dunk: { ...moves.dunk },
    parry: { ...moves.parry },
    break: { ...moves.break },
    movement: { ...moves.movement },
    special: cloneSpecialMove(moves.special),
    boost: { ...moves.boost },
    superBoost: { ...moves.superBoost },
  };
}

export function cloneCharacterBalanceConfig(config: CharacterBalanceConfig): CharacterBalanceConfig {
  return {
    stats: { ...config.stats },
    ai: { ...config.ai },
    moves: cloneMoveFrameData(config.moves),
  };
}

export function createCharacterBalanceConfig(characterId: CharacterId): CharacterBalanceConfig {
  const character = CHARACTER_BY_ID[characterId];
  if (!character) {
    throw new Error(`Unknown character balance id "${characterId}".`);
  }
  return cloneCharacterBalanceConfig({
    stats: character.stats,
    ai: character.ai,
    moves: character.moves,
  });
}

export function cloneCharacterBalanceOverrides(overrides: CharacterBalanceOverrides | undefined): CharacterBalanceOverrides {
  if (!overrides) {
    return {};
  }
  const cloned: CharacterBalanceOverrides = {};
  for (const [characterId, config] of Object.entries(overrides)) {
    if (config) {
      cloned[characterId as CharacterId] = cloneCharacterBalanceConfig(config);
    }
  }
  return cloned;
}

function readNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.max(min, Math.min(max, value));
  return integer ? Math.round(clamped) : clamped;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function sanitiseCharacterBalanceConfig(
  characterId: CharacterId,
  value: unknown,
): CharacterBalanceConfig {
  const base = createCharacterBalanceConfig(characterId);
  const root = asRecord(value);
  const stats = asRecord(root.stats);
  const ai = asRecord(root.ai);
  const moves = asRecord(root.moves);
  const launch = asRecord(moves.launch);
  const dunk = asRecord(moves.dunk);
  const parry = asRecord(moves.parry);
  const breakMove = asRecord(moves.break);
  const movement = asRecord(moves.movement);
  const special = asRecord(moves.special);
  const specialTiming = asRecord(special.timing);
  const specialSize = asRecord(special.size);
  const specialProjectile = asRecord(special.projectile);
  const specialCommandGrab = asRecord(special.commandGrab);
  const specialMovement = asRecord(special.movement);
  const specialBlock = asRecord(special.block);
  const boost = asRecord(moves.boost);
  const superBoost = asRecord(moves.superBoost);

  const config = cloneCharacterBalanceConfig(base);
  for (const key of Object.keys(config.stats) as Array<keyof CharacterStats>) {
    config.stats[key] = key === 'naturalRecoveryResetMultiplier'
      ? readNumber(stats[key], base.stats[key], 0, 3)
      : readNumber(stats[key], base.stats[key], 0.1, 5);
  }
  config.ai.neutralApproachMultiplier = readNumber(
    ai.neutralApproachMultiplier,
    base.ai.neutralApproachMultiplier,
    0,
    2,
  );
  config.ai.neutralBoostDistanceOffset = readNumber(
    ai.neutralBoostDistanceOffset,
    base.ai.neutralBoostDistanceOffset,
    0,
    60,
  );
  config.ai.postControlSpacingFrames = readNumber(
    ai.postControlSpacingFrames,
    base.ai.postControlSpacingFrames,
    0,
    120,
    true,
  );
  config.moves.launch.startupFrames = readNumber(launch.startupFrames, base.moves.launch.startupFrames, 0, 600, true);
  config.moves.launch.activeFrames = readNumber(launch.activeFrames, base.moves.launch.activeFrames, 1, 600, true);
  config.moves.launch.recoveryOnHitFrames = readNumber(launch.recoveryOnHitFrames, base.moves.launch.recoveryOnHitFrames, 0, 1200, true);
  config.moves.launch.recoveryOnWhiffFrames = readNumber(launch.recoveryOnWhiffFrames, base.moves.launch.recoveryOnWhiffFrames, 0, 1200, true);
  config.moves.dunk.startupFrames = readNumber(dunk.startupFrames, base.moves.dunk.startupFrames, 0, 600, true);
  config.moves.dunk.activeFrames = readNumber(dunk.activeFrames, base.moves.dunk.activeFrames, 1, 600, true);
  config.moves.dunk.recoveryOnHitFrames = readNumber(dunk.recoveryOnHitFrames, base.moves.dunk.recoveryOnHitFrames, 0, 1200, true);
  config.moves.dunk.recoveryOnWhiffFrames = readNumber(dunk.recoveryOnWhiffFrames, base.moves.dunk.recoveryOnWhiffFrames, 0, 1200, true);
  config.moves.dunk.hitRange = readNumber(dunk.hitRange, base.moves.dunk.hitRange, 0.5, 100);
  config.moves.dunk.startupPursuitSpeed = readNumber(
    dunk.startupPursuitSpeed,
    base.moves.dunk.startupPursuitSpeed,
    0,
    500,
  );
  config.moves.dunk.startupTracking = readNumber(
    dunk.startupTracking,
    base.moves.dunk.startupTracking,
    0,
    1,
  );
  config.moves.parry.startupFrames = readNumber(parry.startupFrames, base.moves.parry.startupFrames, 0, 600, true);
  config.moves.parry.activeFrames = readNumber(parry.activeFrames, base.moves.parry.activeFrames, 1, 600, true);
  config.moves.parry.recoveryFrames = readNumber(parry.recoveryFrames, base.moves.parry.recoveryFrames, 0, 1200, true);
  config.moves.parry.counterStunFrames = readNumber(parry.counterStunFrames, base.moves.parry.counterStunFrames, 0, 1200, true);
  config.moves.break.startupFrames = readNumber(breakMove.startupFrames, base.moves.break.startupFrames, 0, 600, true);
  config.moves.break.activeFrames = readNumber(breakMove.activeFrames, base.moves.break.activeFrames, 1, 600, true);
  config.moves.break.recoveryFrames = readNumber(breakMove.recoveryFrames, base.moves.break.recoveryFrames, 0, 1200, true);
  config.moves.break.velocityRetain = readNumber(breakMove.velocityRetain, base.moves.break.velocityRetain, 0, 1);
  config.moves.movement.fuelPerSecond = readNumber(movement.fuelPerSecond, base.moves.movement.fuelPerSecond, 0, 100);
  config.moves.special.fuelCost = readNumber(special.fuelCost, base.moves.special.fuelCost, 0, 1000);
  config.moves.special.timing.startupFrames = readNumber(specialTiming.startupFrames, base.moves.special.timing.startupFrames, 0, 600, true);
  config.moves.special.timing.activeFrames = readNumber(specialTiming.activeFrames, base.moves.special.timing.activeFrames, 1, 600, true);
  config.moves.special.timing.recoveryFrames = readNumber(specialTiming.recoveryFrames, base.moves.special.timing.recoveryFrames, 0, 1200, true);
  config.moves.special.timing.cooldownFrames = readNumber(specialTiming.cooldownFrames, base.moves.special.timing.cooldownFrames, 0, 2400, true);
  config.moves.special.size.range = readNumber(specialSize.range, base.moves.special.size.range, 0, 1000);
  config.moves.special.size.radius = readNumber(specialSize.radius, base.moves.special.size.radius, 0, 1000);
  config.moves.special.size.width = readNumber(specialSize.width, base.moves.special.size.width, 0, 1000);
  config.moves.special.size.length = readNumber(specialSize.length, base.moves.special.size.length, 0, 1000);
  if (config.moves.special.projectile && base.moves.special.projectile) {
    config.moves.special.projectile.speed = readNumber(specialProjectile.speed, base.moves.special.projectile.speed, 0, 1000);
    config.moves.special.projectile.lifeSeconds = readNumber(specialProjectile.lifeSeconds, base.moves.special.projectile.lifeSeconds, 0, 60);
    config.moves.special.projectile.hitRadius = readNumber(specialProjectile.hitRadius, base.moves.special.projectile.hitRadius, 0, 100);
    config.moves.special.projectile.stunSeconds = readNumber(specialProjectile.stunSeconds, base.moves.special.projectile.stunSeconds, 0, 60);
    config.moves.special.projectile.fuelDamage = readNumber(specialProjectile.fuelDamage, base.moves.special.projectile.fuelDamage, 0, 1000);
  }
  if (config.moves.special.commandGrab && base.moves.special.commandGrab) {
    config.moves.special.commandGrab.stunFrames = readNumber(specialCommandGrab.stunFrames, base.moves.special.commandGrab.stunFrames, 0, 1200, true);
  }
  if (config.moves.special.movement && base.moves.special.movement) {
    config.moves.special.movement.dashSpeed = readNumber(specialMovement.dashSpeed, base.moves.special.movement.dashSpeed, 0, 1000);
  }
  if (config.moves.special.block && base.moves.special.block) {
    config.moves.special.block.guardFrames = readNumber(specialBlock.guardFrames, base.moves.special.block.guardFrames, 0, 1200, true);
  }
  config.moves.boost.holdSpeedMultiplier = readNumber(boost.holdSpeedMultiplier, base.moves.boost.holdSpeedMultiplier, 0.1, 5);
  config.moves.boost.holdFuelPerSecond = readNumber(boost.holdFuelPerSecond, base.moves.boost.holdFuelPerSecond, 0, 100);
  config.moves.superBoost.holdSpeedMultiplier = readNumber(superBoost.holdSpeedMultiplier, base.moves.superBoost.holdSpeedMultiplier, 0.1, 5);
  config.moves.superBoost.steerLerpMultiplier = readNumber(superBoost.steerLerpMultiplier, base.moves.superBoost.steerLerpMultiplier, 0.1, 5);
  config.moves.superBoost.velocityBlendMultiplier = readNumber(superBoost.velocityBlendMultiplier, base.moves.superBoost.velocityBlendMultiplier, 0.1, 5);
  config.moves.superBoost.startFuelCost = readNumber(superBoost.startFuelCost, base.moves.superBoost.startFuelCost, 0, 1000);
  config.moves.superBoost.travelFuelPerDistance = readNumber(superBoost.travelFuelPerDistance, base.moves.superBoost.travelFuelPerDistance, 0, 100);
  config.moves.superBoost.nonCommitPenalty = readNumber(superBoost.nonCommitPenalty, base.moves.superBoost.nonCommitPenalty, 0, 1000);
  config.moves.superBoost.turnPenaltyGainMultiplier = readNumber(superBoost.turnPenaltyGainMultiplier, base.moves.superBoost.turnPenaltyGainMultiplier, 0.1, 5);
  return config;
}

export function sanitiseCharacterBalanceOverrides(value: unknown): CharacterBalanceOverrides {
  const record = asRecord(value);
  const overrides: CharacterBalanceOverrides = {};
  for (const [characterId, candidate] of Object.entries(record)) {
    if (!CHARACTER_BY_ID[characterId]) {
      continue;
    }
    overrides[characterId] = sanitiseCharacterBalanceConfig(characterId, candidate);
  }
  return overrides;
}

export function resolveCharacterBalanceConfig(
  characterId: CharacterId,
  overrides: CharacterBalanceOverrides | undefined,
): CharacterBalanceConfig {
  const override = overrides?.[characterId];
  const character = CHARACTER_BY_ID[characterId];
  if (!character) {
    throw new Error(`Unknown character balance id "${characterId}".`);
  }
  return override ?? character;
}

export function fingerprintCharacterBalanceOverrides(overrides: CharacterBalanceOverrides | undefined): string {
  return fingerprintDeterministicValue(overrides ?? {});
}

export function fingerprintCharacterBalanceConfig(config: CharacterBalanceConfig): string {
  return fingerprintDeterministicValue(config);
}

export function resolveCharacterRulesFingerprint(
  registryFingerprint: string,
  overrides: CharacterBalanceOverrides | undefined,
): string {
  if (!overrides || Object.keys(overrides).length === 0) {
    return registryFingerprint;
  }
  return `${registryFingerprint}+local:${fingerprintCharacterBalanceOverrides(overrides).slice('fnv1a32:'.length)}`;
}
