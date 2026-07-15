import assert from 'node:assert/strict';
import test from 'node:test';
import type { RankedTerminalDecision } from './terminalDecisionStore';
import { resolveDurableRankedResultAccess } from './resultReadAccess';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';

function terminalDecision(overrides: Partial<RankedTerminalDecision> = {}): RankedTerminalDecision {
  return {
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decisionType: 'forfeit',
    participantP1AccountId: P1,
    participantP2AccountId: P2,
    winnerAccountId: P1,
    forfeitingAccountId: P2,
    reason: 'reconnect_timeout',
    dueAt: '2026-07-15T12:00:00.000Z',
    decidedAt: '2026-07-15T12:00:00.000Z',
    status: 'pending',
    attemptCount: 0,
    claimToken: null,
    leaseExpiresAt: null,
    nextAttemptAt: '2026-07-15T12:00:00.000Z',
    lastError: null,
    settledMatchId: null,
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

test('requires the live session path when no durable result exists', () => {
  assert.deepEqual(resolveDurableRankedResultAccess(P1, null, null), {
    hasDurableRecord: false,
    authorized: false,
  });
});

test('authorizes either participant from a terminal decision after runtime eviction', () => {
  assert.deepEqual(resolveDurableRankedResultAccess(P2, terminalDecision(), null), {
    hasDurableRecord: true,
    authorized: true,
  });
});

test('authorizes either participant from a settled match after runtime eviction', () => {
  assert.deepEqual(resolveDurableRankedResultAccess(P1, null, {
    participantP1AccountId: P1,
    participantP2AccountId: P2,
  }), {
    hasDurableRecord: true,
    authorized: true,
  });
});

test('rejects an authenticated outsider when a durable result exists', () => {
  assert.deepEqual(resolveDurableRankedResultAccess(OUTSIDER, terminalDecision(), null), {
    hasDurableRecord: true,
    authorized: false,
  });
});

test('fails closed when terminal and settled records disagree about participants', () => {
  assert.throws(
    () => resolveDurableRankedResultAccess(P1, terminalDecision(), {
      participantP1AccountId: P1,
      participantP2AccountId: OUTSIDER,
    }),
    /disagree about session participants/,
  );
});
