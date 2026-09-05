import process from 'node:process';
import type { RankedMatchProof } from '../../game-web/src/sim/rankedProof';
import {
  createRankedInputCommitmentFixture,
  createRankedProofFixture,
} from './rankedProofFixture';
import { assertSafeSmokeTarget } from './smokeTargetGuard';

const SMOKE_BUILD_VERSION = 'prototype-2026.09';
const SMOKE_RULESET_VERSION = 'prototype-2026.09';
const SMOKE_BALANCE_PROFILE_ID = 'default';

interface AccountRecord {
  id: string;
  accessToken: string;
}

const accessTokenByAccountId = new Map<string, string>();

function authorizationHeader(accountId: string): string {
  const accessToken = accessTokenByAccountId.get(accountId);
  if (!accessToken) {
    throw new Error(`Missing smoke auth token for account ${accountId}.`);
  }
  return `Bearer ${accessToken}`;
}

interface QueueJoinResponse {
  ticketId: string;
  accountId: string;
  status: 'queued' | 'matched' | 'closed';
  joinDisposition?: 'created' | 'existing';
  matchStart?: {
    sessionId: string;
    sessionToken: string;
    transportAttempt: {
      attemptId: string;
      generation: number;
      createdAt: string;
    };
  };
}

interface SessionView {
  sessionId: string;
  status: 'active' | 'resolved';
  resolvedReason?: string;
  participants: Array<{
    accountId: string;
    side: 'P1' | 'P2';
    connectionStatus: 'connected' | 'disconnected';
    completionAttestedAt?: string;
  }>;
}

interface SessionSignalsResponse {
  signals: Array<{
    signalId: string;
    senderAccountId: string;
    signalType: string;
    payload: unknown;
    createdAt: string;
  }>;
  nextAfterSignalId: string;
}

interface RankedProgressionResponse {
  seasonId: string | null;
  current?: {
    rating: number | null;
    placement?: {
      calibrationMatchesPlayed: number | null;
    } | null;
  } | null;
}

interface RankedLeaderboardEntry {
  rank: number;
  accountId: string;
  displayName: string | null;
  region: string;
  rating?: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  leagueTier?: string | null;
  leaguePoints?: number | null;
  mrPoints?: number | null;
  provisional?: boolean;
  updatedAt: string;
}

interface RankedLeaderboardResponse {
  season: {
    seasonId: string;
    state: 'scheduled' | 'active' | 'archived';
  };
  filter: {
    region: string | null;
    track: 'rating' | 'master';
  };
  page: {
    limit: number;
    offset: number;
    total: number;
  };
  items: RankedLeaderboardEntry[];
}

interface RankedResultStatusResponse {
  status: 'awaiting_peer_confirmation' | 'accepted' | 'flagged_for_review';
  ratingDeltas?: Array<{ accountId: string; postRating: number }>;
  proof?: RankedProofView;
}

interface RankedProofView {
  digest: string;
  simulatorVersion: string;
  roundCount: number;
  frameCount: number;
  derivedOutcome: 'p1_win' | 'p2_win';
  inputAttestation?: {
    status: 'participant_verified' | 'match_verified';
    evidence: {
      schemaVersion: string;
      minimumObservationRatio: number;
      participants: Array<{
        accountId: string;
        side: 'P1' | 'P2';
        commitmentCount: number;
        committedFrameCount: number;
        finalChainDigest: string;
      }>;
    };
  };
}

interface RankedResultSubmitResponse {
  status?: 'awaiting_peer_confirmation' | 'accepted' | 'flagged_for_review';
  proof?: RankedProofView;
  code?: string;
  proofErrorCode?: string;
  retryAfterSeconds?: number;
}

interface ErrorBody {
  error?: string;
  code?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep text body for diagnostics.
  }
  return {
    status: response.status,
    body: body as T,
  };
}

