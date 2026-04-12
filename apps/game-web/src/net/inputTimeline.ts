import type { PlayerFrameInput, PlayerId } from '../sim/types';

export type TimelineInputSource = 'local' | 'remote_predicted' | 'remote_authoritative';

export interface TimelineInputEntry {
  input: PlayerFrameInput;
  source: TimelineInputSource;
  sequence: number;
}

interface TimelineFrameStore {
  P1?: TimelineInputEntry;
  P2?: TimelineInputEntry;
}

export interface TimelineFrameView {
  frame: number;
  p1: TimelineInputEntry | null;
  p2: TimelineInputEntry | null;
  hasBothPlayers: boolean;
}

export interface UpsertTimelineResult {
  frame: number;
  playerId: PlayerId;
  inserted: boolean;
  replaced: boolean;
  replacedPrediction: boolean;
  changed: boolean;
  ignored: boolean;
  previousSource: TimelineInputSource | null;
  nextSource: TimelineInputSource | null;
}

export interface InputTimelineBufferOptions {
  maxFrames?: number;
}

const DEFAULT_MAX_FRAMES = 900;

function cloneInput(input: PlayerFrameInput): PlayerFrameInput {
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

function areInputsEqual(a: PlayerFrameInput, b: PlayerFrameInput): boolean {
  return a.moveX === b.moveX
    && a.moveY === b.moveY
    && a.boost === b.boost
    && a.superBoost === b.superBoost
    && a.special === b.special
    && a.launch === b.launch
    && a.dunk === b.dunk
    && a.parry === b.parry
    && a.breakLaunch === b.breakLaunch;
}

function validateFrame(frame: number): void {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`frame must be a non-negative integer. Received: ${frame}`);
  }
}

export class InputTimelineBuffer {
  private readonly maxFrames: number;

  private readonly frames = new Map<number, TimelineFrameStore>();

  private newestFrame = -1;

  private sequenceCounter = 1;

  constructor(options?: InputTimelineBufferOptions) {
    this.maxFrames = Math.max(1, Math.floor(options?.maxFrames ?? DEFAULT_MAX_FRAMES));
  }

  clear(): void {
    this.frames.clear();
    this.newestFrame = -1;
    this.sequenceCounter = 1;
  }

  clearPredictedFrom(frameInclusive: number, playerId: PlayerId): number {
    validateFrame(frameInclusive);
    let removed = 0;
    for (const [frame, record] of this.frames.entries()) {
      if (frame < frameInclusive) {
        continue;
      }
      const entry = record[playerId];
      if (!entry || entry.source !== 'remote_predicted') {
        continue;
      }
      delete record[playerId];
      removed += 1;
      if (!record.P1 && !record.P2) {
        this.frames.delete(frame);
      }
    }
    return removed;
  }

  pruneBefore(frameExclusive: number): void {
    validateFrame(Math.max(0, frameExclusive));
    for (const frame of this.frames.keys()) {
      if (frame < frameExclusive) {
        this.frames.delete(frame);
      }
    }
  }

  setLocalInput(frame: number, playerId: PlayerId, input: PlayerFrameInput): UpsertTimelineResult {
    return this.upsert(frame, playerId, input, 'local');
  }

  setPredictedRemoteInput(frame: number, playerId: PlayerId, input: PlayerFrameInput): UpsertTimelineResult {
    return this.upsert(frame, playerId, input, 'remote_predicted');
  }

  setRemoteAuthoritativeInput(frame: number, playerId: PlayerId, input: PlayerFrameInput): UpsertTimelineResult {
    return this.upsert(frame, playerId, input, 'remote_authoritative');
  }

  getFrame(frame: number): TimelineFrameView {
    validateFrame(frame);
    const record = this.frames.get(frame);
    const p1 = record?.P1 ?? null;
    const p2 = record?.P2 ?? null;
    return {
      frame,
      p1,
      p2,
      hasBothPlayers: Boolean(p1 && p2),
    };
  }

  getPlayerInput(frame: number, playerId: PlayerId): TimelineInputEntry | null {
    validateFrame(frame);
    const record = this.frames.get(frame);
    if (!record) {
      return null;
    }
    return record[playerId] ?? null;
  }

  hasInput(frame: number, playerId: PlayerId): boolean {
    return this.getPlayerInput(frame, playerId) !== null;
  }

  getRecentFrames(limit: number): TimelineFrameView[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const frames = [...this.frames.keys()]
      .sort((a, b) => b - a)
      .slice(0, safeLimit);
    return frames.map((frame) => this.getFrame(frame));
  }

  private upsert(
    frame: number,
    playerId: PlayerId,
    input: PlayerFrameInput,
    source: TimelineInputSource,
  ): UpsertTimelineResult {
    validateFrame(frame);

    const windowFloor = this.newestFrame >= 0 ? this.newestFrame - this.maxFrames + 1 : 0;
    if (frame < windowFloor) {
      return {
        frame,
        playerId,
        inserted: false,
        replaced: false,
        replacedPrediction: false,
        changed: false,
        ignored: true,
        previousSource: null,
        nextSource: null,
      };
    }

    if (frame > this.newestFrame) {
      this.newestFrame = frame;
    }

    let record = this.frames.get(frame);
    if (!record) {
      record = {};
      this.frames.set(frame, record);
    }

    const previous = record[playerId];
    if (!previous) {
      record[playerId] = {
        input: cloneInput(input),
        source,
        sequence: this.sequenceCounter++,
      };
      this.trimToWindow();
      return {
        frame,
        playerId,
        inserted: true,
        replaced: false,
        replacedPrediction: false,
        changed: false,
        ignored: false,
        previousSource: null,
        nextSource: source,
      };
    }

    if (source === 'remote_predicted' && previous.source === 'remote_authoritative') {
      return {
        frame,
        playerId,
        inserted: false,
        replaced: false,
        replacedPrediction: false,
        changed: false,
        ignored: true,
        previousSource: previous.source,
        nextSource: previous.source,
      };
    }

    const changed = !areInputsEqual(previous.input, input);
    const replacedPrediction = previous.source === 'remote_predicted' && source === 'remote_authoritative';
    record[playerId] = {
      input: cloneInput(input),
      source,
      sequence: this.sequenceCounter++,
    };

    this.trimToWindow();
    return {
      frame,
      playerId,
      inserted: false,
      replaced: true,
      replacedPrediction,
      changed,
      ignored: false,
      previousSource: previous.source,
      nextSource: source,
    };
  }

  private trimToWindow(): void {
    if (this.frames.size <= this.maxFrames) {
      return;
    }
    const floor = this.newestFrame - this.maxFrames + 1;
    for (const frame of this.frames.keys()) {
      if (frame < floor) {
        this.frames.delete(frame);
      }
    }
  }
}

export function createInputTimelineBuffer(options?: InputTimelineBufferOptions): InputTimelineBuffer {
  return new InputTimelineBuffer(options);
}
