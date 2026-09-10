import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { checkPublicRelease, parsePublicReleaseCheckArgs } from './publicReleaseCheck';

const sha = 'a'.repeat(40);
const options = { expectedSha: sha, webOrigin: 'https://web.example', apiOrigin: 'https://api.example' };

test('CLI preserves explicit local origins in both option forms', () => {
  assert.deepEqual(parsePublicReleaseCheckArgs([
    '--expected-sha', sha, '--web-origin=http://127.0.0.1:4174', '--api-origin', 'http://localhost:8787',
  ]), { expectedSha: sha, webOrigin: 'http://127.0.0.1:4174', apiOrigin: 'http://localhost:8787' });
});

test('CLI rejects missing, duplicate, unknown and malformed options instead of falling back to production', () => {
  for (const tail of [
    ['--api-origin'], ['--web-origin'], ['--api-origin='], ['--web-origin', '--api-origin', 'http://localhost'],
    ['--api-url=http://localhost'], ['http://localhost'], ['--api-origin', ' '],
    ['--api-origin', 'http://localhost', '--api-origin', 'http://localhost'],
  ]) assert.throws(() => parsePublicReleaseCheckArgs(['--expected-sha', sha, ...tail]));
  assert.throws(() => parsePublicReleaseCheckArgs([]));
  assert.throws(() => parsePublicReleaseCheckArgs(['--expected-sha=abc']));
});
function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
function fake(web: () => Response, api: () => Response = () => json({ ok: true, releaseSha: sha })): typeof fetch {
  return (async (url: string | URL | Request) => String(url).endsWith('/release.json') ? web() : api()) as typeof fetch;
}

test('uses exactly two unauthenticated GETs and does not claim ruleset/database readiness', async () => {
  const calls: string[] = [];
  const report = await checkPublicRelease({ ...options, fetchImpl: (async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return String(url).endsWith('/health') ? json({ ok: true, releaseSha: sha }) : json({ schemaVersion: 'gw.web-release.v1', releaseSha: sha });
  }) as typeof fetch });
  assert.deepEqual(calls, ['https://web.example/release.json', 'https://api.example/health']);
  assert.equal(report.ok, true);
  assert.equal(report.rulesetCompatibility, 'not-verified');
  assert.equal(report.databaseReadiness, 'not-probed');
});

test('legacy health and stale web release fail rather than treating HTTP 200 as readiness', async () => {
  const report = await checkPublicRelease({ ...options,
    fetchImpl: fake(() => json({ schemaVersion: 'gw.web-release.v1', releaseSha: 'b'.repeat(40) }), () => json({ ok: true })) });
  assert.equal(report.ok, false);
  assert.equal(report.api.healthy, true);
  assert.equal(report.api.releaseSha, null);
  assert.match(report.issues.join('\n'), /Web serves/);
  assert.match(report.issues.join('\n'), /API release identity is unavailable/);
});

test('uncacheable metadata is required even when both SHAs match', async () => {
  const report = await checkPublicRelease({ ...options, fetchImpl: fake(() => json(
    { schemaVersion: 'gw.web-release.v1', releaseSha: sha }, { 'cache-control': 'public, max-age=3600' })) });
  assert.equal(report.ok, false);
  assert.match(report.issues.join('\n'), /freshness/);
});

for (const [name, response] of [
  ['HTML fallback', () => new Response('<html>game</html>', { headers: { 'content-type': 'text/html' } })],
  ['unknown schema', () => json({ schemaVersion: 'other', releaseSha: sha })],
  ['bad JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } })],
  ['oversized metadata', () => json({ pad: 'x'.repeat(65537) })],
  ['HTTP failure', () => new Response('', { status: 503 })],
] as const) {
  test(`${name} is a failed probe`, async () => {
    const report = await checkPublicRelease({ ...options, fetchImpl: fake(response) });
    assert.equal(report.ok, false);
    assert.notEqual(report.web.error, null);
  });
}

test('invalid targets and partial SHAs are rejected before any network call', async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return json({}); }) as typeof fetch;
  for (const invalid of ['http://public.example', 'https://user:pass@api.example', 'https://api.example/path', 'https://api.example?token=secret']) {
    await assert.rejects(checkPublicRelease({ ...options, apiOrigin: invalid, fetchImpl }));
  }
  await assert.rejects(checkPublicRelease({ ...options, expectedSha: 'abc123', fetchImpl }));
  for (const timeoutMs of [0, -1, 30001, 1.5, NaN]) {
    await assert.rejects(checkPublicRelease({ ...options, timeoutMs, fetchImpl }));
  }
  assert.equal(called, false);
});

for (const stall of ['headers', 'body'] as const) {
  test(`native fetch times out stalled ${stall} while still checking the other endpoint`, { timeout: 5000 }, async () => {
    const server = createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, releaseSha: sha }));
      } else if (stall === 'body') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.write('{');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await checkPublicRelease({ expectedSha: sha, webOrigin: origin, apiOrigin: origin, timeoutMs: 250 });
      assert.equal(report.ok, false);
      assert.notEqual(report.web.error, null);
      assert.equal(report.api.releaseSha, sha);
      assert.equal(report.api.error, null);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test('network failure still reports the other endpoint and exits unhealthy', async () => {
  const report = await checkPublicRelease({ ...options, fetchImpl: (async (url) => {
    if (String(url).endsWith('/health')) throw new Error('connection refused');
    return json({ schemaVersion: 'gw.web-release.v1', releaseSha: sha });
  }) as typeof fetch });
  assert.equal(report.ok, false);
  assert.equal(report.web.releaseSha, sha);
  assert.match(report.api.error!, /connection refused/);
});
