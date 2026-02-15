import type {
  CharacterAudioProfile,
  CharacterSpecialMoveDefinition,
  CharacterStats,
  CharacterVisualProfile,
} from '../sim/characters';
import type { MoveFrameData } from '../sim/moveData';

export const CHARACTER_PACKAGE_SCHEMA_VERSION = 'gw.character-package.v1';
const CHARACTER_ID_REGEX = /^[a-z0-9_]{2,32}$/;

export interface CharacterPackageMetadata {
  author: string;
  version: string;
  tags: string[];
}

export interface CharacterPackageV1 {
  schemaVersion: typeof CHARACTER_PACKAGE_SCHEMA_VERSION;
  id: string;
  displayName: string;
  blurb: string;
  mechanicsTag: string;
  metadata: CharacterPackageMetadata;
  stats: CharacterStats;
  visuals: CharacterVisualProfile;
  audio: CharacterAudioProfile;
  moves: MoveFrameData;
  specials: CharacterSpecialMoveDefinition[];
}

export interface CharacterPackageValidationIssue {
  path: string;
  message: string;
}

export class CharacterPackageValidationError extends Error {
  public readonly issues: CharacterPackageValidationIssue[];

  public constructor(issues: CharacterPackageValidationIssue[]) {
    super(`Character package validation failed with ${issues.length} issue(s).`);
    this.name = 'CharacterPackageValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushIssue(
  issues: CharacterPackageValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function readString(
  root: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPackageValidationIssue[],
  options?: { minLength?: number; maxLength?: number; pattern?: RegExp },
): string | null {
  const value = root[key];
  if (typeof value !== 'string') {
    pushIssue(issues, path, 'must be a string.');
    return null;
  }
  const trimmed = value.trim();
  const minLength = options?.minLength ?? 1;
  if (trimmed.length < minLength) {
    pushIssue(issues, path, `must be at least ${minLength} character(s).`);
    return null;
  }
  if (typeof options?.maxLength === 'number' && trimmed.length > options.maxLength) {
    pushIssue(issues, path, `must be at most ${options.maxLength} character(s).`);
    return null;
  }
  if (options?.pattern && !options.pattern.test(trimmed)) {
    pushIssue(issues, path, 'has invalid format.');
    return null;
  }
  return trimmed;
}

function readNumber(
  root: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPackageValidationIssue[],
  options?: { min?: number; max?: number },
): number | null {
  const value = root[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    pushIssue(issues, path, 'must be a finite number.');
    return null;
  }
  if (typeof options?.min === 'number' && value < options.min) {
    pushIssue(issues, path, `must be greater than or equal to ${options.min}.`);
    return null;
  }
  if (typeof options?.max === 'number' && value > options.max) {
    pushIssue(issues, path, `must be less than or equal to ${options.max}.`);
    return null;
  }
  return value;
}

function readBoolean(
  root: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPackageValidationIssue[],
): boolean | null {
  const value = root[key];
  if (typeof value !== 'boolean') {
    pushIssue(issues, path, 'must be a boolean.');
    return null;
  }
  return value;
}

function readObject(
  root: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPackageValidationIssue[],
): Record<string, unknown> | null {
  const value = root[key];
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object.');
    return null;
  }
  return value;
}

function readOptionalObject(
  root: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPackageValidationIssue[],
): Record<string, unknown> | undefined {
  if (!(key in root) || root[key] === undefined || root[key] === null) {
    return undefined;
  }
  const value = root[key];
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object when provided.');
    return undefined;
  }
  return value;
}

function readStringArray(
  root: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPackageValidationIssue[],
  options?: { minLength?: number },
): string[] | null {
  const value = root[key];
  if (!Array.isArray(value)) {
    pushIssue(issues, path, 'must be an array.');
    return null;
  }
  const values: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string') {
      pushIssue(issues, `${path}[${index}]`, 'must be a string.');
      continue;
    }
    const trimmed = item.trim();
    const minLength = options?.minLength ?? 1;
    if (trimmed.length < minLength) {
      pushIssue(issues, `${path}[${index}]`, `must be at least ${minLength} character(s).`);
      continue;
    }
    values.push(trimmed);
  }
  return values;
}

