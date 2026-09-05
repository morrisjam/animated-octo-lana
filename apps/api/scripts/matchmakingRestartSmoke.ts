import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { RankedMatchProof } from '../../game-web/src/sim/rankedProof';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';
import {
  createRankedInputCommitmentFixture,
  createRankedProofFixture,
} from './rankedProofFixture';

interface AccountRecord {
  id: string;
  accessToken: string;
}

interface QueueTicket {
  ticketId: string;
  status: 'queued' | 'matched' | 'closed';
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
  participants: Array<{
    accountId: string;
    side: 'P1' | 'P2';
    connectionStatus: 'connected' | 'disconnected';
  }>;
}

interface RuntimeView {
  draining?: boolean;
  activeSessions?: number;
  disconnectedParticipants?: number;
}

interface SignalsView {
  signals: Array<{
    signalId: string;
    senderAccountId: string;
    signalType: string;
  }>;
}

interface RankedResultStatus {
  status: 'awaiting_peer_confirmation' | 'accepted' | 'flagged_for_review';
  proof?: {
    inputAttestation?: {
      status: 'participant_verified' | 'match_verified';
      evidence: {
        schemaVersion: string;
        participants: Array<{ accountId: string; finalChainDigest: string }>;
      };
    };
  };
}

interface ManagedApi {
  child: ChildProcessWithoutNullStreams;
  logs: string;
  generation: number;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADMIN_KEY = 'local-restart-smoke-admin-key-0123456789';
const SMOKE_BUILD_VERSION = 'prototype-2026.09';
const SMOKE_RULESET_VERSION = 'prototype-2026.09';
const SMOKE_BALANCE_PROFILE_ID = 'default';
const AUTH_SECRET = 'local-restart-smoke-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString('hex');
const accessTokenByAccountId = new Map<string, string>();

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '8791');
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error('MATCHMAKING_RESTART_SMOKE_PORT must be an integer between 1024 and 65535.');
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function appendLogs(server: ManagedApi, chunk: Buffer): void {
  server.logs = `${server.logs}${chunk.toString('utf8')}`.slice(-64_000);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve text responses for failure diagnostics.
  }
  return { status: response.status, body: body as T };
}

function authorizationHeaders(accountId: string): Record<string, string> {
  const accessToken = accessTokenByAccountId.get(accountId);
  if (!accessToken) {
    throw new Error(`Missing access token for account ${accountId}.`);
  }
  return { authorization: `Bearer ${accessToken}` };
}

async function waitForHealth(server: ManagedApi, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() <= deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`API generation ${server.generation} exited during startup.\n${server.logs}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // The port may not be bound yet.
    }
    await sleep(100);
  }
  throw new Error(`API generation ${server.generation} did not become healthy.\n${server.logs}`);
}

async function startApi(
  port: number,
  generation: number,
  namespace: string,
): Promise<ManagedApi> {
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the matchmaking restart smoke.');
  }
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/server.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(port),
        NODE_ENV: 'test',
        AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET ?? AUTH_SECRET,
        AUTH_RATE_LIMIT_SECRET,
        MATCHMAKING_ACCESS_MODE: 'open',
        MATCHMAKING_RECONNECT_GRACE_SECONDS:
          process.env.MATCHMAKING_RECONNECT_GRACE_SECONDS ?? '60',
        MATCHMAKING_SNAPSHOT_INTERVAL_MS: '60000',
        MATCHMAKING_RUNTIME_NAMESPACE: namespace,
        SLO_ADMIN_KEY: ADMIN_KEY,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const server: ManagedApi = { child, logs: '', generation };
  child.stdout.on('data', (chunk: Buffer) => appendLogs(server, chunk));
  child.stderr.on('data', (chunk: Buffer) => appendLogs(server, chunk));
  await waitForHealth(server, `http://127.0.0.1:${port}`);
  return server;
}

async function stopApi(server: ManagedApi): Promise<void> {
  if (server.child.exitCode !== null) {
    return;
  }
  const closed = new Promise<void>((resolveClose) => {
    server.child.once('close', () => resolveClose());
  });
  server.child.kill('SIGTERM');
  const graceful = await Promise.race([
    closed.then(() => true),
    sleep(10_000).then(() => false),
  ]);
  if (!graceful && server.child.exitCode === null) {
    server.child.kill('SIGKILL');
    await closed;
  }
}

async function setDraining(baseUrl: string, draining: boolean): Promise<RuntimeView> {
  const response = await requestJson<RuntimeView>(`${baseUrl}/ops/matchmaking/drain`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
    },
    body: JSON.stringify({ draining }),
  });
  if (response.status !== 200 || response.body.draining !== draining) {
    throw new Error(`Could not set matchmaking drain=${draining}: status=${response.status}`);
  }
  return response.body;
}

