import assert from 'node:assert/strict';
import test from 'node:test';
import { createMatchmakingAccessPolicyFromEnv } from '../matchmaking/accessPolicy';
import { auditAlphaProviderConfig } from './alphaProviderConfig';

const RELEASE_SHA = '1234567890abcdef1234567890abcdef12345678';
const ACCOUNT_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';

function createValidEnvironment(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'canary',
    DEPLOYMENT_DATABASE_ID: 'gravity-well-canary',
    RENDER_HEALTH_CHECK_PATH: '/health',
    MATCHMAKING_RUNTIME_NAMESPACE: 'canary',
    MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS: '5000',
    RELEASE_SHA,
    DATABASE_URL: 'postgresql://alpha:secret@db.neon.tech/gravity?sslmode=require',
    AUTH_SESSION_SECRET: 'alpha-auth-session-secret-at-least-32-characters',
    AUTH_RATE_LIMIT_SECRET: 'alpha-auth-rate-limit-secret-at-least-32-characters',
    API_TRUST_PROXY_HOPS: '1',
    ALLOW_INSECURE_ACCOUNT_HEADER: 'false',
    API_CORS_ORIGINS: 'https://alpha.gravitywell.space',
    MATCHMAKING_ACCESS_MODE: 'allowlist',
    MATCHMAKING_ALPHA_ACCOUNT_IDS: ACCOUNT_ID,
    MATCHMAKING_ALPHA_BUILD_VERSIONS: RELEASE_SHA,
    MATCHMAKING_MAX_RESIDENT_TICKETS: '64',
    MATCHMAKING_RECONNECT_GRACE_SECONDS: '20',
    RANKED_SUPPORTED_RULESET_VERSIONS: 'prototype-2026.02',
    MATCHMAKING_TURN_URLS: 'turn:relay.gravitywell.space:3478?transport=udp,turns:relay.gravitywell.space:5349?transport=tcp',
    MATCHMAKING_TURN_SHARED_SECRET: 'alpha-turn-shared-secret-at-least-32-characters',
    MIGRATION_ALLOW_FORWARD_COMPATIBLE_SUFFIX: 'true',
    MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS: '600',
    STEAM_APP_ID: '123456',
    STEAM_WEB_API_KEY: 'publisher-api-key-not-a-placeholder',
    STEAM_WEB_API_IDENTITY: 'gravity-well-api',
    STEAM_WEB_API_TIMEOUT_MS: '5000',
    STEAM_ALLOW_DEV_TICKETS: 'false',
    VITE_STEAM_WEB_API_IDENTITY: 'gravity-well-api',
    REPLAY_BLOB_PROVIDER: 'postgres',
    SLO_ADMIN_KEY: 'slo-admin-key-at-least-24-characters',
    RANKED_ANOMALY_ADMIN_KEY: 'anomaly-admin-key-at-least-24-characters',
    ENFORCEMENT_ADMIN_KEY: 'enforcement-admin-key-at-least-24-characters',
    RANKED_SEASON_RESET_ADMIN_KEY: 'season-admin-key-at-least-24-characters',
    ROOM_WEB_INVITE_BASE_URL: 'https://alpha.gravitywell.space',
    VITE_APP_ENV: 'production',
    VITE_PLATFORM: 'web',
    VITE_PROFILE_API_BASE: 'https://api-alpha.gravitywell.space',
    VITE_MATCHMAKING_API_BASE: 'https://api-alpha.gravitywell.space',
    VITE_APP_BUILD: RELEASE_SHA,
    VITE_RULESET_VERSION: 'prototype-2026.02',
    VITE_BALANCE_PROFILE_ID: 'default',
    VITE_FEATURE_ONLINE: 'true',
    VITE_FEATURE_RANKED: 'true',
    VITE_FEATURE_ONLINE_MATCH_RUNTIME: 'true',
    VITE_FEATURE_DEBUG_TOOLS: 'false',
    VITE_FEATURE_ONLINE_DIAGNOSTICS: 'false',
    VITE_FEATURE_ONLINE_DEV_MENU: 'false',
  };
}

test('accepts a complete controlled-alpha provider snapshot without exposing values', () => {
  const report = auditAlphaProviderConfig(createValidEnvironment());

  assert.equal(report.ready, true);
  assert.equal(report.blockers, 0);
  assert.equal(report.warnings, 0);
  assert.ok(report.checks.every((check) => check.status === 'pass'));
  assert.equal(JSON.stringify(report).includes('publisher-api-key'), false);
});

test('provider readiness agrees with runtime access for uppercase UUID and SHA configuration', () => {
  const env = createValidEnvironment();
  env.RELEASE_SHA = RELEASE_SHA.toUpperCase();
  env.MATCHMAKING_ALPHA_ACCOUNT_IDS = ACCOUNT_ID.toUpperCase();
  env.MATCHMAKING_ALPHA_BUILD_VERSIONS = RELEASE_SHA.toUpperCase();

  assert.equal(auditAlphaProviderConfig(env).ready, true);

  const policy = createMatchmakingAccessPolicyFromEnv(env);
  assert.equal(policy.getStatus().ready, true);
  assert.deepEqual(policy.evaluate(ACCOUNT_ID, RELEASE_SHA), { allowed: true });
});

test('blocks ephemeral replay storage and a disabled online match runtime', () => {
  const env = createValidEnvironment();
  env.REPLAY_BLOB_PROVIDER = 'local';
  env.VITE_FEATURE_ONLINE_MATCH_RUNTIME = 'false';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['durable_replays', 'web_online_runtime'],
  );
});

