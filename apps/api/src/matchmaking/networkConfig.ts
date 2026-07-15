import { createHmac } from 'node:crypto';

export type IceTransportPolicy = 'all' | 'relay';
export type FallbackPolicy = 'relay';
export type TurnCredentialMode = 'none' | 'static' | 'time_limited';

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface MatchmakingNetworkStatus {
  iceTransportPolicy: IceTransportPolicy;
  fallbackPolicy: FallbackPolicy;
  directConnectTimeoutMs: number;
  relayAvailable: boolean;
  turnCredentialMode: TurnCredentialMode;
}

export interface MatchmakingNetworkConfig extends MatchmakingNetworkStatus {
  iceServers: IceServerConfig[];
  turnCredentialExpiresAt?: string;
}

export interface MatchmakingNetworkConfigOptions {
  stunUrls?: string[];
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
  turnCredentialMode?: Exclude<TurnCredentialMode, 'none'>;
  turnCredentialExpiresAt?: string;
  iceTransportPolicy?: IceTransportPolicy;
  fallbackPolicy?: FallbackPolicy;
  directConnectTimeoutMs?: number;
}

export interface TimeLimitedTurnCredentials {
  username: string;
  credential: string;
  expiresAt: string;
}

export interface MatchmakingNetworkConfigService {
  getStatus(): MatchmakingNetworkStatus;
  issueConfig(accountId: string, options?: { forceRelay?: boolean }): MatchmakingNetworkConfig;
}

export interface MatchmakingNetworkConfigServiceOptions {
  now?: () => number;
}

const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'];
const DEFAULT_DIRECT_TIMEOUT_MS = 8_000;
const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 600;
const MIN_TURN_CREDENTIAL_TTL_SECONDS = 60;
const MAX_TURN_CREDENTIAL_TTL_SECONDS = 86_400;
const MIN_TURN_SHARED_SECRET_LENGTH = 16;

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function clampTurnCredentialTtl(value: number | undefined): number {
  return Math.min(
    MAX_TURN_CREDENTIAL_TTL_SECONDS,
    Math.max(MIN_TURN_CREDENTIAL_TTL_SECONDS, Math.floor(value ?? DEFAULT_TURN_CREDENTIAL_TTL_SECONDS)),
  );
}

function sanitiseIceUrls(urls: string[] | undefined): string[] {
  if (!urls) {
    return [];
  }
  return urls
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolvePolicy(value: string | undefined): IceTransportPolicy {
  return value?.trim().toLowerCase() === 'relay' ? 'relay' : 'all';
}

export function createTimeLimitedTurnCredentials(options: {
  sharedSecret: string;
  accountId: string;
  ttlSeconds?: number;
  now?: () => number;
}): TimeLimitedTurnCredentials {
  const sharedSecret = options.sharedSecret.trim();
  if (sharedSecret.length < MIN_TURN_SHARED_SECRET_LENGTH) {
    throw new Error(`TURN shared secret must contain at least ${MIN_TURN_SHARED_SECRET_LENGTH} characters.`);
  }
  const accountId = options.accountId.trim();
  if (!accountId || accountId.includes(':')) {
    throw new Error('Cannot issue TURN credentials for an invalid account id.');
  }
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1_000);
  const expiresAtSeconds = nowSeconds + clampTurnCredentialTtl(options.ttlSeconds);
  const username = `${expiresAtSeconds}:${accountId}`;
  return {
    username,
    credential: createHmac('sha1', sharedSecret).update(username).digest('base64'),
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
  };
}

export function createMatchmakingNetworkConfig(
  options: MatchmakingNetworkConfigOptions = {},
): MatchmakingNetworkConfig {
  const stunUrls = sanitiseIceUrls(options.stunUrls);
  const turnUrls = sanitiseIceUrls(options.turnUrls);
  const iceServers: IceServerConfig[] = [];
  const relayAvailable = turnUrls.length > 0
    && Boolean(options.turnUsername)
    && Boolean(options.turnCredential);

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  if (relayAvailable && options.turnUsername && options.turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: options.turnUsername,
      credential: options.turnCredential,
    });
  }

  if (iceServers.length === 0) {
    iceServers.push({ urls: [...DEFAULT_STUN_URLS] });
  }

  return {
    iceServers,
    iceTransportPolicy: options.iceTransportPolicy ?? 'all',
    fallbackPolicy: options.fallbackPolicy ?? 'relay',
    directConnectTimeoutMs: options.directConnectTimeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS,
    relayAvailable,
    turnCredentialMode: relayAvailable ? options.turnCredentialMode ?? 'static' : 'none',
    ...(relayAvailable && options.turnCredentialExpiresAt
      ? { turnCredentialExpiresAt: options.turnCredentialExpiresAt }
      : {}),
  };
}

