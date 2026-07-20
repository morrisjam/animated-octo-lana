import {
  deriveRankedInputCommitmentChainDigest,
  digestRankedInputCommitmentChunk,
  extractRankedPlayerInput,
  parseRankedInputCommitmentSubmission,
  RANKED_INPUT_ATTESTATION_SCHEMA_VERSION,
  RANKED_INPUT_COMMITMENT_MAX_FRAMES,
  RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES,
  type RankedInputCommitmentSubmission,
} from '../../../game-web/src/sim/rankedInputCommitment';
import type { RankedMatchProof } from '../../../game-web/src/sim/rankedProof';
import type { PlayerId } from '../../../game-web/src/sim/types';

interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface RankedInputCommitmentDatabase {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
}

export interface StoredRankedInputCommitment extends RankedInputCommitmentSubmission {
  chainDigest: string;
  receivedAt: string;
}

export interface RankedInputParticipantAttestation {
  accountId: string;
  side: PlayerId;
  commitmentCount: number;
  committedFrameCount: number;
  observedDurationMs: number;
  observationRatio: number;
  finalChainDigest: string;
}

export interface RankedInputAttestation {
  schemaVersion: typeof RANKED_INPUT_ATTESTATION_SCHEMA_VERSION;
  minimumObservationRatio: number;
  participants: RankedInputParticipantAttestation[];
}

export type RankedInputCommitmentVerificationResult =
  | { ok: true; attestation: RankedInputParticipantAttestation }
  | {
    ok: false;
    code:
      | 'commitments_missing'
      | 'commitment_identity_mismatch'
      | 'commitment_chain_invalid'
      | 'commitment_coverage_incomplete'
      | 'commitment_digest_mismatch'
      | 'commitment_observation_insufficient';
    message: string;
  };

export class RankedInputCommitmentConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RankedInputCommitmentConflictError';
  }
}

const RANKED_INPUT_COMMITMENT_CADENCE_BURST_FRAMES =
  RANKED_INPUT_COMMITMENT_MAX_FRAMES + RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES;
const CADENCE_FRAME_TOLERANCE = 1e-6;

export function resolveMinimumRankedInputObservationRatio(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return env.NODE_ENV === 'production' ? 0.25 : 0;
}

export async function appendRankedInputCommitment(
  database: RankedInputCommitmentDatabase,
  rawSubmission: unknown,
): Promise<StoredRankedInputCommitment & { existing: boolean }> {
  const submission = parseRankedInputCommitmentSubmission(rawSubmission);
  if (!submission) {
    throw new TypeError('Ranked input commitment payload is invalid.');
  }

  const existingResult = await database.query(
    `
    SELECT
      session_id, account_id, player_side, sequence, epoch, start_frame, end_frame,
      round_final, chunk_digest, previous_chain_digest, chain_digest, received_at
    FROM ranked_input_commitments
    WHERE session_id = $1 AND account_id = $2 AND sequence = $3
    LIMIT 1
    FOR UPDATE
    `,
    [submission.sessionId, submission.accountId, submission.sequence],
  );
  if (existingResult.rows.length > 0) {
    const existing = mapCommitmentRow(existingResult.rows[0]);
    if (!sameSubmission(existing, submission)) {
      throw new RankedInputCommitmentConflictError(
        'Ranked input commitment sequence was already used for different evidence.',
      );
    }
    return { ...existing, existing: true };
  }

  const previousResult = await database.query(
    `
    SELECT
      session_id, account_id, player_side, sequence, epoch, start_frame, end_frame,
      round_final, chunk_digest, previous_chain_digest, chain_digest, received_at
    FROM ranked_input_commitments
    WHERE session_id = $1 AND account_id = $2
    ORDER BY sequence DESC
    LIMIT 1
    FOR UPDATE
    `,
    [submission.sessionId, submission.accountId],
  );
  const previous = previousResult.rows.length > 0
    ? mapCommitmentRow(previousResult.rows[0])
    : null;
  assertCommitmentContinuity(previous, submission);

  const chainDigest = await deriveRankedInputCommitmentChainDigest(submission);
  const inserted = await database.query(
    `
    INSERT INTO ranked_input_commitments(
      session_id, account_id, player_side, sequence, epoch, start_frame, end_frame,
      round_final, chunk_digest, previous_chain_digest, chain_digest
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING
      session_id, account_id, player_side, sequence, epoch, start_frame, end_frame,
      round_final, chunk_digest, previous_chain_digest, chain_digest, received_at
    `,
    [
      submission.sessionId,
      submission.accountId,
      submission.side,
      submission.sequence,
      submission.epoch,
      submission.startFrame,
      submission.endFrame,
      submission.roundFinal,
      submission.chunkDigest,
      submission.previousChainDigest,
      chainDigest,
    ],
  );
  if (inserted.rows.length !== 1) {
    throw new Error('Ranked input commitment insert returned no row.');
  }
  return { ...mapCommitmentRow(inserted.rows[0]), existing: false };
}

