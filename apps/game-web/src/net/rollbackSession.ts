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

export interface RollbackDesyncEvent {
  frame: number;
  rollbackFrames: number;
  preRollbackChecksum: number;
  postRollbackChecksum: number;
}

export interface RollbackDiagnosticsSnapshot {
  totalFramesSimulated: number;
  predictedRemoteFrames: number;
  authoritativeRemoteFrames: number;
  totalRollbacks: number;
  maxRollbackDepth: number;
  lastRollbackDepth: number;
  lastRollbackFromFrame: number | null;
  desyncEvents: RollbackDesyncEvent[];
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

  private readonly desyncEvents: RollbackDesyncEvent[] = [];

  private readonly pendingDesyncEvents: RollbackDesyncEvent[] = [];

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

  getTimelineEntry(frame: number, playerId: PlayerId): TimelineInputEntry | null {
    return this.timeline.getPlayerInput(frame, playerId);
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
      desyncEvents: this.desyncEvents.map((event) => ({ ...event })),
    };
  }

  drainPendingDesyncEvents(): RollbackDesyncEvent[] {
    if (this.pendingDesyncEvents.length === 0) {
      return [];
    }
    const events = this.pendingDesyncEvents.map((event) => ({ ...event }));
    this.pendingDesyncEvents.length = 0;
    return events;
  }

  setRemoteAuthoritativeInput(frame: number, input: PlayerFrameInput): number {
    const result = this.timeline.setRemoteAuthoritativeInput(frame, this.remotePlayerId, input);
    if (result.ignored || frame >= this.currentFrame) {
      return 0;
    }
    if (result.replacedPrediction || result.changed || result.inserted) {
      this.timeline.clearPredictedFrom(frame + 1, this.remotePlayerId);
      return this.rollbackAndResimulate(frame);
    }
    return 0;
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
    const preRollbackChecksum = computeStateChecksum(this.state);
    const startSnapshot = this.snapshots.get(startFrame);
    if (!startSnapshot) {
      throw new Error(`Missing rollback snapshot at frame ${startFrame}.`);
    }

    this.state = restoreStateFromSnapshot(startSnapshot);
    this.currentFrame = startFrame;
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

    const postRollbackChecksum = computeStateChecksum(this.state);
    if (preRollbackChecksum !== postRollbackChecksum) {
      const event: RollbackDesyncEvent = {
        frame: startFrame,
        rollbackFrames,
        preRollbackChecksum,
        postRollbackChecksum,
      };
      this.desyncEvents.push(event);
      this.pendingDesyncEvents.push(event);
      if (this.desyncEvents.length > 64) {
        this.desyncEvents.splice(0, this.desyncEvents.length - 64);
      }
      if (this.pendingDesyncEvents.length > 64) {
        this.pendingDesyncEvents.splice(0, this.pendingDesyncEvents.length - 64);
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
