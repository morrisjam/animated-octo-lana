import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { classifyDatabaseTarget } from '../src/databaseTarget';
import { assertSafeSmokeTarget, validateSmokeTargetUrl } from './smokeTargetGuard';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, '../../..');
const apiWorkspaceRoot = path.resolve(repositoryRoot, 'apps/api');
const apiArtifactRoot = path.resolve(apiWorkspaceRoot, 'build-artifacts');
const defaultArtifactDir = path.resolve(
  apiArtifactRoot,
  'controlled-alpha-access-smoke',
);
const REPORT_SCHEMA_VERSION = 'gw.controlled-alpha-access-smoke.v1';
const MAX_CAPTURED_LOG_BYTES = 256_000;
const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well';
const TURN_CREDENTIAL_TTL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 5_000;

interface ManagedApi {
  label: string;
  child: ChildProcessByStdio<null, Readable, Readable>;
  stdout: string;
  stderr: string;
}

interface StepResult {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

interface JsonResponse<T> {
  status: number;
  body: T;
}

interface SignedAccount {
  id: string;
  accessToken: string;
}

interface QueueTicket {
  ticketId?: string;
  status?: string;
  matchStart?: {
    sessionId?: string;
    sessionToken?: string;
  };
}

interface IceConfig {
  iceServers?: Array<{
    urls?: string[];
    username?: string;
    credential?: string;
  }>;
  iceTransportPolicy?: string;
  fallbackPolicy?: string;
  relayAvailable?: boolean;
  turnCredentialMode?: string;
  turnCredentialExpiresAt?: string;
}

interface SmokeProofs {
  signedSessionsRequired: boolean;
  accessStatusPrivate: boolean;
  networkStatusPrivate: boolean;
  outsiderDenialCode: string | null;
  missingBuildDenialCode: string | null;
  staleBuildDenialCode: string | null;
  approvedAdmissions: number;
  roomCreateEnforced: boolean;
  roomJoinEnforced: boolean;
  turnCredentialMode: string | null;
  turnCredentialTtlSeconds: number | null;
  turnCredentialsParticipantBound: boolean;
}

interface CleanupState {
  apiStopped: boolean;
  databaseRowsRemoved: boolean;
  postgresStoppedIfStarted: boolean;
}

function appendCapturedLog(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length <= MAX_CAPTURED_LOG_BYTES
    ? next
    : next.slice(next.length - MAX_CAPTURED_LOG_BYTES);
}

function tail(value: string, length = 8_000): string {
  return value.length <= length ? value : value.slice(value.length - length);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendFailure(current: string | null, next: unknown, prefix?: string): string {
  const message = `${prefix ? `${prefix}: ` : ''}${errorMessage(next)}`;
  return current ? `${current}\n${message}` : message;
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '28789');
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error(
      'CONTROLLED_ALPHA_ACCESS_SMOKE_PORT must be an integer between 1024 and 65535.',
    );
  }
  return parsed;
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 127;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || normalized === '[::1]'
    || isLoopbackIpv4(normalized);
}

function assertStrictLocalDatabaseUrl(databaseUrl: string): void {
  if (classifyDatabaseTarget(databaseUrl) !== 'local') {
    throw new Error('Controlled-alpha access smoke requires a local PostgreSQL target.');
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Controlled-alpha access smoke DATABASE_URL must be an absolute URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Controlled-alpha access smoke requires a PostgreSQL URL.');
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error('Controlled-alpha access smoke requires an exact loopback database hostname.');
  }
  for (const overrideName of ['host', 'hostaddr']) {
    if (parsed.searchParams.has(overrideName)) {
      throw new Error(
        `Controlled-alpha access smoke refuses the database ${overrideName} query override.`,
      );
    }
  }
}

function assertLocalReportPath(reportPath: string): void {
  const relative = path.relative(apiArtifactRoot, reportPath);
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(
      'Controlled-alpha access smoke report must stay inside apps/api/build-artifacts.',
    );
  }
}

function redactSensitive(value: string | undefined, sensitiveValues: Set<string>): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let redacted = value;
  for (const sensitiveValue of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (sensitiveValue.length >= 8) {
      redacted = redacted.replaceAll(sensitiveValue, '[redacted]');
    }
  }
  return redacted;
}

async function recordStep<T>(
  steps: StepResult[],
  name: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  console.log(`[controlled-alpha-access] ${name}`);
  try {
    const result = await action();
    steps.push({ name, status: 'passed', durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const message = errorMessage(error);
    steps.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: message });
    throw error;
  }
}

