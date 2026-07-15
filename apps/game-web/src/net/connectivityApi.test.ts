import { describe, expect, it, vi } from 'vitest';
import { fetchMatchmakingIceConfig, postConnectionTelemetry } from './connectivityApi';

describe('fetchMatchmakingIceConfig', () => {
  it('returns parsed config on success', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          iceServers: [{ urls: ['stun:stun.example.net:3478'] }],
          iceTransportPolicy: 'all',
          fallbackPolicy: 'relay',
          directConnectTimeoutMs: 1800,
          relayAvailable: false,
          turnCredentialMode: 'none',
        };
      },
    })) as unknown as typeof fetch;

    const config = await fetchMatchmakingIceConfig(
      'http://localhost:8787',
      false,
      {
        accountId: '11111111-1111-4111-8111-111111111111',
        accessToken: 'signed-session-token',
      },
      {
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sessionToken: 'match-session-token',
      },
      mockFetch,
    );
    expect(config?.fallbackPolicy).toBe('relay');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/matchmaking/network/ice-config',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer signed-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sessionToken: 'match-session-token',
          forceRelay: false,
        }),
      },
    );
  });

  it('uses the local account header only when no bearer token is available', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
    })) as unknown as typeof fetch;

    await fetchMatchmakingIceConfig(
      'http://localhost:8787',
      true,
      { accountId: '11111111-1111-4111-8111-111111111111' },
      {
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sessionToken: 'match-session-token',
      },
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/matchmaking/network/ice-config',
      {
        method: 'POST',
        headers: {
          'x-account-id': '11111111-1111-4111-8111-111111111111',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sessionToken: 'match-session-token',
          forceRelay: true,
        }),
      },
    );
  });
});

describe('postConnectionTelemetry', () => {
  it('posts telemetry payload and returns true when accepted', async () => {
    const mockFetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const ok = await postConnectionTelemetry(
      'http://localhost:8787',
      '11111111-1111-4111-8111-111111111111',
      {
        queueType: 'ranked',
        region: 'us-east',
        connectionPath: 'relay',
        transport: 'webrtc',
      },
      mockFetch,
    );
    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
