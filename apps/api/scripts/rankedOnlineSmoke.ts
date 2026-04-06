import process from 'node:process';

interface AccountRecord {
  id: string;
}

interface QueueJoinResponse {
  ticketId: string;
  accountId: string;
  status: 'queued' | 'matched' | 'closed';
  matchStart?: {
    sessionId: string;
    sessionToken: string;
  };
}

interface SessionView {
  sessionId: string;
  status: 'active' | 'resolved';
  participants: Array<{
    accountId: string;
    side: 'P1' | 'P2';
    connectionStatus: 'connected' | 'disconnected';
  }>;
}

interface FrameRelayResponse {
  frames: Array<{
    frame: number;
    accountId: string;
    input: Record<string, unknown>;
    receivedAt: string;
  }>;
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
  if (response.status !== 201 || !response.body?.id) {
    throw new Error(`Failed to create account: status=${response.status}`);
  }
  return response.body.id;
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
      'x-account-id': accountId,
    },
    body: JSON.stringify({
      queueType: 'ranked',
      regionPreferences: ['eu-west'],
      buildVersion: 'prototype-2026.02',
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
      'x-account-id': accountId,
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
): Promise<{ status: number; body: unknown }> {
  return await requestJson(`${baseUrl}/ranked/results`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-account-id': accountId,
    },
    body: JSON.stringify({
      sessionId,
      matchId: sessionId,
      sessionToken,
      outcome: 'p1_win',
      participantAccountIds,
      winnerAccountId,
    }),
  });
}

