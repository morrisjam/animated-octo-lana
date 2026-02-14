import {
  ARENA_RADIUS,
  ARENA_WRAP_RADIUS,
  BREAK_FLASH_SECONDS,
  DUNK_FLASH_SECONDS,
  LAUNCH_FLASH_SECONDS,
  MAX_FUEL,
  OPPONENT_BY_ID,
  PARRY_FLASH_SECONDS,
  PROJECTILE_CULL_RADIUS,
  SPECIAL_FLASH_SECONDS,
  STATUS_TEXT,
} from './constants';
import { CHARACTER_BY_ID, DEFAULT_CHARACTER_LOADOUT } from './characters';
import { framesToSeconds } from './moveData';
import { nextRngState, rngStateToUnitFloat, sanitiseSeed } from './rng';
import { createDefaultTuning } from './tuning';
import type {
  Cooldowns,
  FrameInput,
  GameState,
  PlayerFrameInput,
  PlayerId,
  PlayerState,
  PlayersById,
  ProjectileState,
  RenderSnapshot,
  Vec2,
} from './types';
import type { CharacterId } from './characters';
import type { GameRules } from './types';

interface CreateInitialStateOptions {
  seed?: number;
  loadout?: {
    P1?: CharacterId;
    P2?: CharacterId;
  };
  rules?: Partial<GameRules>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distanceVec2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalise(x: number, y: number): Vec2 {
  const len = Math.hypot(x, y);
  if (len <= 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / len, y: y / len };
}

function getCharacterStats(player: PlayerState) {
  return CHARACTER_BY_ID[player.characterId].stats;
}

function getCharacterMoves(player: PlayerState) {
  return CHARACTER_BY_ID[player.characterId].moves;
}

function tryConsumeFuel(player: PlayerState, amount: number): boolean {
  if (player.fuel < amount) {
    return false;
  }
  player.fuel = Math.max(0, player.fuel - amount);
  return true;
}

function clearLaunchAttempt(player: PlayerState): void {
  player.launchStartup = 0;
  player.launchActive = 0;
  player.launchDidConnect = false;
}

function clearDunkAttempt(player: PlayerState): void {
  player.dunkStartup = 0;
  player.dunkActive = 0;
  player.dunkDidConnect = false;
}

function clearSpecialAttempt(player: PlayerState): void {
  player.specialStartup = 0;
  player.specialActive = 0;
  player.specialDidResolve = false;
}

function resetChain(player: PlayerState): void {
  player.chain = 0;
  player.chainTimer = 0;
}

function setStunned(player: PlayerState, duration: number): void {
  player.stunned = duration;
  clearLaunchAttempt(player);
  clearDunkAttempt(player);
  clearSpecialAttempt(player);
  resetChain(player);
}

function createPlayer(id: PlayerId, characterId: CharacterId, spawnX: number, spawnY: number): PlayerState {
  const maxFuel = Math.max(1, MAX_FUEL * CHARACTER_BY_ID[characterId].stats.fuelCapacityMultiplier);
  return {
    id,
    characterId,
    pos: { x: spawnX, y: spawnY },
    vel: { x: 0, y: 0 },
    radius: 2.25,
    maxFuel,
    fuel: maxFuel,
    launchBreaks: 3,
    stunned: 0,
    helpless: 0,
    parry: 0,
    endLag: 0,
    chain: 0,
    chainTimer: 0,
    superBoost: 0,
    superDir: { x: 0, y: 0 },
    superTime: 0,
    superDistance: 0,
    superTurnPenalty: 0,
    didCommitAttackDuringSuperBoost: false,
    lastLaunchedBy: null,
    recovering: 0,
    recoveryDuration: 0,
    recoveryDir: { x: 0, y: 0 },
    launchFlash: 0,
    parryFlash: 0,
    specialFlash: 0,
    breakFlash: 0,
    dunkFlash: 0,
    launchStartup: 0,
    launchActive: 0,
    launchDidConnect: false,
    dunkStartup: 0,
    dunkActive: 0,
    dunkDidConnect: false,
    specialStartup: 0,
    specialActive: 0,
    specialDidResolve: false,
    cool: {
      special: 0,
      launch: 0,
      dunk: 0,
      boost: 0,
    },
  };
}

function resolveRules(rules?: Partial<GameRules>): GameRules {
  return {
    allowDunkWin: rules?.allowDunkWin ?? true,
  };
}

export function createInitialState(options?: CreateInitialStateOptions): GameState {
  const seed = sanitiseSeed(options?.seed);
  const loadout = {
    P1: options?.loadout?.P1 ?? DEFAULT_CHARACTER_LOADOUT.P1,
    P2: options?.loadout?.P2 ?? DEFAULT_CHARACTER_LOADOUT.P2,
  };
  const rules = resolveRules(options?.rules);

  return {
    loadout,
    rules,
    seed,
    rngState: seed,
    players: {
      P1: createPlayer('P1', loadout.P1, -30, 6),
      P2: createPlayer('P2', loadout.P2, 30, -6),
    },
    projectiles: [],
    winner: null,
    gameTime: 0,
    nextProjectileId: 1,
    tuning: createDefaultTuning(),
  };
}

export function nextDeterministicRandom(state: GameState): number {
  state.rngState = nextRngState(state.rngState);
  return rngStateToUnitFloat(state.rngState);
}

function cloneVec2(vec: Vec2): Vec2 {
  return { x: vec.x, y: vec.y };
}

function cloneCooldowns(cool: Cooldowns): Cooldowns {
  return {
    special: cool.special,
    launch: cool.launch,
    dunk: cool.dunk,
    boost: cool.boost,
  };
}

function clonePlayerState(player: PlayerState): PlayerState {
  return {
    id: player.id,
    characterId: player.characterId,
    pos: cloneVec2(player.pos),
    vel: cloneVec2(player.vel),
    radius: player.radius,
    maxFuel: player.maxFuel,
    fuel: player.fuel,
    launchBreaks: player.launchBreaks,
    stunned: player.stunned,
    helpless: player.helpless,
    parry: player.parry,
    endLag: player.endLag,
    chain: player.chain,
    chainTimer: player.chainTimer,
    superBoost: player.superBoost,
    superDir: cloneVec2(player.superDir),
    superTime: player.superTime,
    superDistance: player.superDistance,
    superTurnPenalty: player.superTurnPenalty,
    didCommitAttackDuringSuperBoost: player.didCommitAttackDuringSuperBoost,
    lastLaunchedBy: player.lastLaunchedBy,
    recovering: player.recovering,
    recoveryDuration: player.recoveryDuration,
    recoveryDir: cloneVec2(player.recoveryDir),
    launchFlash: player.launchFlash,
    parryFlash: player.parryFlash,
    specialFlash: player.specialFlash,
    breakFlash: player.breakFlash,
    dunkFlash: player.dunkFlash,
    launchStartup: player.launchStartup,
    launchActive: player.launchActive,
    launchDidConnect: player.launchDidConnect,
    dunkStartup: player.dunkStartup,
    dunkActive: player.dunkActive,
    dunkDidConnect: player.dunkDidConnect,
    specialStartup: player.specialStartup,
    specialActive: player.specialActive,
    specialDidResolve: player.specialDidResolve,
    cool: cloneCooldowns(player.cool),
  };
}

function clonePlayers(players: PlayersById<PlayerState>): PlayersById<PlayerState> {
  return {
    P1: clonePlayerState(players.P1),
    P2: clonePlayerState(players.P2),
  };
}

function cloneProjectile(projectile: ProjectileState): ProjectileState {
  return {
    id: projectile.id,
    ownerId: projectile.ownerId,
    pos: cloneVec2(projectile.pos),
    vel: cloneVec2(projectile.vel),
    life: projectile.life,
    hitRadius: projectile.hitRadius ?? 0.8,
    stunSeconds: projectile.stunSeconds ?? 0.7,
    fuelDamage: projectile.fuelDamage ?? 4,
    visualId: projectile.visualId ?? 'default_orb',
  };
}

export function createStateSnapshot(state: GameState): GameState {
  return {
    loadout: {
      P1: state.loadout.P1,
      P2: state.loadout.P2,
    },
    rules: resolveRules(state.rules),
    seed: state.seed,
    rngState: state.rngState,
    players: clonePlayers(state.players),
    projectiles: state.projectiles.map(cloneProjectile),
    winner: state.winner,
    gameTime: state.gameTime,
    nextProjectileId: state.nextProjectileId,
    tuning: { ...state.tuning },
  };
}

export function restoreStateFromSnapshot(snapshot: GameState): GameState {
  return createStateSnapshot(snapshot);
}

export function serialiseState(state: GameState): string {
  return JSON.stringify(createStateSnapshot(state));
}

export function deserialiseState(serialised: string): GameState {
  const parsed = JSON.parse(serialised) as GameState;
  return restoreStateFromSnapshot(parsed);
}

function resolveLaunchConnection(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  targetInput: PlayerFrameInput,
): boolean {
  const tuning = state.tuning;
  const attackerStats = getCharacterStats(attacker);
  const targetStats = getCharacterStats(target);
  const targetMoves = getCharacterMoves(target);
  const deltaX = target.pos.x - attacker.pos.x;
  const deltaY = target.pos.y - attacker.pos.y;

  if (target.parry > 0) {
    setStunned(attacker, framesToSeconds(targetMoves.parry.counterStunFrames));
    target.parry = 0;
    return false;
  }

  const dir = normalise(
    deltaX + targetInput.moveX * tuning.launchInputInfluence,
    deltaY + targetInput.moveY * tuning.launchInputInfluence,
  );

  const launchPower = (tuning.launchBasePower * attackerStats.launchBasePowerMultiplier)
    + attacker.chain * (tuning.launchChainBonus * attackerStats.launchChainBonusMultiplier);
  target.vel.x = dir.x * launchPower;
  target.vel.y = dir.y * launchPower;
  target.helpless = tuning.launchHelplessSeconds * targetStats.launchDurationTakenMultiplier;
  target.stunned = 0;
  target.lastLaunchedBy = attacker.id;
  attacker.launchFlash = LAUNCH_FLASH_SECONDS;
  target.launchFlash = LAUNCH_FLASH_SECONDS;

  attacker.chain += 1;
  attacker.chainTimer = tuning.chainWindowSeconds;
  return true;
}

function startLaunchAttempt(player: PlayerState): void {
  const launchFrameData = getCharacterMoves(player).launch;
  if (
    player.cool.launch > 0
    || player.endLag > 0
    || player.launchStartup > 0
    || player.launchActive > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
    || player.specialStartup > 0
    || player.specialActive > 0
  ) {
    return;
  }
  player.launchStartup = framesToSeconds(launchFrameData.startupFrames);
  player.launchActive = player.launchStartup > 0 ? 0 : framesToSeconds(launchFrameData.activeFrames);
  player.launchDidConnect = false;
  const startupAndActiveSeconds = framesToSeconds(
    launchFrameData.startupFrames + launchFrameData.activeFrames,
  );
  player.cool.launch = Math.max(player.cool.launch, startupAndActiveSeconds);
}

function advanceLaunchAttempt(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  targetInput: PlayerFrameInput,
  dt: number,
): void {
  const launchFrameData = getCharacterMoves(attacker).launch;

  if (attacker.launchStartup > 0) {
    attacker.launchStartup = Math.max(0, attacker.launchStartup - dt);
    if (attacker.launchStartup <= 0) {
      attacker.launchActive = framesToSeconds(launchFrameData.activeFrames);
      attacker.launchDidConnect = false;
    }
    return;
  }

  if (attacker.launchActive <= 0) {
    return;
  }

  if (attacker.stunned > 0 || attacker.helpless > 0 || attacker.recovering > 0 || state.winner) {
    clearLaunchAttempt(attacker);
    return;
  }

  const deltaX = target.pos.x - attacker.pos.x;
  const deltaY = target.pos.y - attacker.pos.y;
  const dist = Math.hypot(deltaX, deltaY);
  const inRange = dist <= attacker.radius + target.radius + 2.8;

  if (inRange) {
    const didConnect = resolveLaunchConnection(state, attacker, target, targetInput);
    clearLaunchAttempt(attacker);
    if (didConnect) {
      const hitRecoverySeconds = framesToSeconds(launchFrameData.recoveryOnHitFrames);
      attacker.endLag = Math.max(attacker.endLag, hitRecoverySeconds);
      attacker.cool.launch = Math.max(attacker.cool.launch, hitRecoverySeconds);
    }
    return;
  }

  attacker.launchActive = Math.max(0, attacker.launchActive - dt);
  if (attacker.launchActive <= 0) {
    const whiffRecoverySeconds = framesToSeconds(launchFrameData.recoveryOnWhiffFrames);
    attacker.endLag = Math.max(attacker.endLag, whiffRecoverySeconds);
    attacker.cool.launch = Math.max(attacker.cool.launch, whiffRecoverySeconds);
    clearLaunchAttempt(attacker);
  }
}

function startDunkRecovery(state: GameState, attacker: PlayerState, target: PlayerState): void {
  const tuning = state.tuning;
  const targetStats = getCharacterStats(target);
  if (target.fuel <= 0) {
    if (state.rules.allowDunkWin) {
      state.winner = attacker.id;
      return;
    }
    target.fuel = target.maxFuel;
  }

  const recoveryCost = Math.min(
    target.maxFuel * tuning.dunkRecoveryFuelFraction * targetStats.dunkRecoveryFuelMultiplier,
    target.fuel,
  );
  target.fuel = Math.max(0, target.fuel - recoveryCost);

  const toCenter = normalise(-target.pos.x, -target.pos.y);
  const awayFromAttacker = normalise(target.pos.x - attacker.pos.x, target.pos.y - attacker.pos.y);
  const recoveryDir = normalise(toCenter.x * 0.72 + awayFromAttacker.x * 0.28, toCenter.y * 0.72 + awayFromAttacker.y * 0.28);

  target.recovering = tuning.dunkRecoveryDurationSeconds;
  target.recoveryDuration = tuning.dunkRecoveryDurationSeconds;
  target.recoveryDir = recoveryDir;
  target.helpless = 0;
  target.stunned = 0;
  target.parry = 0;
  target.endLag = 0;
  target.superBoost = 0;
  target.vel.x = recoveryDir.x * tuning.dunkRecoveryMoveSpeed;
  target.vel.y = recoveryDir.y * tuning.dunkRecoveryMoveSpeed;
  target.lastLaunchedBy = null;
  clearLaunchAttempt(target);
  clearDunkAttempt(target);
  clearSpecialAttempt(target);
  target.cool.launch = 0;
  target.cool.dunk = 0;
  target.cool.special = 0;
  target.cool.boost = 0;

  resetChain(attacker);
  clearLaunchAttempt(attacker);
  clearDunkAttempt(attacker);
  clearSpecialAttempt(attacker);
  resetChain(target);
}

function startDunkAttempt(player: PlayerState): void {
  const dunkFrameData = getCharacterMoves(player).dunk;
  if (
    player.cool.dunk > 0
    || player.endLag > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
    || player.launchStartup > 0
    || player.launchActive > 0
    || player.specialStartup > 0
    || player.specialActive > 0
  ) {
    return;
  }

  player.dunkStartup = framesToSeconds(dunkFrameData.startupFrames);
  player.dunkActive = player.dunkStartup > 0 ? 0 : framesToSeconds(dunkFrameData.activeFrames);
  player.dunkDidConnect = false;
  player.dunkFlash = DUNK_FLASH_SECONDS;
  const startupAndActiveSeconds = framesToSeconds(dunkFrameData.startupFrames + dunkFrameData.activeFrames);
  player.cool.dunk = Math.max(player.cool.dunk, startupAndActiveSeconds);
}

function advanceDunkAttempt(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  dt: number,
): void {
  const dunkFrameData = getCharacterMoves(attacker).dunk;

  if (attacker.dunkStartup > 0) {
    attacker.dunkStartup = Math.max(0, attacker.dunkStartup - dt);
    if (attacker.dunkStartup <= 0) {
      attacker.dunkActive = framesToSeconds(dunkFrameData.activeFrames);
      attacker.dunkDidConnect = false;
    }
    return;
  }

  if (attacker.dunkActive <= 0) {
    return;
  }

  if (attacker.stunned > 0 || attacker.helpless > 0 || attacker.recovering > 0 || state.winner) {
    clearDunkAttempt(attacker);
    return;
  }

  const inRange = distanceVec2(attacker.pos, target.pos) <= dunkFrameData.hitRange;
  if (inRange) {
    attacker.dunkDidConnect = true;
    startDunkRecovery(state, attacker, target);
    clearDunkAttempt(attacker);
    const hitRecoverySeconds = framesToSeconds(dunkFrameData.recoveryOnHitFrames);
    attacker.endLag = Math.max(attacker.endLag, hitRecoverySeconds);
    attacker.cool.dunk = Math.max(attacker.cool.dunk, hitRecoverySeconds);
    return;
  }

  attacker.dunkActive = Math.max(0, attacker.dunkActive - dt);
  if (attacker.dunkActive <= 0) {
    const whiffRecoverySeconds = framesToSeconds(dunkFrameData.recoveryOnWhiffFrames);
    attacker.endLag = Math.max(attacker.endLag, whiffRecoverySeconds);
    attacker.cool.dunk = Math.max(attacker.cool.dunk, whiffRecoverySeconds);
    clearDunkAttempt(attacker);
  }
}

function spawnSpecialProjectile(state: GameState, attacker: PlayerState, target: PlayerState): boolean {
  const projectileMove = getCharacterMoves(attacker).special.projectile;
  if (!projectileMove) {
    return false;
  }

  const dir = normalise(target.pos.x - attacker.pos.x, target.pos.y - attacker.pos.y);
  state.projectiles.push({
    id: state.nextProjectileId,
    ownerId: attacker.id,
    pos: {
      x: attacker.pos.x + dir.x * (attacker.radius + 0.9),
      y: attacker.pos.y + dir.y * (attacker.radius + 0.9),
    },
    vel: {
      x: dir.x * projectileMove.speed,
      y: dir.y * projectileMove.speed,
    },
    life: projectileMove.lifeSeconds,
    hitRadius: projectileMove.hitRadius,
    stunSeconds: projectileMove.stunSeconds,
    fuelDamage: projectileMove.fuelDamage,
    visualId: projectileMove.visualId,
  });
  state.nextProjectileId += 1;
  return true;
}

function executeSpecial(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
): boolean {
  const specialMove = getCharacterMoves(attacker).special;
  switch (specialMove.kind) {
    case 'projectile':
      return spawnSpecialProjectile(state, attacker, target);
    case 'command_grab': {
      const inRange = distanceVec2(attacker.pos, target.pos) <= specialMove.size.range;
      if (!inRange || !specialMove.commandGrab) {
        return false;
      }
      setStunned(target, framesToSeconds(specialMove.commandGrab.stunFrames));
      return true;
    }
    case 'movement': {
      const moveData = specialMove.movement;
      if (!moveData) {
        return false;
      }
      const dir = normalise(target.pos.x - attacker.pos.x, target.pos.y - attacker.pos.y);
      attacker.vel.x = dir.x * moveData.dashSpeed;
      attacker.vel.y = dir.y * moveData.dashSpeed;
      return true;
    }
    case 'block': {
      if (!specialMove.block) {
        return false;
      }
      attacker.parry = Math.max(attacker.parry, framesToSeconds(specialMove.block.guardFrames));
      return true;
    }
    default:
      return false;
  }
}

function startSpecialAttempt(player: PlayerState): void {
  const playerStats = getCharacterStats(player);
  const specialMove = getCharacterMoves(player).special;
  if (
    player.cool.special > 0
    || player.endLag > 0
    || player.specialStartup > 0
    || player.specialActive > 0
    || player.launchStartup > 0
    || player.launchActive > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
  ) {
    return;
  }
  if (!tryConsumeFuel(player, specialMove.fuelCost * playerStats.specialFuelCostMultiplier)) {
    return;
  }

  player.specialStartup = framesToSeconds(specialMove.timing.startupFrames);
  player.specialActive = player.specialStartup > 0 ? 0 : framesToSeconds(specialMove.timing.activeFrames);
  player.specialDidResolve = false;
  player.specialFlash = SPECIAL_FLASH_SECONDS;

  const startupAndActiveSeconds = framesToSeconds(
    specialMove.timing.startupFrames + specialMove.timing.activeFrames,
  );
  player.cool.special = Math.max(
    player.cool.special,
    startupAndActiveSeconds + framesToSeconds(specialMove.timing.cooldownFrames),
  );
}

function advanceSpecialAttempt(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  dt: number,
): void {
  const specialMove = getCharacterMoves(attacker).special;

  if (attacker.specialStartup > 0) {
    attacker.specialStartup = Math.max(0, attacker.specialStartup - dt);
    if (attacker.specialStartup <= 0) {
      attacker.specialActive = framesToSeconds(specialMove.timing.activeFrames);
      attacker.specialDidResolve = false;
    }
    return;
  }

  if (attacker.specialActive <= 0) {
    return;
  }

  if (attacker.stunned > 0 || attacker.helpless > 0 || attacker.recovering > 0 || state.winner) {
    clearSpecialAttempt(attacker);
    return;
  }

  if (!attacker.specialDidResolve) {
    executeSpecial(state, attacker, target);
    attacker.specialDidResolve = true;
  }

  attacker.specialActive = Math.max(0, attacker.specialActive - dt);
  if (attacker.specialActive <= 0) {
    const recoverySeconds = framesToSeconds(specialMove.timing.recoveryFrames);
    attacker.endLag = Math.max(attacker.endLag, recoverySeconds);
    attacker.cool.special = Math.max(
      attacker.cool.special,
      recoverySeconds + framesToSeconds(specialMove.timing.cooldownFrames),
    );
    clearSpecialAttempt(attacker);
  }
}

function applyBoostHold(player: PlayerState, target: PlayerState, speed: number): void {
  if (player.helpless > 0) {
    return;
  }
  const dir = normalise(target.pos.x - player.pos.x, target.pos.y - player.pos.y);
  player.vel.x = dir.x * speed;
  player.vel.y = dir.y * speed;
}

function startSuperBoost(state: GameState, player: PlayerState, playerInput: PlayerFrameInput): void {
  const tuning = state.tuning;
  const playerStats = getCharacterStats(player);
  const superBoostMove = getCharacterMoves(player).superBoost;
  if (player.superBoost > 0 || player.helpless > 0 || player.endLag > 0) {
    return;
  }
  const inputLengthSq = playerInput.moveX * playerInput.moveX + playerInput.moveY * playerInput.moveY;
  if (inputLengthSq <= 0) {
    return;
  }
  if (!tryConsumeFuel(player, superBoostMove.startFuelCost * tuning.superBoostFuelMultiplier * playerStats.superFuelMultiplier)) {
    return;
  }

  player.superBoost = 1;
  player.superTime = 0;
  player.superDistance = 0;
  player.superTurnPenalty = 0;
  player.superDir = normalise(playerInput.moveX, playerInput.moveY);
  player.didCommitAttackDuringSuperBoost = false;
}

function finishSuperBoost(state: GameState, player: PlayerState): void {
  const tuning = state.tuning;
  const playerStats = getCharacterStats(player);
  const superBoostMove = getCharacterMoves(player).superBoost;
  if (player.superBoost <= 0) {
    return;
  }
  player.superBoost = 0;
  const fuelScale = tuning.superBoostFuelMultiplier * playerStats.superFuelMultiplier;
  const travelCost = player.superDistance * superBoostMove.travelFuelPerDistance * fuelScale;
  const turnCost = player.superTurnPenalty * fuelScale;
  const commitPenalty = player.didCommitAttackDuringSuperBoost ? 0 : superBoostMove.nonCommitPenalty * fuelScale;
  player.fuel = Math.max(0, player.fuel - travelCost - turnCost - commitPenalty);
}

function movement(
  state: GameState,
  frameInput: FrameInput,
  playerId: PlayerId,
  playerInput: PlayerFrameInput,
  dt: number,
): void {
  const tuning = state.tuning;
  const player = state.players[playerId];
  const playerStats = getCharacterStats(player);
  const playerMoves = getCharacterMoves(player);
  const target = state.players[OPPONENT_BY_ID[playerId]];
  const targetInput = playerId === 'P1' ? frameInput.p2 : frameInput.p1;

  if (!state.winner && playerInput.breakLaunch && player.helpless > 0 && player.launchBreaks > 0) {
    const breakMove = playerMoves.break;
    player.launchBreaks -= 1;
    player.helpless = 0;
    player.breakFlash = BREAK_FLASH_SECONDS;
    setStunned(player, framesToSeconds(breakMove.selfStunFrames));
    player.vel.x *= breakMove.velocityRetain;
    player.vel.y *= breakMove.velocityRetain;
    if (player.lastLaunchedBy) {
      resetChain(state.players[player.lastLaunchedBy]);
      player.lastLaunchedBy = null;
    }
    return;
  }

  advanceLaunchAttempt(state, player, target, targetInput, dt);
  advanceDunkAttempt(state, player, target, dt);
  advanceSpecialAttempt(state, player, target, dt);

  if (player.recovering > 0 || player.stunned > 0 || player.helpless > 0 || state.winner) {
    return;
  }

  if (playerInput.parry && player.parry <= 0 && player.endLag <= 0) {
    const parryMove = playerMoves.parry;
    player.parry = framesToSeconds(parryMove.activeFrames);
    player.parryFlash = PARRY_FLASH_SECONDS;
    player.endLag = Math.max(player.endLag, framesToSeconds(parryMove.recoveryFrames));
  }

  if (player.superBoost > 0 && (playerInput.launch || playerInput.dunk || playerInput.special)) {
    player.didCommitAttackDuringSuperBoost = true;
  }

  if (playerInput.special) {
    startSpecialAttempt(player);
    if (player.specialStartup <= 0 && player.specialActive > 0 && !player.specialDidResolve) {
      advanceSpecialAttempt(state, player, target, 0);
    }
  }
  if (playerInput.launch) {
    startLaunchAttempt(player);
  }
  if (playerInput.dunk) {
    startDunkAttempt(player);
  }
  const boostHeld = playerInput.boost && player.superBoost <= 0 && (
    playerMoves.boost.holdFuelPerSecond <= 0 || player.fuel > 0
  );
  if (boostHeld) {
    applyBoostHold(
      player,
      target,
      tuning.boostHoldSpeed
      * playerStats.boostSpeedMultiplier
      * playerMoves.boost.holdSpeedMultiplier,
    );
    if (playerMoves.boost.holdFuelPerSecond > 0) {
      player.fuel = Math.max(0, player.fuel - dt * playerMoves.boost.holdFuelPerSecond);
    }
  }
  if (playerInput.superBoost) {
    if (player.superBoost <= 0) {
      startSuperBoost(state, player, playerInput);
    }
  } else if (player.superBoost > 0) {
    finishSuperBoost(state, player);
  }

  if (player.stunned > 0 && player.superBoost > 0) {
    finishSuperBoost(state, player);
    return;
  }

  const moveInputLengthSq = playerInput.moveX * playerInput.moveX + playerInput.moveY * playerInput.moveY;

  if (moveInputLengthSq > 0 && !boostHeld) {
    const moveDir = normalise(playerInput.moveX, playerInput.moveY);
    player.vel.x += moveDir.x * tuning.playerMoveAccel * playerStats.moveAccelMultiplier * dt;
    player.vel.y += moveDir.y * tuning.playerMoveAccel * playerStats.moveAccelMultiplier * dt;
    player.fuel = Math.max(0, player.fuel - dt * playerMoves.movement.fuelPerSecond);
  } else if (!boostHeld && player.superBoost <= 0) {
    // Extra controllable braking reduces slide when movement input is released.
    player.vel.x *= 0.86;
    player.vel.y *= 0.86;
  }

  if (player.superBoost > 0) {
    const superBoostMove = playerMoves.superBoost;
    player.superTime += dt;

    const desired = moveInputLengthSq > 0
      ? normalise(playerInput.moveX, playerInput.moveY)
      : { x: player.superDir.x, y: player.superDir.y };

    const turn = 1 - clamp(player.superDir.x * desired.x + player.superDir.y * desired.y, -1, 1);
    player.superTurnPenalty += turn * dt * 3 * superBoostMove.turnPenaltyGainMultiplier;

    const steerLerp = clamp(tuning.superBoostSteerLerp * superBoostMove.steerLerpMultiplier, 0, 1);
    const lerpedX = lerp(player.superDir.x, desired.x, steerLerp);
    const lerpedY = lerp(player.superDir.y, desired.y, steerLerp);
    player.superDir = normalise(lerpedX, lerpedY);

    const superSpeed = tuning.superBoostHoldSpeed
      * playerStats.superBoostSpeedMultiplier
      * superBoostMove.holdSpeedMultiplier;
    const stepX = player.superDir.x * superSpeed;
    const stepY = player.superDir.y * superSpeed;
    const velocityBlend = clamp(tuning.superBoostVelocityBlend * superBoostMove.velocityBlendMultiplier, 0, 1);
    player.vel.x = lerp(player.vel.x, stepX, velocityBlend);
    player.vel.y = lerp(player.vel.y, stepY, velocityBlend);
    player.superDistance += Math.hypot(stepX, stepY) * dt;
  }
}

function canTravelThroughBoundary(player: PlayerState): boolean {
  return player.helpless > 0 || player.superBoost > 0;
}

function clampToArena(player: PlayerState, dir: Vec2): void {
  const safeRadius = ARENA_RADIUS - 0.01;
  player.pos.x = dir.x * safeRadius;
  player.pos.y = dir.y * safeRadius;

  const outwardSpeed = player.vel.x * dir.x + player.vel.y * dir.y;
  if (outwardSpeed > 0) {
    player.vel.x -= dir.x * outwardSpeed;
    player.vel.y -= dir.y * outwardSpeed;
  }
}

function handleArenaBoundary(player: PlayerState): void {
  const radius = Math.hypot(player.pos.x, player.pos.y);
  if (radius <= ARENA_RADIUS) {
    return;
  }

  const dir = normalise(player.pos.x, player.pos.y);

  if (!canTravelThroughBoundary(player)) {
    clampToArena(player, dir);
    return;
  }

  if (radius > ARENA_WRAP_RADIUS) {
    player.pos.x = -dir.x * (ARENA_RADIUS - 1);
    player.pos.y = -dir.y * (ARENA_RADIUS - 1);
    if (player.helpless <= 0) {
      player.fuel = Math.max(0, player.fuel - 10);
    }
  }
}

function updatePlayer(state: GameState, playerId: PlayerId, dt: number): void {
  const player = state.players[playerId];
  const tuning = state.tuning;
  const previousHelpless = player.helpless;
  const wasRecovering = player.recovering > 0;

  if (player.recovering > 0) {
    player.recovering = Math.max(0, player.recovering - dt);
  }

  player.stunned = Math.max(0, player.stunned - dt);
  player.helpless = Math.max(0, player.helpless - dt);
  player.parry = Math.max(0, player.parry - dt);
  player.parryFlash = Math.max(0, player.parryFlash - dt);
  player.launchFlash = Math.max(0, player.launchFlash - dt);
  player.specialFlash = Math.max(0, player.specialFlash - dt);
  player.breakFlash = Math.max(0, player.breakFlash - dt);
  player.dunkFlash = Math.max(0, player.dunkFlash - dt);
  player.endLag = Math.max(0, player.endLag - dt);

  player.cool.special = Math.max(0, player.cool.special - dt);
  player.cool.launch = Math.max(0, player.cool.launch - dt);
  player.cool.dunk = Math.max(0, player.cool.dunk - dt);
  player.cool.boost = Math.max(0, player.cool.boost - dt);

  if (player.chain > 0) {
    player.chainTimer = Math.max(0, player.chainTimer - dt);
    if (player.chainTimer <= 0) {
      resetChain(player);
    }
  }

  if (player.fuel <= 0) {
    player.vel.x *= 0.992;
    player.vel.y *= 0.992;
  }

  if (wasRecovering) {
    const recoverRatio = player.recoveryDuration > 0
      ? player.recovering / player.recoveryDuration
      : 0;
    const recoverSpeed = tuning.dunkRecoveryMoveSpeed * (0.55 + 0.45 * recoverRatio);
    player.vel.x = player.recoveryDir.x * recoverSpeed;
    player.vel.y = player.recoveryDir.y * recoverSpeed;
    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;
    player.vel.x *= 0.98;
    player.vel.y *= 0.98;
  } else {
    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;
    const velocityDamping = player.helpless > 0 ? tuning.helplessVelocityDamping : tuning.playerVelocityDamping;
    player.vel.x *= velocityDamping;
    player.vel.y *= velocityDamping;
  }

  handleArenaBoundary(player);

  if (wasRecovering && player.recovering <= 0) {
    player.recoveryDuration = 0;
    player.recoveryDir = { x: 0, y: 0 };
    player.vel.x *= 0.35;
    player.vel.y *= 0.35;
  }

  if (previousHelpless > 0 && player.helpless <= 0) {
    if (player.lastLaunchedBy) {
      resetChain(state.players[player.lastLaunchedBy]);
      player.lastLaunchedBy = null;
    }
  }
}

function updateProjectiles(state: GameState, dt: number): void {
  for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = state.projectiles[i];
    projectile.life -= dt;
    projectile.pos.x += projectile.vel.x * dt;
    projectile.pos.y += projectile.vel.y * dt;

    const target = state.players[OPPONENT_BY_ID[projectile.ownerId]];
    if (distanceVec2(projectile.pos, target.pos) < target.radius + projectile.hitRadius && target.parry <= 0) {
      setStunned(target, projectile.stunSeconds);
      if (target.helpless <= 0) {
        target.fuel = Math.max(0, target.fuel - projectile.fuelDamage);
      }
      projectile.life = 0;
    }

    if (Math.hypot(projectile.pos.x, projectile.pos.y) > PROJECTILE_CULL_RADIUS) {
      projectile.life = 0;
    }

    if (projectile.life <= 0) {
      state.projectiles.splice(i, 1);
    }
  }
}