function validateMetadata(
  root: Record<string, unknown>,
  issues: CharacterPackageValidationIssue[],
): CharacterPackageMetadata | null {
  const author = readString(root, 'author', 'metadata.author', issues, { minLength: 2, maxLength: 120 });
  const version = readString(root, 'version', 'metadata.version', issues, { minLength: 1, maxLength: 40 });
  const tags = readStringArray(root, 'tags', 'metadata.tags', issues, { minLength: 1 });
  if (!author || !version || !tags) {
    return null;
  }
  return {
    author,
    version,
    tags,
  };
}

function validateStats(
  root: Record<string, unknown>,
  issues: CharacterPackageValidationIssue[],
): CharacterStats | null {
  const fuelCapacityMultiplier = readNumber(root, 'fuelCapacityMultiplier', 'stats.fuelCapacityMultiplier', issues, { min: 0.1, max: 10 });
  const moveAccelMultiplier = readNumber(root, 'moveAccelMultiplier', 'stats.moveAccelMultiplier', issues, { min: 0.1, max: 10 });
  const boostSpeedMultiplier = readNumber(root, 'boostSpeedMultiplier', 'stats.boostSpeedMultiplier', issues, { min: 0.1, max: 10 });
  const superBoostSpeedMultiplier = readNumber(root, 'superBoostSpeedMultiplier', 'stats.superBoostSpeedMultiplier', issues, { min: 0.1, max: 10 });
  const launchBasePowerMultiplier = readNumber(root, 'launchBasePowerMultiplier', 'stats.launchBasePowerMultiplier', issues, { min: 0.1, max: 10 });
  const launchChainBonusMultiplier = readNumber(root, 'launchChainBonusMultiplier', 'stats.launchChainBonusMultiplier', issues, { min: 0.1, max: 10 });
  const launchDurationTakenMultiplier = readNumber(root, 'launchDurationTakenMultiplier', 'stats.launchDurationTakenMultiplier', issues, { min: 0.1, max: 10 });
  const specialFuelCostMultiplier = readNumber(root, 'specialFuelCostMultiplier', 'stats.specialFuelCostMultiplier', issues, { min: 0.1, max: 10 });
  const superFuelMultiplier = readNumber(root, 'superFuelMultiplier', 'stats.superFuelMultiplier', issues, { min: 0.1, max: 10 });
  const dunkRecoveryFuelMultiplier = readNumber(root, 'dunkRecoveryFuelMultiplier', 'stats.dunkRecoveryFuelMultiplier', issues, { min: 0.1, max: 10 });

  if (
    fuelCapacityMultiplier === null
    || moveAccelMultiplier === null
    || boostSpeedMultiplier === null
    || superBoostSpeedMultiplier === null
    || launchBasePowerMultiplier === null
    || launchChainBonusMultiplier === null
    || launchDurationTakenMultiplier === null
    || specialFuelCostMultiplier === null
    || superFuelMultiplier === null
    || dunkRecoveryFuelMultiplier === null
  ) {
    return null;
  }

  return {
    fuelCapacityMultiplier,
    moveAccelMultiplier,
    boostSpeedMultiplier,
    superBoostSpeedMultiplier,
    launchBasePowerMultiplier,
    launchChainBonusMultiplier,
    launchDurationTakenMultiplier,
    specialFuelCostMultiplier,
    superFuelMultiplier,
    dunkRecoveryFuelMultiplier,
  };
}

function validateVisuals(
  root: Record<string, unknown>,
  issues: CharacterPackageValidationIssue[],
): CharacterVisualProfile | null {
  const presentation = readString(root, 'presentation', 'visuals.presentation', issues, { minLength: 2, maxLength: 12 });
  const modelId = readString(root, 'modelId', 'visuals.modelId', issues, { minLength: 2, maxLength: 120 });
  const animationSetId = readString(root, 'animationSetId', 'visuals.animationSetId', issues, { minLength: 2, maxLength: 120 });
  const vfxProfileId = readString(root, 'vfxProfileId', 'visuals.vfxProfileId', issues, { minLength: 2, maxLength: 120 });
  const projectileVisualId = readString(root, 'projectileVisualId', 'visuals.projectileVisualId', issues, { minLength: 2, maxLength: 120 });
  const hudPortraitId = readString(root, 'hudPortraitId', 'visuals.hudPortraitId', issues, { minLength: 2, maxLength: 120 });

  if (
    presentation !== '3d'
    && presentation !== 'sprite'
    && presentation !== 'hybrid'
  ) {
    if (presentation !== null) {
      pushIssue(issues, 'visuals.presentation', 'must be one of: 3d, sprite, hybrid.');
    }
    return null;
  }

  if (!modelId || !animationSetId || !vfxProfileId || !projectileVisualId || !hudPortraitId) {
    return null;
  }

  return {
    presentation,
    modelId,
    animationSetId,
    vfxProfileId,
    projectileVisualId,
    hudPortraitId,
  };
}

