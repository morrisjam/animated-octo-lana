import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  fetchJson as fetchHealthJson,
  validateDeploymentUrl,
  validateMatchmakingResidentCapacity,
  validateWebReleaseAttestation,
} from '../../scripts/deploymentHealthGate';
import {
  fetchJson as fetchDrainJson,
  validateApiBaseUrl,
} from '../../scripts/deploymentDrainGate';

const RELEASE_SHA = '1234567890abcdef1234567890abcdef12345678';
const safeRolloutWorkflow = readFileSync(
  new URL('../../../../.github/workflows/safe-rollout.yml', import.meta.url),
  'utf8',
);

const apiUrlValidators = [
  {
    name: 'health gate',
    validate: (value: string, expectedHostname: string, allowInsecureLoopback = false) => (
      validateDeploymentUrl({
        value,
        valueName: 'API_BASE_URL',
        expectedHostname,
        expectedHostnameName: 'DEPLOY_EXPECT_API_HOSTNAME',
        allowInsecureLoopback,
        requireBaseUrl: true,
      })
    ),
  },
  {
    name: 'drain gate',
    validate: (value: string, expectedHostname: string, allowInsecureLoopback = false) => (
      validateApiBaseUrl({ value, expectedHostname, allowInsecureLoopback })
    ),
  },
];

test('deployment gate URL validation fails closed before credentials can be sent', () => {
  for (const validator of apiUrlValidators) {
    assert.throws(
      () => validator.validate('http://api.example.test', 'api.example.test'),
      /must use HTTPS/,
      validator.name,
    );
    assert.throws(
      () => validator.validate('https://other.example.test', 'api.example.test'),
      /hostname does not match/,
      validator.name,
    );
    assert.throws(
      () => validator.validate('https://operator:secret@api.example.test', 'api.example.test'),
      /must not contain URL credentials/,
      validator.name,
    );
    assert.equal(
      validator.validate('https://api.example.test/', 'api.example.test'),
      'https://api.example.test',
      validator.name,
    );
  }
});

test('insecure rehearsal URLs require an explicit loopback-only exception', () => {
  for (const validator of apiUrlValidators) {
    assert.equal(
      validator.validate('http://127.0.0.1:8787/', '127.0.0.1', true),
      'http://127.0.0.1:8787',
      validator.name,
    );
    assert.throws(
      () => validator.validate('http://api.example.test', 'api.example.test', true),
      /must use HTTPS/,
      validator.name,
    );
  }
});

test('web release attestation requires the exact API SHA and schema', () => {
  assert.equal(validateWebReleaseAttestation({
    schemaVersion: 'gw.web-release.v1',
    releaseSha: RELEASE_SHA.toUpperCase(),
  }, RELEASE_SHA), RELEASE_SHA.toUpperCase());
  assert.throws(
    () => validateWebReleaseAttestation({
      schemaVersion: 'gw.web-release.v1',
      releaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    }, RELEASE_SHA),
    /does not bind the deployed web client/,
  );
  assert.throws(
    () => validateWebReleaseAttestation({
      schemaVersion: 'gw.web-release.v0',
      releaseSha: RELEASE_SHA,
    }, RELEASE_SHA),
    /does not bind the deployed web client/,
  );
});

test('deployment gate requires the exact positive resident-ticket ceiling', () => {
  assert.equal(
    validateMatchmakingResidentCapacity({ maxResidentTickets: 64 }, '64'),
    64,
  );
  assert.throws(
    () => validateMatchmakingResidentCapacity({ maxResidentTickets: 65 }, '64'),
    /capacity mismatch/,
  );
  assert.throws(
    () => validateMatchmakingResidentCapacity({}, '64'),
    /positive maxResidentTickets/,
  );
  assert.throws(
    () => validateMatchmakingResidentCapacity({ maxResidentTickets: 64 }, 'invalid'),
    /positive safe integer/,
  );
});

test('every deployment gate fetch has a deadline and rejects redirects', async () => {
  const originalFetch = globalThis.fetch;
  const fetchers = [fetchHealthJson, fetchDrainJson];
  try {
    for (const fetcher of fetchers) {
      let redirectMode: RequestRedirect | undefined;
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        redirectMode = init?.redirect;
        const signal = init?.signal;
        assert.ok(signal);
        return await new Promise<Response>((_resolve, reject) => {
          const keepAlive = setTimeout(() => reject(new Error('fetch mock outlived the expected deadline')), 1_000);
          signal.addEventListener('abort', () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          }, { once: true });
        });
      }) as typeof fetch;

      const startedAt = Date.now();
      await assert.rejects(
        fetcher('https://api.example.test/health', 100),
        /request timed out after 100ms/,
      );
      assert.equal(redirectMode, 'error');
      assert.ok(Date.now() - startedAt < 1_000, 'request exceeded its bounded deadline');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('automatic rollback cannot replace an API until the replacement drain succeeds', () => {
  const rollbackStep = safeRolloutWorkflow.match(
    /- name: Trigger exact rollback release[\s\S]*?(?=\n\s+- name:)/,
  )?.[0];
  assert.ok(rollbackStep, 'safe rollout workflow is missing the exact rollback step');
  assert.match(rollbackStep, /steps\.rollback_drain\.outcome == 'success'/);
  assert.doesNotMatch(rollbackStep, /replacement re-drain outcome=/);
});
