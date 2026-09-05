import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';
import type { MatchmakingQueueSnapshot } from '../src/matchmaking/queueService';
import { createMatchmakingSessionAccessStore } from '../src/matchmaking/sessionAccessStore';
import {
  createMatchmakingRuntimeStateStore,
  MatchmakingRuntimeLeaseFencedError,
} from '../src/matchmaking/runtimeStateStore';
import {
  matchmakingRuntimeLockKeyFromNamespace,
  MATCHMAKING_RUNTIME_COORDINATION_MODE,
} from '../src/matchmaking/runtimeCoordinator';
import {
  parseDatabaseApplicationName,
  summarizeDatabaseBackendReplacement,
  type DatabaseBackendReplacementSummary,
} from '../src/ops/databaseInterruption';

interface AccountRecord {
  id: string;
  accessToken: string;
}

interface MatchStart {
  sessionId: string;
  sessionToken: string;
  transportAttempt: {
    attemptId: string;
    generation: number;
  };
}

interface QueueTicket {
  ticketId: string;
  status: 'queued' | 'matched' | 'closed';
  matchStart?: MatchStart;
}

interface SessionView {
  sessionId: string;
  status: 'active' | 'resolved';
  resolvedReason?: string;
  forfeitingAccountId?: string;
  transportAttempt: {
    attemptId: string;
    generation: number;
  };
  participants: Array<{
    accountId: string;
    connectionStatus: 'connected' | 'disconnected';
    lastHeartbeatAt: string;
  }>;
}

interface SignalList {
  signals: Array<{
    signalId: string;
    senderAccountId: string;
  }>;
}

interface RuntimeView {
  draining?: boolean;
  activeSessions?: number;
  disconnectedParticipants?: number;
}

interface HealthView {
  ok?: boolean;
  databaseTarget?: string;
  matchmakingRuntimeCoordination?: string;
  matchmakingRuntimeNamespace?: string;
}

interface ManagedApi {
  label: string;
  port: number;
  databaseApplicationName: string;
  child: ChildProcessWithoutNullStreams;
  logs: string;
}

interface NamedBackendRow {
  pid: number;
  applicationName: string;
}

interface TerminatedNamedBackendRow extends NamedBackendRow {
  terminated: boolean;
}

interface DatabaseInterruptionEvidence {
  terminatedBackendCount: number;
  replacement: DatabaseBackendReplacementSummary;
  apiProcessesSurvived: boolean;
  activeSessionRecovered: boolean;
  heartbeatRecovered: boolean;
  signalingRecovered: boolean;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const AUTH_SECRET = 'local-multi-instance-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const ADMIN_KEY = 'local-multi-instance-admin-key-0123456789';
const BUILD_VERSION = 'prototype-2026.09';
const RULESET_VERSION = 'prototype-2026.09';
const BALANCE_PROFILE_ID = 'default';
const AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString('hex');
const accessTokenByAccountId = new Map<string, string>();

function parsePort(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error(`${label} must be an integer between 1024 and 65535.`);
  }
  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function baseUrl(server: ManagedApi): string {
  return `http://127.0.0.1:${server.port}`;
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
    // Keep text responses for diagnostics.
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

async function waitForHealth(server: ManagedApi, namespace: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() <= deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.label} exited during startup.\n${server.logs}`);
    }
    try {
      const response = await requestJson<HealthView>(`${baseUrl(server)}/health`);
      if (response.status === 200 && response.body.ok) {
        if (response.body.matchmakingRuntimeCoordination !== MATCHMAKING_RUNTIME_COORDINATION_MODE) {
          throw new Error(`${server.label} did not report coordinated matchmaking runtime.`);
        }
        if (response.body.matchmakingRuntimeNamespace !== namespace) {
          throw new Error(`${server.label} loaded the wrong matchmaking runtime namespace.`);
        }
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('did not report')) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('wrong matchmaking')) {
        throw error;
      }
    }
    await sleep(100);
  }
  throw new Error(`${server.label} did not become healthy.\n${server.logs}`);
}

async function startApi(
  port: number,
  label: string,
  namespace: string,
  databaseUrl: string,
  databaseApplicationName: string,
): Promise<ManagedApi> {
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
        MATCHMAKING_RECONNECT_GRACE_SECONDS: '60',
        MATCHMAKING_SNAPSHOT_INTERVAL_MS: '250',
        MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS: '10000',
        MATCHMAKING_RUNTIME_NAMESPACE: namespace,
        PGAPPNAME: databaseApplicationName,
        SLO_ADMIN_KEY: ADMIN_KEY,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const server: ManagedApi = { label, port, databaseApplicationName, child, logs: '' };
  child.stdout.on('data', (chunk: Buffer) => appendLogs(server, chunk));
  child.stderr.on('data', (chunk: Buffer) => appendLogs(server, chunk));
  await waitForHealth(server, namespace);
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

async function createAccount(server: ManagedApi): Promise<string> {
  const response = await requestJson<AccountRecord>(`${baseUrl(server)}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status !== 201 || !response.body.id || !response.body.accessToken) {
    throw new Error(`${server.label} could not create an account: status=${response.status}`);
  }
  accessTokenByAccountId.set(response.body.id, response.body.accessToken);
  return response.body.id;
}

