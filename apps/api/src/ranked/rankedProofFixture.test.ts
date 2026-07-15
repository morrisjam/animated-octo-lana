import assert from 'node:assert/strict';
import test from 'node:test';
import { createRankedProofFixture } from '../../scripts/rankedProofFixture';

test('ranked smoke proof remains a deterministic P1 win without opponent AI policy coupling', () => {
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
