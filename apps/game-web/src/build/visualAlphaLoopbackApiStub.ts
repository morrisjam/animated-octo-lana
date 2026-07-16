import type { LocalRankedRootSmokeBuildAttestation } from './localRankedRootSmokeBuild';

export const VISUAL_ALPHA_STUB_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

const STUB_ACCESS_TOKEN = 'visual-alpha-loopback-access-token';
const STUB_CREATED_AT = '2026-01-01T00:00:00.000Z';
const STUB_ACCESS_TOKEN_EXPIRES_AT = '2099-01-01T00:00:00.000Z';
const ALLOWED_REQUEST_HEADERS = ['authorization', 'content-type', 'x-account-id'] as const;

export interface VisualAlphaLoopbackApiStubConfig {
  buildId: string;
  apiBaseUrl: string;
  apiOrigin: string;
  apiBasePathname: string;
}

export interface VisualAlphaLoopbackApiStubRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface VisualAlphaLoopbackApiStubResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface VisualAlphaLoopbackApiStubRequestRecord {
  method: string;
  endpoint: '/accounts' | '/profile';
  status: number;
}

export interface VisualAlphaLoopbackApiStub {
  requests: VisualAlphaLoopbackApiStubRequestRecord[];
  resolve(request: VisualAlphaLoopbackApiStubRequest): VisualAlphaLoopbackApiStubResponse | null;
}

interface StubProfile {
  displayName: string | null;
  settings: Record<string, unknown>;
  updatedAt: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonBody(body: string | null | undefined): Record<string, unknown> | null {
  if (!body) {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]';
}

function normaliseClientOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.protocol !== 'http:' || !isLoopbackHostname(parsed.hostname)) {
    throw new Error('Visual alpha API stub client origin must be an exact loopback HTTP origin.');
  }
  return parsed.origin;
}

function normaliseRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function jsonResponse(
  status: number,
  clientOrigin: string,
  payload: unknown,
): VisualAlphaLoopbackApiStubResponse {
  return {
    status,
    headers: {
      'access-control-allow-origin': clientOrigin,
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      vary: 'origin',
    },
    body: JSON.stringify(payload),
  };
}

function profilePayload(profile: StubProfile): Record<string, unknown> {
  return {
    account_id: VISUAL_ALPHA_STUB_ACCOUNT_ID,
    display_name: profile.displayName,
    settings_json: profile.settings,
    created_at: STUB_CREATED_AT,
    updated_at: profile.updatedAt,
  };
}

