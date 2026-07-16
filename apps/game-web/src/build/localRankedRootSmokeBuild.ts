export const LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION = 'gw.local-ranked-root-smoke-build.v1';

export interface LocalRankedRootSmokeBuildAttestation {
  schemaVersion: typeof LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION;
  enabled: true;
  buildId: string;
  apiBaseUrl: string;
}

export function createLocalRankedRootSmokeBuildAttestation(input: {
  buildId: string;
  apiBaseUrl: string;
}): LocalRankedRootSmokeBuildAttestation {
  return {
    schemaVersion: LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION,
    enabled: true,
    buildId: input.buildId.trim(),
    apiBaseUrl: input.apiBaseUrl.trim().replace(/\/+$/, ''),
  };
}

export function parseLocalRankedRootSmokeBuildAttestation(
  value: unknown,
): LocalRankedRootSmokeBuildAttestation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local ranked-root smoke build attestation must be an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION) {
    throw new Error('Local ranked-root smoke build attestation uses an unsupported schema.');
  }
  if (candidate.enabled !== true) {
    throw new Error('Local ranked-root smoke build attestation is not enabled.');
  }
  const buildId = typeof candidate.buildId === 'string' ? candidate.buildId.trim() : '';
  const apiBaseUrl = typeof candidate.apiBaseUrl === 'string'
    ? candidate.apiBaseUrl.trim().replace(/\/+$/, '')
    : '';
  if (!buildId) {
    throw new Error('Local ranked-root smoke build attestation is missing buildId.');
  }
  if (!apiBaseUrl) {
    throw new Error('Local ranked-root smoke build attestation is missing apiBaseUrl.');
  }
  return {
    schemaVersion: LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION,
    enabled: true,
    buildId,
    apiBaseUrl,
  };
}
