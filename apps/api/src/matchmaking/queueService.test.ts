import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMatchmakingQueueService,
  type QueueTicketView,
} from './queueService';

const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_3 = '33333333-3333-4333-8333-333333333333';

function expectMatched(ticket: QueueTicketView): QueueTicketView & { status: 'matched' } {
  assert.equal(ticket.status, 'matched');
  assert.ok(ticket.matchStart);
  return ticket as QueueTicketView & { status: 'matched' };
}

function rankedMetadata(rating: number, mrPoints: number | null = null): { rankedSnapshot: { rating: number; mrPoints: number | null } } {
  return {
    rankedSnapshot: {
      rating,
      mrPoints,
    },
  };
}

test('matches only within same queue type', () => {
  const queue = createMatchmakingQueueService();

  const rankedTicket = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  });
  const unrankedTicket = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['us-east'],
  });

  assert.equal(rankedTicket.status, 'queued');
  assert.equal(unrankedTicket.status, 'queued');
});

test('applies region preferences when selecting a match region', () => {
  const queue = createMatchmakingQueueService();

  const ticketA = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['us-west', 'us-east'],
    playerMetadata: { displayName: 'Alpha' },
  });
  assert.equal(ticketA.status, 'queued');

  const ticketB = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['us-east', 'us-west'],
    playerMetadata: { displayName: 'Bravo' },
  });
  const matchedB = expectMatched(ticketB);
  assert.equal(matchedB.matchStart.region, 'us-east');

  const ticketAStatus = queue.getTicketForAccount(ticketA.ticketId, ACCOUNT_1);
  assert.ok(ticketAStatus);
  const matchedA = expectMatched(ticketAStatus);
  assert.equal(matchedA.matchStart.region, 'us-east');
});

test('ranked matchmaking expands allowed rating gap based on queue wait time', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    now: () => nowMs,
    rankedRatingInitialGap: 100,
    rankedRatingExpansionPerSecond: 10,
    rankedRatingMaxGap: 500,
  });

  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
    playerMetadata: rankedMetadata(1200),
  });
  assert.equal(first.status, 'queued');

  nowMs += 5_000;
  const second = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
    playerMetadata: rankedMetadata(1500),
  });
  assert.equal(second.status, 'queued');

  const secondPeek = queue.getTicketForAccount(second.ticketId, ACCOUNT_2);
  assert.ok(secondPeek);
  assert.equal(secondPeek.status, 'queued');

  nowMs += 40_000;
  const third = queue.join({
    accountId: ACCOUNT_3,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
    playerMetadata: rankedMetadata(1490),
  });
  const matchedThird = expectMatched(third);
  assert.equal(matchedThird.matchStart.diagnostics.skillTrack, 'rating');
  assert.equal(typeof matchedThird.matchStart.diagnostics.expectedGap, 'number');
  assert.equal(typeof matchedThird.matchStart.diagnostics.matchedGap, 'number');
  assert.ok((matchedThird.matchStart.diagnostics.expectedGap ?? 0) >= (matchedThird.matchStart.diagnostics.matchedGap ?? 0));
});

test('master track matchmaking enforces strict primary-region constraint before wait threshold', () => {
  let nowMs = 2_000_000;
  const queue = createMatchmakingQueueService({
    now: () => nowMs,
    rankedMasterInitialGap: 100,
    rankedMasterExpansionPerSecond: 10,
    rankedMasterMaxGap: 300,
    rankedMasterStrictRegionSeconds: 20,
  });

  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['us-east', 'us-west'],
    playerMetadata: rankedMetadata(1900, 1500),
  });
  assert.equal(first.status, 'queued');

  nowMs += 2_000;
  const second = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['us-west', 'us-east'],
    playerMetadata: rankedMetadata(1910, 1508),
  });
  assert.equal(second.status, 'queued');

  nowMs += 22_000;
  const third = queue.join({
    accountId: ACCOUNT_3,
    queueType: 'ranked',
    regionPreferences: ['us-west', 'us-east'],
    playerMetadata: rankedMetadata(1915, 1509),
  });
  const matchedThird = expectMatched(third);
  assert.equal(matchedThird.matchStart.diagnostics.skillTrack, 'master');
  assert.equal(matchedThird.matchStart.diagnostics.regionConstraintRelaxed, true);
});

