import assert from 'node:assert/strict';
import { createAuthSessionTokenService } from '../src/auth/sessionToken';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OLD_SECRET = 'local-rotation-old-session-secret-0123456789';
const NEW_SECRET = 'local-rotation-new-session-secret-0123456789';
const TTL_SECONDS = 120;

let nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);
const now = () => nowMs;

const oldService = createAuthSessionTokenService({
  secret: OLD_SECRET,
  ttlSeconds: TTL_SECONDS,
  now,
});
const oldToken = oldService.issue(ACCOUNT_ID, 'steam').accessToken;

const overlapService = createAuthSessionTokenService({
  secret: NEW_SECRET,
  previousSecrets: [OLD_SECRET],
  ttlSeconds: TTL_SECONDS,
  now,
});
assert.equal(overlapService.verify(oldToken).ok, true, 'Old token must survive the overlap.');
const newToken = overlapService.issue(ACCOUNT_ID, 'steam').accessToken;
assert.equal(overlapService.verify(newToken).ok, true, 'New token must verify during the overlap.');
assert.equal(oldService.verify(newToken).ok, false, 'New tokens must be signed only by the new key.');

const cutoverService = createAuthSessionTokenService({
  secret: NEW_SECRET,
  ttlSeconds: TTL_SECONDS,
  now,
});
assert.deepEqual(
  cutoverService.verify(oldToken),
  { ok: false, code: 'invalid_signature' },
  'The retired key must stop verifying after cutover.',
);
assert.equal(cutoverService.verify(newToken).ok, true, 'New token must survive cutover.');

nowMs += TTL_SECONDS * 1_000;
assert.deepEqual(
  cutoverService.verify(newToken),
  { ok: false, code: 'expired' },
  'Expiry must remain authoritative after rotation.',
);

console.log(JSON.stringify({
  schemaVersion: 'gw.auth-session-rotation-smoke.v1',
  ok: true,
  localOnly: true,
  hostedServicesContacted: false,
  overlap: {
    previousTokenAccepted: true,
    currentTokenAccepted: true,
    currentTokenRejectedByPreviousKey: true,
  },
  cutover: {
    previousTokenRejected: true,
    currentTokenAccepted: true,
  },
  expiry: {
    currentTokenExpiredAtBoundary: true,
    ttlSeconds: TTL_SECONDS,
  },
}, null, 2));
