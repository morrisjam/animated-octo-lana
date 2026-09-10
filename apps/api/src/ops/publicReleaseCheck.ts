export interface PublicReleaseCheckOptions {
  webOrigin: string;
  apiOrigin: string;
  expectedSha: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface PublicProbe {
  url: string;
  status: number | null;
  releaseSha: string | null;
  cacheControl: string | null;
  healthy: boolean;
  error: string | null;
}

const EXACT_SHA = /^[a-f0-9]{40}$/i;

export function parsePublicReleaseCheckArgs(args: string[]): PublicReleaseCheckOptions {
  const values = new Map<string, string>();
  const allowed = new Set(['--expected-sha', '--web-origin', '--api-origin']);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const separator = token.indexOf('=');
    const name = separator < 0 ? token : token.slice(0, separator);
    if (!allowed.has(name) || values.has(name)) throw new Error(`Unknown or duplicate option: ${name}`);
    const value = separator < 0 ? args[++index] : token.slice(separator + 1);
    if (!value?.trim() || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    values.set(name, value);
  }
  const expectedSha = values.get('--expected-sha');
  if (!expectedSha || !EXACT_SHA.test(expectedSha)) throw new Error('Provide --expected-sha with a full 40-character Git SHA.');
  return {
    expectedSha,
    webOrigin: values.get('--web-origin') ?? 'https://play.gravitywell.space',
    apiOrigin: values.get('--api-origin') ?? 'https://api.gravitywell.space',
  };
}

function endpoint(origin: string, path: string): string {
  const url = new URL(origin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTPS origin without credentials, path, query, or fragment (HTTP is allowed only on loopback).');
  }
  return new URL(path, url).href;
}

async function probe(url: string, kind: 'web' | 'api', fetchImpl: typeof fetch, timeoutMs: number): Promise<PublicProbe> {
  const result: PublicProbe = { url, status: null, releaseSha: null, cacheControl: null, healthy: false, error: null };
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    result.status = response.status;
    result.cacheControl = response.headers.get('cache-control');
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel();
      throw new Error('Expected a JSON response, not a fallback page.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response.');
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new Error('Public metadata exceeds 64 KiB.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid metadata object.');
    if (kind === 'web' && body.schemaVersion !== 'gw.web-release.v1') throw new Error('Unsupported web release schema.');
    result.healthy = kind === 'web' || body.ok === true;
    if (typeof body.releaseSha === 'string' && EXACT_SHA.test(body.releaseSha)) result.releaseSha = body.releaseSha.toLowerCase();
    if (!result.healthy) result.error = 'API did not report healthy.';
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Probe failed.';
  }
  return result;
}

export async function checkPublicRelease(options: PublicReleaseCheckOptions) {
  if (!EXACT_SHA.test(options.expectedSha)) throw new Error('Expected release must be a full 40-character Git SHA.');
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Timeout must be 1-30000 ms.');
  // Validate both targets before making any request. Never probe /readyz,
  // account, matchmaking, or admin endpoints from this low-cost public check.
  const webUrl = endpoint(options.webOrigin, '/release.json');
  const apiUrl = endpoint(options.apiOrigin, '/health');
  const expectedSha = options.expectedSha.toLowerCase();
  const fetchImpl = options.fetchImpl ?? fetch;
  const web = await probe(webUrl, 'web', fetchImpl, timeoutMs);
  const api = await probe(apiUrl, 'api', fetchImpl, timeoutMs);
  const issues: string[] = [];
  for (const [name, item] of [['Web', web], ['API', api]] as const) {
    if (item.error) issues.push(`${name}: ${item.error}`);
    if (!item.releaseSha) issues.push(`${name} release identity is unavailable.`);
    else if (item.releaseSha !== expectedSha) issues.push(`${name} serves ${item.releaseSha}, expected ${expectedSha}.`);
  }
  if (!web.cacheControl?.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store')) {
    issues.push('Web release metadata lacks Cache-Control: no-store; freshness is not assured.');
  }
  return {
    schemaVersion: 'gw.public-release-check.v1', generatedAt: new Date().toISOString(),
    scope: 'public-release-identity-only', ok: issues.length === 0, expectedSha, web, api, issues,
    rulesetCompatibility: 'not-verified', databaseReadiness: 'not-probed',
    note: 'Matching public versions does not prove alpha readiness. Use the authenticated deployment gate before opening matchmaking.',
  };
}
