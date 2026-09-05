import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMatchmakingQueueService,
  MatchmakingCapacityError,
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

function waitingRankedPair(ticketTtlSeconds = 120) {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    now: () => nowMs,
    ticketTtlSeconds,
    rankedRatingInitialGap: 100,
    rankedRatingExpansionPerSecond: 10,
    rankedRatingMaxGap: 400,
  });
  const join = (accountId: string, rating: number) => queue.join({
    accountId, queueType: 'ranked', regionPreferences: ['eu-west'], playerMetadata: rankedMetadata(rating),
  });
  const first = join(ACCOUNT_1, 1200);
  const second = join(ACCOUNT_2, 1500);
  assert.equal(first.status, 'queued');
  assert.equal(second.status, 'queued');
  return { queue, first, second, join, advance: (ms: number) => { nowMs += ms; } };
}

test('polling matches waiting ranked tickets when their rating window widens without another join', () => {
  const { queue, first, second, advance } = waitingRankedPair();
  advance(19_000);
  assert.equal(queue.getTicketForAccount(first.ticketId, ACCOUNT_1)?.status, 'queued');
  advance(1_000);
  const match = expectMatched(queue.getTicketForAccount(first.ticketId, ACCOUNT_1)!);
  const peer = expectMatched(queue.getTicketForAccount(second.ticketId, ACCOUNT_2)!);
  assert.equal(match.matchStart.sessionId, peer.matchStart.sessionId);
  assert.equal(match.matchStart.diagnostics.matchedGap, 300);
  assert.equal(queue.getRuntimeSummary().activeSessions, 1);
});

test('rejoining an existing waiting ticket reevaluates the widened window idempotently', () => {
  const { queue, first, advance, join } = waitingRankedPair();
  advance(20_000);
  const match = expectMatched(join(ACCOUNT_1, 1200));
  assert.equal(match.ticketId, first.ticketId);
  assert.equal(join(ACCOUNT_1, 1200).matchStart?.sessionId, match.matchStart.sessionId);
  assert.equal(queue.getRuntimeSummary().residentTickets, 2);
  assert.equal(queue.getRuntimeSummary().activeSessions, 1);
});

test('polling expires tickets before attempting a widened match', () => {
  const { queue, first, second, advance } = waitingRankedPair(10);
  advance(20_000);
  assert.equal(queue.getTicketForAccount(first.ticketId, ACCOUNT_1)?.status, 'closed');
  assert.equal(queue.getTicketForAccount(second.ticketId, ACCOUNT_2)?.status, 'closed');
  assert.equal(queue.getRuntimeSummary().activeSessions, 0);
});

test('a different account cannot trigger matching by polling someone else\'s ticket', () => {
  const { queue, first, advance } = waitingRankedPair();
  advance(20_000);
  assert.equal(queue.getTicketForAccount(first.ticketId, ACCOUNT_3), null);
  assert.equal(queue.getRuntimeSummary().activeSessions, 0);
});

test('concurrent polls create exactly one session and the matched snapshot survives restore', async () => {
  const { queue, first, second, advance } = waitingRankedPair();
  advance(20_000);
  // The service mutation is synchronous; route leases serialize restore/mutate/persist across processes.
  const polls = await Promise.all(Array.from({ length: 40 }, (_, index) => Promise.resolve().then(() => (
    index % 2 === 0
      ? queue.getTicketForAccount(first.ticketId, ACCOUNT_1)
      : queue.getTicketForAccount(second.ticketId, ACCOUNT_2)
  ))));
  const sessionIds = new Set(polls.map((ticket) => expectMatched(ticket!).matchStart.sessionId));
  assert.equal(sessionIds.size, 1);
  assert.equal(queue.getRuntimeSummary().activeSessions, 1);
  const restored = createMatchmakingQueueService({ now: () => 1_020_000 });
  restored.restoreSnapshot(queue.exportSnapshot());
  assert.equal(restored.getTicketForAccount(first.ticketId, ACCOUNT_1)?.matchStart?.sessionId, [...sessionIds][0]);
  assert.equal(restored.getTicketForAccount(second.ticketId, ACCOUNT_2)?.matchStart?.sessionId, [...sessionIds][0]);
  assert.equal(restored.getRuntimeSummary().activeSessions, 1);
});

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

test('reports the current account queue ticket without creating or reviving one', () => {
  const queue = createMatchmakingQueueService();
  assert.equal(queue.getActiveTicketForAccountQueue(ACCOUNT_1, 'ranked'), null);

  const ticket = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  assert.equal(
    queue.getActiveTicketForAccountQueue(ACCOUNT_1, 'ranked')?.ticketId,
    ticket.ticketId,
  );

  queue.leaveTicket(ticket.ticketId, ACCOUNT_1);
  assert.equal(queue.getActiveTicketForAccountQueue(ACCOUNT_1, 'ranked'), null);
});

