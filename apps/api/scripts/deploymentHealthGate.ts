import { pathToFileURL } from 'node:url';
import { MATCHMAKING_RUNTIME_COORDINATION_MODE } from '../src/matchmaking/runtimeCoordinator';

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const MIN_FETCH_TIMEOUT_MS = 100;
const MAX_FETCH_TIMEOUT_MS = 30_000;
const SHA_REGEX = /^[0-9a-f]{40}$/i;
const WEB_RELEASE_ATTESTATION_SCHEMA = 'gw.web-release.v1';

interface SloAlert {
  code: string;
  severity: 'critical' | 'warning';
  message: string;
  escalation: string;
}

interface MatchmakingRuntime {
  acceptingJoins?: boolean;
  activeSessions?: number;
  queuedTickets?: number;
}

interface MatchmakingNetworkConfig {
  relayAvailable?: boolean;
  turnCredentialMode?: 'none' | 'static' | 'time_limited';
}

interface MatchmakingAccessStatus {
  mode?: 'open' | 'closed' | 'allowlist';
  ready?: boolean;
  accountAllowlistCount?: number;
  buildAllowlistCount?: number;
}

interface MatchmakingQueueConfig {
  maxResidentTickets?: number;
}

interface DeploymentReadiness {
  ok?: boolean;
  databaseTarget?: 'local' | 'remote' | 'unknown';
  deploymentEnvironment?: string;
  databaseId?: string;
  releaseSha?: string;
  migrationHead?: string | null;
  migrationCount?: number;
  migrationChecksumsVerified?: boolean;
  replayBlobProvider?: 'local' | 'postgres';
  replayBlobDurable?: boolean;
  matchmakingRuntimeCoordination?: string;
  matchmakingRuntimeNamespace?: string;
}

interface WebReleaseAttestation {
  schemaVersion?: string;
  releaseSha?: string;
}

export function validateWebReleaseAttestation(body: unknown, expectedReleaseSha: string): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Web release attestation must be a JSON object.');
  }
  const attestation = body as WebReleaseAttestation;
  const webReleaseSha = String(attestation.releaseSha ?? '').trim();
  if (
    attestation.schemaVersion !== WEB_RELEASE_ATTESTATION_SCHEMA
    || !SHA_REGEX.test(webReleaseSha)
    || webReleaseSha.toLowerCase() !== expectedReleaseSha.toLowerCase()
  ) {
    throw new Error(
      `Web release attestation does not bind the deployed web client to API release ${expectedReleaseSha}.`,
    );
  }
  return webReleaseSha;
}

export function validateMatchmakingResidentCapacity(
  body: unknown,
  expectedValue: string | undefined,
): number {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Queue config must be a JSON object.');
  }
  const actual = Number((body as MatchmakingQueueConfig).maxResidentTickets);
  if (!Number.isSafeInteger(actual) || actual <= 0) {
    throw new Error('Queue config did not report a positive maxResidentTickets value.');
  }
  const expectedRaw = String(expectedValue ?? '').trim();
  if (!expectedRaw) {
    return actual;
  }
  const expected = Number(expectedRaw);
  if (!Number.isSafeInteger(expected) || expected <= 0) {
    throw new Error('DEPLOY_EXPECT_MAX_RESIDENT_TICKETS must be a positive safe integer.');
  }
  if (actual !== expected) {
    throw new Error(
      `Queue resident-ticket capacity mismatch: expected=${expected}, actual=${actual}.`,
    );
  }
  return actual;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

