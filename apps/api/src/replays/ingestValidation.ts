import type { MatchSessionView } from '../matchmaking/queueService';
import type { ReplayPayload } from './payload';
import {
  digestRankedMatchProof,
  encodeRankedInputFrame,
  RANKED_MATCH_PROOF_SCHEMA_VERSION,
  RANKED_SIMULATOR_VERSION,
  type RankedCompactInputFrame,
  type RankedMatchProof,
} from '../../../game-web/src/sim/rankedProof';
import type { FrameInput } from '../../../game-web/src/sim/types';

export const DEFAULT_REPLAY_INGEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const MIN_REPLAY_INGEST_BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_REPLAY_INGEST_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export type CompletedReplayOutcome = 'p1_win' | 'p2_win';
export type ReplayParticipantSide = 'P1' | 'P2';

export interface NormalisedReplayParticipant {
  accountId: string;
  side: ReplayParticipantSide;
  characterId: string;
  result: 'win' | 'loss' | 'draw' | 'forfeit';
}

export interface CanonicalReplayResult {
  outcome: CompletedReplayOutcome;
  winnerSide: ReplayParticipantSide;
  roundCount: number;
  frameCount: number;
}

export interface CanonicalReplayBindingInput {
  accountId: string;
  matchId: string;
  queueType: string;
  matchType: string;
  region: string;
  outcome: string;
  winnerAccountId: string | null;
  participants: NormalisedReplayParticipant[];
  payload: ReplayPayload;
  session: MatchSessionView;
}

export interface RankedReplaySettlement {
  matchId: string;
  sessionId: string;
  outcome: string;
  winnerAccountId: string | null;
  settlementSource: string;
  p1AccountId: string;
  p2AccountId: string;
  proofRoundCount: number | null;
  proofFrameCount: number | null;
  proofDerivedOutcome: string | null;
}

export interface RankedReplayProofBinding {
  proofDigest: string;
  proofPayload: unknown;
}

export interface ReplayArchiveIdentity {
  queueType: string;
  matchType: string;
  region: string;
  patchVersion: string;
  rulesetVersion: string;
  simBuildHash: string;
  outcome: string;
  winnerAccountId: string | null;
  payloadDigest: string;
  participants: NormalisedReplayParticipant[];
}

export type ReplayIngestValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fail<T>(error: string): ReplayIngestValidationResult<T> {
  return { ok: false, error };
}

export function resolveReplayIngestBodyLimitBytes(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return DEFAULT_REPLAY_INGEST_BODY_LIMIT_BYTES;
  }
  const parsed = Number(rawValue);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < MIN_REPLAY_INGEST_BODY_LIMIT_BYTES
    || parsed > MAX_REPLAY_INGEST_BODY_LIMIT_BYTES
  ) {
    throw new Error(
      'REPLAY_INGEST_BODY_LIMIT_BYTES must be an integer from 1048576 to 67108864.',
    );
  }
  return parsed;
}

function participantsBySide(
  participants: readonly NormalisedReplayParticipant[],
): Map<ReplayParticipantSide, NormalisedReplayParticipant> {
  return new Map(participants.map((participant) => [participant.side, participant]));
}

export function deriveCanonicalReplayResult(
  payload: ReplayPayload,
): ReplayIngestValidationResult<CanonicalReplayResult> {
  const rounds = payload.rounds;
  if (!payload.header.onlineMatch || !rounds || rounds.length < 2 || rounds.length > 3) {
    return fail('Canonical online replay must contain the completed best-of-three rounds.');
  }

  let p1Wins = 0;
  let p2Wins = 0;
  for (const [index, round] of rounds.entries()) {
    if (round.winner !== 'P1' && round.winner !== 'P2') {
      return fail(`Canonical replay round ${index + 1} must identify its winner.`);
    }
    if (p1Wins >= 2 || p2Wins >= 2) {
      return fail('Canonical replay contains rounds after the match was already decided.');
    }
    if (round.winner === 'P1') {
      p1Wins += 1;
    } else {
      p2Wins += 1;
    }
  }

  if ((p1Wins === 2) === (p2Wins === 2)) {
    return fail('Canonical replay rounds do not resolve to exactly one match winner.');
  }
  const winnerSide: ReplayParticipantSide = p1Wins === 2 ? 'P1' : 'P2';
  return {
    ok: true,
    value: {
      outcome: winnerSide === 'P1' ? 'p1_win' : 'p2_win',
      winnerSide,
      roundCount: rounds.length,
      frameCount: payload.inputTimeline.length,
    },
  };
}

