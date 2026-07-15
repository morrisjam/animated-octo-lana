import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchSessionView } from '../matchmaking/queueService';
import {
  deriveRankedAuthoritativeResolution,
  deriveRankedTerminalDecision,
} from './authoritativeResolutionService';

const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function createSession(overrides: Partial<MatchSessionView> = {}): MatchSessionView {
  return {
    sessionId: SESSION_ID,
    queueType: 'ranked',
    region: 'eu-west',
    buildVersion: 'alpha-local',
    rulesetVersion: 'prototype-2026.02',
    balanceProfileId: 'default',
    status: 'resolved',
    resolvedReason: 'reconnect_timeout',
    resolvedAt: '2026-07-13T12:00:00.000Z',
    forfeitingAccountId: ACCOUNT_2,
    createdAt: '2026-07-13T11:55:00.000Z',
    expiresAt: '2026-07-13T12:25:00.000Z',
    reconnectGraceSeconds: 30,
    participants: [
      {
        accountId: ACCOUNT_1,
        queueTicketId: '44444444-4444-4444-8444-444444444444',
        side: 'P1',
        selectedCharacterId: 'vanguard',
        connectionStatus: 'connected',
        lastHeartbeatAt: '2026-07-13T11:59:59.000Z',
      },
      {
        accountId: ACCOUNT_2,
        queueTicketId: '55555555-5555-4555-8555-555555555555',
        side: 'P2',
        selectedCharacterId: 'duelist',
        connectionStatus: 'disconnected',
        lastHeartbeatAt: '2026-07-13T11:59:58.000Z',
      },
    ],
    ...overrides,
  };
}

test('derives a server-owned forfeit from a single ranked reconnect timeout', () => {
  const candidate = deriveRankedAuthoritativeResolution(createSession());
  assert.ok(candidate);
  assert.equal(candidate.matchId, SESSION_ID);
  assert.equal(candidate.forfeitingAccountId, ACCOUNT_2);
  assert.equal(candidate.winnerAccountId, ACCOUNT_1);
  assert.deepEqual(candidate.participants, [
    { accountId: ACCOUNT_1, side: 'P1' },
    { accountId: ACCOUNT_2, side: 'P2' },
  ]);
});

test('does not rate double disconnects, session expiry, completion, or unranked sessions', () => {
  assert.equal(deriveRankedAuthoritativeResolution(createSession({ forfeitingAccountId: undefined })), null);
  assert.equal(deriveRankedAuthoritativeResolution(createSession({ resolvedReason: 'session_expired' })), null);
  assert.equal(deriveRankedAuthoritativeResolution(createSession({ resolvedReason: 'completed' })), null);
  assert.equal(deriveRankedAuthoritativeResolution(createSession({ queueType: 'unranked' })), null);
});

test('attributes an explicit matched-ticket leave to the leaving participant', () => {
  const candidate = deriveRankedAuthoritativeResolution(createSession({
    resolvedReason: 'peer_left',
    forfeitingAccountId: ACCOUNT_1,
  }));
  assert.ok(candidate);
  assert.equal(candidate.reason, 'peer_left');
  assert.equal(candidate.forfeitingAccountId, ACCOUNT_1);
  assert.equal(candidate.winnerAccountId, ACCOUNT_2);
});

test('derives durable forfeit and no-contest terminal decisions', () => {
  assert.deepEqual(deriveRankedTerminalDecision(createSession()), {
    sessionId: SESSION_ID,
    decisionType: 'forfeit',
    participantP1AccountId: ACCOUNT_1,
    participantP2AccountId: ACCOUNT_2,
    winnerAccountId: ACCOUNT_1,
    forfeitingAccountId: ACCOUNT_2,
    reason: 'reconnect_timeout',
    dueAt: '2026-07-13T12:00:00.000Z',
    decidedAt: '2026-07-13T12:00:00.000Z',
  });
  assert.equal(
    deriveRankedTerminalDecision(createSession({ forfeitingAccountId: undefined }))?.decisionType,
    'no_contest',
  );
  assert.deepEqual(
    deriveRankedTerminalDecision(createSession({
      resolvedReason: 'session_expired',
      forfeitingAccountId: undefined,
    })),
    {
      sessionId: SESSION_ID,
      decisionType: 'no_contest',
      participantP1AccountId: ACCOUNT_1,
      participantP2AccountId: ACCOUNT_2,
      winnerAccountId: null,
      forfeitingAccountId: null,
      reason: 'session_expired',
      dueAt: '2026-07-13T12:00:00.000Z',
      decidedAt: '2026-07-13T12:00:00.000Z',
    },
  );
  assert.equal(deriveRankedTerminalDecision(createSession({ resolvedReason: 'completed' })), null);
  assert.equal(deriveRankedTerminalDecision(createSession({ queueType: 'unranked' })), null);
});