test('match start payload includes session token and peer metadata', () => {
  const queue = createMatchmakingQueueService();

  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { displayName: 'First' },
  });
  assert.equal(first.status, 'queued');

  const second = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { displayName: 'Second' },
  });
  const matchedSecond = expectMatched(second);

  assert.ok(matchedSecond.matchStart.sessionToken);
  assert.ok(matchedSecond.matchStart.sessionTokenExpiresAt);
  assert.equal(matchedSecond.matchStart.queueType, 'unranked');
  assert.equal(matchedSecond.matchStart.region, 'eu-west');
  assert.equal(matchedSecond.matchStart.peer.accountId, ACCOUNT_1);
  assert.equal(matchedSecond.matchStart.peer.displayName, 'First');
  assert.ok(matchedSecond.matchStart.peer.queueTicketId);
});

test('leave ticket closes own ticket and peer ticket for matched session', () => {
  const queue = createMatchmakingQueueService();

  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  });
  assert.equal(first.status, 'queued');

  const second = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  });
  const matchedSecond = expectMatched(second);

  const leaveResult = queue.leaveTicket(matchedSecond.ticketId, ACCOUNT_2);
  assert.ok(leaveResult);
  assert.equal(leaveResult.status, 'closed');
  assert.equal(leaveResult.closedReason, 'left_queue');

  const peerState = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(peerState);
  assert.equal(peerState.status, 'closed');
  assert.equal(peerState.closedReason, 'peer_left');
});

test('ticket expires when no match arrives within configured TTL', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    ticketTtlSeconds: 2,
    now: () => nowMs,
  });

  const ticket = queue.join({
    accountId: ACCOUNT_3,
    queueType: 'unranked',
    regionPreferences: ['ap-southeast'],
  });
  assert.equal(ticket.status, 'queued');

  nowMs += 3_000;
  const expired = queue.getTicketForAccount(ticket.ticketId, ACCOUNT_3);
  assert.ok(expired);
  assert.equal(expired.status, 'closed');
  assert.equal(expired.closedReason, 'expired');
});

test('reconnect requires valid token and enforces one-time reconnect attempt id', () => {
  const queue = createMatchmakingQueueService();
  queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['us-east'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['us-east'],
  }));

  const sessionId = matched.matchStart.sessionId;
  const p2Token = matched.matchStart.sessionToken;
  const disconnectResult = queue.markSessionDisconnected(sessionId, ACCOUNT_2);
  assert.equal(disconnectResult.ok, true);

  const badTokenReconnect = queue.reconnectSession({
    sessionId,
    accountId: ACCOUNT_2,
    sessionToken: 'bad_token',
    reconnectAttemptId: 'attempt-1',
  });
  assert.equal(badTokenReconnect.ok, false);
  if (badTokenReconnect.ok) {
    throw new Error('Expected invalid token error');
  }
  assert.equal(badTokenReconnect.error.code, 'invalid_token');

  const reconnect = queue.reconnectSession({
    sessionId,
    accountId: ACCOUNT_2,
    sessionToken: p2Token,
    reconnectAttemptId: 'attempt-1',
  });
  assert.equal(reconnect.ok, true);

  const replayedAttempt = queue.reconnectSession({
    sessionId,
    accountId: ACCOUNT_2,
    sessionToken: p2Token,
    reconnectAttemptId: 'attempt-1',
  });
  assert.equal(replayedAttempt.ok, false);
  if (replayedAttempt.ok) {
    throw new Error('Expected replayed attempt error');
  }
  assert.equal(replayedAttempt.error.code, 'replayed_attempt');
});

test('validateSessionToken allows ranked participants with active matching token', () => {
  const queue = createMatchmakingQueueService();
  queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  }));

  const result = queue.validateSessionToken(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    matched.matchStart.sessionToken,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error('Expected token validation success');
  }
  assert.equal(result.value.queueType, 'ranked');
  assert.equal(result.value.participants.length, 2);
});