function optionalExpectedValue(value: string | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function hasNoStoreDirective(value: string | null): boolean {
  return String(value ?? '')
    .split(',')
    .some((directive) => directive.trim().toLowerCase() === 'no-store');
}

function parseFetchTimeoutMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_FETCH_TIMEOUT_MS;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_FETCH_TIMEOUT_MS || parsed > MAX_FETCH_TIMEOUT_MS) {
    throw new Error(
      `DEPLOY_FETCH_TIMEOUT_MS must be an integer between ${MIN_FETCH_TIMEOUT_MS} and ${MAX_FETCH_TIMEOUT_MS}.`,
    );
  }
  return parsed;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function validateDeploymentUrl(options: {
  value: string | undefined;
  valueName: string;
  expectedHostname: string | undefined;
  expectedHostnameName: string;
  allowInsecureLoopback?: boolean;
  requireBaseUrl?: boolean;
}): string {
  const rawValue = String(options.value ?? '').trim();
  const expectedHostname = String(options.expectedHostname ?? '').trim().toLowerCase();
  if (!rawValue) {
    throw new Error(`${options.valueName} is required.`);
  }
  if (!expectedHostname) {
    throw new Error(`${options.expectedHostnameName} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${options.valueName} must be an absolute URL.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${options.valueName} must not contain URL credentials.`);
  }
  if (parsed.hostname.toLowerCase() !== expectedHostname) {
    throw new Error(
      `${options.valueName} hostname does not match ${options.expectedHostnameName} (${expectedHostname}).`,
    );
  }
  const insecureLoopbackAllowed = options.allowInsecureLoopback === true
    && parsed.protocol === 'http:'
    && isLoopbackHostname(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !insecureLoopbackAllowed) {
    throw new Error(`${options.valueName} must use HTTPS.`);
  }
  if (parsed.hash || (options.requireBaseUrl === true && parsed.search)) {
    throw new Error(`${options.valueName} must not contain a query string or fragment.`);
  }

  if (options.requireBaseUrl === true) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function fetchJson(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; cacheControl: string | null }> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep raw text body for diagnostics when not JSON.
    }
    return {
      status: response.status,
      body,
      cacheControl: response.headers.get('cache-control'),
    };
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Deployment gate request timed out after ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  }
}

