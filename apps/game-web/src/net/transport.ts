export type ConnectionPath = 'direct' | 'relay';
export type IceTransportPolicy = 'all' | 'relay';

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface MatchmakingIceConfig {
  iceServers: IceServerConfig[];
  iceTransportPolicy: IceTransportPolicy;
  fallbackPolicy: 'relay';
  directConnectTimeoutMs: number;
}

export interface RelayFallbackControllerOptions {
  directConnectTimeoutMs: number;
}

export class RelayFallbackController {
  private readonly directConnectTimeoutMs: number;

  private directAttemptStartedAtMs: number | null = null;

  private connected = false;

  private currentPath: ConnectionPath = 'direct';

  public constructor(options: RelayFallbackControllerOptions) {
    this.directConnectTimeoutMs = options.directConnectTimeoutMs;
  }

  public startDirectAttempt(nowMs: number): void {
    this.directAttemptStartedAtMs = nowMs;
    this.connected = false;
    this.currentPath = 'direct';
  }

  public markConnected(): void {
    this.connected = true;
  }

  public shouldFallbackToRelay(nowMs: number): boolean {
    if (this.connected || this.currentPath === 'relay' || this.directAttemptStartedAtMs === null) {
      return false;
    }
    return nowMs - this.directAttemptStartedAtMs >= this.directConnectTimeoutMs;
  }

  public applyRelayFallback(): void {
    this.currentPath = 'relay';
    this.connected = false;
    this.directAttemptStartedAtMs = null;
  }

  public getCurrentPath(): ConnectionPath {
    return this.currentPath;
  }
}

export function buildRtcConfiguration(
  config: MatchmakingIceConfig,
  path: ConnectionPath,
): RTCConfiguration {
  return {
    iceServers: config.iceServers.map((server) => ({
      urls: [...server.urls],
      username: server.username,
      credential: server.credential,
    })),
    iceTransportPolicy: path === 'relay' ? 'relay' : config.iceTransportPolicy,
  };
}