export function validateCanonicalReplayBinding(
  input: CanonicalReplayBindingInput,
): ReplayIngestValidationResult<CanonicalReplayResult> {
  const identity = input.payload.header.onlineMatch;
  const loadout = input.payload.header.loadout;
  if (!identity || !loadout) {
    return fail('Canonical replay identity and loadout are required.');
  }
  if (
    identity.sessionId !== input.matchId
    || identity.matchId !== input.matchId
    || input.session.sessionId !== input.matchId
  ) {
    return fail('Replay matchId must exactly match its canonical matchmaking session identity.');
  }
  if (
    input.queueType !== input.session.queueType
    || input.matchType !== input.session.queueType
    || input.region !== input.session.region
  ) {
    return fail('Replay queue, match type, and region must match the matchmaking session.');
  }
  if (
    input.session.rulesetVersion
    && input.session.rulesetVersion !== input.payload.header.rulesetVersion
  ) {
    return fail('Replay ruleset does not match the matchmaking session.');
  }
  if (
    input.session.buildVersion
    && input.session.buildVersion !== input.payload.header.simBuildHash
  ) {
    return fail('Replay simulator build does not match the matchmaking session.');
  }
  if (
    input.session.balanceProfileId
    && input.session.balanceProfileId !== identity.balanceProfileId
  ) {
    return fail('Replay balance profile does not match the matchmaking session.');
  }

  const requestParticipants = participantsBySide(input.participants);
  if (requestParticipants.size !== 2 || input.session.participants.length !== 2) {
    return fail('Replay and matchmaking session must each contain exactly P1 and P2.');
  }
  for (const side of ['P1', 'P2'] as const) {
    const requestParticipant = requestParticipants.get(side);
    const sessionParticipant = input.session.participants.find((participant) => participant.side === side);
    if (!requestParticipant || !sessionParticipant) {
      return fail(`Replay is missing the ${side} participant.`);
    }
    if (
      requestParticipant.accountId !== sessionParticipant.accountId
      || requestParticipant.characterId !== loadout[side]
      || sessionParticipant.selectedCharacterId !== loadout[side]
    ) {
      return fail(`Replay ${side} account or character does not match the matchmaking handoff.`);
    }
  }
  if (!input.participants.some((participant) => participant.accountId === input.accountId)) {
    return fail('Authenticated account is not a canonical replay participant.');
  }

  const replayResult = deriveCanonicalReplayResult(input.payload);
  if (!replayResult.ok) {
    return replayResult;
  }
  const winner = requestParticipants.get(replayResult.value.winnerSide);
  const loser = requestParticipants.get(replayResult.value.winnerSide === 'P1' ? 'P2' : 'P1');
  if (
    input.outcome !== replayResult.value.outcome
    || !winner
    || !loser
    || input.winnerAccountId !== winner.accountId
    || winner.result !== 'win'
    || loser.result !== 'loss'
  ) {
    return fail('Replay outcome, winner, or participant results do not match its completed rounds.');
  }
  return replayResult;
}

export function validateRankedReplaySettlement(
  replay: CanonicalReplayBindingInput,
  replayResult: CanonicalReplayResult,
  settlement: RankedReplaySettlement,
): ReplayIngestValidationResult<CanonicalReplayResult> {
  const participants = participantsBySide(replay.participants);
  if (
    settlement.matchId !== replay.matchId
    || settlement.sessionId !== replay.matchId
    || settlement.outcome !== replayResult.outcome
    || settlement.winnerAccountId !== replay.winnerAccountId
    || settlement.settlementSource !== 'player_consensus'
    || settlement.p1AccountId !== participants.get('P1')?.accountId
    || settlement.p2AccountId !== participants.get('P2')?.accountId
  ) {
    return fail('Canonical ranked replay does not match the settled ranked match.');
  }
  if (
    settlement.proofRoundCount !== replayResult.roundCount
    || settlement.proofFrameCount !== replayResult.frameCount
    || settlement.proofDerivedOutcome !== replayResult.outcome
  ) {
    return fail('Canonical ranked replay dimensions or outcome do not match the verified ranked proof.');
  }
  return { ok: true, value: replayResult };
}

function compactInputsEqual(
  left: RankedCompactInputFrame,
  right: RankedCompactInputFrame,
): boolean {
  return left.every((value, index) => value === right[index]);
}

