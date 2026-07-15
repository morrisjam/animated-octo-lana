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

export interface MatchmakingApiAuth {
  accountId: string;
  accessToken?: string | null;
}

export interface MatchmakingSessionAuth {
  sessionId: string;
  sessionToken: string;
}

export async function fetchMatchmakingIceConfig(
  apiBase: string,
  forceRelay: boolean,
  auth: MatchmakingApiAuth,
  session: MatchmakingSessionAuth,
  fetchImpl: FetchLike = fetch,
): Promise<MatchmakingIceConfig | null> {
  if (
    !apiBase
    || (!auth.accessToken && !auth.accountId)
    || !session.sessionId
    || !session.sessionToken
  ) {
    return null;
  }
  const headers = auth.accessToken
    ? { authorization: `Bearer ${auth.accessToken}`, 'content-type': 'application/json' }
    : { 'x-account-id': auth.accountId, 'content-type': 'application/json' };
  try {
    const response = await fetchImpl(`${apiBase}/matchmaking/network/ice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        forceRelay,
      }),
    });
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