export async function loadRankedInputCommitments(
  database: RankedInputCommitmentDatabase,
  sessionId: string,
  accountId: string,
): Promise<StoredRankedInputCommitment[]> {
  const result = await database.query(
    `
    SELECT
      session_id, account_id, player_side, sequence, epoch, start_frame, end_frame,
      round_final, chunk_digest, previous_chain_digest, chain_digest, received_at
    FROM ranked_input_commitments
    WHERE session_id = $1 AND account_id = $2
    ORDER BY sequence ASC
    `,
    [sessionId, accountId],
  );
  return result.rows.map(mapCommitmentRow);
}

export async function verifyRankedInputCommitmentCoverage(args: {
  proof: RankedMatchProof;
  accountId: string;
  side: PlayerId;
  commitments: readonly StoredRankedInputCommitment[];
  minimumObservationRatio: number;
}): Promise<RankedInputCommitmentVerificationResult> {
  const { proof, accountId, side, commitments, minimumObservationRatio } = args;
  if (commitments.length === 0) {
    return failure('commitments_missing', 'No server-observed ranked input commitments were found.');
  }
  if (!Number.isFinite(minimumObservationRatio) || minimumObservationRatio < 0 || minimumObservationRatio > 1) {
    throw new TypeError('minimumObservationRatio must be between 0 and 1.');
  }

  let expectedEpoch = 0;
  let expectedFrame = 0;
  let previousChainDigest: string | null = null;
  let committedFrameCount = 0;
  let firstReceivedAtMs: number | null = null;
  let lastReceivedAtMs: number | null = null;
  let firstChunkFrames = 0;
  let cadenceLastReceivedAtMs: number | null = null;
  let cadenceAvailableFrames = RANKED_INPUT_COMMITMENT_CADENCE_BURST_FRAMES;

  for (let index = 0; index < commitments.length; index += 1) {
    const commitment = commitments[index];
    if (
      commitment.sessionId !== proof.sessionId
      || commitment.accountId !== accountId
      || commitment.side !== side
      || commitment.sequence !== index
    ) {
      return failure(
        'commitment_identity_mismatch',
        `Ranked input commitment ${index} does not match its session participant.`,
      );
    }
    if (
      commitment.epoch !== expectedEpoch
      || commitment.startFrame !== expectedFrame
      || commitment.previousChainDigest !== previousChainDigest
    ) {
      return failure(
        'commitment_coverage_incomplete',
        `Ranked input commitment ${index} is not contiguous with prior evidence.`,
      );
    }
    const round = proof.rounds[commitment.epoch];
    if (!round || commitment.endFrame >= round.inputs.length) {
      return failure(
        'commitment_coverage_incomplete',
        `Ranked input commitment ${index} references frames outside the verified proof.`,
      );
    }
    const compactInputs = round.inputs
      .slice(commitment.startFrame, commitment.endFrame + 1)
      .map((input) => extractRankedPlayerInput(input, side));
    const expectedChunkDigest = await digestRankedInputCommitmentChunk(commitment, compactInputs);
    if (expectedChunkDigest !== commitment.chunkDigest) {
      return failure(
        'commitment_digest_mismatch',
        `Ranked input commitment ${index} does not match the verified input timeline.`,
      );
    }
    const expectedChainDigest = await deriveRankedInputCommitmentChainDigest(commitment);
    if (expectedChainDigest !== commitment.chainDigest) {
      return failure(
        'commitment_chain_invalid',
        `Ranked input commitment ${index} has an invalid server-observed chain digest.`,
      );
    }

    const chunkFrames = commitment.endFrame - commitment.startFrame + 1;
    if (index === 0) {
      firstChunkFrames = chunkFrames;
    }
    committedFrameCount += chunkFrames;
    const receivedAtMs = Date.parse(commitment.receivedAt);
    if (!Number.isFinite(receivedAtMs) || (lastReceivedAtMs !== null && receivedAtMs < lastReceivedAtMs)) {
      return failure(
        'commitment_chain_invalid',
        `Ranked input commitment ${index} has an invalid observation timestamp.`,
      );
    }
    if (minimumObservationRatio > 0) {
      if (cadenceLastReceivedAtMs !== null) {
        const elapsedMs = receivedAtMs - cadenceLastReceivedAtMs;
        const replenishedFrames = elapsedMs
          / (proof.fixedDt * 1_000 * minimumObservationRatio);
        cadenceAvailableFrames = Math.min(
          RANKED_INPUT_COMMITMENT_CADENCE_BURST_FRAMES,
          cadenceAvailableFrames + replenishedFrames,
        );
      }
      if (chunkFrames > cadenceAvailableFrames + CADENCE_FRAME_TOLERANCE) {
        return failure(
          'commitment_observation_insufficient',
          `Ranked input commitment ${index} exceeds the bounded server-observation cadence.`,
        );
      }
      cadenceAvailableFrames = Math.max(0, cadenceAvailableFrames - chunkFrames);
      cadenceLastReceivedAtMs = receivedAtMs;
    }
    firstReceivedAtMs ??= receivedAtMs;
    lastReceivedAtMs = receivedAtMs;
    previousChainDigest = commitment.chainDigest;

    const isProofRoundFinal = commitment.endFrame === round.inputs.length - 1;
    if (commitment.roundFinal !== isProofRoundFinal) {
      return failure(
        'commitment_coverage_incomplete',
        `Ranked input commitment ${index} has an incorrect round boundary.`,
      );
    }
    if (commitment.roundFinal) {
      expectedEpoch += 1;
      expectedFrame = 0;
    } else {
      expectedFrame = commitment.endFrame + 1;
    }
  }

  const proofFrameCount = proof.rounds.reduce((total, round) => total + round.inputs.length, 0);
  if (
    expectedEpoch !== proof.rounds.length
    || expectedFrame !== 0
    || committedFrameCount !== proofFrameCount
    || !previousChainDigest
  ) {
    return failure(
      'commitment_coverage_incomplete',
      'Ranked input commitments do not cover every verified proof frame and round boundary.',
    );
  }

  const observedDurationMs = Math.max(0, (lastReceivedAtMs ?? 0) - (firstReceivedAtMs ?? 0));
  const observableTimelineMs = Math.max(
    0,
    (committedFrameCount - firstChunkFrames) * proof.fixedDt * 1_000,
  );
  const observationRatio = observableTimelineMs <= 0
    ? commitments.length > 1 ? 1 : 0
    : Math.min(1, observedDurationMs / observableTimelineMs);
  if (observationRatio + Number.EPSILON < minimumObservationRatio) {
    return failure(
      'commitment_observation_insufficient',
      `Ranked input commitment observation ratio ${observationRatio.toFixed(3)} is below the required ${minimumObservationRatio.toFixed(3)}.`,
    );
  }

  return {
    ok: true,
    attestation: {
      accountId,
      side,
      commitmentCount: commitments.length,
      committedFrameCount,
      observedDurationMs,
      observationRatio: Math.round(observationRatio * 10_000) / 10_000,
      finalChainDigest: previousChainDigest,
    },
  };
}

