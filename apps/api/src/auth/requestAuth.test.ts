import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAccountAuthorizationStatus,
  resolveAuthenticatedAccountId,
} from './requestAuth';
import { createAuthSessionTokenService } from './sessionToken';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const SPOOFED_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const service = createAuthSessionTokenService({
  secret: 'request-auth-test-secret-with-at-least-32-characters',
});

test('resolves account identity from a valid bearer token', () => {
  const token = service.issue(ACCOUNT_ID, 'web');
  assert.equal(resolveAuthenticatedAccountId(
    { authorization: `Bearer ${token.accessToken}` },
    service,
    false,
  ), ACCOUNT_ID);
});

test('never falls through from an invalid bearer token to an insecure header', () => {
  assert.equal(resolveAuthenticatedAccountId(
    {
      authorization: 'Bearer invalid-token',
      'x-account-id': SPOOFED_ACCOUNT_ID,
    },
    service,
    true,
  ), null);
});

test('accepts x-account-id only when the local compatibility flag is enabled', () => {
  assert.equal(resolveAuthenticatedAccountId(
    { 'x-account-id': ACCOUNT_ID },
    service,
    false,
  ), null);
  assert.equal(resolveAuthenticatedAccountId(
    { 'x-account-id': ACCOUNT_ID },
    service,
    true,
  ), ACCOUNT_ID);
});

test('authorizes only active account records', async () => {
  const database = {
    async query(_text: string, values: readonly unknown[]) {
      assert.deepEqual(values, [ACCOUNT_ID]);
      return { rowCount: 1, rows: [{ status: 'active' }] };
    },
  };
  assert.equal(await resolveAccountAuthorizationStatus(database, ACCOUNT_ID), 'active');

  assert.equal(await resolveAccountAuthorizationStatus({
    async query() {
      return { rowCount: 1, rows: [{ status: 'merged' }] };
    },
  }, ACCOUNT_ID), 'disabled');

  assert.equal(await resolveAccountAuthorizationStatus({
    async query() {
      return { rowCount: 0, rows: [] };
    },
  }, ACCOUNT_ID), 'missing');
});