async function joinQueue(
  server: ManagedApi,
  accountId: string,
  characterId: 'vanguard' | 'duelist',
): Promise<QueueTicket> {
  const response = await requestJson<QueueTicket>(`${baseUrl(server)}/matchmaking/queue/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
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
    throw new Error(`${server.label} could not join queue for ${accountId}: status=${response.status}`);
  }
  return response.body;
}

async function getTicket(server: ManagedApi, accountId: string, ticketId: string): Promise<QueueTicket> {
  const response = await requestJson<QueueTicket>(
    `${baseUrl(server)}/matchmaking/queue/tickets/${ticketId}`,
    { headers: authorizationHeaders(accountId) },
  );
  if (response.status !== 200) {
    throw new Error(`${server.label} could not read ticket ${ticketId}: status=${response.status}`);
  }
  return response.body;
}

async function getSession(server: ManagedApi, accountId: string, sessionId: string): Promise<SessionView> {
  const response = await requestJson<SessionView>(
    `${baseUrl(server)}/matchmaking/sessions/${sessionId}`,
    { headers: authorizationHeaders(accountId) },
  );
  if (response.status !== 200) {
    throw new Error(`${server.label} could not read session ${sessionId}: status=${response.status}`);
  }
  return response.body;
}

async function heartbeat(
  server: ManagedApi,
  accountId: string,
  sessionId: string,
  sessionToken: string,
): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl(server)}/matchmaking/sessions/heartbeat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
    },
    body: JSON.stringify({ sessionId, sessionToken }),
  });
  if (response.status !== 200) {
    throw new Error(`${server.label} could not heartbeat ${accountId}: status=${response.status}`);
  }
  return response.body;
}

async function publishSignal(
  server: ManagedApi,
  accountId: string,
  sessionId: string,
  matchStart: MatchStart,
): Promise<string> {
  const response = await requestJson<{ signalId?: string }>(
    `${baseUrl(server)}/matchmaking/sessions/${sessionId}/signals`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authorizationHeaders(accountId),
      },
      body: JSON.stringify({
        sessionToken: matchStart.sessionToken,
        transportAttemptId: matchStart.transportAttempt.attemptId,
        clientMessageId: `multi-instance-offer-${Date.now()}`,
        signalType: 'offer',
        payload: {
          connectionId: 'multi-instance-smoke',
          description: { type: 'offer', sdp: 'multi-instance-smoke-sdp' },
        },
      }),
    },
  );
  if (response.status !== 200 || !response.body.signalId) {
    throw new Error(`${server.label} could not publish signaling offer: status=${response.status}`);
  }
  return response.body.signalId;
}

async function pollSignals(
  server: ManagedApi,
  accountId: string,
  sessionId: string,
  matchStart: MatchStart,
): Promise<SignalList> {
  const query = new URLSearchParams({
    transportAttemptId: matchStart.transportAttempt.attemptId,
    afterSignalId: '0',
    limit: '100',
  });
  const response = await requestJson<SignalList>(
    `${baseUrl(server)}/matchmaking/sessions/${sessionId}/signals?${query.toString()}`,
    {
      headers: {
        ...authorizationHeaders(accountId),
        'x-match-session-token': matchStart.sessionToken,
      },
    },
  );
  if (response.status !== 200) {
    throw new Error(`${server.label} could not poll signaling offer: status=${response.status}`);
  }
  return response.body;
}

async function forceExpiredReconnectDeadline(
  pool: Pool,
  namespace: string,
  sessionId: string,
  accountId: string,
): Promise<void> {
  const client = await pool.connect();
  const lockKey = matchmakingRuntimeLockKeyFromNamespace(namespace);
  let transactionStarted = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await client.query<{ state_json: MatchmakingQueueSnapshot }>(
      `
        SELECT state_json
        FROM matchmaking_runtime_snapshots
        WHERE snapshot_key = $1
        LIMIT 1
      `,
      [namespace],
    );
    const snapshot = result.rows[0]?.state_json;
    const session = snapshot?.sessions.find((candidate) => candidate.sessionId === sessionId);
    const participantState = session?.participants.find(
      (candidate) => candidate.accountId === accountId,
    );
    if (!snapshot || !session || !participantState) {
      throw new Error('Could not prepare the persisted reconnect-timeout fixture.');
    }
    const expiredAtMs = Date.now() - 1_000;
    participantState.connectionStatus = 'disconnected';
    participantState.disconnectedAtMs = expiredAtMs - 1_000;
    participantState.reconnectDeadlineAtMs = expiredAtMs;
    snapshot.capturedAtMs = Date.now();
    await client.query(
      `
        UPDATE matchmaking_runtime_snapshots
        SET state_json = $2::jsonb, updated_at = NOW()
        WHERE snapshot_key = $1
      `,
      [namespace, JSON.stringify(snapshot)],
    );
    const accessStore = createMatchmakingSessionAccessStore(client, { snapshotKey: namespace });
    await accessStore.replaceFromSnapshot(snapshot, client);
    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]).catch(() => undefined);
    client.release();
  }
}

async function assertStaleSnapshotWriterFenced(
  pool: Pool,
  namespace: string,
): Promise<void> {
  const before = await pool.query<{
    fence_token: string;
    state_json: MatchmakingQueueSnapshot;
  }>(
    `
      SELECT fence.fence_token::text, snapshot.state_json
      FROM matchmaking_runtime_fences AS fence
      JOIN matchmaking_runtime_snapshots AS snapshot
        ON snapshot.snapshot_key = fence.snapshot_key
      WHERE fence.snapshot_key = $1
      LIMIT 1
    `,
    [namespace],
  );
  const currentFenceToken = BigInt(before.rows[0]?.fence_token ?? '0');
  const currentSnapshot = before.rows[0]?.state_json;
  if (!currentSnapshot || currentFenceToken <= 1n) {
    throw new Error('Could not prepare a superseded matchmaking writer token.');
  }
  const staleSnapshot = structuredClone(currentSnapshot);
  staleSnapshot.capturedAtMs += 1;
  const store = createMatchmakingRuntimeStateStore(pool, { snapshotKey: namespace });

  await assertRejectsFencedWrite(
    store.save(staleSnapshot, String(currentFenceToken - 1n)),
  );

  const after = await pool.query<{ state_json: MatchmakingQueueSnapshot }>(
    `
      SELECT state_json
      FROM matchmaking_runtime_snapshots
      WHERE snapshot_key = $1
      LIMIT 1
    `,
    [namespace],
  );
  if (after.rows[0]?.state_json.capturedAtMs !== currentSnapshot.capturedAtMs) {
    throw new Error('A superseded writer changed the persisted matchmaking snapshot.');
  }
}

async function assertRejectsFencedWrite(write: Promise<void>): Promise<void> {
  try {
    await write;
  } catch (error) {
    if (error instanceof MatchmakingRuntimeLeaseFencedError) {
      return;
    }
    throw error;
  }
  throw new Error('A superseded matchmaking writer token was accepted.');
}

async function advanceTransport(
  server: ManagedApi,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  expectedGeneration: number,
): Promise<{ status: number; body: SessionView }> {
  return await requestJson(`${baseUrl(server)}/matchmaking/sessions/${sessionId}/transport-attempts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
    },
    body: JSON.stringify({ sessionToken, expectedGeneration }),
  });
}