export function createMatchmakingNetworkConfigFromEnv(
  env: Record<string, string | undefined>,
): MatchmakingNetworkConfig {
  return createMatchmakingNetworkConfig({
    stunUrls: parseCommaSeparated(env.MATCHMAKING_STUN_URLS),
    turnUrls: parseCommaSeparated(env.MATCHMAKING_TURN_URLS),
    turnUsername: env.MATCHMAKING_TURN_USERNAME?.trim() || undefined,
    turnCredential: env.MATCHMAKING_TURN_CREDENTIAL?.trim() || undefined,
    iceTransportPolicy: resolvePolicy(env.MATCHMAKING_ICE_TRANSPORT_POLICY),
    fallbackPolicy: 'relay',
    directConnectTimeoutMs: parsePositiveInt(env.MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS),
  });
}

export function createMatchmakingNetworkConfigServiceFromEnv(
  env: Record<string, string | undefined>,
  options: MatchmakingNetworkConfigServiceOptions = {},
): MatchmakingNetworkConfigService {
  const stunUrls = parseCommaSeparated(env.MATCHMAKING_STUN_URLS);
  const turnUrls = parseCommaSeparated(env.MATCHMAKING_TURN_URLS);
  const sharedSecret = env.MATCHMAKING_TURN_SHARED_SECRET?.trim() || undefined;
  const staticUsername = env.MATCHMAKING_TURN_USERNAME?.trim() || undefined;
  const staticCredential = env.MATCHMAKING_TURN_CREDENTIAL?.trim() || undefined;
  const iceTransportPolicy = resolvePolicy(env.MATCHMAKING_ICE_TRANSPORT_POLICY);
  const directConnectTimeoutMs = parsePositiveInt(env.MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS)
    ?? DEFAULT_DIRECT_TIMEOUT_MS;
  const credentialTtlSeconds = clampTurnCredentialTtl(
    parsePositiveInt(env.MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS),
  );
  if (sharedSecret && sharedSecret.length < MIN_TURN_SHARED_SECRET_LENGTH) {
    throw new Error(`TURN shared secret must contain at least ${MIN_TURN_SHARED_SECRET_LENGTH} characters.`);
  }

  const turnCredentialMode: TurnCredentialMode = turnUrls.length === 0
    ? 'none'
    : sharedSecret
      ? 'time_limited'
      : staticUsername && staticCredential
        ? 'static'
        : 'none';
  const status: MatchmakingNetworkStatus = {
    iceTransportPolicy,
    fallbackPolicy: 'relay',
    directConnectTimeoutMs,
    relayAvailable: turnCredentialMode !== 'none',
    turnCredentialMode,
  };

  return {
    getStatus(): MatchmakingNetworkStatus {
      return { ...status };
    },
    issueConfig(accountId: string, issueOptions = {}): MatchmakingNetworkConfig {
      const requestedPolicy = issueOptions.forceRelay ? 'relay' : iceTransportPolicy;
      if (turnCredentialMode === 'time_limited' && sharedSecret) {
        const credentials = createTimeLimitedTurnCredentials({
          sharedSecret,
          accountId,
          ttlSeconds: credentialTtlSeconds,
          now: options.now,
        });
        return createMatchmakingNetworkConfig({
          stunUrls,
          turnUrls,
          turnUsername: credentials.username,
          turnCredential: credentials.credential,
          turnCredentialMode,
          turnCredentialExpiresAt: credentials.expiresAt,
          iceTransportPolicy: requestedPolicy,
          directConnectTimeoutMs,
        });
      }
      return createMatchmakingNetworkConfig({
        stunUrls,
        turnUrls,
        turnUsername: staticUsername,
        turnCredential: staticCredential,
        turnCredentialMode: turnCredentialMode === 'static' ? 'static' : undefined,
        iceTransportPolicy: requestedPolicy,
        directConnectTimeoutMs,
      });
    },
  };
}
