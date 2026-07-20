import { createAiController, tickAiController } from '../../game-web/src/sim/ai';
import { computeStateChecksum } from '../../game-web/src/sim/checksum';
import {
  deriveRankedInputCommitmentChainDigest,
  digestRankedInputCommitmentChunk,
  extractRankedPlayerInput,
  RANKED_INPUT_COMMITMENT_MAX_FRAMES,
  RANKED_INPUT_COMMITMENT_SCHEMA_VERSION,
  type RankedInputCommitmentSubmission,
} from '../../game-web/src/sim/rankedInputCommitment';
import {
  RankedMatchProofRecorder,
  RANKED_FIXED_DT,
  RANKED_MAX_FRAMES_PER_ROUND,
  rankedSeedFromSessionId,
  type RankedMatchProof,
} from '../../game-web/src/sim/rankedProof';
import { createInitialState, step } from '../../game-web/src/sim/sim';
import type { PlayerFrameInput } from '../../game-web/src/sim/types';
import type { PlayerId } from '../../game-web/src/sim/types';

export interface RankedProofFixtureOptions {
  sessionId: string;
  buildVersion: string;
  rulesetVersion: string;
  balanceProfileId?: string;
}

const PASSIVE_PLAYER_INPUT: PlayerFrameInput = {
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

export function createRankedProofFixture(options: RankedProofFixtureOptions): RankedMatchProof {
  const seed = rankedSeedFromSessionId(options.sessionId);
  const loadout = { P1: 'vanguard', P2: 'duelist' } as const;
  const recorder = new RankedMatchProofRecorder({
    sessionId: options.sessionId,
    matchId: options.sessionId,
    buildVersion: options.buildVersion,
    rulesetVersion: options.rulesetVersion,
    balanceProfileId: options.balanceProfileId ?? 'default',
    seed,
    loadout,
  });

  for (let epoch = 0; epoch < 2; epoch += 1) {
    const state = createInitialState({
      seed,
      loadout,
      rules: { allowDunkWin: true },
    });
    let p1Controller = createAiController({ seed: 101, profileId: 'ace' });
    recorder.startRound(epoch);
    let finalized = false;
    for (let frame = 0; frame < RANKED_MAX_FRAMES_PER_ROUND; frame += 1) {
      const p1Tick = tickAiController(state, 'P1', p1Controller);
      p1Controller = p1Tick.next;
      recorder.recordInput(epoch, frame, 'P1', p1Tick.input);
      recorder.recordInput(epoch, frame, 'P2', PASSIVE_PLAYER_INPUT);
      step(state, { p1: p1Tick.input, p2: PASSIVE_PLAYER_INPUT }, RANKED_FIXED_DT);
      if (!state.winner) {
        continue;
      }
      if (state.winner !== 'P1') {
        throw new Error(`Ranked proof fixture expected P1 but produced ${state.winner}.`);
      }
      recorder.finalizeRound(epoch, frame, state.winner, computeStateChecksum(state));
      finalized = true;
      break;
    }
    if (!finalized) {
      throw new Error(`Ranked proof fixture epoch ${epoch} did not finish within the frame budget.`);
    }
  }

  return recorder.buildProof('p1_win');
}

export async function createRankedInputCommitmentFixture(
  proof: RankedMatchProof,
  accountId: string,
  side: PlayerId,
): Promise<RankedInputCommitmentSubmission[]> {
  const commitments: RankedInputCommitmentSubmission[] = [];
  let sequence = 0;
  let previousChainDigest: string | null = null;

  for (const round of proof.rounds) {
    for (let startFrame = 0; startFrame < round.inputs.length; startFrame += RANKED_INPUT_COMMITMENT_MAX_FRAMES) {
      const endFrame = Math.min(
        round.inputs.length - 1,
        startFrame + RANKED_INPUT_COMMITMENT_MAX_FRAMES - 1,
      );
      const identity = {
        sessionId: proof.sessionId,
        accountId,
        side,
        sequence,
        epoch: round.epoch,
        startFrame,
        roundFinal: endFrame === round.inputs.length - 1,
      } as const;
      const compactInputs = round.inputs
        .slice(startFrame, endFrame + 1)
        .map((input) => extractRankedPlayerInput(input, side));
      const submission: RankedInputCommitmentSubmission = {
        ...identity,
        schemaVersion: RANKED_INPUT_COMMITMENT_SCHEMA_VERSION,
        endFrame,
        chunkDigest: await digestRankedInputCommitmentChunk(identity, compactInputs),
        previousChainDigest,
      };
      commitments.push(submission);
      previousChainDigest = await deriveRankedInputCommitmentChainDigest(submission);
      sequence += 1;
    }
  }

  return commitments;
}
