import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRankedResultSubmission } from './resultValidation';

const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_3 = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('marks submission as non-suspicious when session, participants, and winner align', () => {
  const evaluation = evaluateRankedResultSubmission(
    {
      sessionId: SESSION_ID,
      participantAccountIds: [ACCOUNT_1, ACCOUNT_2],
    },
    {
      submittedByAccountId: ACCOUNT_1,
      matchId: SESSION_ID,
      participantAccountIds: [ACCOUNT_2, ACCOUNT_1],
      winnerAccountId: ACCOUNT_1,
    },
  );

  assert.equal(evaluation.suspicious, false);
  assert.deepEqual(evaluation.reasons, []);
});

test('flags match id mismatch', () => {
  const evaluation = evaluateRankedResultSubmission(
    {
      sessionId: SESSION_ID,
      participantAccountIds: [ACCOUNT_1, ACCOUNT_2],
    },
    {
      submittedByAccountId: ACCOUNT_1,
      matchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      participantAccountIds: [ACCOUNT_1, ACCOUNT_2],
      winnerAccountId: ACCOUNT_1,
    },
  );

  assert.equal(evaluation.suspicious, true);
  assert.ok(evaluation.reasons.includes('match_id_mismatch'));
});

test('flags participant payload mismatch and winner outside expected session', () => {
  const evaluation = evaluateRankedResultSubmission(
    {
      sessionId: SESSION_ID,
      participantAccountIds: [ACCOUNT_1, ACCOUNT_2],
    },
    {
      submittedByAccountId: ACCOUNT_1,
      matchId: SESSION_ID,
      participantAccountIds: [ACCOUNT_1, ACCOUNT_3],
      winnerAccountId: ACCOUNT_3,
    },
  );

  assert.equal(evaluation.suspicious, true);
  assert.ok(evaluation.reasons.includes('participants_mismatch'));
  assert.ok(evaluation.reasons.includes('winner_not_in_session'));
});

test('flags submissions where caller omits themselves from payload participants', () => {
  const evaluation = evaluateRankedResultSubmission(
    {
      sessionId: SESSION_ID,
      participantAccountIds: [ACCOUNT_1, ACCOUNT_2],
    },
    {
      submittedByAccountId: ACCOUNT_1,
      matchId: SESSION_ID,
      participantAccountIds: [ACCOUNT_2],
      winnerAccountId: null,
    },
  );

  assert.equal(evaluation.suspicious, true);
  assert.ok(evaluation.reasons.includes('participants_mismatch'));
  assert.ok(evaluation.reasons.includes('submitter_not_in_payload'));
});
