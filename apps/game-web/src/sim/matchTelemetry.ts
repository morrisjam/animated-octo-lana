import type { FrameInput, GameState, PlayerId, PlayerState, PlayersById } from './types';

export interface MatchTelemetryPlayerSummary {
  launchPresses: number;
  specialPresses: number;
  dunkPresses: number;
  parryPresses: number;
  breakPresses: number;
  breakEscapes: number;
  boostFrames: number;
  superBoostFrames: number;
  launchHits: number;
  clashCount: number;
  dunkHits: number;
  specialResolves: number;
  projectilesSpawned: number;
  averageBreakReactionSeconds: number;
  launchAccuracy: number;
  dunkConversionRate: number;
}

export interface MatchTelemetrySpacingSummary {
  averageDistance: number;
  closestDistance: number;
  farthestDistance: number;
  pointBlankFrames: number;
  pointBlankSeconds: number;
  pressureBandFrames: number;
  pressureBandSeconds: number;
}

export interface MatchTelemetrySummary {
  framesSimulated: number;
  elapsedSeconds: number;
  players: PlayersById<MatchTelemetryPlayerSummary>;
  spacing: MatchTelemetrySpacingSummary;
}

interface TrackedInputState {
  launch: boolean;
  special: boolean;
  dunk: boolean;
  parry: boolean;
  breakLaunch: boolean;
}

interface TrackedPlayerState {
  helpless: number;
  lastLaunchedBy: PlayerId | null;
  launchFlash: number;
  launchActive: number;
  dunkDidConnect: boolean;
  specialDidResolve: boolean;
}

interface TrackedState {
  p1: TrackedPlayerState;
  p2: TrackedPlayerState;
  projectileCount: number;
}

function createPlayerSummary(): MatchTelemetryPlayerSummary {
  return {
    launchPresses: 0,
    specialPresses: 0,
    dunkPresses: 0,
    parryPresses: 0,
    breakPresses: 0,
    breakEscapes: 0,
    boostFrames: 0,
    superBoostFrames: 0,
    launchHits: 0,
    clashCount: 0,
    dunkHits: 0,
    specialResolves: 0,
    projectilesSpawned: 0,
    averageBreakReactionSeconds: 0,
    launchAccuracy: 0,
    dunkConversionRate: 0,
  };
}

function toTrackedPlayerState(player: PlayerState): TrackedPlayerState {
  return {
    helpless: player.helpless,
    lastLaunchedBy: player.lastLaunchedBy,
    launchFlash: player.launchFlash,
    launchActive: player.launchActive,
    dunkDidConnect: player.dunkDidConnect,
    specialDidResolve: player.specialDidResolve,
  };
}

function toTrackedState(state: GameState): TrackedState {
  return {
    p1: toTrackedPlayerState(state.players.P1),
    p2: toTrackedPlayerState(state.players.P2),
    projectileCount: state.projectiles.length,
  };
}

export class MatchTelemetryTracker {
  private static readonly POINT_BLANK_DISTANCE = 12;
  private static readonly PRESSURE_BAND_DISTANCE = 24;

  private framesSimulated = 0;
  private elapsedSeconds = 0;
  private readonly players: PlayersById<MatchTelemetryPlayerSummary> = {
    P1: createPlayerSummary(),
    P2: createPlayerSummary(),
  };
  private readonly breakReactionSeconds: PlayersById<number> = {
    P1: 0,
    P2: 0,
  };
  private readonly helplessDurationSeconds: PlayersById<number> = {
    P1: 0,
    P2: 0,
  };
  private previousInput: PlayersById<TrackedInputState | null> = {
    P1: null,
    P2: null,
  };
  private previousState: TrackedState | null = null;
  private accumulatedDistance = 0;
  private closestDistance = Number.POSITIVE_INFINITY;
  private farthestDistance = 0;
  private pointBlankFrames = 0;
  private pressureBandFrames = 0;

  public startRound(state: GameState): void {
    this.framesSimulated = 0;
    this.elapsedSeconds = 0;
    this.players.P1 = createPlayerSummary();
    this.players.P2 = createPlayerSummary();
    this.breakReactionSeconds.P1 = 0;
    this.breakReactionSeconds.P2 = 0;
    this.helplessDurationSeconds.P1 = 0;
    this.helplessDurationSeconds.P2 = 0;
    this.previousInput = {
      P1: null,
      P2: null,
    };
    this.accumulatedDistance = 0;
    this.closestDistance = Number.POSITIVE_INFINITY;
    this.farthestDistance = 0;
    this.pointBlankFrames = 0;
    this.pressureBandFrames = 0;
    this.previousState = toTrackedState(state);
  }