async function createAccount(baseUrl: string): Promise<string> {
  const response = await requestJson<AccountRecord>(`${baseUrl}/accounts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (response.status !== 201 || !response.body?.id || !response.body.accessToken) {
    throw new Error(`Failed to create account: status=${response.status}`);
  }
  accessTokenByAccountId.set(response.body.id, response.body.accessToken);
  return response.body.id;
}

async function updateProfile(
  baseUrl: string,
  accountId: string,
  displayName: string,
  region: string,
): Promise<void> {
  const response = await requestJson<{ account_id?: string }>(`${baseUrl}/profile`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({ displayName, settings: { region } }),
  });
  if (response.status !== 200 || response.body.account_id !== accountId) {
    throw new Error(`Failed to update smoke profile for ${accountId}: status=${response.status}`);
  }
}

async function joinRankedQueue(
  baseUrl: string,
  accountId: string,
  characterId: string,
): Promise<QueueJoinResponse> {
  const response = await requestJson<QueueJoinResponse>(`${baseUrl}/matchmaking/queue/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({
      queueType: 'ranked',
      regionPreferences: ['eu-west'],
      buildVersion: SMOKE_BUILD_VERSION,
      rulesetVersion: SMOKE_RULESET_VERSION,
      balanceProfileId: SMOKE_BALANCE_PROFILE_ID,
      platform: 'web',
      characterId,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Failed to join ranked queue for ${accountId}: status=${response.status}`);
  }
  return response.body;
}

async function getTicket(baseUrl: string, accountId: string, ticketId: string): Promise<QueueJoinResponse> {
  const response = await requestJson<QueueJoinResponse>(`${baseUrl}/matchmaking/queue/tickets/${ticketId}`, {
    method: 'GET',
    headers: {
      authorization: authorizationHeader(accountId),
    },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to read ticket ${ticketId}: status=${response.status}`);
  }
  return response.body;
}

async function submitRankedResult(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  participantAccountIds: string[],
  winnerAccountId: string,
  proof: RankedMatchProof,
): Promise<{ status: number; body: RankedResultSubmitResponse }> {
  return await requestJson<RankedResultSubmitResponse>(`${baseUrl}/ranked/results`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({
      sessionId,
      matchId: sessionId,
      sessionToken,
      outcome: 'p1_win',
      participantAccountIds,
      winnerAccountId,
      proof,
    }),
  });
}

async function submitRankedDraw(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  participantAccountIds: string[],
  proof: RankedMatchProof,
): Promise<{ status: number; body: RankedResultSubmitResponse }> {
  return await requestJson<RankedResultSubmitResponse>(`${baseUrl}/ranked/results`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({
      sessionId,
      matchId: sessionId,
      sessionToken,
      outcome: 'draw',
      participantAccountIds,
      winnerAccountId: null,
      proof,
    }),
  });
}

async function submitRankedInputCommitments(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  side: 'P1' | 'P2',
  proof: RankedMatchProof,
): Promise<number> {
  const commitments = await createRankedInputCommitmentFixture(proof, accountId, side);
  for (const commitment of commitments) {
    const response = await requestJson<{
      sequence?: number;
      chainDigest?: string;
    }>(`${baseUrl}/ranked/sessions/${sessionId}/input-commitments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authorizationHeader(accountId),
        'x-match-session-token': sessionToken,
      },
      body: JSON.stringify({ ...commitment, sessionToken }),
    });
    if (
      response.status !== 200
      || response.body.sequence !== commitment.sequence
      || !/^[0-9a-f]{64}$/.test(response.body.chainDigest ?? '')
    ) {
      throw new Error(
        `Ranked input commitment ${commitment.sequence} failed for ${accountId}: status=${response.status}.`,
      );
    }
  }
  return commitments.length;
}

async function getProgression(baseUrl: string, accountId: string): Promise<RankedProgressionResponse> {
  const response = await requestJson<RankedProgressionResponse>(`${baseUrl}/ranked/progression`, {
    method: 'GET',
    headers: {
      authorization: authorizationHeader(accountId),
    },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to read ranked progression: status=${response.status}`);
  }
  return response.body;
}

async function getLeaderboard(
  baseUrl: string,
  accountId: string,
  query: Record<string, string>,
): Promise<{ status: number; body: RankedLeaderboardResponse }> {
  const search = new URLSearchParams(query);
  return await requestJson<RankedLeaderboardResponse>(`${baseUrl}/ranked/leaderboard?${search.toString()}`, {
    method: 'GET',
    headers: {
      authorization: authorizationHeader(accountId),
    },
  });
}

async function getRankedResultStatus(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
): Promise<{ status: number; body: RankedResultStatusResponse }> {
  return await requestJson<RankedResultStatusResponse>(
    `${baseUrl}/ranked/results/${sessionId}`,
    {
      method: 'GET',
      headers: {
        authorization: authorizationHeader(accountId),
        'x-match-session-token': sessionToken,
      },
    },
  );
}

async function getSession(baseUrl: string, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl}/matchmaking/sessions/${sessionId}`, {
    method: 'GET',
    headers: {
      authorization: authorizationHeader(accountId),
    },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to read session ${sessionId}: status=${response.status}`);
  }
  return response.body;
}