function runCommand(
  label: string,
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    echo?: boolean;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceTimeout: NodeJS.Timeout | null = null;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceTimeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 5_000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCapturedLog(stdout, chunk);
      if (options.echo !== false) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCapturedLog(stderr, chunk);
      if (options.echo !== false) {
        process.stderr.write(chunk);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (forceTimeout) {
        clearTimeout(forceTimeout);
      }
      reject(new Error(`${label} could not start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (forceTimeout) {
        clearTimeout(forceTimeout);
      }
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = timedOut
        ? `timed out after ${timeoutMs}ms`
        : `exited with code ${String(code)}${signal ? ` (${signal})` : ''}`;
      reject(new Error([
        `${label} ${reason}.`,
        tail(stderr || stdout),
      ].filter(Boolean).join('\n')));
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

async function canConnectDatabase(databaseUrl: string): Promise<boolean> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 1_000,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function waitForDatabase(databaseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectDatabase(databaseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local PostgreSQL did not become ready within ${timeoutMs}ms.`);
}

async function ensureLocalDatabase(
  databaseUrl: string,
  markStarted: () => void,
): Promise<void> {
  if (await canConnectDatabase(databaseUrl)) {
    return;
  }
  if (
    process.env.CONTROLLED_ALPHA_ACCESS_MANAGE_POSTGRES === '0'
    || process.env.LOCAL_ALPHA_MANAGE_POSTGRES === '0'
  ) {
    throw new Error(
      'Local PostgreSQL is unavailable and automatic local PostgreSQL startup is disabled.',
    );
  }

  let postgresWasRunning = false;
  try {
    const state = await runCommand(
      'Docker Compose state check',
      'docker',
      ['compose', 'ps', '--status', 'running', '--services'],
      { echo: false, timeoutMs: 15_000 },
    );
    postgresWasRunning = state.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .includes('postgres');
  } catch {
    postgresWasRunning = false;
  }

  await runCommand(
    'Local PostgreSQL image check',
    'docker',
    ['image', 'inspect', 'postgres:16-alpine'],
    { echo: false, timeoutMs: 15_000 },
  );
  await runCommand(
    'Local PostgreSQL startup',
    'docker',
    ['compose', 'up', '-d', '--pull', 'never', 'postgres'],
    { echo: false, timeoutMs: 60_000 },
  );
  if (!postgresWasRunning) {
    markStarted();
  }
  await waitForDatabase(databaseUrl);
}

function spawnApi(label: string, env: NodeJS.ProcessEnv): ManagedApi {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/server.ts'],
    {
      cwd: repositoryRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const managed: ManagedApi = { label, child, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk: Buffer) => {
    managed.stdout = appendCapturedLog(managed.stdout, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    managed.stderr = appendCapturedLog(managed.stderr, chunk);
  });
  return managed;
}

async function stopApi(managed: ManagedApi | null): Promise<void> {
  if (!managed || managed.child.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    managed.child.once('exit', () => resolve());
  });
  managed.child.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!graceful && managed.child.exitCode === null) {
    managed.child.kill('SIGKILL');
    const forced = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);
    if (!forced && managed.child.exitCode === null) {
      throw new Error(`${managed.label} did not exit after forced termination.`);
    }
  }
}

async function waitForApi(managed: ManagedApi, baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (managed.child.exitCode !== null) {
      throw new Error([
        `${managed.label} exited before becoming ready.`,
        tail(managed.stderr || managed.stdout),
      ].join('\n'));
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        redirect: 'error',
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // The child may still be binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${managed.label} did not become healthy within ${timeoutMs}ms.`);
}

async function requestJson<T>(
  baseUrl: string,
  route: string,
  init: RequestInit = {},
): Promise<JsonResponse<T>> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...init.headers,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve text for a bounded, redacted error summary.
  }
  return { status: response.status, body: body as T };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function responseSummary(body: unknown): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    return JSON.stringify({
      ...(typeof record.error === 'string' ? { error: record.error } : {}),
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
    });
  }
  return typeof body === 'string' ? body.slice(0, 200) : typeof body;
}