test('runtime summary and drain close queued tickets without interrupting active sessions', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    now: () => nowMs,
    sessionTtlSeconds: 60,
  });
  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const queued = queue.join({
    accountId: ACCOUNT_3,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
  });

  assert.deepEqual(queue.getRuntimeSummary(), {
    capturedAt: new Date(nowMs).toISOString(),
    residentTickets: 3,
    queuedTickets: 1,
    matchedTickets: 2,
    activeSessions: 1,
    resolvedSessions: 0,
    disconnectedParticipants: 0,
    readyForProcessReplacement: false,
  });
  assert.equal(queue.drainQueuedTickets(), 1);
  const drainedTicket = queue.getTicketForAccount(queued.ticketId, ACCOUNT_3);
  assert.ok(drainedTicket);
  assert.equal(drainedTicket.status, 'closed');
  assert.equal(drainedTicket.closedReason, 'service_draining');

  const activeSession = queue.getSessionForAccount(matched.matchStart.sessionId, ACCOUNT_2);
  assert.ok(activeSession);
  assert.equal(activeSession.status, 'active');
  assert.equal(queue.getRuntimeSummary().readyForProcessReplacement, false);

  const completion = queue.completeSession(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    matched.matchStart.sessionToken,
  );
  assert.equal(completion.ok, true);
  const firstTicketState = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicketState);
  const firstMatched = expectMatched(firstTicketState);
  assert.equal(queue.completeSession(
    matched.matchStart.sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  ).ok, true);
  nowMs += 1;
  const readySummary = queue.getRuntimeSummary();
  assert.equal(readySummary.queuedTickets, 0);
  assert.equal(readySummary.activeSessions, 0);
  assert.equal(readySummary.readyForProcessReplacement, true);

  const firstTicket = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicket);
  assert.equal(firstTicket.status, 'closed');
});

test('resident-ticket capacity preserves idempotent joins and reopens only after cleanup', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({
    maxResidentTickets: 2,
    closedTicketRetentionSeconds: 10,
    now: () => nowMs,
  });
  const retained = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  queue.leaveTicket(retained.ticketId, ACCOUNT_1);
  const active = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });

  assert.equal(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }).ticketId, active.ticketId);
  assert.throws(
    () => queue.join({
      accountId: ACCOUNT_3,
      queueType: 'ranked',
      regionPreferences: ['eu-west'],
    }),
    (error) => error instanceof MatchmakingCapacityError && error.maxResidentTickets === 2,
  );
  assert.equal(queue.getRuntimeSummary().residentTickets, 2);

  queue.leaveTicket(active.ticketId, ACCOUNT_2);
  nowMs += 10_001;
  assert.equal(queue.join({
    accountId: ACCOUNT_3,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }).status, 'queued');
  assert.equal(queue.getRuntimeSummary().residentTickets, 1);
});

test('oversized restored state remains available while refusing only new tickets', () => {
  const source = createMatchmakingQueueService({ maxResidentTickets: 3 });
  const first = source.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(source.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const third = source.join({
    accountId: ACCOUNT_3,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  });
  const restored = createMatchmakingQueueService({ maxResidentTickets: 2 });
  restored.restoreSnapshot(source.exportSnapshot());

  assert.equal(restored.getRuntimeSummary().residentTickets, 3);
  assert.equal(restored.join({
    accountId: ACCOUNT_3,
    queueType: 'ranked',
    regionPreferences: ['us-east'],
  }).ticketId, third.ticketId);
  assert.equal(
    restored.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_1)?.status,
    'active',
  );
  assert.throws(
    () => restored.join({
      accountId: '44444444-4444-4444-8444-444444444444',
      queueType: 'ranked',
      regionPreferences: ['us-east'],
    }),
    MatchmakingCapacityError,
  );
  assert.equal(restored.getTicketForAccount(first.ticketId, ACCOUNT_1)?.status, 'matched');
});

test('matches only clients with compatible build versions', () => {
  const queue = createMatchmakingQueueService();

  const alpha = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-1' },
  });
  const beta = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-2' },
  });

  assert.equal(alpha.status, 'queued');
  assert.equal(beta.status, 'queued');

  const compatibleAlpha = queue.join({
    accountId: ACCOUNT_3,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-1' },
  });
  expectMatched(compatibleAlpha);

  const betaStatus = queue.getTicketForAccount(beta.ticketId, ACCOUNT_2);
  assert.ok(betaStatus);
  assert.equal(betaStatus.status, 'queued');
});