export function createRankedInputAttestation(
  minimumObservationRatio: number,
  participants: RankedInputParticipantAttestation[],
): RankedInputAttestation {
  return {
    schemaVersion: RANKED_INPUT_ATTESTATION_SCHEMA_VERSION,
    minimumObservationRatio,
    participants: [...participants].sort((first, second) => first.side.localeCompare(second.side)),
  };
}

function assertCommitmentContinuity(
  previous: StoredRankedInputCommitment | null,
  submission: RankedInputCommitmentSubmission,
): void {
  if (!previous) {
    if (
      submission.sequence !== 0
      || submission.epoch !== 0
      || submission.startFrame !== 0
      || submission.previousChainDigest !== null
    ) {
      throw new RankedInputCommitmentConflictError(
        'The first ranked input commitment must start sequence 0, epoch 0, frame 0.',
      );
    }
    return;
  }
  if (
    submission.sequence !== previous.sequence + 1
    || submission.previousChainDigest !== previous.chainDigest
    || submission.side !== previous.side
  ) {
    throw new RankedInputCommitmentConflictError(
      'Ranked input commitment does not continue the observed hash chain.',
    );
  }
  if (previous.roundFinal) {
    if (submission.epoch !== previous.epoch + 1 || submission.startFrame !== 0) {
      throw new RankedInputCommitmentConflictError(
        'Ranked input commitment after a round boundary must start the next epoch at frame 0.',
      );
    }
    return;
  }
  if (
    submission.epoch !== previous.epoch
    || submission.startFrame !== previous.endFrame + 1
  ) {
    throw new RankedInputCommitmentConflictError(
      'Ranked input commitment frames must be contiguous within an epoch.',
    );
  }
}