function validateAudio(
  root: Record<string, unknown>,
  issues: CharacterPackageValidationIssue[],
): CharacterAudioProfile | null {
  const sfxProfileId = readString(root, 'sfxProfileId', 'audio.sfxProfileId', issues, { minLength: 2, maxLength: 120 });
  const voiceProfileId = readString(root, 'voiceProfileId', 'audio.voiceProfileId', issues, { minLength: 2, maxLength: 120 });
  const musicThemeId = readString(root, 'musicThemeId', 'audio.musicThemeId', issues, { minLength: 2, maxLength: 120 });
  if (!sfxProfileId || !voiceProfileId || !musicThemeId) {
    return null;
  }
  return {
    sfxProfileId,
    voiceProfileId,
    musicThemeId,
  };
}

function validateMoves(
  root: Record<string, unknown>,
  issues: CharacterPackageValidationIssue[],
): MoveFrameData | null {
  const launch = readObject(root, 'launch', 'moves.launch', issues);
  const dunk = readObject(root, 'dunk', 'moves.dunk', issues);
  const parry = readObject(root, 'parry', 'moves.parry', issues);
  const breakMove = readObject(root, 'break', 'moves.break', issues);
  const movement = readObject(root, 'movement', 'moves.movement', issues);
  const special = readObject(root, 'special', 'moves.special', issues);
  const boost = readObject(root, 'boost', 'moves.boost', issues);
  const superBoost = readObject(root, 'superBoost', 'moves.superBoost', issues);

  if (!launch || !dunk || !parry || !breakMove || !movement || !special || !boost || !superBoost) {
    return null;
  }

  const launchData = {
    startupFrames: readNumber(launch, 'startupFrames', 'moves.launch.startupFrames', issues, { min: 0, max: 600 }),
    activeFrames: readNumber(launch, 'activeFrames', 'moves.launch.activeFrames', issues, { min: 0, max: 600 }),
    recoveryOnHitFrames: readNumber(launch, 'recoveryOnHitFrames', 'moves.launch.recoveryOnHitFrames', issues, { min: 0, max: 1200 }),
    recoveryOnWhiffFrames: readNumber(launch, 'recoveryOnWhiffFrames', 'moves.launch.recoveryOnWhiffFrames', issues, { min: 0, max: 1200 }),
  };

  const dunkData = {
    startupFrames: readNumber(dunk, 'startupFrames', 'moves.dunk.startupFrames', issues, { min: 0, max: 600 }),
    activeFrames: readNumber(dunk, 'activeFrames', 'moves.dunk.activeFrames', issues, { min: 0, max: 600 }),
    recoveryOnHitFrames: readNumber(dunk, 'recoveryOnHitFrames', 'moves.dunk.recoveryOnHitFrames', issues, { min: 0, max: 1200 }),
    recoveryOnWhiffFrames: readNumber(dunk, 'recoveryOnWhiffFrames', 'moves.dunk.recoveryOnWhiffFrames', issues, { min: 0, max: 1200 }),
    hitRange: readNumber(dunk, 'hitRange', 'moves.dunk.hitRange', issues, { min: 0, max: 100 }),
  };

  const parryData = {
    startupFrames: readNumber(parry, 'startupFrames', 'moves.parry.startupFrames', issues, { min: 0, max: 600 }),
    activeFrames: readNumber(parry, 'activeFrames', 'moves.parry.activeFrames', issues, { min: 0, max: 600 }),
    recoveryFrames: readNumber(parry, 'recoveryFrames', 'moves.parry.recoveryFrames', issues, { min: 0, max: 1200 }),
    counterStunFrames: readNumber(parry, 'counterStunFrames', 'moves.parry.counterStunFrames', issues, { min: 0, max: 1200 }),
  };

  const breakData = {
    startupFrames: readNumber(breakMove, 'startupFrames', 'moves.break.startupFrames', issues, { min: 0, max: 600 }),
    activeFrames: readNumber(breakMove, 'activeFrames', 'moves.break.activeFrames', issues, { min: 0, max: 600 }),
    recoveryFrames: readNumber(breakMove, 'recoveryFrames', 'moves.break.recoveryFrames', issues, { min: 0, max: 1200 }),
    velocityRetain: readNumber(breakMove, 'velocityRetain', 'moves.break.velocityRetain', issues, { min: 0, max: 1 }),
  };

  const movementData = {
    fuelPerSecond: readNumber(movement, 'fuelPerSecond', 'moves.movement.fuelPerSecond', issues, { min: 0, max: 100 }),
  };

  const specialKind = readString(special, 'kind', 'moves.special.kind', issues, { minLength: 2, maxLength: 40 });
  const specialId = readString(special, 'id', 'moves.special.id', issues, { minLength: 2, maxLength: 64 });
  const specialLabel = readString(special, 'label', 'moves.special.label', issues, { minLength: 2, maxLength: 64 });
  const specialTiming = readObject(special, 'timing', 'moves.special.timing', issues);
  const specialSize = readObject(special, 'size', 'moves.special.size', issues);
  const specialProjectile = readOptionalObject(special, 'projectile', 'moves.special.projectile', issues);
  const specialCommandGrab = readOptionalObject(special, 'commandGrab', 'moves.special.commandGrab', issues);
  const specialMovement = readOptionalObject(special, 'movement', 'moves.special.movement', issues);
  const specialBlock = readOptionalObject(special, 'block', 'moves.special.block', issues);

  const allowedKinds = new Set(['projectile', 'command_grab', 'movement', 'block']);
  if (specialKind && !allowedKinds.has(specialKind)) {
    pushIssue(issues, 'moves.special.kind', 'must be one of: projectile, command_grab, movement, block.');
  }

  const boostData = {
    holdSpeedMultiplier: readNumber(boost, 'holdSpeedMultiplier', 'moves.boost.holdSpeedMultiplier', issues, { min: 0, max: 20 }),
    holdFuelPerSecond: readNumber(boost, 'holdFuelPerSecond', 'moves.boost.holdFuelPerSecond', issues, { min: 0, max: 100 }),
  };

  const superBoostData = {
    holdSpeedMultiplier: readNumber(superBoost, 'holdSpeedMultiplier', 'moves.superBoost.holdSpeedMultiplier', issues, { min: 0, max: 20 }),
    steerLerpMultiplier: readNumber(superBoost, 'steerLerpMultiplier', 'moves.superBoost.steerLerpMultiplier', issues, { min: 0, max: 20 }),
    velocityBlendMultiplier: readNumber(superBoost, 'velocityBlendMultiplier', 'moves.superBoost.velocityBlendMultiplier', issues, { min: 0, max: 20 }),
    startFuelCost: readNumber(superBoost, 'startFuelCost', 'moves.superBoost.startFuelCost', issues, { min: 0, max: 1000 }),
    travelFuelPerDistance: readNumber(superBoost, 'travelFuelPerDistance', 'moves.superBoost.travelFuelPerDistance', issues, { min: 0, max: 100 }),
    nonCommitPenalty: readNumber(superBoost, 'nonCommitPenalty', 'moves.superBoost.nonCommitPenalty', issues, { min: 0, max: 1000 }),
    turnPenaltyGainMultiplier: readNumber(superBoost, 'turnPenaltyGainMultiplier', 'moves.superBoost.turnPenaltyGainMultiplier', issues, { min: 0, max: 20 }),
  };

  const specialData = {
    id: specialId,
    label: specialLabel,
    kind: specialKind,
    fuelCost: readNumber(special, 'fuelCost', 'moves.special.fuelCost', issues, { min: 0, max: 1000 }),
    timing: specialTiming
      ? {
        startupFrames: readNumber(specialTiming, 'startupFrames', 'moves.special.timing.startupFrames', issues, { min: 0, max: 600 }),
        activeFrames: readNumber(specialTiming, 'activeFrames', 'moves.special.timing.activeFrames', issues, { min: 0, max: 600 }),
        recoveryFrames: readNumber(specialTiming, 'recoveryFrames', 'moves.special.timing.recoveryFrames', issues, { min: 0, max: 1200 }),
        cooldownFrames: readNumber(specialTiming, 'cooldownFrames', 'moves.special.timing.cooldownFrames', issues, { min: 0, max: 2400 }),
      }
      : null,
    size: specialSize
      ? {
        range: readNumber(specialSize, 'range', 'moves.special.size.range', issues, { min: 0, max: 1000 }),
        radius: readNumber(specialSize, 'radius', 'moves.special.size.radius', issues, { min: 0, max: 1000 }),
        width: readNumber(specialSize, 'width', 'moves.special.size.width', issues, { min: 0, max: 1000 }),
        length: readNumber(specialSize, 'length', 'moves.special.size.length', issues, { min: 0, max: 1000 }),
      }
      : null,
    projectile: specialProjectile
      ? {
        speed: readNumber(specialProjectile, 'speed', 'moves.special.projectile.speed', issues, { min: 0, max: 1000 }),
        lifeSeconds: readNumber(specialProjectile, 'lifeSeconds', 'moves.special.projectile.lifeSeconds', issues, { min: 0, max: 60 }),
        hitRadius: readNumber(specialProjectile, 'hitRadius', 'moves.special.projectile.hitRadius', issues, { min: 0, max: 100 }),
        stunSeconds: readNumber(specialProjectile, 'stunSeconds', 'moves.special.projectile.stunSeconds', issues, { min: 0, max: 60 }),
        fuelDamage: readNumber(specialProjectile, 'fuelDamage', 'moves.special.projectile.fuelDamage', issues, { min: 0, max: 1000 }),
        visualId: readString(specialProjectile, 'visualId', 'moves.special.projectile.visualId', issues, { minLength: 2, maxLength: 120 }),
      }
      : undefined,
    commandGrab: specialCommandGrab
      ? {
        stunFrames: readNumber(specialCommandGrab, 'stunFrames', 'moves.special.commandGrab.stunFrames', issues, { min: 0, max: 1200 }),
      }
      : undefined,
    movement: specialMovement
      ? {
        dashSpeed: readNumber(specialMovement, 'dashSpeed', 'moves.special.movement.dashSpeed', issues, { min: 0, max: 1000 }),
      }
      : undefined,
    block: specialBlock
      ? {
        guardFrames: readNumber(specialBlock, 'guardFrames', 'moves.special.block.guardFrames', issues, { min: 0, max: 1200 }),
      }
      : undefined,
  };

  const hasCriticalNull =
    Object.values(launchData).some((value) => value === null)
    || Object.values(dunkData).some((value) => value === null)
    || Object.values(parryData).some((value) => value === null)
    || Object.values(breakData).some((value) => value === null)
    || Object.values(movementData).some((value) => value === null)
    || Object.values(boostData).some((value) => value === null)
    || Object.values(superBoostData).some((value) => value === null)
    || !specialData.id
    || !specialData.label
    || !specialData.kind
    || specialData.fuelCost === null
    || !specialData.timing
    || Object.values(specialData.timing).some((value) => value === null)
    || !specialData.size
    || Object.values(specialData.size).some((value) => value === null);

  if (hasCriticalNull) {
    return null;
  }

  if (specialData.kind === 'projectile' && !specialData.projectile) {
    pushIssue(issues, 'moves.special.projectile', 'is required when moves.special.kind is projectile.');
    return null;
  }
  if (specialData.kind === 'command_grab' && !specialData.commandGrab) {
    pushIssue(issues, 'moves.special.commandGrab', 'is required when moves.special.kind is command_grab.');
    return null;
  }
  if (specialData.kind === 'movement' && !specialData.movement) {
    pushIssue(issues, 'moves.special.movement', 'is required when moves.special.kind is movement.');
    return null;
  }
  if (specialData.kind === 'block' && !specialData.block) {
    pushIssue(issues, 'moves.special.block', 'is required when moves.special.kind is block.');
    return null;
  }

  if (specialData.projectile && Object.values(specialData.projectile).some((value) => value === null)) {
    return null;
  }
  if (specialData.commandGrab && Object.values(specialData.commandGrab).some((value) => value === null)) {
    return null;
  }
  if (specialData.movement && Object.values(specialData.movement).some((value) => value === null)) {
    return null;
  }
  if (specialData.block && Object.values(specialData.block).some((value) => value === null)) {
    return null;
  }

  return {
    launch: launchData as MoveFrameData['launch'],
    dunk: dunkData as MoveFrameData['dunk'],
    parry: parryData as MoveFrameData['parry'],
    break: breakData as MoveFrameData['break'],
    movement: movementData as MoveFrameData['movement'],
    special: specialData as MoveFrameData['special'],
    boost: boostData as MoveFrameData['boost'],
    superBoost: superBoostData as MoveFrameData['superBoost'],
  };
}

