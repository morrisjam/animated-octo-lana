'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const PRELOAD_PATH = path.resolve(__dirname, '..', 'preload.cjs');
const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const STEAM_TICKET = '00112233445566778899aabbccddeeff';
const API_ENDPOINT = 'https://api.gravitywell.space/auth/steam/exchange';

function loadPreloadHarness() {
  const invocations = [];
  let exposedApi = null;
  let mainWorldScript = null;
  const electronMock = {
    contextBridge: {
      exposeInMainWorld(key, api) {
        assert.equal(key, 'gravityWellSteam');
        exposedApi = api;
      },
      executeInMainWorld(script) {
        mainWorldScript = script;
      },
    },
    ipcRenderer: {
      async invoke(channel, payload) {
        invocations.push({ channel, payload });
        if (channel === 'gravity-well:steam:request-web-api-ticket') {
          return {
            schemaVersion: 'gw.steam-web-api-ticket.v1',
            ticketId: TICKET_ID,
            ticket: STEAM_TICKET.toUpperCase(),
            identity: payload,
          };
        }
        if (channel === 'gravity-well:steam:exchange-session') {
          return {
            schemaVersion: 'gw.steam-auth-http-response.v1',
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isAuthenticated: true }),
          };
        }
        if (channel === 'gravity-well:steam:cancel-web-api-ticket') {
          return true;
        }
        throw new Error(`Unexpected IPC channel: ${channel}`);
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function loadWithElectronMock(request, parent, isMain) {
    if (request === 'electron') {
      return electronMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[PRELOAD_PATH];
    require(PRELOAD_PATH);
  } finally {
    Module._load = originalLoad;
    delete require.cache[PRELOAD_PATH];
  }

  assert.ok(exposedApi);
  assert.ok(mainWorldScript);
  return { exposedApi, invocations, mainWorldScript };
}

function installMainWorldTransport(mainWorldScript, exposedApi) {
  const nativeFetchCalls = [];
  const runtime = {
    URL,
    Response,
    location: { href: 'file:///C:/GravityWell/web/index.html' },
    gravityWellSteam: exposedApi,
    async fetch(input, init) {
      nativeFetchCalls.push({ input, init });
      return new Response('{}', { status: 200 });
    },
  };
  mainWorldScript.func(...mainWorldScript.args, runtime);
  return { nativeFetchCalls, runtime };
}

test('routes the packaged Steam exchange through IPC without calling renderer fetch', async () => {
  const { exposedApi, invocations, mainWorldScript } = loadPreloadHarness();
  const lease = await exposedApi.requestWebApiTicket('gravity-well-api');
  const { nativeFetchCalls, runtime } = installMainWorldTransport(mainWorldScript, exposedApi);

  const response = await runtime.fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steamTicket: lease.ticket }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { isAuthenticated: true });
  assert.equal(nativeFetchCalls.length, 0);
  assert.deepEqual(invocations.at(-1), {
    channel: 'gravity-well:steam:exchange-session',
    payload: { endpoint: API_ENDPOINT, ticketId: TICKET_ID },
  });
  assert.equal(JSON.stringify(invocations.at(-1)).includes(STEAM_TICKET), false);
});

test('leaves non-auth web requests unchanged', async () => {
  const { exposedApi, mainWorldScript } = loadPreloadHarness();
  const { nativeFetchCalls, runtime } = installMainWorldTransport(mainWorldScript, exposedApi);

  await runtime.fetch('https://api.gravitywell.space/profile/me', { method: 'GET' });

  assert.equal(nativeFetchCalls.length, 1);
  assert.equal(nativeFetchCalls[0].input, 'https://api.gravitywell.space/profile/me');
});

test('fails closed when the exchange has no active native ticket lease', async () => {
  const { exposedApi, invocations, mainWorldScript } = loadPreloadHarness();
  const { nativeFetchCalls, runtime } = installMainWorldTransport(mainWorldScript, exposedApi);

  await assert.rejects(
    () => runtime.fetch(API_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ steamTicket: STEAM_TICKET }),
    }),
    /active native ticket lease/,
  );
  assert.equal(nativeFetchCalls.length, 0);
  assert.equal(invocations.some(({ channel }) => channel === 'gravity-well:steam:exchange-session'), false);
});

test('removes the renderer-to-handle mapping before native ticket cancellation', async () => {
  const { exposedApi } = loadPreloadHarness();
  const lease = await exposedApi.requestWebApiTicket('gravity-well-api');

  assert.equal(await exposedApi.cancelWebApiTicket(lease.ticketId), true);
  await assert.rejects(
    () => exposedApi.exchangeSteamSession(API_ENDPOINT, lease.ticket),
    /active native ticket lease/,
  );
});
