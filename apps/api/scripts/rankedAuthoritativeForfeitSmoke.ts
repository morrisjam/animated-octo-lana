import process from 'node:process';
import { Pool } from 'pg';
import { deriveLivenessResolutionTimeoutMs } from '../src/ops/authoritativeForfeitSmokeTiming';
import { assertSafeSmokeTarget } from './smokeTargetGuard';

const BUILD_VERSION = 'prototype-2026.02';
const RULESET_VERSION = 'prototype-2026.02';
const BALANCE_PROFILE_ID = 'default';

interface AccountResponse {
  id: string;
  accessToken: string;
}

interface QueueTicketResponse {
  ticketId: string;
  status: 'queued' | 'matched' | 'closed';
  matchStart?: {
    sessionId: string;
    sessionToken: string;
    heartbeatIntervalSeconds: number;
    heartbeatTimeoutSeconds: number;
    reconnectGraceSeconds: number;
  };
}

interface SessionResponse {
  sessionId: string;
  status: 'active' | 'resolved';
  resolvedReason?: string;
  forfeitingAccountId?: string;
  participants: Array<{
    accountId: string;
    side: 'P1' | 'P2';
    connectionStatus: 'connected' | 'disconnected';
    lastHeartbeatAt?: string;
    reconnectDeadlineAt?: string;
  }>;
}

interface RankedResultResponse {
  status?: string;
  outcome?: string;
  winnerAccountId?: string | null;
  settlementSource?: string;
  authoritativeResolution?: {
    reason?: string;
    forfeitingAccountId?: string;
  };
  proof?: unknown;
  ratingDeltas?: Array<{
    accountId: string;
    postRating: number;
    result: string;
  }>;
}

interface DurableTerminalDecisionRow {
  decision_type: string;
  participant_p1_account_id: string;
  participant_p2_account_id: string;
  winner_account_id: string | null;
  forfeiting_account_id: string | null;
  reason: string;
  status: string;
  settled_match_id: string | null;
  ranked_match_count: number;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve the response text for failure diagnostics.
  }
  return { status: response.status, body: body as T };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createAccount(baseUrl: string): Promise<AccountResponse> {
  const response = await requestJson<AccountResponse>(`${baseUrl}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status !== 201 || !response.body.id || !response.body.accessToken) {
    throw new Error(`Account creation failed with status ${response.status}.`);
  }
  return response.body;
}

async function joinRanked(
  baseUrl: string,
  account: AccountResponse,
  characterId: 'vanguard' | 'duelist',
): Promise<QueueTicketResponse> {
  const response = await requestJson<QueueTicketResponse>(`${baseUrl}/matchmaking/queue/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${account.accessToken}`,
    },
    body: JSON.stringify({
      queueType: 'ranked',
      regionPreferences: ['eu-west'],
      buildVersion: BUILD_VERSION,
      rulesetVersion: RULESET_VERSION,
      balanceProfileId: BALANCE_PROFILE_ID,
      platform: 'web',
      characterId,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Ranked queue join failed with status ${response.status}.`);
  }
  return response.body;
}

async function readTicket(
  baseUrl: string,
  account: AccountResponse,
  ticketId: string,
): Promise<QueueTicketResponse> {
  const response = await requestJson<QueueTicketResponse>(
    `${baseUrl}/matchmaking/queue/tickets/${ticketId}`,
    { headers: { authorization: `Bearer ${account.accessToken}` } },
  );
  if (response.status !== 200) {
    throw new Error(`Ticket read failed with status ${response.status}.`);
  }
  return response.body;
}

async function disconnect(
  baseUrl: string,
  account: AccountResponse,
  sessionId: string,
): Promise<SessionResponse> {
  const response = await requestJson<SessionResponse>(`${baseUrl}/matchmaking/sessions/disconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${account.accessToken}`,
    },
    body: JSON.stringify({ sessionId }),
  });
  if (response.status !== 200) {
    throw new Error(`Session disconnect failed with status ${response.status}.`);
  }
  return response.body;
}

