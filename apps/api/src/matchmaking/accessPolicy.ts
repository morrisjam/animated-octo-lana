export type MatchmakingAccessMode = 'open' | 'closed' | 'allowlist';

export type MatchmakingAccessDenialCode =
  | 'matchmaking_closed'
  | 'account_not_allowlisted'
  | 'build_version_required'
  | 'build_not_allowlisted';

export interface MatchmakingAccessStatus {
  mode: MatchmakingAccessMode;
  ready: boolean;
  accountAllowlistCount: number;
  buildAllowlistCount: number;
}

export type MatchmakingAccessDecision =
  | { allowed: true }
  | { allowed: false; code: MatchmakingAccessDenialCode };

export interface MatchmakingAccessPolicy {
  getStatus(): MatchmakingAccessStatus;
  evaluate(accountId: string, buildVersion: string | null | undefined): MatchmakingAccessDecision;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_VERSION_REGEX = /^[a-z0-9][a-z0-9._:+-]{0,119}$/i;
const EXACT_SHA_REGEX = /^[0-9a-f]{40}$/i;

function normalizeAccountId(accountId: string): string {
  return accountId.trim().toLowerCase();
}

function normalizeBuildVersion(buildVersion: string): string {
  const trimmed = buildVersion.trim();
  return EXACT_SHA_REGEX.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function parseMode(env: Record<string, string | undefined>): MatchmakingAccessMode {
  const configured = env.MATCHMAKING_ACCESS_MODE?.trim().toLowerCase();
  if (!configured) {
    return env.NODE_ENV?.trim().toLowerCase() === 'production' ? 'closed' : 'open';
  }
  if (configured === 'open' || configured === 'closed' || configured === 'allowlist') {
    return configured;
  }
  throw new Error('MATCHMAKING_ACCESS_MODE must be one of: open, closed, allowlist.');
}

function parseAllowlist(
  rawValue: string | undefined,
  envName: string,
  validate: (entry: string) => boolean,
  normalize: (entry: string) => string,
): Set<string> {
  const entries = (rawValue ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (!validate(entry)) {
      throw new Error(`${envName} contains an invalid entry.`);
    }
  }
  return new Set(entries.map(normalize));
}

export function createMatchmakingAccessPolicyFromEnv(
  env: Record<string, string | undefined>,
): MatchmakingAccessPolicy {
  const mode = parseMode(env);
  const accountAllowlist = parseAllowlist(
    env.MATCHMAKING_ALPHA_ACCOUNT_IDS,
    'MATCHMAKING_ALPHA_ACCOUNT_IDS',
    (entry) => UUID_REGEX.test(entry),
    normalizeAccountId,
  );
  const buildAllowlist = parseAllowlist(
    env.MATCHMAKING_ALPHA_BUILD_VERSIONS,
    'MATCHMAKING_ALPHA_BUILD_VERSIONS',
    (entry) => BUILD_VERSION_REGEX.test(entry),
    normalizeBuildVersion,
  );
  const status: MatchmakingAccessStatus = {
    mode,
    ready: mode === 'open' || (mode === 'allowlist' && accountAllowlist.size > 0 && buildAllowlist.size > 0),
    accountAllowlistCount: accountAllowlist.size,
    buildAllowlistCount: buildAllowlist.size,
  };

  return {
    getStatus(): MatchmakingAccessStatus {
      return { ...status };
    },
    evaluate(accountId: string, buildVersion: string | null | undefined): MatchmakingAccessDecision {
      if (mode === 'open') {
        return { allowed: true };
      }
      if (mode === 'closed') {
        return { allowed: false, code: 'matchmaking_closed' };
      }
      if (!accountAllowlist.has(normalizeAccountId(accountId))) {
        return { allowed: false, code: 'account_not_allowlisted' };
      }
      const normalisedBuild = normalizeBuildVersion(buildVersion ?? '');
      if (!normalisedBuild) {
        return { allowed: false, code: 'build_version_required' };
      }
      if (!buildAllowlist.has(normalisedBuild)) {
        return { allowed: false, code: 'build_not_allowlisted' };
      }
      return { allowed: true };
    },
  };
}
