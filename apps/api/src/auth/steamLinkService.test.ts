import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SteamAccountLinkError,
  logIdentityLinkEvent,
  resolveSteamAccountLink,
  type SqlClient,
} from './steamLinkService';

interface QueryStep {
  contains: string;
  rowCount?: number | null;
  rows?: unknown[];
}

class ScriptedSqlClient implements SqlClient {
  public readonly calls: Array<{ text: string; values: unknown[] | undefined }> = [];

  public constructor(private readonly steps: QueryStep[]) {}

  async query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: unknown[] }> {
    this.calls.push({ text, values });
    const next = this.steps.shift();
    assert.ok(next, `Unexpected query: ${text}`);
    assert.ok(
      text.includes(next.contains),
      `Expected query containing "${next.contains}" but received:\n${text}`,
    );
    return {
      rowCount: next.rowCount ?? 0,
      rows: next.rows ?? [],
    };
  }

  assertComplete(): void {
    assert.equal(this.steps.length, 0, `Pending scripted queries: ${this.steps.length}`);
  }
}

const webAccountId = '11111111-1111-4111-8111-111111111111';
const steamAccountId = '22222222-2222-4222-8222-222222222222';
const steamUserId = '76561198012345678';

test('logIdentityLinkEvent writes an auditable metadata payload', async () => {
  const client = new ScriptedSqlClient([{ contains: 'INSERT INTO identity_link_events' }]);
  await logIdentityLinkEvent(client, {
    accountId: webAccountId,
    provider: 'steam',
    providerUserId: steamUserId,
    eventType: 'linked',
    actor: webAccountId,
    metadata: { reason: 'explicit_authenticated_steam_link' },
  });
  client.assertComplete();
  assert.deepEqual(client.calls[0].values, [
    webAccountId,
    'steam',
    steamUserId,
    'linked',
    webAccountId,
    JSON.stringify({ reason: 'explicit_authenticated_steam_link' }),
  ]);
});

test('first Steam sign-in creates an account and links its verified identity', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'pg_advisory_xact_lock' },
    { contains: "WHERE i.provider = 'steam'", rowCount: 0 },
    { contains: 'INSERT INTO accounts', rowCount: 1, rows: [{ id: steamAccountId }] },
    { contains: 'INSERT INTO identities' },
    { contains: 'INSERT INTO identity_link_events' },
  ]);

  const result = await resolveSteamAccountLink(client, {
    steamUserId,
    authenticatedAccountId: null,
    linkToAuthenticatedAccount: false,
  });

  client.assertComplete();
  assert.deepEqual(result, {
    accountId: steamAccountId,
    createdAccount: true,
    linkedToExistingAccount: false,
    identityAlreadyLinked: false,
  });
  assert.deepEqual(client.calls[3].values, [steamAccountId, steamUserId]);
  assert.equal(
    client.calls[4].values?.[5],
    JSON.stringify({ reason: 'steam_first_signin_create_account' }),
  );
});

test('explicit linking preserves the authenticated account and adds only the Steam identity', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'pg_advisory_xact_lock' },
    { contains: "WHERE i.provider = 'steam'", rowCount: 0 },
    { contains: 'SELECT id, status FROM accounts', rowCount: 1, rows: [{ id: webAccountId, status: 'active' }] },
    { contains: "WHERE account_id = $1 AND provider = 'steam'", rowCount: 0 },
    { contains: 'INSERT INTO identities' },
    { contains: 'INSERT INTO identity_link_events' },
  ]);

  const result = await resolveSteamAccountLink(client, {
    steamUserId,
    authenticatedAccountId: webAccountId,
    linkToAuthenticatedAccount: true,
  });

  client.assertComplete();
  assert.deepEqual(result, {
    accountId: webAccountId,
    createdAccount: false,
    linkedToExistingAccount: true,
    identityAlreadyLinked: false,
  });
  assert.equal(client.calls.some((call) => call.text.includes('UPDATE accounts')), false);
  assert.equal(client.calls.some((call) => call.text.includes('DELETE FROM')), false);
  assert.deepEqual(client.calls[4].values, [webAccountId, steamUserId]);
  assert.equal(
    client.calls[5].values?.[5],
    JSON.stringify({ reason: 'explicit_authenticated_steam_link' }),
  );
});

