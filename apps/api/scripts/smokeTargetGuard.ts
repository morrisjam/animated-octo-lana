import process from 'node:process';
import {
  assertSmokeDatabaseTarget,
  classifyDatabaseTarget,
  type DatabaseTarget,
} from '../src/databaseTarget';

const DEFAULT_TARGET_REQUEST_TIMEOUT_MS = 5_000;
const MIN_TARGET_REQUEST_TIMEOUT_MS = 100;
const MAX_TARGET_REQUEST_TIMEOUT_MS = 30_000;

interface HealthTargetResponse {
  ok?: boolean;
  databaseTarget?: DatabaseTarget;
  deploymentEnvironment?: string;
  databaseId?: string;
}

export interface SmokeTargetGuardOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function requiredExpectedValue(value: string | undefined, name: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function parseSmokeTargetRequestTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_TARGET_REQUEST_TIMEOUT_MS;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_TARGET_REQUEST_TIMEOUT_MS
    || parsed > MAX_TARGET_REQUEST_TIMEOUT_MS
  ) {
    throw new Error(
      `SMOKE_TARGET_REQUEST_TIMEOUT_MS must be an integer between ${MIN_TARGET_REQUEST_TIMEOUT_MS} and ${MAX_TARGET_REQUEST_TIMEOUT_MS}.`,
    );
  }
  return parsed;
}

export function validateSmokeTargetUrl(
  baseUrl: string,
  expectedHostnameValue: string | undefined,
): string {
  const expectedHostname = requiredExpectedValue(
    expectedHostnameValue,
    'SMOKE_EXPECT_API_HOSTNAME',
  ).toLowerCase();
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl ?? '').trim());
  } catch {
    throw new Error('API_BASE_URL must be an absolute URL.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('API_BASE_URL must not contain URL credentials.');
  }
  if (parsed.hostname.toLowerCase() !== expectedHostname) {
    throw new Error(
      `API_BASE_URL hostname does not match SMOKE_EXPECT_API_HOSTNAME (${expectedHostname}).`,
    );
  }
  const insecureLoopback = parsed.protocol === 'http:'
    && isLoopbackHostname(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !insecureLoopback) {
    throw new Error('API_BASE_URL must use HTTPS unless it targets an exact loopback hostname.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('API_BASE_URL must not contain a query string or fragment.');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

async function readTargetResponse(
  baseUrl: string,
  path: '/health' | '/readyz',
  operation: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<HealthTargetResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}`);
    }
    const body = await response.json() as unknown;
    if (typeof body !== 'object' || body === null || (body as HealthTargetResponse).ok !== true) {
      throw new Error(`${path} did not return a healthy JSON identity response`);
    }
    return body as HealthTargetResponse;
  } catch (error) {
    const detail = signal.aborted
      ? `${path} request timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : 'target lookup failed';
    throw new Error(`${operation} could not verify a safe database target: ${detail}.`);
  }
}

export function assertSafeDatabaseSmokeTarget(
  connectionString: string,
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = classifyDatabaseTarget(connectionString);
  const allowRemote = env.ALLOW_REMOTE_DATABASE_SMOKE === '1';
  let expectedEnvironment = env.SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT;
  if (target === 'remote') {
    // A direct database smoke has no API attestation, so require explicit operator identity confirmation.
    requiredExpectedValue(env.SMOKE_EXPECT_DATABASE_ID, 'SMOKE_EXPECT_DATABASE_ID');
    expectedEnvironment = requiredExpectedValue(
      expectedEnvironment,
      'SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT',
    ).toLowerCase();
  }
  assertSmokeDatabaseTarget(target, operation, {
    allowRemote,
    deploymentEnvironment: expectedEnvironment,
  });
}

export async function assertSafeSmokeTarget(
  baseUrl: string,
  operation: string,
  options: SmokeTargetGuardOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const expectedDatabaseId = requiredExpectedValue(
    env.SMOKE_EXPECT_DATABASE_ID,
    'SMOKE_EXPECT_DATABASE_ID',
  );
  const expectedEnvironment = requiredExpectedValue(
    env.SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT,
    'SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT',
  ).toLowerCase();
  if (expectedEnvironment === 'production' || expectedEnvironment === 'prod') {
    throw new Error(
      `${operation} refused the independently configured production target. Database smokes never permit production.`,
    );
  }

  const validatedBaseUrl = validateSmokeTargetUrl(baseUrl, env.SMOKE_EXPECT_API_HOSTNAME);
  const allowRemote = env.ALLOW_REMOTE_DATABASE_SMOKE === '1';
  if (!isLoopbackHostname(new URL(validatedBaseUrl).hostname.toLowerCase())) {
    // Do not contact a hosted target until the independent operator intent is safe.
    assertSmokeDatabaseTarget('remote', operation, {
      allowRemote,
      deploymentEnvironment: expectedEnvironment,
    });
  }
  const timeoutMs = parseSmokeTargetRequestTimeoutMs(env.SMOKE_TARGET_REQUEST_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const [health, readiness] = await Promise.all([
    readTargetResponse(validatedBaseUrl, '/health', operation, timeoutMs, fetchImpl),
    readTargetResponse(validatedBaseUrl, '/readyz', operation, timeoutMs, fetchImpl),
  ]);
  const target = health.databaseTarget ?? 'unknown';

  if (readiness.databaseTarget !== target) {
    throw new Error(`${operation} refused inconsistent database target metadata.`);
  }
  if (readiness.databaseId !== expectedDatabaseId) {
    throw new Error(
      `${operation} refused database identity mismatch: expected=${expectedDatabaseId}, actual=${readiness.databaseId ?? 'missing'}.`,
    );
  }
  const reportedEnvironment = String(readiness.deploymentEnvironment ?? '').trim().toLowerCase();
  if (reportedEnvironment !== expectedEnvironment) {
    throw new Error(
      `${operation} refused deployment environment mismatch: expected=${expectedEnvironment}, actual=${reportedEnvironment || 'missing'}.`,
    );
  }

  assertSmokeDatabaseTarget(target, operation, {
    allowRemote,
    // Safety is based on the operator's independent expectation, not the API's claim.
    deploymentEnvironment: expectedEnvironment,
  });
}
