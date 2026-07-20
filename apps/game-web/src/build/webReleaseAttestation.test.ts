import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createWebReleaseHeaders,
  resolveCloudflarePagesReleaseBuild,
  validateWebReleaseBuildOutput,
  WEB_RELEASE_ATTESTATION_SCHEMA_VERSION,
} from './webReleaseAttestation';

const RELEASE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function createReleaseOutput(input?: {
  releaseSha?: string;
  headersSource?: string;
  bundleSource?: string;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gw-web-release-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'release.json'), JSON.stringify({
    schemaVersion: WEB_RELEASE_ATTESTATION_SCHEMA_VERSION,
    releaseSha: input?.releaseSha ?? RELEASE_SHA,
  }), 'utf8');
  await writeFile(
    join(directory, '_headers'),
    input?.headersSource ?? createWebReleaseHeaders(),
    'utf8',
  );
  await writeFile(
    join(directory, 'assets', 'game.js'),
    input?.bundleSource ?? `const buildId = '${RELEASE_SHA}';\n`,
    'utf8',
  );
  return directory;
}

describe('Cloudflare Pages web release attestation', () => {
  test('is disabled outside a Pages build', () => {
    expect(resolveCloudflarePagesReleaseBuild({
      cfPagesCommitSha: RELEASE_SHA,
      configuredBuildId: RELEASE_SHA,
    })).toBeNull();
  });

  test('derives the attestation and cache rule from the immutable Pages commit', () => {
    const build = resolveCloudflarePagesReleaseBuild({
      cfPages: '1',
      cfPagesCommitSha: RELEASE_SHA.toUpperCase(),
      configuredBuildId: RELEASE_SHA,
    });

    expect(build).toMatchObject({
      releaseSha: RELEASE_SHA,
      attestation: {
        schemaVersion: WEB_RELEASE_ATTESTATION_SCHEMA_VERSION,
        releaseSha: RELEASE_SHA,
      },
    });
    expect(build?.headersSource).toContain('/release.json');
    expect(build?.headersSource).toContain('Cache-Control: no-store');
  });

  test('fails closed for missing, malformed, or conflicting build identity', () => {
    expect(() => resolveCloudflarePagesReleaseBuild({ cfPages: '1' }))
      .toThrow(/CF_PAGES_COMMIT_SHA/);
    expect(() => resolveCloudflarePagesReleaseBuild({
      cfPages: '1',
      cfPagesCommitSha: 'short',
    })).toThrow(/CF_PAGES_COMMIT_SHA/);
    expect(() => resolveCloudflarePagesReleaseBuild({
      cfPages: '1',
      cfPagesCommitSha: RELEASE_SHA,
      configuredBuildId: '0123456789abcdef0123456789abcdef01234567',
    })).toThrow(/VITE_APP_BUILD/);
    expect(() => resolveCloudflarePagesReleaseBuild({
      cfPages: '1',
      cfPagesCommitSha: RELEASE_SHA,
      localRankedRootSmoke: 'true',
    })).toThrow(/local ranked-root bridge/);
  });

  test('validates one identity across the attestation, header rule, and JavaScript bundle', async () => {
    const directory = await createReleaseOutput();
    await expect(validateWebReleaseBuildOutput(directory, RELEASE_SHA)).resolves.toEqual({
      schemaVersion: WEB_RELEASE_ATTESTATION_SCHEMA_VERSION,
      releaseSha: RELEASE_SHA,
    });
  });

  test('rejects a cached attestation or a bundle carrying a different identity', async () => {
    const cachedDirectory = await createReleaseOutput({
      headersSource: '/release.json\n  Cache-Control: public, max-age=3600\n',
    });
    await expect(validateWebReleaseBuildOutput(cachedDirectory, RELEASE_SHA))
      .rejects.toThrow(/disable caching/);

    const wrongBundleDirectory = await createReleaseOutput({
      bundleSource: "const buildId = 'different';\n",
    });
    await expect(validateWebReleaseBuildOutput(wrongBundleDirectory, RELEASE_SHA))
      .rejects.toThrow(/JavaScript/);
  });
});
