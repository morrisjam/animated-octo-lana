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
        };
      },
    })) as unknown as typeof fetch;

    const config = await fetchMatchmakingIceConfig('http://localhost:8787', false, mockFetch);
    expect(config?.fallbackPolicy).toBe('relay');
    expect(mockFetch).toHaveBeenCalledTimes(1);
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
