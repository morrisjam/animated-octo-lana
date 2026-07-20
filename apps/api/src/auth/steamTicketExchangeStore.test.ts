import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimSteamTicketExchange,
  SteamTicketAlreadyExchangedError,
  type SteamTicketExchangeDatabase,
} from './steamTicketExchangeStore';

const TICKET_DIGEST = 'a'.repeat(64);
const STEAM_USER_ID = '76561198012345678';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

test('claims a ticket fingerprint without persisting the raw Steam ticket', async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database: SteamTicketExchangeDatabase = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rowCount: 1, rows: [{ ticket_digest: TICKET_DIGEST }] };
    },
  };

  await claimSteamTicketExchange(database, {
    ticketDigest: TICKET_DIGEST,
    steamUserId: STEAM_USER_ID,
    accountId: ACCOUNT_ID,
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0]!.sql, /ON CONFLICT \(ticket_digest\) DO NOTHING/);
  assert.deepEqual(queries[0]!.values, [TICKET_DIGEST, STEAM_USER_ID, ACCOUNT_ID]);
  assert.equal(JSON.stringify(queries).includes('0011223344556677'), false);
});

test('rejects a durable duplicate claim as an already-exchanged ticket', async () => {
  const database: SteamTicketExchangeDatabase = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    claimSteamTicketExchange(database, {
      ticketDigest: TICKET_DIGEST,
      steamUserId: STEAM_USER_ID,
      accountId: ACCOUNT_ID,
    }),
    SteamTicketAlreadyExchangedError,
  );
});

test('rejects malformed claims before querying PostgreSQL', async () => {
  let queryCount = 0;
  const database: SteamTicketExchangeDatabase = {
    async query() {
      queryCount += 1;
      return { rowCount: 1, rows: [{}] };
    },
  };

  await assert.rejects(
    claimSteamTicketExchange(database, {
      ticketDigest: 'raw-ticket',
      steamUserId: STEAM_USER_ID,
      accountId: ACCOUNT_ID,
    }),
    /digest is invalid/,
  );
  assert.equal(queryCount, 0);
});