async function publishSignal(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  transportAttemptId: string,
  clientMessageId: string,
): Promise<{ status: number; body: { signalId?: string } & ErrorBody }> {
  return await requestJson<{ signalId?: string } & ErrorBody>(`${baseUrl}/matchmaking/sessions/${sessionId}/signals`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({
      sessionToken,
      transportAttemptId,
      clientMessageId,
      signalType: 'offer',
      payload: {
        connectionId: 'ranked-smoke-connection',
        description: { type: 'offer', sdp: 'ranked-smoke-sdp' },
      },
    }),
  });
}

async function pollSignals(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  transportAttemptId: string,
  afterSignalId = '0',
): Promise<{ status: number; body: SessionSignalsResponse & ErrorBody }> {
  const query = new URLSearchParams({ transportAttemptId, afterSignalId, limit: '100' });
  return await requestJson<SessionSignalsResponse & ErrorBody>(
    `${baseUrl}/matchmaking/sessions/${sessionId}/signals?${query.toString()}`,
    {
      method: 'GET',
      headers: {
        authorization: authorizationHeader(accountId),
        'x-match-session-token': sessionToken,
      },
    },
  );
}

async function assertLegacyFrameRelayDisabled(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
): Promise<{ submit: number; poll: number; confirm: number }> {
  const frameInput = {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
  const [submit, poll, confirm] = await Promise.all([
    requestJson<ErrorBody>(`${baseUrl}/matchmaking/sessions/${sessionId}/frames`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authorizationHeader(accountId),
      },
      body: JSON.stringify({ sessionToken, frames: [{ epoch: 0, frame: 0, input: frameInput }] }),
    }),
    requestJson<ErrorBody>(
      `${baseUrl}/matchmaking/sessions/${sessionId}/frames?epoch=0&sinceFrame=-1`,
      {
        method: 'GET',
        headers: {
          authorization: authorizationHeader(accountId),
          'x-match-session-token': sessionToken,
        },
      },
    ),
    requestJson<ErrorBody>(`${baseUrl}/matchmaking/sessions/${sessionId}/frames/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authorizationHeader(accountId),
      },
      body: JSON.stringify({ sessionToken, epoch: 0, confirmedThrough: 0 }),
    }),
  ]);
  for (const [method, response] of Object.entries({ submit, poll, confirm })) {
    if (response.status !== 404 || !response.body.error?.includes('disabled')) {
      throw new Error(
        `Expected legacy frame relay ${method} to fail closed with 404, got ${response.status}.`,
      );
    }
  }
  return { submit: submit.status, poll: poll.status, confirm: confirm.status };
}

async function markDisconnected(baseUrl: string, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl}/matchmaking/sessions/disconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({ sessionId }),
  });
  if (response.status !== 200) {
    throw new Error(`Failed to mark session disconnected: status=${response.status}`);
  }
  return response.body;
}

async function reconnectSession(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  reconnectAttemptId: string,
): Promise<{ status: number; body: unknown }> {
  return await requestJson(`${baseUrl}/matchmaking/sessions/reconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({
      sessionId,
      sessionToken,
      reconnectAttemptId,
    }),
  });
}

