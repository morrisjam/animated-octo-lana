import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  validateExactReleaseBuildAccess,
  validateWebReleaseAttestation,
} from './deploymentHealthGate';
import { assertSafeSmokeTarget, validateSmokeTargetUrl } from './smokeTargetGuard';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_REPORT_PATH = path.resolve('apps/api/build-artifacts/exact-release-identity.json');

function parseSourceDirty(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === '0') {
    return false;
  }
  if (normalized === '1') {
    return true;
  }
  throw new Error('EXACT_RELEASE_SOURCE_DIRTY must be 0 or 1 when configured.');
}

export interface ExactReleaseIdentityEvidence {
  releaseSha: string;
  migrationHead: string;
  migrationCount: number;
  migrationChecksumsVerified: true;
  migrationForwardCompatibleSuffixAllowed: true;
}

export function validateExactReleaseIdentity(input: {
  expectedReleaseSha: string;
  webAttestation: unknown;
  readiness: unknown;
  buildAccess: unknown;
}): ExactReleaseIdentityEvidence {
  const expectedReleaseSha = input.expectedReleaseSha.trim().toLowerCase();
  if (!SHA_PATTERN.test(expectedReleaseSha)) {
    throw new Error('EXACT_RELEASE_EXPECT_SHA must be an exact 40-character Git SHA.');
  }
  validateWebReleaseAttestation(input.webAttestation, expectedReleaseSha);
  validateExactReleaseBuildAccess(input.buildAccess);
  if (!input.readiness || typeof input.readiness !== 'object') {
    throw new Error('API readiness identity must be a JSON object.');
  }
  const readiness = input.readiness as Record<string, unknown>;
  const releaseSha = String(readiness.releaseSha ?? '').trim().toLowerCase();
  const migrationHead = String(readiness.migrationHead ?? '').trim();
  const migrationCount = Number(readiness.migrationCount);
  if (
    readiness.ok !== true
    || releaseSha !== expectedReleaseSha
    || !migrationHead
    || !Number.isSafeInteger(migrationCount)
    || migrationCount < 1
    || readiness.migrationChecksumsVerified !== true
    || readiness.migrationForwardCompatibleSuffixAllowed !== true
  ) {
    throw new Error('API readiness does not bind the expected release to a verified rollback-compatible schema.');
  }
  return {
    releaseSha,
    migrationHead,
    migrationCount,
    migrationChecksumsVerified: true,
    migrationForwardCompatibleSuffixAllowed: true,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const signal = AbortSignal.timeout(5_000);
  const response = await fetch(url, { ...init, redirect: 'error', signal });
  if (!response.ok) {
    throw new Error(`Exact release identity request failed: ${response.status} ${new URL(url).pathname}.`);
  }
  return await response.json();
}

async function run(): Promise<void> {
  const expectedReleaseSha = String(process.env.EXACT_RELEASE_EXPECT_SHA ?? '').trim();
  const apiBaseUrl = validateSmokeTargetUrl(
    String(process.env.API_BASE_URL ?? ''),
    process.env.SMOKE_EXPECT_API_HOSTNAME,
  );
  const adminKey = String(process.env.API_OPS_ADMIN_KEY ?? '').trim();
  if (!adminKey) {
    throw new Error('API_OPS_ADMIN_KEY is required.');
  }
  const webAttestationPath = path.resolve(String(
    process.env.EXACT_RELEASE_WEB_ATTESTATION_PATH
      ?? 'apps/game-web/dist-release/release.json',
  ));
  const reportPath = path.resolve(
    process.env.EXACT_RELEASE_IDENTITY_REPORT_PATH ?? DEFAULT_REPORT_PATH,
  );
  const sourceDirty = parseSourceDirty(process.env.EXACT_RELEASE_SOURCE_DIRTY);

  await assertSafeSmokeTarget(apiBaseUrl, 'Exact release identity smoke');
  const [webAttestation, readiness, buildAccess] = await Promise.all([
    readFile(webAttestationPath, 'utf8').then((source) => JSON.parse(source)),
    fetchJson(`${apiBaseUrl}/readyz`),
    fetchJson(`${apiBaseUrl}/ops/matchmaking/access/build-check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({ buildVersion: expectedReleaseSha }),
    }),
  ]);
  const identity = validateExactReleaseIdentity({
    expectedReleaseSha,
    webAttestation,
    readiness,
    buildAccess,
  });
  const report = {
    schemaVersion: 'gw.exact-release-identity-smoke.v1',
    ok: true,
    localOnly: true,
    hostedServicesContacted: false,
    sourceDirty,
    deployableEvidence: !sourceDirty,
    ...identity,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[exact-release] verified ${identity.releaseSha}`);
  console.log(`[exact-release] report written ${reportPath}`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
