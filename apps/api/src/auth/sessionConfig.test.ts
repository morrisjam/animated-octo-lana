import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAllowInsecureAccountHeader,
  resolveAuthSessionSecret,
} from './sessionConfig';

test('requires an explicit session secret in every deployment environment', () => {
  assert.throws(
    () => resolveAuthSessionSecret({ NODE_ENV: 'development' }),
    /AUTH_SESSION_SECRET is required/,
  );
  assert.throws(
    () => resolveAuthSessionSecret({ NODE_ENV: 'staging' }),
    /AUTH_SESSION_SECRET is required/,
  );
});

test('returns the trimmed configured session secret', () => {
  assert.equal(
    resolveAuthSessionSecret({ AUTH_SESSION_SECRET: '  configured-secret-with-at-least-32-characters  ' }),
    'configured-secret-with-at-least-32-characters',
  );
});

test('permits the insecure account header only in explicit local development', () => {
  assert.equal(resolveAllowInsecureAccountHeader({
    NODE_ENV: 'development',
    DEPLOYMENT_ENVIRONMENT: 'local',
    ALLOW_INSECURE_ACCOUNT_HEADER: 'true',
  }), true);
  assert.equal(resolveAllowInsecureAccountHeader({
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'production',
    ALLOW_INSECURE_ACCOUNT_HEADER: 'false',
  }), false);
});

test('rejects the insecure account header before a hosted API can start', () => {
  for (const env of [
    { NODE_ENV: 'production', ALLOW_INSECURE_ACCOUNT_HEADER: 'true' },
    {
      NODE_ENV: 'development',
      DEPLOYMENT_ENVIRONMENT: 'canary',
      ALLOW_INSECURE_ACCOUNT_HEADER: ' TRUE ',
    },
    {
      NODE_ENV: 'development',
      DEPLOYMENT_ENVIRONMENT: 'staging',
      ALLOW_INSECURE_ACCOUNT_HEADER: 'true',
    },
  ]) {
    assert.throws(
      () => resolveAllowInsecureAccountHeader(env),
      /cannot be enabled in a hosted deployment/,
    );
  }
});