async function completeSession(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
): Promise<{ status: number; body: unknown }> {
  return await requestJson(`${baseUrl}/matchmaking/sessions/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader(accountId),
    },
    body: JSON.stringify({ sessionId, sessionToken }),
  });
}

async function run(): Promise<void> {
  const baseUrl = String(process.env.API_BASE_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
  const waitSeconds = Math.max(0, Number(process.env.ONLINE_SMOKE_WAIT_SECONDS ?? '33'));
  await assertSafeSmokeTarget(baseUrl, 'Ranked online smoke');

  const account1 = await createAccount(baseUrl);
  const account2 = await createAccount(baseUrl);
  const outsiderAccount = await createAccount(baseUrl);
  const smokeIdentity = `${process.pid}-${Date.now().toString(36)}`;
  const leaderboardRegion = `ranked-smoke-${smokeIdentity}`;
  const account1DisplayName = `Smoke A ${smokeIdentity}`;
  const account2DisplayName = `Smoke B ${smokeIdentity}`;
  await updateProfile(baseUrl, account1, account1DisplayName, leaderboardRegion);
  await updateProfile(baseUrl, account2, account2DisplayName, leaderboardRegion);
  await updateProfile(baseUrl, outsiderAccount, `Smoke X ${smokeIdentity}`, `${leaderboardRegion}-outsider`);
  const join1 = await joinRankedQueue(baseUrl, account1, 'vanguard');
  const join2 = await joinRankedQueue(baseUrl, account2, 'duelist');
  if (join1.joinDisposition !== 'created' || join2.joinDisposition !== 'created') {
    throw new Error('Fresh ranked queue joins did not report created ticket disposition.');
  }
  const ticket1 = join1.status === 'matched' ? join1 : await getTicket(baseUrl, account1, join1.ticketId);
  const ticket2 = join2.status === 'matched' ? join2 : await getTicket(baseUrl, account2, join2.ticketId);

  if (!ticket1.matchStart || !ticket2.matchStart) {
    throw new Error('Ranked smoke failed because tickets did not produce a matched session.');
  }
  const reusedJoin = await joinRankedQueue(baseUrl, account1, 'vanguard');
  if (reusedJoin.joinDisposition !== 'existing' || reusedJoin.ticketId !== ticket1.ticketId) {
    throw new Error('Repeated ranked queue join did not identify the existing matched ticket.');
  }

  const sessionId = ticket1.matchStart.sessionId;
  if (ticket2.matchStart.sessionId !== sessionId) {
    throw new Error('Matched tickets did not agree on session id.');
  }
  const transportAttemptId = ticket1.matchStart.transportAttempt.attemptId;
  if (ticket2.matchStart.transportAttempt.attemptId !== transportAttemptId) {
    throw new Error('Matched tickets did not agree on transport attempt id.');
  }

  const initialSession = await getSession(baseUrl, account1, sessionId);
  if (initialSession.status !== 'active') {
    throw new Error(`Expected active session before smoke actions, got ${initialSession.status}`);
  }

  const signalMessageId = `ranked-smoke-offer-${Date.now()}`;
  const publishedSignal = await publishSignal(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    transportAttemptId,
    signalMessageId,
  );
  if (publishedSignal.status !== 200 || !publishedSignal.body.signalId) {
    throw new Error(`Expected signaling publish success, got status=${publishedSignal.status}`);
  }
  const repeatedSignal = await publishSignal(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    transportAttemptId,
    signalMessageId,
  );
  if (
    repeatedSignal.status !== 200
    || repeatedSignal.body.signalId !== publishedSignal.body.signalId
  ) {
    throw new Error('Expected signaling publish idempotency to preserve the signal id.');
  }
  const peerSignals = await pollSignals(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    transportAttemptId,
  );
  if (
    peerSignals.status !== 200
    || peerSignals.body.signals.length !== 1
    || peerSignals.body.signals[0]?.senderAccountId !== account1
    || peerSignals.body.signals[0]?.signalType !== 'offer'
  ) {
    throw new Error('Expected the authenticated peer to receive exactly one idempotent offer signal.');
  }
  const senderSignals = await pollSignals(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    transportAttemptId,
  );
  if (senderSignals.status !== 200 || senderSignals.body.signals.length !== 0) {
    throw new Error('Expected signaling mailbox to hide a sender\'s own messages.');
  }
  const outsiderSignals = await pollSignals(
    baseUrl,
    outsiderAccount,
    sessionId,
    ticket1.matchStart.sessionToken,
    transportAttemptId,
  );
  if (outsiderSignals.status !== 403) {
    throw new Error(`Expected outsider signaling poll to be rejected with 403, got ${outsiderSignals.status}`);
  }

  const legacyFrameRelayStatuses = await assertLegacyFrameRelayDisabled(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
  );

  const disconnectedSession = await markDisconnected(baseUrl, account2, sessionId);
  const disconnectedParticipant = disconnectedSession.participants.find((participant) => participant.accountId === account2);
  if (!disconnectedParticipant || disconnectedParticipant.connectionStatus !== 'disconnected') {
    throw new Error('Expected second participant to be marked disconnected.');
  }

  const reconnectAttemptId = `smoke-reconnect-${Date.now()}`;
  const reconnect = await reconnectSession(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    reconnectAttemptId,
  );
  if (reconnect.status !== 200) {
    throw new Error(`Expected reconnect success, got status=${reconnect.status}`);
  }

  const replayedReconnect = await reconnectSession(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    reconnectAttemptId,
  );
  if (replayedReconnect.status !== 409) {
    throw new Error(`Expected replayed reconnect attempt to be rejected, got status=${replayedReconnect.status}`);
  }

  const postReconnectSession = await getSession(baseUrl, account1, sessionId);
  const reconnectedParticipant = postReconnectSession.participants.find((participant) => participant.accountId === account2);
  if (!reconnectedParticipant || reconnectedParticipant.connectionStatus !== 'connected') {
    throw new Error('Expected second participant to be reconnected after reconnect request.');
  }

  if (waitSeconds > 0) {
    await sleep(waitSeconds * 1000);
  }
  const rankedProof = createRankedProofFixture({
    sessionId,
    buildVersion: SMOKE_BUILD_VERSION,
    rulesetVersion: SMOKE_RULESET_VERSION,
    balanceProfileId: SMOKE_BALANCE_PROFILE_ID,
  });

  const drawSubmission = await submitRankedDraw(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    [account1, account2],
    rankedProof,
  );
  if (drawSubmission.status !== 422 || drawSubmission.body.code !== 'ranked_draw_no_contest') {
    throw new Error(`Expected ranked draw to be rejected as no-contest, got ${JSON.stringify(drawSubmission)}.`);
  }

  const account1Side = initialSession.participants.find(({ accountId }) => accountId === account1)?.side;
  const account2Side = initialSession.participants.find(({ accountId }) => accountId === account2)?.side;
  if (!account1Side || !account2Side) {
    throw new Error('Ranked smoke session did not expose both server-assigned player sides.');
  }
  const account1CommitmentCount = await submitRankedInputCommitments(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    account1Side,
    rankedProof,
  );

  const firstSubmission = await submitRankedResult(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    [account1, account2],
    account1,
    rankedProof,
  );
  if (firstSubmission.status !== 202) {
    throw new Error(`Expected first ranked result submission to await peer confirmation, got status=${firstSubmission.status}`);
  }
  const verifiedProofDigest = firstSubmission.body.proof?.digest ?? '';
  if (!/^[a-f0-9]{64}$/.test(verifiedProofDigest)) {
    throw new Error('First ranked result did not return a canonical verified proof digest.');
  }

  const outsiderSubmission = await submitRankedResult(
    baseUrl,
    outsiderAccount,
    sessionId,
    ticket1.matchStart.sessionToken,
    [account1, account2],
    account1,
    rankedProof,
  );
  if (outsiderSubmission.status !== 403) {
    throw new Error(`Expected outsider ranked result submission to be rejected, got status=${outsiderSubmission.status}`);
  }

  const invalidTokenSubmission = await submitRankedResult(
    baseUrl,
    account2,
    sessionId,
    'invalid_token',
    [account1, account2],
    account1,
    rankedProof,
  );
  if (invalidTokenSubmission.status !== 401) {
    throw new Error(`Expected invalid ranked result token to be rejected, got status=${invalidTokenSubmission.status}`);
  }

  const tamperedProof = structuredClone(rankedProof);
  tamperedProof.rounds[0].finalChecksum = (tamperedProof.rounds[0].finalChecksum ^ 1) >>> 0;
  const tamperedProofSubmission = await submitRankedResult(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    [account1, account2],
    account1,
    tamperedProof,
  );
  if (tamperedProofSubmission.status !== 422) {
    throw new Error(`Expected tampered ranked proof to be rejected, got status=${tamperedProofSubmission.status}`);
  }
  const tamperedProofError = tamperedProofSubmission.body;
  if (
    tamperedProofError.code !== 'invalid_ranked_proof'
    || tamperedProofError.proofErrorCode !== 'checksum_mismatch'
  ) {
    throw new Error(`Tampered proof returned unexpected verification error: ${JSON.stringify(tamperedProofError)}`);
  }

  const account2CommitmentCount = await submitRankedInputCommitments(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    account2Side,
    rankedProof,
  );

  const peerSubmission = await submitRankedResult(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    [account1, account2],
    account1,
    rankedProof,
  );
  if (peerSubmission.status !== 201) {
    throw new Error(`Expected peer-ranked result confirmation to settle, got status=${peerSubmission.status}`);
  }
  if (peerSubmission.body.proof?.digest !== verifiedProofDigest) {
    throw new Error('Peer settlement did not reference the same verified proof digest.');
  }
  const inputAttestation = peerSubmission.body.proof.inputAttestation;
  if (
    inputAttestation?.status !== 'match_verified'
    || inputAttestation.evidence.schemaVersion !== 'gw.ranked-input-attestation.v1'
    || inputAttestation.evidence.participants.length !== 2
    || !inputAttestation.evidence.participants.every((participant) => (
      participant.commitmentCount > 0
      && participant.committedFrameCount > 0
      && /^[0-9a-f]{64}$/.test(participant.finalChainDigest)
    ))
  ) {
    throw new Error('Peer settlement did not retain both server-observed input commitment chains.');
  }

  const duplicateSubmission = await submitRankedResult(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    [account1, account2],
    account1,
    rankedProof,
  );
  if (duplicateSubmission.status !== 409) {
    throw new Error(`Expected duplicate ranked result submission to be rejected, got status=${duplicateSubmission.status}`);
  }

  const settledStatus = await getRankedResultStatus(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
  );
  if (settledStatus.status !== 200 || settledStatus.body.status !== 'accepted') {
    throw new Error(`Expected first participant to observe accepted settlement, got status=${settledStatus.status}`);
  }
  if (settledStatus.body.proof?.digest !== verifiedProofDigest) {
    throw new Error('Settled ranked status did not retain the verified proof digest.');
  }

  const [progression, opponentProgression] = await Promise.all([
    getProgression(baseUrl, account1),
    getProgression(baseUrl, account2),
  ]);
  const seasonId = progression.seasonId;
  if (!seasonId || opponentProgression.seasonId !== seasonId) {
    throw new Error('Settled participants did not resolve to the same active ranked season.');
  }

  const leaderboardQuery = {
    seasonId,
    region: leaderboardRegion,
    limit: '100',
    offset: '0',
  };
  const leaderboard = await getLeaderboard(baseUrl, account1, leaderboardQuery);
  if (leaderboard.status !== 200) {
    throw new Error(`Expected leaderboard success after settlement, got status=${leaderboard.status}.`);
  }
  if (
    leaderboard.body.season.seasonId !== seasonId
    || leaderboard.body.filter.region !== leaderboardRegion
    || leaderboard.body.filter.track !== 'rating'
    || leaderboard.body.page.total !== 2
    || leaderboard.body.items.length !== 2
  ) {
    throw new Error(`Leaderboard did not preserve the requested season/region cohort: ${JSON.stringify(leaderboard.body)}.`);
  }

  const [winnerEntry, loserEntry] = leaderboard.body.items;
  if (
    !winnerEntry
    || !loserEntry
    || winnerEntry.accountId !== account1
    || loserEntry.accountId !== account2
    || !Number.isInteger(winnerEntry.rank)
    || !Number.isInteger(loserEntry.rank)
    || winnerEntry.rank < 1
    || loserEntry.rank <= winnerEntry.rank
  ) {
    throw new Error(`Leaderboard ordering was not deterministic after settlement: ${JSON.stringify(leaderboard.body.items)}.`);
  }
  if (
    winnerEntry.displayName !== account1DisplayName
    || loserEntry.displayName !== account2DisplayName
    || winnerEntry.region !== leaderboardRegion
    || loserEntry.region !== leaderboardRegion
    || winnerEntry.rating !== progression.current?.rating
    || loserEntry.rating !== opponentProgression.current?.rating
  ) {
    throw new Error('Leaderboard identity or rating did not match the canonical progression response.');
  }
  if (
    winnerEntry.matchesPlayed !== 1
    || winnerEntry.wins !== 1
    || winnerEntry.losses !== 0
    || loserEntry.matchesPlayed !== 1
    || loserEntry.wins !== 0
    || loserEntry.losses !== 1
  ) {
    throw new Error(`Leaderboard counters did not match the settled match: ${JSON.stringify(leaderboard.body.items)}.`);
  }

  const publicLeaderboardKeys = new Set([
    'rank',
    'accountId',
    'displayName',
    'region',
    'rating',
    'matchesPlayed',
    'wins',
    'losses',
    'draws',
    'forfeits',
    'leagueTier',
    'leaguePoints',
    'mrPoints',
    'provisional',
    'updatedAt',
  ]);
  for (const item of leaderboard.body.items) {
    const privateKeys = Object.keys(item).filter((key) => !publicLeaderboardKeys.has(key));
    if (privateKeys.length > 0) {
      throw new Error(`Leaderboard exposed unexpected fields: ${privateKeys.join(', ')}.`);
    }
  }

  const [firstPage, secondPage, outsiderRead, masterLeaderboard] = await Promise.all([
    getLeaderboard(baseUrl, account1, { ...leaderboardQuery, limit: '1', offset: '0' }),
    getLeaderboard(baseUrl, account1, { ...leaderboardQuery, limit: '1', offset: '1' }),
    getLeaderboard(baseUrl, outsiderAccount, leaderboardQuery),
    getLeaderboard(baseUrl, account1, { ...leaderboardQuery, track: 'master' }),
  ]);
  if (
    firstPage.status !== 200
    || firstPage.body.page.total !== 2
    || firstPage.body.page.limit !== 1
    || firstPage.body.page.offset !== 0
    || firstPage.body.items[0]?.accountId !== account1
    || secondPage.status !== 200
    || secondPage.body.page.total !== 2
    || secondPage.body.page.limit !== 1
    || secondPage.body.page.offset !== 1
    || secondPage.body.items[0]?.accountId !== account2
    || firstPage.body.items[0]?.accountId === secondPage.body.items[0]?.accountId
  ) {
    throw new Error('Leaderboard pagination did not produce stable, non-overlapping pages.');
  }
  if (
    outsiderRead.status !== 200
    || outsiderRead.body.items.map((item) => item.accountId).join(',') !== `${account1},${account2}`
  ) {
    throw new Error('Authenticated non-participant could not read the public leaderboard cohort.');
  }
  if (
    masterLeaderboard.status !== 200
    || masterLeaderboard.body.filter.track !== 'master'
    || masterLeaderboard.body.page.total !== 0
    || masterLeaderboard.body.items.length !== 0
  ) {
    throw new Error('Master leaderboard did not remain isolated from pre-Master rating entries.');
  }

  const unauthorizedLeaderboard = await requestJson<ErrorBody>(
    `${baseUrl}/ranked/leaderboard?${new URLSearchParams(leaderboardQuery).toString()}`,
    { method: 'GET' },
  );
  if (unauthorizedLeaderboard.status !== 401) {
    throw new Error(`Expected unsigned leaderboard request to be rejected with 401, got ${unauthorizedLeaderboard.status}.`);
  }

  const firstCompletion = await completeSession(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
  );
  const firstCompletionBody = firstCompletion.body as SessionView;
  if (firstCompletion.status !== 200 || firstCompletionBody.status !== 'active') {
    throw new Error(`Expected first completion attestation to leave the session active, got status=${firstCompletion.status}`);
  }
  if (!firstCompletionBody.participants.find(({ accountId }) => accountId === account1)?.completionAttestedAt) {
    throw new Error('Expected first completion attestation to be visible in the active session.');
  }
  const completion = await completeSession(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
  );
  const completionBody = completion.body as SessionView;
  if (
    completion.status !== 200
    || completionBody.status !== 'resolved'
    || completionBody.resolvedReason !== 'completed'
  ) {
    throw new Error(`Expected both completion attestations to resolve the ranked session, got status=${completion.status}`);
  }

  const limitedAccount = await createAccount(baseUrl);
  const protectedPeer = await createAccount(baseUrl);
  const limitedJoin = await joinRankedQueue(baseUrl, limitedAccount, 'vanguard');
  const protectedJoin = await joinRankedQueue(baseUrl, protectedPeer, 'duelist');
  const limitedTicket = limitedJoin.status === 'matched'
    ? limitedJoin
    : await getTicket(baseUrl, limitedAccount, limitedJoin.ticketId);
  const protectedTicket = protectedJoin.status === 'matched'
    ? protectedJoin
    : await getTicket(baseUrl, protectedPeer, protectedJoin.ticketId);
  if (!limitedTicket.matchStart || !protectedTicket.matchStart) {
    throw new Error('Ranked proof limiter smoke did not produce a matched session.');
  }
  const limitedSessionId = limitedTicket.matchStart.sessionId;
  if (protectedTicket.matchStart.sessionId !== limitedSessionId) {
    throw new Error('Ranked proof limiter smoke tickets did not agree on session id.');
  }
  const limiterRankedProof = createRankedProofFixture({
    sessionId: limitedSessionId,
    buildVersion: SMOKE_BUILD_VERSION,
    rulesetVersion: SMOKE_RULESET_VERSION,
    balanceProfileId: SMOKE_BALANCE_PROFILE_ID,
  });
  const limiterSession = await getSession(baseUrl, limitedAccount, limitedSessionId);
  const protectedPeerSide = limiterSession.participants
    .find(({ accountId }) => accountId === protectedPeer)?.side;
  if (!protectedPeerSide) {
    throw new Error('Ranked proof limiter session did not expose the protected peer side.');
  }
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const invalidProof = structuredClone(limiterRankedProof);
    invalidProof.rounds[0].finalChecksum = (
      invalidProof.rounds[0].finalChecksum ^ attempt
    ) >>> 0;
    const invalidSubmission = await submitRankedResult(
      baseUrl,
      limitedAccount,
      limitedSessionId,
      limitedTicket.matchStart.sessionToken,
      [limitedAccount, protectedPeer],
      limitedAccount,
      invalidProof,
    );
    if (invalidSubmission.status !== 422) {
      throw new Error(
        `Expected limiter setup attempt ${attempt} to reach proof rejection, got ${invalidSubmission.status}.`,
      );
    }
  }
  const limitedSubmission = await submitRankedResult(
    baseUrl,
    limitedAccount,
    limitedSessionId,
    limitedTicket.matchStart.sessionToken,
    [limitedAccount, protectedPeer],
    limitedAccount,
    limiterRankedProof,
  );
  if (
    limitedSubmission.status !== 429
    || limitedSubmission.body.code !== 'ranked_proof_rate_limited'
    || !Number.isInteger(limitedSubmission.body.retryAfterSeconds)
  ) {
    throw new Error(`Expected exhausted proof budget to return retryable 429, got ${JSON.stringify(limitedSubmission)}.`);
  }
  await submitRankedInputCommitments(
    baseUrl,
    protectedPeer,
    limitedSessionId,
    protectedTicket.matchStart.sessionToken,
    protectedPeerSide,
    limiterRankedProof,
  );
  const protectedPeerSubmission = await submitRankedResult(
    baseUrl,
    protectedPeer,
    limitedSessionId,
    protectedTicket.matchStart.sessionToken,
    [limitedAccount, protectedPeer],
    limitedAccount,
    limiterRankedProof,
  );
  if (protectedPeerSubmission.status !== 202) {
    throw new Error(
      `Expected the protected peer's independent proof path to remain available, got ${protectedPeerSubmission.status}.`,
    );
  }
  const limitedCleanup = await completeSession(
    baseUrl,
    limitedAccount,
    limitedSessionId,
    limitedTicket.matchStart.sessionToken,
  );
  const limitedCleanupBody = limitedCleanup.body as SessionView;
  if (limitedCleanup.status !== 200 || limitedCleanupBody.status !== 'active') {
    throw new Error(
      `Expected the first limiter-smoke completion to leave the session active, got status=${limitedCleanup.status}.`,
    );
  }
  const protectedCleanup = await completeSession(
    baseUrl,
    protectedPeer,
    limitedSessionId,
    protectedTicket.matchStart.sessionToken,
  );
  const protectedCleanupBody = protectedCleanup.body as SessionView;
  if (
    protectedCleanup.status !== 200
    || protectedCleanupBody.status !== 'resolved'
    || protectedCleanupBody.resolvedReason !== 'completed'
  ) {
    throw new Error(
      `Expected limiter-smoke cleanup to resolve the session, got status=${protectedCleanup.status}.`,
    );
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    waitSeconds,
    account1,
    account2,
    outsiderAccount,
    sessionId,
    signalingPublished: true,
    signalingIdempotent: true,
    signalingPeerIsolation: true,
    outsiderSignalingStatus: outsiderSignals.status,
    legacyFrameRelayDisabled: true,
    legacyFrameRelayStatuses,
    reconnectStatus: reconnect.status,
    replayedReconnectStatus: replayedReconnect.status,
    firstSubmissionStatus: firstSubmission.status,
    drawSubmissionStatus: drawSubmission.status,
    drawPolicyCode: drawSubmission.body.code,
    proofDigest: verifiedProofDigest,
    inputCommitments: {
      account1: account1CommitmentCount,
      account2: account2CommitmentCount,
      attestedParticipants: inputAttestation.evidence.participants.length,
    },
    tamperedProofStatus: tamperedProofSubmission.status,
    tamperedProofErrorCode: tamperedProofError.proofErrorCode,
    peerSubmissionStatus: peerSubmission.status,
    outsiderSubmissionStatus: outsiderSubmission.status,
    invalidTokenSubmissionStatus: invalidTokenSubmission.status,
    duplicateSubmissionStatus: duplicateSubmission.status,
    settledStatus: settledStatus.body.status,
    firstCompletionSessionStatus: firstCompletionBody.status,
    sessionCompletionStatus: completionBody.status,
    proofRateLimit: {
      exhaustedParticipantStatus: limitedSubmission.status,
      exhaustedParticipantCode: limitedSubmission.body.code,
      retryAfterSeconds: limitedSubmission.body.retryAfterSeconds,
      protectedPeerStatus: protectedPeerSubmission.status,
      cleanupSessionStatus: protectedCleanupBody.status,
      cleanupResolvedReason: protectedCleanupBody.resolvedReason,
    },
    progression: {
      seasonId: progression.seasonId,
      rating: progression.current?.rating ?? null,
      calibrationMatchesPlayed: progression.current?.placement?.calibrationMatchesPlayed ?? null,
    },
    leaderboard: {
      region: leaderboardRegion,
      total: leaderboard.body.page.total,
      orderedAccountIds: leaderboard.body.items.map((item) => item.accountId),
      ratingsMatchProgression: true,
      countersMatchSettlement: true,
      paginationStable: true,
      outsiderReadStatus: outsiderRead.status,
      unsignedReadStatus: unauthorizedLeaderboard.status,
      masterTrackTotal: masterLeaderboard.body.page.total,
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
