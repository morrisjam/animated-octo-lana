import { describe, expect, test } from 'vitest';
import {
  createLocalRankedRootSmokeBuildAttestation,
  parseLocalRankedRootSmokeBuildAttestation,
} from './localRankedRootSmokeBuild';
import {
  createVisualAlphaLoopbackApiStub,
  resolveVisualAlphaLoopbackApiStubConfig,
  VISUAL_ALPHA_STUB_ACCOUNT_ID,
} from './visualAlphaLoopbackApiStub';

const CLIENT_ORIGIN = 'http://127.0.0.1:4173';

function createConfig(apiBaseUrl = 'http://127.0.0.1:8787') {
  return resolveVisualAlphaLoopbackApiStubConfig(createLocalRankedRootSmokeBuildAttestation({
    buildId: 'ci-ranked-root-smoke',
    apiBaseUrl,
  }));
}

describe('visual alpha loopback API stub', () => {
  test('parses the emitted build attestation and normalises an API path prefix', () => {
    const parsed = parseLocalRankedRootSmokeBuildAttestation({
      schemaVersion: 'gw.local-ranked-root-smoke-build.v1',
      enabled: true,
      buildId: ' ci-ranked-root-smoke ',
      apiBaseUrl: 'http://127.0.0.1:8787/api/',
    });

    expect(resolveVisualAlphaLoopbackApiStubConfig(parsed)).toEqual({
      buildId: 'ci-ranked-root-smoke',
      apiBaseUrl: 'http://127.0.0.1:8787/api',
      apiOrigin: 'http://127.0.0.1:8787',
      apiBasePathname: '/api',
    });
  });

  test.each([
    'https://127.0.0.1:8787',
    'http://localhost:8787',
    'http://api.example.test',
    'http://user:password@127.0.0.1:8787',
    'http://127.0.0.1:8787?unsafe=1',
  ])('rejects a non-exact loopback API base: %s', (apiBaseUrl) => {
    expect(() => createConfig(apiBaseUrl)).toThrow(/restricted to credential-free loopback HTTP URLs/);
  });

  test('serves authenticated account and stateful profile requests with CORS', () => {
    const config = createConfig();
    const stub = createVisualAlphaLoopbackApiStub(config, CLIENT_ORIGIN);
    const accountPreflight = stub.resolve({
      method: 'OPTIONS',
      url: `${config.apiBaseUrl}/accounts`,
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(accountPreflight?.status).toBe(204);
    expect(accountPreflight?.headers['access-control-allow-origin']).toBe(CLIENT_ORIGIN);

    const account = stub.resolve({
      method: 'POST',
      url: `${config.apiBaseUrl}/accounts`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(account?.status).toBe(201);
    const accountPayload = JSON.parse(account?.body ?? '{}') as Record<string, unknown>;
    expect(accountPayload.id).toBe(VISUAL_ALPHA_STUB_ACCOUNT_ID);
    const accessToken = String(accountPayload.accessToken);

    const update = stub.resolve({
      method: 'PUT',
      url: `${config.apiBaseUrl}/profile`,
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ displayName: 'Pilot', settings: { menuThemeId: 'rift' } }),
    });
    expect(update?.status).toBe(200);

    const profile = stub.resolve({
      method: 'GET',
      url: `${config.apiBaseUrl}/profile`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(JSON.parse(profile?.body ?? '{}')).toMatchObject({
      account_id: VISUAL_ALPHA_STUB_ACCOUNT_ID,
      display_name: 'Pilot',
      settings_json: { menuThemeId: 'rift' },
    });
    expect(stub.requests).toEqual([
      { method: 'OPTIONS', endpoint: '/accounts', status: 204 },
      { method: 'POST', endpoint: '/accounts', status: 201 },
      { method: 'PUT', endpoint: '/profile', status: 200 },
      { method: 'GET', endpoint: '/profile', status: 200 },
    ]);
  });

  test('fails closed for unknown routes and records invalid authentication', () => {
    const config = createConfig();
    const stub = createVisualAlphaLoopbackApiStub(config, CLIENT_ORIGIN);

    expect(stub.resolve({ method: 'GET', url: `${config.apiBaseUrl}/ranked/leaderboard` })).toBeNull();
    expect(stub.resolve({ method: 'DELETE', url: `${config.apiBaseUrl}/profile` })).toBeNull();
    expect(stub.resolve({
      method: 'GET',
      url: `${config.apiBaseUrl}/profile`,
      headers: { authorization: 'Bearer wrong-token' },
    })?.status).toBe(401);
    expect(stub.requests).toEqual([
      { method: 'GET', endpoint: '/profile', status: 401 },
    ]);
  });
});
