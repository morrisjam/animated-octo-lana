import assert from 'node:assert/strict';
import test from 'node:test';
import {
  logIdentityLinkEvent,
  mergeAccountIntoTarget,
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
    assert.equal(this.steps.length, 0, `Expected all scripted queries to be consumed, pending: ${this.steps.length}`);
  }
}

function findCalls(client: ScriptedSqlClient, contains: string): Array<{ text: string; values: unknown[] | undefined }> {
  return client.calls.filter((call) => call.text.includes(contains));
}

test('logIdentityLinkEvent writes audit row with metadata json', async () => {
  const client = new ScriptedSqlClient([
    { contains: 'INSERT INTO identity_link_events' },
  ]);
  await logIdentityLinkEvent(client, {
    accountId: '11111111-1111-4111-8111-111111111111',
    provider: 'steam',
    providerUserId: '76561198012345678',
    eventType: 'linked',
    actor: 'system',
    metadata: { reason: 'steam_first_signin_create_account' },
  });
  client.assertComplete();
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].values?.[0], '11111111-1111-4111-8111-111111111111');
  assert.equal(client.calls[0].values?.[1], 'steam');
  assert.equal(client.calls[0].values?.[2], '76561198012345678');
  assert.equal(client.calls[0].values?.[3], 'linked');
  assert.equal(client.calls[0].values?.[4], 'system');
  assert.equal(client.calls[0].values?.[5], JSON.stringify({ reason: 'steam_first_signin_create_account' }));
});