async function heartbeat(
  baseUrl: string,
  account: AccountResponse,
  sessionId: string,
  sessionToken: string,
): Promise<{ status: number; body: SessionResponse & { code?: string } }> {
  return await requestJson<SessionResponse & { code?: string }>(
    `${baseUrl}/matchmaking/sessions/heartbeat`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${account.accessToken}`,
      },
      body: JSON.stringify({ sessionId, sessionToken }),
    },
  );
}

async function countHeartbeatSloSamples(databaseUrl: string | undefined): Promise<number | null> {
  if (!databaseUrl) {
    return null;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM service_slo_request_samples
      WHERE method = 'POST' AND route = '/matchmaking/sessions/heartbeat'
      `,
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await pool.end();
  }
}

async function readDurableTerminalDecision(
  databaseUrl: string | undefined,
  sessionId: string,
): Promise<DurableTerminalDecisionRow | null> {
  if (!databaseUrl) {
    return null;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `
      SELECT
        decision_type,
        participant_p1_account_id,
        participant_p2_account_id,
        winner_account_id,
        forfeiting_account_id,
        reason,
        status,
        settled_match_id,
        (
          SELECT COUNT(*)::int
          FROM ranked_matches
          WHERE ranked_matches.session_id = ranked_terminal_decisions.session_id
        ) AS ranked_match_count
      FROM ranked_terminal_decisions
      WHERE ranked_terminal_decisions.session_id = $1
      LIMIT 1
      `,
      [sessionId],
    );
    return (result.rows[0] as DurableTerminalDecisionRow | undefined) ?? null;
  } finally {
    await pool.end();
  }
}

async function readSession(
  baseUrl: string,
  account: AccountResponse,
  sessionId: string,
): Promise<SessionResponse> {
  const response = await requestJson<SessionResponse>(`${baseUrl}/matchmaking/sessions/${sessionId}`, {
    headers: { authorization: `Bearer ${account.accessToken}` },
  });
  if (response.status !== 200) {
    throw new Error(`Session read failed with status ${response.status}.`);
  }
  return response.body;
}

async function readResult(
  baseUrl: string,
  account: AccountResponse,
  sessionId: string,
  sessionToken?: string,
): Promise<{ status: number; body: RankedResultResponse }> {
  return await requestJson<RankedResultResponse>(`${baseUrl}/ranked/results/${sessionId}`, {
    headers: {
      authorization: `Bearer ${account.accessToken}`,
      ...(sessionToken ? { 'x-match-session-token': sessionToken } : {}),
    },
  });
}

async function waitForSilentPeerTimeout(
  baseUrl: string,
  liveAccount: AccountResponse,
  silentAccount: AccountResponse,
  sessionId: string,
  liveSessionToken: string,
  silentSessionToken: string,
  timeoutMs: number,
): Promise<SessionResponse> {
  const deadlineAt = Date.now() + timeoutMs;
  let session = await readSession(baseUrl, liveAccount, sessionId);
  let reconnectDeadline: string | null = null;
  let staleHeartbeatRejected = false;

  while (session.status !== 'resolved' && Date.now() < deadlineAt) {
    await sleep(250);
    const liveHeartbeat = await heartbeat(baseUrl, liveAccount, sessionId, liveSessionToken);
    if (liveHeartbeat.status === 409 && liveHeartbeat.body.code === 'session_resolved') {
      session = await readSession(baseUrl, liveAccount, sessionId);
      continue;
    }
    if (liveHeartbeat.status !== 200) {
      throw new Error(`Live participant heartbeat failed: ${JSON.stringify(liveHeartbeat)}.`);
    }
    session = liveHeartbeat.body;
    const silentParticipant = session.participants.find(
      (participant) => participant.accountId === silentAccount.id,
    );
    if (!silentParticipant?.reconnectDeadlineAt) {
      continue;
    }
    if (reconnectDeadline === null) {
      reconnectDeadline = silentParticipant.reconnectDeadlineAt;
      const staleHeartbeat = await heartbeat(
        baseUrl,
        silentAccount,
        sessionId,
        silentSessionToken,
      );
      if (staleHeartbeat.status !== 409 || staleHeartbeat.body.code !== 'participant_disconnected') {
        throw new Error(`Stale participant heartbeat bypassed reconnect: ${JSON.stringify(staleHeartbeat)}.`);
      }
      staleHeartbeatRejected = true;
    } else if (silentParticipant.reconnectDeadlineAt !== reconnectDeadline) {
      throw new Error('Repeated liveness cleanup extended the silent peer reconnect deadline.');
    }
  }

  if (!reconnectDeadline || !staleHeartbeatRejected) {
    throw new Error('Silent participant never entered the protected reconnect window.');
  }
  return session.status === 'resolved'
    ? session
    : await readSession(baseUrl, liveAccount, sessionId);
}

