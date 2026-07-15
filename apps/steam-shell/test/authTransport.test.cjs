'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_RESPONSE_BYTES,
  STEAM_AUTH_RESPONSE_SCHEMA_VERSION,
  SteamAuthHttpTransport,
  resolveSteamAuthEndpoint,
} = require('../authTransport.cjs');

const API_BASE = 'https://api.gravitywell.space';
const EXCHANGE_ENDPOINT = `${API_BASE}/auth/steam/exchange`;
const STEAM_TICKET = '00112233445566778899aabbccddeeff';

test('performs the Steam ticket exchange in the main-process transport', async () => {
  const calls = [];
  const transport = new SteamAuthHttpTransport({
    apiBase: API_BASE,
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        accountId: '11111111-1111-4111-8111-111111111111',
        isAuthenticated: true,
        accessToken: 'signed-session',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-internal-header': 'not-forwarded',
        },
      });
    },
  });

  const result = await transport.exchange(EXCHANGE_ENDPOINT, STEAM_TICKET.toUpperCase());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXCHANGE_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.body, JSON.stringify({ steamTicket: STEAM_TICKET }));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(result, {
    schemaVersion: STEAM_AUTH_RESPONSE_SCHEMA_VERSION,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      accountId: '11111111-1111-4111-8111-111111111111',
      isAuthenticated: true,
      accessToken: 'signed-session',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    }),
  });
});

test('preserves bounded API errors for the renderer without throwing a CORS-shaped failure', async () => {
  const transport = new SteamAuthHttpTransport({
    apiBase: API_BASE,
    async fetchImpl() {
      return new Response(JSON.stringify({
        error: 'steamTicket is invalid.',
        recovery: 'Retry Steam sign-in and submit a fresh ticket.',
      }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'retry-after': '2',
        },
      });
    },
  });

  const result = await transport.exchange(EXCHANGE_ENDPOINT, STEAM_TICKET);

  assert.equal(result.status, 401);
  assert.deepEqual(result.headers, {
    'content-type': 'application/json',
    'retry-after': '2',
  });
  assert.match(result.body, /Retry Steam sign-in/);
});

test('rejects endpoint substitution, query injection, malformed tickets, and non-HTTPS production APIs', async () => {
  let fetchCalls = 0;
  const transport = new SteamAuthHttpTransport({
    apiBase: API_BASE,
    async fetchImpl() {
      fetchCalls += 1;
      return new Response('{}');
    },
  });

  await assert.rejects(
    () => transport.exchange('https://attacker.example/auth/steam/exchange', STEAM_TICKET),
    /not allowed/,
  );
  await assert.rejects(
    () => transport.exchange(`${EXCHANGE_ENDPOINT}?redirect=attacker`, STEAM_TICKET),
    /not allowed/,
  );
  await assert.rejects(
    () => transport.exchange(EXCHANGE_ENDPOINT, 'not-hex'),
    /ticket is invalid/,
  );
  assert.throws(() => resolveSteamAuthEndpoint('http://api.gravitywell.space'), /must use HTTPS/);
  assert.equal(fetchCalls, 0);
});

test('allows explicit loopback HTTP only for local shell development', () => {
  assert.equal(
    resolveSteamAuthEndpoint('http://127.0.0.1:8787', { allowLoopbackHttp: true }),
    'http://127.0.0.1:8787/auth/steam/exchange',
  );
  assert.throws(
    () => resolveSteamAuthEndpoint('http://192.168.1.20:8787', { allowLoopbackHttp: true }),
    /must use HTTPS/,
  );
});

test('rejects oversized API responses before crossing IPC', async () => {
  const transport = new SteamAuthHttpTransport({
    apiBase: API_BASE,
    async fetchImpl() {
      return new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { status: 502 });
    },
  });

  await assert.rejects(
    () => transport.exchange(EXCHANGE_ENDPOINT, STEAM_TICKET),
    /exceeded the packaged client limit/,
  );
});