  public recordFrame(frameInput: FrameInput, state: GameState, dt: number): void {
    this.framesSimulated += 1;
    this.elapsedSeconds += Math.max(0, dt);

    const distance = Math.hypot(
      state.players.P2.pos.x - state.players.P1.pos.x,
      state.players.P2.pos.y - state.players.P1.pos.y,
    );
    this.accumulatedDistance += distance;
    this.closestDistance = Math.min(this.closestDistance, distance);
    this.farthestDistance = Math.max(this.farthestDistance, distance);
    if (distance <= MatchTelemetryTracker.POINT_BLANK_DISTANCE) {
      this.pointBlankFrames += 1;
    }
    if (distance <= MatchTelemetryTracker.PRESSURE_BAND_DISTANCE) {
      this.pressureBandFrames += 1;
    }

    const currentState = toTrackedState(state);
    const previousState = this.previousState;
    this.recordPlayerInput('P1', frameInput.p1, previousState?.p1.helpless ?? 0, currentState.p1.helpless, dt);
    this.recordPlayerInput('P2', frameInput.p2, previousState?.p2.helpless ?? 0, currentState.p2.helpless, dt);
    if (previousState) {
      if (
        previousState.p2.helpless <= 0
        && currentState.p2.helpless > 0
        && currentState.p2.lastLaunchedBy === 'P1'
      ) {
        this.players.P1.launchHits += 1;
      }
      if (
        previousState.p1.helpless <= 0
        && currentState.p1.helpless > 0
        && currentState.p1.lastLaunchedBy === 'P2'
      ) {
        this.players.P2.launchHits += 1;
      }
      if (!previousState.p1.dunkDidConnect && currentState.p1.dunkDidConnect) {
        this.players.P1.dunkHits += 1;
      }
      if (!previousState.p2.dunkDidConnect && currentState.p2.dunkDidConnect) {
        this.players.P2.dunkHits += 1;
      }
      if (!previousState.p1.specialDidResolve && currentState.p1.specialDidResolve) {
        this.players.P1.specialResolves += 1;
      }
      if (!previousState.p2.specialDidResolve && currentState.p2.specialDidResolve) {
        this.players.P2.specialResolves += 1;
      }
      const clashTriggered = previousState.p1.launchFlash <= 0
        && previousState.p2.launchFlash <= 0
        && currentState.p1.launchFlash > 0
        && currentState.p2.launchFlash > 0
        && currentState.p1.helpless <= 0
        && currentState.p2.helpless <= 0
        && currentState.p1.launchActive <= 0
        && currentState.p2.launchActive <= 0;
      if (clashTriggered) {
        this.players.P1.clashCount += 1;
        this.players.P2.clashCount += 1;
      }
      const projectileDelta = currentState.projectileCount - previousState.projectileCount;
      if (projectileDelta > 0) {
        if (!previousState.p1.specialDidResolve && currentState.p1.specialDidResolve) {
          this.players.P1.projectilesSpawned += projectileDelta;
        } else if (!previousState.p2.specialDidResolve && currentState.p2.specialDidResolve) {
          this.players.P2.projectilesSpawned += projectileDelta;
        }
      }
    }

    this.updateHelplessDuration('P1', currentState.p1.helpless, dt);
    this.updateHelplessDuration('P2', currentState.p2.helpless, dt);

    this.previousState = currentState;
  }

  public toSummary(): MatchTelemetrySummary {
    const p1 = this.withDerivedRates('P1');
    const p2 = this.withDerivedRates('P2');
    return {
      framesSimulated: this.framesSimulated,
      elapsedSeconds: Math.round(this.elapsedSeconds * 100) / 100,
      players: {
        P1: p1,
        P2: p2,
      },
      spacing: {
        averageDistance: this.framesSimulated > 0 ? Number((this.accumulatedDistance / this.framesSimulated).toFixed(2)) : 0,
        closestDistance: Number.isFinite(this.closestDistance) ? Number(this.closestDistance.toFixed(2)) : 0,
        farthestDistance: Number(this.farthestDistance.toFixed(2)),
        pointBlankFrames: this.pointBlankFrames,
        pointBlankSeconds: Number((this.pointBlankFrames / 60).toFixed(2)),
        pressureBandFrames: this.pressureBandFrames,
        pressureBandSeconds: Number((this.pressureBandFrames / 60).toFixed(2)),
      },
    };
  }

  private recordPlayerInput(
    playerId: PlayerId,
    input: FrameInput['p1'],
    previousHelpless: number,
    currentHelpless: number,
    dt: number,
  ): void {
    const summary = this.players[playerId];
    const previous = this.previousInput[playerId];
    const current: TrackedInputState = {
      launch: input.launch,
      special: input.special,
      dunk: input.dunk,
      parry: input.parry,
      breakLaunch: input.breakLaunch,
    };

    if (current.launch && (!previous || !previous.launch)) {
      summary.launchPresses += 1;
    }
    if (current.special && (!previous || !previous.special)) {
      summary.specialPresses += 1;
    }
    if (current.dunk && (!previous || !previous.dunk)) {
      summary.dunkPresses += 1;
    }
    if (current.parry && (!previous || !previous.parry)) {
      summary.parryPresses += 1;
    }
    if (current.breakLaunch && (!previous || !previous.breakLaunch)) {
      summary.breakPresses += 1;
      if (previousHelpless > 0 || currentHelpless > 0) {
        summary.breakEscapes += 1;
        this.breakReactionSeconds[playerId] += this.helplessDurationSeconds[playerId] + dt;
      }
    }
    if (input.boost) {
      summary.boostFrames += 1;
    }
    if (input.superBoost) {
      summary.superBoostFrames += 1;
    }

    this.previousInput[playerId] = current;
  }

  private updateHelplessDuration(playerId: PlayerId, helpless: number, dt: number): void {
    if (helpless > 0) {
      this.helplessDurationSeconds[playerId] += Math.max(0, dt);
      return;
    }
    this.helplessDurationSeconds[playerId] = 0;
  }

  private withDerivedRates(playerId: PlayerId): MatchTelemetryPlayerSummary {
    const summary = this.players[playerId];
    return {
      ...summary,
      averageBreakReactionSeconds: summary.breakEscapes > 0
        ? Number((this.breakReactionSeconds[playerId] / summary.breakEscapes).toFixed(2))
        : 0,
      launchAccuracy: summary.launchPresses > 0
        ? Number((summary.launchHits / summary.launchPresses).toFixed(2))
        : 0,
      dunkConversionRate: summary.dunkPresses > 0
        ? Number((summary.dunkHits / summary.dunkPresses).toFixed(2))
        : 0,
    };
  }
}

export function createMatchTelemetryTracker(state: GameState): MatchTelemetryTracker {
  const tracker = new MatchTelemetryTracker();
  tracker.startRound(state);
  return tracker;
}
