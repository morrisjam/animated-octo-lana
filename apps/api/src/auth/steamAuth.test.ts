import assert from 'node:assert/strict';
import test from 'node:test';
import { createSteamTicketVerifier } from './steamAuth';

const STEAM_ID = '76561198012345678';
const WEB_TICKET = '00112233445566778899aabbccddeeff';

test('accepts explicitly enabled development tickets without calling Steam', async () => {
  const fetchImpl = (() => {
    throw new Error('Steam API should not be called for a dev ticket');
  }) as unknown as typeof fetch;
  const verifier = createSteamTicketVerifier({ allowDevTickets: true, fetchImpl });

  assert.deepEqual(await verifier.verify(`dev-steam:${STEAM_ID}`), {
    ok: true,
    steamUserId: STEAM_ID,
  });
});

test('rejects development tickets unless explicitly enabled', async () => {
  const verifier = createSteamTicketVerifier();
  assert.deepEqual(await verifier.verify(`dev-steam:${STEAM_ID}`), {
    ok: false,
    code: 'invalid_ticket',
    error: 'Development Steam tickets are disabled.',
  });
});

test('verifies a web API ticket with Steam and returns its Steam ID', async () => {
  let requestedUrl: URL | null = null;
  let requestedInit: RequestInit | undefined;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = new URL(String(input));
    requestedInit = init;
    return {
      ok: true,
      async json() {
        return {
          response: {
            params: {
              result: 'OK',
              steamid: STEAM_ID,
            },
          },
        };
      },
    };
  }) as unknown as typeof fetch;
  const verifier = createSteamTicketVerifier({
    apiKey: 'publisher-secret',
    appId: '480',
    identity: 'gravity-well-api',
    fetchImpl,
  });

  assert.deepEqual(await verifier.verify(WEB_TICKET), { ok: true, steamUserId: STEAM_ID });
  assert.ok(requestedUrl);
  assert.equal(requestedUrl.protocol, 'https:');
  assert.equal(requestedUrl.searchParams.get('key'), 'publisher-secret');
  assert.equal(requestedUrl.searchParams.get('appid'), '480');
  assert.equal(requestedUrl.searchParams.get('ticket'), WEB_TICKET);
  assert.equal(requestedUrl.searchParams.get('identity'), 'gravity-well-api');
  assert.equal(requestedInit?.redirect, 'error');
  assert.equal(requestedInit?.credentials, 'omit');
  assert.equal(requestedInit?.cache, 'no-store');
});

test('surfaces Steam ticket rejection without accepting user-provided ids', async () => {
  const fetchImpl = (async () => ({
    ok: true,
    async json() {
      return {
        response: {
          error: {
            errorcode: 101,
            errordesc: 'Invalid ticket',
          },
        },
      };
    },
  })) as unknown as typeof fetch;
  const verifier = createSteamTicketVerifier({
    apiKey: 'publisher-secret',
    appId: 480,
    identity: 'gravity-well-api',
    fetchImpl,
  });

  assert.deepEqual(await verifier.verify(WEB_TICKET), {
    ok: false,
    code: 'invalid_ticket',
    error: 'Steam rejected the authentication ticket: Invalid ticket',
  });
  assert.equal((await verifier.verify(STEAM_ID)).ok, false);
});

test('rejects real tickets when server credentials are absent', async () => {
  const verifier = createSteamTicketVerifier();
  assert.deepEqual(await verifier.verify(WEB_TICKET), {
    ok: false,
    code: 'misconfigured',
    error: 'Steam ticket verification is not configured on the server.',
  });
});

test('fails closed before exposing credentials to non-Steam remote overrides', async () => {
  const fetchImpl = (() => {
    throw new Error('Untrusted Steam endpoint must not be called');
  }) as unknown as typeof fetch;
  for (const apiBase of [
    'http://example.com',
    'https://example.com',
    'https://partner.steam-api.com.example.com',
    'https://partner.steam-api.com:8443',
    'https://user@partner.steam-api.com',
    'https://partner.steam-api.com/custom-path',
  ]) {
    const verifier = createSteamTicketVerifier({
      apiKey: 'publisher-secret',
      appId: 480,
      identity: 'gravity-well-api',
      apiBase,
      fetchImpl,
    });

    assert.deepEqual(await verifier.verify(WEB_TICKET), {
      ok: false,
      code: 'misconfigured',
      error: 'Steam ticket verification endpoint must use the official Steam publisher API or loopback.',
    }, apiBase);
  }
});

test('permits an explicit loopback verifier for local integration only', async () => {
  let requestedUrl = '';
  const fetchImpl = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return {
      ok: true,
      async json() {
        return { response: { params: { result: 'OK', steamid: STEAM_ID } } };
      },
    };
  }) as unknown as typeof fetch;
  const verifier = createSteamTicketVerifier({
    apiKey: 'local-test-key',
    appId: 480,
    identity: 'gravity-well-api',
    apiBase: 'http://127.0.0.1:43210',
    fetchImpl,
  });

  assert.deepEqual(await verifier.verify(WEB_TICKET), { ok: true, steamUserId: STEAM_ID });
  assert.match(requestedUrl, /^http:\/\/127\.0\.0\.1:43210\/ISteamUserAuth\//);
});

test('aborts a stalled Steam verification request at the configured deadline', async () => {
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>(
    (_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    },
  )) as typeof fetch;
  const verifier = createSteamTicketVerifier({
    apiKey: 'publisher-secret',
    appId: 480,
    identity: 'gravity-well-api',
    timeoutMs: 10,
    fetchImpl,
  });

  assert.deepEqual(await verifier.verify(WEB_TICKET), {
    ok: false,
    code: 'unavailable',
    error: 'Steam ticket verification timed out.',
  });
});

test('treats an upstream HTTP failure as availability, not invalid credentials', async () => {
  const fetchImpl = (async () => ({
    ok: false,
    async json() {
      return { response: { error: { errordesc: 'Rate limit exceeded' } } };
    },
  })) as unknown as typeof fetch;
  const verifier = createSteamTicketVerifier({
    apiKey: 'publisher-secret',
    appId: 480,
    identity: 'gravity-well-api',
    fetchImpl,
  });

  assert.deepEqual(await verifier.verify(WEB_TICKET), {
    ok: false,
    code: 'unavailable',
    error: 'Steam ticket verification is temporarily unavailable.',
  });
});