test('matches only clients with compatible rulesets and balance profiles', () => {
  const queue = createMatchmakingQueueService();
  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    playerMetadata: {
      buildVersion: 'alpha-1',
      rulesetVersion: 'rules-a',
      balanceProfileId: 'default',
    },
  });
  const incompatible = queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    playerMetadata: {
      buildVersion: 'alpha-1',
      rulesetVersion: 'rules-b',
      balanceProfileId: 'default',
    },
  });
  const compatible = queue.join({
    accountId: ACCOUNT_3,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    playerMetadata: {
      buildVersion: 'alpha-1',
      rulesetVersion: 'rules-a',
      balanceProfileId: 'default',
    },
  });

  assert.equal(first.status, 'queued');
  assert.equal(incompatible.status, 'queued');
  const matched = expectMatched(compatible);
  assert.equal(matched.matchStart.buildVersion, 'alpha-1');
  assert.equal(matched.matchStart.rulesetVersion, 'rules-a');
  assert.equal(matched.matchStart.balanceProfileId, 'default');
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

test('default session and token remain valid several minutes after matching', () => {
  let nowMs = 1_000_000;
  const queue = createMatchmakingQueueService({ now: () => nowMs });
  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
  });
  const matched = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
  }));
  const firstMatched = expectMatched(
    queue.getTicketForAccount(first.ticketId, ACCOUNT_1) as QueueTicketView,
  );

  assert.equal(queue.getConfig().sessionTtlSeconds, 30 * 60);
  assert.equal(queue.getConfig().sessionTokenTtlSeconds, 30 * 60);
  const heartbeatStepMs = queue.getConfig().heartbeatIntervalSeconds * 1_000;
  const targetMs = nowMs + 5 * 60 * 1_000;
  while (nowMs < targetMs) {
    nowMs += heartbeatStepMs;
    assert.equal(queue.heartbeatSession(
      matched.matchStart.sessionId,
      ACCOUNT_1,
      firstMatched.matchStart.sessionToken,
    ).ok, true);
    assert.equal(queue.heartbeatSession(
      matched.matchStart.sessionId,
      ACCOUNT_2,
      matched.matchStart.sessionToken,
    ).ok, true);
  }

  const session = queue.getSessionForAccount(matched.matchStart.sessionId, ACCOUNT_2);
  assert.ok(session);
  assert.equal(session.status, 'active');
  assert.equal(queue.validateSessionToken(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    matched.matchStart.sessionToken,
  ).ok, true);
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

  const session = queue.getSessionForAccount(matchedSecond.matchStart.sessionId, ACCOUNT_2);
  assert.ok(session);
  assert.equal(session.resolvedReason, 'peer_left');
  assert.equal(session.forfeitingAccountId, ACCOUNT_2);
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

