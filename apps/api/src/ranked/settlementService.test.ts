import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRankedSettlementPolicy } from './settlementService';

const P1_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const P2_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PARTICIPANTS = [
  { accountId: P1_ACCOUNT_ID, side: 'P1' as const },
  { accountId: P2_ACCOUNT_ID, side: 'P2' as const },
] as const;

test('accepts proof-consensus wins and attributed server forfeits', () => {
  assert.doesNotThrow(() => assertRankedSettlementPolicy({
    participants: [...PARTICIPANTS],
    outcome: 'p1_win',
    winnerAccountId: P1_ACCOUNT_ID,
    source: { kind: 'player_consensus', submissionId: 'submission-1' },
  }));
  assert.doesNotThrow(() => assertRankedSettlementPolicy({
    participants: [...PARTICIPANTS],
    outcome: 'forfeit',
    winnerAccountId: P2_ACCOUNT_ID,
    source: { kind: 'server_authoritative', resolutionId: 'resolution-1' },
  }));
});

test('keeps draws and client-declared forfeits out of player consensus', () => {
  assert.throws(() => assertRankedSettlementPolicy({
    participants: [...PARTICIPANTS],
    outcome: 'draw',
    winnerAccountId: null,
    source: { kind: 'player_consensus', submissionId: 'submission-1' },
  }), /draws are no-contest/);
  assert.throws(() => assertRankedSettlementPolicy({
    participants: [...PARTICIPANTS],
    outcome: 'forfeit',
    winnerAccountId: P1_ACCOUNT_ID,
    source: { kind: 'player_consensus', submissionId: 'submission-1' },
  }), /proof-replayed P1 or P2 win/);
});

test('rejects inconsistent winners, participant order, and source authority', () => {
  assert.throws(() => assertRankedSettlementPolicy({
    participants: [...PARTICIPANTS],
    outcome: 'p2_win',
    winnerAccountId: P1_ACCOUNT_ID,
    source: { kind: 'player_consensus', submissionId: 'submission-1' },
  }), /winner does not match/);
  assert.throws(() => assertRankedSettlementPolicy({
    participants: [PARTICIPANTS[1], PARTICIPANTS[0]],
    outcome: 'p1_win',
    winnerAccountId: P1_ACCOUNT_ID,
    source: { kind: 'player_consensus', submissionId: 'submission-1' },
  }), /ordered as P1 then P2/);
  assert.throws(() => assertRankedSettlementPolicy({
    participants: [...PARTICIPANTS],
    outcome: 'p1_win',
    winnerAccountId: P1_ACCOUNT_ID,
    source: { kind: 'server_authoritative', resolutionId: 'resolution-1' },
  }), /reserved for attributed forfeits/);
});