async function disconnect(
  server: ManagedApi,
  accountId: string,
  sessionId: string,
): Promise<SessionView> {
  const response = await requestJson<SessionView>(`${baseUrl(server)}/matchmaking/sessions/disconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
    },
    body: JSON.stringify({ sessionId }),
  });
  if (response.status !== 200) {
    throw new Error(`${server.label} could not disconnect ${accountId}: status=${response.status}`);
  }
  return response.body;
}

async function reconnect(
  server: ManagedApi,
  accountId: string,
  sessionId: string,
  sessionToken: string,
  reconnectAttemptId: string,
): Promise<{ status: number; body: unknown }> {
  return await requestJson(`${baseUrl(server)}/matchmaking/sessions/reconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authorizationHeaders(accountId),
    },
    body: JSON.stringify({ sessionId, sessionToken, reconnectAttemptId }),
  });
}

async function setDraining(server: ManagedApi, draining: boolean): Promise<RuntimeView> {
  const response = await requestJson<RuntimeView>(`${baseUrl(server)}/ops/matchmaking/drain`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
    },
    body: JSON.stringify({ draining }),
  });
  if (response.status !== 200 || response.body.draining !== draining) {
    throw new Error(`${server.label} could not set drain=${draining}: status=${response.status}`);
  }
  return response.body;
}

