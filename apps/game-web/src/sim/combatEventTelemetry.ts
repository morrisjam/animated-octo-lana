import { CHARACTER_BY_ID, type CharacterId } from './characters';
import type {
  FrameInput,
  GameState,
  PlayerFrameInput,
  PlayerId,
  PlayerState,
  PlayersById,
  ProjectileState,
} from './types';
import type {
  SimulationAction,
  SimulationActionStart,
  SimulationLaunchClash,
  SimulationLaunchClashCause,
} from './sim';

export const LEGACY_COMBAT_EVENT_SCHEMA_VERSION = 'gw.combat-events.v2';
export const INTERMEDIATE_COMBAT_EVENT_SCHEMA_VERSION = 'gw.combat-events.v3';
export const HISTORICAL_COMBAT_EVENT_SCHEMA_VERSION = 'gw.combat-events.v4';
export const PREVIOUS_COMBAT_EVENT_SCHEMA_VERSION = 'gw.combat-events.v5';
export const COMBAT_EVENT_SCHEMA_VERSION = 'gw.combat-events.v6';

export type CombatEventSchemaVersion =
  | typeof LEGACY_COMBAT_EVENT_SCHEMA_VERSION
  | typeof INTERMEDIATE_COMBAT_EVENT_SCHEMA_VERSION
  | typeof HISTORICAL_COMBAT_EVENT_SCHEMA_VERSION
  | typeof PREVIOUS_COMBAT_EVENT_SCHEMA_VERSION
  | typeof COMBAT_EVENT_SCHEMA_VERSION;

export const COMBAT_EVENT_TYPES = [
  'action_press',
  'action_start',
  'launch_hit',
  'launch_clash',
  'parry_success',
  'launch_break',
  'control_return',
  'dunk_hit',
  'special_resolve',
  'projectile_spawn',
  'projectile_end',
  'fuel_depleted',
  'distance_band_change',
  'round_end',
] as const;

export type CombatEventType = (typeof COMBAT_EVENT_TYPES)[number];
export type CombatAction = SimulationAction;
export type CombatDistanceBand = 'point_blank' | 'pressure' | 'mid' | 'long';
export type CombatEventOutcome = 'impact' | 'expired_or_culled' | 'recovery' | 'win' | 'resolved';
export type CombatMovementIntent = 'approach' | 'orbit' | 'retreat' | 'idle' | 'uncontrollable';
export type CombatLaunchClashCause = SimulationLaunchClashCause | 'unattributed';

export interface CombatDistanceTransitionPlayerContext {
  movementIntent: CombatMovementIntent;
  moveMagnitude: number;
  boostHeld: boolean;
  superBoostHeld: boolean;
  boostActive: boolean;
  superBoostActive: boolean;
  actionRecoveryActive: boolean;
}

export interface CombatDistanceTransitionContext {
  fromBand: CombatDistanceBand;
  separationSpeed: number;
  players: PlayersById<CombatDistanceTransitionPlayerContext>;
}

export interface CombatTelemetryEvent {
  schemaVersion: CombatEventSchemaVersion;
  sequence: number;
  frame: number;
  timeSeconds: number;
  type: CombatEventType;
  actorId?: PlayerId;
  actorCharacterId?: CharacterId;
  targetId?: PlayerId;
  targetCharacterId?: CharacterId;
  action?: CombatAction;
  outcome?: CombatEventOutcome;
  moveId?: string;
  behaviorId?: string;
  projectileId?: number;
  distance?: number;
  controlReturnStartDistance?: number;
  distanceBand?: CombatDistanceBand;
  distanceTransition?: CombatDistanceTransitionContext;
  movementIntent?: CombatMovementIntent;
  actorSpeed?: number;
  targetSpeed?: number;
  separationSpeed?: number;
  actorFuelPercent?: number;
  targetFuelPercent?: number;
  launchClashCause?: CombatLaunchClashCause;
  launchClashAttribution?: 'simulation' | 'inferred';
  launchClashGracePlayerId?: PlayerId;
}