test('blocks provider overrides that disable ranked proof replay protection', () => {
  const env = createValidEnvironment();
  env.RANKED_PROOF_RATE_LIMIT_ACCOUNT_SESSION_MAX_ATTEMPTS = '1000';
  env.RANKED_PROOF_RATE_LIMIT_ACCOUNT_HOUR_MAX_ATTEMPTS = '10000';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['ranked_proof_rate_limit'],
  );
});

test('blocks static TURN credentials and Steam development tickets', () => {
  const env = createValidEnvironment();
  env.MATCHMAKING_TURN_USERNAME = 'shared-player';
  env.MATCHMAKING_TURN_CREDENTIAL = 'shared-password';
  env.STEAM_ALLOW_DEV_TICKETS = 'true';
  env.VITE_STEAM_DEV_TICKET = 'dev-steam:76561198012345678';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['turn_credentials', 'steam_verification', 'steam_dev_ticket_disabled'],
  );
});

test('blocks mismatched Steam Web API identities between client and server', () => {
  const env = createValidEnvironment();
  env.VITE_STEAM_WEB_API_IDENTITY = 'other-service';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['steam_client_identity'],
  );
});

test('blocks an implicit or cross-environment matchmaking runtime namespace', () => {
  const env = createValidEnvironment();
  env.MATCHMAKING_RUNTIME_NAMESPACE = 'production';
  env.MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS = '500';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['matchmaking_runtime_coordination'],
  );
});

test('blocks a database-backed Render health probe', () => {
  const env = createValidEnvironment();
  env.RENDER_HEALTH_CHECK_PATH = '/readyz';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['provider_health_probe'],
  );
});

test('requires an explicit bounded resident-ticket ceiling', () => {
  const missing = createValidEnvironment();
  delete missing.MATCHMAKING_MAX_RESIDENT_TICKETS;
  assert.deepEqual(
    auditAlphaProviderConfig(missing).checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id),
    ['matchmaking_resident_capacity'],
  );

  const oversized = createValidEnvironment();
  oversized.MATCHMAKING_MAX_RESIDENT_TICKETS = '129';
  assert.deepEqual(
    auditAlphaProviderConfig(oversized).checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id),
    ['matchmaking_resident_capacity'],
  );
});

test('blocks a reconnect grace window that cannot contain WebRTC recovery', () => {
  const env = createValidEnvironment();
  env.MATCHMAKING_RECONNECT_GRACE_SECONDS = '1';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['matchmaking_recovery_window'],
  );
});

test('requires a distinct auth throttle secret and explicit hosted proxy boundary', () => {
  const env = createValidEnvironment();
  env.AUTH_RATE_LIMIT_SECRET = env.AUTH_SESSION_SECRET;
  delete env.API_TRUST_PROXY_HOPS;
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['auth_rate_limit_secret', 'auth_source_identity'],
  );
});

test('requires purpose-distinct operations credentials', () => {
  const env = createValidEnvironment();
  env.ENFORCEMENT_ADMIN_KEY = env.SLO_ADMIN_KEY;
  assert.deepEqual(
    auditAlphaProviderConfig(env).checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id),
    ['operations_keys'],
  );

  env.ENFORCEMENT_ADMIN_KEY = 'enforcement-admin-key-at-least-24-characters';
  env.SLO_ADMIN_KEY = env.AUTH_SESSION_SECRET;
  assert.deepEqual(
    auditAlphaProviderConfig(env).checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id),
    ['operations_keys'],
  );
});

test('accepts only a strong purpose-distinct previous session secret during rotation', () => {
  const valid = createValidEnvironment();
  valid.AUTH_SESSION_PREVIOUS_SECRET = 'previous-alpha-session-secret-at-least-32-characters';
  const validReport = auditAlphaProviderConfig(valid);
  assert.equal(validReport.ready, true);
  assert.equal(JSON.stringify(validReport).includes(valid.AUTH_SESSION_PREVIOUS_SECRET), false);

  for (const previousSecret of [
    'weak',
    valid.AUTH_SESSION_SECRET,
    valid.AUTH_RATE_LIMIT_SECRET,
  ]) {
    const env = createValidEnvironment();
    env.AUTH_SESSION_PREVIOUS_SECRET = previousSecret;
    const report = auditAlphaProviderConfig(env);

    assert.equal(report.ready, false);
    assert.deepEqual(
      report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
      ['auth_session_rotation_secret'],
    );
  }
});

test('rejects weak identity administration and unsafe Steam verifier transport settings', () => {
  const env = createValidEnvironment();
  env.AUTH_IDENTITY_ADMIN_KEY = 'weak';
  env.STEAM_WEB_API_BASE = 'http://partner.steam-api.com';
  env.STEAM_WEB_API_TIMEOUT_MS = '60000';
  const report = auditAlphaProviderConfig(env);

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['identity_admin_boundary', 'steam_verification'],
  );
});

test('rejects non-Steam HTTPS verifier hosts and deceptive endpoint variants', () => {
  const unsafeBases = [
    'https://attacker.invalid',
    'https://partner.steam-api.com.attacker.invalid',
    'https://partner.steam-api.com:8443',
    'https://user@partner.steam-api.com',
    'https://partner.steam-api.com/custom-path',
  ];

  for (const steamApiBase of unsafeBases) {
    const env = createValidEnvironment();
    env.STEAM_WEB_API_BASE = steamApiBase;
    const report = auditAlphaProviderConfig(env);

    assert.equal(report.ready, false, steamApiBase);
    assert.deepEqual(
      report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
      ['steam_verification'],
      steamApiBase,
    );
  }
});
