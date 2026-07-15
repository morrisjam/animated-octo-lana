import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeDatabaseSmokeTarget,
  assertSafeSmokeTarget,
  parseSmokeTargetRequestTimeoutMs,
  validateSmokeTargetUrl,
} from '../../scripts/smokeTargetGuard';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function localEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SMOKE_EXPECT_API_HOSTNAME: '127.0.0.1',
    SMOKE_EXPECT_DATABASE_ID: 'local',
    SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'test',
    ...overrides,
  };
}

test('smoke target URL validation binds the independently configured hostname', () => {
  assert.equal(
    validateSmokeTargetUrl('http://127.0.0.1:8787/', '127.0.0.1'),
    'http://127.0.0.1:8787',
  );
  assert.equal(
    validateSmokeTargetUrl('https://api.staging.example.test/', 'API.STAGING.EXAMPLE.TEST'),
    'https://api.staging.example.test',
  );
  assert.throws(
    () => validateSmokeTargetUrl('https://other.example.test', 'api.staging.example.test'),
    /hostname does not match/,
  );
  assert.throws(
    () => validateSmokeTargetUrl('https://operator:secret@api.example.test', 'api.example.test'),
    /must not contain URL credentials/,
  );
  assert.throws(
    () => validateSmokeTargetUrl('http://api.example.test', 'api.example.test'),
    /must use HTTPS/,
  );
});

test('smoke target guard requires all independent identity inputs before fetching', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return response({ ok: true });
  }) as typeof fetch;

  await assert.rejects(
    assertSafeSmokeTarget('http://127.0.0.1:8787', 'Local smoke', {
      env: {},
      fetchImpl,
    }),
    /SMOKE_EXPECT_DATABASE_ID is required/,
  );
  await assert.rejects(
    assertSafeSmokeTarget('http://127.0.0.1:8787', 'Local smoke', {
      env: localEnvironment({ SMOKE_EXPECT_API_HOSTNAME: '' }),
      fetchImpl,
    }),
    /SMOKE_EXPECT_API_HOSTNAME is required/,
  );
  assert.equal(fetchCalls, 0);
});

test('direct remote database smokes require explicit non-production identity confirmation', () => {
  const remoteDatabaseUrl = 'postgresql://user:secret@db.staging.example.test/gravity_well';
  assert.doesNotThrow(() => assertSafeDatabaseSmokeTarget(
    'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well',
    'Direct smoke',
    {},
  ));
  assert.throws(
    () => assertSafeDatabaseSmokeTarget(remoteDatabaseUrl, 'Direct smoke', {
      ALLOW_REMOTE_DATABASE_SMOKE: '1',
      SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'staging',
    }),
    /SMOKE_EXPECT_DATABASE_ID is required/,
  );
  assert.doesNotThrow(() => assertSafeDatabaseSmokeTarget(remoteDatabaseUrl, 'Direct smoke', {
    ALLOW_REMOTE_DATABASE_SMOKE: '1',
    SMOKE_EXPECT_DATABASE_ID: 'gravity-well-staging',
    SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'staging',
  }));
  assert.throws(
    () => assertSafeDatabaseSmokeTarget(remoteDatabaseUrl, 'Direct smoke', {
      ALLOW_REMOTE_DATABASE_SMOKE: '1',
      SMOKE_EXPECT_DATABASE_ID: 'gravity-well-production',
      SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'production',
    }),
    /never permits production/,
  );
});

test('smoke target guard verifies local health and readiness identity without redirects', async () => {
  const requestedPaths: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requestedPaths.push(url.pathname);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    if (url.pathname === '/health') {
      return response({ ok: true, databaseTarget: 'local' });
    }
    return response({
      ok: true,
      databaseTarget: 'local',
      databaseId: 'local',
      deploymentEnvironment: 'test',
    });
  }) as typeof fetch;

  await assert.doesNotReject(assertSafeSmokeTarget(
    'http://127.0.0.1:8787',
    'Local smoke',
    { env: localEnvironment(), fetchImpl },
  ));
  assert.deepEqual(requestedPaths.sort(), ['/health', '/readyz']);
});