test('existing Steam sign-in is idempotent and creates no account mutations', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'pg_advisory_xact_lock' },
    {
      contains: "WHERE i.provider = 'steam'",
      rowCount: 1,
      rows: [{ account_id: steamAccountId, status: 'active' }],
    },
  ]);

  const result = await resolveSteamAccountLink(client, {
    steamUserId,
    authenticatedAccountId: null,
    linkToAuthenticatedAccount: false,
  });

  client.assertComplete();
  assert.deepEqual(result, {
    accountId: steamAccountId,
    createdAccount: false,
    linkedToExistingAccount: false,
    identityAlreadyLinked: true,
  });
  assert.equal(client.calls.length, 2);
});

test('same-account explicit link is idempotent', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'pg_advisory_xact_lock' },
    {
      contains: "WHERE i.provider = 'steam'",
      rowCount: 1,
      rows: [{ account_id: webAccountId, status: 'active' }],
    },
  ]);

  const result = await resolveSteamAccountLink(client, {
    steamUserId,
    authenticatedAccountId: webAccountId,
    linkToAuthenticatedAccount: true,
  });

  client.assertComplete();
  assert.equal(result.accountId, webAccountId);
  assert.equal(result.identityAlreadyLinked, true);
});

test('cross-account explicit linking fails before any mutation', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'pg_advisory_xact_lock' },
    {
      contains: "WHERE i.provider = 'steam'",
      rowCount: 1,
      rows: [{ account_id: steamAccountId, status: 'active' }],
    },
  ]);

  await assert.rejects(
    resolveSteamAccountLink(client, {
      steamUserId,
      authenticatedAccountId: webAccountId,
      linkToAuthenticatedAccount: true,
    }),
    (error: unknown) => error instanceof SteamAccountLinkError
      && error.code === 'steam_identity_already_linked',
  );
  client.assertComplete();
  assert.equal(client.calls.length, 2);
});

test('explicit linking requires authentication before querying the database', async () => {
  const client = new ScriptedSqlClient([]);
  await assert.rejects(
    resolveSteamAccountLink(client, {
      steamUserId,
      authenticatedAccountId: null,
      linkToAuthenticatedAccount: true,
    }),
    (error: unknown) => error instanceof SteamAccountLinkError
      && error.code === 'steam_link_authentication_required',
  );
  client.assertComplete();
  assert.equal(client.calls.length, 0);
});

test('disabled or missing targets fail without identity mutation', async () => {
  for (const scenario of [
    { rowCount: 0, rows: [], code: 'steam_link_target_not_found' },
    {
      rowCount: 1,
      rows: [{ id: webAccountId, status: 'disabled' }],
      code: 'steam_link_target_disabled',
    },
  ] as const) {
    const client = new ScriptedSqlClient([
      { contains: 'pg_advisory_xact_lock' },
      { contains: "WHERE i.provider = 'steam'", rowCount: 0 },
      {
        contains: 'SELECT id, status FROM accounts',
        rowCount: scenario.rowCount,
        rows: [...scenario.rows],
      },
    ]);
    await assert.rejects(
      resolveSteamAccountLink(client, {
        steamUserId,
        authenticatedAccountId: webAccountId,
        linkToAuthenticatedAccount: true,
      }),
      (error: unknown) => error instanceof SteamAccountLinkError
        && error.code === scenario.code,
    );
    client.assertComplete();
    assert.equal(client.calls.length, 3);
  }
});

test('an account with a different Steam identity cannot be overwritten', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'pg_advisory_xact_lock' },
    { contains: "WHERE i.provider = 'steam'", rowCount: 0 },
    { contains: 'SELECT id, status FROM accounts', rowCount: 1, rows: [{ id: webAccountId, status: 'active' }] },
    {
      contains: "WHERE account_id = $1 AND provider = 'steam'",
      rowCount: 1,
      rows: [{ provider_user_id: '76561198099999999' }],
    },
  ]);

  await assert.rejects(
    resolveSteamAccountLink(client, {
      steamUserId,
      authenticatedAccountId: webAccountId,
      linkToAuthenticatedAccount: true,
    }),
    (error: unknown) => error instanceof SteamAccountLinkError
      && error.code === 'steam_link_target_already_has_identity',
  );
  client.assertComplete();
  assert.equal(client.calls.length, 4);
});