async function getRuntime(server: ManagedApi): Promise<RuntimeView> {
  const response = await requestJson<RuntimeView>(`${baseUrl(server)}/ops/matchmaking/runtime`, {
    headers: { 'x-admin-key': ADMIN_KEY },
  });
  if (response.status !== 200) {
    throw new Error(`${server.label} could not read runtime: status=${response.status}`);
  }
  return response.body;
}

function participant(session: SessionView, accountId: string): SessionView['participants'][number] {
  const value = session.participants.find((candidate) => candidate.accountId === accountId);
  if (!value) {
    throw new Error(`Session ${session.sessionId} is missing participant ${accountId}.`);
  }
  return value;
}

async function waitForReadiness(server: ManagedApi): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() <= deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.label} exited during database recovery.\n${server.logs}`);
    }
    try {
      const response = await requestJson<HealthView>(`${baseUrl(server)}/readyz`);
      if (response.status === 200 && response.body.ok === true) {
        return;
      }
    } catch {
      // The API can briefly reject readiness while the pool removes failed clients.
    }
    await sleep(100);
  }
  throw new Error(`${server.label} did not regain database readiness.\n${server.logs}`);
}

async function readNamedBackends(
  pool: Pool,
  applicationNames: string[],
): Promise<NamedBackendRow[]> {
  const result = await pool.query<NamedBackendRow>(
    `
      SELECT pid::int AS pid, application_name AS "applicationName"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ANY($1::text[])
        AND backend_type = 'client backend'
        AND pid <> pg_backend_pid()
      ORDER BY application_name, pid
    `,
    [applicationNames],
  );
  return result.rows.map((row) => ({
    pid: Number(row.pid),
    applicationName: String(row.applicationName),
  }));
}

async function interruptDatabaseBackends(
  pool: Pool,
  servers: ManagedApi[],
): Promise<DatabaseInterruptionEvidence> {
  const applicationNames = servers.map(({ databaseApplicationName }) => databaseApplicationName);
  await sleep(150);
  const previous = await readNamedBackends(pool, applicationNames);
  for (const applicationName of applicationNames) {
    if (!previous.some((row) => row.applicationName === applicationName)) {
      throw new Error(`No PostgreSQL backend was found for ${applicationName}.`);
    }
  }

  const terminatedResult = await pool.query<TerminatedNamedBackendRow>(
    `
      SELECT
        pid::int AS pid,
        application_name AS "applicationName",
        pg_terminate_backend(pid) AS terminated
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ANY($1::text[])
        AND backend_type = 'client backend'
        AND pid <> pg_backend_pid()
      ORDER BY application_name, pid
    `,
    [applicationNames],
  );
  const terminated = terminatedResult.rows.map((row) => ({
    pid: Number(row.pid),
    applicationName: String(row.applicationName),
    terminated: row.terminated === true,
  }));
  if (
    terminated.length !== previous.length
    || terminated.some(({ terminated: didTerminate }) => !didTerminate)
  ) {
    throw new Error('PostgreSQL did not terminate every multi-instance API backend.');
  }

  await Promise.all(servers.map((server) => waitForReadiness(server)));
  if (servers.some(({ child }) => child.exitCode !== null)) {
    throw new Error('An API process exited during database backend recovery.');
  }
  const recovered = await readNamedBackends(pool, applicationNames);
  for (const applicationName of applicationNames) {
    if (!recovered.some((row) => row.applicationName === applicationName)) {
      throw new Error(`${applicationName} did not establish a replacement PostgreSQL backend.`);
    }
  }
  const replacement = summarizeDatabaseBackendReplacement(
    previous.map(({ pid }) => pid),
    recovered.map(({ pid }) => pid),
  );
  if (!replacement.replaced) {
    throw new Error(`Multi-instance PostgreSQL backends were not replaced: ${JSON.stringify(replacement)}.`);
  }

  return {
    terminatedBackendCount: terminated.length,
    replacement,
    apiProcessesSurvived: true,
    activeSessionRecovered: false,
    heartbeatRecovered: false,
    signalingRecovered: false,
  };
}

async function run(): Promise<void> {
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the matchmaking multi-instance smoke.');
  }
  assertLocalDatabaseTarget(
    databaseUrl,
    'Matchmaking multi-instance smoke',
    process.env.ALLOW_REMOTE_DATABASE_SMOKE === '1',
  );
  const portA = parsePort(
    process.env.MATCHMAKING_MULTI_INSTANCE_SMOKE_PORT_A,
    8792,
    'MATCHMAKING_MULTI_INSTANCE_SMOKE_PORT_A',
  );
  const portB = parsePort(
    process.env.MATCHMAKING_MULTI_INSTANCE_SMOKE_PORT_B,
    8793,
    'MATCHMAKING_MULTI_INSTANCE_SMOKE_PORT_B',
  );
  if (portA === portB) {
    throw new Error('Multi-instance smoke ports must be different.');
  }
  const namespace = `smoke:multi-${process.pid}-${Date.now()}`;
  const databaseApplicationNameA = parseDatabaseApplicationName(`gravity-well-multi-a-${process.pid}`);
  const databaseApplicationNameB = parseDatabaseApplicationName(`gravity-well-multi-b-${process.pid}`);
  const cleanupPool = new Pool({
    connectionString: databaseUrl,
    application_name: parseDatabaseApplicationName(`gravity-well-multi-controller-${process.pid}`),
  });
  const accountIds: string[] = [];
  let serverA: ManagedApi | null = null;
  let serverB: ManagedApi | null = null;

  try {
    await cleanupPool.query(
      'DELETE FROM matchmaking_runtime_snapshots WHERE snapshot_key = $1',
      [namespace],
    );
    await cleanupPool.query(
      'DELETE FROM matchmaking_runtime_fences WHERE snapshot_key = $1',
      [namespace],
    );
    serverA = await startApi(
      portA,
      'API-A',
      namespace,
      databaseUrl,
      databaseApplicationNameA,
    );
    serverB = await startApi(
      portB,
      'API-B',
      namespace,
      databaseUrl,
      databaseApplicationNameB,
    );

    const account1 = await createAccount(serverA);
    const account2 = await createAccount(serverB);
    accountIds.push(account1, account2);

    const join1 = await joinQueue(serverA, account1, 'vanguard');
    if (join1.status !== 'queued') {
      throw new Error(`First cross-instance join should be queued, received ${join1.status}.`);
    }
    const join2 = await joinQueue(serverB, account2, 'duelist');
    const ticket1 = await getTicket(serverB, account1, join1.ticketId);
    const ticket2 = join2.status === 'matched'
      ? join2
      : await getTicket(serverA, account2, join2.ticketId);
    if (ticket1.status !== 'matched' || ticket2.status !== 'matched') {
      throw new Error('Queue joins sent to different API instances did not match.');
    }
    if (!ticket1.matchStart || !ticket2.matchStart) {
      throw new Error('Cross-instance match did not include both player session credentials.');
    }
    const sessionId = ticket1.matchStart.sessionId;
    if (ticket2.matchStart.sessionId !== sessionId) {
      throw new Error('Cross-instance peers received different session ids.');
    }

    const sessionFromB = await getSession(serverB, account1, sessionId);
    const sessionFromA = await getSession(serverA, account2, sessionId);
    if (sessionFromA.status !== 'active' || sessionFromB.status !== 'active') {
      throw new Error('Both API instances did not observe the active session.');
    }

    await sleep(20);
    const heartbeatOnA = await heartbeat(
      serverA,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
    );
    const heartbeatReadOnB = await getSession(serverB, account1, sessionId);
    const heartbeatAt = participant(heartbeatOnA, account1).lastHeartbeatAt;
    if (participant(heartbeatReadOnB, account1).lastHeartbeatAt !== heartbeatAt) {
      throw new Error('Heartbeat timestamp was not durable across API instances.');
    }

    const signalId = await publishSignal(serverA, account1, sessionId, ticket1.matchStart);
    const signals = await pollSignals(serverB, account2, sessionId, ticket2.matchStart);
    if (
      signals.signals.length !== 1
      || signals.signals[0]?.signalId !== signalId
      || signals.signals[0]?.senderAccountId !== account1
    ) {
      throw new Error('Durable signaling did not cross API instances.');
    }

    const databaseInterruption = await interruptDatabaseBackends(cleanupPool, [serverA, serverB]);
    const recoveredSessionFromA = await getSession(serverA, account2, sessionId);
    const recoveredSessionFromB = await getSession(serverB, account1, sessionId);
    if (
      recoveredSessionFromA.status !== 'active'
      || recoveredSessionFromB.status !== 'active'
      || recoveredSessionFromA.transportAttempt.generation !== 1
      || recoveredSessionFromB.transportAttempt.generation !== 1
    ) {
      throw new Error('Active session state did not recover after PostgreSQL backend replacement.');
    }
    databaseInterruption.activeSessionRecovered = true;

    await sleep(20);
    const heartbeatAfterRecovery = await heartbeat(
      serverB,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
    );
    const heartbeatAfterRecoveryRead = await getSession(serverA, account1, sessionId);
    if (
      participant(heartbeatAfterRecoveryRead, account2).lastHeartbeatAt
      !== participant(heartbeatAfterRecovery, account2).lastHeartbeatAt
    ) {
      throw new Error('Heartbeat did not persist across instances after database recovery.');
    }
    databaseInterruption.heartbeatRecovered = true;

    const recoveredSignalId = await publishSignal(
      serverB,
      account2,
      sessionId,
      ticket2.matchStart,
    );
    const recoveredSignals = await pollSignals(serverA, account1, sessionId, ticket1.matchStart);
    if (!recoveredSignals.signals.some((candidate) => (
      candidate.signalId === recoveredSignalId && candidate.senderAccountId === account2
    ))) {
      throw new Error('Durable signaling did not recover after PostgreSQL backend replacement.');
    }
    databaseInterruption.signalingRecovered = true;

    const advanced = await advanceTransport(
      serverA,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
      ticket1.matchStart.transportAttempt.generation,
    );
    if (advanced.status !== 200 || advanced.body.transportAttempt.generation !== 2) {
      throw new Error(`Transport attempt did not advance on API-A: status=${advanced.status}`);
    }
    const repeatedAdvance = await advanceTransport(
      serverB,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
      ticket1.matchStart.transportAttempt.generation,
    );
    if (
      repeatedAdvance.status !== 200
      || repeatedAdvance.body.transportAttempt.generation !== 2
      || repeatedAdvance.body.transportAttempt.attemptId !== advanced.body.transportAttempt.attemptId
    ) {
      throw new Error(`Repeated transport advance was not idempotent on API-B: status=${repeatedAdvance.status}`);
    }
    const aheadAdvance = await advanceTransport(
      serverB,
      account1,
      sessionId,
      ticket1.matchStart.sessionToken,
      3,
    );
    if (aheadAdvance.status !== 409) {
      throw new Error(`Ahead transport generation was not rejected on API-B: status=${aheadAdvance.status}`);
    }

    await disconnect(serverB, account2, sessionId);
    const disconnectedOnA = await getSession(serverA, account1, sessionId);
    if (participant(disconnectedOnA, account2).connectionStatus !== 'disconnected') {
      throw new Error('Disconnect state was not visible on the peer API instance.');
    }
    const reconnectAttemptId = `multi-instance-reconnect-${Date.now()}`;
    const reconnected = await reconnect(
      serverA,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      reconnectAttemptId,
    );
    if (reconnected.status !== 200) {
      throw new Error(`Reconnect through API-A failed: status=${reconnected.status}`);
    }
    const replayedReconnect = await reconnect(
      serverB,
      account2,
      sessionId,
      ticket2.matchStart.sessionToken,
      reconnectAttemptId,
    );
    if (replayedReconnect.status !== 409) {
      throw new Error(`Reconnect replay was not rejected on API-B: status=${replayedReconnect.status}`);
    }

    await setDraining(serverA, true);
    const drainedOnB = await getRuntime(serverB);
    if (drainedOnB.draining !== true || Number(drainedOnB.activeSessions ?? 0) !== 1) {
      throw new Error('Drain state or active session count was not shared with API-B.');
    }
    await setDraining(serverB, false);
    const resumedOnA = await getRuntime(serverA);
    if (resumedOnA.draining !== false) {
      throw new Error('Resume state was not shared with API-A.');
    }

    await heartbeat(serverB, account1, sessionId, ticket1.matchStart.sessionToken);
    await forceExpiredReconnectDeadline(cleanupPool, namespace, sessionId, account2);
    const timeoutTrigger = await requestJson<{ code?: string }>(
      `${baseUrl(serverA)}/matchmaking/sessions/${sessionId}/signals?${new URLSearchParams({
        transportAttemptId: advanced.body.transportAttempt.attemptId,
        afterSignalId: '0',
        limit: '1',
      }).toString()}`,
      {
        headers: {
          ...authorizationHeaders(account1),
          'x-match-session-token': ticket1.matchStart.sessionToken,
        },
      },
    );
    if (timeoutTrigger.status !== 409 || timeoutTrigger.body.code !== 'session_resolved') {
      throw new Error(`Signaling read did not fail closed at the expired reconnect deadline: status=${timeoutTrigger.status}.`);
    }
    const timeoutReadOnB = await getSession(serverB, account1, sessionId);
    if (
      timeoutReadOnB.status !== 'resolved'
      || timeoutReadOnB.resolvedReason !== 'reconnect_timeout'
      || timeoutReadOnB.forfeitingAccountId !== account2
    ) {
      throw new Error('Control-plane reconnect timeout was not durable across API instances.');
    }

    const firstPid = serverA.child.pid;
    const secondPid = serverB.child.pid;
    await stopApi(serverA);
    serverA = null;

    const survivorSession = await getSession(serverB, account1, sessionId);
    if (
      survivorSession.status !== 'resolved'
      || survivorSession.resolvedReason !== 'reconnect_timeout'
      || survivorSession.transportAttempt.generation !== 2
      || survivorSession.forfeitingAccountId !== account2
    ) {
      throw new Error('Surviving API lost state when the peer instance shut down.');
    }
    await assertStaleSnapshotWriterFenced(cleanupPool, namespace);

    console.log(JSON.stringify({
      schemaVersion: 'gw.matchmaking-multi-instance-smoke.v2',
      ok: true,
      namespace,
      instances: [
        { label: 'API-A', port: portA, pid: firstPid },
        { label: 'API-B', port: portB, pid: secondPid },
      ],
      sessionId,
      crossInstanceMatch: true,
      heartbeatDurable: true,
      signalingDurable: true,
      databaseInterruption,
      transportGeneration: survivorSession.transportAttempt.generation,
      repeatedTransportStatus: repeatedAdvance.status,
      aheadTransportStatus: aheadAdvance.status,
      reconnectReplayStatus: replayedReconnect.status,
      drainShared: true,
      readTriggeredReconnectTimeoutDurable: true,
      survivorRetainedState: true,
      staleSnapshotWriterFenced: true,
    }, null, 2));
  } catch (error) {
    const logs = [serverA, serverB]
      .filter((server): server is ManagedApi => Boolean(server?.logs))
      .map((server) => `--- ${server.label} ---\n${server.logs}`)
      .join('\n');
    throw new Error(`${error instanceof Error ? error.message : String(error)}${logs ? `\n${logs}` : ''}`);
  } finally {
    if (serverA) {
      await stopApi(serverA).catch(() => undefined);
    }
    if (serverB) {
      await stopApi(serverB).catch(() => undefined);
    }
    await cleanupPool.query(
      'DELETE FROM matchmaking_runtime_snapshots WHERE snapshot_key = $1',
      [namespace],
    ).catch(() => undefined);
    await cleanupPool.query(
      'DELETE FROM matchmaking_runtime_fences WHERE snapshot_key = $1',
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