export async function run(): Promise<void> {
  const allowInsecureLoopback = parseBoolean(process.env.DEPLOY_ALLOW_INSECURE_LOCALHOST);
  const baseUrl = validateDeploymentUrl({
    value: process.env.API_BASE_URL,
    valueName: 'API_BASE_URL',
    expectedHostname: process.env.DEPLOY_EXPECT_API_HOSTNAME,
    expectedHostnameName: 'DEPLOY_EXPECT_API_HOSTNAME',
    allowInsecureLoopback,
    requireBaseUrl: true,
  });
  const fetchTimeoutMs = parseFetchTimeoutMs(process.env.DEPLOY_FETCH_TIMEOUT_MS);
  const windowHours = parsePositiveInteger(process.env.DEPLOY_HEALTHCHECK_WINDOW_HOURS, 1);
  const maxCriticalAlerts = parsePositiveInteger(process.env.DEPLOY_MAX_CRITICAL_ALERTS, 0);
  const maxWarningAlerts = parsePositiveInteger(process.env.DEPLOY_MAX_WARNING_ALERTS, 1);
  const maxActiveSessions = parsePositiveInteger(process.env.DEPLOY_MAX_ACTIVE_SESSIONS, 0);
  const expectMatchmakingDraining = parseBoolean(process.env.DEPLOY_EXPECT_MATCHMAKING_DRAINING);
  const requireTurn = parseBoolean(process.env.DEPLOY_REQUIRE_TURN);
  const requireAlphaAllowlist = parseBoolean(process.env.DEPLOY_REQUIRE_ALPHA_ALLOWLIST);
  const requireAdminChecks = parseBoolean(process.env.DEPLOY_REQUIRE_ADMIN_CHECKS);
  const requireDurableReplayStore = parseBoolean(process.env.DEPLOY_REQUIRE_DURABLE_REPLAY_STORE);
  const requireWebReleaseAttestation = parseBoolean(process.env.DEPLOY_REQUIRE_WEB_RELEASE_ATTESTATION);
  const expectedReleaseSha = optionalExpectedValue(process.env.DEPLOY_EXPECT_RELEASE_SHA);
  const expectedMigrationHead = optionalExpectedValue(process.env.DEPLOY_EXPECT_MIGRATION_HEAD);
  const expectedMigrationCount = optionalExpectedValue(process.env.DEPLOY_EXPECT_MIGRATION_COUNT);
  const expectedDatabaseTarget = optionalExpectedValue(process.env.DEPLOY_EXPECT_DATABASE_TARGET);
  const expectedDatabaseId = optionalExpectedValue(process.env.DEPLOY_EXPECT_DATABASE_ID);
  const expectedEnvironment = optionalExpectedValue(process.env.DEPLOY_EXPECT_ENVIRONMENT);
  const expectedMatchmakingRuntimeNamespace = optionalExpectedValue(
    process.env.DEPLOY_EXPECT_MATCHMAKING_RUNTIME_NAMESPACE,
  );

  if (expectedReleaseSha !== null && !SHA_REGEX.test(expectedReleaseSha)) {
    throw new Error('DEPLOY_EXPECT_RELEASE_SHA must be an exact 40-character Git SHA.');
  }
  let webReleaseAttestationUrl: string | null = null;
  if (requireWebReleaseAttestation) {
    if (expectedReleaseSha === null) {
      throw new Error('DEPLOY_EXPECT_RELEASE_SHA is required when web release attestation is enabled.');
    }
    webReleaseAttestationUrl = validateDeploymentUrl({
      value: process.env.DEPLOY_WEB_RELEASE_ATTESTATION_URL,
      valueName: 'DEPLOY_WEB_RELEASE_ATTESTATION_URL',
      expectedHostname: process.env.DEPLOY_EXPECT_WEB_HOSTNAME,
      expectedHostnameName: 'DEPLOY_EXPECT_WEB_HOSTNAME',
      allowInsecureLoopback,
    });
  }

  const health = await fetchJson(`${baseUrl}/health`, fetchTimeoutMs);
  if (
    health.status !== 200
    || typeof health.body !== 'object'
    || health.body === null
    || (health.body as { ok?: unknown }).ok !== true
  ) {
    throw new Error(`Health endpoint failed: status=${health.status}`);
  }
  const readiness = await fetchJson(`${baseUrl}/readyz`, fetchTimeoutMs);
  if (readiness.status !== 200 || typeof readiness.body !== 'object' || readiness.body === null) {
    throw new Error(`Readiness endpoint failed: status=${readiness.status}`);
  }
  const parsedReadiness = readiness.body as DeploymentReadiness;
  if (parsedReadiness.ok !== true) {
    throw new Error('Readiness endpoint did not confirm database connectivity and migration state.');
  }
  if (
    expectedReleaseSha !== null
    && String(parsedReadiness.releaseSha ?? '').toLowerCase() !== expectedReleaseSha.toLowerCase()
  ) {
    throw new Error(
      `Readiness release SHA mismatch: expected=${expectedReleaseSha}, actual=${parsedReadiness.releaseSha ?? 'missing'}.`,
    );
  }
  const readinessChecks: Array<[string, string | null, string | null | undefined]> = [
    ['migration head', expectedMigrationHead, parsedReadiness.migrationHead],
    ['migration count', expectedMigrationCount, String(parsedReadiness.migrationCount ?? '')],
    ['database target', expectedDatabaseTarget, parsedReadiness.databaseTarget],
    ['database id', expectedDatabaseId, parsedReadiness.databaseId],
    ['deployment environment', expectedEnvironment, parsedReadiness.deploymentEnvironment],
    ['matchmaking runtime namespace', expectedMatchmakingRuntimeNamespace, parsedReadiness.matchmakingRuntimeNamespace],
  ];
  for (const [label, expected, actual] of readinessChecks) {
    if (expected !== null && actual !== expected) {
      throw new Error(`Readiness ${label} mismatch: expected=${expected}, actual=${actual ?? 'missing'}.`);
    }
  }
  if (parsedReadiness.migrationChecksumsVerified !== true) {
    throw new Error('Readiness endpoint did not verify every applied migration checksum.');
  }
  if (requireDurableReplayStore && parsedReadiness.replayBlobDurable !== true) {
    throw new Error(
      `Durable replay storage is required for this rollout but /readyz reports ${parsedReadiness.replayBlobProvider ?? 'unknown'}.`,
    );
  }
  if (parsedReadiness.matchmakingRuntimeCoordination !== MATCHMAKING_RUNTIME_COORDINATION_MODE) {
    throw new Error(
      `Coordinated matchmaking runtime is required but /readyz reports ${parsedReadiness.matchmakingRuntimeCoordination ?? 'missing'}.`,
    );
  }
  const queueConfig = await fetchJson(`${baseUrl}/matchmaking/queue/config`, fetchTimeoutMs);
  if (queueConfig.status !== 200) {
    throw new Error(`Queue config endpoint failed: status=${queueConfig.status}`);
  }
  const maxResidentTickets = validateMatchmakingResidentCapacity(
    queueConfig.body,
    process.env.DEPLOY_EXPECT_MAX_RESIDENT_TICKETS,
  );
  const accessStatus = await fetchJson(`${baseUrl}/matchmaking/access/status`, fetchTimeoutMs);
  if (accessStatus.status !== 200 || typeof accessStatus.body !== 'object' || accessStatus.body === null) {
    throw new Error(`Matchmaking access status endpoint failed: status=${accessStatus.status}`);
  }
  const parsedAccessStatus = accessStatus.body as MatchmakingAccessStatus;
  if (
    requireAlphaAllowlist
    && (parsedAccessStatus.mode !== 'allowlist' || parsedAccessStatus.ready !== true)
  ) {
    throw new Error('Controlled alpha rollout requires non-empty account and build allowlists.');
  }
  const networkConfig = await fetchJson(`${baseUrl}/matchmaking/network/status`, fetchTimeoutMs);
  if (networkConfig.status !== 200 || typeof networkConfig.body !== 'object' || networkConfig.body === null) {
    throw new Error(`Matchmaking network config endpoint failed: status=${networkConfig.status}`);
  }
  const parsedNetworkConfig = networkConfig.body as MatchmakingNetworkConfig;
  if (requireTurn && parsedNetworkConfig.relayAvailable !== true) {
    throw new Error('TURN relay is required for this rollout but matchmaking reports relayAvailable=false.');
  }
  if (requireTurn && parsedNetworkConfig.turnCredentialMode !== 'time_limited') {
    throw new Error('TURN relay is required for this rollout but short-lived TURN credentials are not configured.');
  }

  let webReleaseAttestationStatus: number | null = null;
  let webReleaseSha: string | null = null;
  if (webReleaseAttestationUrl !== null && expectedReleaseSha !== null) {
    const webReleaseAttestation = await fetchJson(webReleaseAttestationUrl, fetchTimeoutMs, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache, no-store',
      },
    });
    webReleaseAttestationStatus = webReleaseAttestation.status;
    if (
      webReleaseAttestation.status !== 200
      || typeof webReleaseAttestation.body !== 'object'
      || webReleaseAttestation.body === null
    ) {
      throw new Error(`Web release attestation failed: status=${webReleaseAttestation.status}.`);
    }
    if (!hasNoStoreDirective(webReleaseAttestation.cacheControl)) {
      throw new Error('Web release attestation must return Cache-Control: no-store.');
    }
    webReleaseSha = validateWebReleaseAttestation(webReleaseAttestation.body, expectedReleaseSha);
  }

  let criticalAlerts = 0;
  let warningAlerts = 0;
  const apiSloAdminKey = String(process.env.API_SLO_ADMIN_KEY ?? '').trim();
  const apiOpsAdminKey = String(process.env.API_OPS_ADMIN_KEY ?? apiSloAdminKey).trim();
  if (requireAdminChecks && (!apiSloAdminKey || !apiOpsAdminKey)) {
    throw new Error('Deployment gate requires both SLO and operations admin credentials.');
  }
  let matchmakingRuntimeFetched = false;
  let activeSessions: number | null = null;
  let queuedTickets: number | null = null;
  if (apiOpsAdminKey) {
    const runtime = await fetchJson(`${baseUrl}/ops/matchmaking/runtime`, fetchTimeoutMs, {
      headers: {
        'x-admin-key': apiOpsAdminKey,
      },
    });
    if (runtime.status !== 200 || typeof runtime.body !== 'object' || runtime.body === null) {
      throw new Error(`Failed to read matchmaking runtime: status=${runtime.status}`);
    }
    const parsedRuntime = runtime.body as MatchmakingRuntime;
    activeSessions = Number(parsedRuntime.activeSessions);
    queuedTickets = Number(parsedRuntime.queuedTickets);
    if (!Number.isInteger(activeSessions) || activeSessions < 0 || !Number.isInteger(queuedTickets) || queuedTickets < 0) {
      throw new Error('Matchmaking runtime returned invalid counters.');
    }
    if (parsedRuntime.acceptingJoins !== !expectMatchmakingDraining) {
      throw new Error(expectMatchmakingDraining
        ? 'Matchmaking resumed queue joins before deployment health checks completed.'
        : 'Matchmaking did not resume queue joins after deployment.');
    }
    if (expectMatchmakingDraining && queuedTickets !== 0) {
      throw new Error(`Draining API still has queued tickets (${queuedTickets}).`);
    }
    if (activeSessions > maxActiveSessions) {
      throw new Error(`Active matchmaking sessions exceed deploy threshold (${activeSessions}/${maxActiveSessions}).`);
    }
    matchmakingRuntimeFetched = true;
  }
  let sloSummaryFetched = false;
  if (apiSloAdminKey) {
    const slo = await fetchJson(`${baseUrl}/ops/slo/summary?windowHours=${windowHours}`, fetchTimeoutMs, {
      headers: {
        'x-admin-key': apiSloAdminKey,
      },
    });
    if (slo.status === 200 && typeof slo.body === 'object' && slo.body !== null) {
      const alerts = Array.isArray((slo.body as { alerts?: unknown }).alerts)
        ? ((slo.body as { alerts: SloAlert[] }).alerts ?? [])
        : [];
      criticalAlerts = alerts.filter((alert) => alert.severity === 'critical').length;
      warningAlerts = alerts.filter((alert) => alert.severity === 'warning').length;
      sloSummaryFetched = true;
      if (criticalAlerts > maxCriticalAlerts || warningAlerts > maxWarningAlerts) {
        throw new Error(
          `SLO alert threshold exceeded (critical=${criticalAlerts}/${maxCriticalAlerts}, warning=${warningAlerts}/${maxWarningAlerts}).`,
        );
      }
    } else {
      throw new Error(`Failed to read SLO summary: status=${slo.status}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checks: {
          healthStatus: health.status,
          readinessStatus: readiness.status,
          releaseSha: parsedReadiness.releaseSha ?? 'unknown',
          migrationHead: parsedReadiness.migrationHead ?? null,
          migrationCount: parsedReadiness.migrationCount ?? null,
          migrationChecksumsVerified: parsedReadiness.migrationChecksumsVerified === true,
          databaseTarget: parsedReadiness.databaseTarget ?? 'unknown',
          databaseId: parsedReadiness.databaseId ?? 'unknown',
          deploymentEnvironment: parsedReadiness.deploymentEnvironment ?? 'unknown',
          expectedReleaseSha,
          expectedMigrationHead,
          expectedMigrationCount,
          expectedDatabaseTarget,
          expectedDatabaseId,
          expectedEnvironment,
          expectedMatchmakingRuntimeNamespace,
          fetchTimeoutMs,
          requireWebReleaseAttestation,
          webReleaseAttestationSchema: requireWebReleaseAttestation
            ? WEB_RELEASE_ATTESTATION_SCHEMA
            : null,
          webReleaseAttestationStatus,
          webReleaseSha,
          matchmakingRuntimeCoordination: parsedReadiness.matchmakingRuntimeCoordination,
          matchmakingRuntimeNamespace: parsedReadiness.matchmakingRuntimeNamespace ?? 'unknown',
          replayBlobProvider: parsedReadiness.replayBlobProvider ?? 'unknown',
          replayBlobDurable: parsedReadiness.replayBlobDurable === true,
          requireDurableReplayStore,
          queueConfigStatus: queueConfig.status,
          maxResidentTickets,
          expectedMaxResidentTickets: optionalExpectedValue(
            process.env.DEPLOY_EXPECT_MAX_RESIDENT_TICKETS,
          ),
          accessStatusCode: accessStatus.status,
          matchmakingAccessMode: parsedAccessStatus.mode ?? 'unknown',
          matchmakingAccessReady: parsedAccessStatus.ready === true,
          alphaAccountAllowlistCount: parsedAccessStatus.accountAllowlistCount ?? 0,
          alphaBuildAllowlistCount: parsedAccessStatus.buildAllowlistCount ?? 0,
          requireAlphaAllowlist,
          networkConfigStatus: networkConfig.status,
          relayAvailable: parsedNetworkConfig.relayAvailable === true,
          turnCredentialMode: parsedNetworkConfig.turnCredentialMode ?? 'none',
          requireTurn,
          matchmakingRuntimeFetched,
          activeSessions,
          queuedTickets,
          maxActiveSessions,
          expectMatchmakingDraining,
          sloSummaryFetched,
          criticalAlerts,
          warningAlerts,
          windowHours,
        },
      },
      null,
      2,
    ),
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