test('either participant advances one durable idempotent transport attempt observed by both peers', () => {
  const queue = createMatchmakingQueueService();
  const firstTicket = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const p2Ticket = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const p1TicketView = queue.getTicketForAccount(firstTicket.ticketId, ACCOUNT_1);
  assert.ok(p1TicketView);
  const account1Ticket = expectMatched(p1TicketView);
  const [p1Ticket, nonP1Ticket] = account1Ticket.matchStart.localPlayer.side === 'P1'
    ? [account1Ticket, p2Ticket]
    : [p2Ticket, account1Ticket];
  assert.equal(p1Ticket.matchStart.localPlayer.side, 'P1');
  assert.equal(nonP1Ticket.matchStart.localPlayer.side, 'P2');
  assert.deepEqual(p1Ticket.matchStart.transportAttempt, nonP1Ticket.matchStart.transportAttempt);
  const initialAttempt = p1Ticket.matchStart.transportAttempt;

  const advanced = queue.advanceTransportAttempt({
    sessionId: nonP1Ticket.matchStart.sessionId,
    accountId: nonP1Ticket.accountId,
    sessionToken: nonP1Ticket.matchStart.sessionToken,
    expectedGeneration: initialAttempt.generation,
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    throw new Error(advanced.error.message);
  }
  assert.equal(advanced.value.transportAttempt.generation, initialAttempt.generation + 1);
  assert.notEqual(advanced.value.transportAttempt.attemptId, initialAttempt.attemptId);

  const repeatedByPeer = queue.advanceTransportAttempt({
    sessionId: p1Ticket.matchStart.sessionId,
    accountId: p1Ticket.accountId,
    sessionToken: p1Ticket.matchStart.sessionToken,
    expectedGeneration: initialAttempt.generation,
  });
  assert.equal(repeatedByPeer.ok, true);
  if (!repeatedByPeer.ok) {
    throw new Error(repeatedByPeer.error.message);
  }
  assert.deepEqual(repeatedByPeer.value.transportAttempt, advanced.value.transportAttempt);

  const repeated = queue.advanceTransportAttempt({
    sessionId: p1Ticket.matchStart.sessionId,
    accountId: p1Ticket.accountId,
    sessionToken: p1Ticket.matchStart.sessionToken,
    expectedGeneration: initialAttempt.generation,
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) {
    throw new Error(repeated.error.message);
  }
  assert.deepEqual(repeated.value.transportAttempt, advanced.value.transportAttempt);

  const restored = createMatchmakingQueueService();
  restored.restoreSnapshot(queue.exportSnapshot());
  assert.deepEqual(
    restored.getSessionForAccount(
      p1Ticket.matchStart.sessionId,
      nonP1Ticket.accountId,
    )?.transportAttempt,
    advanced.value.transportAttempt,
  );
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

test('configured short session and token TTLs expire but can be relaxed for post-match flows', () => {
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

  const expiredTokenResult = queue.validateSessionToken(
    matched.matchStart.sessionId,
    ACCOUNT_2,
    matched.matchStart.sessionToken,
    { allowResolved: true },
  );
  assert.equal(expiredTokenResult.ok, false);
  if (expiredTokenResult.ok) {
    throw new Error('Expected token expiry after allowing the resolved session.');
  }
  assert.equal(expiredTokenResult.error.code, 'token_expired');

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
  if (!disconnected.ok) {
    throw new Error('Expected session disconnect to succeed');
  }
  const firstDeadline = disconnected.value.participants.find(
    ({ accountId }) => accountId === ACCOUNT_1,
  )?.reconnectDeadlineAt;
  assert.ok(firstDeadline);

  nowMs += 1_000;
  const duplicateDisconnect = queue.markSessionDisconnected(sessionId, ACCOUNT_1);
  assert.equal(duplicateDisconnect.ok, true);
  if (!duplicateDisconnect.ok) {
    throw new Error('Expected duplicate session disconnect to be idempotent');
  }
  assert.equal(
    duplicateDisconnect.value.participants.find(({ accountId }) => accountId === ACCOUNT_1)?.reconnectDeadlineAt,
    firstDeadline,
  );

  nowMs += 2_000;
  const resolvedSession = queue.getSessionForAccount(sessionId, ACCOUNT_1);
  assert.ok(resolvedSession);
  assert.equal(resolvedSession.status, 'resolved');
  assert.equal(resolvedSession.resolvedReason, 'reconnect_timeout');
  assert.equal(resolvedSession.forfeitingAccountId, ACCOUNT_1);
  assert.ok(resolvedSession.resolvedAt);

  const firstTicket = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicket);
  assert.equal(firstTicket.status, 'closed');
  assert.equal(firstTicket.closedReason, 'reconnect_timeout');

  const secondTicket = queue.getTicketForAccount(second.ticketId, ACCOUNT_2);
  assert.ok(secondTicket);
  assert.equal(secondTicket.status, 'closed');
  assert.equal(secondTicket.closedReason, 'reconnect_timeout');
});

test('authenticated heartbeats keep one participant alive while a silent peer forfeits', () => {
  let nowMs = 4_000_000;
  const queue = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
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
  const firstMatched = expectMatched(queue.getTicketForAccount(first.ticketId, ACCOUNT_1) as QueueTicketView);
  const sessionId = second.matchStart.sessionId;

  assert.equal(second.matchStart.heartbeatIntervalSeconds, 1);
  assert.equal(second.matchStart.heartbeatTimeoutSeconds, 3);
  nowMs += 2_000;
  assert.equal(queue.heartbeatSession(
    sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  ).ok, true);
  nowMs += 2_000;
  const aliveHeartbeat = queue.heartbeatSession(
    sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  );
  assert.equal(aliveHeartbeat.ok, true);
  if (!aliveHeartbeat.ok) {
    throw new Error('Expected connected participant heartbeat to succeed');
  }
  const silentPeer = aliveHeartbeat.value.participants.find(({ accountId }) => accountId === ACCOUNT_2);
  assert.equal(silentPeer?.connectionStatus, 'disconnected');
  assert.ok(silentPeer?.reconnectDeadlineAt);

  nowMs += 2_001;
  const resolved = queue.getSessionForAccount(sessionId, ACCOUNT_1);
  assert.ok(resolved);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedReason, 'reconnect_timeout');
  assert.equal(resolved.forfeitingAccountId, ACCOUNT_2);
});

test('heartbeat timeout requires nonce-protected reconnect before liveness resumes', () => {
  let nowMs = 5_000_000;
  const queue = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 4,
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
  const firstMatched = expectMatched(queue.getTicketForAccount(first.ticketId, ACCOUNT_1) as QueueTicketView);
  const sessionId = second.matchStart.sessionId;

  nowMs += 2_000;
  assert.equal(queue.heartbeatSession(
    sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  ).ok, true);
  nowMs += 2_000;
  assert.equal(queue.heartbeatSession(
    sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  ).ok, true);

  const staleHeartbeat = queue.heartbeatSession(
    sessionId,
    ACCOUNT_2,
    second.matchStart.sessionToken,
  );
  assert.equal(staleHeartbeat.ok, false);
  if (staleHeartbeat.ok) {
    throw new Error('Expected stale participant heartbeat to require reconnect');
  }
  assert.equal(staleHeartbeat.error.code, 'participant_disconnected');

  nowMs += 500;
  const reconnect = queue.reconnectSession({
    sessionId,
    accountId: ACCOUNT_2,
    sessionToken: second.matchStart.sessionToken,
    reconnectAttemptId: 'heartbeat-reconnect-1',
  });
  assert.equal(reconnect.ok, true);
  if (!reconnect.ok) {
    throw new Error('Expected heartbeat-expired participant to reconnect');
  }
  const reconnectedPeer = reconnect.value.participants.find(({ accountId }) => accountId === ACCOUNT_2);
  assert.equal(reconnectedPeer?.connectionStatus, 'connected');
  assert.equal(reconnectedPeer?.lastHeartbeatAt, new Date(nowMs).toISOString());
  assert.equal(queue.heartbeatSession(
    sessionId,
    ACCOUNT_2,
    second.matchStart.sessionToken,
  ).ok, true);
});

test('snapshot restore preserves heartbeat age and grants legacy snapshots a fresh timeout window', () => {
  let nowMs = 6_000_000;
  const original = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });
  original.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(original.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  nowMs += 2_000;
  assert.equal(original.heartbeatSession(
    second.matchStart.sessionId,
    ACCOUNT_2,
    second.matchStart.sessionToken,
  ).ok, true);
  const snapshot = original.exportSnapshot();
  assert.equal(
    snapshot.sessions[0]?.participants.find(({ accountId }) => accountId === ACCOUNT_2)?.lastHeartbeatAtMs,
    nowMs,
  );

  const restored = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });
  restored.restoreSnapshot(snapshot);
  assert.equal(
    restored.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_2)
      ?.participants.find(({ accountId }) => accountId === ACCOUNT_2)?.lastHeartbeatAt,
    new Date(nowMs).toISOString(),
  );

  const legacySnapshot = structuredClone(snapshot);
  for (const participant of legacySnapshot.sessions[0]?.participants ?? []) {
    delete participant.lastHeartbeatAtMs;
  }
  nowMs += 2_500;
  legacySnapshot.capturedAtMs = nowMs;
  const legacyRestored = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });
  legacyRestored.restoreSnapshot(legacySnapshot);
  const legacySession = legacyRestored.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_2);
  assert.equal(legacySession?.status, 'active');
  assert.equal(
    legacySession?.participants.find(({ accountId }) => accountId === ACCOUNT_2)?.lastHeartbeatAt,
    new Date(nowMs).toISOString(),
  );
});