async function checkpointRuntime(baseUrl: string): Promise<RuntimeView> {
  const response = await requestJson<RuntimeView>(`${baseUrl}/ops/matchmaking/runtime`, {
    headers: { 'x-admin-key': ADMIN_KEY },
  });
  if (response.status !== 200) {
    throw new Error(`Could not checkpoint matchmaking runtime: status=${response.status}`);
  }
  return response.body;
}

async function createAccount(baseUrl: string): Promise<string> {
  const response = await requestJson<AccountRecord>(`${baseUrl}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status !== 201 || !response.body.id || !response.body.accessToken) {
    throw new Error(`Could not create restart-smoke account: status=${response.status}`);
  }
  accessTokenByAccountId.set(response.body.id, response.body.accessToken);
  return response.body.id;
}

async function joinRankedQueue(
  baseUrl: string,
  accountId: string,
  characterId: 'vanguard' | 'duelist',
): Promise<QueueTicket> {
  const response = await requestJson<QueueTicket>(`${baseUrl}/matchmaking/queue/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
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
    throw new Error(`Could not join restart-smoke queue for ${accountId}: status=${response.status}`);
  }
  return response.body;
}

async function getTicket(baseUrl: string, accountId: string, ticketId: string): Promise<QueueTicket> {
  const response = await requestJson<QueueTicket>(`${baseUrl}/matchmaking/queue/tickets/${ticketId}`, {
    headers: authorizationHeaders(accountId),
  });
  if (response.status !== 200) {
    throw new Error(`Could not read restart-smoke ticket ${ticketId}: status=${response.status}`);
  }
  return response.body;
}

async function getSession(baseUrl: string, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl}/matchmaking/sessions/${sessionId}`, {
    headers: authorizationHeaders(accountId),
  });
  if (response.status !== 200) {
    throw new Error(`Could not read restart-smoke session ${sessionId}: status=${response.status}`);
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
): Promise<string> {
  const response = await requestJson<{ signalId?: string }>(
    `${baseUrl}/matchmaking/sessions/${sessionId}/signals`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authorizationHeaders(accountId),
      },
      body: JSON.stringify({
        sessionToken,
        transportAttemptId,
        clientMessageId,
        signalType: 'offer',
        payload: {
          connectionId: 'restart-smoke-connection',
          description: { type: 'offer', sdp: 'restart-smoke-sdp' },
        },
      }),
    },
  );
  if (response.status !== 200 || !response.body.signalId) {
    throw new Error(`Could not publish restart-smoke signal: status=${response.status}`);
  }
  return response.body.signalId;
}

async function pollSignals(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  transportAttemptId: string,
): Promise<SignalsView> {
  const query = new URLSearchParams({
    transportAttemptId,
    afterSignalId: '0',
    limit: '100',
  });
  const response = await requestJson<SignalsView>(
    `${baseUrl}/matchmaking/sessions/${sessionId}/signals?${query.toString()}`,
    {
      headers: {
        ...authorizationHeaders(accountId),
        'x-match-session-token': sessionToken,
      },
    },
  );
  if (response.status !== 200) {
    throw new Error(`Could not poll restart-smoke signals: status=${response.status}`);
  }
  return response.body;
}

async function disconnect(baseUrl: string, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl}/matchmaking/sessions/disconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
    },
    body: JSON.stringify({ sessionId }),
  });
  if (response.status !== 200) {
    throw new Error(`Could not disconnect restart-smoke participant: status=${response.status}`);
  }
  return response.body;
}

async function reconnect(
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
      ...authorizationHeaders(accountId),
    },
    body: JSON.stringify({ sessionId, sessionToken, reconnectAttemptId }),
  });
}

async function submitRankedResult(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  participantAccountIds: string[],
  winnerAccountId: string,
  proof: RankedMatchProof,
): Promise<{ status: number; body: unknown }> {
  return await requestJson(`${baseUrl}/ranked/results`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
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
    const response = await requestJson<{ sequence?: number }>(
      `${baseUrl}/ranked/sessions/${sessionId}/input-commitments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authorizationHeaders(accountId),
          'x-match-session-token': sessionToken,
        },
        body: JSON.stringify({ ...commitment, sessionToken }),
      },
    );
    if (response.status !== 200 || response.body.sequence !== commitment.sequence) {
      throw new Error(
        `Restart-smoke input commitment ${commitment.sequence} failed: status=${response.status}.`,
      );
    }
  }
  return commitments.length;
}

