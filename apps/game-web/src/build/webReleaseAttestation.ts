import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const WEB_RELEASE_ATTESTATION_SCHEMA_VERSION = 'gw.web-release.v1' as const;
export const WEB_RELEASE_ATTESTATION_FILE_NAME = 'release.json';
export const WEB_RELEASE_HEADERS_FILE_NAME = '_headers';
export const WEB_RELEASE_ATTESTATION_PATH = `/${WEB_RELEASE_ATTESTATION_FILE_NAME}`;

const EXACT_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export interface WebReleaseAttestation {
  schemaVersion: typeof WEB_RELEASE_ATTESTATION_SCHEMA_VERSION;
  releaseSha: string;
}

export interface CloudflarePagesReleaseBuild {
  releaseSha: string;
  attestation: WebReleaseAttestation;
  attestationSource: string;
  headersSource: string;
}

export interface CloudflarePagesReleaseEnvironment {
  cfPages?: string;
  cfPagesCommitSha?: string;
  configuredBuildId?: string;
  localRankedRootSmoke?: string;
}

function parseExactGitSha(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EXACT_GIT_SHA_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be an exact 40-character Git SHA.`);
  }
  return normalized;
}

export function createWebReleaseAttestation(releaseShaInput: string): WebReleaseAttestation {
  return {
    schemaVersion: WEB_RELEASE_ATTESTATION_SCHEMA_VERSION,
    releaseSha: parseExactGitSha(releaseShaInput, 'releaseSha'),
  };
}

export function createWebReleaseHeaders(): string {
  return [
    WEB_RELEASE_ATTESTATION_PATH,
    '  Cache-Control: no-store, max-age=0',
    '  X-Content-Type-Options: nosniff',
    '',
  ].join('\n');
}

export function resolveCloudflarePagesReleaseBuild(
  environment: CloudflarePagesReleaseEnvironment,
): CloudflarePagesReleaseBuild | null {
  if (environment.cfPages?.trim() !== '1') {
    return null;
  }

  const releaseSha = parseExactGitSha(
    environment.cfPagesCommitSha,
    'CF_PAGES_COMMIT_SHA',
  );
  if (['1', 'true'].includes(environment.localRankedRootSmoke?.trim().toLowerCase() ?? '')) {
    throw new Error('Cloudflare Pages release builds must not include the local ranked-root bridge.');
  }
  const configuredBuildId = environment.configuredBuildId?.trim() ?? '';
  if (
    configuredBuildId
    && parseExactGitSha(configuredBuildId, 'VITE_APP_BUILD') !== releaseSha
  ) {
    throw new Error(
      'VITE_APP_BUILD must be omitted or equal CF_PAGES_COMMIT_SHA for a Cloudflare Pages build.',
    );
  }

  const attestation = createWebReleaseAttestation(releaseSha);
  return {
    releaseSha,
    attestation,
    attestationSource: `${JSON.stringify(attestation, null, 2)}\n`,
    headersSource: createWebReleaseHeaders(),
  };
}

export function parseWebReleaseAttestation(value: unknown): WebReleaseAttestation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Web release attestation must be a JSON object.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== WEB_RELEASE_ATTESTATION_SCHEMA_VERSION) {
    throw new Error('Web release attestation uses an unsupported schema.');
  }
  return createWebReleaseAttestation(String(candidate.releaseSha ?? ''));
}

function assertReleaseHeaders(headersSource: string): void {
  const normalized = headersSource.replace(/\r\n/g, '\n');
  const releaseRule = normalized
    .split(/\n(?=\/)/)
    .find((rule) => rule.trimStart().startsWith(WEB_RELEASE_ATTESTATION_PATH));
  if (!releaseRule || !/^\s*Cache-Control:\s*[^\n]*\bno-store\b/im.test(releaseRule)) {
    throw new Error(`${WEB_RELEASE_HEADERS_FILE_NAME} must disable caching for ${WEB_RELEASE_ATTESTATION_PATH}.`);
  }
}

async function bundleContainsReleaseSha(outputDirectory: string, releaseSha: string): Promise<boolean> {
  const assetsDirectory = join(outputDirectory, 'assets');
  const assetNames = await readdir(assetsDirectory);
  const javaScriptAssetNames = assetNames.filter((assetName) => assetName.endsWith('.js'));
  for (const assetName of javaScriptAssetNames) {
    const source = await readFile(join(assetsDirectory, assetName), 'utf8');
    if (source.toLowerCase().includes(releaseSha)) {
      return true;
    }
  }
  return false;
}

export async function validateWebReleaseBuildOutput(
  outputDirectory: string,
  expectedReleaseShaInput: string,
): Promise<WebReleaseAttestation> {
  const expectedReleaseSha = parseExactGitSha(expectedReleaseShaInput, 'expectedReleaseSha');
  const attestation = parseWebReleaseAttestation(JSON.parse(await readFile(
    join(outputDirectory, WEB_RELEASE_ATTESTATION_FILE_NAME),
    'utf8',
  )));
  if (attestation.releaseSha !== expectedReleaseSha) {
    throw new Error(
      `Web release attestation mismatch: expected ${expectedReleaseSha}, got ${attestation.releaseSha}.`,
    );
  }

  assertReleaseHeaders(await readFile(
    join(outputDirectory, WEB_RELEASE_HEADERS_FILE_NAME),
    'utf8',
  ));
  if (!await bundleContainsReleaseSha(outputDirectory, expectedReleaseSha)) {
    throw new Error('The emitted web JavaScript does not contain the attested release SHA.');
  }
  return attestation;
}
