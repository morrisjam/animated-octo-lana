export const DEFAULT_REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT = 200;
export const DEFAULT_REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT = 256 * 1024 * 1024;

export interface ReplayIngestQuotaPolicy {
  maxActiveArchivesPerAccount: number;
  maxActiveBytesPerAccount: number;
}

export interface ReplayIngestQuotaUsage {
  activeArchives: number;
  activeCompressedBytes: number;
  incomingEstimatedBytes: number;
}

export type ReplayIngestQuotaDecision =
  | { allowed: true }
  | { allowed: false; code: 'archive_count_quota' | 'archive_bytes_quota'; error: string };

function resolveBoundedInteger(
  rawValue: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!rawValue?.trim()) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function resolveReplayIngestQuotaPolicy(
  env: Record<string, string | undefined>,
): ReplayIngestQuotaPolicy {
  return {
    maxActiveArchivesPerAccount: resolveBoundedInteger(
      env.REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT,
      'REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT',
      DEFAULT_REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT,
      1,
      10_000,
    ),
    maxActiveBytesPerAccount: resolveBoundedInteger(
      env.REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT,
      'REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT',
      DEFAULT_REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT,
      1024 * 1024,
      10 * 1024 * 1024 * 1024,
    ),
  };
}

export function evaluateReplayIngestQuota(
  usage: ReplayIngestQuotaUsage,
  policy: ReplayIngestQuotaPolicy,
): ReplayIngestQuotaDecision {
  if (usage.activeArchives + 1 > policy.maxActiveArchivesPerAccount) {
    return {
      allowed: false,
      code: 'archive_count_quota',
      error: `Replay archive quota reached (${policy.maxActiveArchivesPerAccount} active archives).`,
    };
  }
  if (
    usage.activeCompressedBytes + usage.incomingEstimatedBytes
    > policy.maxActiveBytesPerAccount
  ) {
    return {
      allowed: false,
      code: 'archive_bytes_quota',
      error: `Replay storage quota reached (${policy.maxActiveBytesPerAccount} bytes).`,
    };
  }
  return { allowed: true };
}