function expectStatus<T>(label: string, response: JsonResponse<T>, expectedStatus: number): T {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expectedStatus}. ${responseSummary(response.body)}`,
    );
  }
  return response.body;
}

function expectDenialCode(
  label: string,
  response: JsonResponse<unknown>,
  expectedCode: string,
  expectedStatus = 403,
): void {
  expectStatus(label, response, expectedStatus);
  const body = asRecord(response.body, label);
  if (body.code !== expectedCode) {
    throw new Error(`${label} returned denial code ${String(body.code)}; expected ${expectedCode}.`);
  }
}

function expectExactKeys(label: string, value: unknown, expectedKeys: string[]): Record<string, unknown> {
  const record = asRecord(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(
      `${label} exposed unexpected fields: actual=${actual.join(',')}; expected=${expected.join(',')}.`,
    );
  }
  return record;
}

function bearerHeaders(account: SignedAccount): Record<string, string> {
  return { authorization: `Bearer ${account.accessToken}` };
}

async function verifyReportedLocalTarget(
  baseUrl: string,
  targetEnv: NodeJS.ProcessEnv,
): Promise<void> {
  await assertSafeSmokeTarget(baseUrl, 'Controlled-alpha access smoke', { env: targetEnv });
  const [health, readiness] = await Promise.all([
    requestJson<Record<string, unknown>>(baseUrl, '/health'),
    requestJson<Record<string, unknown>>(baseUrl, '/readyz'),
  ]);
  expectStatus('Health target identity', health, 200);
  expectStatus('Readiness target identity', readiness, 200);
  if (health.body.databaseTarget !== 'local' || readiness.body.databaseTarget !== 'local') {
    throw new Error('API did not report a local database target on both health endpoints.');
  }
  if (
    readiness.body.databaseId !== targetEnv.SMOKE_EXPECT_DATABASE_ID
    || readiness.body.deploymentEnvironment !== targetEnv.SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT
  ) {
    throw new Error('API readiness identity did not match the independently configured local target.');
  }
}

async function createSignedAccount(baseUrl: string): Promise<SignedAccount> {
  const response = await requestJson<Record<string, unknown>>(baseUrl, '/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = expectStatus('Signed guest account creation', response, 201);
  if (
    typeof body.id !== 'string'
    || typeof body.accessToken !== 'string'
    || !/^gw1\.[^.]+\.[^.]+$/.test(body.accessToken)
  ) {
    throw new Error('Account creation did not return an account id and signed session token.');
  }
  return { id: body.id, accessToken: body.accessToken };
}

function queueBody(buildVersion: string | undefined): Record<string, unknown> {
  return {
    queueType: 'unranked',
    regionPreferences: ['eu-west'],
    ...(buildVersion === undefined ? {} : { buildVersion }),
    platform: 'web',
  };
}

async function joinQueue(
  baseUrl: string,
  account: SignedAccount,
  buildVersion: string,
): Promise<QueueTicket> {
  const response = await requestJson<QueueTicket>(baseUrl, '/matchmaking/queue/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...bearerHeaders(account) },
    body: JSON.stringify(queueBody(buildVersion)),
  });
  const ticket = expectStatus('Approved matchmaking admission', response, 201);
  if (!ticket.ticketId) {
    throw new Error('Approved matchmaking admission did not return a ticket id.');
  }
  return ticket;
}

async function readQueueTicket(
  baseUrl: string,
  account: SignedAccount,
  ticketId: string,
): Promise<QueueTicket> {
  const response = await requestJson<QueueTicket>(
    baseUrl,
    `/matchmaking/queue/tickets/${encodeURIComponent(ticketId)}`,
    { headers: bearerHeaders(account) },
  );
  return expectStatus('Matched queue ticket read', response, 200);
}

function requireMatchStart(ticket: QueueTicket, label: string): {
  sessionId: string;
  sessionToken: string;
} {
  const sessionId = ticket.matchStart?.sessionId;
  const sessionToken = ticket.matchStart?.sessionToken;
  if (typeof sessionId !== 'string' || typeof sessionToken !== 'string') {
    throw new Error(`${label} did not include a match session and participant token.`);
  }
  return { sessionId, sessionToken };
}

function validateTurnConfig(
  config: IceConfig,
  accountId: string,
  sharedSecret: string,
): { username: string; credential: string; ttlSeconds: number } {
  if (
    config.turnCredentialMode !== 'time_limited'
    || config.relayAvailable !== true
    || config.iceTransportPolicy !== 'relay'
    || typeof config.turnCredentialExpiresAt !== 'string'
  ) {
    throw new Error('TURN config did not use forced relay with time-limited credentials.');
  }
  const turnServer = config.iceServers?.find((server) => (
    Array.isArray(server.urls)
    && server.urls.some((url) => url.startsWith('turn:127.0.0.1:'))
  ));
  if (!turnServer || typeof turnServer.username !== 'string' || typeof turnServer.credential !== 'string') {
    throw new Error('TURN config did not include local relay credentials.');
  }
  const separatorIndex = turnServer.username.indexOf(':');
  const expiresAtSeconds = Number(turnServer.username.slice(0, separatorIndex));
  const usernameAccountId = turnServer.username.slice(separatorIndex + 1);
  if (
    separatorIndex < 1
    || !Number.isInteger(expiresAtSeconds)
    || usernameAccountId !== accountId
  ) {
    throw new Error('TURN username was not bound to the authenticated participant.');
  }
  const expectedCredential = createHmac('sha1', sharedSecret)
    .update(turnServer.username)
    .digest('base64');
  if (turnServer.credential !== expectedCredential) {
    throw new Error('TURN credential did not match the configured time-limited signature.');
  }
  const expiresAtMs = Date.parse(config.turnCredentialExpiresAt);
  if (!Number.isFinite(expiresAtMs) || Math.floor(expiresAtMs / 1_000) !== expiresAtSeconds) {
    throw new Error('TURN credential expiry did not match its signed username.');
  }
  const ttlSeconds = Math.round((expiresAtMs - Date.now()) / 1_000);
  if (ttlSeconds < 45 || ttlSeconds > TURN_CREDENTIAL_TTL_SECONDS + 5) {
    throw new Error(`TURN credential TTL was not short-lived: ${ttlSeconds}s.`);
  }
  return {
    username: turnServer.username,
    credential: turnServer.credential,
    ttlSeconds,
  };
}

function authRateLimitHash(secret: string, scope: string, subject: string): string {
  return createHmac('sha256', secret)
    .update('gravity-well-auth-rate-limit-v1\0')
    .update(scope)
    .update('\0')
    .update(subject)
    .digest('hex');
}

async function cleanupDatabaseRows(
  pool: Pool,
  runtimeNamespaces: string[],
  accountIds: string[],
  authRateLimitSecret: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM matchmaking_session_access WHERE snapshot_key = ANY($1::text[])',
      [runtimeNamespaces],
    );
    await client.query(
      'DELETE FROM matchmaking_runtime_snapshots WHERE snapshot_key = ANY($1::text[])',
      [runtimeNamespaces],
    );
    await client.query(
      'DELETE FROM matchmaking_runtime_fences WHERE snapshot_key = ANY($1::text[])',
      [runtimeNamespaces],
    );
    if (accountIds.length > 0) {
      await client.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
    }

    const sourceSubjects = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    const scopes = ['auth_global_source', 'guest_create_source'];
    const hashes = scopes.flatMap((scope) => sourceSubjects.map((subject) => (
      authRateLimitHash(authRateLimitSecret, scope, subject)
    )));
    await client.query(
      'DELETE FROM auth_rate_limit_buckets WHERE subject_hash = ANY($1::text[])',
      [hashes],
    );

    const verification = await client.query<{
      runtime_count: string;
      account_count: string;
      rate_limit_count: string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM matchmaking_runtime_snapshots
            WHERE snapshot_key = ANY($1::text[])
          ) + (
            SELECT COUNT(*)
            FROM matchmaking_runtime_fences
            WHERE snapshot_key = ANY($1::text[])
          ) + (
            SELECT COUNT(*)
            FROM matchmaking_session_access
            WHERE snapshot_key = ANY($1::text[])
          ) AS runtime_count,
          (
            SELECT COUNT(*)
            FROM accounts
            WHERE id = ANY($2::uuid[])
          ) AS account_count,
          (
            SELECT COUNT(*)
            FROM auth_rate_limit_buckets
            WHERE subject_hash = ANY($3::text[])
          ) AS rate_limit_count
      `,
      [runtimeNamespaces, accountIds, hashes],
    );
    const remaining = verification.rows[0];
    if (
      Number(remaining?.runtime_count ?? -1) !== 0
      || Number(remaining?.account_count ?? -1) !== 0
      || Number(remaining?.rate_limit_count ?? -1) !== 0
    ) {
      throw new Error('Controlled-alpha smoke database resources remained after cleanup.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildApiEnvironment(options: {
  port: number;
  databaseUrl: string;
  databaseId: string;
  deploymentEnvironment: string;
  authSessionSecret: string;
  authRateLimitSecret: string;
  turnSharedSecret: string;
  runtimeNamespace: string;
  accessMode: 'closed' | 'allowlist';
  allowlistedAccountIds?: string[];
  approvedBuild?: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_OPTIONS: '',
    NODE_USE_ENV_PROXY: '0',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
    DATABASE_URL: options.databaseUrl,
    PORT: String(options.port),
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: options.deploymentEnvironment,
    DEPLOYMENT_DATABASE_ID: options.databaseId,
    RELEASE_SHA: options.approvedBuild ?? 'controlled-alpha-bootstrap',
    AUTH_SESSION_SECRET: options.authSessionSecret,
    AUTH_SESSION_PREVIOUS_SECRET: '',
    AUTH_SESSION_TTL_SECONDS: '300',
    AUTH_RATE_LIMIT_SECRET: options.authRateLimitSecret,
    AUTH_RATE_LIMIT_GLOBAL_SOURCE_MAX_ATTEMPTS: '100',
    AUTH_RATE_LIMIT_GLOBAL_SOURCE_WINDOW_SECONDS: '60',
    AUTH_RATE_LIMIT_GUEST_SOURCE_MAX_ATTEMPTS: '10',
    AUTH_RATE_LIMIT_GUEST_SOURCE_WINDOW_SECONDS: '60',
    ALLOW_INSECURE_ACCOUNT_HEADER: 'false',
    ALLOW_REMOTE_DATABASE_SMOKE: '0',
    API_TRUST_PROXY_HOPS: '',
    API_CORS_ORIGINS: 'http://127.0.0.1:*',
    REPLAY_BLOB_PROVIDER: 'postgres',
    MATCHMAKING_ACCESS_MODE: options.accessMode,
    MATCHMAKING_ALPHA_ACCOUNT_IDS: (options.allowlistedAccountIds ?? []).join(','),
    MATCHMAKING_ALPHA_BUILD_VERSIONS: options.approvedBuild ?? '',
    MATCHMAKING_RUNTIME_NAMESPACE: options.runtimeNamespace,
    MATCHMAKING_SNAPSHOT_INTERVAL_MS: '60000',
    MATCHMAKING_STUN_URLS: '',
    MATCHMAKING_TURN_URLS: 'turn:127.0.0.1:3478?transport=udp',
    MATCHMAKING_TURN_SHARED_SECRET: options.turnSharedSecret,
    MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS: String(TURN_CREDENTIAL_TTL_SECONDS),
    MATCHMAKING_ICE_TRANSPORT_POLICY: 'all',
    MATCHMAKING_ENABLE_LEGACY_HTTP_FRAME_RELAY: 'false',
    STEAM_ALLOW_DEV_TICKETS: 'false',
    STEAM_WEB_API_KEY: '',
    STEAM_WEB_API_BASE: 'http://127.0.0.1:9',
    ROOM_WEB_INVITE_BASE_URL: `http://127.0.0.1:${options.port}`,
    PGAPPNAME: `gravity-well-controlled-alpha-access-${process.pid}`,
  };
}

