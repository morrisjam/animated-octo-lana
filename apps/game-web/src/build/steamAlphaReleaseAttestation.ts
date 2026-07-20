import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STEAM_ALPHA_RELEASE_SCHEMA_VERSION = 'gw.steam-alpha-release.v1' as const;
export const STEAM_ALPHA_RELEASE_FILE_NAME = 'steam-alpha-release.json';

const EXACT_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export interface SteamAlphaReleaseAttestation {
  schemaVersion: typeof STEAM_ALPHA_RELEASE_SCHEMA_VERSION;
  profile: 'controlled-online-alpha';
  platform: 'steam';
  releaseSha: string;
  sourceDirty: boolean;
  apiBaseUrl: string;
  rulesetVersion: string;
  balanceProfileId: string;
  steamWebApiIdentity: string;
  entitlementMode: 'require_auth';
  features: {
    online: true;
    ranked: true;
    onlineMatchRuntime: true;
    debugTools: false;
    onlineDiagnostics: false;
    onlineDevMenu: false;
    trainingMode: true;
    arcadeMode: true;
  };
}

export interface SteamAlphaReleaseEnvironment {
  mode?: string;
  repositorySha?: string;
  releaseSha?: string;
  configuredBuildId?: string;
  sourceDirty?: boolean;
  requireCleanRelease?: string;
  cfPages?: string;
  appEnvironment?: string;
  platform?: string;
  profileApiBase?: string;
  matchmakingApiBase?: string;
  rulesetVersion?: string;
  balanceProfileId?: string;
  steamWebApiIdentity?: string;
  entitlementMode?: string;
  entitlementBypass?: string;
  developmentTicket?: string;
  online?: string;
  ranked?: string;
  onlineMatchRuntime?: string;
  debugTools?: string;
  onlineDiagnostics?: string;
  onlineDevMenu?: string;
  trainingMode?: string;
  arcadeMode?: string;
  localRankedRootSmoke?: string;
}

function parseExactGitSha(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EXACT_GIT_SHA_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be an exact 40-character Git SHA.`);
  }
  return normalized;
}

function parseBoolean(value: unknown, fieldName: string): boolean {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`${fieldName} must be an explicit boolean.`);
}

function requireValue(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} is required for the Steam alpha release.`);
  }
  return normalized;
}

function requireValueEquals(value: unknown, expected: string, fieldName: string): void {
  if (requireValue(value, fieldName).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${fieldName} must equal ${expected} for the Steam alpha release.`);
  }
}

function requireBooleanEquals(value: unknown, expected: boolean, fieldName: string): void {
  if (parseBoolean(value, fieldName) !== expected) {
    throw new Error(`${fieldName} must equal ${expected} for the Steam alpha release.`);
  }
}

function parseApiBaseUrl(value: unknown, fieldName: string): string {
  const raw = requireValue(value, fieldName);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${fieldName} must be a valid HTTPS base URL.`);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error(`${fieldName} must be an origin-only HTTPS base URL.`);
  }
  return parsed.origin;
}

export function resolveSteamAlphaReleaseAttestation(
  environment: SteamAlphaReleaseEnvironment,
): SteamAlphaReleaseAttestation | null {
  if (environment.mode?.trim().toLowerCase() !== 'steam-alpha') {
    return null;
  }
  if (environment.cfPages?.trim() === '1') {
    throw new Error('A Steam alpha build cannot also be a Cloudflare Pages build.');
  }

  const repositorySha = parseExactGitSha(environment.repositorySha, 'repository Git SHA');
  const releaseSha = parseExactGitSha(
    environment.releaseSha || repositorySha,
    'Steam release Git SHA',
  );
  if (releaseSha !== repositorySha) {
    throw new Error('Steam release Git SHA must equal the checked-out repository SHA.');
  }
  const configuredBuildId = environment.configuredBuildId?.trim() ?? '';
  if (configuredBuildId && parseExactGitSha(configuredBuildId, 'VITE_APP_BUILD') !== releaseSha) {
    throw new Error('VITE_APP_BUILD must be omitted or equal the Steam release Git SHA.');
  }

  const sourceDirty = environment.sourceDirty === true;
  if (parseBoolean(environment.requireCleanRelease ?? 'false', 'STEAM_REQUIRE_CLEAN_RELEASE') && sourceDirty) {
    throw new Error('A clean Git worktree is required for a release Steam alpha package.');
  }
  requireValueEquals(environment.appEnvironment, 'production', 'VITE_APP_ENV');
  requireValueEquals(environment.platform, 'steam', 'VITE_PLATFORM');
  requireValueEquals(environment.entitlementMode, 'require_auth', 'VITE_STEAM_ENTITLEMENT_MODE');
  requireBooleanEquals(environment.entitlementBypass ?? 'false', false, 'VITE_STEAM_ENTITLEMENT_BYPASS');
  if (environment.developmentTicket?.trim()) {
    throw new Error('VITE_STEAM_DEV_TICKET must be absent from a Steam alpha release.');
  }
  if (['1', 'true'].includes(environment.localRankedRootSmoke?.trim().toLowerCase() ?? '')) {
    throw new Error('A Steam alpha release must not include the local ranked-root bridge.');
  }

  requireBooleanEquals(environment.online, true, 'VITE_FEATURE_ONLINE');
  requireBooleanEquals(environment.ranked, true, 'VITE_FEATURE_RANKED');
  requireBooleanEquals(
    environment.onlineMatchRuntime,
    true,
    'VITE_FEATURE_ONLINE_MATCH_RUNTIME',
  );
  requireBooleanEquals(environment.debugTools, false, 'VITE_FEATURE_DEBUG_TOOLS');
  requireBooleanEquals(
    environment.onlineDiagnostics,
    false,
    'VITE_FEATURE_ONLINE_DIAGNOSTICS',
  );
  requireBooleanEquals(environment.onlineDevMenu, false, 'VITE_FEATURE_ONLINE_DEV_MENU');
  requireBooleanEquals(environment.trainingMode, true, 'VITE_FEATURE_TRAINING_MODE');
  requireBooleanEquals(environment.arcadeMode, true, 'VITE_FEATURE_ARCADE_MODE');

  const profileApiBase = parseApiBaseUrl(environment.profileApiBase, 'VITE_PROFILE_API_BASE');
  const matchmakingApiBase = parseApiBaseUrl(
    environment.matchmakingApiBase,
    'VITE_MATCHMAKING_API_BASE',
  );
  if (profileApiBase !== matchmakingApiBase) {
    throw new Error('Steam profile and matchmaking API origins must match.');
  }

  return {
    schemaVersion: STEAM_ALPHA_RELEASE_SCHEMA_VERSION,
    profile: 'controlled-online-alpha',
    platform: 'steam',
    releaseSha,
    sourceDirty,
    apiBaseUrl: profileApiBase,
    rulesetVersion: requireValue(environment.rulesetVersion, 'VITE_RULESET_VERSION'),
    balanceProfileId: requireValue(environment.balanceProfileId, 'VITE_BALANCE_PROFILE_ID'),
    steamWebApiIdentity: requireValue(
      environment.steamWebApiIdentity,
      'VITE_STEAM_WEB_API_IDENTITY',
    ),
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
  };
}

