import assert from 'node:assert/strict';
import test from 'node:test';
import { createRankedInputCommitmentFixture, createRankedProofFixture } from '../../scripts/rankedProofFixture';
import { deriveRankedInputCommitmentChainDigest, RankedInputCommitmentRecorder,
  RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION } from '../../../game-web/src/sim/rankedInputCommitment';
import { decodeRankedInputFrame } from '../../../game-web/src/sim/rankedProof';
import { canAdvanceOnlineSimulation } from '../../../game-web/src/net/onlinePredictionWindow';
import {
  resolveMinimumRankedInputObservationRatio,
  verifyRankedInputCommitmentCoverage,
  type StoredRankedInputCommitment,
} from './inputCommitmentStore';
import type { PlayerId } from '../../../game-web/src/sim/types';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const BUILD_VERSION = 'alpha-input-commitment-test';
const RULESET_VERSION = 'prototype-2026.02';
const proof = createRankedProofFixture({
  sessionId: SESSION_ID,
  buildVersion: BUILD_VERSION,
  rulesetVersion: RULESET_VERSION,
});

test('requires wall-clock observation only in production', () => {
  assert.equal(resolveMinimumRankedInputObservationRatio({ NODE_ENV: 'production' }), 0.25);
  assert.equal(resolveMinimumRankedInputObservationRatio({ NODE_ENV: 'test' }), 0);
  assert.equal(resolveMinimumRankedInputObservationRatio({ NODE_ENV: 'development' }), 0);
});