test('validateSessionToken rejects invalid token', () => {
  const queue = createMatchmakingQueueService();
  queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));

  const result = queue.validateSessionToken(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    'invalid-token',
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error('Expected invalid token error');
  }
  assert.equal(result.error.code, 'invalid_token');
});

test('validateSessionToken can allow resolved sessions and expired tokens for post-match flows', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    sessionTtlSeconds: 2,
    sessionTokenTtlSeconds: 1,
    now: () => nowMs,
  });
  queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));

  nowMs += 3_000;
  const strictResult = queue.validateSessionToken(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    matched.matchStart.sessionToken,
  );
  assert.equal(strictResult.ok, false);
  if (strictResult.ok) {
    throw new Error('Expected strict validation failure after session resolution.');
  }
  assert.equal(strictResult.error.code, 'session_resolved');

  const relaxedResult = queue.validateSessionToken(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    matched.matchStart.sessionToken,
    {
      allowResolved: true,
      allowExpiredToken: true,
    },
  );
  assert.equal(relaxedResult.ok, true);
  if (!relaxedResult.ok) {
    throw new Error('Expected relaxed validation success for post-match flow.');
  }
  assert.equal(relaxedResult.value.status, 'resolved');
});

test('reconnect attempt fails when session token expires', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    sessionTtlSeconds: 120,
    sessionTokenTtlSeconds: 2,
    now: () => nowMs,
  });
  queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['us-west'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['us-west'],
  }));
  const sessionId = matched.matchStart.sessionId;
  const token = matched.matchStart.sessionToken;

  nowMs += 3_000;
  const reconnect = queue.reconnectSession({
    sessionId,
    accountId: ACCOUNT_2,
    sessionToken: token,
    reconnectAttemptId: 'attempt-expired',
  });
  assert.equal(reconnect.ok, false);
  if (reconnect.ok) {
    throw new Error('Expected token expiry error');
  }
  assert.equal(reconnect.error.code, 'token_expired');
});

test('session resolves if disconnected player misses reconnect grace window', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });

  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const sessionId = second.matchStart.sessionId;

  const disconnected = queue.markSessionDisconnected(sessionId, ACCOUNT_1);
  assert.equal(disconnected.ok, true);

  nowMs += 3_000;
  const resolvedSession = queue.getSessionForAccount(sessionId, ACCOUNT_1);
  assert.ok(resolvedSession);
  assert.equal(resolvedSession.status, 'resolved');
  assert.equal(resolvedSession.resolvedReason, 'reconnect_timeout');

  const firstTicket = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicket);
  assert.equal(firstTicket.status, 'closed');
  assert.equal(firstTicket.closedReason, 'reconnect_timeout');

  const secondTicket = queue.getTicketForAccount(second.ticketId, ACCOUNT_2);
  assert.ok(secondTicket);
  assert.equal(secondTicket.status, 'closed');
  assert.equal(secondTicket.closedReason, 'reconnect_timeout');
});

test('session can be completed explicitly after a match finishes', () => {
  const queue = createMatchmakingQueueService({
    sessionTtlSeconds: 120,
  });

  queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const sessionId = second.matchStart.sessionId;
  const sessionToken = second.matchStart.sessionToken;

  const completion = queue.completeSession(sessionId, ACCOUNT_2, sessionToken);
  assert.equal(completion.ok, true);
  if (!completion.ok) {
    throw new Error('Expected session completion to succeed');
  }
  assert.equal(completion.value.status, 'resolved');
  assert.equal(completion.value.resolvedReason, 'completed');

  const firstTicket = queue.getTicketForAccount(completion.value.participants[0].queueTicketId, ACCOUNT_1);
  assert.ok(firstTicket);
  assert.equal(firstTicket.status, 'closed');
  assert.equal(firstTicket.closedReason, 'session_completed');

  const secondTicket = queue.getTicketForAccount(completion.value.participants[1].queueTicketId, ACCOUNT_2);
  assert.ok(secondTicket);
  assert.equal(secondTicket.status, 'closed');
  assert.equal(secondTicket.closedReason, 'session_completed');
});