test('heartbeat-derived reconnect deadlines and forfeits do not depend on restart discovery time', () => {
  const startedAtMs = 6_500_000;
  let nowMs = startedAtMs;
  const source = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });
  const first = source.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(source.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const firstMatched = expectMatched(
    source.getTicketForAccount(first.ticketId, ACCOUNT_1) as QueueTicketView,
  );
  nowMs += 2_000;
  assert.equal(source.heartbeatSession(
    second.matchStart.sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  ).ok, true);
  const snapshot = source.exportSnapshot();

  const expectedDisconnectedAt = new Date(startedAtMs + 3_000).toISOString();
  const expectedDeadline = new Date(startedAtMs + 5_000).toISOString();
  for (const restoreAtMs of [startedAtMs + 4_000, startedAtMs + 4_750]) {
    nowMs = restoreAtMs;
    const restored = createMatchmakingQueueService({
      heartbeatIntervalSeconds: 1,
      heartbeatTimeoutSeconds: 3,
      reconnectGraceSeconds: 2,
      sessionTtlSeconds: 60,
      now: () => nowMs,
    });
    restored.restoreSnapshot(structuredClone(snapshot));
    const silentPeer = restored.getSessionForAccount(
      second.matchStart.sessionId,
      ACCOUNT_2,
    )?.participants.find(({ accountId }) => accountId === ACCOUNT_2);
    assert.equal(silentPeer?.connectionStatus, 'disconnected');
    assert.equal(silentPeer?.disconnectedAt, expectedDisconnectedAt);
    assert.equal(silentPeer?.reconnectDeadlineAt, expectedDeadline);

    nowMs = startedAtMs + 5_001;
    const resolved = restored.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_1);
    assert.equal(resolved?.status, 'resolved');
    assert.equal(resolved?.resolvedReason, 'reconnect_timeout');
    assert.equal(resolved?.forfeitingAccountId, ACCOUNT_2);
    assert.equal(resolved?.resolvedAt, expectedDeadline);
  }

  nowMs = startedAtMs + 8_000;
  const lateRestore = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });
  lateRestore.restoreSnapshot(structuredClone(snapshot));
  const lateResolution = lateRestore.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_1);
  assert.equal(lateResolution?.resolvedReason, 'reconnect_timeout');
  assert.equal(lateResolution?.forfeitingAccountId, ACCOUNT_2);
  assert.equal(lateResolution?.resolvedAt, expectedDeadline);
});

