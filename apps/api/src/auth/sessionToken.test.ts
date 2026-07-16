import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthSessionTokenService } from './sessionToken';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'test-only-auth-session-secret-at-least-32-characters';
const PREVIOUS_SECRET = 'previous-test-session-secret-at-least-32-characters';

test('issues and verifies a signed auth session token', () => {
  const service = createAuthSessionTokenService({
    secret: SECRET,
    ttlSeconds: 300,
    now: () => 1_000_000,
  });

  const issued = service.issue(ACCOUNT_ID, 'web');
  const verified = service.verify(issued.accessToken);

  assert.equal(issued.tokenType, 'Bearer');
  assert.equal(verified.ok, true);
  if (!verified.ok) {
    throw new Error('Expected token to verify');
  }
  assert.equal(verified.payload.accountId, ACCOUNT_ID);
  assert.equal(verified.payload.provider, 'web');
  assert.equal(verified.payload.expiresAt - verified.payload.issuedAt, 300);
});

test('rejects tampered and cross-secret tokens', () => {
  const service = createAuthSessionTokenService({ secret: SECRET });
  const otherService = createAuthSessionTokenService({
    secret: 'different-test-session-secret-at-least-32-characters',
  });
  const issued = service.issue(ACCOUNT_ID, 'steam');
  const [prefix, payload, encodedSignature] = issued.accessToken.split('.');
  assert.ok(prefix && payload && encodedSignature);
  const signature = Buffer.from(encodedSignature, 'base64url');
  signature[0] = (signature[0] ?? 0) ^ 1;
  const tampered = `${prefix}.${payload}.${signature.toString('base64url')}`;

  assert.equal(service.verify(tampered).ok, false);
  assert.equal(otherService.verify(issued.accessToken).ok, false);
});

test('rejects expired tokens', () => {
  let nowMs = 2_000_000;
  const service = createAuthSessionTokenService({
    secret: SECRET,
    ttlSeconds: 60,
    now: () => nowMs,
  });
  const issued = service.issue(ACCOUNT_ID, 'guest');

  nowMs += 60_000;
  const verified = service.verify(issued.accessToken);
  assert.deepEqual(verified, { ok: false, code: 'expired' });
});

test('accepts old tokens during a bounded key-rotation overlap while signing with the new key', () => {
  const previousService = createAuthSessionTokenService({ secret: PREVIOUS_SECRET });
  const previousToken = previousService.issue(ACCOUNT_ID, 'steam').accessToken;
  const rotatingService = createAuthSessionTokenService({
    secret: SECRET,
    previousSecrets: [PREVIOUS_SECRET],
  });
  const currentToken = rotatingService.issue(ACCOUNT_ID, 'steam').accessToken;

  assert.equal(rotatingService.verify(previousToken).ok, true);
  assert.equal(rotatingService.verify(currentToken).ok, true);
  assert.equal(previousService.verify(currentToken).ok, false);

  const cutoverService = createAuthSessionTokenService({ secret: SECRET });
  assert.deepEqual(cutoverService.verify(previousToken), { ok: false, code: 'invalid_signature' });
  assert.equal(cutoverService.verify(currentToken).ok, true);
});

test('rejects weak, duplicate, or unbounded previous session secrets', () => {
  assert.throws(
    () => createAuthSessionTokenService({ secret: SECRET, previousSecrets: ['too-short'] }),
    /previous auth session token secret must contain at least 32 characters/,
  );
  assert.throws(
    () => createAuthSessionTokenService({ secret: SECRET, previousSecrets: [SECRET] }),
    /must be distinct/,
  );
  assert.throws(
    () => createAuthSessionTokenService({
      secret: SECRET,
      previousSecrets: [
        PREVIOUS_SECRET,
        'second-previous-session-secret-at-least-32-characters',
        'third-previous-session-secret-at-least-32-characters',
      ],
    }),
    /at most two previous secrets/,
  );
});

test('requires a production-grade secret length', () => {
  assert.throws(
    () => createAuthSessionTokenService({ secret: 'too-short' }),
    /at least 32 characters/,
  );
});
