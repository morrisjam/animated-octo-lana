export type IceTransportPolicy = 'all' | 'relay';
export type FallbackPolicy = 'relay';

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface MatchmakingNetworkConfig {
  iceServers: IceServerConfig[];
  iceTransportPolicy: IceTransportPolicy;
  fallbackPolicy: FallbackPolicy;
  directConnectTimeoutMs: number;
}

export interface MatchmakingNetworkConfigOptions {
  stunUrls?: string[];
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
  iceTransportPolicy?: IceTransportPolicy;
  fallbackPolicy?: FallbackPolicy;
  directConnectTimeoutMs?: number;
}

const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'];
const DEFAULT_DIRECT_TIMEOUT_MS = 1800;

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

function sanitiseIceUrls(urls: string[] | undefined): string[] {
  if (!urls) {
    return [];
  }
  return urls
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function createMatchmakingNetworkConfig(
  options: MatchmakingNetworkConfigOptions = {},
): MatchmakingNetworkConfig {
  const stunUrls = sanitiseIceUrls(options.stunUrls);
  const turnUrls = sanitiseIceUrls(options.turnUrls);
  const iceServers: IceServerConfig[] = [];

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  if (turnUrls.length > 0 && options.turnUsername && options.turnCredential) {
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
  };
}

export function createMatchmakingNetworkConfigFromEnv(
  env: Record<string, string | undefined>,
): MatchmakingNetworkConfig {
  const policy = env.MATCHMAKING_ICE_TRANSPORT_POLICY?.trim().toLowerCase();
  const fallbackPolicy = env.MATCHMAKING_FALLBACK_POLICY?.trim().toLowerCase();
  return createMatchmakingNetworkConfig({
    stunUrls: parseCommaSeparated(env.MATCHMAKING_STUN_URLS),
    turnUrls: parseCommaSeparated(env.MATCHMAKING_TURN_URLS),
    turnUsername: env.MATCHMAKING_TURN_USERNAME?.trim() || undefined,
    turnCredential: env.MATCHMAKING_TURN_CREDENTIAL?.trim() || undefined,
    iceTransportPolicy: policy === 'relay' ? 'relay' : 'all',
    fallbackPolicy: fallbackPolicy === 'relay' ? 'relay' : 'relay',
    directConnectTimeoutMs: parsePositiveInt(env.MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS),
  });
}