test('mergeAccountIntoTarget transfers web identity, credentials, and profile when safe', async () => {
  const sourceAccountId = '11111111-1111-4111-8111-111111111111';
  const targetAccountId = '22222222-2222-4222-8222-222222222222';
  const actorAccountId = '33333333-3333-4333-8333-333333333333';

  const client = new ScriptedSqlClient([
    { contains: 'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ id: sourceAccountId, status: 'active' }] },
    { contains: 'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ id: targetAccountId, status: 'active' }] },
    { contains: `SELECT 1 FROM identities WHERE account_id = $1 AND provider = 'web' LIMIT 1`, rowCount: 0, rows: [] },
    { contains: 'SELECT id, provider_user_id', rowCount: 1, rows: [{ id: 41, provider_user_id: 'web_user_1' }] },
    { contains: 'UPDATE identities SET account_id = $1 WHERE id = $2' },
    { contains: 'INSERT INTO identity_link_events' },
    { contains: 'SELECT id, provider, provider_user_id', rowCount: 0, rows: [] },
    { contains: 'SELECT 1 FROM web_auth_credentials WHERE account_id = $1 LIMIT 1', rowCount: 0, rows: [] },
    { contains: 'SELECT account_id FROM web_auth_credentials WHERE account_id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ account_id: sourceAccountId }] },
    { contains: 'UPDATE web_auth_credentials SET account_id = $1 WHERE account_id = $2' },
    { contains: 'SELECT display_name, settings_json FROM profiles WHERE account_id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ display_name: 'Source', settings_json: { input: 'legacy' } }] },
    { contains: 'SELECT account_id, display_name, settings_json FROM profiles WHERE account_id = $1 LIMIT 1 FOR UPDATE', rowCount: 0, rows: [] },
    { contains: 'UPDATE profiles SET account_id = $1 WHERE account_id = $2' },
    { contains: 'UPDATE accounts' },
    { contains: 'INSERT INTO account_merge_events' },
  ]);

  const result = await mergeAccountIntoTarget(client, sourceAccountId, targetAccountId, actorAccountId);
  client.assertComplete();

  assert.deepEqual(result, {
    merged: true,
    transferredWebIdentity: true,
    transferredWebCredential: true,
    mergedProfile: true,
  });

  const identityEventCalls = findCalls(client, 'INSERT INTO identity_link_events');
  assert.equal(identityEventCalls.length, 1);
  const identityValues = identityEventCalls[0].values ?? [];
  assert.equal(identityValues[0], targetAccountId);
  assert.equal(identityValues[1], 'web');
  assert.equal(identityValues[3], 'linked');
  assert.equal(identityValues[4], actorAccountId);
  assert.equal(
    identityValues[5],
    JSON.stringify({
      reason: 'merge_transfer_web_identity',
      sourceAccountId,
    }),
  );

  const mergeEventCalls = findCalls(client, 'INSERT INTO account_merge_events');
  assert.equal(mergeEventCalls.length, 1);
  const mergeValues = mergeEventCalls[0].values ?? [];
  assert.equal(mergeValues[0], sourceAccountId);
  assert.equal(mergeValues[1], targetAccountId);
  assert.equal(mergeValues[2], actorAccountId);
  assert.equal(mergeValues[3], 'steam_link_merge');
  assert.equal(
    mergeValues[4],
    JSON.stringify({
      transferredWebIdentity: true,
      transferredWebCredential: true,
      mergedProfile: true,
    }),
  );
});

test('mergeAccountIntoTarget discards duplicate source identities and records unlink audit events', async () => {
  const sourceAccountId = '11111111-1111-4111-8111-111111111111';
  const targetAccountId = '22222222-2222-4222-8222-222222222222';

  const client = new ScriptedSqlClient([
    { contains: 'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ id: sourceAccountId, status: 'active' }] },
    { contains: 'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ id: targetAccountId, status: 'active' }] },
    { contains: `SELECT 1 FROM identities WHERE account_id = $1 AND provider = 'web' LIMIT 1`, rowCount: 1, rows: [{ exists: 1 }] },
    { contains: 'SELECT id, provider_user_id', rowCount: 1, rows: [{ id: 51, provider_user_id: 'web_user_2' }] },
    { contains: 'DELETE FROM identities WHERE id = $1' },
    { contains: 'INSERT INTO identity_link_events' },
    { contains: 'SELECT id, provider, provider_user_id', rowCount: 1, rows: [{ id: 52, provider: 'steam', provider_user_id: '76561198099999999' }] },
    { contains: 'DELETE FROM identities WHERE id = $1' },
    { contains: 'INSERT INTO identity_link_events' },
    { contains: 'SELECT 1 FROM web_auth_credentials WHERE account_id = $1 LIMIT 1', rowCount: 1, rows: [{ exists: 1 }] },
    { contains: 'SELECT account_id FROM web_auth_credentials WHERE account_id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ account_id: sourceAccountId }] },
    { contains: 'DELETE FROM web_auth_credentials WHERE account_id = $1' },
    { contains: 'SELECT display_name, settings_json FROM profiles WHERE account_id = $1 LIMIT 1 FOR UPDATE', rowCount: 0, rows: [] },
    { contains: 'UPDATE accounts' },
    { contains: 'INSERT INTO account_merge_events' },
  ]);

  const result = await mergeAccountIntoTarget(client, sourceAccountId, targetAccountId, null);
  client.assertComplete();

  assert.deepEqual(result, {
    merged: true,
    transferredWebIdentity: false,
    transferredWebCredential: false,
    mergedProfile: false,
  });

  const identityEventCalls = findCalls(client, 'INSERT INTO identity_link_events');
  assert.equal(identityEventCalls.length, 2);
  const firstMetadata = (identityEventCalls[0].values?.[5] as string) ?? '';
  const secondMetadata = (identityEventCalls[1].values?.[5] as string) ?? '';
  assert.ok(firstMetadata.includes('merge_discard_duplicate_web_identity'));
  assert.ok(secondMetadata.includes('merge_discard_non_web_identity'));
  assert.ok(secondMetadata.includes(targetAccountId));

  const mergeEventCalls = findCalls(client, 'INSERT INTO account_merge_events');
  assert.equal(mergeEventCalls.length, 1);
  const mergeMetadata = (mergeEventCalls[0].values?.[4] as string) ?? '';
  assert.equal(
    mergeMetadata,
    JSON.stringify({
      transferredWebIdentity: false,
      transferredWebCredential: false,
      mergedProfile: false,
    }),
  );
});

test('mergeAccountIntoTarget fails safely for missing or disabled source account', async () => {
  const missingSource = new ScriptedSqlClient([
    { contains: 'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE', rowCount: 0, rows: [] },
  ]);
  await assert.rejects(
    mergeAccountIntoTarget(
      missingSource,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      null,
    ),
    { message: 'Merge source account not found.' },
  );
  missingSource.assertComplete();

  const disabledSource = new ScriptedSqlClient([
    { contains: 'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE', rowCount: 1, rows: [{ id: '11111111-1111-4111-8111-111111111111', status: 'disabled' }] },
  ]);
  await assert.rejects(
    mergeAccountIntoTarget(
      disabledSource,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      null,
    ),
    { message: 'Merge source account is disabled.' },
  );
  disabledSource.assertComplete();
});

test('mergeAccountIntoTarget is a no-op when source and target are the same account', async () => {
  const client = new ScriptedSqlClient([]);
  const accountId = '11111111-1111-4111-8111-111111111111';
  const result = await mergeAccountIntoTarget(client, accountId, accountId, null);
  client.assertComplete();
  assert.deepEqual(result, {
    merged: false,
    transferredWebIdentity: false,
    transferredWebCredential: false,
    mergedProfile: false,
  });
  assert.equal(client.calls.length, 0);
});
