import {
  createStateSnapshot,
  restoreStateFromSnapshot,
  step,
} from '../sim/sim';
import { computeStateChecksum } from '../sim/checksum';
import type {
  FrameInput,
  GameState,
  PlayerFrameInput,
  PlayerId,
} from '../sim/types';
import { OPPONENT_BY_ID } from '../sim/constants';
import {
  createInputTimelineBuffer,
  type InputTimelineBuffer,
  type TimelineInputEntry,
} from './inputTimeline';

interface RollbackSessionOptions {
  initialState: GameState;
  localPlayerId: PlayerId;
  fixedDt: number;
  maxHistoryFrames?: number;
}

export interface AdvanceFrameOptions {
  localInput: PlayerFrameInput;
  remoteAuthoritativeInput?: PlayerFrameInput | null;
}

export interface AdvanceFrameResult {
  frame: number;
  usedPrediction: boolean;
  rollbackFrames: number;
}

export interface RemoteAuthoritativeFrameInput {
  frame: number;
  input: PlayerFrameInput;
}

export interface RemoteAuthoritativeBatchApplyResult {
  rollbackFrames: number;
  acceptedFrames: number[];
  duplicateFrames: number[];
  conflictingFrames: number[];
  tooLateFrames: number[];
}

export interface RollbackCorrectionEvent {
  frame: number;
  rollbackFrames: number;
  predictedStateChecksum: number;
  correctedStateChecksum: number;
}

export interface RollbackWinningFrame {
  frame: number;
  winner: PlayerId;
  checksum: number;
}

export interface RollbackDiagnosticsSnapshot {
  totalFramesSimulated: number;
  predictedRemoteFrames: number;
  authoritativeRemoteFrames: number;
  totalRollbacks: number;
  maxRollbackDepth: number;
  lastRollbackDepth: number;
  lastRollbackFromFrame: number | null;
  correctionEvents: RollbackCorrectionEvent[];
  duplicateAuthoritativeFrames: number;
  conflictingAuthoritativeFrames: number;
  tooLateAuthoritativeFrames: number;
}

const DEFAULT_MAX_HISTORY_FRAMES = 600;

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

function playerInputsEqual(first: PlayerFrameInput, second: PlayerFrameInput): boolean {
  return first.moveX === second.moveX
    && first.moveY === second.moveY
    && first.boost === second.boost
    && first.superBoost === second.superBoost
    && first.special === second.special
    && first.launch === second.launch
    && first.dunk === second.dunk
    && first.parry === second.parry
    && first.breakLaunch === second.breakLaunch;
}

