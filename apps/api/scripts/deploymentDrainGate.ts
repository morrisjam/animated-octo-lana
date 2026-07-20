import { pathToFileURL } from 'node:url';

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const MIN_FETCH_TIMEOUT_MS = 100;
const MAX_FETCH_TIMEOUT_MS = 30_000;

interface MatchmakingRuntimeResponse {
  acceptingJoins?: boolean;
  draining?: boolean;
  activeSessions?: number;
  queuedTickets?: number;
  readyForProcessReplacement?: boolean;
  closedQueuedTickets?: number;
}

export interface DeploymentDrainGateRunOptions {
  env?: NodeJS.ProcessEnv;
  requestJson?: typeof fetchJson;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true' || value.trim() === '1';
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

export function validateApiBaseUrl(options: {
  value: string | undefined;
  expectedHostname: string | undefined;
  allowInsecureLoopback?: boolean;
}): string {
  const rawValue = String(options.value ?? '').trim();
  const expectedHostname = String(options.expectedHostname ?? '').trim().toLowerCase();
  if (!rawValue) {
    throw new Error('API_BASE_URL is required.');
  }
  if (!expectedHostname) {
    throw new Error('DEPLOY_EXPECT_API_HOSTNAME is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error('API_BASE_URL must be an absolute URL.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('API_BASE_URL must not contain URL credentials.');
  }
  if (parsed.hostname.toLowerCase() !== expectedHostname) {
    throw new Error(
      `API_BASE_URL hostname does not match DEPLOY_EXPECT_API_HOSTNAME (${expectedHostname}).`,
    );
  }
  const insecureLoopbackAllowed = options.allowInsecureLoopback === true
    && parsed.protocol === 'http:'
    && isLoopbackHostname(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !insecureLoopbackAllowed) {
    throw new Error('API_BASE_URL must use HTTPS.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('API_BASE_URL must not contain a query string or fragment.');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<{ status: number; body: MatchmakingRuntimeResponse | unknown }> {
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
      // Preserve non-JSON responses for the reported status.
    }
    return { status: response.status, body };
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Deployment gate request timed out after ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  }
}

export function validateResumeState(body: unknown): MatchmakingRuntimeResponse {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Matchmaking resume response must be a JSON object.');
  }
  const runtime = body as MatchmakingRuntimeResponse;
  if (runtime.draining !== false || runtime.acceptingJoins !== true) {
    throw new Error(
      'Matchmaking resume response did not confirm draining=false and acceptingJoins=true.',
    );
  }
  return runtime;
}

async function setDrainState(
  baseUrl: string,
  adminKey: string,
  draining: boolean,
  fetchTimeoutMs: number,
  requestJson: typeof fetchJson,
): Promise<{ status: number; body: MatchmakingRuntimeResponse | unknown }> {
  return await requestJson(`${baseUrl}/ops/matchmaking/drain`, fetchTimeoutMs, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: JSON.stringify({ draining }),
  });
}

async function resumeMatchmaking(
  baseUrl: string,
  adminKey: string,
  fetchTimeoutMs: number,
  requestJson: typeof fetchJson,
): Promise<MatchmakingRuntimeResponse> {
  const response = await setDrainState(baseUrl, adminKey, false, fetchTimeoutMs, requestJson);
  if (response.status !== 200) {
    throw new Error(`Failed to stop matchmaking drain: status=${response.status}`);
  }
  return validateResumeState(response.body);
}

export async function run(options: DeploymentDrainGateRunOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const requestJson = options.requestJson ?? fetchJson;
  const sleepFor = options.sleep ?? sleep;
  const now = options.now ?? Date.now;
  const allowInsecureLoopback = parseBoolean(env.DEPLOY_ALLOW_INSECURE_LOCALHOST);
  const baseUrl = validateApiBaseUrl({
    value: env.API_BASE_URL,
    expectedHostname: env.DEPLOY_EXPECT_API_HOSTNAME,
    allowInsecureLoopback,
  });
  const fetchTimeoutMs = parseFetchTimeoutMs(env.DEPLOY_FETCH_TIMEOUT_MS);
  const adminKey = String(env.API_OPS_ADMIN_KEY ?? env.API_SLO_ADMIN_KEY ?? '').trim();
  const allowLegacyBypass = parseBoolean(env.DEPLOY_ALLOW_LEGACY_NO_DRAIN);
  const resumeOnDrainFailure = parseBoolean(env.DEPLOY_RESUME_ON_DRAIN_FAILURE);
  const action = String(env.DEPLOY_DRAIN_ACTION ?? 'drain').trim().toLowerCase();
  const draining = action !== 'resume';
  if (!adminKey) {
    if (allowLegacyBypass) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: 'missing_admin_key', baseUrl }, null, 2));
      return;
    }
    throw new Error('API_OPS_ADMIN_KEY or API_SLO_ADMIN_KEY is required for the matchmaking drain gate.');
  }

  if (!draining) {
    const response = await setDrainState(baseUrl, adminKey, false, fetchTimeoutMs, requestJson);
    if ((response.status === 404 || response.status === 501) && allowLegacyBypass) {
      console.log(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'legacy_api_without_drain_endpoint',
        status: response.status,
        baseUrl,
      }, null, 2));
      return;
    }
    if (response.status !== 200) {
      throw new Error(`Failed to stop matchmaking drain: status=${response.status}`);
    }
    const runtime = validateResumeState(response.body);
    console.log(JSON.stringify({ ok: true, action: 'resume', baseUrl, runtime }, null, 2));
    return;
  }

  try {
    const initial = await setDrainState(baseUrl, adminKey, true, fetchTimeoutMs, requestJson);
    if ((initial.status === 404 || initial.status === 501) && allowLegacyBypass) {
      console.log(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'legacy_api_without_drain_endpoint',
        status: initial.status,
        baseUrl,
      }, null, 2));
      return;
    }
    if (initial.status !== 200) {
      throw new Error(`Failed to start matchmaking drain: status=${initial.status}`);
    }

    const timeoutSeconds = parsePositiveInteger(env.DEPLOY_DRAIN_TIMEOUT_SECONDS, 180);
    const pollIntervalMs = parsePositiveInteger(env.DEPLOY_DRAIN_POLL_INTERVAL_MS, 2_000);
    const deadline = now() + timeoutSeconds * 1000;
    let latest = initial.body as MatchmakingRuntimeResponse;
    while (now() <= deadline) {
      if (latest.readyForProcessReplacement === true && latest.draining === true) {
        console.log(JSON.stringify({
          ok: true,
          action: 'drain',
          baseUrl,
          timeoutSeconds,
          runtime: latest,
        }, null, 2));
        return;
      }
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        break;
      }
      await sleepFor(Math.min(pollIntervalMs, remainingMs));
      const runtime = await requestJson(
        `${baseUrl}/ops/matchmaking/runtime`,
        Math.max(1, Math.min(fetchTimeoutMs, deadline - now())),
        { headers: { 'x-admin-key': adminKey } },
      );
      if (runtime.status !== 200) {
        throw new Error(`Failed to poll matchmaking drain state: status=${runtime.status}`);
      }
      latest = runtime.body as MatchmakingRuntimeResponse;
    }

    throw new Error(
      `Matchmaking drain timed out after ${timeoutSeconds}s `
      + `(queued=${latest.queuedTickets ?? 'unknown'}, active=${latest.activeSessions ?? 'unknown'}).`,
    );
  } catch (error) {
    // Only callers that still trust the old release may opt into reopening after a failed drain.
    if (resumeOnDrainFailure) {
      await resumeMatchmaking(baseUrl, adminKey, fetchTimeoutMs, requestJson).catch(() => undefined);
    }
    throw error;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
