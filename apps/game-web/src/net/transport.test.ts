import { describe, expect, it } from 'vitest';
import {
  RelayFallbackController,
  buildRtcConfiguration,
  type MatchmakingIceConfig,
} from './transport';

const EXAMPLE_CONFIG: MatchmakingIceConfig = {
  iceServers: [
    { urls: ['stun:stun.example.net:3478'] },
    {
      urls: ['turn:turn.example.net:3478?transport=udp'],
      username: 'turn_user',
      credential: 'turn_pass',
    },
  ],
  iceTransportPolicy: 'all',
  fallbackPolicy: 'relay',
  directConnectTimeoutMs: 1800,
};

describe('RelayFallbackController', () => {
  it('keeps direct path before timeout', () => {
    const controller = new RelayFallbackController({ directConnectTimeoutMs: 1800 });
    controller.startDirectAttempt(0);
    expect(controller.shouldFallbackToRelay(1200)).toBe(false);
    expect(controller.getCurrentPath()).toBe('direct');
  });

  it('switches to relay after timeout when not connected', () => {
    const controller = new RelayFallbackController({ directConnectTimeoutMs: 1800 });
    controller.startDirectAttempt(0);
    expect(controller.shouldFallbackToRelay(1801)).toBe(true);
    controller.applyRelayFallback();
    expect(controller.getCurrentPath()).toBe('relay');
  });

  it('does not fallback once direct path is connected', () => {
    const controller = new RelayFallbackController({ directConnectTimeoutMs: 1800 });
    controller.startDirectAttempt(0);
    controller.markConnected();
    expect(controller.shouldFallbackToRelay(5000)).toBe(false);
    expect(controller.getCurrentPath()).toBe('direct');
  });
});

describe('buildRtcConfiguration', () => {
  it('uses relay transport policy when fallback path is relay', () => {
    const rtcConfig = buildRtcConfiguration(EXAMPLE_CONFIG, 'relay');
    expect(rtcConfig.iceTransportPolicy).toBe('relay');
    expect(rtcConfig.iceServers).toHaveLength(2);
  });

  it('uses base transport policy for direct path', () => {
    const rtcConfig = buildRtcConfiguration(EXAMPLE_CONFIG, 'direct');
    expect(rtcConfig.iceTransportPolicy).toBe('all');
  });
});
