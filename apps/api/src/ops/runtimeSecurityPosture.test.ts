import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRuntimeSecurityPosture,
  RUNTIME_SECURITY_POSTURE_SCHEMA,
} from './runtimeSecurityPosture';

function validEnvironment(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'canary',
    AUTH_SESSION_SECRET: 'session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    AUTH_SESSION_PREVIOUS_SECRET: '',
    AUTH_RATE_LIMIT_SECRET: 'throttle-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    AUTH_IDENTITY_ADMIN_KEY: 'identity-admin-0123456789-abcdefghijklmnopqrstuvwxyz',
    ALLOW_INSECURE_ACCOUNT_HEADER: 'false',
    API_TRUST_PROXY_HOPS: '1',
    API_CORS_ORIGINS: 'https://alpha.gravitywell.space',
    SLO_ADMIN_KEY: 'slo-admin-0123456789-abcdefghijklmnopqrstuvwxyz',
    RANKED_ANOMALY_ADMIN_KEY: 'anomaly-admin-0123456789-abcdefghijklmnopqrstuvwxyz',
    ENFORCEMENT_ADMIN_KEY: 'enforcement-admin-0123456789-abcdefghijklmnopqrstuvwxyz',
    RANKED_SEASON_RESET_ADMIN_KEY: 'season-admin-0123456789-abcdefghijklmnopqrstuvwxyz',
    STEAM_APP_ID: '480',
    STEAM_WEB_API_KEY: 'steam-publisher-key-0123456789',
    STEAM_WEB_API_IDENTITY: 'gravity-well-api',
    STEAM_WEB_API_BASE: 'https://partner.steam-api.com',
    STEAM_WEB_API_TIMEOUT_MS: '5000',
    STEAM_ALLOW_DEV_TICKETS: 'false',
  };
}

test('reports a privacy-safe ready posture for a production alpha configuration', () => {
  const posture = evaluateRuntimeSecurityPosture(validEnvironment());

  assert.equal(posture.schemaVersion, RUNTIME_SECURITY_POSTURE_SCHEMA);
  assert.equal(posture.configurationReady, true);
  assert.equal(JSON.stringify(posture).includes('0123456789'), false);
});

test('requires production mode and an explicit hosted deployment identity', () => {
  const development = validEnvironment();
  development.NODE_ENV = 'development';
  const unknownDeployment = validEnvironment();
  unknownDeployment.DEPLOYMENT_ENVIRONMENT = 'development';

  assert.equal(evaluateRuntimeSecurityPosture(development).configurationReady, false);
  assert.equal(evaluateRuntimeSecurityPosture(development).productionMode, false);
  assert.equal(evaluateRuntimeSecurityPosture(unknownDeployment).hostedDeployment, false);
});

test('fails closed when auth secrets share purposes or proxy and CORS boundaries are unsafe', () => {
  const env = validEnvironment();
  env.AUTH_RATE_LIMIT_SECRET = env.AUTH_SESSION_SECRET;
  env.API_TRUST_PROXY_HOPS = '';
  env.API_CORS_ORIGINS = '*';

  const posture = evaluateRuntimeSecurityPosture(env);
  assert.equal(posture.authThrottleIsolationReady, false);
  assert.equal(posture.proxySourceBoundaryReady, false);
  assert.equal(posture.corsBoundaryReady, false);
  assert.equal(posture.configurationReady, false);
});

test('requires distinct operations credentials and a purpose-distinct rotation key', () => {
  const env = validEnvironment();
  env.AUTH_SESSION_PREVIOUS_SECRET = env.AUTH_IDENTITY_ADMIN_KEY;
  env.ENFORCEMENT_ADMIN_KEY = env.SLO_ADMIN_KEY;

  const posture = evaluateRuntimeSecurityPosture(env);
  assert.equal(posture.sessionRotationReady, false);
  assert.equal(posture.identityAdminBoundaryReady, false);
  assert.equal(posture.operationsCredentialsReady, false);
  assert.equal(posture.configurationReady, false);
});

test('rejects an operations credential reused for account authentication', () => {
  const env = validEnvironment();
  env.SLO_ADMIN_KEY = env.AUTH_SESSION_SECRET;

  const posture = evaluateRuntimeSecurityPosture(env);
  assert.equal(posture.operationsCredentialsReady, false);
  assert.equal(posture.configurationReady, false);
});

test('accepts only the bounded official Steam verifier with development tickets explicitly disabled', () => {
  for (const override of [
    { STEAM_WEB_API_BASE: 'http://127.0.0.1:9000' },
    { STEAM_WEB_API_BASE: 'https://partner.steam-api.com.attacker.invalid' },
    { STEAM_WEB_API_TIMEOUT_MS: '999' },
    { STEAM_APP_ID: '' },
    { STEAM_WEB_API_KEY: 'changeme' },
    { STEAM_ALLOW_DEV_TICKETS: 'true' },
    { STEAM_ALLOW_DEV_TICKETS: '' },
  ]) {
    const posture = evaluateRuntimeSecurityPosture({
      ...validEnvironment(),
      ...override,
    });
    assert.equal(posture.steamTicketVerifierConfigured, false, JSON.stringify(override));
    assert.equal(posture.configurationReady, false, JSON.stringify(override));
  }
});
