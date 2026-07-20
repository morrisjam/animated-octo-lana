import assert from 'node:assert/strict';
import test from 'node:test';
import { createMatchmakingAccessPolicyFromEnv } from './accessPolicy';

const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';
const HEX_ACCOUNT = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const BUILD_SHA = 'abcdef0123456789abcdef0123456789abcdef01';

test('keeps local development open when no policy is configured', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({ NODE_ENV: 'development' });
  assert.deepEqual(policy.getStatus(), {
    mode: 'open',
    ready: true,
    accountAllowlistCount: 0,
    buildAllowlistCount: 0,
  });
  assert.deepEqual(policy.evaluate(ACCOUNT_1, null), { allowed: true });
});

test('fails closed by default in production', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({ NODE_ENV: 'production' });
  assert.equal(policy.getStatus().mode, 'closed');
  assert.equal(policy.getStatus().ready, false);
  assert.deepEqual(policy.evaluate(ACCOUNT_1, 'alpha-1'), {
    allowed: false,
    code: 'matchmaking_closed',
  });
});

test('requires both an allowlisted account and exact build', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({
    NODE_ENV: 'production',
    MATCHMAKING_ACCESS_MODE: 'allowlist',
    MATCHMAKING_ALPHA_ACCOUNT_IDS: `${ACCOUNT_1}, ${ACCOUNT_2}`,
    MATCHMAKING_ALPHA_BUILD_VERSIONS: 'alpha-1,alpha-2',
  });

  assert.deepEqual(policy.getStatus(), {
    mode: 'allowlist',
    ready: true,
    accountAllowlistCount: 2,
    buildAllowlistCount: 2,
  });
  assert.deepEqual(policy.evaluate(ACCOUNT_1, 'alpha-1'), { allowed: true });
  assert.deepEqual(policy.evaluate(ACCOUNT_1, ' alpha-2 '), { allowed: true });
  assert.deepEqual(policy.evaluate('33333333-3333-4333-8333-333333333333', 'alpha-1'), {
    allowed: false,
    code: 'account_not_allowlisted',
  });
  assert.deepEqual(policy.evaluate(ACCOUNT_1, null), {
    allowed: false,
    code: 'build_version_required',
  });
  assert.deepEqual(policy.evaluate(ACCOUNT_1, 'alpha-3'), {
    allowed: false,
    code: 'build_not_allowlisted',
  });
});

test('canonicalizes account UUIDs and exact build SHAs before readiness and runtime checks', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({
    MATCHMAKING_ACCESS_MODE: 'allowlist',
    MATCHMAKING_ALPHA_ACCOUNT_IDS: `${HEX_ACCOUNT.toUpperCase()},${HEX_ACCOUNT}`,
    MATCHMAKING_ALPHA_BUILD_VERSIONS: `${BUILD_SHA.toUpperCase()},${BUILD_SHA}`,
  });

  assert.deepEqual(policy.getStatus(), {
    mode: 'allowlist',
    ready: true,
    accountAllowlistCount: 1,
    buildAllowlistCount: 1,
  });
  assert.deepEqual(policy.evaluate(HEX_ACCOUNT, BUILD_SHA), { allowed: true });
  assert.deepEqual(policy.evaluate(HEX_ACCOUNT.toUpperCase(), BUILD_SHA.toUpperCase()), { allowed: true });
  assert.equal(policy.isBuildAllowlisted(BUILD_SHA), true);
  assert.equal(policy.isBuildAllowlisted(BUILD_SHA.toUpperCase()), true);
  assert.equal(policy.isBuildAllowlisted(`${BUILD_SHA.slice(0, -1)}0`), false);
});

test('keeps non-SHA build identifiers case-sensitive', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({
    MATCHMAKING_ACCESS_MODE: 'allowlist',
    MATCHMAKING_ALPHA_ACCOUNT_IDS: HEX_ACCOUNT,
    MATCHMAKING_ALPHA_BUILD_VERSIONS: 'alpha-RC1',
  });

  assert.deepEqual(policy.evaluate(HEX_ACCOUNT, 'alpha-RC1'), { allowed: true });
  assert.equal(policy.isBuildAllowlisted('alpha-RC1'), true);
  assert.equal(policy.isBuildAllowlisted(' alpha-RC1 '), true);
  assert.equal(policy.isBuildAllowlisted('alpha-rc1'), false);
  assert.deepEqual(policy.evaluate(HEX_ACCOUNT, 'alpha-rc1'), {
    allowed: false,
    code: 'build_not_allowlisted',
  });
});

test('an empty alpha allowlist is not ready and denies every account', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({
    MATCHMAKING_ACCESS_MODE: 'allowlist',
  });
  assert.equal(policy.getStatus().ready, false);
  assert.deepEqual(policy.evaluate(ACCOUNT_1, 'alpha-1'), {
    allowed: false,
    code: 'account_not_allowlisted',
  });
});

test('rejects invalid modes, account ids, and build identifiers at startup', () => {
  assert.throws(
    () => createMatchmakingAccessPolicyFromEnv({ MATCHMAKING_ACCESS_MODE: 'public' }),
    /must be one of/,
  );
  assert.throws(
    () => createMatchmakingAccessPolicyFromEnv({ MATCHMAKING_ALPHA_ACCOUNT_IDS: 'not-a-uuid' }),
    /MATCHMAKING_ALPHA_ACCOUNT_IDS/,
  );
  assert.throws(
    () => createMatchmakingAccessPolicyFromEnv({ MATCHMAKING_ALPHA_BUILD_VERSIONS: 'bad build' }),
    /MATCHMAKING_ALPHA_BUILD_VERSIONS/,
  );
});

test('public status never exposes allowlist entries', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({
    MATCHMAKING_ACCESS_MODE: 'allowlist',
    MATCHMAKING_ALPHA_ACCOUNT_IDS: ACCOUNT_1,
    MATCHMAKING_ALPHA_BUILD_VERSIONS: 'alpha-secret-build',
  });
  const serialised = JSON.stringify(policy.getStatus());
  assert.equal(serialised.includes(ACCOUNT_1), false);
  assert.equal(serialised.includes('alpha-secret-build'), false);
});

test('build membership checks fail closed for empty and invalid identifiers', () => {
  const policy = createMatchmakingAccessPolicyFromEnv({
    MATCHMAKING_ACCESS_MODE: 'allowlist',
    MATCHMAKING_ALPHA_ACCOUNT_IDS: ACCOUNT_1,
    MATCHMAKING_ALPHA_BUILD_VERSIONS: BUILD_SHA,
  });

  assert.equal(policy.isBuildAllowlisted(''), false);
  assert.equal(policy.isBuildAllowlisted('bad build'), false);
  assert.equal(policy.isBuildAllowlisted('x'.repeat(121)), false);
});
