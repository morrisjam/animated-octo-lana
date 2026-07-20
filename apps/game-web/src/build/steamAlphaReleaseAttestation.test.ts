import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  resolveSteamAlphaReleaseAttestation,
  STEAM_ALPHA_RELEASE_FILE_NAME,
  validateSteamAlphaReleaseBuildOutput,
} from './steamAlphaReleaseAttestation';

const RELEASE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

function createValidEnvironment() {
  return {
    mode: 'steam-alpha',
    repositorySha: RELEASE_SHA,
    releaseSha: RELEASE_SHA,
    sourceDirty: false,
    appEnvironment: 'production',
    platform: 'steam',
    profileApiBase: 'https://api.gravitywell.space',
    matchmakingApiBase: 'https://api.gravitywell.space',
    rulesetVersion: 'prototype-2026.02',
    balanceProfileId: 'default',
    steamWebApiIdentity: 'gravity-well-api',
    entitlementMode: 'require_auth',
    entitlementBypass: 'false',
    online: 'true',
    ranked: 'true',
    onlineMatchRuntime: 'true',
    debugTools: 'false',
    onlineDiagnostics: 'false',
    onlineDevMenu: 'false',
    trainingMode: 'true',
    arcadeMode: 'true',
  };
}

describe('Steam alpha release attestation', () => {
  test('is disabled for the offline Steam development profile', () => {
    expect(resolveSteamAlphaReleaseAttestation({ mode: 'steam' })).toBeNull();
  });

  test('binds the exact release and online-alpha feature profile', () => {
    expect(resolveSteamAlphaReleaseAttestation(createValidEnvironment())).toEqual({
      schemaVersion: 'gw.steam-alpha-release.v1',
      profile: 'controlled-online-alpha',
      platform: 'steam',
      releaseSha: RELEASE_SHA,
      sourceDirty: false,
      apiBaseUrl: 'https://api.gravitywell.space',
      rulesetVersion: 'prototype-2026.02',
      balanceProfileId: 'default',
      steamWebApiIdentity: 'gravity-well-api',
      entitlementMode: 'require_auth',
      features: {
        online: true,
        ranked: true,
        onlineMatchRuntime: true,
        debugTools: false,
        onlineDiagnostics: false,
        onlineDevMenu: false,
        trainingMode: true,
        arcadeMode: true,
      },
    });
  });

  test('rejects a mismatched SHA, unsafe feature profile, or development bypass', () => {
    expect(() => resolveSteamAlphaReleaseAttestation({
      ...createValidEnvironment(),
      releaseSha: '1'.repeat(40),
    })).toThrow(/checked-out repository SHA/);
    expect(() => resolveSteamAlphaReleaseAttestation({
      ...createValidEnvironment(),
      onlineMatchRuntime: 'false',
    })).toThrow(/VITE_FEATURE_ONLINE_MATCH_RUNTIME/);
    expect(() => resolveSteamAlphaReleaseAttestation({
      ...createValidEnvironment(),
      entitlementBypass: 'true',
    })).toThrow(/VITE_STEAM_ENTITLEMENT_BYPASS/);
    expect(() => resolveSteamAlphaReleaseAttestation({
      ...createValidEnvironment(),
      profileApiBase: 'http://api.gravitywell.space',
    })).toThrow(/HTTPS/);
  });

  test('allows dirty local review but rejects dirty release packaging', () => {
    expect(resolveSteamAlphaReleaseAttestation({
      ...createValidEnvironment(),
      sourceDirty: true,
    })?.sourceDirty).toBe(true);
    expect(() => resolveSteamAlphaReleaseAttestation({
      ...createValidEnvironment(),
      sourceDirty: true,
      requireCleanRelease: 'true',
    })).toThrow(/clean Git worktree/);
  });

  test('validates the manifest, compiled SHA, and absence of local instrumentation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gw-steam-alpha-release-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'assets'), { recursive: true });
    const attestation = resolveSteamAlphaReleaseAttestation(createValidEnvironment());
    await writeFile(
      join(directory, STEAM_ALPHA_RELEASE_FILE_NAME),
      JSON.stringify(attestation),
      'utf8',
    );
    await writeFile(join(directory, 'assets', 'game.js'), `const build = '${RELEASE_SHA}';`, 'utf8');

    await expect(validateSteamAlphaReleaseBuildOutput(
      directory,
      RELEASE_SHA,
      { requireCleanRelease: true },
    )).resolves.toEqual(attestation);

    await writeFile(join(directory, 'local-ranked-root-smoke-build.json'), '{}', 'utf8');
    await expect(validateSteamAlphaReleaseBuildOutput(directory, RELEASE_SHA))
      .rejects.toThrow(/local ranked-root bridge/);

    await rm(join(directory, 'local-ranked-root-smoke-build.json'));
    await writeFile(join(directory, 'webrtc-smoke.html'), '<!doctype html>', 'utf8');
    await expect(validateSteamAlphaReleaseBuildOutput(directory, RELEASE_SHA))
      .rejects.toThrow(/development entry/);
  });
});