async function getProgression(baseUrl: string, accountId: string): Promise<RankedProgressionResponse> {
  const response = await requestJson<RankedProgressionResponse>(`${baseUrl}/ranked/progression`, {
    method: 'GET',
    headers: {
      'x-account-id': accountId,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to read ranked progression: status=${response.status}`);
  }
  return response.body;
}

async function getSession(baseUrl: string, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl}/matchmaking/sessions/${sessionId}`, {
    method: 'GET',
    headers: {
      'x-account-id': accountId,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to read session ${sessionId}: status=${response.status}`);
  }
  return response.body;
}

async function submitFrames(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  frame: number,
): Promise<void> {
  const response = await requestJson<{ acceptedFrames: number }>(`${baseUrl}/matchmaking/sessions/${sessionId}/frames`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-account-id': accountId,
    },
    body: JSON.stringify({
      sessionToken,
      frames: [{
        frame,
        input: {
          moveX: 0,
          moveY: 0,
          boost: false,
          superBoost: false,
          special: false,
          launch: false,
          dunk: false,
          parry: false,
          breakLaunch: false,
        },
      }],
    }),
  });
  if (response.status !== 200 || response.body.acceptedFrames !== 1) {
    throw new Error(`Expected frame submit success for frame ${frame}, got status=${response.status}`);
  }
}

async function pollFrames(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  sinceFrame: number,
): Promise<FrameRelayResponse> {
  const response = await requestJson<FrameRelayResponse>(
    `${baseUrl}/matchmaking/sessions/${sessionId}/frames?sessionToken=${encodeURIComponent(sessionToken)}&sinceFrame=${sinceFrame}`,
    {
      method: 'GET',
      headers: {
        'x-account-id': accountId,
      },
    },
  );
  if (response.status !== 200) {
    throw new Error(`Failed to poll relayed frames: status=${response.status}`);
  }
  return response.body;
}

async function pollFramesExpectingStatus(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  sinceFrame: number,
): Promise<{ status: number; body: ErrorBody }> {
  return await requestJson<ErrorBody>(
    `${baseUrl}/matchmaking/sessions/${sessionId}/frames?sessionToken=${encodeURIComponent(sessionToken)}&sinceFrame=${sinceFrame}`,
    {
      method: 'GET',
      headers: {
        'x-account-id': accountId,
      },
    },
  );
}

async function markDisconnected(baseUrl: string, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl}/matchmaking/sessions/disconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-account-id': accountId,
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
      'x-account-id': accountId,
    },
    body: JSON.stringify({
      sessionId,
      sessionToken,
      reconnectAttemptId,
    }),
  });
}

async function run(): Promise<void> {
  const baseUrl = String(process.env.API_BASE_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
  const waitSeconds = Math.max(0, Number(process.env.ONLINE_SMOKE_WAIT_SECONDS ?? '33'));

  const account1 = await createAccount(baseUrl);
  const account2 = await createAccount(baseUrl);
  const outsiderAccount = await createAccount(baseUrl);
  const join1 = await joinRankedQueue(baseUrl, account1, 'vanguard');
  const join2 = await joinRankedQueue(baseUrl, account2, 'duelist');
  const ticket1 = join1.status === 'matched' ? join1 : await getTicket(baseUrl, account1, join1.ticketId);
  const ticket2 = join2.status === 'matched' ? join2 : await getTicket(baseUrl, account2, join2.ticketId);

  if (!ticket1.matchStart || !ticket2.matchStart) {
    throw new Error('Ranked smoke failed because tickets did not produce a matched session.');
  }

  const sessionId = ticket1.matchStart.sessionId;
  if (ticket2.matchStart.sessionId !== sessionId) {
    throw new Error('Matched tickets did not agree on session id.');
  }

  const initialSession = await getSession(baseUrl, account1, sessionId);
  if (initialSession.status !== 'active') {
    throw new Error(`Expected active session before smoke actions, got ${initialSession.status}`);
  }

  await submitFrames(baseUrl, account1, sessionId, ticket1.matchStart.sessionToken, 0);
  const relayedFrames = await pollFrames(baseUrl, account2, sessionId, ticket2.matchStart.sessionToken, -1);
  if (!relayedFrames.frames.some((entry) => entry.frame === 0 && entry.accountId === account1)) {
    throw new Error('Expected peer frame relay to deliver frame 0 to the second account.');
  }

  const invalidPoll = await pollFramesExpectingStatus(
    baseUrl,
    account2,
    sessionId,
    'invalid_token',
    -1,
  );
  if (invalidPoll.status !== 401) {
    throw new Error(`Expected invalid frame poll token to be rejected with 401, got status=${invalidPoll.status}`);
  }

  const invalidFrameSubmit = await requestJson<ErrorBody>(`${baseUrl}/matchmaking/sessions/${sessionId}/frames`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-account-id': account1,
    },
    body: JSON.stringify({
      sessionToken: 'invalid_token',
      frames: [{
        frame: 1,
        input: {
          moveX: 0,
          moveY: 0,
          boost: false,
          superBoost: false,
          special: false,
          launch: false,
          dunk: false,
          parry: false,
          breakLaunch: false,
        },
      }],
    }),
  });
  if (invalidFrameSubmit.status !== 401) {
    throw new Error(`Expected invalid frame submit token to be rejected with 401, got status=${invalidFrameSubmit.status}`);
  }

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

  const firstSubmission = await submitRankedResult(
    baseUrl,
    account1,
    sessionId,
    ticket1.matchStart.sessionToken,
    [account1, account2],
    account1,
  );
  if (firstSubmission.status !== 201) {
    throw new Error(`Expected first ranked result submission to succeed, got status=${firstSubmission.status}`);
  }

  const outsiderSubmission = await submitRankedResult(
    baseUrl,
    outsiderAccount,
    sessionId,
    ticket1.matchStart.sessionToken,
    [account1, account2],
    account1,
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
  );
  if (invalidTokenSubmission.status !== 401) {
    throw new Error(`Expected invalid ranked result token to be rejected, got status=${invalidTokenSubmission.status}`);
  }

  const duplicateSubmission = await submitRankedResult(
    baseUrl,
    account2,
    sessionId,
    ticket2.matchStart.sessionToken,
    [account1, account2],
    account1,
  );
  if (duplicateSubmission.status !== 409) {
    throw new Error(`Expected duplicate ranked result submission to be rejected, got status=${duplicateSubmission.status}`);
  }

  const progression = await getProgression(baseUrl, account1);

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    waitSeconds,
    account1,
    account2,
    outsiderAccount,
    sessionId,
    relayFrameDelivered: true,
    invalidPollStatus: invalidPoll.status,
    invalidFrameSubmitStatus: invalidFrameSubmit.status,
    reconnectStatus: reconnect.status,
    replayedReconnectStatus: replayedReconnect.status,
    firstSubmissionStatus: firstSubmission.status,
    outsiderSubmissionStatus: outsiderSubmission.status,
    invalidTokenSubmissionStatus: invalidTokenSubmission.status,
    duplicateSubmissionStatus: duplicateSubmission.status,
    progression: {
      seasonId: progression.seasonId,
      rating: progression.current?.rating ?? null,
      calibrationMatchesPlayed: progression.current?.placement?.calibrationMatchesPlayed ?? null,
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
