import {
  encodeRankedPlayerInput,
  type RankedCompactPlayerInput,
} from './rankedProof';
import type { PlayerFrameInput, PlayerId } from './types';

export const RANKED_INPUT_COMMITMENT_SCHEMA_VERSION = 'gw.ranked-input-commitment.v1';
export const RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION = 'gw.ranked-input-commitment-receipt.v1';
export const RANKED_INPUT_ATTESTATION_SCHEMA_VERSION = 'gw.ranked-input-attestation.v1';
export const RANKED_INPUT_COMMITMENT_MAX_FRAMES = 120;
export const RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES = 120;
export const RANKED_INPUT_COMMITMENT_MAX_SEQUENCE = 2_048;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface RankedInputCommitmentChunkIdentity {
  sessionId: string;
  accountId: string;
  side: PlayerId;
  sequence: number;
  epoch: number;
  startFrame: number;
  roundFinal: boolean;
}

export interface RankedInputCommitmentSubmission extends RankedInputCommitmentChunkIdentity {
  schemaVersion: typeof RANKED_INPUT_COMMITMENT_SCHEMA_VERSION;
  endFrame: number;
  chunkDigest: string;
  previousChainDigest: string | null;
}

export interface RankedInputCommitmentReceipt {
  schemaVersion: typeof RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION;
  sequence: number;
  chainDigest: string;
  receivedAt: string;
  existing?: boolean;
}

export interface RankedInputCommitmentRecorderOptions {
  sessionId: string;
  accountId: string;
  side: PlayerId;
  submit: (submission: RankedInputCommitmentSubmission) => Promise<RankedInputCommitmentReceipt>;
}

export interface RankedInputCommitmentRecorderDiagnostics {
  queuedChunks: number;
  acknowledgedChunks: number;
  committedFrames: number;
  finalChainDigest: string | null;
  failed: boolean;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface PendingRound {
  epoch: number;
  startFrame: number;
  inputs: RankedCompactPlayerInput[];
}

interface QueuedChunk {
  identity: RankedInputCommitmentChunkIdentity;
  inputs: RankedCompactPlayerInput[];
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  }
}

