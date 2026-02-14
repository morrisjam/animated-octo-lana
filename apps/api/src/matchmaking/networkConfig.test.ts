import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMatchmakingNetworkConfig,
  createMatchmakingNetworkConfigFromEnv,
} from './networkConfig';

test('uses default STUN config when no env values are provided', () => {
  const config = createMatchmakingNetworkConfig();
  assert.equal(config.iceServers.length, 1);
  assert.equal(config.iceServers[0].urls[0], 'stun:stun.l.google.com:19302');
  assert.equal(config.iceTransportPolicy, 'all');
  assert.equal(config.fallbackPolicy, 'relay');
});

test('uses STUN and TURN config when TURN credentials are present', () => {
  const config = createMatchmakingNetworkConfigFromEnv({
    MATCHMAKING_STUN_URLS: 'stun:stun1.example.net:3478,stun:stun2.example.net:3478',
    MATCHMAKING_TURN_URLS: 'turn:turn.example.net:3478?transport=udp',
    MATCHMAKING_TURN_USERNAME: 'turn_user',
    MATCHMAKING_TURN_CREDENTIAL: 'turn_pass',
    MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS: '2400',
  });
  assert.equal(config.iceServers.length, 2);
  assert.deepEqual(config.iceServers[0].urls, [
    'stun:stun1.example.net:3478',
    'stun:stun2.example.net:3478',
  ]);
  assert.equal(config.iceServers[1].username, 'turn_user');
  assert.equal(config.iceServers[1].credential, 'turn_pass');
  assert.equal(config.directConnectTimeoutMs, 2400);
});