test('double reconnect timeout resolves without assigning a ranked forfeit', () => {
  let nowMs = 2_000_000;
  const resolutions: Array<{ reason: string; forfeitingAccountId?: string }> = [];
  const queue = createMatchmakingQueueService({
    reconnectGraceSeconds: 2,
    sessionTtlSeconds: 60,
    now: () => nowMs,
    onSessionResolved: (_sessionId, reason, session) => resolutions.push({
      reason,
      forfeitingAccountId: session.forfeitingAccountId,
    }),
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

  assert.equal(queue.markSessionDisconnected(sessionId, ACCOUNT_1).ok, true);
  assert.equal(queue.markSessionDisconnected(sessionId, ACCOUNT_2).ok, true);
  nowMs += 3_000;

  const resolved = queue.getSessionForAccount(sessionId, ACCOUNT_1);
  assert.ok(resolved);
  assert.equal(resolved.resolvedReason, 'reconnect_timeout');
  assert.equal(resolved.forfeitingAccountId, undefined);
  assert.deepEqual(resolutions, [{ reason: 'reconnect_timeout', forfeitingAccountId: undefined }]);
});

test('an earlier session expiry wins over reconnect deadlines after delayed discovery', () => {
  const startedAtMs = 2_500_000;
  let nowMs = startedAtMs;
  const source = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 4,
    sessionTtlSeconds: 5,
    now: () => nowMs,
  });
  source.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(source.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const snapshot = source.exportSnapshot();

  nowMs = startedAtMs + 8_000;
  const restored = createMatchmakingQueueService({
    heartbeatIntervalSeconds: 1,
    heartbeatTimeoutSeconds: 3,
    reconnectGraceSeconds: 4,
    sessionTtlSeconds: 5,
    now: () => nowMs,
  });
  restored.restoreSnapshot(snapshot);
  const resolved = restored.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_1);
  assert.equal(resolved?.resolvedReason, 'session_expired');
  assert.equal(resolved?.forfeitingAccountId, undefined);
  assert.equal(resolved?.resolvedAt, new Date(startedAtMs + 5_000).toISOString());
});

