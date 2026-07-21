import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  resolveExactReleasePath,
  validateExactReleaseIdentity,
} from '../../scripts/exactReleaseIdentitySmoke';

const RELEASE_SHA = '1234567890abcdef1234567890abcdef12345678';

test('resolves documented smoke artifact paths from the repository root', () => {
  const repositoryRoot = path.resolve('fixture-repository');
  const absolutePath = path.resolve('fixture-release.json');

  assert.equal(
    resolveExactReleasePath('apps/game-web/dist-release/release.json', repositoryRoot),
    path.join(repositoryRoot, 'apps/game-web/dist-release/release.json'),
  );
  assert.equal(resolveExactReleasePath(absolutePath, repositoryRoot), absolutePath);
});

function createValidInput() {
  return {
    expectedReleaseSha: RELEASE_SHA,
    webAttestation: {
      schemaVersion: 'gw.web-release.v1',
      releaseSha: RELEASE_SHA,
    },
    readiness: {
      ok: true,
      releaseSha: RELEASE_SHA,
      migrationHead: '032_steam_ticket_exchange_replay_guard.sql',
      migrationCount: 32,
      migrationChecksumsVerified: true,
      migrationForwardCompatibleSuffixAllowed: true,
    },
    buildAccess: { allowlisted: true },
  };
}

test('binds the provider web artifact, API readiness, and private build allowlist to one SHA', () => {
  assert.deepEqual(validateExactReleaseIdentity(createValidInput()), {
    releaseSha: RELEASE_SHA,
    migrationHead: '032_steam_ticket_exchange_replay_guard.sql',
    migrationCount: 32,
    migrationChecksumsVerified: true,
    migrationForwardCompatibleSuffixAllowed: true,
  });
});

test('rejects a mismatched API, web artifact, allowlist, or rollback migration posture', () => {
  for (const mutation of [
    (input: ReturnType<typeof createValidInput>) => { input.webAttestation.releaseSha = 'a'.repeat(40); },
    (input: ReturnType<typeof createValidInput>) => { input.readiness.releaseSha = 'a'.repeat(40); },
    (input: ReturnType<typeof createValidInput>) => { input.buildAccess.allowlisted = false; },
    (input: ReturnType<typeof createValidInput>) => {
      input.readiness.migrationForwardCompatibleSuffixAllowed = false;
    },
  ]) {
    const input = createValidInput();
    mutation(input);
    assert.throws(() => validateExactReleaseIdentity(input));
  }
});

test('rejects malformed release identities and unsupported web attestations', () => {
  const malformedSha = createValidInput();
  malformedSha.expectedReleaseSha = 'not-a-release-sha';
  assert.throws(
    () => validateExactReleaseIdentity(malformedSha),
    /exact 40-character Git SHA/,
  );

  const unsupportedAttestation = createValidInput();
  unsupportedAttestation.webAttestation.schemaVersion = 'gw.web-release.v0';
  assert.throws(
    () => validateExactReleaseIdentity(unsupportedAttestation),
    /does not bind the deployed web client/,
  );
});

test('requires every rollback-compatible readiness invariant', () => {
  const mutations: Array<(input: ReturnType<typeof createValidInput>) => void> = [
    (input) => { input.readiness.ok = false; },
    (input) => { input.readiness.migrationHead = ''; },
    (input) => { input.readiness.migrationCount = 0; },
    (input) => { input.readiness.migrationCount = 1.5; },
    (input) => { input.readiness.migrationChecksumsVerified = false; },
    (input) => { input.readiness.migrationForwardCompatibleSuffixAllowed = false; },
  ];
  for (const mutate of mutations) {
    const input = createValidInput();
    mutate(input);
    assert.throws(
      () => validateExactReleaseIdentity(input),
      /verified rollback-compatible schema/,
    );
  }
});

test('accepts only the redacted exact-build allowlist response', () => {
  for (const buildAccess of [
    { allowlisted: false },
    { allowlisted: 'true' },
    { allowlisted: true, buildVersions: [RELEASE_SHA] },
  ]) {
    const input = createValidInput();
    input.buildAccess = buildAccess as typeof input.buildAccess;
    assert.throws(
      () => validateExactReleaseIdentity(input),
      /not present in the matchmaking build allowlist/,
    );
  }
});
