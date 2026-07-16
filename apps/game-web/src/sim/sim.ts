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
import { DEFAULT_CHARACTER_LOADOUT } from './characters';
import {
  cloneCharacterBalanceOverrides,
  resolveCharacterBalanceConfig,
  type CharacterBalanceConfig,
  type CharacterBalanceOverrides,
} from './characterBalance';
import { framesToSeconds, SIMULATION_FRAME_RATE_HZ } from './moveData';
import { nextRngState, rngStateToUnitFloat, sanitiseSeed } from './rng';
import { createDefaultTuning } from './tuning';
import type {
  Cooldowns,
  FrameInput,
  GameState,
  PlayerFrameInput,
  PlayerId,
  PlayerPresentationAction,
  PlayerPresentationPhase,
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
  characterBalanceOverrides?: CharacterBalanceOverrides;
}

export type SimulationAction = 'boost'
  | 'super_boost'
  | 'special'
  | 'launch'
  | 'dunk'
  | 'parry'
  | 'launch_break';

export interface SimulationActionStart {
  playerId: PlayerId;
  action: SimulationAction;
}

export type SimulationLaunchClashCause =
  | 'simultaneous_active'
  | 'global_startup_grace'
  | 'post_control_counter_launch';

export interface SimulationLaunchClash {
  cause: SimulationLaunchClashCause;
  gracePlayerId: PlayerId | null;
}

export interface SimulationStepObserver {
  onActionStart(event: SimulationActionStart): void;
  onLaunchClash?(event: SimulationLaunchClash): void;
}

interface LaunchAttemptFrameState {
  startup: number;
  active: number;
}

const POST_CONTROL_COUNTER_ACTION_WINDOW_SECONDS = 1;

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

function getCharacterStats(state: GameState, player: PlayerState) {
  return resolveCharacterBalanceConfig(player.characterId, state.characterBalanceOverrides).stats;
}

function getCharacterMoves(state: GameState, player: PlayerState) {
  return resolveCharacterBalanceConfig(player.characterId, state.characterBalanceOverrides).moves;
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
  player.postControlCounterLaunchEligible = false;
  if (player.postControlCounterWindow <= 0) {
    player.postControlCounterOpponentLaunchSerialAtReturn = 0;
  }
}

function clearPostControlCounterState(player: PlayerState): void {
  player.postControlCounterPending = false;
  player.postControlCounterWindow = 0;
  player.postControlCounterOpponentLaunchSerialAtReturn = 0;
  player.postControlCounterLaunchEligible = false;
}