test('snapshot restore preserves the authoritative forfeit account', () => {
  let nowMs = 3_000_000;
  const original = createMatchmakingQueueService({
    reconnectGraceSeconds: 1,
    sessionTtlSeconds: 60,
    now: () => nowMs,
  });
  original.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(original.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  assert.equal(original.markSessionDisconnected(second.matchStart.sessionId, ACCOUNT_2).ok, true);
  nowMs += 2_000;
  assert.equal(
    original.getSessionForAccount(second.matchStart.sessionId, ACCOUNT_1)?.forfeitingAccountId,
    ACCOUNT_2,
  );

  const restored = createMatchmakingQueueService({ now: () => nowMs });
  restored.restoreSnapshot(original.exportSnapshot());
  const restoredResolution = restored.getResolvedSessions().find(
    ({ sessionId }) => sessionId === second.matchStart.sessionId,
  );
  assert.ok(restoredResolution);
  assert.equal(restoredResolution.forfeitingAccountId, ACCOUNT_2);
  assert.equal(restoredResolution.resolvedReason, 'reconnect_timeout');
});

test('session resolves as completed only after both participants attest', () => {
  let nowMs = 7_000_000;
  const resolvedSessions: Array<{ sessionId: string; reason: string }> = [];
  const queue = createMatchmakingQueueService({
    sessionTtlSeconds: 120,
    now: () => nowMs,
    onSessionResolved: (sessionId, reason) => resolvedSessions.push({ sessionId, reason }),
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
  const firstTicketState = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicketState);
  const firstMatched = expectMatched(firstTicketState);

  const firstAttestation = queue.completeSession(
    sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  );
  assert.equal(firstAttestation.ok, true);
  if (!firstAttestation.ok) {
    throw new Error('Expected first completion attestation to succeed');
  }
  assert.equal(firstAttestation.value.status, 'active');
  assert.equal(firstAttestation.value.resolvedReason, undefined);
  assert.equal(
    firstAttestation.value.participants.find(({ accountId }) => accountId === ACCOUNT_1)
      ?.completionAttestedAt,
    new Date(nowMs).toISOString(),
  );
  assert.equal(
    firstAttestation.value.participants.find(({ accountId }) => accountId === ACCOUNT_2)
      ?.completionAttestedAt,
    undefined,
  );
  assert.deepEqual(resolvedSessions, []);
  assert.equal(queue.getTicketForAccount(first.ticketId, ACCOUNT_1)?.status, 'matched');
  assert.equal(queue.getTicketForAccount(second.ticketId, ACCOUNT_2)?.status, 'matched');

  nowMs += 1;
  const completion = queue.completeSession(sessionId, ACCOUNT_2, second.matchStart.sessionToken);
  assert.equal(completion.ok, true);
  if (!completion.ok) {
    throw new Error('Expected second completion attestation to succeed');
  }
  assert.equal(completion.value.status, 'resolved');
  assert.equal(completion.value.resolvedReason, 'completed');
  assert.deepEqual(resolvedSessions, [{ sessionId, reason: 'completed' }]);

  const firstParticipant = completion.value.participants.find(({ accountId }) => accountId === ACCOUNT_1);
  assert.ok(firstParticipant);
  const firstTicket = queue.getTicketForAccount(firstParticipant.queueTicketId, ACCOUNT_1);
  assert.ok(firstTicket);
  assert.equal(firstTicket.status, 'closed');
  assert.equal(firstTicket.closedReason, 'session_completed');

  const secondParticipant = completion.value.participants.find(({ accountId }) => accountId === ACCOUNT_2);
  assert.ok(secondParticipant);
  const secondTicket = queue.getTicketForAccount(secondParticipant.queueTicketId, ACCOUNT_2);
  assert.ok(secondTicket);
  assert.equal(secondTicket.status, 'closed');
  assert.equal(secondTicket.closedReason, 'session_completed');
});

test('duplicate completion attestations are idempotent before and after resolution', () => {
  let nowMs = 8_000_000;
  let resolutionCount = 0;
  const queue = createMatchmakingQueueService({
    now: () => nowMs,
    onSessionResolved: () => {
      resolutionCount += 1;
    },
  });
  const first = queue.join({
    accountId: ACCOUNT_1,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(queue.join({
    accountId: ACCOUNT_2,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
  }));
  const firstTicketState = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicketState);
  const firstMatched = expectMatched(firstTicketState);
  const sessionId = second.matchStart.sessionId;

  const initial = queue.completeSession(sessionId, ACCOUNT_1, firstMatched.matchStart.sessionToken);
  assert.equal(initial.ok, true);
  if (!initial.ok) {
    throw new Error('Expected initial completion attestation to succeed');
  }
  const attestedAt = initial.value.participants.find(
    ({ accountId }) => accountId === ACCOUNT_1,
  )?.completionAttestedAt;
  assert.equal(attestedAt, new Date(nowMs).toISOString());

  nowMs += 100;
  const duplicate = queue.completeSession(sessionId, ACCOUNT_1, firstMatched.matchStart.sessionToken);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) {
    throw new Error('Expected duplicate completion attestation to succeed');
  }
  assert.equal(duplicate.value.status, 'active');
  assert.equal(
    duplicate.value.participants.find(({ accountId }) => accountId === ACCOUNT_1)?.completionAttestedAt,
    attestedAt,
  );
  assert.equal(resolutionCount, 0);

  const completed = queue.completeSession(sessionId, ACCOUNT_2, second.matchStart.sessionToken);
  assert.equal(completed.ok, true);
  if (!completed.ok) {
    throw new Error('Expected peer completion attestation to succeed');
  }
  assert.equal(completed.value.status, 'resolved');
  assert.equal(resolutionCount, 1);

  const resolvedDuplicate = queue.completeSession(
    sessionId,
    ACCOUNT_1,
    firstMatched.matchStart.sessionToken,
  );
  assert.equal(resolvedDuplicate.ok, true);
  if (!resolvedDuplicate.ok) {
    throw new Error('Expected resolved completion retry to succeed');
  }
  assert.equal(resolvedDuplicate.value.status, 'resolved');
  assert.equal(resolutionCount, 1);
});

test('completion rejects outsiders and invalid participant tokens without attesting', () => {
  const queue = createMatchmakingQueueService();
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
  const firstTicketState = queue.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicketState);
  const firstMatched = expectMatched(firstTicketState);
  const sessionId = second.matchStart.sessionId;

  const outsider = queue.completeSession(sessionId, ACCOUNT_3, second.matchStart.sessionToken);
  assert.equal(outsider.ok, false);
  if (outsider.ok) {
    throw new Error('Expected outsider completion to be rejected');
  }
  assert.equal(outsider.error.code, 'forbidden');

  const invalidToken = queue.completeSession(sessionId, ACCOUNT_1, second.matchStart.sessionToken);
  assert.equal(invalidToken.ok, false);
  if (invalidToken.ok) {
    throw new Error('Expected invalid completion token to be rejected');
  }
  assert.equal(invalidToken.error.code, 'invalid_token');
  assert.equal(
    queue.exportSnapshot().sessions[0]?.participants.some(
      ({ completionAttestedAtMs }) => completionAttestedAtMs !== undefined,
    ),
    false,
  );

  const validFirst = queue.completeSession(sessionId, ACCOUNT_2, second.matchStart.sessionToken);
  assert.equal(validFirst.ok, true);
  if (!validFirst.ok) {
    throw new Error('Expected valid completion attestation to succeed');
  }
  assert.equal(validFirst.value.status, 'active');
});

test('snapshot restore preserves a completion attestation until the peer attests', () => {
  let nowMs = 9_000_000;
  const original = createMatchmakingQueueService({ now: () => nowMs });
  const first = original.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  });
  const second = expectMatched(original.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
  }));
  const firstTicketState = original.getTicketForAccount(first.ticketId, ACCOUNT_1);
  assert.ok(firstTicketState);
  const firstMatched = expectMatched(firstTicketState);
  const sessionId = second.matchStart.sessionId;
  assert.equal(
    original.completeSession(sessionId, ACCOUNT_1, firstMatched.matchStart.sessionToken).ok,
    true,
  );

  const snapshot = original.exportSnapshot();
  const storedSession = snapshot.sessions.find((session) => session.sessionId === sessionId);
  assert.ok(storedSession);
  assert.equal(
    storedSession.participants.find(({ accountId }) => accountId === ACCOUNT_1)?.completionAttestedAtMs,
    nowMs,
  );
  assert.equal(
    storedSession.participants.find(({ accountId }) => accountId === ACCOUNT_2)?.completionAttestedAtMs,
    undefined,
  );

  nowMs += 250;
  const restored = createMatchmakingQueueService({ now: () => nowMs });
  restored.restoreSnapshot(snapshot);
  const active = restored.getSessionForAccount(sessionId, ACCOUNT_1);
  assert.ok(active);
  assert.equal(active.status, 'active');
  assert.equal(
    active.participants.find(({ accountId }) => accountId === ACCOUNT_1)?.completionAttestedAt,
    new Date(nowMs - 250).toISOString(),
  );

  const completion = restored.completeSession(sessionId, ACCOUNT_2, second.matchStart.sessionToken);
  assert.equal(completion.ok, true);
  if (!completion.ok) {
    throw new Error('Expected restored peer completion attestation to succeed');
  }
  assert.equal(completion.value.status, 'resolved');
  assert.equal(completion.value.resolvedReason, 'completed');
});