export function step(state: GameState, input: FrameInput, dt: number): GameState {
  state.gameTime += dt;

  if (!state.winner) {
    movement(state, input, 'P1', input.p1, dt);
    movement(state, input, 'P2', input.p2, dt);
  }

  updatePlayer(state, 'P1', dt);
  updatePlayer(state, 'P2', dt);
  updateProjectiles(state, dt);

  return state;
}

function getStatusText(state: GameState): string {
  if (state.winner) {
    return `${state.winner} executed the Rite-ending Dunk!`;
  }
  if (state.players.P1.helpless > 0 || state.players.P2.helpless > 0) {
    return STATUS_TEXT.launch;
  }
  return STATUS_TEXT.neutral;
}

export function getRenderSnapshot(state: GameState): RenderSnapshot {
  const p1RecoveryProgress = state.players.P1.recovering > 0 && state.players.P1.recoveryDuration > 0
    ? 1 - (state.players.P1.recovering / state.players.P1.recoveryDuration)
    : 0;
  const p2RecoveryProgress = state.players.P2.recovering > 0 && state.players.P2.recoveryDuration > 0
    ? 1 - (state.players.P2.recovering / state.players.P2.recoveryDuration)
    : 0;

  return {
    gameTime: state.gameTime,
    winner: state.winner,
    statusText: getStatusText(state),
    players: {
      P1: {
        id: 'P1',
        characterId: state.players.P1.characterId,
        pos: { x: state.players.P1.pos.x, y: state.players.P1.pos.y },
        maxFuel: state.players.P1.maxFuel,
        fuel: state.players.P1.fuel,
        launchBreaks: state.players.P1.launchBreaks,
        helpless: state.players.P1.helpless,
        parry: state.players.P1.parry,
        launchFlash: state.players.P1.launchFlash,
        parryFlash: state.players.P1.parryFlash,
        specialFlash: state.players.P1.specialFlash,
        breakFlash: state.players.P1.breakFlash,
        dunkFlash: state.players.P1.dunkFlash,
        recovering: state.players.P1.recovering,
        recoveryProgress: p1RecoveryProgress,
      },
      P2: {
        id: 'P2',
        characterId: state.players.P2.characterId,
        pos: { x: state.players.P2.pos.x, y: state.players.P2.pos.y },
        maxFuel: state.players.P2.maxFuel,
        fuel: state.players.P2.fuel,
        launchBreaks: state.players.P2.launchBreaks,
        helpless: state.players.P2.helpless,
        parry: state.players.P2.parry,
        launchFlash: state.players.P2.launchFlash,
        parryFlash: state.players.P2.parryFlash,
        specialFlash: state.players.P2.specialFlash,
        breakFlash: state.players.P2.breakFlash,
        dunkFlash: state.players.P2.dunkFlash,
        recovering: state.players.P2.recovering,
        recoveryProgress: p2RecoveryProgress,
      },
    },
    projectiles: state.projectiles.map((projectile) => ({
      id: projectile.id,
      ownerId: projectile.ownerId,
      visualId: projectile.visualId,
      pos: { x: projectile.pos.x, y: projectile.pos.y },
    })),
  };
}
