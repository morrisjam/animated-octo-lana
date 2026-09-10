import { describe, expect, test } from 'vitest';
import {
  deriveRankedInputCommitmentChainDigest,
  digestRankedInputCommitmentChunk,
  RankedInputCommitmentRecorder,
  RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION,
  type RankedInputCommitmentSubmission,
} from './rankedInputCommitment';
import type { PlayerFrameInput } from './types';
import { encodeRankedPlayerInput } from './rankedProof';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function inputForFrame(frame: number): PlayerFrameInput {
  return {
    moveX: (frame % 3) - 1,
    moveY: ((frame + 1) % 3) - 1,
    boost: frame % 2 === 0,
    superBoost: frame % 5 === 0,
    special: frame % 7 === 0,
    launch: frame % 11 === 0,
    dunk: frame % 13 === 0,
    parry: frame % 17 === 0,
    breakLaunch: frame % 19 === 0,
  };
}

function createRecorder(submissions: RankedInputCommitmentSubmission[]): RankedInputCommitmentRecorder {
  return new RankedInputCommitmentRecorder({
    sessionId: SESSION_ID,
    accountId: ACCOUNT_ID,
    side: 'P1',
    submit: async (submission) => {
      submissions.push(structuredClone(submission));
      return {
        schemaVersion: RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION,
        sequence: submission.sequence,
        chainDigest: await deriveRankedInputCommitmentChainDigest(submission),
        receivedAt: new Date(1_700_000_000_000 + submission.sequence * 2_000).toISOString(),
      };
    },
  });
}