function recordAcceptedActionStart(
  state: GameState,
  playerId: PlayerId,
  action: SimulationAction,
  observer?: SimulationStepObserver,
): void {
  const player = state.players[playerId];
  if (
    action !== 'launch_break'
    && state.tuning.postControlCounterLaunchClashGraceSeconds > 0
    && player.postControlCounterWindow > 0
  ) {
    player.postControlCounterLaunchEligible = action === 'launch';
    player.postControlCounterWindow = 0;
    if (action !== 'launch') {
      player.postControlCounterOpponentLaunchSerialAtReturn = 0;
    }
  }
  observer?.onActionStart({ playerId, action });
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

function createPlayer(
  id: PlayerId,
  characterId: CharacterId,
  spawnX: number,
  spawnY: number,
  balance: CharacterBalanceConfig,
): PlayerState {
  const maxFuel = Math.max(1, MAX_FUEL * balance.stats.fuelCapacityMultiplier);
  return {
    id,
    characterId,
    pos: { x: spawnX, y: spawnY },
    vel: { x: 0, y: 0 },
    boostActive: false,
    boostDir: { x: 0, y: 0 },
    boostHeldTime: 0,
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
    launchAttemptSerial: 0,
    postControlCounterPending: false,
    postControlCounterWindow: 0,
    postControlCounterOpponentLaunchSerialAtReturn: 0,
    postControlCounterLaunchEligible: false,
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
  const characterBalanceOverrides = cloneCharacterBalanceOverrides(options?.characterBalanceOverrides);

  return {
    loadout,
    characterBalanceOverrides,
    rules,
    seed,
    rngState: seed,
    players: {
      P1: createPlayer(
        'P1',
        loadout.P1,
        -30,
        6,
        resolveCharacterBalanceConfig(loadout.P1, characterBalanceOverrides),
      ),
      P2: createPlayer(
        'P2',
        loadout.P2,
        30,
        -6,
        resolveCharacterBalanceConfig(loadout.P2, characterBalanceOverrides),
      ),
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
    boostActive: player.boostActive ?? false,
    boostDir: player.boostDir ? cloneVec2(player.boostDir) : { x: 0, y: 0 },
    boostHeldTime: player.boostHeldTime ?? 0,
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
    launchAttemptSerial: player.launchAttemptSerial ?? 0,
    postControlCounterPending: player.postControlCounterPending ?? false,
    postControlCounterWindow: player.postControlCounterWindow ?? 0,
    postControlCounterOpponentLaunchSerialAtReturn:
      player.postControlCounterOpponentLaunchSerialAtReturn ?? 0,
    postControlCounterLaunchEligible: player.postControlCounterLaunchEligible ?? false,
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSerializableSnapshotValue(value: unknown, path: string): void {
  if (value === undefined) {
    throw new Error(`Invalid state snapshot: ${path} is undefined.`);
  }
  if (value === null) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid state snapshot: ${path} must be a finite number.`);
    }
    return;
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertSerializableSnapshotValue(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (isObjectRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertSerializableSnapshotValue(child, `${path}.${key}`);
    }
    return;
  }

  throw new Error(`Invalid state snapshot: ${path} has unsupported value type.`);
}

function assertSnapshotRootShape(snapshot: unknown): asserts snapshot is GameState {
  if (!isObjectRecord(snapshot)) {
    throw new Error('Invalid state snapshot: expected object payload.');
  }
  if (!isObjectRecord(snapshot.loadout)) {
    throw new Error('Invalid state snapshot: loadout is required.');
  }
  if (!isObjectRecord(snapshot.players)) {
    throw new Error('Invalid state snapshot: players is required.');
  }
  if (!isObjectRecord(snapshot.players.P1) || !isObjectRecord(snapshot.players.P2)) {
    throw new Error('Invalid state snapshot: players.P1 and players.P2 are required.');
  }
  if (!Array.isArray(snapshot.projectiles)) {
    throw new Error('Invalid state snapshot: projectiles must be an array.');
  }
  if (!isObjectRecord(snapshot.tuning)) {
    throw new Error('Invalid state snapshot: tuning is required.');
  }
}

export const STATE_SNAPSHOT_VERSION = 3;
const LEGACY_STATE_SNAPSHOT_VERSIONS = [1, 2] as const;

interface GameStateSnapshotEnvelope {
  version: number;
  state: GameState;
}

export function createStateSnapshot(state: GameState): GameState {
  return {
    loadout: {
      P1: state.loadout.P1,
      P2: state.loadout.P2,
    },
    characterBalanceOverrides: cloneCharacterBalanceOverrides(state.characterBalanceOverrides),
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
  assertSnapshotRootShape(snapshot);
  let cloned: GameState;
  try {
    cloned = createStateSnapshot(snapshot);
  } catch {
    throw new Error('Invalid state snapshot: failed to clone payload.');
  }
  assertSerializableSnapshotValue(cloned, 'snapshot');
  cloned.tuning = {
    ...createDefaultTuning(),
    ...cloned.tuning,
  };
  return cloned;
}

export function serialiseState(state: GameState): string {
  const snapshot = createStateSnapshot(state);
  assertSerializableSnapshotValue(snapshot, 'snapshot');
  const payload: GameStateSnapshotEnvelope = {
    version: STATE_SNAPSHOT_VERSION,
    state: snapshot,
  };
  return JSON.stringify(payload);
}

export function deserialiseState(serialised: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialised) as unknown;
  } catch {
    throw new Error('Invalid state snapshot: payload is not valid JSON.');
  }

  if (isObjectRecord(parsed) && 'version' in parsed && 'state' in parsed) {
    const version = Number(parsed.version);
    if (
      !Number.isFinite(version)
      || (
        version !== STATE_SNAPSHOT_VERSION
        && !LEGACY_STATE_SNAPSHOT_VERSIONS.includes(version as 1 | 2)
      )
    ) {
      throw new Error(
        `Unsupported state snapshot version: ${String(parsed.version)}. Expected ${STATE_SNAPSHOT_VERSION} (legacy ${LEGACY_STATE_SNAPSHOT_VERSIONS.join(', ')} are also readable).`,
      );
    }
    return restoreStateFromSnapshot(parsed.state as GameState);
  }

  // Legacy compatibility for direct GameState JSON payloads.
  return restoreStateFromSnapshot(parsed as GameState);
}

function resolveLaunchConnection(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  targetInput: PlayerFrameInput,
): boolean {
  const tuning = state.tuning;
  const attackerStats = getCharacterStats(state, attacker);
  const targetStats = getCharacterStats(state, target);
  const targetMoves = getCharacterMoves(state, target);
  const deltaX = target.pos.x - attacker.pos.x;
  const deltaY = target.pos.y - attacker.pos.y;

  if (target.parry > 0) {
    setStunned(attacker, framesToSeconds(targetMoves.parry.counterStunFrames));
    target.parry = 0;
    applyDefensiveReset(state, target, attacker);
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
  if (tuning.postControlCounterLaunchClashGraceSeconds > 0) {
    clearPostControlCounterState(target);
    target.postControlCounterPending = true;
  }
  attacker.launchFlash = LAUNCH_FLASH_SECONDS;
  target.launchFlash = LAUNCH_FLASH_SECONDS;

  attacker.chain += 1;
  attacker.chainTimer = tuning.chainWindowSeconds;
  return true;
}

function resolveLaunchClash(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  cause: SimulationLaunchClashCause,
  observer?: SimulationStepObserver,
): void {
  const deltaX = target.pos.x - attacker.pos.x;
  const deltaY = target.pos.y - attacker.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const fallbackDir = normalise(target.vel.x - attacker.vel.x, target.vel.y - attacker.vel.y);
  const dir = distance > 0.001
    ? { x: deltaX / distance, y: deltaY / distance }
    : (Math.hypot(fallbackDir.x, fallbackDir.y) > 0 ? fallbackDir : { x: 1, y: 0 });
  const midpoint = {
    x: (attacker.pos.x + target.pos.x) * 0.5,
    y: (attacker.pos.y + target.pos.y) * 0.5,
  };
  const clashDistance = Math.max(
    attacker.radius + target.radius + state.tuning.launchClashSeparationPadding,
    distance + 6,
  );
  const clashImpulse = state.tuning.launchBasePower * state.tuning.launchClashRecoilMultiplier;
  const attackerRecovery = framesToSeconds(getCharacterMoves(state, attacker).launch.recoveryOnWhiffFrames) * 0.55;
  const targetRecovery = framesToSeconds(getCharacterMoves(state, target).launch.recoveryOnWhiffFrames) * 0.55;

  attacker.pos.x = midpoint.x - dir.x * clashDistance * 0.5;
  attacker.pos.y = midpoint.y - dir.y * clashDistance * 0.5;
  target.pos.x = midpoint.x + dir.x * clashDistance * 0.5;
  target.pos.y = midpoint.y + dir.y * clashDistance * 0.5;

  attacker.vel.x = -dir.x * clashImpulse;
  attacker.vel.y = -dir.y * clashImpulse;
  target.vel.x = dir.x * clashImpulse;
  target.vel.y = dir.y * clashImpulse;

  attacker.launchFlash = LAUNCH_FLASH_SECONDS;
  target.launchFlash = LAUNCH_FLASH_SECONDS;
  attacker.endLag = Math.max(attacker.endLag, attackerRecovery);
  target.endLag = Math.max(target.endLag, targetRecovery);
  attacker.cool.launch = Math.max(attacker.cool.launch, attackerRecovery);
  target.cool.launch = Math.max(target.cool.launch, targetRecovery);

  clearLaunchAttempt(attacker);
  clearLaunchAttempt(target);
  resetChain(attacker);
  resetChain(target);
  observer?.onLaunchClash?.({
    cause,
    gracePlayerId: cause === 'post_control_counter_launch' ? target.id : null,
  });
}

function startLaunchAttempt(state: GameState, player: PlayerState): boolean {
  const launchFrameData = getCharacterMoves(state, player).launch;
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
    return false;
  }
  player.launchStartup = framesToSeconds(launchFrameData.startupFrames);
  player.launchActive = player.launchStartup > 0 ? 0 : framesToSeconds(launchFrameData.activeFrames);
  player.launchDidConnect = false;
  player.postControlCounterLaunchEligible = false;
  if (state.tuning.postControlCounterLaunchClashGraceSeconds > 0) {
    player.launchAttemptSerial += 1;
  }
  const startupAndActiveSeconds = framesToSeconds(
    launchFrameData.startupFrames + launchFrameData.activeFrames,
  );
  player.cool.launch = Math.max(player.cool.launch, startupAndActiveSeconds);
  return true;
}

function hasAttackCommitment(player: PlayerState): boolean {
  return player.launchStartup > 0
    || player.launchActive > 0
    || player.dunkStartup > 0
    || player.dunkActive > 0
    || player.specialStartup > 0
    || player.specialActive > 0;
}

function startParryAttempt(
  state: GameState,
  playerId: PlayerId,
  input: PlayerFrameInput,
  observer?: SimulationStepObserver,
): boolean {
  const player = state.players[playerId];
  if (
    state.winner
    || !input.parry
    || player.parry > 0
    || player.endLag > 0
    || player.recovering > 0
    || player.stunned > 0
    || player.helpless > 0
    || hasAttackCommitment(player)
  ) {
    return false;
  }
  const parryMove = getCharacterMoves(state, player).parry;
  player.parry = framesToSeconds(parryMove.activeFrames);
  player.parryFlash = PARRY_FLASH_SECONDS;
  player.endLag = Math.max(player.endLag, framesToSeconds(parryMove.recoveryFrames));
  recordAcceptedActionStart(state, playerId, 'parry', observer);
  return true;
}

function advanceLaunchAttempt(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  targetInput: PlayerFrameInput,
  targetFrameStart: LaunchAttemptFrameState,
  dt: number,
  observer?: SimulationStepObserver,
): void {
  const launchFrameData = getCharacterMoves(state, attacker).launch;

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
    let clashCause: SimulationLaunchClashCause | null = null;
    if (targetFrameStart.active > 0) {
      clashCause = 'simultaneous_active';
    } else if (
      state.tuning.startupClashGraceSeconds > 0
      && targetFrameStart.startup > 0
      && targetFrameStart.startup <= state.tuning.startupClashGraceSeconds
    ) {
      clashCause = 'global_startup_grace';
    } else if (
      state.tuning.postControlCounterLaunchClashGraceSeconds > 0
      && target.postControlCounterLaunchEligible
      && targetFrameStart.startup > 0
      && targetFrameStart.startup <= state.tuning.postControlCounterLaunchClashGraceSeconds
      && attacker.launchAttemptSerial > target.postControlCounterOpponentLaunchSerialAtReturn
    ) {
      clashCause = 'post_control_counter_launch';
    }
    if (clashCause) {
      resolveLaunchClash(state, attacker, target, clashCause, observer);
      return;
    }
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
  const targetStats = getCharacterStats(state, target);
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
  clearBoostState(target);
  target.vel.x = recoveryDir.x * tuning.dunkRecoveryMoveSpeed;
  target.vel.y = recoveryDir.y * tuning.dunkRecoveryMoveSpeed;
  target.lastLaunchedBy = null;
  clearPostControlCounterState(target);
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

function startDunkAttempt(state: GameState, player: PlayerState): boolean {
  const dunkFrameData = getCharacterMoves(state, player).dunk;
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
    return false;
  }

  player.dunkStartup = framesToSeconds(dunkFrameData.startupFrames);
  player.dunkActive = player.dunkStartup > 0 ? 0 : framesToSeconds(dunkFrameData.activeFrames);
  player.dunkDidConnect = false;
  player.dunkFlash = DUNK_FLASH_SECONDS;
  const startupAndActiveSeconds = framesToSeconds(dunkFrameData.startupFrames + dunkFrameData.activeFrames);
  player.cool.dunk = Math.max(player.cool.dunk, startupAndActiveSeconds);
  return true;
}

function advanceDunkAttempt(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  dt: number,
): void {
  const dunkFrameData = getCharacterMoves(state, attacker).dunk;

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
  const projectileMove = getCharacterMoves(state, attacker).special.projectile;
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
  const specialMove = getCharacterMoves(state, attacker).special;
  switch (specialMove.behaviorId) {
    case 'special.projectile.v1':
      return spawnSpecialProjectile(state, attacker, target);
    case 'special.command_grab.v1': {
      const inRange = distanceVec2(attacker.pos, target.pos) <= specialMove.size.range;
      if (!inRange || !specialMove.commandGrab) {
        return false;
      }
      setStunned(target, framesToSeconds(specialMove.commandGrab.stunFrames));
      return true;
    }
    case 'special.movement_dash.v1': {
      const moveData = specialMove.movement;
      if (!moveData) {
        return false;
      }
      const dir = normalise(target.pos.x - attacker.pos.x, target.pos.y - attacker.pos.y);
      attacker.vel.x = dir.x * moveData.dashSpeed;
      attacker.vel.y = dir.y * moveData.dashSpeed;
      return true;
    }
    case 'special.block_guard.v1': {
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

function startSpecialAttempt(state: GameState, player: PlayerState): boolean {
  const playerStats = getCharacterStats(state, player);
  const specialMove = getCharacterMoves(state, player).special;
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
    return false;
  }
  if (!tryConsumeFuel(player, specialMove.fuelCost * playerStats.specialFuelCostMultiplier)) {
    return false;
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
  return true;
}

function advanceSpecialAttempt(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  dt: number,
): void {
  const specialMove = getCharacterMoves(state, attacker).special;

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

function clearBoostState(player: PlayerState): void {
  player.boostActive = false;
  player.boostHeldTime = 0;
  player.boostDir = { x: 0, y: 0 };
}

function applyDunkStartupPursuit(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  dt: number,
): void {
  if (attacker.dunkStartup <= 0 || target.helpless <= 0) {
    return;
  }

  const dunkFrameData = getCharacterMoves(state, attacker).dunk;
  if (dunkFrameData.startupPursuitSpeed <= 0 || dunkFrameData.startupTracking <= 0) {
    return;
  }

  const leadSeconds = Math.min(attacker.dunkStartup, 0.18);
  const aimX = target.pos.x + target.vel.x * leadSeconds - attacker.pos.x;
  const aimY = target.pos.y + target.vel.y * leadSeconds - attacker.pos.y;
  const pursuitDirection = normalise(aimX, aimY);
  if (pursuitDirection.x === 0 && pursuitDirection.y === 0) {
    return;
  }

  const currentSpeed = Math.hypot(attacker.vel.x, attacker.vel.y);
  const pursuitSpeed = Math.max(
    dunkFrameData.startupPursuitSpeed,
    Math.min(currentSpeed, dunkFrameData.startupPursuitSpeed * 1.25),
  );
  const frameEquivalent = Math.max(0, dt * SIMULATION_FRAME_RATE_HZ);
  const trackingBlend = 1 - Math.pow(1 - clamp(dunkFrameData.startupTracking, 0, 1), frameEquivalent);
  attacker.vel.x = lerp(attacker.vel.x, pursuitDirection.x * pursuitSpeed, trackingBlend);
  attacker.vel.y = lerp(attacker.vel.y, pursuitDirection.y * pursuitSpeed, trackingBlend);
}

function resolveCommittedBoostDirection(
  player: PlayerState,
  target: PlayerState,
  playerInput: PlayerFrameInput,
): Vec2 {
  const toTarget = normalise(target.pos.x - player.pos.x, target.pos.y - player.pos.y);
  if (Math.hypot(toTarget.x, toTarget.y) > 0) {
    return toTarget;
  }
  const inputDir = normalise(playerInput.moveX, playerInput.moveY);
  if (Math.hypot(inputDir.x, inputDir.y) > 0) {
    return inputDir;
  }
  const velocityDir = normalise(player.vel.x, player.vel.y);
  if (Math.hypot(velocityDir.x, velocityDir.y) > 0) {
    return velocityDir;
  }
  return player.id === 'P1' ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

function startCommittedBoost(
  player: PlayerState,
  target: PlayerState,
  playerInput: PlayerFrameInput,
): boolean {
  if (player.boostActive || player.cool.boost > 0) {
    return false;
  }
  player.boostActive = true;
  player.boostHeldTime = 0;
  player.boostDir = resolveCommittedBoostDirection(player, target, playerInput);
  return true;
}

function finishCommittedBoost(player: PlayerState, interrupted = false): void {
  if (!player.boostActive) {
    return;
  }
  const heldRatio = clamp(player.boostHeldTime / 0.38, 0, 1);
  const recovery = interrupted
    ? 0.1
    : lerp(0.14, 0.34, heldRatio);
  player.cool.boost = Math.max(player.cool.boost, recovery);
  clearBoostState(player);
}

function applyBoostHold(player: PlayerState, speed: number, controlMultiplier = 1): void {
  if (player.helpless > 0) {
    return;
  }
  const blend = clamp(controlMultiplier, 0, 1);
  player.vel.x = lerp(player.vel.x, player.boostDir.x * speed, blend);
  player.vel.y = lerp(player.vel.y, player.boostDir.y * speed, blend);
}

function resolveHelplessReleaseSpeed(player: PlayerState, state: GameState): number {
  const stats = getCharacterStats(state, player);
  const moves = getCharacterMoves(state, player);
  return tuningAwareBoostSpeed(state)
    * stats.boostSpeedMultiplier
    * moves.boost.holdSpeedMultiplier
    * state.tuning.helplessReleaseSpeedRatio;
}

function tuningAwareBoostSpeed(state: GameState): number {
  return state.tuning.boostHoldSpeed;
}

function startSuperBoost(state: GameState, player: PlayerState, playerInput: PlayerFrameInput): boolean {
  const tuning = state.tuning;
  const playerStats = getCharacterStats(state, player);
  const superBoostMove = getCharacterMoves(state, player).superBoost;
  if (player.superBoost > 0 || player.helpless > 0 || player.endLag > 0) {
    return false;
  }
  const inputLengthSq = playerInput.moveX * playerInput.moveX + playerInput.moveY * playerInput.moveY;
  if (inputLengthSq <= 0) {
    return false;
  }
  if (!tryConsumeFuel(player, superBoostMove.startFuelCost * tuning.superBoostFuelMultiplier * playerStats.superFuelMultiplier)) {
    return false;
  }

  player.superBoost = 1;
  player.superTime = 0;
  player.superDistance = 0;
  player.superTurnPenalty = 0;
  player.superDir = normalise(playerInput.moveX, playerInput.moveY);
  player.didCommitAttackDuringSuperBoost = false;
  return true;
}

function finishSuperBoost(state: GameState, player: PlayerState): void {
  const tuning = state.tuning;
  const playerStats = getCharacterStats(state, player);
  const superBoostMove = getCharacterMoves(state, player).superBoost;
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

function tryLaunchBreak(
  state: GameState,
  playerId: PlayerId,
  playerInput: PlayerFrameInput,
  observer?: SimulationStepObserver,
): boolean {
  const player = state.players[playerId];
  if (state.winner || !playerInput.breakLaunch || player.helpless <= 0 || player.launchBreaks <= 0) {
    return false;
  }

  const breakMove = getCharacterMoves(state, player).break;
  player.launchBreaks -= 1;
  player.helpless = 0;
  player.breakFlash = BREAK_FLASH_SECONDS;
  setStunned(player, framesToSeconds(breakMove.recoveryFrames));
  player.vel.x *= breakMove.velocityRetain;
  player.vel.y *= breakMove.velocityRetain;
  if (player.lastLaunchedBy) {
    const attacker = state.players[player.lastLaunchedBy];
    resetChain(attacker);
    applyDefensiveReset(state, player, attacker, state.tuning.launchBreakResetMultiplier);
    player.lastLaunchedBy = null;
  }
  recordAcceptedActionStart(state, playerId, 'launch_break', observer);
  return true;
}

function advanceCommittedSpecial(
  state: GameState,
  playerId: PlayerId,
  dt: number,
): void {
  const player = state.players[playerId];
  const target = state.players[OPPONENT_BY_ID[playerId]];
  advanceSpecialAttempt(state, player, target, dt);
}

function advanceCommittedLaunch(
  state: GameState,
  frameInput: FrameInput,
  playerId: PlayerId,
  targetFrameStart: LaunchAttemptFrameState,
  dt: number,
  observer?: SimulationStepObserver,
): void {
  const player = state.players[playerId];
  const target = state.players[OPPONENT_BY_ID[playerId]];
  const targetInput = playerId === 'P1' ? frameInput.p2 : frameInput.p1;
  advanceLaunchAttempt(state, player, target, targetInput, targetFrameStart, dt, observer);
}

function advanceCommittedDunk(
  state: GameState,
  playerId: PlayerId,
  dt: number,
): void {
  const player = state.players[playerId];
  const target = state.players[OPPONENT_BY_ID[playerId]];
  advanceDunkAttempt(state, player, target, dt);
}

function movement(
  state: GameState,
  playerId: PlayerId,
  playerInput: PlayerFrameInput,
  dt: number,
  observer?: SimulationStepObserver,
): void {
  const tuning = state.tuning;
  const player = state.players[playerId];
  const playerStats = getCharacterStats(state, player);
  const playerMoves = getCharacterMoves(state, player);
  const target = state.players[OPPONENT_BY_ID[playerId]];

  if (player.recovering > 0 || player.stunned > 0 || player.helpless > 0 || state.winner) {
    finishCommittedBoost(player, true);
    return;
  }

  if (playerInput.special) {
    if (startSpecialAttempt(state, player)) {
      player.didCommitAttackDuringSuperBoost ||= player.superBoost > 0;
      recordAcceptedActionStart(state, playerId, 'special', observer);
      if (player.specialStartup <= 0 && player.specialActive > 0 && !player.specialDidResolve) {
        advanceSpecialAttempt(state, player, target, 0);
      }
    }
  }
  if (playerInput.launch && startLaunchAttempt(state, player)) {
    player.didCommitAttackDuringSuperBoost ||= player.superBoost > 0;
    recordAcceptedActionStart(state, playerId, 'launch', observer);
  }
  if (playerInput.dunk && startDunkAttempt(state, player)) {
    player.didCommitAttackDuringSuperBoost ||= player.superBoost > 0;
    recordAcceptedActionStart(state, playerId, 'dunk', observer);
  }
  const actionRecoveryControlMultiplier = player.endLag > 0
    ? tuning.actionRecoveryControlMultiplier
    : 1;
  const boostHeld = playerInput.boost && player.superBoost <= 0 && (
    playerMoves.boost.holdFuelPerSecond <= 0 || player.fuel > 0
  ) && actionRecoveryControlMultiplier > 0;
  if (boostHeld && !player.boostActive) {
    if (startCommittedBoost(player, target, playerInput)) {
      recordAcceptedActionStart(state, playerId, 'boost', observer);
    }
  } else if (!boostHeld) {
    finishCommittedBoost(player);
  }
  if (player.boostActive) {
    player.boostHeldTime += dt;
    applyBoostHold(
      player,
      tuning.boostHoldSpeed
      * playerStats.boostSpeedMultiplier
      * playerMoves.boost.holdSpeedMultiplier,
      actionRecoveryControlMultiplier,
    );
    if (playerMoves.boost.holdFuelPerSecond > 0) {
      player.fuel = Math.max(0, player.fuel - dt * playerMoves.boost.holdFuelPerSecond);
    }
  }
  if (playerInput.superBoost) {
    finishCommittedBoost(player, true);
    if (player.superBoost <= 0) {
      if (startSuperBoost(state, player, playerInput)) {
        recordAcceptedActionStart(state, playerId, 'super_boost', observer);
      }
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
    player.vel.x += moveDir.x * tuning.playerMoveAccel * playerStats.moveAccelMultiplier
      * actionRecoveryControlMultiplier * dt;
    player.vel.y += moveDir.y * tuning.playerMoveAccel * playerStats.moveAccelMultiplier
      * actionRecoveryControlMultiplier * dt;
    player.fuel = Math.max(0, player.fuel - dt * playerMoves.movement.fuelPerSecond);
  } else if (!boostHeld && player.superBoost <= 0) {
    // Extra controllable braking reduces slide when movement input is released.
    const controllableBrake = lerp(1, 0.86, actionRecoveryControlMultiplier);
    player.vel.x *= controllableBrake;
    player.vel.y *= controllableBrake;
  }

  if (player.superBoost > 0) {
    const superBoostMove = playerMoves.superBoost;
    player.superTime += dt;

    const desired = moveInputLengthSq > 0
      ? normalise(playerInput.moveX, playerInput.moveY)
      : { x: player.superDir.x, y: player.superDir.y };

    const turn = 1 - clamp(player.superDir.x * desired.x + player.superDir.y * desired.y, -1, 1);
    player.superTurnPenalty += turn * dt * 3 * superBoostMove.turnPenaltyGainMultiplier;

    const steerLerp = clamp(
      tuning.superBoostSteerLerp
        * superBoostMove.steerLerpMultiplier
        * actionRecoveryControlMultiplier,
      0,
      1,
    );
    const lerpedX = lerp(player.superDir.x, desired.x, steerLerp);
    const lerpedY = lerp(player.superDir.y, desired.y, steerLerp);
    player.superDir = normalise(lerpedX, lerpedY);

    const superSpeed = tuning.superBoostHoldSpeed
      * playerStats.superBoostSpeedMultiplier
      * superBoostMove.holdSpeedMultiplier;
    const stepX = player.superDir.x * superSpeed;
    const stepY = player.superDir.y * superSpeed;
    const velocityBlend = clamp(
      tuning.superBoostVelocityBlend
        * superBoostMove.velocityBlendMultiplier
        * actionRecoveryControlMultiplier,
      0,
      1,
    );
    player.vel.x = lerp(player.vel.x, stepX, velocityBlend);
    player.vel.y = lerp(player.vel.y, stepY, velocityBlend);
    player.superDistance += Math.hypot(stepX, stepY) * dt;
  }

  applyDunkStartupPursuit(state, player, target, dt);
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

function updatePlayer(state: GameState, playerId: PlayerId, dt: number): PlayerId | null {
  const player = state.players[playerId];
  const tuning = state.tuning;
  const previousHelpless = player.helpless;
  const wasRecovering = player.recovering > 0;
  const wasWithoutControl = player.helpless > 0 || player.stunned > 0 || player.recovering > 0;
  const hadPostControlCounterWindow = player.postControlCounterWindow > 0;

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
  if (hadPostControlCounterWindow) {
    player.postControlCounterWindow = Math.max(0, player.postControlCounterWindow - dt);
    if (player.postControlCounterWindow <= 0) {
      player.postControlCounterOpponentLaunchSerialAtReturn = 0;
    }
  }

  player.cool.special = Math.max(0, player.cool.special - dt);
  player.cool.launch = Math.max(0, player.cool.launch - dt);
  player.cool.dunk = Math.max(0, player.cool.dunk - dt);
  player.cool.boost = Math.max(0, player.cool.boost - dt);

  if (player.helpless > 0 || player.recovering > 0 || player.stunned > 0) {
    clearBoostState(player);
  }

  if (player.helpless > 0) {
    const helplessSpeed = Math.hypot(player.vel.x, player.vel.y);
    const releaseSpeed = resolveHelplessReleaseSpeed(player, state);
    if (helplessSpeed <= releaseSpeed) {
      player.helpless = 0;
    }
  }

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

  const hasControl = player.helpless <= 0 && player.stunned <= 0 && player.recovering <= 0;
  if (
    tuning.postControlCounterLaunchClashGraceSeconds > 0
    && player.postControlCounterPending
    && wasWithoutControl
    && hasControl
  ) {
    player.postControlCounterPending = false;
    player.postControlCounterWindow = POST_CONTROL_COUNTER_ACTION_WINDOW_SECONDS;
    player.postControlCounterOpponentLaunchSerialAtReturn =
      state.players[OPPONENT_BY_ID[playerId]].launchAttemptSerial;
  }

  return previousHelpless > 0 && player.helpless <= 0
    ? player.lastLaunchedBy
    : null;
}

function resolveCloseRangeSeparation(state: GameState): void {
  const p1 = state.players.P1;
  const p2 = state.players.P2;
  if (state.winner || p1.recovering > 0 || p2.recovering > 0) {
    return;
  }
  if (p1.helpless > 0 || p2.helpless > 0) {
    return;
  }
  const p1InCommit = p1.parry > 0
    || p1.launchStartup > 0
    || p1.launchActive > 0
    || p1.dunkStartup > 0
    || p1.dunkActive > 0
    || p1.specialStartup > 0
    || p1.specialActive > 0;
  const p2InCommit = p2.parry > 0
    || p2.launchStartup > 0
    || p2.launchActive > 0
    || p2.dunkStartup > 0
    || p2.dunkActive > 0
    || p2.specialStartup > 0
    || p2.specialActive > 0;
  const responseMultiplier = p1InCommit || p2InCommit
    ? state.tuning.closeRangeCommitSeparationMultiplier
    : 1;
  if (responseMultiplier <= 0) {
    return;
  }

  const dx = p2.pos.x - p1.pos.x;
  const dy = p2.pos.y - p1.pos.y;
  const distance = Math.hypot(dx, dy);
  const minimumDistance = p1.radius
    + p2.radius
    + state.tuning.closeRangeSeparationPadding * responseMultiplier;
  if (distance >= minimumDistance) {
    return;
  }

  const dir = distance > 0.001 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
  const overlap = minimumDistance - distance;
  const separation = overlap * 0.5;

  p1.pos.x -= dir.x * separation;
  p1.pos.y -= dir.y * separation;
  p2.pos.x += dir.x * separation;
  p2.pos.y += dir.y * separation;

  const impulse = (state.tuning.closeRangeSeparationImpulse + overlap * 2.2) * responseMultiplier;
  p1.vel.x -= dir.x * impulse;
  p1.vel.y -= dir.y * impulse;
  p2.vel.x += dir.x * impulse;
  p2.vel.y += dir.y * impulse;
}

function applyDefensiveReset(
  state: GameState,
  defender: PlayerState,
  attacker: PlayerState,
  multiplier = 1,
): void {
  const minimumDistance = state.tuning.defensiveResetDistance * multiplier;
  const impulse = state.tuning.defensiveResetImpulse * multiplier;
  if (minimumDistance <= 0 && impulse <= 0) {
    return;
  }

  const dx = attacker.pos.x - defender.pos.x;
  const dy = attacker.pos.y - defender.pos.y;
  const distance = Math.hypot(dx, dy);
  const fallbackDirection = defender.id === 'P1' ? { x: 1, y: 0 } : { x: -1, y: 0 };
  const dir = distance > 0.001 ? { x: dx / distance, y: dy / distance } : fallbackDirection;

  if (minimumDistance > 0 && distance < minimumDistance) {
    const midpointX = (defender.pos.x + attacker.pos.x) * 0.5;
    const midpointY = (defender.pos.y + attacker.pos.y) * 0.5;
    defender.pos.x = midpointX - dir.x * minimumDistance * 0.5;
    defender.pos.y = midpointY - dir.y * minimumDistance * 0.5;
    attacker.pos.x = midpointX + dir.x * minimumDistance * 0.5;
    attacker.pos.y = midpointY + dir.y * minimumDistance * 0.5;
  }

  defender.vel.x -= dir.x * impulse;
  defender.vel.y -= dir.y * impulse;
  attacker.vel.x += dir.x * impulse;
  attacker.vel.y += dir.y * impulse;
}

function resolveNaturalControlReturns(
  state: GameState,
  launchedBy: PlayersById<PlayerId | null>,
): void {
  const globalMultiplier = state.tuning.naturalRecoveryResetMultiplier;
  let resetApplied = false;

  for (const playerId of ['P1', 'P2'] as const) {
    const attackerId = launchedBy[playerId];
    if (!attackerId) {
      continue;
    }

    const defender = state.players[playerId];
    const attacker = state.players[attackerId];
    const characterMultiplier = getCharacterStats(state, defender).naturalRecoveryResetMultiplier;
    const multiplier = globalMultiplier * characterMultiplier;
    const minimumDistance = state.tuning.defensiveResetDistance * multiplier;
    resetChain(attacker);

    if (
      !resetApplied
      && minimumDistance > 0
      && defender.fuel >= defender.maxFuel * 0.2
      && distanceVec2(defender.pos, attacker.pos) < minimumDistance
    ) {
      applyDefensiveReset(state, defender, attacker, multiplier);
      resetApplied = true;
    }

    defender.lastLaunchedBy = null;
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

export function step(
  state: GameState,
  input: FrameInput,
  dt: number,
  observer?: SimulationStepObserver,
): GameState {
  state.gameTime += dt;

  if (!state.winner) {
    startParryAttempt(state, 'P1', input.p1, observer);
    startParryAttempt(state, 'P2', input.p2, observer);
    const launchFrameStart: PlayersById<LaunchAttemptFrameState> = {
      P1: {
        startup: state.players.P1.launchStartup,
        active: state.players.P1.launchActive,
      },
      P2: {
        startup: state.players.P2.launchStartup,
        active: state.players.P2.launchActive,
      },
    };
    const p1BrokeLaunch = tryLaunchBreak(state, 'P1', input.p1, observer);
    const p2BrokeLaunch = tryLaunchBreak(state, 'P2', input.p2, observer);
    if (!p1BrokeLaunch) {
      advanceCommittedSpecial(state, 'P1', dt);
    }
    if (!p2BrokeLaunch) {
      advanceCommittedSpecial(state, 'P2', dt);
    }
    if (!p1BrokeLaunch) {
      advanceCommittedLaunch(state, input, 'P1', launchFrameStart.P2, dt, observer);
    }
    if (!p2BrokeLaunch) {
      advanceCommittedLaunch(state, input, 'P2', launchFrameStart.P1, dt, observer);
    }
    if (!p1BrokeLaunch) {
      advanceCommittedDunk(state, 'P1', dt);
    }
    if (!p2BrokeLaunch) {
      advanceCommittedDunk(state, 'P2', dt);
    }
    if (!p1BrokeLaunch) {
      movement(state, 'P1', input.p1, dt, observer);
    }
    if (!p2BrokeLaunch) {
      movement(state, 'P2', input.p2, dt, observer);
    }
  }

  const naturalControlReturns: PlayersById<PlayerId | null> = {
    P1: updatePlayer(state, 'P1', dt),
    P2: updatePlayer(state, 'P2', dt),
  };
  resolveNaturalControlReturns(state, naturalControlReturns);
  resolveCloseRangeSeparation(state);
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

function getPlayerPresentationState(player: PlayerState): {
  presentationAction: PlayerPresentationAction;
  presentationPhase: PlayerPresentationPhase;
} {
  if (player.recovering > 0) {
    return { presentationAction: 'recover', presentationPhase: 'recovery' };
  }
  if (player.helpless > 0) {
    return { presentationAction: 'helpless', presentationPhase: 'sustain' };
  }
  if (player.dunkStartup > 0) {
    return { presentationAction: 'dunk', presentationPhase: 'startup' };
  }
  if (player.dunkActive > 0) {
    return { presentationAction: 'dunk', presentationPhase: 'active' };
  }
  if (player.launchStartup > 0) {
    return { presentationAction: 'launch', presentationPhase: 'startup' };
  }
  if (player.launchActive > 0) {
    return { presentationAction: 'launch', presentationPhase: 'active' };
  }
  if (player.specialStartup > 0) {
    return { presentationAction: 'special', presentationPhase: 'startup' };
  }
  if (player.specialActive > 0) {
    return { presentationAction: 'special', presentationPhase: 'active' };
  }
  if (player.parry > 0) {
    return { presentationAction: 'parry', presentationPhase: 'active' };
  }
  if (player.breakFlash > 0) {
    return { presentationAction: 'break', presentationPhase: 'active' };
  }
  if (player.superBoost > 0 || player.boostActive) {
    return { presentationAction: 'boost', presentationPhase: 'sustain' };
  }
  return { presentationAction: 'idle', presentationPhase: 'none' };
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
        boostActive: state.players.P1.boostActive,
        superBoost: state.players.P1.superBoost,
        helpless: state.players.P1.helpless,
        parry: state.players.P1.parry,
        launchFlash: state.players.P1.launchFlash,
        parryFlash: state.players.P1.parryFlash,
        specialFlash: state.players.P1.specialFlash,
        breakFlash: state.players.P1.breakFlash,
        dunkFlash: state.players.P1.dunkFlash,
        recovering: state.players.P1.recovering,
        recoveryProgress: p1RecoveryProgress,
        ...getPlayerPresentationState(state.players.P1),
      },
      P2: {
        id: 'P2',
        characterId: state.players.P2.characterId,
        pos: { x: state.players.P2.pos.x, y: state.players.P2.pos.y },
        maxFuel: state.players.P2.maxFuel,
        fuel: state.players.P2.fuel,
        launchBreaks: state.players.P2.launchBreaks,
        boostActive: state.players.P2.boostActive,
        superBoost: state.players.P2.superBoost,
        helpless: state.players.P2.helpless,
        parry: state.players.P2.parry,
        launchFlash: state.players.P2.launchFlash,
        parryFlash: state.players.P2.parryFlash,
        specialFlash: state.players.P2.specialFlash,
        breakFlash: state.players.P2.breakFlash,
        dunkFlash: state.players.P2.dunkFlash,
        recovering: state.players.P2.recovering,
        recoveryProgress: p2RecoveryProgress,
        ...getPlayerPresentationState(state.players.P2),
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
