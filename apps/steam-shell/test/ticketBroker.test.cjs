'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SteamWebApiTicketBroker,
  TICKET_SCHEMA_VERSION,
  ticketBytesToHex,
} = require('../ticketBroker.cjs');

const IDENTITY = 'gravity-well-api';
const TICKET_ID = '11111111-1111-4111-8111-111111111111';

function createNativeTicket(bytes = Buffer.from('0011223344556677', 'hex')) {
  let cancelCount = 0;
  return {
    getBytes() {
      return bytes;
    },
    cancel() {
      cancelCount += 1;
    },
    get cancelCount() {
      return cancelCount;
    },
  };
}

test('acquires a callback-complete Steam ticket and retains its native handle until cancellation', async () => {
  const nativeTicket = createNativeTicket();
  const calls = [];
  const broker = new SteamWebApiTicketBroker({
    identity: IDENTITY,
    createTicketId: () => TICKET_ID,
    client: {
      auth: {
        async getAuthTicketForWebApi(identity, timeoutSeconds) {
          calls.push({ identity, timeoutSeconds });
          return nativeTicket;
        },
      },
    },
  });

  assert.deepEqual(await broker.acquire(IDENTITY), {
    schemaVersion: TICKET_SCHEMA_VERSION,
    ticketId: TICKET_ID,
    ticket: '0011223344556677',
    identity: IDENTITY,
  });
  assert.deepEqual(calls, [{ identity: IDENTITY, timeoutSeconds: 10 }]);
  assert.equal(nativeTicket.cancelCount, 0);
  assert.equal(broker.readTicket(TICKET_ID), '0011223344556677');
  assert.equal(broker.readTicket('../ticket'), null);
  assert.equal(broker.claimTicketForExchange(TICKET_ID), '0011223344556677');
  assert.equal(broker.claimTicketForExchange(TICKET_ID), null);
  assert.equal(broker.cancel(TICKET_ID), true);
  assert.equal(nativeTicket.cancelCount, 1);
  assert.equal(broker.readTicket(TICKET_ID), null);
  assert.equal(broker.cancel(TICKET_ID), false);
});

test('a new ticket request cancels an abandoned prior ticket', async () => {
  const first = createNativeTicket();
  const second = createNativeTicket(Buffer.from('8899aabbccddeeff', 'hex'));
  const queue = [first, second];
  let id = 0;
  const broker = new SteamWebApiTicketBroker({
    identity: IDENTITY,
    createTicketId: () => `11111111-1111-4111-8111-11111111111${id += 1}`,
    client: { auth: { async getAuthTicketForWebApi() { return queue.shift(); } } },
  });

  await broker.acquire(IDENTITY);
  await broker.acquire(IDENTITY);

  assert.equal(first.cancelCount, 1);
  assert.equal(second.cancelCount, 0);
  broker.cancelAll();
  assert.equal(second.cancelCount, 1);
});

test('rejects identity substitution before calling Steamworks', async () => {
  let calls = 0;
  const broker = new SteamWebApiTicketBroker({
    identity: IDENTITY,
    client: { auth: { async getAuthTicketForWebApi() { calls += 1; } } },
  });

  await assert.rejects(() => broker.acquire('other-api'), /does not match/);
  assert.equal(calls, 0);
});

test('cancels malformed native tickets during failed acquisition', async () => {
  const nativeTicket = createNativeTicket(Buffer.from('00', 'hex'));
  const broker = new SteamWebApiTicketBroker({
    identity: IDENTITY,
    client: { auth: { async getAuthTicketForWebApi() { return nativeTicket; } } },
  });

  await assert.rejects(() => broker.acquire(IDENTITY), /invalid Web API ticket payload/);
  assert.equal(nativeTicket.cancelCount, 1);
});

test('rejects a malformed generated handle and cancels the native ticket', async () => {
  const nativeTicket = createNativeTicket();
  const broker = new SteamWebApiTicketBroker({
    identity: IDENTITY,
    createTicketId: () => 'not-a-uuid',
    client: { auth: { async getAuthTicketForWebApi() { return nativeTicket; } } },
  });

  await assert.rejects(() => broker.acquire(IDENTITY), /handle id is invalid/);
  assert.equal(nativeTicket.cancelCount, 1);
});

test('hex conversion accepts byte arrays and enforces Steam ticket bounds', () => {
  assert.equal(ticketBytesToHex(new Uint8Array([0, 17, 34, 51, 68, 85, 102, 119])), '0011223344556677');
  assert.throws(() => ticketBytesToHex(Buffer.alloc(7)), /invalid Web API ticket payload/);
  assert.throws(() => ticketBytesToHex(Buffer.alloc(4097)), /invalid Web API ticket payload/);
});