async function waitForDoubleSilence(
  baseUrl: string,
  account: AccountResponse,
  sessionId: string,
  timeoutMs: number,
): Promise<SessionResponse> {
  const deadlineAt = Date.now() + timeoutMs;
  let session = await readSession(baseUrl, account, sessionId);
  while (session.status !== 'resolved' && Date.now() < deadlineAt) {
    await sleep(250);
    session = await readSession(baseUrl, account, sessionId);
  }
  return session;
}

async function waitForDurableResult(
  baseUrl: string,
  account: AccountResponse,
  sessionId: string,
  expectedStatus: string,
  timeoutMs: number,
): Promise<{ status: number; body: RankedResultResponse }> {
  const deadlineAt = Date.now() + timeoutMs;
  let result = await readResult(baseUrl, account, sessionId);
  while (
    (result.status !== 200 || result.body.status !== expectedStatus)
    && Date.now() < deadlineAt
  ) {
    await sleep(100);
    result = await readResult(baseUrl, account, sessionId);
  }
  return result;
}

async function run(): Promise<void> {
  const baseUrl = String(process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
  const configuredMinimumTimeoutMs = Math.max(
    2_000,
    Number(process.env.AUTHORITATIVE_FORFEIT_SMOKE_TIMEOUT_MS ?? '10000'),
  );
  await assertSafeSmokeTarget(baseUrl, 'Ranked authoritative-forfeit smoke');
  const p1 = await createAccount(baseUrl);
  const p2 = await createAccount(baseUrl);
  const outsider = await createAccount(baseUrl);
  const firstJoin = await joinRanked(baseUrl, p1, 'vanguard');
  const secondJoin = await joinRanked(baseUrl, p2, 'duelist');
  const p1Ticket = firstJoin.matchStart ? firstJoin : await readTicket(baseUrl, p1, firstJoin.ticketId);
  const p2Ticket = secondJoin.matchStart ? secondJoin : await readTicket(baseUrl, p2, secondJoin.ticketId);
  if (!p1Ticket.matchStart || !p2Ticket.matchStart) {
    throw new Error('Authoritative forfeit smoke did not produce a matched session.');
  }
  const sessionId = p1Ticket.matchStart.sessionId;
  if (p2Ticket.matchStart.sessionId !== sessionId) {
    throw new Error('Authoritative forfeit smoke peers disagree on session id.');
  }
  if (
    p1Ticket.matchStart.heartbeatIntervalSeconds < 1
    || p1Ticket.matchStart.heartbeatTimeoutSeconds < p1Ticket.matchStart.heartbeatIntervalSeconds * 3
    || p1Ticket.matchStart.reconnectGraceSeconds < 1
  ) {
    throw new Error('Match start did not publish a safe heartbeat schedule.');
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const heartbeatSloSamplesBefore = await countHeartbeatSloSamples(databaseUrl);
  const rejectedHeartbeat = await heartbeat(baseUrl, p1, sessionId, 'invalid-session-token');
  if (rejectedHeartbeat.status !== 401 || rejectedHeartbeat.body.code !== 'invalid_token') {
    throw new Error(`Invalid heartbeat token was not rejected: ${JSON.stringify(rejectedHeartbeat)}.`);
  }
  const acceptedHeartbeat = await heartbeat(
    baseUrl,
    p1,
    sessionId,
    p1Ticket.matchStart.sessionToken,
  );
  const p1Participant = acceptedHeartbeat.body.participants?.find(
    (participant) => participant.accountId === p1.id,
  );
  if (acceptedHeartbeat.status !== 200 || !p1Participant?.lastHeartbeatAt) {
    throw new Error(`Authenticated heartbeat was not accepted: ${JSON.stringify(acceptedHeartbeat)}.`);
  }
  const forfeitTrigger = process.env.AUTHORITATIVE_FORFEIT_TRIGGER === 'heartbeat_timeout'
    ? 'heartbeat_timeout'
    : 'explicit_disconnect';
  const forfeitResolutionTimeoutMs = deriveLivenessResolutionTimeoutMs({
    configuredMinimumMs: configuredMinimumTimeoutMs,
    heartbeatTimeoutSeconds: forfeitTrigger === 'heartbeat_timeout'
      ? p1Ticket.matchStart.heartbeatTimeoutSeconds
      : 0,
    reconnectGraceSeconds: p1Ticket.matchStart.reconnectGraceSeconds,
  });
  let session: SessionResponse;
  if (forfeitTrigger === 'heartbeat_timeout') {
    session = await waitForSilentPeerTimeout(
      baseUrl,
      p1,
      p2,
      sessionId,
      p1Ticket.matchStart.sessionToken,
      p2Ticket.matchStart.sessionToken,
      forfeitResolutionTimeoutMs,
    );
  } else {
    const firstDisconnect = await disconnect(baseUrl, p2, sessionId);
    const initialDeadline = firstDisconnect.participants.find(
      (participant) => participant.accountId === p2.id,
    )?.reconnectDeadlineAt;
    if (!initialDeadline) {
      throw new Error('Disconnected participant did not receive a reconnect deadline.');
    }
    const repeatedDisconnect = await disconnect(baseUrl, p2, sessionId);
    const repeatedDeadline = repeatedDisconnect.participants.find(
      (participant) => participant.accountId === p2.id,
    )?.reconnectDeadlineAt;
    if (repeatedDeadline !== initialDeadline) {
      throw new Error('Repeated disconnect extended the reconnect grace deadline.');
    }

    const deadlineAt = Date.now() + forfeitResolutionTimeoutMs;
    session = repeatedDisconnect;
    while (session.status !== 'resolved' && Date.now() < deadlineAt) {
      await sleep(200);
      session = await readSession(baseUrl, p1, sessionId);
    }
  }
  if (
    session.status !== 'resolved'
    || session.resolvedReason !== 'reconnect_timeout'
    || session.forfeitingAccountId !== p2.id
  ) {
    throw new Error(`Expected attributed reconnect timeout, got ${JSON.stringify(session)}.`);
  }
  const heartbeatSloSamplesAfter = await countHeartbeatSloSamples(databaseUrl);
  if (
    heartbeatSloSamplesBefore !== null
    && heartbeatSloSamplesAfter !== null
    && heartbeatSloSamplesAfter !== heartbeatSloSamplesBefore
  ) {
    throw new Error('Heartbeat requests wrote durable per-request SLO samples.');
  }

  const result = await readResult(baseUrl, p1, sessionId, p1Ticket.matchStart.sessionToken);
  if (
    result.status !== 200
    || result.body.status !== 'accepted'
    || result.body.outcome !== 'forfeit'
    || result.body.winnerAccountId !== p1.id
    || result.body.settlementSource !== 'server_authoritative'
    || result.body.authoritativeResolution?.reason !== 'reconnect_timeout'
    || result.body.authoritativeResolution.forfeitingAccountId !== p2.id
    || result.body.proof !== undefined
  ) {
    throw new Error(`Unexpected authoritative settlement response: ${JSON.stringify(result)}.`);
  }
  const winnerDelta = result.body.ratingDeltas?.find((delta) => delta.accountId === p1.id);
  const forfeiterDelta = result.body.ratingDeltas?.find((delta) => delta.accountId === p2.id);
  if (
    winnerDelta?.result !== 'win'
    || winnerDelta.postRating !== 1216
    || forfeiterDelta?.result !== 'forfeit'
    || forfeiterDelta.postRating !== 1184
  ) {
    throw new Error(`Unexpected authoritative rating deltas: ${JSON.stringify(result.body.ratingDeltas)}.`);
  }

  const repeatedResult = await readResult(baseUrl, p2, sessionId, p2Ticket.matchStart.sessionToken);
  const repeatedDeltas = repeatedResult.body.ratingDeltas ?? [];
  if (
    repeatedResult.status !== 200
    || repeatedDeltas.length !== 2
    || repeatedDeltas.some((delta) => (
      delta.accountId === p1.id ? delta.postRating !== 1216 : delta.postRating !== 1184
    ))
  ) {
    throw new Error('Repeated authoritative result read was not idempotent.');
  }

  const durableWinnerRead = await readResult(baseUrl, p1, sessionId);
  const durableForfeiterRead = await readResult(baseUrl, p2, sessionId);
  const outsiderRead = await readResult(baseUrl, outsider, sessionId);
  if (
    durableWinnerRead.status !== 200
    || durableWinnerRead.body.status !== 'accepted'
    || durableForfeiterRead.status !== 200
    || durableForfeiterRead.body.status !== 'accepted'
  ) {
    throw new Error('Durable participant result read still depended on the runtime session token.');
  }
  if (outsiderRead.status !== 403) {
    throw new Error(`Durable result read exposed another match to an outsider: ${JSON.stringify(outsiderRead)}.`);
  }

  const terminalDecision = await readDurableTerminalDecision(databaseUrl, sessionId);
  if (databaseUrl && !terminalDecision) {
    throw new Error('Authoritative settlement did not persist a durable terminal decision.');
  }
  if (
    terminalDecision
    && (
      terminalDecision.decision_type !== 'forfeit'
      || terminalDecision.participant_p1_account_id !== p1.id
      || terminalDecision.participant_p2_account_id !== p2.id
      || terminalDecision.winner_account_id !== p1.id
      || terminalDecision.forfeiting_account_id !== p2.id
      || terminalDecision.reason !== 'reconnect_timeout'
      || terminalDecision.status !== 'settled'
      || terminalDecision.settled_match_id !== sessionId
      || Number(terminalDecision.ranked_match_count) !== 1
    )
  ) {
    throw new Error(`Unexpected durable terminal decision: ${JSON.stringify(terminalDecision)}.`);
  }

  const noContestP1 = await createAccount(baseUrl);
  const noContestP2 = await createAccount(baseUrl);
  const noContestFirstJoin = await joinRanked(baseUrl, noContestP1, 'duelist');
  const noContestSecondJoin = await joinRanked(baseUrl, noContestP2, 'vanguard');
  const noContestP1Ticket = noContestFirstJoin.matchStart
    ? noContestFirstJoin
    : await readTicket(baseUrl, noContestP1, noContestFirstJoin.ticketId);
  const noContestP2Ticket = noContestSecondJoin.matchStart
    ? noContestSecondJoin
    : await readTicket(baseUrl, noContestP2, noContestSecondJoin.ticketId);
  if (!noContestP1Ticket.matchStart || !noContestP2Ticket.matchStart) {
    throw new Error('No-contest smoke did not produce a matched session.');
  }
  const noContestSessionId = noContestP1Ticket.matchStart.sessionId;
  if (noContestP2Ticket.matchStart.sessionId !== noContestSessionId) {
    throw new Error('No-contest smoke peers disagree on session id.');
  }
  const noContestResolutionTimeoutMs = deriveLivenessResolutionTimeoutMs({
    configuredMinimumMs: configuredMinimumTimeoutMs,
    heartbeatTimeoutSeconds: noContestP1Ticket.matchStart.heartbeatTimeoutSeconds,
    reconnectGraceSeconds: noContestP1Ticket.matchStart.reconnectGraceSeconds,
  });
  const noContestSession = await waitForDoubleSilence(
    baseUrl,
    noContestP1,
    noContestSessionId,
    noContestResolutionTimeoutMs,
  );
  if (
    noContestSession.status !== 'resolved'
    || noContestSession.resolvedReason !== 'reconnect_timeout'
    || noContestSession.forfeitingAccountId !== undefined
  ) {
    throw new Error(`Expected double-timeout no-contest, got ${JSON.stringify(noContestSession)}.`);
  }
  const noContestResult = await waitForDurableResult(
    baseUrl,
    noContestP1,
    noContestSessionId,
    'no_contest',
    configuredMinimumTimeoutMs,
  );
  const noContestOutsiderRead = await readResult(baseUrl, outsider, noContestSessionId);
  if (
    noContestResult.status !== 200
    || noContestResult.body.status !== 'no_contest'
    || noContestResult.body.outcome !== undefined
    || noContestResult.body.ratingDeltas?.length !== 0
    || noContestOutsiderRead.status !== 403
  ) {
    throw new Error(`Unexpected durable no-contest response: ${JSON.stringify(noContestResult)}.`);
  }
  const noContestDecision = await readDurableTerminalDecision(databaseUrl, noContestSessionId);
  if (databaseUrl && !noContestDecision) {
    throw new Error('Double timeout did not persist a durable no-contest decision.');
  }
  if (
    noContestDecision
    && (
      noContestDecision.decision_type !== 'no_contest'
      || noContestDecision.participant_p1_account_id !== noContestP1.id
      || noContestDecision.participant_p2_account_id !== noContestP2.id
      || noContestDecision.winner_account_id !== null
      || noContestDecision.forfeiting_account_id !== null
      || noContestDecision.reason !== 'reconnect_timeout'
      || noContestDecision.status !== 'settled'
      || noContestDecision.settled_match_id !== null
      || Number(noContestDecision.ranked_match_count) !== 0
    )
  ) {
    throw new Error(`Unexpected durable no-contest decision: ${JSON.stringify(noContestDecision)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    sessionId,
    winnerAccountId: p1.id,
    forfeitingAccountId: p2.id,
    reason: session.resolvedReason,
    forfeitTrigger,
    timeoutBudgetMs: {
      configuredMinimum: configuredMinimumTimeoutMs,
      forfeitResolution: forfeitResolutionTimeoutMs,
      noContestResolution: noContestResolutionTimeoutMs,
    },
    heartbeat: {
      intervalSeconds: p1Ticket.matchStart.heartbeatIntervalSeconds,
      timeoutSeconds: p1Ticket.matchStart.heartbeatTimeoutSeconds,
      durableSloWrites: heartbeatSloSamplesBefore === null || heartbeatSloSamplesAfter === null
        ? 'not_checked'
        : heartbeatSloSamplesAfter - heartbeatSloSamplesBefore,
    },
    settlementSource: result.body.settlementSource,
    durableTerminalDecision: terminalDecision ? {
      status: terminalDecision.status,
      settledMatchId: terminalDecision.settled_match_id,
      tokenlessParticipantRead: true,
      outsiderRejected: true,
    } : 'not_checked',
    noContest: noContestDecision ? {
      sessionId: noContestSessionId,
      status: noContestDecision.status,
      ratedMatchCount: Number(noContestDecision.ranked_match_count),
      outsiderRejected: true,
    } : 'not_checked',
    ratings: result.body.ratingDeltas,
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
