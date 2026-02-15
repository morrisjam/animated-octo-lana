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
  startupFrames: number;
  activeFrames: number;
  recoveryFrames: number;
  counterStunFrames: number;
}

export interface BreakMoveData {
  startupFrames: number;
  activeFrames: number;
  recoveryFrames: number;
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
export type SpecialMoveBehaviorId =
  | 'special.projectile.v1'
  | 'special.command_grab.v1'
  | 'special.movement_dash.v1'
  | 'special.block_guard.v1';

export const SPECIAL_MOVE_BEHAVIOR_IDS: SpecialMoveBehaviorId[] = [
  'special.projectile.v1',
  'special.command_grab.v1',
  'special.movement_dash.v1',
  'special.block_guard.v1',
];

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
  behaviorId: SpecialMoveBehaviorId;
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

export interface CombatMoveFrameRegistry {
  launch: LaunchFrameData;
  dunk: Pick<DunkFrameData, 'startupFrames' | 'activeFrames' | 'recoveryOnHitFrames' | 'recoveryOnWhiffFrames'>;
  parry: Pick<ParryFrameData, 'startupFrames' | 'activeFrames' | 'recoveryFrames' | 'counterStunFrames'>;
  break: Pick<BreakMoveData, 'startupFrames' | 'activeFrames' | 'recoveryFrames'>;
  special: Pick<SpecialTimingData, 'startupFrames' | 'activeFrames' | 'recoveryFrames' | 'cooldownFrames'>;
}

// All move timing values are authored in 60Hz frame units.
export const SIMULATION_FRAME_RATE_HZ = 60;
const DEFAULT_PROJECTILE_VISUAL_ID = 'default_orb';

export const COMBAT_MOVE_FRAME_REGISTRY: CombatMoveFrameRegistry = {
  launch: {
    startupFrames: 6,
    activeFrames: 3,
    recoveryOnHitFrames: 30,
    recoveryOnWhiffFrames: 42,
  },
  dunk: {
    startupFrames: 30,
    activeFrames: 4,
    recoveryOnHitFrames: 24,
    recoveryOnWhiffFrames: 66,
  },
  parry: {
    startupFrames: 0,
    activeFrames: 11,
    recoveryFrames: 13,
    counterStunFrames: 45,
  },
  break: {
    startupFrames: 0,
    activeFrames: 1,
    recoveryFrames: 24,
  },
  special: {
    startupFrames: 0,
    activeFrames: 1,
    recoveryFrames: 0,
    cooldownFrames: 19,
  },
};

export function createMoveFrameData(projectileVisualId = DEFAULT_PROJECTILE_VISUAL_ID): MoveFrameData {
  return {
    launch: {
      startupFrames: COMBAT_MOVE_FRAME_REGISTRY.launch.startupFrames,
      activeFrames: COMBAT_MOVE_FRAME_REGISTRY.launch.activeFrames,
      recoveryOnHitFrames: COMBAT_MOVE_FRAME_REGISTRY.launch.recoveryOnHitFrames,
      recoveryOnWhiffFrames: COMBAT_MOVE_FRAME_REGISTRY.launch.recoveryOnWhiffFrames,
    },
    dunk: {
      startupFrames: COMBAT_MOVE_FRAME_REGISTRY.dunk.startupFrames,
      activeFrames: COMBAT_MOVE_FRAME_REGISTRY.dunk.activeFrames,
      recoveryOnHitFrames: COMBAT_MOVE_FRAME_REGISTRY.dunk.recoveryOnHitFrames,
      recoveryOnWhiffFrames: COMBAT_MOVE_FRAME_REGISTRY.dunk.recoveryOnWhiffFrames,
      hitRange: 8,
    },
    parry: {
      startupFrames: COMBAT_MOVE_FRAME_REGISTRY.parry.startupFrames,
      activeFrames: COMBAT_MOVE_FRAME_REGISTRY.parry.activeFrames,
      recoveryFrames: COMBAT_MOVE_FRAME_REGISTRY.parry.recoveryFrames,
      counterStunFrames: COMBAT_MOVE_FRAME_REGISTRY.parry.counterStunFrames,
    },
    break: {
      startupFrames: COMBAT_MOVE_FRAME_REGISTRY.break.startupFrames,
      activeFrames: COMBAT_MOVE_FRAME_REGISTRY.break.activeFrames,
      recoveryFrames: COMBAT_MOVE_FRAME_REGISTRY.break.recoveryFrames,
      velocityRetain: 0.3,
    },
    movement: {
      fuelPerSecond: 0.65,
    },
    special: {
      id: 'basic_projectile',
      label: 'Basic Projectile',
      behaviorId: 'special.projectile.v1',
      kind: 'projectile',
      fuelCost: 5,
      timing: {
        startupFrames: COMBAT_MOVE_FRAME_REGISTRY.special.startupFrames,
        activeFrames: COMBAT_MOVE_FRAME_REGISTRY.special.activeFrames,
        recoveryFrames: COMBAT_MOVE_FRAME_REGISTRY.special.recoveryFrames,
        cooldownFrames: COMBAT_MOVE_FRAME_REGISTRY.special.cooldownFrames,
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
        visualId: projectileVisualId,
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
}

export const MOVE_FRAME_DATA: MoveFrameData = createMoveFrameData();

export function framesToSeconds(frames: number): number {
  return Math.max(0, frames) / SIMULATION_FRAME_RATE_HZ;
}

export function secondsToFrames(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.max(0, Math.round(seconds * SIMULATION_FRAME_RATE_HZ));
}

export function secondsToSignedFrames(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.round(seconds * SIMULATION_FRAME_RATE_HZ);
}
