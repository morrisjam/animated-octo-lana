import { createEmptyPlayerInput } from '../input/frame';
import {
  createAiController,
  createDefaultAiBehaviorTuning,
  tickAiController,
  type AiControllerState,
} from '../sim/ai';
import { tickAiControllerWithRole } from '../sim/aiControllerRoles';
import type { CharacterBalanceOverrides } from '../sim/characterBalance';
import type { CharacterId } from '../sim/characters';
import { deriveOfflineAiSeed } from '../sim/offlineRoundSeed';
import { createInitialState, step } from '../sim/sim';
import type {
  GameRules,
  GameTuning,
  PlayerFrameInput,
  PlayerId,
  PlayersById,
} from '../sim/types';

export interface LocalRankedSmokeInputDriverOptions {
  seed: number;
  loadout: PlayersById<CharacterId>;
  rules: GameRules;
  tuning: GameTuning;
  characterBalanceOverrides: CharacterBalanceOverrides;
}

export interface LocalRankedSmokeInputDriverDiagnostics {
  generatedFrames: number;
  shadowWinner: PlayerId | null;
  shadowWinnerFrame: number | null;
  rollbackProbeFramesGenerated: number;
}

export const LOCAL_RANKED_SMOKE_ROLLBACK_PROBE_FRAME = 0;

function clonePlayerInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    moveX: input.moveX,
    moveY: input.moveY,
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

const LOCAL_RANKED_SMOKE_ATTACKER_BEHAVIOR = {
  ...createDefaultAiBehaviorTuning(),
  errorRateScale: 0,
  riskAppetiteOffset: 0.3,
  launchWeightScale: 2,
  specialWeightScale: 0,
  dunkWeightScale: 2,
  parryWeightScale: 0.15,
  launchBreakWeightScale: 0.15,
};

/** Generates deterministic player inputs without mutating the live match state. */
export class LocalRankedSmokeInputDriver {
  private readonly shadowState;

  private p1Controller: AiControllerState;

  private p2Controller: AiControllerState;

  private nextFrame = 0;

  private shadowWinnerFrame: number | null = null;

  private rollbackProbeFramesGenerated = 0;

  public constructor(options: LocalRankedSmokeInputDriverOptions) {
    this.shadowState = createInitialState({
      seed: options.seed,
      loadout: options.loadout,
      rules: options.rules,
      characterBalanceOverrides: options.characterBalanceOverrides,
    });
    this.shadowState.tuning = { ...options.tuning };
    this.p1Controller = createAiController({
      seed: deriveOfflineAiSeed(options.seed, 'P1'),
      profileId: 'veteran',
      behaviorTuning: LOCAL_RANKED_SMOKE_ATTACKER_BEHAVIOR,
    });
    this.p2Controller = createAiController({
      seed: deriveOfflineAiSeed(options.seed, 'P2'),
      profileId: 'veteran',
      behaviorTuning: LOCAL_RANKED_SMOKE_ATTACKER_BEHAVIOR,
    });
  }

  public nextLocalInput(frame: number, localPlayerId: PlayerId): PlayerFrameInput {
    if (frame !== this.nextFrame) {
      throw new Error(`Local ranked smoke input requested frame ${frame}; expected ${this.nextFrame}.`);
    }
    this.nextFrame += 1;
    if (this.shadowState.winner) {
      return createEmptyPlayerInput();
    }

    const p1Tick = tickAiController(this.shadowState, 'P1', this.p1Controller);
    const p2Tick = tickAiControllerWithRole(
      this.shadowState,
      'P2',
      this.p2Controller,
      'passive',
    );
    this.p1Controller = p1Tick.next;
    this.p2Controller = p2Tick.next;
    const p1Input = clonePlayerInput(p1Tick.input);
    const p2Input = clonePlayerInput(p2Tick.input);
    if (frame === LOCAL_RANKED_SMOKE_ROLLBACK_PROBE_FRAME) {
      p1Input.moveX = -0.25;
      p1Input.moveY = 0.5;
      p2Input.moveX = 0.25;
      p2Input.moveY = -0.5;
      this.rollbackProbeFramesGenerated += 1;
    }
    step(this.shadowState, { p1: p1Input, p2: p2Input }, 1 / 60);
    if (this.shadowState.winner && this.shadowWinnerFrame === null) {
      this.shadowWinnerFrame = frame;
    }
    return clonePlayerInput(localPlayerId === 'P1' ? p1Input : p2Input);
  }

  public getDiagnostics(): LocalRankedSmokeInputDriverDiagnostics {
    return {
      generatedFrames: this.nextFrame,
      shadowWinner: this.shadowState.winner,
      shadowWinnerFrame: this.shadowWinnerFrame,
      rollbackProbeFramesGenerated: this.rollbackProbeFramesGenerated,
    };
  }
}
