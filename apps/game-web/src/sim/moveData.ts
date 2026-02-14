export interface LaunchFrameData {
  startupFrames: number;
  activeFrames: number;
  recoveryOnHitFrames: number;
  recoveryOnWhiffFrames: number;
}

export interface DunkFrameData {
  startupFrames: number;
  activeFrames: number;
  recoveryOnHitFrames: number;
  recoveryOnWhiffFrames: number;
  hitRange: number;
}

export interface ParryFrameData {
  activeFrames: number;
  recoveryFrames: number;
  counterStunFrames: number;
}

export interface BreakMoveData {
  selfStunFrames: number;
  velocityRetain: number;
}

export interface MovementMoveData {
  fuelPerSecond: number;
}

export interface BoostMoveData {
  holdSpeedMultiplier: number;
  holdFuelPerSecond: number;
}

export interface SuperBoostMoveData {
  holdSpeedMultiplier: number;
  steerLerpMultiplier: number;
  velocityBlendMultiplier: number;
  startFuelCost: number;
  travelFuelPerDistance: number;
  nonCommitPenalty: number;
  turnPenaltyGainMultiplier: number;
}

export interface ProjectileMoveData {
  speed: number;
  lifeSeconds: number;
  hitRadius: number;
  stunSeconds: number;
  fuelDamage: number;
  visualId: string;
}

export type SpecialMoveKind = 'projectile' | 'command_grab' | 'movement' | 'block';

export interface SpecialTimingData {
  startupFrames: number;
  activeFrames: number;
  recoveryFrames: number;
  cooldownFrames: number;
}

export interface SpecialSizeData {
  range: number;
  radius: number;
  width: number;
  length: number;
}

export interface SpecialCommandGrabData {
  stunFrames: number;
}

export interface SpecialMovementData {
  dashSpeed: number;
}

export interface SpecialBlockData {
  guardFrames: number;
}

export interface SpecialMoveData {
  id: string;
  label: string;
  kind: SpecialMoveKind;
  fuelCost: number;
  timing: SpecialTimingData;
  size: SpecialSizeData;
  projectile?: ProjectileMoveData;
  commandGrab?: SpecialCommandGrabData;
  movement?: SpecialMovementData;
  block?: SpecialBlockData;
}

export interface MoveFrameData {
  launch: LaunchFrameData;
  dunk: DunkFrameData;
  parry: ParryFrameData;
  break: BreakMoveData;
  movement: MovementMoveData;
  special: SpecialMoveData;
  boost: BoostMoveData;
  superBoost: SuperBoostMoveData;
}

export const MOVE_FRAME_DATA: MoveFrameData = {
  launch: {
    // Startup, active, and recovery are tuned as frame counts at 60Hz.
    startupFrames: 6,
    activeFrames: 3,
    recoveryOnHitFrames: 30,
    recoveryOnWhiffFrames: 42,
  },
  dunk: {
    // Slow startup and heavy whiff recovery make neutral dunk attempts high risk.
    startupFrames: 30,
    activeFrames: 4,
    recoveryOnHitFrames: 24,
    recoveryOnWhiffFrames: 66,
    hitRange: 8,
  },
  parry: {
    activeFrames: 11,
    recoveryFrames: 13,
    counterStunFrames: 45,
  },
  break: {
    selfStunFrames: 24,
    velocityRetain: 0.3,
  },
  movement: {
    fuelPerSecond: 0.65,
  },
  special: {
    id: 'basic_projectile',
    label: 'Basic Projectile',
    kind: 'projectile',
    fuelCost: 5,
    timing: {
      startupFrames: 0,
      activeFrames: 1,
      recoveryFrames: 0,
      cooldownFrames: 19,
    },
    size: {
      range: 100,
      radius: 0.8,
      width: 1.6,
      length: 1.6,
    },
    projectile: {
      speed: 42,
      lifeSeconds: 2,
      hitRadius: 0.8,
      stunSeconds: 0.7,
      fuelDamage: 4,
      visualId: 'default_orb',
    },
  },
  boost: {
    holdSpeedMultiplier: 1,
    holdFuelPerSecond: 0.2,
  },
  superBoost: {
    holdSpeedMultiplier: 1,
    steerLerpMultiplier: 1,
    velocityBlendMultiplier: 1,
    startFuelCost: 6,
    travelFuelPerDistance: 0.05,
    nonCommitPenalty: 2.5,
    turnPenaltyGainMultiplier: 1,
  },
};

export function framesToSeconds(frames: number): number {
  return Math.max(0, frames) / 60;
}