function assertDigest(value: string | null, field: string, allowNull: boolean): void {
  if (allowNull && value === null) {
    return;
  }
  if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest.`);
  }
}

function cloneCompactInput(input: RankedCompactPlayerInput): RankedCompactPlayerInput {
  return [input[0], input[1], input[2]];
}

function serialiseChunk(
  identity: RankedInputCommitmentChunkIdentity,
  inputs: readonly RankedCompactPlayerInput[],
): string {
  return [
    RANKED_INPUT_COMMITMENT_SCHEMA_VERSION,
    identity.sessionId,
    identity.accountId,
    identity.side,
    String(identity.sequence),
    String(identity.epoch),
    String(identity.startFrame),
    identity.roundFinal ? '1' : '0',
    JSON.stringify(inputs),
  ].join('\n');
}

function serialiseChain(submission: RankedInputCommitmentSubmission): string {
  return [
    RANKED_INPUT_COMMITMENT_SCHEMA_VERSION,
    submission.sessionId,
    submission.accountId,
    submission.side,
    String(submission.sequence),
    String(submission.epoch),
    String(submission.startFrame),
    String(submission.endFrame),
    submission.roundFinal ? '1' : '0',
    submission.previousChainDigest ?? '-',
    submission.chunkDigest,
  ].join('\n');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function digestRankedInputCommitmentChunk(
  identity: RankedInputCommitmentChunkIdentity,
  inputs: readonly RankedCompactPlayerInput[],
): Promise<string> {
  if (identity.side !== 'P1' && identity.side !== 'P2') {
    throw new TypeError('side must be P1 or P2.');
  }
  assertNonNegativeInteger(identity.sequence, 'sequence');
  assertNonNegativeInteger(identity.epoch, 'epoch');
  assertNonNegativeInteger(identity.startFrame, 'startFrame');
  if (inputs.length < 1 || inputs.length > RANKED_INPUT_COMMITMENT_MAX_FRAMES) {
    throw new TypeError(
      `inputs must contain 1-${RANKED_INPUT_COMMITMENT_MAX_FRAMES} frames.`,
    );
  }
  return await sha256Hex(serialiseChunk(identity, inputs));
}

export async function deriveRankedInputCommitmentChainDigest(
  submission: RankedInputCommitmentSubmission,
): Promise<string> {
  assertDigest(submission.chunkDigest, 'chunkDigest', false);
  assertDigest(submission.previousChainDigest, 'previousChainDigest', true);
  return await sha256Hex(serialiseChain(submission));
}

export function parseRankedInputCommitmentSubmission(
  value: unknown,
): RankedInputCommitmentSubmission | null {
  if (!isObjectRecord(value) || value.schemaVersion !== RANKED_INPUT_COMMITMENT_SCHEMA_VERSION) {
    return null;
  }
  if (
    typeof value.sessionId !== 'string'
    || value.sessionId.length === 0
    || typeof value.accountId !== 'string'
    || value.accountId.length === 0
    || (value.side !== 'P1' && value.side !== 'P2')
    || !Number.isSafeInteger(value.sequence)
    || Number(value.sequence) < 0
    || Number(value.sequence) >= RANKED_INPUT_COMMITMENT_MAX_SEQUENCE
    || !Number.isSafeInteger(value.epoch)
    || Number(value.epoch) < 0
    || !Number.isSafeInteger(value.startFrame)
    || Number(value.startFrame) < 0
    || !Number.isSafeInteger(value.endFrame)
    || Number(value.endFrame) < Number(value.startFrame)
    || Number(value.endFrame) - Number(value.startFrame) + 1 > RANKED_INPUT_COMMITMENT_MAX_FRAMES
    || typeof value.roundFinal !== 'boolean'
    || typeof value.chunkDigest !== 'string'
    || !SHA256_HEX_PATTERN.test(value.chunkDigest)
    || (
      value.previousChainDigest !== null
      && (
        typeof value.previousChainDigest !== 'string'
        || !SHA256_HEX_PATTERN.test(value.previousChainDigest)
      )
    )
  ) {
    return null;
  }
  return {
    schemaVersion: RANKED_INPUT_COMMITMENT_SCHEMA_VERSION,
    sessionId: value.sessionId,
    accountId: value.accountId,
    side: value.side,
    sequence: Number(value.sequence),
    epoch: Number(value.epoch),
    startFrame: Number(value.startFrame),
    endFrame: Number(value.endFrame),
    roundFinal: value.roundFinal,
    chunkDigest: value.chunkDigest,
    previousChainDigest: value.previousChainDigest as string | null,
  };
}

export function extractRankedPlayerInput(
  input: readonly [number, number, number, number, number, number],
  side: PlayerId,
): RankedCompactPlayerInput {
  return side === 'P1'
    ? [input[0], input[1], input[2]]
    : [input[3], input[4], input[5]];
}

export class RankedInputCommitmentRecorder {
  private readonly options: RankedInputCommitmentRecorderOptions;

  private pendingRound: PendingRound | null = null;

  private readonly queued: QueuedChunk[] = [];

  private nextSequence = 0;

  private acknowledgedChunks = 0;

  private committedFrames = 0;

  private previousChainDigest: string | null = null;

  private draining: Promise<void> | null = null;

  private failure: Error | null = null;

  public constructor(options: RankedInputCommitmentRecorderOptions) {
    if (!options.sessionId || !options.accountId) {
      throw new TypeError('Ranked input commitments require session and account identity.');
    }
    if (options.side !== 'P1' && options.side !== 'P2') {
      throw new TypeError('Ranked input commitment side must be P1 or P2.');
    }
    this.options = options;
  }

  public startRound(epoch: number): void {
    assertNonNegativeInteger(epoch, 'epoch');
    if (this.pendingRound) {
      throw new Error(`Ranked input commitment epoch ${this.pendingRound.epoch} is not finalized.`);
    }
    this.pendingRound = { epoch, startFrame: 0, inputs: [] };
  }

  public recordInput(epoch: number, frame: number, input: PlayerFrameInput): void {
    if (this.failure) {
      throw this.failure;
    }
    const round = this.pendingRound;
    if (!round || round.epoch !== epoch) {
      throw new Error(`Ranked input commitment targets inactive epoch ${epoch}.`);
    }
    const expectedFrame = round.startFrame + round.inputs.length;
    if (frame !== expectedFrame) {
      throw new Error(`Ranked input commitment expected frame ${expectedFrame}, received ${frame}.`);
    }
    if (
      round.inputs.length
      === RANKED_INPUT_COMMITMENT_MAX_FRAMES + RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES
    ) {
      this.queueInputPrefix(RANKED_INPUT_COMMITMENT_MAX_FRAMES, false);
    }
    round.inputs.push(encodeRankedPlayerInput(input));
  }

  public finalizeRound(epoch: number, finalFrame: number): void {
    if (this.failure) {
      throw this.failure;
    }
    const round = this.pendingRound;
    if (!round || round.epoch !== epoch) {
      throw new Error(`Ranked input commitment cannot finalize inactive epoch ${epoch}.`);
    }
    const recordedFinalFrame = round.startFrame + round.inputs.length - 1;
    if (round.inputs.length === 0 || finalFrame > recordedFinalFrame) {
      throw new Error(
        `Ranked input commitment final frame mismatch: recorded ${recordedFinalFrame}, expected ${finalFrame}.`,
      );
    }
    if (finalFrame < round.startFrame) {
      throw new Error(
        `Ranked input commitment correction reached committed frame ${round.startFrame - 1}; expected final frame ${finalFrame}.`,
      );
    }
    round.inputs.length = finalFrame - round.startFrame + 1;
    while (round.inputs.length > RANKED_INPUT_COMMITMENT_MAX_FRAMES) {
      this.queueInputPrefix(RANKED_INPUT_COMMITMENT_MAX_FRAMES, false);
    }
    this.queueInputPrefix(round.inputs.length, true);
    this.pendingRound = null;
  }

  public async flush(): Promise<void> {
    if (this.pendingRound) {
      throw new Error(`Ranked input commitment epoch ${this.pendingRound.epoch} is not finalized.`);
    }
    while (this.queued.length > 0 || this.draining) {
      if (this.failure) {
        throw this.failure;
      }
      this.ensureDrain();
      const activeDrain = this.draining;
      if (activeDrain) {
        await activeDrain;
      } else if (this.queued.length > 0) {
        throw new Error('Ranked input commitment queue could not start draining.');
      }
    }
    if (this.failure) {
      throw this.failure;
    }
    if (this.queued.length > 0) {
      throw new Error('Ranked input commitment queue did not drain completely.');
    }
  }

  public getDiagnostics(): RankedInputCommitmentRecorderDiagnostics {
    return {
      queuedChunks: this.queued.length,
      acknowledgedChunks: this.acknowledgedChunks,
      committedFrames: this.committedFrames,
      finalChainDigest: this.previousChainDigest,
      failed: this.failure !== null,
    };
  }

  private queueInputPrefix(frameCount: number, roundFinal: boolean): void {
    const round = this.pendingRound;
    if (
      !round
      || frameCount < 1
      || frameCount > RANKED_INPUT_COMMITMENT_MAX_FRAMES
      || frameCount > round.inputs.length
    ) {
      throw new Error('Cannot queue an empty ranked input commitment chunk.');
    }
    if (this.nextSequence >= RANKED_INPUT_COMMITMENT_MAX_SEQUENCE) {
      throw new Error('Ranked input commitment sequence budget was exceeded.');
    }
    this.queued.push({
      identity: {
        sessionId: this.options.sessionId,
        accountId: this.options.accountId,
        side: this.options.side,
        sequence: this.nextSequence,
        epoch: round.epoch,
        startFrame: round.startFrame,
        roundFinal,
      },
      inputs: round.inputs.slice(0, frameCount).map(cloneCompactInput),
    });
    this.nextSequence += 1;
    round.inputs = round.inputs.slice(frameCount);
    round.startFrame += frameCount;
    this.ensureDrain();
  }

  private ensureDrain(): void {
    if (this.draining || this.failure || this.queued.length === 0) {
      return;
    }
    this.draining = this.drainQueue()
      .catch((error: unknown) => {
        this.failure = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.draining = null;
        if (!this.failure && this.queued.length > 0) {
          this.ensureDrain();
        }
      });
  }

  private async drainQueue(): Promise<void> {
    while (this.queued.length > 0) {
      const chunk = this.queued[0];
      const chunkDigest = await digestRankedInputCommitmentChunk(chunk.identity, chunk.inputs);
      const submission: RankedInputCommitmentSubmission = {
        ...chunk.identity,
        schemaVersion: RANKED_INPUT_COMMITMENT_SCHEMA_VERSION,
        endFrame: chunk.identity.startFrame + chunk.inputs.length - 1,
        chunkDigest,
        previousChainDigest: this.previousChainDigest,
      };
      const expectedChainDigest = await deriveRankedInputCommitmentChainDigest(submission);
      const receipt = await this.options.submit(submission);
      if (
        receipt.schemaVersion !== RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION
        || receipt.sequence !== submission.sequence
        || receipt.chainDigest !== expectedChainDigest
        || !Number.isFinite(Date.parse(receipt.receivedAt))
      ) {
        throw new Error('Ranked input commitment receipt did not match the submitted chain.');
      }
      this.previousChainDigest = receipt.chainDigest;
      this.acknowledgedChunks += 1;
      this.committedFrames += chunk.inputs.length;
      this.queued.shift();
    }
  }
}