export interface CombatResourceTelemetry {
  fuelLost: number;
  fuelRestored: number;
  averageFuelPercent: number;
  zeroFuelFrames: number;
  zeroFuelSeconds: number;
  helplessFrames: number;
  helplessSeconds: number;
}

export interface CombatSpacingBandTelemetry {
  frames: Record<CombatDistanceBand, number>;
  seconds: Record<CombatDistanceBand, number>;
}

export interface CombatEventTelemetrySummary {
  schemaVersion: typeof COMBAT_EVENT_SCHEMA_VERSION;
  eventCount: number;
  eventCounts: Record<CombatEventType, number>;
  events: CombatTelemetryEvent[];
  launchClashCauses: Record<CombatLaunchClashCause, number>;
  resources: PlayersById<CombatResourceTelemetry>;
  spacingBands: CombatSpacingBandTelemetry;
}

type CombatEventDetails = Partial<Omit<
  CombatTelemetryEvent,
  'schemaVersion' | 'sequence' | 'frame' | 'timeSeconds' | 'type'
  | 'actorId' | 'actorCharacterId' | 'targetId' | 'targetCharacterId'
>>;

interface TrackedInput {
  boost: boolean;
  superBoost: boolean;
  special: boolean;
  launch: boolean;
  dunk: boolean;
  parry: boolean;
  breakLaunch: boolean;
}

interface TrackedPlayer {
  characterId: CharacterId;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  radius: number;
  fuel: number;
  maxFuel: number;
  chain: number;
  boostActive: boolean;
  superBoost: number;
  launchBreaks: number;
  stunned: number;
  helpless: number;
  recovering: number;
  endLag: number;
  parry: number;
  launchFlash: number;
  launchStartup: number;
  launchActive: number;
  dunkStartup: number;
  dunkActive: number;
  specialStartup: number;
  specialActive: number;
  dunkDidConnect: boolean;
  specialDidResolve: boolean;
  lastLaunchedBy: PlayerId | null;
}

interface TrackedProjectile {
  id: number;
  ownerId: PlayerId;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  life: number;
  hitRadius: number;
}

interface TrackedState {
  players: PlayersById<TrackedPlayer>;
  projectiles: Map<number, TrackedProjectile>;
  nextProjectileId: number;
  winner: PlayerId | null;
}

interface MutableResourceTelemetry {
  fuelLost: number;
  fuelRestored: number;
  accumulatedFuelPercent: number;
  zeroFuelFrames: number;
  zeroFuelSeconds: number;
  helplessFrames: number;
  helplessSeconds: number;
}

interface PendingControlReturn {
  kind: 'natural' | 'launch_break';
  startDistance: number;
}

const OPPONENT_BY_ID: PlayersById<PlayerId> = { P1: 'P2', P2: 'P1' };

function createEventCounts(): Record<CombatEventType, number> {
  return Object.fromEntries(COMBAT_EVENT_TYPES.map((type) => [type, 0])) as Record<CombatEventType, number>;
}

function createBandFrames(): Record<CombatDistanceBand, number> {
  return {
    point_blank: 0,
    pressure: 0,
    mid: 0,
    long: 0,
  };
}

function createMutableResourceTelemetry(): MutableResourceTelemetry {
  return {
    fuelLost: 0,
    fuelRestored: 0,
    accumulatedFuelPercent: 0,
    zeroFuelFrames: 0,
    zeroFuelSeconds: 0,
    helplessFrames: 0,
    helplessSeconds: 0,
  };
}