function createNeutralPlayerInput(): PlayerFrameInput {
  return {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function frameInputForPlayers(
  localPlayerId: PlayerId,
  localInput: PlayerFrameInput,
  remoteInput: PlayerFrameInput,
): FrameInput {
  if (localPlayerId === 'P1') {
    return {
      p1: clonePlayerInput(localInput),
      p2: clonePlayerInput(remoteInput),
    };
  }
  return {
    p1: clonePlayerInput(remoteInput),
    p2: clonePlayerInput(localInput),
  };
}

export class RollbackSession {
  private state: GameState;

  private currentFrame = 0;

  private readonly localPlayerId: PlayerId;

  private readonly remotePlayerId: PlayerId;

  private readonly fixedDt: number;

  private readonly maxHistoryFrames: number;

  private readonly snapshots = new Map<number, GameState>();

  private readonly timeline: InputTimelineBuffer;

  private totalFramesSimulated = 0;

  private predictedRemoteFrames = 0;

  private authoritativeRemoteFrames = 0;

  private totalRollbacks = 0;

  private maxRollbackDepth = 0;

  private lastRollbackDepth = 0;

  private lastRollbackFromFrame: number | null = null;

  private readonly correctionEvents: RollbackCorrectionEvent[] = [];

  private readonly pendingCorrectionEvents: RollbackCorrectionEvent[] = [];

  private duplicateAuthoritativeFrames = 0;

  private conflictingAuthoritativeFrames = 0;

  private tooLateAuthoritativeFrames = 0;

  private winningFrame: RollbackWinningFrame | null = null;

  constructor(options: RollbackSessionOptions) {
    if (!Number.isFinite(options.fixedDt) || options.fixedDt <= 0) {
      throw new Error(`fixedDt must be positive. Received: ${options.fixedDt}`);
    }
    this.localPlayerId = options.localPlayerId;
    this.remotePlayerId = OPPONENT_BY_ID[this.localPlayerId];
    this.fixedDt = options.fixedDt;
    this.maxHistoryFrames = Math.max(1, Math.floor(options.maxHistoryFrames ?? DEFAULT_MAX_HISTORY_FRAMES));
    this.state = createStateSnapshot(options.initialState);
    this.snapshots.set(0, createStateSnapshot(this.state));
    this.timeline = createInputTimelineBuffer({ maxFrames: this.maxHistoryFrames });
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  getStateSnapshot(): GameState {
    return createStateSnapshot(this.state);
  }

  getWinningFrame(): RollbackWinningFrame | null {
    return this.winningFrame ? { ...this.winningFrame } : null;
  }

  getTimelineEntry(frame: number, playerId: PlayerId): TimelineInputEntry | null {
    return this.timeline.getPlayerInput(frame, playerId);
  }

  getCorrectedFrameChecksum(frame: number): number | null {
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error(`frame must be a non-negative integer. Received: ${frame}`);
    }
    const snapshot = this.snapshots.get(frame + 1);
    return snapshot ? computeStateChecksum(snapshot) : null;
  }

  getRecoveryCheckpointChecksum(confirmedThrough: number): number | null {
    if (!Number.isInteger(confirmedThrough) || confirmedThrough < -1) {
      throw new Error(
        `confirmedThrough must be an integer at least -1. Received: ${confirmedThrough}`,
      );
    }
    const snapshot = this.snapshots.get(confirmedThrough + 1);
    return snapshot ? computeStateChecksum(snapshot) : null;
  }

  getDiagnosticsSnapshot(): RollbackDiagnosticsSnapshot {
    return {
      totalFramesSimulated: this.totalFramesSimulated,
      predictedRemoteFrames: this.predictedRemoteFrames,
      authoritativeRemoteFrames: this.authoritativeRemoteFrames,
      totalRollbacks: this.totalRollbacks,
      maxRollbackDepth: this.maxRollbackDepth,
      lastRollbackDepth: this.lastRollbackDepth,
      lastRollbackFromFrame: this.lastRollbackFromFrame,
      correctionEvents: this.correctionEvents.map((event) => ({ ...event })),
      duplicateAuthoritativeFrames: this.duplicateAuthoritativeFrames,
      conflictingAuthoritativeFrames: this.conflictingAuthoritativeFrames,
      tooLateAuthoritativeFrames: this.tooLateAuthoritativeFrames,
    };
  }

  drainPendingCorrectionEvents(): RollbackCorrectionEvent[] {
    if (this.pendingCorrectionEvents.length === 0) {
      return [];
    }
    const events = this.pendingCorrectionEvents.map((event) => ({ ...event }));
    this.pendingCorrectionEvents.length = 0;
    return events;
  }

  setRemoteAuthoritativeInput(frame: number, input: PlayerFrameInput): number {
    return this.setRemoteAuthoritativeInputs([{ frame, input }]);
  }

  setRemoteAuthoritativeInputs(inputs: readonly RemoteAuthoritativeFrameInput[]): number {
    return this.applyRemoteAuthoritativeInputs(inputs).rollbackFrames;
  }

  applyRemoteAuthoritativeInputs(
    inputs: readonly RemoteAuthoritativeFrameInput[],
  ): RemoteAuthoritativeBatchApplyResult {
    let earliestRollbackFrame: number | null = null;
    const acceptedFrames: number[] = [];
    const duplicateFrames: number[] = [];
    const conflictingFrames: number[] = [];
    const tooLateFrames: number[] = [];
    const orderedInputs = [...inputs].sort((a, b) => a.frame - b.frame);
    for (const entry of orderedInputs) {
      const existing = this.timeline.getPlayerInput(entry.frame, this.remotePlayerId);
      if (existing?.source === 'remote_authoritative') {
        if (playerInputsEqual(existing.input, entry.input)) {
          duplicateFrames.push(entry.frame);
          this.duplicateAuthoritativeFrames += 1;
        } else {
          conflictingFrames.push(entry.frame);
          this.conflictingAuthoritativeFrames += 1;
        }
        continue;
      }
      const result = this.timeline.setRemoteAuthoritativeInput(
        entry.frame,
        this.remotePlayerId,
        entry.input,
      );
      if (result.ignored) {
        tooLateFrames.push(entry.frame);
        this.tooLateAuthoritativeFrames += 1;
        continue;
      }
      acceptedFrames.push(entry.frame);
      if (
        entry.frame < this.currentFrame
        && (result.changed || result.inserted)
      ) {
        earliestRollbackFrame = earliestRollbackFrame === null
          ? entry.frame
          : Math.min(earliestRollbackFrame, entry.frame);
      }
    }

    if (earliestRollbackFrame !== null) {
      this.timeline.clearPredictedFrom(earliestRollbackFrame + 1, this.remotePlayerId);
      return {
        rollbackFrames: this.rollbackAndResimulate(earliestRollbackFrame),
        acceptedFrames,
        duplicateFrames,
        conflictingFrames,
        tooLateFrames,
      };
    }
    return {
      rollbackFrames: 0,
      acceptedFrames,
      duplicateFrames,
      conflictingFrames,
      tooLateFrames,
    };
  }

  advanceFrame(options: AdvanceFrameOptions): AdvanceFrameResult {
    const frame = this.currentFrame;
    const localInput = clonePlayerInput(options.localInput);
    this.timeline.setLocalInput(frame, this.localPlayerId, localInput);

    let rollbackFrames = 0;
    if (options.remoteAuthoritativeInput) {
      rollbackFrames = this.setRemoteAuthoritativeInput(frame, options.remoteAuthoritativeInput);
    }

    const runResult = this.simulateSingleFrame(frame);
    return {
      frame,
      usedPrediction: runResult.usedPrediction,
      rollbackFrames,
    };
  }

  private rollbackAndResimulate(startFrame: number): number {
    if (startFrame >= this.currentFrame) {
      return 0;
    }
    const targetFrame = this.currentFrame;
    const predictedStateChecksum = computeStateChecksum(this.state);
    const previousWinningFrame = this.winningFrame;
    const startSnapshot = this.snapshots.get(startFrame);
    if (!startSnapshot) {
      throw new Error(`Missing rollback snapshot at frame ${startFrame}.`);
    }

    this.state = restoreStateFromSnapshot(startSnapshot);
    this.currentFrame = startFrame;
    this.winningFrame = startSnapshot.winner && previousWinningFrame?.frame !== undefined
      && previousWinningFrame.frame < startFrame
      ? { ...previousWinningFrame }
      : null;
    for (const frame of [...this.snapshots.keys()]) {
      if (frame > startFrame) {
        this.snapshots.delete(frame);
      }
    }

    while (this.currentFrame < targetFrame) {
      this.simulateSingleFrame(this.currentFrame);
    }
    const rollbackFrames = targetFrame - startFrame;
    this.totalRollbacks += 1;
    this.lastRollbackDepth = rollbackFrames;
    this.lastRollbackFromFrame = startFrame;
    this.maxRollbackDepth = Math.max(this.maxRollbackDepth, rollbackFrames);

    const correctedStateChecksum = computeStateChecksum(this.state);
    if (predictedStateChecksum !== correctedStateChecksum) {
      const event: RollbackCorrectionEvent = {
        frame: startFrame,
        rollbackFrames,
        predictedStateChecksum,
        correctedStateChecksum,
      };
      this.correctionEvents.push(event);
      this.pendingCorrectionEvents.push(event);
      if (this.correctionEvents.length > 64) {
        this.correctionEvents.splice(0, this.correctionEvents.length - 64);
      }
      if (this.pendingCorrectionEvents.length > 64) {
        this.pendingCorrectionEvents.splice(0, this.pendingCorrectionEvents.length - 64);
      }
    }

    return rollbackFrames;
  }

  private simulateSingleFrame(frame: number): { usedPrediction: boolean } {
    const localEntry = this.timeline.getPlayerInput(frame, this.localPlayerId);
    const localInput = localEntry?.input ?? createNeutralPlayerInput();
    const remoteResolution = this.resolveRemoteInputForFrame(frame);
    const frameInput = frameInputForPlayers(this.localPlayerId, localInput, remoteResolution.input);

    step(this.state, frameInput, this.fixedDt);
    if (this.state.winner && this.winningFrame === null) {
      this.winningFrame = {
        frame,
        winner: this.state.winner,
        checksum: computeStateChecksum(this.state),
      };
    }
    this.totalFramesSimulated += 1;
    if (remoteResolution.usedPrediction) {
      this.predictedRemoteFrames += 1;
    } else {
      this.authoritativeRemoteFrames += 1;
    }
    this.currentFrame = frame + 1;
    this.snapshots.set(this.currentFrame, createStateSnapshot(this.state));
    this.trimHistory();
    return {
      usedPrediction: remoteResolution.usedPrediction,
    };
  }

  private resolveRemoteInputForFrame(frame: number): { input: PlayerFrameInput; usedPrediction: boolean } {
    const existing = this.timeline.getPlayerInput(frame, this.remotePlayerId);
    if (existing) {
      return {
        input: clonePlayerInput(existing.input),
        usedPrediction: existing.source === 'remote_predicted',
      };
    }

    const predicted = this.findLastRemoteInputBefore(frame) ?? createNeutralPlayerInput();
    this.timeline.setPredictedRemoteInput(frame, this.remotePlayerId, predicted);
    const inserted = this.timeline.getPlayerInput(frame, this.remotePlayerId);
    return {
      input: clonePlayerInput(inserted?.input ?? predicted),
      usedPrediction: true,
    };
  }

  private findLastRemoteInputBefore(frameExclusive: number): PlayerFrameInput | null {
    for (let frame = frameExclusive - 1; frame >= 0; frame -= 1) {
      const entry = this.timeline.getPlayerInput(frame, this.remotePlayerId);
      if (entry) {
        return clonePlayerInput(entry.input);
      }
    }
    return null;
  }

  private trimHistory(): void {
    const floor = Math.max(0, this.currentFrame - this.maxHistoryFrames);
    for (const frame of this.snapshots.keys()) {
      if (frame < floor) {
        this.snapshots.delete(frame);
      }
    }
    this.timeline.pruneBefore(floor);
  }
}
