import { describe, expect, it } from 'vitest';
import { buildLocalSmokeRtcConfiguration } from './localSmokeIceConfig';

const iceServers: RTCIceServer[] = [
  { urls: ['stun:127.0.0.1:3478', 'turn:127.0.0.1:3478?transport=udp'] },
  {
    urls: 'turns:relay.example.test:5349?transport=tcp',
    username: 'temporary-user',
    credential: 'temporary-credential',
  },
];

describe('buildLocalSmokeRtcConfiguration', () => {
  it('removes every TURN candidate from a direct-path proof', () => {
    const result = buildLocalSmokeRtcConfiguration({
      iceServers,
      iceTransportPolicy: 'all',
    }, false);

    expect(result).toEqual({
      iceServers: [{ urls: ['stun:127.0.0.1:3478'] }],
      iceTransportPolicy: 'all',
    });
    expect(iceServers[0].urls).toEqual([
      'stun:127.0.0.1:3478',
      'turn:127.0.0.1:3478?transport=udp',
    ]);
  });

  it('uses host candidates when the API provides only TURN servers', () => {
    const result = buildLocalSmokeRtcConfiguration({
      iceServers: [iceServers[1]],
      iceTransportPolicy: 'all',
    }, false);

    expect(result.iceServers).toEqual([]);
    expect(result.iceTransportPolicy).toBe('all');
  });

  it('retains all servers and forces relay for the relay proof', () => {
    const result = buildLocalSmokeRtcConfiguration({
      iceServers,
      iceTransportPolicy: 'all',
    }, true);

    expect(result).toEqual({
      iceServers: [
        { urls: ['stun:127.0.0.1:3478', 'turn:127.0.0.1:3478?transport=udp'] },
        {
          urls: ['turns:relay.example.test:5349?transport=tcp'],
          username: 'temporary-user',
          credential: 'temporary-credential',
        },
      ],
      iceTransportPolicy: 'relay',
    });
  });
});