describe('ranked input commitments', () => {
  test('keeps an exact 120-frame round in one final chunk', async () => {
    const submissions: RankedInputCommitmentSubmission[] = [];
    const recorder = createRecorder(submissions);
    recorder.startRound(0);
    for (let frame = 0; frame < 120; frame += 1) {
      recorder.recordInput(0, frame, inputForFrame(frame));
    }
    recorder.finalizeRound(0, 119);
    await recorder.flush();

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      sequence: 0,
      epoch: 0,
      startFrame: 0,
      endFrame: 119,
      roundFinal: true,
      previousChainDigest: null,
    });
    expect(recorder.getDiagnostics()).toMatchObject({
      queuedChunks: 0,
      acknowledgedChunks: 1,
      committedFrames: 120,
      failed: false,
    });
  });

  test('chains oversize and subsequent rounds without frame gaps', async () => {
    const submissions: RankedInputCommitmentSubmission[] = [];
    const recorder = createRecorder(submissions);
    recorder.startRound(0);
    for (let frame = 0; frame < 121; frame += 1) {
      recorder.recordInput(0, frame, inputForFrame(frame));
    }
    recorder.finalizeRound(0, 120);
    recorder.startRound(1);
    recorder.recordInput(1, 0, inputForFrame(0));
    recorder.recordInput(1, 1, inputForFrame(1));
    recorder.finalizeRound(1, 1);
    await recorder.flush();

    expect(submissions.map((submission) => ({
      sequence: submission.sequence,
      epoch: submission.epoch,
      startFrame: submission.startFrame,
      endFrame: submission.endFrame,
      roundFinal: submission.roundFinal,
    }))).toEqual([
      { sequence: 0, epoch: 0, startFrame: 0, endFrame: 119, roundFinal: false },
      { sequence: 1, epoch: 0, startFrame: 120, endFrame: 120, roundFinal: true },
      { sequence: 2, epoch: 1, startFrame: 0, endFrame: 1, roundFinal: true },
    ]);
    expect(submissions[1]?.previousChainDigest).toBe(
      await deriveRankedInputCommitmentChainDigest(submissions[0]!),
    );
    expect(submissions[2]?.previousChainDigest).toBe(
      await deriveRankedInputCommitmentChainDigest(submissions[1]!),
    );
  });

  test('trims speculative frames inside the rollback guard before finalizing', async () => {
    const submissions: RankedInputCommitmentSubmission[] = [];
    const recorder = createRecorder(submissions);
    recorder.startRound(0);
    for (let frame = 0; frame <= 240; frame += 1) {
      recorder.recordInput(0, frame, inputForFrame(frame));
    }
    recorder.finalizeRound(0, 235);
    await recorder.flush();

    expect(submissions.map((submission) => ({
      startFrame: submission.startFrame,
      endFrame: submission.endFrame,
      roundFinal: submission.roundFinal,
    }))).toEqual([
      { startFrame: 0, endFrame: 119, roundFinal: false },
      { startFrame: 120, endFrame: 235, roundFinal: true },
    ]);
    expect(recorder.getDiagnostics().committedFrames).toBe(236);
  });

  test('fails closed when rollback reaches an already committed chunk', async () => {
    const recorder = createRecorder([]);
    recorder.startRound(0);
    for (let frame = 0; frame <= 240; frame += 1) {
      recorder.recordInput(0, frame, inputForFrame(frame));
    }
    expect(() => recorder.finalizeRound(0, 119)).toThrow(/reached committed frame/);
  });

  test('keeps a deep speculative tail unsealed until the canonical round end is known', async () => {
    const submissions: RankedInputCommitmentSubmission[] = [];
    const recorder = createRecorder(submissions);
    recorder.startRound(0);
    // CI generated 5349 inputs before correcting the winner back to frame 4710.
    for (let frame = 0; frame < 5349; frame += 1) {
      recorder.recordInput(0, frame, inputForFrame(frame), Math.max(-1, frame - 654));
    }
    recorder.finalizeRound(0, 4710);
    await recorder.flush();
    expect(submissions.at(-1)).toMatchObject({ endFrame: 4710, roundFinal: true });
    expect(submissions.every((chunk) => chunk.endFrame <= 4710)).toBe(true);
    expect(recorder.getDiagnostics().committedFrames).toBe(4711);
    for (const chunk of submissions) {
      const inputs = Array.from({ length: chunk.endFrame - chunk.startFrame + 1 }, (_, offset) => {
        const input = inputForFrame(chunk.startFrame + offset);
        return encodeRankedPlayerInput(input);
      });
      expect(chunk.chunkDigest).toBe(await digestRankedInputCommitmentChunk(chunk, inputs));
    }
  });

  test('does not seal an exact chunk boundary that may be the canonical winning frame', async () => {
    const submissions: RankedInputCommitmentSubmission[] = [];
    const recorder = createRecorder(submissions);
    recorder.startRound(0);
    for (let frame = 0; frame < 1000; frame += 1) {
      recorder.recordInput(0, frame, inputForFrame(frame), Math.min(119, frame - 1));
    }
    recorder.finalizeRound(0, 119);
    await recorder.flush();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ startFrame: 0, endFrame: 119, roundFinal: true });
    recorder.startRound(1);
    recorder.recordInput(1, 0, inputForFrame(0), -1);
    recorder.finalizeRound(1, 0);
    await recorder.flush();
    expect(submissions[1]).toMatchObject({ epoch: 1, startFrame: 0, endFrame: 0, roundFinal: true });
  });

  test('catches up live chunk submission when a stalled canonical prefix advances', async () => {
    const submissions: RankedInputCommitmentSubmission[] = [];
    const recorder = createRecorder(submissions);
    recorder.startRound(0);
    for (let frame = 0; frame < 1000; frame += 1) recorder.recordInput(0, frame, inputForFrame(frame), -1);
    recorder.recordInput(0, 1000, inputForFrame(1000), 999);
    expect(recorder.getDiagnostics().queuedChunks).toBe(7);
    recorder.finalizeRound(0, 1000);
    await recorder.flush();
    expect(submissions.map((chunk) => chunk.startFrame)).toEqual([0, 120, 240, 360, 480, 600, 720, 840, 960]);
    expect(submissions.at(-1)).toMatchObject({ endFrame: 1000, roundFinal: true });
  });

  test('rejects invalid canonical watermarks without capturing the input', () => {
    const recorder = createRecorder([]);
    recorder.startRound(0);
    for (const watermark of [NaN, Infinity, -2, 0, 0.5]) {
      expect(() => recorder.recordInput(0, 0, inputForFrame(0), watermark)).toThrow(/canonicalThrough/);
    }
    recorder.recordInput(0, 0, inputForFrame(0), -1);
    recorder.finalizeRound(0, 0);
  });

  test('rejects non-contiguous local frame capture', () => {
    const recorder = createRecorder([]);
    recorder.startRound(0);
    expect(() => recorder.recordInput(0, 1, inputForFrame(1))).toThrow(/expected frame 0/);
  });

  test('surfaces a bad receipt without hanging flush', async () => {
    const recorder = new RankedInputCommitmentRecorder({
      sessionId: SESSION_ID,
      accountId: ACCOUNT_ID,
      side: 'P1',
      submit: async (submission) => ({
        schemaVersion: RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION,
        sequence: submission.sequence,
        chainDigest: '0'.repeat(64),
        receivedAt: new Date().toISOString(),
      }),
    });
    recorder.startRound(0);
    recorder.recordInput(0, 0, inputForFrame(0));
    recorder.finalizeRound(0, 0);
    await expect(recorder.flush()).rejects.toThrow(/receipt did not match/);
    expect(recorder.getDiagnostics().failed).toBe(true);
  });

  test('binds chunk identity and compact inputs into the digest', async () => {
    const identity = {
      sessionId: SESSION_ID,
      accountId: ACCOUNT_ID,
      side: 'P1' as const,
      sequence: 0,
      epoch: 0,
      startFrame: 0,
      roundFinal: true,
    };
    const first = await digestRankedInputCommitmentChunk(identity, [[0, 1, 3]]);
    const second = await digestRankedInputCommitmentChunk(identity, [[0, 1, 4]]);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