async function getRankedStatus(
  baseUrl: string,
  accountId: string,
  sessionId: string,
  sessionToken: string,
): Promise<{ status: number; body: RankedResultStatus }> {
  return await requestJson<RankedResultStatus>(`${baseUrl}/ranked/results/${sessionId}`, {
    headers: {
      ...authorizationHeaders(accountId),
      'x-match-session-token': sessionToken,
    },
  });
}

function participantConnection(session: SessionView, accountId: string): string | null {
  return session.participants.find((participant) => participant.accountId === accountId)
    ?.connectionStatus ?? null;
}

async function run(): Promise<void> {
  const port = parsePort(process.env.MATCHMAKING_RESTART_SMOKE_PORT);
  const baseUrl = `http://127.0.0.1:${port}`;
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the matchmaking restart smoke.');
  }
  assertLocalDatabaseTarget(
    databaseUrl,
    'Matchmaking restart smoke',
    process.env.ALLOW_REMOTE_DATABASE_SMOKE === '1',
  );
  const namespace = `smoke:restart-${process.pid}-${Date.now()}`;
  const cleanupPool = new Pool({ connectionString: databaseUrl });
  const accountIds: string[] = [];
  let activeServer: ManagedApi | null = null;
  let firstServerLogs = '';

  try {
    await cleanupPool.query(
      'DELETE FROM matchmaking_runtime_snapshots WHERE snapshot_key = $1',
      [namespace],
    );
    activeServer = await startApi(port, 1, namespace);
    const firstPid = activeServer.child.pid;
    await setDraining(baseUrl, false);

    const account1 = await createAccount(baseUrl);
    accountIds.push(account1);
    const account2 = await createAccount(baseUrl);
    accountIds.push(account2);
    const join1 = await joinRankedQueue(baseUrl, account1, 'vanguard');
    const join2 = await joinRankedQueue(baseUrl, account2, 'duelist');
    const ticket1 = join1.status === 'matched' ? join1 : await getTicket(baseUrl, account1, join1.ticketId);
    const ticket2 = join2.status === 'matched' ? join2 : await getTicket(baseUrl, account2, join2.ticketId);
    if (!ticket1.matchStart || !ticket2.matchStart) {
      throw new Error('Restart smoke did not create a matched ranked session.');
    }
    const sessionId = ticket1.matchStart.sessionId;
    if (ticket2.matchStart.sessionId !== sessionId) {
      throw new Error('Restart-smoke peers received different session ids.');
    }
    const rankedProof = createRankedProofFixture({
      sessionId,
      buildVersion: SMOKE_BUILD_VERSION,
      rulesetVersion: SMOKE_RULESET_VERSION,
      balanceProfileId: SMOKE_BALANCE_PROFILE_ID,
    });
    const matchedSession = await getSession(baseUrl, account1, sessionId);
    const account1Side = matchedSession.participants.find(({ accountId }) => accountId === account1)?.side;
    const account2Side = matchedSession.participants.find(({ accountId }) => accountId === account2)?.side;
    if (!account1Side || !account2Side) {
      throw new Error('Restart smoke did not expose both server-assigned player sides.');
    }
    const account1Commitments = await submitRankedInputCommitments(
      baseUrl,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
      account1Side,
      rankedProof,
    );
    const account2Commitments = await submitRankedInputCommitments(
      baseUrl,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      account2Side,
      rankedProof,
    );

    const signalId = await publishSignal(
      baseUrl,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
      ticket1.matchStart.transportAttempt.attemptId,
      `restart-offer-${Date.now()}`,
    );
    await disconnect(baseUrl, account2, sessionId);
    const reconnectAttemptBeforeRestart = `before-restart-${Date.now()}`;
    const firstReconnect = await reconnect(
      baseUrl,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      reconnectAttemptBeforeRestart,
    );
    if (firstReconnect.status !== 200) {
      throw new Error(`Pre-restart reconnect failed: status=${firstReconnect.status}`);
    }
    const disconnectedAgain = await disconnect(baseUrl, account2, sessionId);
    if (participantConnection(disconnectedAgain, account2) !== 'disconnected') {
      throw new Error('Participant was not disconnected before the checkpoint.');
    }

    const firstResult = await submitRankedResult(
      baseUrl,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
      [account1, account2],
      account1,
      rankedProof,
    );
    if (firstResult.status !== 202) {
      throw new Error(`Pre-restart ranked result did not await peer confirmation: status=${firstResult.status}`);
    }
    const checkpointBeforeRestart = await checkpointRuntime(baseUrl);
    if (
      Number(checkpointBeforeRestart.activeSessions ?? 0) < 1
      || Number(checkpointBeforeRestart.disconnectedParticipants ?? 0) < 1
    ) {
      throw new Error('Checkpoint did not contain the active disconnected session.');
    }

    firstServerLogs = activeServer.logs;
    await stopApi(activeServer);
    activeServer = null;

    activeServer = await startApi(port, 2, namespace);
    const secondPid = activeServer.child.pid;
    const restoredSession = await getSession(baseUrl, account1, sessionId);
    if (
      restoredSession.status !== 'active'
      || participantConnection(restoredSession, account2) !== 'disconnected'
    ) {
      throw new Error('Restarted API did not restore the active disconnected session.');
    }

    const restoredSignals = await pollSignals(
      baseUrl,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      ticket2.matchStart.transportAttempt.attemptId,
    );
    if (
      restoredSignals.signals.length !== 1
      || restoredSignals.signals[0]?.signalId !== signalId
      || restoredSignals.signals[0]?.senderAccountId !== account1
    ) {
      throw new Error('Restarted API did not expose the persisted peer signaling offer.');
    }

    const replayedReconnect = await reconnect(
      baseUrl,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      reconnectAttemptBeforeRestart,
    );
    if (replayedReconnect.status !== 409) {
      throw new Error(`Persisted reconnect replay was not rejected: status=${replayedReconnect.status}`);
    }
    const reconnectAttemptAfterRestart = `after-restart-${Date.now()}`;
    const restoredReconnect = await reconnect(
      baseUrl,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      reconnectAttemptAfterRestart,
    );
    if (restoredReconnect.status !== 200) {
      throw new Error(`Fresh reconnect after process replacement failed: status=${restoredReconnect.status}`);
    }

    const peerResult = await submitRankedResult(
      baseUrl,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      [account1, account2],
      account1,
      rankedProof,
    );
    if (peerResult.status !== 201) {
      throw new Error(`Post-restart ranked consensus did not settle: status=${peerResult.status}`);
    }
    const settledStatus = await getRankedStatus(
      baseUrl,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
    );
    if (settledStatus.status !== 200 || settledStatus.body.status !== 'accepted') {
      throw new Error(`Post-restart ranked result was not accepted: status=${settledStatus.status}`);
    }
    if (
      settledStatus.body.proof?.inputAttestation?.status !== 'match_verified'
      || settledStatus.body.proof.inputAttestation.evidence.schemaVersion !== 'gw.ranked-input-attestation.v1'
      || settledStatus.body.proof.inputAttestation.evidence.participants.length !== 2
    ) {
      throw new Error('Post-restart ranked result did not retain both input commitment chains.');
    }
    const checkpointAfterRestart = await checkpointRuntime(baseUrl);

    console.log(JSON.stringify({
      schemaVersion: 'gw.matchmaking-restart-smoke.v1',
      ok: true,
      baseUrl,
      runtimeNamespace: namespace,
      processReplacement: {
        firstPid,
        secondPid,
        distinctProcesses: firstPid !== secondPid,
      },
      sessionId,
      sessionRestored: true,
      disconnectedParticipantRestored: true,
      signalRestored: true,
      signalId,
      reconnectReplayStatus: replayedReconnect.status,
      freshReconnectStatus: restoredReconnect.status,
      preRestartResultStatus: firstResult.status,
      postRestartResultStatus: peerResult.status,
      settledStatus: settledStatus.body.status,
      inputCommitments: {
        account1: account1Commitments,
        account2: account2Commitments,
        survivedProcessReplacement: true,
      },
      checkpoints: {
        beforeRestart: checkpointBeforeRestart,
        afterRestart: checkpointAfterRestart,
      },
    }, null, 2));
  } catch (error) {
    const logs = [
      firstServerLogs && `--- API generation 1 ---\n${firstServerLogs}`,
      activeServer?.logs && `--- API generation ${activeServer.generation} ---\n${activeServer.logs}`,
    ].filter(Boolean).join('\n');
    throw new Error(`${error instanceof Error ? error.message : String(error)}${logs ? `\n${logs}` : ''}`);
  } finally {
    if (activeServer) {
      await stopApi(activeServer).catch(() => undefined);
    }
    await cleanupPool.query(
      'DELETE FROM matchmaking_runtime_snapshots WHERE snapshot_key = $1',
      [namespace],
    ).catch(() => undefined);
    if (accountIds.length > 0) {
      await cleanupPool.query(
        'DELETE FROM accounts WHERE id = ANY($1::uuid[])',
        [accountIds],
      ).catch(() => undefined);
    }
    await cleanupPool.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
