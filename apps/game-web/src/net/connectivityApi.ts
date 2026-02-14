import type { MatchmakingIceConfig } from './transport';

export interface ConnectionTelemetryPayload {
  sessionId?: string;
  queueType: 'unranked' | 'ranked';
  region: 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';
  connectionPath: 'direct' | 'relay';
  transport?: 'webrtc' | 'steam_sockets' | 'unknown';
  rttMs?: number;
  packetLossPercent?: number;
}

type FetchLike = typeof fetch;

export async function fetchMatchmakingIceConfig(
  apiBase: string,
  forceRelay: boolean,
  fetchImpl: FetchLike = fetch,
): Promise<MatchmakingIceConfig | null> {
  if (!apiBase) {
    return null;
  }
  const forceRelayQuery = forceRelay ? '?forceRelay=true' : '';
  try {
    const response = await fetchImpl(`${apiBase}/matchmaking/network/ice-config${forceRelayQuery}`);
    if (!response.ok) {
      return null;
    }
    return await response.json() as MatchmakingIceConfig;
  } catch {
    return null;
  }
}

export async function postConnectionTelemetry(
  apiBase: string,
  accountId: string,
  payload: ConnectionTelemetryPayload,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!apiBase || !accountId) {
    return false;
  }
  try {
    const response = await fetchImpl(`${apiBase}/matchmaking/network/connection-telemetry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-account-id': accountId,
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}