export function parseSteamAlphaReleaseAttestation(value: unknown): SteamAlphaReleaseAttestation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Steam alpha release attestation must be a JSON object.');
  }
  const candidate = value as Record<string, unknown>;
  const features = candidate.features as Record<string, unknown> | undefined;
  const parsed: SteamAlphaReleaseAttestation = {
    schemaVersion: STEAM_ALPHA_RELEASE_SCHEMA_VERSION,
    profile: 'controlled-online-alpha',
    platform: 'steam',
    releaseSha: parseExactGitSha(candidate.releaseSha, 'releaseSha'),
    sourceDirty: candidate.sourceDirty === true,
    apiBaseUrl: parseApiBaseUrl(candidate.apiBaseUrl, 'apiBaseUrl'),
    rulesetVersion: requireValue(candidate.rulesetVersion, 'rulesetVersion'),
    balanceProfileId: requireValue(candidate.balanceProfileId, 'balanceProfileId'),
    steamWebApiIdentity: requireValue(candidate.steamWebApiIdentity, 'steamWebApiIdentity'),
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
  };
  if (
    candidate.schemaVersion !== parsed.schemaVersion
    || candidate.profile !== parsed.profile
    || candidate.platform !== parsed.platform
    || candidate.entitlementMode !== parsed.entitlementMode
    || candidate.sourceDirty !== parsed.sourceDirty
    || !features
    || features.online !== true
    || features.ranked !== true
    || features.onlineMatchRuntime !== true
    || features.debugTools !== false
    || features.onlineDiagnostics !== false
    || features.onlineDevMenu !== false
    || features.trainingMode !== true
    || features.arcadeMode !== true
  ) {
    throw new Error('Steam alpha release attestation does not describe the required release profile.');
  }
  return parsed;
}

async function bundleContainsReleaseSha(outputDirectory: string, releaseSha: string): Promise<boolean> {
  const assetsDirectory = join(outputDirectory, 'assets');
  for (const assetName of await readdir(assetsDirectory)) {
    if (!assetName.endsWith('.js')) {
      continue;
    }
    const source = await readFile(join(assetsDirectory, assetName), 'utf8');
    if (source.toLowerCase().includes(releaseSha)) {
      return true;
    }
  }
  return false;
}

export async function validateSteamAlphaReleaseBuildOutput(
  outputDirectory: string,
  expectedReleaseShaInput: string,
  options: { requireCleanRelease?: boolean } = {},
): Promise<SteamAlphaReleaseAttestation> {
  const expectedReleaseSha = parseExactGitSha(expectedReleaseShaInput, 'expectedReleaseSha');
  const attestation = parseSteamAlphaReleaseAttestation(JSON.parse(await readFile(
    join(outputDirectory, STEAM_ALPHA_RELEASE_FILE_NAME),
    'utf8',
  )));
  if (attestation.releaseSha !== expectedReleaseSha) {
    throw new Error(
      `Steam alpha release mismatch: expected ${expectedReleaseSha}, got ${attestation.releaseSha}.`,
    );
  }
  if (options.requireCleanRelease && attestation.sourceDirty) {
    throw new Error('Steam alpha release attestation reports a dirty source tree.');
  }
  if (!await bundleContainsReleaseSha(outputDirectory, expectedReleaseSha)) {
    throw new Error('The emitted Steam JavaScript does not contain the attested release SHA.');
  }
  await access(join(outputDirectory, 'local-ranked-root-smoke-build.json')).then(
    () => {
      throw new Error('Steam alpha release contains the local ranked-root bridge attestation.');
    },
    () => undefined,
  );
  for (const developmentEntry of ['webrtc-smoke.html', 'webrtc-peer-smoke.html']) {
    await access(join(outputDirectory, developmentEntry)).then(
      () => {
        throw new Error(`Steam alpha release contains development entry ${developmentEntry}.`);
      },
      () => undefined,
    );
  }
  return attestation;
}