test('smoke target guard rejects reported database and environment identity mismatches', async () => {
  const createFetch = (readiness: Record<string, unknown>) => (async (
    input: string | URL | Request,
  ) => {
    const pathname = new URL(String(input)).pathname;
    return pathname === '/health'
      ? response({ ok: true, databaseTarget: 'local' })
      : response({
        ok: true,
        databaseTarget: 'local',
        databaseId: 'local',
        deploymentEnvironment: 'test',
        ...readiness,
      });
  }) as typeof fetch;

  await assert.rejects(
    assertSafeSmokeTarget('http://127.0.0.1:8787', 'Local smoke', {
      env: localEnvironment(),
      fetchImpl: createFetch({ databaseId: 'gravity-well-production' }),
    }),
    /database identity mismatch/,
  );
  await assert.rejects(
    assertSafeSmokeTarget('http://127.0.0.1:8787', 'Local smoke', {
      env: localEnvironment(),
      fetchImpl: createFetch({ deploymentEnvironment: 'production' }),
    }),
    /deployment environment mismatch/,
  );
});

test('remote smoke safety uses independent staging identity and never permits production', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    fetchCalls += 1;
    const pathname = new URL(String(input)).pathname;
    return pathname === '/health'
      ? response({ ok: true, databaseTarget: 'remote' })
      : response({
        ok: true,
        databaseTarget: 'remote',
        databaseId: 'gravity-well-staging',
        deploymentEnvironment: 'staging',
      });
  }) as typeof fetch;
  const stagingEnvironment = {
    ALLOW_REMOTE_DATABASE_SMOKE: '1',
    SMOKE_EXPECT_API_HOSTNAME: 'api.staging.example.test',
    SMOKE_EXPECT_DATABASE_ID: 'gravity-well-staging',
    SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'staging',
  };

  await assert.doesNotReject(assertSafeSmokeTarget(
    'https://api.staging.example.test',
    'Remote smoke',
    { env: stagingEnvironment, fetchImpl },
  ));
  assert.equal(fetchCalls, 2);

  fetchCalls = 0;
  await assert.rejects(
    assertSafeSmokeTarget('https://api.staging.example.test', 'Remote smoke', {
      env: {
        ...stagingEnvironment,
        ALLOW_REMOTE_DATABASE_SMOKE: '0',
      },
      fetchImpl,
    }),
    /requires a local PostgreSQL target/,
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    assertSafeSmokeTarget('https://api.staging.example.test', 'Remote smoke', {
      env: {
        ...stagingEnvironment,
        SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'production',
      },
      fetchImpl,
    }),
    /independently configured production target/,
  );
  assert.equal(fetchCalls, 0);
});

test('smoke target identity requests have a validated bounded deadline', async () => {
  assert.equal(parseSmokeTargetRequestTimeoutMs(undefined), 5_000);
  assert.equal(parseSmokeTargetRequestTimeoutMs('100'), 100);
  assert.throws(
    () => parseSmokeTargetRequestTimeoutMs('99'),
    /must be an integer between 100 and 30000/,
  );

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => (
    await new Promise<Response>((_resolve, reject) => {
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      const keepAlive = setTimeout(
        () => reject(new Error('fetch mock outlived the expected deadline')),
        1_000,
      );
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(init.signal?.reason);
      }, { once: true });
    })
  )) as typeof fetch;
  const startedAt = Date.now();
  await assert.rejects(
    assertSafeSmokeTarget('http://127.0.0.1:8787', 'Local smoke', {
      env: localEnvironment({ SMOKE_TARGET_REQUEST_TIMEOUT_MS: '100' }),
      fetchImpl,
    }),
    /request timed out after 100ms/,
  );
  assert.ok(Date.now() - startedAt < 1_000, 'guard exceeded its bounded request deadline');
});