export async function validateRankedReplayProofBinding(
  replay: ReplayPayload,
  replayResult: CanonicalReplayResult,
  binding: RankedReplayProofBinding,
): Promise<ReplayIngestValidationResult<true>> {
  const identity = replay.header.onlineMatch;
  const loadout = replay.header.loadout;
  const rounds = replay.rounds;
  const proof = binding.proofPayload as Partial<RankedMatchProof> | null;
  if (!identity || !loadout || !rounds || !proof || typeof proof !== 'object') {
    return fail('Ranked replay or persisted proof is missing canonical identity data.');
  }
  let persistedDigest: string;
  try {
    persistedDigest = await digestRankedMatchProof(proof as RankedMatchProof);
  } catch {
    return fail('Persisted ranked proof payload is malformed.');
  }
  if (persistedDigest !== binding.proofDigest) {
    return fail('Persisted ranked proof payload does not match its proof digest.');
  }
  if (
    proof.schemaVersion !== RANKED_MATCH_PROOF_SCHEMA_VERSION
    || proof.simulatorVersion !== RANKED_SIMULATOR_VERSION
    || proof.sessionId !== identity.sessionId
    || proof.matchId !== identity.matchId
    || proof.buildVersion !== replay.header.simBuildHash
    || proof.rulesetVersion !== replay.header.rulesetVersion
    || proof.balanceProfileId !== identity.balanceProfileId
    || proof.tuningFingerprint !== identity.tuningFingerprint
    || proof.characterRegistryFingerprint !== identity.characterRegistryFingerprint
    || proof.seed !== replay.header.seed
    || proof.fixedDt !== replay.header.fixedDt
    || proof.loadout?.P1 !== loadout.P1
    || proof.loadout?.P2 !== loadout.P2
    || proof.claimedOutcome !== replayResult.outcome
  ) {
    return fail('Canonical ranked replay deterministic configuration does not match the verified proof.');
  }
  if (!Array.isArray(proof.rounds) || proof.rounds.length !== rounds.length) {
    return fail('Canonical ranked replay rounds do not match the verified proof.');
  }

  for (const [index, replayRound] of rounds.entries()) {
    const proofRound = proof.rounds[index];
    const startFrame = replayRound.startFrame;
    const endFrame = replayRound.endFrame;
    if (
      !proofRound
      || !Number.isSafeInteger(startFrame)
      || !Number.isSafeInteger(endFrame)
      || (endFrame as number) < startFrame
      || proofRound.epoch !== replayRound.epoch
      || proofRound.winner !== replayRound.winner
      || proofRound.finalChecksum !== replayRound.finalChecksum
    ) {
      return fail(`Canonical ranked replay round ${index + 1} does not match the verified proof.`);
    }
    const replayFrames = replay.inputTimeline.slice(startFrame, (endFrame as number) + 1);
    if (replayFrames.length !== proofRound.inputs.length) {
      return fail(`Canonical ranked replay round ${index + 1} frame count does not match the verified proof.`);
    }
    for (const [frameIndex, frame] of replayFrames.entries()) {
      const replayInput = encodeRankedInputFrame(frame as FrameInput);
      if (!compactInputsEqual(replayInput, proofRound.inputs[frameIndex])) {
        return fail(
          `Canonical ranked replay round ${index + 1} input ${frameIndex} does not match the verified proof.`,
        );
      }
    }
  }
  return { ok: true, value: true };
}

export function compareReplayArchiveIdentity(
  existing: ReplayArchiveIdentity,
  incoming: ReplayArchiveIdentity,
): ReplayIngestValidationResult<true> {
  for (const key of [
    'queueType',
    'matchType',
    'region',
    'patchVersion',
    'rulesetVersion',
    'simBuildHash',
    'outcome',
    'winnerAccountId',
    'payloadDigest',
  ] as const) {
    if (existing[key] !== incoming[key]) {
      return fail(`Existing replay ${key} does not match this peer submission.`);
    }
  }
  const existingBySide = participantsBySide(existing.participants);
  const incomingBySide = participantsBySide(incoming.participants);
  for (const side of ['P1', 'P2'] as const) {
    const left = existingBySide.get(side);
    const right = incomingBySide.get(side);
    if (
      !left
      || !right
      || left.accountId !== right.accountId
      || left.characterId !== right.characterId
      || left.result !== right.result
    ) {
      return fail(`Existing replay ${side} participant does not match this peer submission.`);
    }
  }
  return { ok: true, value: true };
}
