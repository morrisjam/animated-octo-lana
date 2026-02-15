import type { FrameInput, GameState, PlayerId } from './types';

export type TrainingRoundEndReason = 'manual_restart' | 'round_win' | 'mode_exit';

export interface TrainingTelemetryTrackerOptions {
  balanceProfileId: string;
  rulesetVersion: string;
  playerCharacterId: string;
  opponentCharacterId: string;
}

export interface TrainingTelemetrySummary {
  sessionId: string;
  startedAt: string;
  exportedAt: string;
  balanceProfileId: string;
  rulesetVersion: string;
  playerCharacterId: string;
  opponentCharacterId: string;
  roundsStarted: number;
  roundsCompleted: number;
  roundsWon: number;
  manualRestarts: number;
  modeExits: number;
  totalRoundSeconds: number;
  averageRoundSeconds: number;
  framesSimulated: number;
  input: {
    launchPresses: number;
    specialPresses: number;
    dunkPresses: number;
    parryPresses: number;
    boostFrames: number;
    superBoostFrames: number;
  };
  outcomes: {
    launchHits: number;
    dunkHits: number;
    specialResolves: number;
    launchHitRate: number;
    dunkHitRate: number;
    specialResolveRate: number;
  };
  resources: {
    fuelSpent: number;
  };
  peaks: {
    maxChain: number;
  };
}

interface TrackedInputState {
  launch: boolean;
  special: boolean;
  dunk: boolean;
  parry: boolean;
}

interface TrackedPlayerState {
  fuel: number;
  helpless: number;
  lastLaunchedBy: PlayerId | null;
  dunkDidConnect: boolean;
  specialDidResolve: boolean;
  chain: number;
}

interface TrackedState {
  p1: TrackedPlayerState;
  p2: TrackedPlayerState;
}

let trainingTelemetrySessionCounter = 0;

function toTrackedState(state: GameState): TrackedState {
  return {
    p1: {
      fuel: state.players.P1.fuel,
      helpless: state.players.P1.helpless,
      lastLaunchedBy: state.players.P1.lastLaunchedBy,
      dunkDidConnect: state.players.P1.dunkDidConnect,
      specialDidResolve: state.players.P1.specialDidResolve,
      chain: state.players.P1.chain,
    },
    p2: {
      fuel: state.players.P2.fuel,
      helpless: state.players.P2.helpless,
      lastLaunchedBy: state.players.P2.lastLaunchedBy,
      dunkDidConnect: state.players.P2.dunkDidConnect,
      specialDidResolve: state.players.P2.specialDidResolve,
      chain: state.players.P2.chain,
    },
  };
}

