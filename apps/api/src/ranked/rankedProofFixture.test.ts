import assert from 'node:assert/strict';
import test from 'node:test';
import { createRankedProofFixture } from '../../scripts/rankedProofFixture';
import { BALANCE_PROFILE_IDS } from '../../../game-web/src/sim/balanceProfiles';
import { decodeRankedInputFrame, verifyRankedMatchProof } from '../../../game-web/src/sim/rankedProof';
import { RANKED_INPUT_COMMITMENT_MAX_FRAMES } from '../../../game-web/src/sim/rankedInputCommitment';

test('ranked smoke proof remains a deterministic P1 win without AI policy coupling', () => {
  const proof = createRankedProofFixture({
    sessionId: '11111111-1111-4111-8111-111111111111',
    buildVersion: 'fixture-build',
    rulesetVersion: 'fixture-rules',
  });

  assert.equal(proof.claimedOutcome, 'p1_win');
  assert.equal(proof.rounds.length, 2);
  assert.deepEqual(proof.rounds.map(({ winner }) => winner), ['P1', 'P1']);
  assert.ok(proof.rounds.every(({ inputs }) => inputs.length > 0));
});

for (const balanceProfileId of BALANCE_PROFILE_IDS) {
  test(`scripted proof replays a bounded finish with multi-chunk coverage: ${balanceProfileId}`, async () => {
    const options = {
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildVersion: 'fixture-build',
      rulesetVersion: 'prototype-2026.09',
      balanceProfileId,
    };
    const proof = createRankedProofFixture(options);
    assert.deepEqual(createRankedProofFixture(options), proof);
    for (const round of proof.rounds) {
      assert.equal(round.winner, 'P1');
      assert.ok(round.inputs.length > RANKED_INPUT_COMMITMENT_MAX_FRAMES);
      assert.ok(round.inputs.length < 1_800, 'scripted finish must complete within 30 seconds');
      let sawBoost = false;
      let sawDunk = false;
      for (const compact of round.inputs) {
        const { p1, p2 } = decodeRankedInputFrame(compact);
        assert.ok(Object.values(p2).every(value => value === 0 || value === false));
        assert.equal(p1.launch || p1.superBoost || p1.special || p1.parry || p1.breakLaunch, false);
        sawBoost ||= p1.boost;
        sawDunk ||= p1.dunk;
      }
      assert.ok(sawBoost && sawDunk, 'fixture must approach and finish through real inputs');
    }
    const result = await verifyRankedMatchProof(proof, {
      ...options, matchId: options.sessionId, seed: proof.seed, loadout: proof.loadout,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.equal(result.derivedOutcome, 'p1_win');
  });
}