function sameSubmission(
  existing: StoredRankedInputCommitment,
  submission: RankedInputCommitmentSubmission,
): boolean {
  return existing.sessionId === submission.sessionId
    && existing.accountId === submission.accountId
    && existing.side === submission.side
    && existing.sequence === submission.sequence
    && existing.epoch === submission.epoch
    && existing.startFrame === submission.startFrame
    && existing.endFrame === submission.endFrame
    && existing.roundFinal === submission.roundFinal
    && existing.chunkDigest === submission.chunkDigest
    && existing.previousChainDigest === submission.previousChainDigest;
}

function mapCommitmentRow(value: unknown): StoredRankedInputCommitment {
  const row = asRecord(value);
  const parsed = parseRankedInputCommitmentSubmission({
    schemaVersion: 'gw.ranked-input-commitment.v1',
    sessionId: row.session_id,
    accountId: row.account_id,
    side: row.player_side,
    sequence: Number(row.sequence),
    epoch: Number(row.epoch),
    startFrame: Number(row.start_frame),
    endFrame: Number(row.end_frame),
    roundFinal: row.round_final,
    chunkDigest: row.chunk_digest,
    previousChainDigest: row.previous_chain_digest,
  });
  const chainDigest = requiredDigest(row.chain_digest, 'chain_digest');
  if (!parsed) {
    throw new Error('PostgreSQL returned an invalid ranked input commitment row.');
  }
  return {
    ...parsed,
    chainDigest,
    receivedAt: timestamp(row.received_at, 'received_at'),
  };
}

function failure(
  code: Exclude<RankedInputCommitmentVerificationResult, { ok: true }>['code'],
  message: string,
): RankedInputCommitmentVerificationResult {
  return { ok: false, code, message };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PostgreSQL returned an invalid ranked input commitment row.');
  }
  return value as Record<string, unknown>;
}

function requiredDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`PostgreSQL returned an invalid ${field}.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`PostgreSQL returned an invalid ${field}.`);
  }
  return date.toISOString();
}