async function run(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error('Controlled-alpha access smoke does not accept command-line arguments.');
  }

  const port = parsePort(process.env.CONTROLLED_ALPHA_ACCESS_SMOKE_PORT);
  const baseUrl = validateSmokeTargetUrl(
    `http://127.0.0.1:${port}`,
    '127.0.0.1',
  );
  const databaseUrl = String(
    process.env.CONTROLLED_ALPHA_ACCESS_DATABASE_URL
    ?? process.env.LOCAL_DATABASE_URL
    ?? DEFAULT_DATABASE_URL,
  ).trim();
  const configuredDatabaseTarget = classifyDatabaseTarget(databaseUrl);
  const runId = `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const databaseId = `local-controlled-alpha-access-${runId}`;
  const deploymentEnvironment = 'local-controlled-alpha-smoke';
  const bootstrapNamespace = `smoke:controlled-alpha-bootstrap-${runId}`;
  const allowlistNamespace = `smoke:controlled-alpha-access-${runId}`;
  const runtimeNamespaces = [bootstrapNamespace, allowlistNamespace];
  const authSessionSecret = randomBytes(48).toString('base64url');
  const authRateLimitSecret = randomBytes(48).toString('base64url');
  const turnSharedSecret = randomBytes(32).toString('hex');
  const approvedBuild = randomBytes(20).toString('hex');
  const staleBuild = `${approvedBuild.slice(0, -1)}${approvedBuild.endsWith('0') ? '1' : '0'}`;
  const sensitiveValues = new Set([
    authSessionSecret,
    authRateLimitSecret,
    turnSharedSecret,
    approvedBuild,
    staleBuild,
  ]);
  const targetEnv: NodeJS.ProcessEnv = {
    SMOKE_EXPECT_API_HOSTNAME: '127.0.0.1',
    SMOKE_EXPECT_DATABASE_ID: databaseId,
    SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    ALLOW_REMOTE_DATABASE_SMOKE: '0',
  };
  const configuredReportPath = process.env.CONTROLLED_ALPHA_ACCESS_SMOKE_REPORT_PATH
    ?? path.join(defaultArtifactDir, 'report.json');
  const reportPath = path.isAbsolute(configuredReportPath)
    ? path.resolve(configuredReportPath)
    : path.resolve(repositoryRoot, configuredReportPath);
  const steps: StepResult[] = [];
  const accountIds: string[] = [];
  const proofs: SmokeProofs = {
    signedSessionsRequired: false,
    accessStatusPrivate: false,
    networkStatusPrivate: false,
    outsiderDenialCode: null,
    missingBuildDenialCode: null,
    staleBuildDenialCode: null,
    approvedAdmissions: 0,
    roomCreateEnforced: false,
    roomJoinEnforced: false,
    turnCredentialMode: null,
    turnCredentialTtlSeconds: null,
    turnCredentialsParticipantBound: false,
  };
  const cleanup: CleanupState = {
    apiStopped: false,
    databaseRowsRemoved: false,
    postgresStoppedIfStarted: false,
  };
  let api: ManagedApi | null = null;
  let pool: Pool | null = null;
  let startedPostgres = false;
  let failure: string | null = null;

  assertLocalReportPath(reportPath);
  mkdirSync(path.dirname(reportPath), { recursive: true });

  try {
    await recordStep(steps, 'reject non-loopback targets before contact', () => {
      assertStrictLocalDatabaseUrl(databaseUrl);
      if (new URL(baseUrl).hostname !== '127.0.0.1') {
        throw new Error('Controlled-alpha access smoke API target must be 127.0.0.1.');
      }
    });
    await recordStep(steps, 'reserve isolated local API port', async () => {
      if (!await isPortAvailable(port)) {
        throw new Error(`Local API port ${port} is already in use.`);
      }
    });
    await recordStep(steps, 'prepare local PostgreSQL without pulls', () => ensureLocalDatabase(
      databaseUrl,
      () => {
        startedPostgres = true;
      },
    ));
    await recordStep(steps, 'apply local database migrations', () => runCommand(
      'Local migrations',
      process.execPath,
      ['--import', 'tsx', 'scripts/migrate.ts'],
      {
        cwd: apiWorkspaceRoot,
        env: { DATABASE_URL: databaseUrl },
        timeoutMs: 60_000,
      },
    ));
    pool = new Pool({ connectionString: databaseUrl, max: 1 });

    api = spawnApi('Production bootstrap API', buildApiEnvironment({
      port,
      databaseUrl,
      databaseId,
      deploymentEnvironment,
      authSessionSecret,
      authRateLimitSecret,
      turnSharedSecret,
      runtimeNamespace: bootstrapNamespace,
      accessMode: 'closed',
    }));
    await recordStep(steps, 'start production closed-mode bootstrap API', async () => {
      await waitForApi(api as ManagedApi, baseUrl);
      await verifyReportedLocalTarget(baseUrl, targetEnv);
    });

    const accounts = await recordStep(steps, 'issue three signed production sessions', async () => {
      const created: SignedAccount[] = [];
      for (let index = 0; index < 3; index += 1) {
        const account = await createSignedAccount(baseUrl);
        created.push(account);
        accountIds.push(account.id);
        sensitiveValues.add(account.id);
        sensitiveValues.add(account.accessToken);
      }
      return created;
    });
    const [approvedA, approvedB, outsider] = accounts;

    await recordStep(steps, 'replace bootstrap API with production allowlist API', async () => {
      await stopApi(api);
      api = null;
      if (!await isPortAvailable(port)) {
        throw new Error(`Local API port ${port} was not released by the bootstrap process.`);
      }
      api = spawnApi('Production allowlist API', buildApiEnvironment({
        port,
        databaseUrl,
        databaseId,
        deploymentEnvironment,
        authSessionSecret,
        authRateLimitSecret,
        turnSharedSecret,
        runtimeNamespace: allowlistNamespace,
        accessMode: 'allowlist',
        allowlistedAccountIds: [approvedA.id, approvedB.id],
        approvedBuild,
      }));
      await waitForApi(api, baseUrl);
      await verifyReportedLocalTarget(baseUrl, targetEnv);
    });

    await recordStep(steps, 'prove access and network status privacy', async () => {
      const [accessStatusResponse, networkStatusResponse] = await Promise.all([
        requestJson<Record<string, unknown>>(baseUrl, '/matchmaking/access/status'),
        requestJson<Record<string, unknown>>(baseUrl, '/matchmaking/network/status'),
      ]);
      const accessStatus = expectExactKeys(
        'Matchmaking access status',
        expectStatus('Matchmaking access status', accessStatusResponse, 200),
        ['mode', 'ready', 'accountAllowlistCount', 'buildAllowlistCount'],
      );
      if (
        accessStatus.mode !== 'allowlist'
        || accessStatus.ready !== true
        || accessStatus.accountAllowlistCount !== 2
        || accessStatus.buildAllowlistCount !== 1
      ) {
        throw new Error('Matchmaking access status did not report the configured allowlist counts.');
      }
      const serializedAccessStatus = JSON.stringify(accessStatus);
      if ([approvedA.id, approvedB.id, outsider.id, approvedBuild, staleBuild]
        .some((secretValue) => serializedAccessStatus.includes(secretValue))) {
        throw new Error('Matchmaking access status exposed allowlist values.');
      }
      proofs.accessStatusPrivate = true;

      const networkStatus = expectExactKeys(
        'Matchmaking network status',
        expectStatus('Matchmaking network status', networkStatusResponse, 200),
        [
          'iceTransportPolicy',
          'fallbackPolicy',
          'directConnectTimeoutMs',
          'relayAvailable',
          'turnCredentialMode',
        ],
      );
      if (networkStatus.relayAvailable !== true || networkStatus.turnCredentialMode !== 'time_limited') {
        throw new Error('Matchmaking network status did not report time-limited TURN readiness.');
      }
      const serializedNetworkStatus = JSON.stringify(networkStatus);
      if (
        serializedNetworkStatus.includes(turnSharedSecret)
        || serializedNetworkStatus.includes('turn:127.0.0.1:')
        || /"(?:credential|username|iceServers|turnCredentialExpiresAt)"/i
          .test(serializedNetworkStatus)
      ) {
        throw new Error('Matchmaking network status exposed relay connection details.');
      }
      proofs.networkStatusPrivate = true;
    });

    await recordStep(steps, 'require signed sessions in production mode', async () => {
      const insecureHeaderResponse = await requestJson(baseUrl, '/matchmaking/queue/join', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-account-id': approvedA.id,
        },
        body: JSON.stringify(queueBody(approvedBuild)),
      });
      expectStatus('Unsigned account-header admission', insecureHeaderResponse, 401);
      proofs.signedSessionsRequired = true;
    });

    await recordStep(steps, 'deny outsider and missing or stale builds', async () => {
      const outsiderResponse = await requestJson(baseUrl, '/matchmaking/queue/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(outsider) },
        body: JSON.stringify(queueBody(approvedBuild)),
      });
      expectDenialCode('Outsider matchmaking admission', outsiderResponse, 'account_not_allowlisted');
      proofs.outsiderDenialCode = 'account_not_allowlisted';

      const missingBuildResponse = await requestJson(baseUrl, '/matchmaking/queue/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedA) },
        body: JSON.stringify(queueBody(undefined)),
      });
      expectDenialCode('Missing-build matchmaking admission', missingBuildResponse, 'build_version_required');
      proofs.missingBuildDenialCode = 'build_version_required';

      const staleBuildResponse = await requestJson(baseUrl, '/matchmaking/queue/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedA) },
        body: JSON.stringify(queueBody(staleBuild)),
      });
      expectDenialCode('Stale-build matchmaking admission', staleBuildResponse, 'build_not_allowlisted');
      proofs.staleBuildDenialCode = 'build_not_allowlisted';
    });

    await recordStep(steps, 'enforce allowlist on room create and join', async () => {
      const missingCreate = await requestJson(baseUrl, '/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedA) },
        body: JSON.stringify({ platform: 'web' }),
      });
      expectDenialCode('Missing-build room creation', missingCreate, 'build_version_required');
      const staleCreate = await requestJson(baseUrl, '/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedA) },
        body: JSON.stringify({ platform: 'web', buildVersion: staleBuild }),
      });
      expectDenialCode('Stale-build room creation', staleCreate, 'build_not_allowlisted');
      const outsiderCreate = await requestJson(baseUrl, '/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(outsider) },
        body: JSON.stringify({ platform: 'web', buildVersion: approvedBuild }),
      });
      expectDenialCode('Outsider room creation', outsiderCreate, 'account_not_allowlisted');

      const createdRoomResponse = await requestJson<Record<string, unknown>>(baseUrl, '/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedA) },
        body: JSON.stringify({ platform: 'web', buildVersion: approvedBuild }),
      });
      const createdRoom = expectStatus('Approved room creation', createdRoomResponse, 201);
      if (typeof createdRoom.roomCode !== 'string') {
        throw new Error('Approved room creation did not return a room code.');
      }
      sensitiveValues.add(createdRoom.roomCode);
      proofs.roomCreateEnforced = true;

      const roomRoute = `/rooms/${encodeURIComponent(createdRoom.roomCode)}/join`;
      const staleJoin = await requestJson(baseUrl, roomRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedB) },
        body: JSON.stringify({ platform: 'web', role: 'player', buildVersion: staleBuild }),
      });
      expectDenialCode('Stale-build room join', staleJoin, 'build_not_allowlisted');
      const outsiderJoin = await requestJson(baseUrl, roomRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(outsider) },
        body: JSON.stringify({ platform: 'web', role: 'player', buildVersion: approvedBuild }),
      });
      expectDenialCode('Outsider room join', outsiderJoin, 'account_not_allowlisted');
      const approvedJoin = await requestJson(baseUrl, roomRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearerHeaders(approvedB) },
        body: JSON.stringify({ platform: 'web', role: 'player', buildVersion: approvedBuild }),
      });
      expectStatus('Approved room join', approvedJoin, 200);
      proofs.roomJoinEnforced = true;
    });

    const matchStarts = await recordStep(steps, 'admit exactly two approved participants', async () => {
      let ticketA = await joinQueue(baseUrl, approvedA, approvedBuild);
      const ticketB = await joinQueue(baseUrl, approvedB, approvedBuild);
      if (!ticketA.matchStart && ticketA.ticketId) {
        ticketA = await readQueueTicket(baseUrl, approvedA, ticketA.ticketId);
      }
      const matchStartA = requireMatchStart(ticketA, 'First approved admission');
      const matchStartB = requireMatchStart(ticketB, 'Second approved admission');
      if (matchStartA.sessionId !== matchStartB.sessionId) {
        throw new Error('Approved participants were not admitted to the same session.');
      }
      sensitiveValues.add(matchStartA.sessionId);
      sensitiveValues.add(matchStartA.sessionToken);
      sensitiveValues.add(matchStartB.sessionToken);
      proofs.approvedAdmissions = 2;
      return { approvedA, approvedB, outsider, matchStartA, matchStartB };
    });

    await recordStep(steps, 'issue participant-bound short-lived TURN credentials', async () => {
      const requestIceConfig = async (
        account: SignedAccount,
        sessionToken: string,
      ): Promise<JsonResponse<IceConfig>> => await requestJson<IceConfig>(
        baseUrl,
        '/matchmaking/network/ice-config',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...bearerHeaders(account) },
          body: JSON.stringify({
            sessionId: matchStarts.matchStartA.sessionId,
            sessionToken,
            forceRelay: true,
          }),
        },
      );

      const crossParticipant = await requestIceConfig(
        matchStarts.approvedA,
        matchStarts.matchStartB.sessionToken,
      );
      expectDenialCode('Cross-participant TURN token', crossParticipant, 'invalid_token', 401);
      const outsiderConfig = await requestIceConfig(
        matchStarts.outsider,
        matchStarts.matchStartA.sessionToken,
      );
      expectDenialCode('Outsider TURN credential request', outsiderConfig, 'forbidden', 403);

      const configA = expectStatus(
        'First participant TURN credential request',
        await requestIceConfig(matchStarts.approvedA, matchStarts.matchStartA.sessionToken),
        200,
      );
      const configB = expectStatus(
        'Second participant TURN credential request',
        await requestIceConfig(matchStarts.approvedB, matchStarts.matchStartB.sessionToken),
        200,
      );
      const credentialA = validateTurnConfig(configA, matchStarts.approvedA.id, turnSharedSecret);
      const credentialB = validateTurnConfig(configB, matchStarts.approvedB.id, turnSharedSecret);
      if (
        credentialA.username === credentialB.username
        || credentialA.credential === credentialB.credential
      ) {
        throw new Error('TURN credentials were not distinct for each participant.');
      }
      proofs.turnCredentialMode = 'time_limited';
      proofs.turnCredentialTtlSeconds = Math.min(
        credentialA.ttlSeconds,
        credentialB.ttlSeconds,
      );
      proofs.turnCredentialsParticipantBound = true;
    });
  } catch (error) {
    failure = appendFailure(failure, error);
  } finally {
    try {
      await stopApi(api);
      cleanup.apiStopped = true;
    } catch (error) {
      failure = appendFailure(failure, error, 'API cleanup failed');
    }
    api = null;

    if (pool) {
      try {
        await cleanupDatabaseRows(
          pool,
          runtimeNamespaces,
          accountIds,
          authRateLimitSecret,
        );
        cleanup.databaseRowsRemoved = true;
      } catch (error) {
        failure = appendFailure(failure, error, 'Database cleanup failed');
      } finally {
        await pool.end().catch((error) => {
          failure = appendFailure(failure, error, 'Database pool cleanup failed');
        });
      }
    }

    if (startedPostgres) {
      try {
        await runCommand(
          'Local PostgreSQL cleanup',
          'docker',
          ['compose', 'stop', 'postgres'],
          { echo: false, timeoutMs: 60_000 },
        );
        cleanup.postgresStoppedIfStarted = true;
      } catch (error) {
        failure = appendFailure(failure, error, 'Local PostgreSQL cleanup failed');
      }
    } else {
      cleanup.postgresStoppedIfStarted = true;
    }
  }

  const reportSteps = steps.map((step) => ({
    ...step,
    ...(step.error === undefined
      ? {}
      : { error: redactSensitive(step.error, sensitiveValues) }),
  }));
  const reportFailure = redactSensitive(failure ?? undefined, sensitiveValues) ?? null;
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: failure === null,
    localOnly: true,
    hostedServicesContacted: false,
    execution: {
      nodeEnvironment: 'production',
      accessMode: 'allowlist',
      apiHostname: '127.0.0.1',
      databaseTarget: configuredDatabaseTarget === 'local'
        ? 'local'
        : 'rejected_before_contact',
      databaseIdentityVerified: steps.some((step) => (
        step.name === 'replace bootstrap API with production allowlist API'
        && step.status === 'passed'
      )),
      databaseStartedByRunner: startedPostgres,
    },
    allowlist: {
      accountCount: 2,
      buildVersionCount: 1,
      exactBuildMatchVerified: proofs.approvedAdmissions === 2
        && proofs.missingBuildDenialCode === 'build_version_required'
        && proofs.staleBuildDenialCode === 'build_not_allowlisted',
      valuesRedacted: true,
    },
    proofs,
    turnRelayContacted: false,
    cleanup,
    steps: reportSteps,
    failure: reportFailure,
  };
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length >= 8 && serializedReport.includes(sensitiveValue)) {
      throw new Error('Controlled-alpha access smoke report retained a generated sensitive value.');
    }
  }
  writeFileSync(reportPath, serializedReport);
  console.log(serializedReport.trimEnd());
  console.log(`[controlled-alpha-access] report: ${reportPath}`);
  if (failure) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