function trackPlayer(player: PlayerState): TrackedPlayer {
  return {
    characterId: player.characterId,
    pos: { x: player.pos.x, y: player.pos.y },
    vel: { x: player.vel.x, y: player.vel.y },
    radius: player.radius,
    fuel: player.fuel,
    maxFuel: player.maxFuel,
    chain: player.chain,
    boostActive: player.boostActive,
    superBoost: player.superBoost,
    launchBreaks: player.launchBreaks,
    stunned: player.stunned,
    helpless: player.helpless,
    recovering: player.recovering,
    endLag: player.endLag,
    parry: player.parry,
    launchFlash: player.launchFlash,
    launchStartup: player.launchStartup,
    launchActive: player.launchActive,
    dunkStartup: player.dunkStartup,
    dunkActive: player.dunkActive,
    specialStartup: player.specialStartup,
    specialActive: player.specialActive,
    dunkDidConnect: player.dunkDidConnect,
    specialDidResolve: player.specialDidResolve,
    lastLaunchedBy: player.lastLaunchedBy,
  };
}

function trackProjectile(projectile: ProjectileState): TrackedProjectile {
  return {
    id: projectile.id,
    ownerId: projectile.ownerId,
    pos: { x: projectile.pos.x, y: projectile.pos.y },
    vel: { x: projectile.vel.x, y: projectile.vel.y },
    life: projectile.life,
    hitRadius: projectile.hitRadius,
  };
}

function trackState(state: GameState): TrackedState {
  return {
    players: {
      P1: trackPlayer(state.players.P1),
      P2: trackPlayer(state.players.P2),
    },
    projectiles: new Map(state.projectiles.map((projectile) => [projectile.id, trackProjectile(projectile)])),
    nextProjectileId: state.nextProjectileId,
    winner: state.winner,
  };
}