function validateSpecials(
  value: unknown,
  issues: CharacterPackageValidationIssue[],
): CharacterSpecialMoveDefinition[] | null {
  if (!Array.isArray(value)) {
    pushIssue(issues, 'specials', 'must be an array.');
    return null;
  }
  const specials: CharacterSpecialMoveDefinition[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      pushIssue(issues, `specials[${index}]`, 'must be an object.');
      continue;
    }
    const id = readString(entry, 'id', `specials[${index}].id`, issues, { minLength: 2, maxLength: 64 });
    const label = readString(entry, 'label', `specials[${index}].label`, issues, { minLength: 2, maxLength: 80 });
    const enabled = readBoolean(entry, 'enabled', `specials[${index}].enabled`, issues);
    if (!id || !label || enabled === null) {
      continue;
    }
    specials.push({ id, label, enabled });
  }
  return specials;
}

export function parseCharacterPackage(input: unknown): CharacterPackageV1 {
  const issues: CharacterPackageValidationIssue[] = [];
  if (!isRecord(input)) {
    throw new CharacterPackageValidationError([
      { path: '$', message: 'root value must be an object.' },
    ]);
  }

  const schemaVersion = readString(
    input,
    'schemaVersion',
    'schemaVersion',
    issues,
    { minLength: 1, maxLength: 64 },
  );
  if (schemaVersion && schemaVersion !== CHARACTER_PACKAGE_SCHEMA_VERSION) {
    pushIssue(
      issues,
      'schemaVersion',
      `must equal ${CHARACTER_PACKAGE_SCHEMA_VERSION}.`,
    );
  }

  const id = readString(input, 'id', 'id', issues, {
    minLength: 2,
    maxLength: 32,
    pattern: CHARACTER_ID_REGEX,
  });
  const displayName = readString(input, 'displayName', 'displayName', issues, { minLength: 2, maxLength: 64 });
  const blurb = readString(input, 'blurb', 'blurb', issues, { minLength: 4, maxLength: 240 });
  const mechanicsTag = readString(input, 'mechanicsTag', 'mechanicsTag', issues, { minLength: 2, maxLength: 120 });

  const metadataRaw = readObject(input, 'metadata', 'metadata', issues);
  const statsRaw = readObject(input, 'stats', 'stats', issues);
  const visualsRaw = readObject(input, 'visuals', 'visuals', issues);
  const audioRaw = readObject(input, 'audio', 'audio', issues);
  const movesRaw = readObject(input, 'moves', 'moves', issues);
  const specialsRaw = input.specials;

  const metadata = metadataRaw ? validateMetadata(metadataRaw, issues) : null;
  const stats = statsRaw ? validateStats(statsRaw, issues) : null;
  const visuals = visualsRaw ? validateVisuals(visualsRaw, issues) : null;
  const audio = audioRaw ? validateAudio(audioRaw, issues) : null;
  const moves = movesRaw ? validateMoves(movesRaw, issues) : null;
  const specials = validateSpecials(specialsRaw, issues);

  if (
    issues.length > 0
    || !schemaVersion
    || !id
    || !displayName
    || !blurb
    || !mechanicsTag
    || !metadata
    || !stats
    || !visuals
    || !audio
    || !moves
    || !specials
  ) {
    throw new CharacterPackageValidationError(issues);
  }

  return {
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    id,
    displayName,
    blurb,
    mechanicsTag,
    metadata,
    stats,
    visuals,
    audio,
    moves,
    specials,
  };
}