test('snapshot restore preserves queued build constraints and reconnect replay protection', () => {
  let nowMs = 5_000_000;
  const original = createMatchmakingQueueService({
    now: () => nowMs,
    sessionTtlSeconds: 120,
    sessionTokenTtlSeconds: 120,
  });
  const queuedBeta = original.join({
    accountId: ACCOUNT_3,
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'beta-2' },
  });
  original.join({
    accountId: ACCOUNT_1,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-1' },
  });
  const matched = expectMatched(original.join({
    accountId: ACCOUNT_2,
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'alpha-1' },
  }));
  const reconnectAttemptId = 'restore-attempt-1';
  assert.equal(original.markSessionDisconnected(matched.matchStart.sessionId, ACCOUNT_2).ok, true);
  assert.equal(original.reconnectSession({
    sessionId: matched.matchStart.sessionId,
    accountId: ACCOUNT_2,
    sessionToken: matched.matchStart.sessionToken,
    reconnectAttemptId,
  }).ok, true);

  const restored = createMatchmakingQueueService({
    now: () => nowMs,
    sessionTtlSeconds: 120,
    sessionTokenTtlSeconds: 120,
  });
  restored.restoreSnapshot(original.exportSnapshot());

  const replayedReconnect = restored.reconnectSession({
    sessionId: matched.matchStart.sessionId,
    accountId: ACCOUNT_2,
    sessionToken: matched.matchStart.sessionToken,
    reconnectAttemptId,
  });
  assert.equal(replayedReconnect.ok, false);
  if (replayedReconnect.ok) {
    throw new Error('Expected restored reconnect replay protection');
  }
  assert.equal(replayedReconnect.error.code, 'replayed_attempt');

  const incompatible = restored.join({
    accountId: '44444444-4444-4444-8444-444444444444',
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'beta-3' },
  });
  assert.equal(incompatible.status, 'queued');
  const queuedBetaStatus = restored.getTicketForAccount(queuedBeta.ticketId, ACCOUNT_3);
  assert.ok(queuedBetaStatus);
  assert.equal(queuedBetaStatus.status, 'queued');

  nowMs += 1_000;
  const compatible = restored.join({
    accountId: '55555555-5555-4555-8555-555555555555',
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    playerMetadata: { buildVersion: 'beta-2' },
  });
  expectMatched(compatible);
});