function trackInput(input: PlayerFrameInput): TrackedInput {
  return {
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

function resolveDistanceBand(distance: number): CombatDistanceBand {
  if (distance <= 12) {
    return 'point_blank';
  }
  if (distance <= 24) {
    return 'pressure';
  }
  if (distance <= 48) {
    return 'mid';
  }
  return 'long';
}

function resolveMovementIntent(
  input: PlayerFrameInput,
  player: TrackedPlayer,
  opponent: TrackedPlayer,
): CombatMovementIntent {
  if (player.helpless > 0 || player.stunned > 0 || player.recovering > 0) {
    return 'uncontrollable';
  }
  const magnitude = Math.hypot(input.moveX, input.moveY);
  if (magnitude < 0.2) {
    return 'idle';
  }
  const deltaX = opponent.pos.x - player.pos.x;
  const deltaY = opponent.pos.y - player.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const towardX = distance > 0.001 ? deltaX / distance : 0;
  const towardY = distance > 0.001 ? deltaY / distance : 0;
  const directionalDot = input.moveX / magnitude * towardX + input.moveY / magnitude * towardY;
  if (directionalDot > 0.35) {
    return 'approach';
  }
  if (directionalDot < -0.35) {
    return 'retreat';
  }
  return 'orbit';
}

function buildDistanceTransitionContext(
  fromBand: CombatDistanceBand,
  frameInput: FrameInput,
  state: TrackedState,
): CombatDistanceTransitionContext {
  const p1 = state.players.P1;
  const p2 = state.players.P2;
  const deltaX = p2.pos.x - p1.pos.x;
  const deltaY = p2.pos.y - p1.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const separationSpeed = distance > 0.001
    ? ((p2.vel.x - p1.vel.x) * deltaX + (p2.vel.y - p1.vel.y) * deltaY) / distance
    : 0;
  const playerContext = (
    player: TrackedPlayer,
    opponent: TrackedPlayer,
    input: PlayerFrameInput,
  ): CombatDistanceTransitionPlayerContext => ({
    movementIntent: resolveMovementIntent(input, player, opponent),
    moveMagnitude: roundMetric(Math.hypot(input.moveX, input.moveY), 3),
    boostHeld: input.boost,
    superBoostHeld: input.superBoost,
    boostActive: player.boostActive,
    superBoostActive: player.superBoost > 0,
    actionRecoveryActive: player.endLag > 0,
  });
  return {
    fromBand,
    separationSpeed: roundMetric(separationSpeed, 2),
    players: {
      P1: playerContext(p1, p2, frameInput.p1),
      P2: playerContext(p2, p1, frameInput.p2),
    },
  };
}

function roundMetric(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function resolveActionMoveDetails(
  characterId: CharacterId,
  action: CombatAction | undefined,
): Pick<CombatTelemetryEvent, 'moveId' | 'behaviorId'> {
  if (action !== 'special') {
    return {};
  }
  const special = CHARACTER_BY_ID[characterId]?.moves.special;
  return {
    moveId: special?.id,
    behaviorId: special?.behaviorId,
  };
}

export class CombatEventTelemetryTracker {
  private frame = 0;
  private elapsedSeconds = 0;
  private previousState: TrackedState | null = null;
  private previousInput: PlayersById<TrackedInput | null> = { P1: null, P2: null };
  private previousDistanceBand: CombatDistanceBand | null = null;
  private pendingControlReturn: PlayersById<PendingControlReturn | null> = {
    P1: null,
    P2: null,
  };
  private readonly events: CombatTelemetryEvent[] = [];
  private eventCounts = createEventCounts();
  private readonly resources: PlayersById<MutableResourceTelemetry> = {
    P1: createMutableResourceTelemetry(),
    P2: createMutableResourceTelemetry(),
  };
  private bandFrames = createBandFrames();
  private bandSeconds = createBandFrames();

  public startRound(state: GameState): void {
    this.frame = 0;
    this.elapsedSeconds = 0;
    this.previousState = trackState(state);
    this.previousInput = { P1: null, P2: null };
    this.previousDistanceBand = null;
    this.pendingControlReturn = { P1: null, P2: null };
    this.events.length = 0;
    this.eventCounts = createEventCounts();
    this.resources.P1 = createMutableResourceTelemetry();
    this.resources.P2 = createMutableResourceTelemetry();
    this.bandFrames = createBandFrames();
    this.bandSeconds = createBandFrames();
    const initialDistance = Math.hypot(
      state.players.P2.pos.x - state.players.P1.pos.x,
      state.players.P2.pos.y - state.players.P1.pos.y,
    );
    this.previousDistanceBand = resolveDistanceBand(initialDistance);
    this.pushEvent({
      type: 'distance_band_change',
      distance: roundMetric(initialDistance, 2),
      distanceBand: this.previousDistanceBand,
    });
  }

  public recordFrame(
    frameInput: FrameInput,
    state: GameState,
    dt: number,
    acceptedActionStarts?: readonly SimulationActionStart[],
    launchClashes?: readonly SimulationLaunchClash[],
  ): void {
    this.frame += 1;
    this.elapsedSeconds += Math.max(0, dt);
    const current = trackState(state);
    const previous = this.previousState;
    const distance = Math.hypot(
      current.players.P2.pos.x - current.players.P1.pos.x,
      current.players.P2.pos.y - current.players.P1.pos.y,
    );
    const distanceBand = resolveDistanceBand(distance);
    this.bandFrames[distanceBand] += 1;
    this.bandSeconds[distanceBand] += Math.max(0, dt);
    if (distanceBand !== this.previousDistanceBand) {
      this.pushEvent({
        type: 'distance_band_change',
        distance: roundMetric(distance, 2),
        distanceBand,
        distanceTransition: this.previousDistanceBand
          ? buildDistanceTransitionContext(this.previousDistanceBand, frameInput, current)
          : undefined,
      });
      this.previousDistanceBand = distanceBand;
    }

    this.recordInputEvents('P1', frameInput.p1, current);
    this.recordInputEvents('P2', frameInput.p2, current);
    if (previous) {
      if (acceptedActionStarts) {
        for (const start of acceptedActionStarts) {
          const actorInput = start.playerId === 'P1' ? frameInput.p1 : frameInput.p2;
          const opponentId = OPPONENT_BY_ID[start.playerId];
          this.pushPlayerEvent('action_start', start.playerId, undefined, current, {
            action: start.action,
            movementIntent: resolveMovementIntent(
              actorInput,
              current.players[start.playerId],
              current.players[opponentId],
            ),
          });
        }
      } else {
        this.recordActionStarts('P1', frameInput.p1, previous.players.P1, current.players.P1, current);
        this.recordActionStarts('P2', frameInput.p2, previous.players.P2, current.players.P2, current);
      }
      this.recordCombatOutcomes(previous, current, dt, launchClashes);
      this.recordResources('P1', previous.players.P1, current.players.P1, dt);
      this.recordResources('P2', previous.players.P2, current.players.P2, dt);
      if (!previous.winner && current.winner) {
        const loserId = OPPONENT_BY_ID[current.winner];
        this.pushPlayerEvent('round_end', current.winner, loserId, current, { outcome: 'win' });
      }
    }
    this.previousState = current;
  }

  public toSummary(): CombatEventTelemetrySummary {
    const toResourceSummary = (playerId: PlayerId): CombatResourceTelemetry => {
      const resource = this.resources[playerId];
      return {
        fuelLost: roundMetric(resource.fuelLost, 2),
        fuelRestored: roundMetric(resource.fuelRestored, 2),
        averageFuelPercent: this.frame > 0
          ? roundMetric(resource.accumulatedFuelPercent / this.frame, 3)
          : 0,
        zeroFuelFrames: resource.zeroFuelFrames,
        zeroFuelSeconds: roundMetric(resource.zeroFuelSeconds, 2),
        helplessFrames: resource.helplessFrames,
        helplessSeconds: roundMetric(resource.helplessSeconds, 2),
      };
    };
    return {
      schemaVersion: COMBAT_EVENT_SCHEMA_VERSION,
      eventCount: this.events.length,
      eventCounts: { ...this.eventCounts },
      events: this.events.map((event) => ({ ...event })),
      launchClashCauses: this.events.reduce<Record<CombatLaunchClashCause, number>>(
        (counts, event) => {
          if (event.type === 'launch_clash') {
            counts[event.launchClashCause ?? 'unattributed'] += 1;
          }
          return counts;
        },
        {
          simultaneous_active: 0,
          global_startup_grace: 0,
          post_control_counter_launch: 0,
          unattributed: 0,
        },
      ),
      resources: {
        P1: toResourceSummary('P1'),
        P2: toResourceSummary('P2'),
      },
      spacingBands: {
        frames: { ...this.bandFrames },
        seconds: {
          point_blank: roundMetric(this.bandSeconds.point_blank, 2),
          pressure: roundMetric(this.bandSeconds.pressure, 2),
          mid: roundMetric(this.bandSeconds.mid, 2),
          long: roundMetric(this.bandSeconds.long, 2),
        },
      },
    };
  }

  private recordInputEvents(playerId: PlayerId, input: PlayerFrameInput, state: TrackedState): void {
    const previous = this.previousInput[playerId];
    const current = trackInput(input);
    const actions: Array<{ key: keyof TrackedInput; action: CombatAction }> = [
      { key: 'boost', action: 'boost' },
      { key: 'superBoost', action: 'super_boost' },
      { key: 'special', action: 'special' },
      { key: 'launch', action: 'launch' },
      { key: 'dunk', action: 'dunk' },
      { key: 'parry', action: 'parry' },
      { key: 'breakLaunch', action: 'launch_break' },
    ];
    for (const { key, action } of actions) {
      if (current[key] && (!previous || !previous[key])) {
        this.pushPlayerEvent('action_press', playerId, undefined, state, { action });
      }
    }
    this.previousInput[playerId] = current;
  }

  private recordActionStarts(
    playerId: PlayerId,
    input: PlayerFrameInput,
    previous: TrackedPlayer,
    current: TrackedPlayer,
    state: TrackedState,
  ): void {
    const starts: CombatAction[] = [];
    if (!previous.boostActive && current.boostActive) {
      starts.push('boost');
    }
    if (previous.superBoost <= 0 && current.superBoost > 0) {
      starts.push('super_boost');
    }
    const launchStarted = current.launchStartup > previous.launchStartup
      || current.launchActive > previous.launchActive
      || current.chain > previous.chain;
    if (input.launch && launchStarted) {
      starts.push('launch');
    }
    const dunkStarted = current.dunkStartup > previous.dunkStartup
      || current.dunkActive > previous.dunkActive
      || (!previous.dunkDidConnect && current.dunkDidConnect);
    if (input.dunk && dunkStarted) {
      starts.push('dunk');
    }
    const specialStarted = current.specialStartup > previous.specialStartup
      || current.specialActive > previous.specialActive
      || (!previous.specialDidResolve && current.specialDidResolve);
    if (input.special && specialStarted) {
      starts.push('special');
    }
    if (input.parry && current.parry > previous.parry) {
      starts.push('parry');
    }
    if (current.launchBreaks < previous.launchBreaks) {
      starts.push('launch_break');
    }
    for (const action of starts) {
      this.pushPlayerEvent('action_start', playerId, undefined, state, {
        action,
        movementIntent: resolveMovementIntent(
          input,
          current,
          state.players[OPPONENT_BY_ID[playerId]],
        ),
      });
    }
  }

  private recordCombatOutcomes(
    previous: TrackedState,
    current: TrackedState,
    dt: number,
    launchClashes?: readonly SimulationLaunchClash[],
  ): void {
    const specialResolvedActors = new Set<PlayerId>();
    for (const attackerId of ['P1', 'P2'] as const) {
      const targetId = OPPONENT_BY_ID[attackerId];
      const previousAttacker = previous.players[attackerId];
      const currentAttacker = current.players[attackerId];
      const previousTarget = previous.players[targetId];
      const currentTarget = current.players[targetId];
      if (currentAttacker.chain > previousAttacker.chain && currentTarget.lastLaunchedBy === attackerId) {
        this.pushPlayerEvent('launch_hit', attackerId, targetId, current);
      }
      if (
        previousAttacker.parry > 0
        && currentAttacker.parry <= 0
        && currentTarget.stunned > previousTarget.stunned
      ) {
        this.pushPlayerEvent('parry_success', attackerId, targetId, current);
      }
      const usedLaunchBreak = currentAttacker.launchBreaks < previousAttacker.launchBreaks;
      if (usedLaunchBreak) {
        this.pushPlayerEvent('launch_break', attackerId, undefined, current);
      }
      if (previousAttacker.helpless > 0 && currentAttacker.helpless <= 0) {
        this.pendingControlReturn[attackerId] = currentAttacker.recovering > 0
          ? null
          : {
            kind: usedLaunchBreak ? 'launch_break' : 'natural',
            startDistance: roundMetric(Math.hypot(
              previousTarget.pos.x - previousAttacker.pos.x,
              previousTarget.pos.y - previousAttacker.pos.y,
            ), 2),
          };
      }
      const pendingReturn = this.pendingControlReturn[attackerId];
      if (
        pendingReturn
        && !current.winner
        && currentAttacker.helpless <= 0
        && currentAttacker.recovering <= 0
        && currentAttacker.stunned <= 0
      ) {
        this.pushPlayerEvent('control_return', attackerId, undefined, current, {
          outcome: 'recovery',
          action: pendingReturn.kind === 'launch_break' ? 'launch_break' : undefined,
          controlReturnStartDistance: pendingReturn.startDistance,
        });
        this.pendingControlReturn[attackerId] = null;
      }
      const dunkConnected = (!previousAttacker.dunkDidConnect && currentAttacker.dunkDidConnect)
        || (previousTarget.recovering <= 0 && currentTarget.recovering > 0)
        || (!previous.winner && current.winner === attackerId);
      if (dunkConnected) {
        this.pushPlayerEvent('dunk_hit', attackerId, targetId, current, {
          outcome: current.winner === attackerId ? 'win' : 'recovery',
        });
      }
      if (!previousAttacker.specialDidResolve && currentAttacker.specialDidResolve) {
        this.pushSpecialResolve(attackerId, targetId, current);
        specialResolvedActors.add(attackerId);
      }
    }

    if (launchClashes !== undefined) {
      for (const clash of launchClashes) {
        this.pushEvent({
          type: 'launch_clash',
          distance: roundMetric(Math.hypot(
            current.players.P2.pos.x - current.players.P1.pos.x,
            current.players.P2.pos.y - current.players.P1.pos.y,
          ), 2),
          launchClashCause: clash.cause,
          launchClashAttribution: 'simulation',
          launchClashGracePlayerId: clash.gracePlayerId ?? undefined,
        });
      }
    } else {
      const clashTriggered = previous.players.P1.launchFlash <= 0
        && previous.players.P2.launchFlash <= 0
        && current.players.P1.launchFlash > 0
        && current.players.P2.launchFlash > 0
        && current.players.P1.helpless <= 0
        && current.players.P2.helpless <= 0
        && current.players.P1.launchActive <= 0
        && current.players.P2.launchActive <= 0;
      if (clashTriggered) {
        this.pushEvent({
          type: 'launch_clash',
          launchClashCause: 'unattributed',
          launchClashAttribution: 'inferred',
        });
      }
    }

    const spawnedIds = new Set<number>();
    for (let projectileId = previous.nextProjectileId; projectileId < current.nextProjectileId; projectileId += 1) {
      const projectile = current.projectiles.get(projectileId);
      const ownerId = projectile?.ownerId ?? this.inferSameFrameProjectileOwner(previous, current, projectileId);
      spawnedIds.add(projectileId);
      if (ownerId) {
        if (!specialResolvedActors.has(ownerId)) {
          this.pushSpecialResolve(ownerId, OPPONENT_BY_ID[ownerId], current);
          specialResolvedActors.add(ownerId);
        }
        this.pushPlayerEvent('projectile_spawn', ownerId, OPPONENT_BY_ID[ownerId], current, { projectileId });
      } else {
        this.pushEvent({ type: 'projectile_spawn', projectileId });
      }
      if (!projectile && ownerId) {
        this.pushPlayerEvent('projectile_end', ownerId, OPPONENT_BY_ID[ownerId], current, {
          projectileId,
          outcome: 'impact',
        });
      }
    }
    for (const [projectileId, projectile] of previous.projectiles) {
      if (current.projectiles.has(projectileId) || spawnedIds.has(projectileId)) {
        continue;
      }
      const targetId = OPPONENT_BY_ID[projectile.ownerId];
      const target = current.players[targetId];
      const predictedX = projectile.pos.x + projectile.vel.x * dt;
      const predictedY = projectile.pos.y + projectile.vel.y * dt;
      const predictedImpact = Math.hypot(predictedX - target.pos.x, predictedY - target.pos.y)
        < target.radius + projectile.hitRadius
        && target.parry <= 0;
      this.pushPlayerEvent('projectile_end', projectile.ownerId, targetId, current, {
        projectileId,
        outcome: predictedImpact ? 'impact' : 'expired_or_culled',
      });
    }

    for (const playerId of ['P1', 'P2'] as const) {
      if (previous.players[playerId].fuel > 0 && current.players[playerId].fuel <= 0) {
        this.pushPlayerEvent('fuel_depleted', playerId, undefined, current);
      }
    }
  }

  private inferSameFrameProjectileOwner(
    previous: TrackedState,
    current: TrackedState,
    projectileId: number,
  ): PlayerId | undefined {
    const owners = (['P1', 'P2'] as const).filter((playerId) => {
      const before = previous.players[playerId];
      const after = current.players[playerId];
      const special = CHARACTER_BY_ID[after.characterId]?.moves.special;
      return !before.specialDidResolve
        && after.specialDidResolve
        && special?.behaviorId === 'special.projectile.v1';
    });
    return owners[projectileId - previous.nextProjectileId];
  }

  private pushSpecialResolve(actorId: PlayerId, targetId: PlayerId, state: TrackedState): void {
    const special = CHARACTER_BY_ID[state.players[actorId].characterId]?.moves.special;
    this.pushPlayerEvent('special_resolve', actorId, targetId, state, {
      outcome: 'resolved',
      moveId: special?.id,
      behaviorId: special?.behaviorId,
    });
  }

  private recordResources(
    playerId: PlayerId,
    previous: TrackedPlayer,
    current: TrackedPlayer,
    dt: number,
  ): void {
    const resource = this.resources[playerId];
    const elapsed = Math.max(0, dt);
    resource.fuelLost += Math.max(0, previous.fuel - current.fuel);
    resource.fuelRestored += Math.max(0, current.fuel - previous.fuel);
    resource.accumulatedFuelPercent += current.maxFuel > 0 ? current.fuel / current.maxFuel : 0;
    if (current.fuel <= 0) {
      resource.zeroFuelFrames += 1;
      resource.zeroFuelSeconds += elapsed;
    }
    if (current.helpless > 0) {
      resource.helplessFrames += 1;
      resource.helplessSeconds += elapsed;
    }
  }

  private pushPlayerEvent(
    type: CombatEventType,
    actorId: PlayerId,
    targetId: PlayerId | undefined,
    state: TrackedState,
    details: CombatEventDetails = {},
  ): void {
    const opponentId = targetId ?? OPPONENT_BY_ID[actorId];
    const actor = state.players[actorId];
    const opponent = state.players[opponentId];
    const deltaX = opponent.pos.x - actor.pos.x;
    const deltaY = opponent.pos.y - actor.pos.y;
    const distance = Math.hypot(deltaX, deltaY);
    const separationSpeed = distance > 0.001
      ? ((opponent.vel.x - actor.vel.x) * deltaX + (opponent.vel.y - actor.vel.y) * deltaY) / distance
      : 0;
    const actionMoveDetails = type === 'action_start'
      ? resolveActionMoveDetails(actor.characterId, details.action)
      : {};
    this.pushEvent({
      ...actionMoveDetails,
      ...details,
      type,
      actorId,
      actorCharacterId: state.players[actorId].characterId,
      targetId,
      targetCharacterId: targetId ? state.players[targetId].characterId : undefined,
      distance: details.distance ?? roundMetric(distance, 2),
      actorSpeed: roundMetric(Math.hypot(actor.vel.x, actor.vel.y), 2),
      targetSpeed: roundMetric(Math.hypot(opponent.vel.x, opponent.vel.y), 2),
      separationSpeed: roundMetric(separationSpeed, 2),
      actorFuelPercent: roundMetric(actor.maxFuel > 0 ? actor.fuel / actor.maxFuel : 0),
      targetFuelPercent: roundMetric(opponent.maxFuel > 0 ? opponent.fuel / opponent.maxFuel : 0),
    });
  }

  private pushEvent(
    event: Omit<CombatTelemetryEvent, 'schemaVersion' | 'sequence' | 'frame' | 'timeSeconds'>,
  ): void {
    const recorded: CombatTelemetryEvent = {
      schemaVersion: COMBAT_EVENT_SCHEMA_VERSION,
      sequence: this.events.length,
      frame: this.frame,
      timeSeconds: roundMetric(this.elapsedSeconds),
      ...event,
    };
    this.events.push(recorded);
    this.eventCounts[recorded.type] += 1;
  }
}

export function createCombatEventTelemetryTracker(state: GameState): CombatEventTelemetryTracker {
  const tracker = new CombatEventTelemetryTracker();
  tracker.startRound(state);
  return tracker;
}
