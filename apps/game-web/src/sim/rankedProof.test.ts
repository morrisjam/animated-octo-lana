import { describe, expect, test } from 'vitest';
import { createAiController, tickAiController } from './ai';
import { computeStateChecksum } from './checksum';
import { createInitialState, step } from './sim';
import {
  RankedMatchProofRecorder,
  RANKED_FIXED_DT,
  verifyRankedMatchProof,
  type RankedMatchProof,
} from './rankedProof';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const BUILD_VERSION = 'alpha-test-build';
const RULESET_VERSION = 'prototype-2026.02';
const LOADOUT = { P1: 'vanguard', P2: 'duelist' } as const;

function createCompletedProof(): RankedMatchProof {
  const recorder = new RankedMatchProofRecorder({
    sessionId: SESSION_ID,
    matchId: SESSION_ID,
    buildVersion: BUILD_VERSION,
    rulesetVersion: RULESET_VERSION,
    balanceProfileId: 'default',
    seed: 123,
    loadout: LOADOUT,
  });

  for (let epoch = 0; epoch < 2; epoch += 1) {
    const state = createInitialState({
      seed: 123,
      loadout: LOADOUT,
      rules: { allowDunkWin: true },
    });
    let p1Controller = createAiController({ seed: 101, profileId: 'veteran' });
    let p2Controller = createAiController({ seed: 202, profileId: 'veteran' });
    recorder.startRound(epoch);
    for (let frame = 0; frame < 10_800; frame += 1) {
      const p1Tick = tickAiController(state, 'P1', p1Controller);
      const p2Tick = tickAiController(state, 'P2', p2Controller);
      p1Controller = p1Tick.next;
      p2Controller = p2Tick.next;
      recorder.recordInput(epoch, frame, 'P1', p1Tick.input);
      recorder.recordInput(epoch, frame, 'P2', p2Tick.input);
      step(state, { p1: p1Tick.input, p2: p2Tick.input }, RANKED_FIXED_DT);
      if (state.winner) {
        recorder.finalizeRound(epoch, frame, state.winner, computeStateChecksum(state));
        break;
      }
    }
  }

  return recorder.buildProof('p2_win');
}

describe('ranked match proof', () => {
  const completedProof = createCompletedProof();

  test('replays a complete best-of-three proof and derives the winner', async () => {
    const proof = structuredClone(completedProof);
    const result = await verifyRankedMatchProof(proof, {
      sessionId: SESSION_ID,
      matchId: SESSION_ID,
      buildVersion: BUILD_VERSION,
      rulesetVersion: RULESET_VERSION,
      balanceProfileId: 'default',
      seed: 123,
      loadout: LOADOUT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.derivedOutcome).toBe('p2_win');
    expect(result.roundWins).toEqual({ P1: 0, P2: 2 });
    expect(result.roundCount).toBe(2);
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.proofDigest).toMatch(/^[a-f0-9]{64}$/);
  }, 20_000);

  test('rejects a tampered input timeline even when the claimed winner is unchanged', async () => {
    const proof = structuredClone(completedProof);
    proof.rounds[0].inputs[0][0] = -proof.rounds[0].inputs[0][0];
    const result = await verifyRankedMatchProof(proof, {
      sessionId: SESSION_ID,
      matchId: SESSION_ID,
      buildVersion: BUILD_VERSION,
      rulesetVersion: RULESET_VERSION,
      balanceProfileId: 'default',
      seed: 123,
      loadout: LOADOUT,
    });

    expect(result.ok).toBe(false);
    if (result.ok !== false) {
      return;
    }
    expect(['checksum_mismatch', 'round_winner_mismatch', 'round_did_not_finish']).toContain(result.code);
  }, 20_000);

  test('rejects a proof from a different matched build before simulation', async () => {
    const proof = structuredClone(completedProof);
    const result = await verifyRankedMatchProof(proof, {
      sessionId: SESSION_ID,
      matchId: SESSION_ID,
      buildVersion: 'different-build',
      rulesetVersion: RULESET_VERSION,
      balanceProfileId: 'default',
      seed: 123,
      loadout: LOADOUT,
    });

    expect(result).toMatchObject({ ok: false, code: 'build_mismatch' });
  }, 20_000);
});