export function resolveVisualAlphaLoopbackApiStubConfig(
  attestation: LocalRankedRootSmokeBuildAttestation,
): VisualAlphaLoopbackApiStubConfig {
  let parsed: URL;
  try {
    parsed = new URL(attestation.apiBaseUrl);
  } catch {
    throw new Error('Local ranked-root smoke API base URL is invalid.');
  }
  if (
    parsed.protocol !== 'http:'
    || !isLoopbackHostname(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Visual alpha API stubbing is restricted to credential-free loopback HTTP URLs.');
  }
  const apiBasePathname = parsed.pathname.replace(/\/+$/, '');
  const apiBaseUrl = `${parsed.origin}${apiBasePathname}`;
  return {
    buildId: attestation.buildId,
    apiBaseUrl,
    apiOrigin: parsed.origin,
    apiBasePathname,
  };
}

export function createVisualAlphaLoopbackApiStub(
  config: VisualAlphaLoopbackApiStubConfig,
  clientOriginInput: string,
): VisualAlphaLoopbackApiStub {
  const clientOrigin = normaliseClientOrigin(clientOriginInput);
  const requests: VisualAlphaLoopbackApiStubRequestRecord[] = [];
  const profile: StubProfile = {
    displayName: null,
    settings: {},
    updatedAt: STUB_CREATED_AT,
  };

  function record(
    method: string,
    endpoint: '/accounts' | '/profile',
    response: VisualAlphaLoopbackApiStubResponse,
  ): VisualAlphaLoopbackApiStubResponse {
    requests.push({ method, endpoint, status: response.status });
    return response;
  }

  function resolve(request: VisualAlphaLoopbackApiStubRequest): VisualAlphaLoopbackApiStubResponse | null {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      return null;
    }
    if (parsed.origin !== config.apiOrigin || parsed.search || parsed.hash) {
      return null;
    }
    const accountsPath = `${config.apiBasePathname}/accounts` || '/accounts';
    const profilePath = `${config.apiBasePathname}/profile` || '/profile';
    const endpoint = parsed.pathname === accountsPath
      ? '/accounts'
      : parsed.pathname === profilePath
        ? '/profile'
        : null;
    if (!endpoint) {
      return null;
    }

    const method = request.method.trim().toUpperCase();
    const headers = normaliseRequestHeaders(request.headers);
    const allowedMethods = endpoint === '/accounts' ? ['POST'] : ['GET', 'PUT'];
    if (method === 'OPTIONS') {
      const requestedMethod = headers['access-control-request-method']?.trim().toUpperCase() ?? '';
      const requestedHeaders = (headers['access-control-request-headers'] ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const headersAllowed = requestedHeaders.every((header) => (
        ALLOWED_REQUEST_HEADERS.includes(header as typeof ALLOWED_REQUEST_HEADERS[number])
      ));
      if (!allowedMethods.includes(requestedMethod) || !headersAllowed) {
        return record(method, endpoint, jsonResponse(400, clientOrigin, { error: 'Invalid CORS preflight.' }));
      }
      return record(method, endpoint, {
        status: 204,
        headers: {
          'access-control-allow-headers': ALLOWED_REQUEST_HEADERS.join(', '),
          'access-control-allow-methods': [...allowedMethods, 'OPTIONS'].join(', '),
          'access-control-allow-origin': clientOrigin,
          'access-control-max-age': '600',
          'cache-control': 'no-store',
          vary: 'origin',
        },
      });
    }
    if (!allowedMethods.includes(method)) {
      return null;
    }

    if (endpoint === '/accounts') {
      const body = parseJsonBody(request.body);
      if (body?.status !== 'active') {
        return record(method, endpoint, jsonResponse(400, clientOrigin, { error: 'Invalid guest account request.' }));
      }
      return record(method, endpoint, jsonResponse(201, clientOrigin, {
        id: VISUAL_ALPHA_STUB_ACCOUNT_ID,
        status: 'active',
        created_at: STUB_CREATED_AT,
        updated_at: STUB_CREATED_AT,
        accessToken: STUB_ACCESS_TOKEN,
        accessTokenExpiresAt: STUB_ACCESS_TOKEN_EXPIRES_AT,
      }));
    }

    if (headers.authorization !== `Bearer ${STUB_ACCESS_TOKEN}`) {
      return record(method, endpoint, jsonResponse(401, clientOrigin, { error: 'Invalid test session.' }));
    }
    if (method === 'GET') {
      return record(method, endpoint, jsonResponse(200, clientOrigin, profilePayload(profile)));
    }

    const body = parseJsonBody(request.body);
    const displayName = body?.displayName;
    const settings = body?.settings;
    if (
      !body
      || (displayName !== null && displayName !== undefined && typeof displayName !== 'string')
      || (typeof displayName === 'string' && displayName.trim().length > 32)
      || !isPlainRecord(settings)
    ) {
      return record(method, endpoint, jsonResponse(400, clientOrigin, { error: 'Invalid profile update.' }));
    }
    profile.displayName = typeof displayName === 'string' ? displayName.trim() || null : null;
    profile.settings = settings;
    profile.updatedAt = STUB_CREATED_AT;
    return record(method, endpoint, jsonResponse(200, clientOrigin, profilePayload(profile)));
  }

  return { requests, resolve };
}