test('bounded prediction resumes after a confirmation stall without violating production commitment cadence', { timeout: 5000 }, async () => {
  const coverageProof = structuredClone(proof);
  const sourceRound = coverageProof.rounds[0]!;
  coverageProof.rounds = [{ ...sourceRound, inputs: Array.from({ length: 1000 }, (_, frame) => (
    structuredClone(sourceRound.inputs[frame % sourceRound.inputs.length]!)
  )) }];
  let elapsedMs = 0;
  const commitments: StoredRankedInputCommitment[] = [];
  const recorder = new RankedInputCommitmentRecorder({
    sessionId: SESSION_ID, accountId: ACCOUNT_ID, side: 'P1',
    submit: async (submission) => {
      const chainDigest = await deriveRankedInputCommitmentChainDigest(submission);
      const receivedAt = new Date(1_700_000_000_000 + elapsedMs).toISOString();
      commitments.push({ ...submission, chainDigest, receivedAt });
      return { schemaVersion: RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION,
        sequence: submission.sequence, chainDigest, receivedAt };
    },
  });
  recorder.startRound(0);
  let frame = 0;
  let stalledTicks = 0;
  for (let tick = 0; tick < 5000 && frame < 1000; tick += 1) {
    elapsedMs += coverageProof.fixedDt * 1000;
    const confirmedThrough = frame >= 180 && elapsedMs < 10_000 ? 179 : frame - 1;
    if (!canAdvanceOnlineSimulation(frame, confirmedThrough)) {
      stalledTicks += 1;
      continue;
    }
    recorder.recordInput(0, frame,
      decodeRankedInputFrame(coverageProof.rounds[0]!.inputs[frame]!).p1, confirmedThrough);
    frame += 1;
    // Let hashing and receipt delivery complete at this simulated wall-clock tick.
    while (recorder.getDiagnostics().queuedChunks > 0) {
      assert.equal(recorder.getDiagnostics().failed, false);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  assert.equal(frame, 1000);
  assert.ok(stalledTicks > 0);
  recorder.finalizeRound(0, 999);
  await recorder.flush();
  const result = await verifyRankedInputCommitmentCoverage({
    proof: coverageProof, accountId: ACCOUNT_ID, side: 'P1', commitments, minimumObservationRatio: 0.25,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('reserves the archival frame so terminal flush cannot become a 241-frame production burst', async () => {
  const coverageProof = structuredClone(proof);
  const template = coverageProof.rounds[0]!;
  const compact = template.inputs[0]!;
  coverageProof.rounds = [
    { ...template, inputs: [compact] },
    { ...template, inputs: Array.from({ length: 240 }, () => structuredClone(compact)) },
  ];
  let elapsedMs = 0;
  const commitments: StoredRankedInputCommitment[] = [];
  const recorder = new RankedInputCommitmentRecorder({
    sessionId: SESSION_ID, accountId: ACCOUNT_ID, side: 'P1',
    submit: async (submission) => {
      const chainDigest = await deriveRankedInputCommitmentChainDigest(submission);
      const receivedAt = new Date(1_700_000_000_000 + elapsedMs).toISOString();
      commitments.push({ ...submission, chainDigest, receivedAt });
      return { schemaVersion: RANKED_INPUT_COMMITMENT_RECEIPT_SCHEMA_VERSION,
        sequence: submission.sequence, chainDigest, receivedAt };
    },
  });
  const input = decodeRankedInputFrame(compact).p1;
  recorder.startRound(0);
  recorder.recordInput(0, 0, input, -1);
  recorder.finalizeRound(0, 0);
  await recorder.flush();
  elapsedMs = 2000;
  recorder.startRound(1);
  let archive = -1;
  for (let frame = 0; frame < 240; frame += 1) {
    const mutual = Math.max(-1, frame - 119);
    assert.equal(canAdvanceOnlineSimulation(frame, mutual), true);
    recorder.recordInput(1, frame, input, archive);
    archive = mutual;
  }
  assert.equal(archive, 120);
  assert.equal(canAdvanceOnlineSimulation(240, archive), false);
  recorder.finalizeRound(1, 239);
  await recorder.flush();
  assert.deepEqual(commitments.map((chunk) => chunk.endFrame - chunk.startFrame + 1), [1, 120, 120]);
  const result = await verifyRankedInputCommitmentCoverage({
    proof: coverageProof, accountId: ACCOUNT_ID, side: 'P1', commitments, minimumObservationRatio: 0.25,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

async function storedCommitments(
  side: PlayerId = 'P1',
  timestampStepMs = 2_000,
): Promise<StoredRankedInputCommitment[]> {
  const submissions = await createRankedInputCommitmentFixture(proof, ACCOUNT_ID, side);
  return await Promise.all(submissions.map(async (submission) => ({
    ...submission,
    chainDigest: await deriveRankedInputCommitmentChainDigest(submission),
    receivedAt: new Date(1_700_000_000_000 + submission.sequence * timestampStepMs).toISOString(),
  })));
}

test('accepts complete server-observed commitments for one proof participant', async () => {
  const commitments = await storedCommitments();
  const result = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments,
    minimumObservationRatio: 0.25,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.attestation.committedFrameCount, proof.rounds.reduce(
    (total, round) => total + round.inputs.length,
    0,
  ));
  assert.equal(result.attestation.commitmentCount, commitments.length);
  assert.match(result.attestation.finalChainDigest, /^[0-9a-f]{64}$/);
});

test('rejects commitments when the submitted proof changes local input', async () => {
  const commitments = await storedCommitments();
  const tamperedProof = structuredClone(proof);
  tamperedProof.rounds[0]!.inputs[0]![0] = tamperedProof.rounds[0]!.inputs[0]![0] === 0 ? 1 : 0;
  const result = await verifyRankedInputCommitmentCoverage({
    proof: tamperedProof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments,
    minimumObservationRatio: 0,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'commitment_digest_mismatch');
  }
});

test('rejects missing terminal coverage and altered chains', async () => {
  const commitments = await storedCommitments();
  const incomplete = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments: commitments.slice(0, -1),
    minimumObservationRatio: 0,
  });
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) {
    assert.equal(incomplete.code, 'commitment_coverage_incomplete');
  }

  const altered = structuredClone(commitments);
  altered[0]!.chainDigest = '0'.repeat(64);
  const invalidChain = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments: altered,
    minimumObservationRatio: 0,
  });
  assert.equal(invalidChain.ok, false);
  if (!invalidChain.ok) {
    assert.equal(invalidChain.code, 'commitment_chain_invalid');
  }
});

test('enforces the production observation ratio independently of proof coverage', async () => {
  const commitments = await storedCommitments('P1', 0);
  const result = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments,
    minimumObservationRatio: 0.25,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'commitment_observation_insufficient');
  }
});

test('rejects a wait-then-burst stream that satisfies only the aggregate observation ratio', async () => {
  const commitments = await storedCommitments('P1', 0);
  const firstChunkFrames = commitments[0]!.endFrame - commitments[0]!.startFrame + 1;
  const committedFrameCount = proof.rounds.reduce((total, round) => total + round.inputs.length, 0);
  const minimumObservationRatio = 0.25;
  const requiredAggregateDurationMs = Math.ceil(
    (committedFrameCount - firstChunkFrames) * proof.fixedDt * 1_000 * minimumObservationRatio,
  );
  const firstReceiptMs = Date.parse(commitments[0]!.receivedAt);
  for (let index = 1; index < commitments.length; index += 1) {
    commitments[index]!.receivedAt = new Date(firstReceiptMs + requiredAggregateDurationMs).toISOString();
  }

  assert.ok(
    Date.parse(commitments.at(-1)!.receivedAt) - firstReceiptMs >= requiredAggregateDurationMs,
    'fixture must satisfy the legacy aggregate observation requirement',
  );
  const result = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments,
    minimumObservationRatio,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'commitment_observation_insufficient');
    assert.match(result.message, /bounded server-observation cadence/);
  }
});

test('accepts a legitimate two-chunk round-final flush within the burst allowance', async () => {
  const commitments = await storedCommitments();
  const roundFinalIndex = commitments.findIndex((commitment, index) => (
    index > 0
    && commitment.roundFinal
    && commitments[index - 1]!.epoch === commitment.epoch
  ));
  assert.ok(roundFinalIndex > 0, 'fixture must contain a multi-chunk round');
  commitments[roundFinalIndex]!.receivedAt = commitments[roundFinalIndex - 1]!.receivedAt;

  const result = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments,
    minimumObservationRatio: 0.25,
  });

  assert.equal(result.ok, true);
});

test('keeps accelerated local commitment verification cadence-free', async () => {
  const commitments = await storedCommitments('P1', 0);
  const result = await verifyRankedInputCommitmentCoverage({
    proof,
    accountId: ACCOUNT_ID,
    side: 'P1',
    commitments,
    minimumObservationRatio: 0,
  });

  assert.equal(result.ok, true);
});
