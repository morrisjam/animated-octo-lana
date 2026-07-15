import { resolveBalanceProfile } from './balanceProfiles';
import type { CharacterId } from './characters';
import {
  decodeRankedInputFrame,
  verifyRankedMatchProof,
  type RankedMatchProof,
  type RankedMatchProofExpectation,
} from './rankedProof';
import {
  buildReplayReviewDataFromRounds,
  type ReplayReviewData,
  type ReplayReviewRoundSource,
} from './replayReview';
import { createInitialState } from './sim';

export const STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION = 'gw.local-ranked-proof-review.v1';

export interface RankedProofVerificationReceipt {
  digest: string;
  simulatorVersion: string;
  roundCount: number;
  frameCount: number;
  derivedOutcome: 'p1_win' | 'p2_win';
}

export interface StoredRankedProofReview {
  schemaVersion: typeof STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION;
  savedAt: string;
  proof: RankedMatchProof;
  verification: RankedProofVerificationReceipt;
}

export type StoredRankedProofReviewParseResult =
  | { ok: true; record: StoredRankedProofReview }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectationFromRawProof(rawProof: unknown): RankedMatchProofExpectation | null {
  if (!isRecord(rawProof) || !isRecord(rawProof.loadout)) {
    return null;
  }
  const requiredStrings = [
    rawProof.sessionId,
    rawProof.matchId,
    rawProof.buildVersion,
    rawProof.rulesetVersion,
    rawProof.balanceProfileId,
    rawProof.loadout.P1,
    rawProof.loadout.P2,
  ];
  if (requiredStrings.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    return null;
  }
  if (typeof rawProof.seed !== 'number' || !Number.isInteger(rawProof.seed)) {
    return null;
  }
  return {
    sessionId: String(rawProof.sessionId).trim(),
    matchId: String(rawProof.matchId).trim(),
    buildVersion: String(rawProof.buildVersion).trim(),
    rulesetVersion: String(rawProof.rulesetVersion).trim(),
    balanceProfileId: String(rawProof.balanceProfileId).trim(),
    seed: rawProof.seed,
    loadout: {
      P1: String(rawProof.loadout.P1).trim() as CharacterId,
      P2: String(rawProof.loadout.P2).trim() as CharacterId,
    },
  };
}

function parseReceipt(value: unknown): RankedProofVerificationReceipt | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.digest)
    || typeof value.simulatorVersion !== 'string'
    || !Number.isInteger(value.roundCount)
    || !Number.isInteger(value.frameCount)
    || (value.derivedOutcome !== 'p1_win' && value.derivedOutcome !== 'p2_win')
  ) {
    return null;
  }
  return {
    digest: value.digest,
    simulatorVersion: value.simulatorVersion,
    roundCount: Number(value.roundCount),
    frameCount: Number(value.frameCount),
    derivedOutcome: value.derivedOutcome,
  };
}

export function createStoredRankedProofReview(
  proof: RankedMatchProof,
  verification: RankedProofVerificationReceipt,
  savedAt = new Date().toISOString(),
): StoredRankedProofReview {
  return {
    schemaVersion: STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION,
    savedAt,
    proof,
    verification: { ...verification },
  };
}

export async function parseStoredRankedProofReview(
  raw: unknown,
): Promise<StoredRankedProofReviewParseResult> {
  if (!isRecord(raw) || raw.schemaVersion !== STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION) {
    return { ok: false, message: 'No compatible local ranked proof is available.' };
  }
  if (typeof raw.savedAt !== 'string' || Number.isNaN(Date.parse(raw.savedAt))) {
    return { ok: false, message: 'The local ranked proof has an invalid saved timestamp.' };
  }
  const receipt = parseReceipt(raw.verification);
  const expectation = expectationFromRawProof(raw.proof);
  if (!receipt || !expectation) {
    return { ok: false, message: 'The local ranked proof record is incomplete.' };
  }

  const verification = await verifyRankedMatchProof(raw.proof, expectation);
  if (verification.ok === false) {
    return { ok: false, message: `The local ranked proof failed replay verification (${verification.code}).` };
  }
  if (
    receipt.digest !== verification.proofDigest
    || receipt.simulatorVersion !== verification.proof.simulatorVersion
    || receipt.roundCount !== verification.roundCount
    || receipt.frameCount !== verification.frameCount
    || receipt.derivedOutcome !== verification.derivedOutcome
  ) {
    return { ok: false, message: 'The local ranked proof does not match its server verification receipt.' };
  }

  return {
    ok: true,
    record: {
      schemaVersion: STORED_RANKED_PROOF_REVIEW_SCHEMA_VERSION,
      savedAt: raw.savedAt,
      proof: verification.proof,
      verification: receipt,
    },
  };
}

export function buildRankedProofReviewData(proof: RankedMatchProof): ReplayReviewData {
  const profile = resolveBalanceProfile(proof.balanceProfileId);
  if (profile.id !== proof.balanceProfileId) {
    throw new Error(`Balance profile ${proof.balanceProfileId} is unavailable for ranked proof review.`);
  }

  const sources: ReplayReviewRoundSource[] = proof.rounds.map((round, index) => {
    const initialState = createInitialState({
      seed: proof.seed,
      loadout: proof.loadout,
      rules: { allowDunkWin: true },
    });
    initialState.tuning = { ...profile.tuning };
    return {
      label: `Round ${index + 1} - ${round.winner} won`,
      initialState,
      inputs: round.inputs.map(decodeRankedInputFrame),
    };
  });

  return buildReplayReviewDataFromRounds(sources, proof.fixedDt);
}
