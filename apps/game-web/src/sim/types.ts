import type { CharacterId } from './characters';
import type { CharacterBalanceOverrides } from './characterBalance';

export type PlayerId = 'P1' | 'P2';

export interface PlayersById<T> {
  P1: T;
  P2: T;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerFrameInput {
  moveX: number;
  moveY: number;
  boost: boolean;
  superBoost: boolean;
  special: boolean;
  launch: boolean;
  dunk: boolean;
  parry: boolean;
  breakLaunch: boolean;
}

export interface FrameInput {
  p1: PlayerFrameInput;
  p2: PlayerFrameInput;
}

export interface Cooldowns {
  special: number;
  launch: number;
  dunk: number;
  boost: number;
}

export interface GameTuning {
  chainWindowSeconds: number;
  playerMoveAccel: number;
  playerVelocityDamping: number;
  actionRecoveryControlMultiplier: number;
  combatBoostReacquireDelaySeconds: number;
  helplessVelocityDamping: number;
  helplessReleaseSpeedRatio: number;
  boostHoldSpeed: number;
  superBoostHoldSpeed: number;
  superBoostSteerLerp: number;
  superBoostVelocityBlend: number;
  superBoostWaveAmplitude: number;
  superBoostFuelMultiplier: number;
  launchBasePower: number;
  launchChainBonus: number;
  launchInputInfluence: number;
  launchHelplessSeconds: number;
  startupClashGraceSeconds: number;
  postControlCounterLaunchClashGraceSeconds: number;
  launchClashSeparationPadding: number;
  launchClashRecoilMultiplier: number;
  closeRangeSeparationPadding: number;
  closeRangeSeparationImpulse: number;
  closeRangeCommitSeparationMultiplier: number;
  defensiveResetDistance: number;
  defensiveResetImpulse: number;
  launchBreakResetMultiplier: number;
  naturalRecoveryResetMultiplier: number;
  dunkRecoveryDurationSeconds: number;
  dunkRecoveryMoveSpeed: number;
  dunkRecoveryFuelFraction: number;
}

export interface GameRules {
  allowDunkWin: boolean;
}

export interface PlayerState {
  id: PlayerId;
  characterId: CharacterId;
  pos: Vec2;
  vel: Vec2;
  boostActive: boolean;
  boostDir: Vec2;
  boostHeldTime: number;
  combatBoostLockRemaining: number;
  radius: number;
  maxFuel: number;
  fuel: number;
  launchBreaks: number;
  stunned: number;
  helpless: number;
  parry: number;
  endLag: number;
  chain: number;
  chainTimer: number;
  superBoost: number;
  superDir: Vec2;
  superTime: number;
  superDistance: number;
  superTurnPenalty: number;
  didCommitAttackDuringSuperBoost: boolean;
  lastLaunchedBy: PlayerId | null;
  recovering: number;
  recoveryDuration: number;
  recoveryDir: Vec2;
  launchFlash: number;
  parryFlash: number;
  specialFlash: number;
  breakFlash: number;
  dunkFlash: number;
  launchStartup: number;
  launchActive: number;
  launchDidConnect: boolean;
  launchAttemptSerial: number;
  postControlCounterPending: boolean;
  postControlCounterWindow: number;
  postControlCounterOpponentLaunchSerialAtReturn: number;
  postControlCounterLaunchEligible: boolean;
  dunkStartup: number;
  dunkActive: number;
  dunkDidConnect: boolean;
  specialStartup: number;
  specialActive: number;
  specialDidResolve: boolean;
  cool: Cooldowns;
}

export interface ProjectileState {
  id: number;
  ownerId: PlayerId;
  pos: Vec2;
  vel: Vec2;
  life: number;
  hitRadius: number;
  stunSeconds: number;
  fuelDamage: number;
  visualId: string;
}

export interface GameState {
  loadout: PlayersById<CharacterId>;
  characterBalanceOverrides: CharacterBalanceOverrides;
  rules: GameRules;
  seed: number;
  rngState: number;
  players: PlayersById<PlayerState>;
  projectiles: ProjectileState[];
  winner: PlayerId | null;
  gameTime: number;
  nextProjectileId: number;
  tuning: GameTuning;
}

export type PlayerPresentationAction =
  | 'idle'
  | 'boost'
  | 'launch'
  | 'parry'
  | 'break'
  | 'special'
  | 'dunk'
  | 'helpless'
  | 'recover';

export type PlayerPresentationPhase = 'none' | 'startup' | 'active' | 'sustain' | 'recovery';

export interface PlayerRenderSnapshot {
  id: PlayerId;
  characterId: CharacterId;
  pos: Vec2;
  maxFuel: number;
  fuel: number;
  launchBreaks: number;
  boostActive: boolean;
  superBoost: number;
  helpless: number;
  parry: number;
  launchFlash: number;
  parryFlash: number;
  specialFlash: number;
  breakFlash: number;
  dunkFlash: number;
  recovering: number;
  recoveryProgress: number;
  presentationAction: PlayerPresentationAction;
  presentationPhase: PlayerPresentationPhase;
}

export interface ProjectileRenderSnapshot {
  id: number;
  ownerId: PlayerId;
  visualId: string;
  pos: Vec2;
}

export interface RenderSnapshot {
  gameTime: number;
  winner: PlayerId | null;
  statusText: string;
  players: PlayersById<PlayerRenderSnapshot>;
  projectiles: ProjectileRenderSnapshot[];
}
