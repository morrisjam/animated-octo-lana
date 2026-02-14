import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashWebPassword,
  normaliseWebEmail,
  validateWebPassword,
  verifyWebPassword,
} from './webAuth';

test('normaliseWebEmail trims and lowercases valid email', () => {
  assert.equal(normaliseWebEmail('  PLAYER@Example.com  '), 'player@example.com');
});

test('normaliseWebEmail rejects invalid email format', () => {
  assert.equal(normaliseWebEmail('not-an-email'), null);
  assert.equal(normaliseWebEmail(''), null);
});

test('validateWebPassword enforces basic length policy', () => {
  assert.equal(validateWebPassword('short').ok, false);
  assert.equal(validateWebPassword('long_enough_password').ok, true);
});

test('hashWebPassword and verifyWebPassword round-trip', async () => {
  const record = await hashWebPassword('a_secure_password_123');
  assert.ok(record.hash.length > 0);
  assert.ok(record.salt.length > 0);
  assert.equal(await verifyWebPassword('a_secure_password_123', record), true);
  assert.equal(await verifyWebPassword('wrong_password', record), false);
});