function createSessionId(): string {
  const counter = (trainingTelemetrySessionCounter += 1).toString(36).padStart(2, '0');
  return `training-${Date.now().toString(36)}-${counter}`;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export class TrainingTelemetryTracker {
  private readonly sessionId: string;
  private readonly startedAt: string;
  private balanceProfileId: string;
  private rulesetVersion: string;
  private playerCharacterId: string;
  private opponentCharacterId: string;

  private roundsStarted = 0;
  private roundsCompleted = 0;
  private roundsWon = 0;
  private manualRestarts = 0;
  private modeExits = 0;
  private totalRoundSeconds = 0;
  private currentRoundSeconds = 0;
  private framesSimulated = 0;

  private launchPresses = 0;
  private specialPresses = 0;
  private dunkPresses = 0;
  private parryPresses = 0;
  private boostFrames = 0;
  private superBoostFrames = 0;

  private launchHits = 0;
  private dunkHits = 0;
  private specialResolves = 0;
  private fuelSpent = 0;
  private maxChain = 0;

  private roundActive = false;
  private previousInput: TrackedInputState | null = null;
  private previousState: TrackedState | null = null;

  public constructor(options: TrainingTelemetryTrackerOptions) {
    this.sessionId = createSessionId();
    this.startedAt = new Date().toISOString();
    this.balanceProfileId = options.balanceProfileId;
    this.rulesetVersion = options.rulesetVersion;
    this.playerCharacterId = options.playerCharacterId;
    this.opponentCharacterId = options.opponentCharacterId;
  }

  public updateMetadata(options: Partial<TrainingTelemetryTrackerOptions>): void {
    if (options.balanceProfileId) {
      this.balanceProfileId = options.balanceProfileId;
    }
    if (options.rulesetVersion) {
      this.rulesetVersion = options.rulesetVersion;
    }
    if (options.playerCharacterId) {
      this.playerCharacterId = options.playerCharacterId;
    }
    if (options.opponentCharacterId) {
      this.opponentCharacterId = options.opponentCharacterId;
    }
  }

  public startRound(state: GameState): void {
    this.roundsStarted += 1;
    this.currentRoundSeconds = 0;
    this.roundActive = true;
    this.previousInput = null;
    this.previousState = toTrackedState(state);
    this.maxChain = Math.max(this.maxChain, state.players.P1.chain);
  }

  public recordFrame(frameInput: FrameInput, state: GameState, dt: number): void {
    if (!this.roundActive) {
      return;
    }

    this.framesSimulated += 1;
    this.currentRoundSeconds += Math.max(0, dt);

    const currentInput: TrackedInputState = {
      launch: frameInput.p1.launch,
      special: frameInput.p1.special,
      dunk: frameInput.p1.dunk,
      parry: frameInput.p1.parry,
    };
    const previousInput = this.previousInput;
    if (currentInput.launch && (!previousInput || !previousInput.launch)) {
      this.launchPresses += 1;
    }
    if (currentInput.special && (!previousInput || !previousInput.special)) {
      this.specialPresses += 1;
    }
    if (currentInput.dunk && (!previousInput || !previousInput.dunk)) {
      this.dunkPresses += 1;
    }
    if (currentInput.parry && (!previousInput || !previousInput.parry)) {
      this.parryPresses += 1;
    }
    this.previousInput = currentInput;

    if (frameInput.p1.boost) {
      this.boostFrames += 1;
    }
    if (frameInput.p1.superBoost) {
      this.superBoostFrames += 1;
    }

    const currentState = toTrackedState(state);
    const previousState = this.previousState;
    if (previousState) {
      const fuelDelta = previousState.p1.fuel - currentState.p1.fuel;
      if (fuelDelta > 0) {
        this.fuelSpent += fuelDelta;
      }
      if (
        previousState.p2.helpless <= 0
        && currentState.p2.helpless > 0
        && currentState.p2.lastLaunchedBy === 'P1'
      ) {
        this.launchHits += 1;
      }
      if (!previousState.p1.dunkDidConnect && currentState.p1.dunkDidConnect) {
        this.dunkHits += 1;
      }
      if (!previousState.p1.specialDidResolve && currentState.p1.specialDidResolve) {
        this.specialResolves += 1;
      }
    }

    this.maxChain = Math.max(this.maxChain, currentState.p1.chain);
    this.previousState = currentState;
  }

  public endRound(reason: TrainingRoundEndReason): void {
    if (!this.roundActive) {
      return;
    }
    this.roundActive = false;
    this.roundsCompleted += 1;
    this.totalRoundSeconds += this.currentRoundSeconds;
    this.currentRoundSeconds = 0;
    if (reason === 'round_win') {
      this.roundsWon += 1;
    } else if (reason === 'manual_restart') {
      this.manualRestarts += 1;
    } else if (reason === 'mode_exit') {
      this.modeExits += 1;
    }
    this.previousInput = null;
    this.previousState = null;
  }

  public toSummary(nowIso = new Date().toISOString()): TrainingTelemetrySummary {
    const averageRoundSeconds = this.roundsCompleted > 0
      ? this.totalRoundSeconds / this.roundsCompleted
      : 0;
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      exportedAt: nowIso,
      balanceProfileId: this.balanceProfileId,
      rulesetVersion: this.rulesetVersion,
      playerCharacterId: this.playerCharacterId,
      opponentCharacterId: this.opponentCharacterId,
      roundsStarted: this.roundsStarted,
      roundsCompleted: this.roundsCompleted,
      roundsWon: this.roundsWon,
      manualRestarts: this.manualRestarts,
      modeExits: this.modeExits,
      totalRoundSeconds: round(this.totalRoundSeconds),
      averageRoundSeconds: round(averageRoundSeconds),
      framesSimulated: this.framesSimulated,
      input: {
        launchPresses: this.launchPresses,
        specialPresses: this.specialPresses,
        dunkPresses: this.dunkPresses,
        parryPresses: this.parryPresses,
        boostFrames: this.boostFrames,
        superBoostFrames: this.superBoostFrames,
      },
      outcomes: {
        launchHits: this.launchHits,
        dunkHits: this.dunkHits,
        specialResolves: this.specialResolves,
        launchHitRate: this.launchPresses > 0 ? round(this.launchHits / this.launchPresses) : 0,
        dunkHitRate: this.dunkPresses > 0 ? round(this.dunkHits / this.dunkPresses) : 0,
        specialResolveRate: this.specialPresses > 0 ? round(this.specialResolves / this.specialPresses) : 0,
      },
      resources: {
        fuelSpent: round(this.fuelSpent),
      },
      peaks: {
        maxChain: this.maxChain,
      },
    };
  }
}

export function createTrainingTelemetryTracker(options: TrainingTelemetryTrackerOptions): TrainingTelemetryTracker {
  return new TrainingTelemetryTracker(options);
}
