import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMatchmakingNetworkConfig,
  createMatchmakingNetworkConfigFromEnv,
  createMatchmakingNetworkConfigServiceFromEnv,
  createTimeLimitedTurnCredentials,
} from './networkConfig';

test('uses default STUN config when no env values are provided', () => {
  const config = createMatchmakingNetworkConfig();
  assert.equal(config.iceServers.length, 1);
  assert.equal(config.iceServers[0].urls[0], 'stun:stun.l.google.com:19302');
  assert.equal(config.iceTransportPolicy, 'all');
  assert.equal(config.fallbackPolicy, 'relay');
  assert.equal(config.relayAvailable, false);
  assert.equal(config.turnCredentialMode, 'none');
  assert.equal(config.directConnectTimeoutMs, 8_000);
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
  assert.equal(config.relayAvailable, true);
  assert.equal(config.turnCredentialMode, 'static');
});

test('issues deterministic time-limited TURN REST credentials', () => {
  const credentials = createTimeLimitedTurnCredentials({
    sharedSecret: 'turn-shared-secret-for-tests',
    accountId: '11111111-1111-4111-8111-111111111111',
    ttlSeconds: 600,
    now: () => 1_710_000_000_000,
  });

  assert.equal(credentials.username, '1710000600:11111111-1111-4111-8111-111111111111');
  assert.equal(credentials.expiresAt, '2024-03-09T16:10:00.000Z');
  assert.equal(credentials.credential, '+AaYMJgua1p+kPMJA+nJbJkiSqU=');
});

test('prefers short-lived credentials and keeps secrets out of public status', () => {
  const service = createMatchmakingNetworkConfigServiceFromEnv({
    MATCHMAKING_STUN_URLS: 'stun:stun.example.net:3478',
    MATCHMAKING_TURN_URLS: 'turn:turn.example.net:3478?transport=udp',
    MATCHMAKING_TURN_SHARED_SECRET: 'turn-shared-secret-for-tests',
    MATCHMAKING_TURN_USERNAME: 'legacy-user',
    MATCHMAKING_TURN_CREDENTIAL: 'legacy-password',
    MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS: '600',
  }, {
    now: () => 1_710_000_000_000,
  });

  const status = service.getStatus();
  assert.deepEqual(status, {
    iceTransportPolicy: 'all',
    fallbackPolicy: 'relay',
    directConnectTimeoutMs: 8_000,
    relayAvailable: true,
    turnCredentialMode: 'time_limited',
  });
  assert.equal(JSON.stringify(status).includes('turn-shared-secret-for-tests'), false);
  assert.equal(JSON.stringify(status).includes('legacy-password'), false);

  const config = service.issueConfig('11111111-1111-4111-8111-111111111111', { forceRelay: true });
  assert.equal(config.iceTransportPolicy, 'relay');
  assert.equal(config.turnCredentialMode, 'time_limited');
  assert.equal(config.turnCredentialExpiresAt, '2024-03-09T16:10:00.000Z');
  assert.equal(config.iceServers[1].username, '1710000600:11111111-1111-4111-8111-111111111111');
  assert.equal(config.iceServers[1].credential, '+AaYMJgua1p+kPMJA+nJbJkiSqU=');
  assert.equal(JSON.stringify(config).includes('turn-shared-secret-for-tests'), false);
  assert.equal(JSON.stringify(config).includes('legacy-password'), false);
});

test('retains static TURN credentials as a compatibility fallback', () => {
  const service = createMatchmakingNetworkConfigServiceFromEnv({
    MATCHMAKING_TURN_URLS: 'turn:turn.example.net:3478',
    MATCHMAKING_TURN_USERNAME: 'turn-user',
    MATCHMAKING_TURN_CREDENTIAL: 'turn-password',
  });

  assert.equal(service.getStatus().turnCredentialMode, 'static');
  assert.equal(service.issueConfig('11111111-1111-4111-8111-111111111111').relayAvailable, true);
});

test('rejects an undersized TURN shared secret', () => {
  assert.throws(
    () => createMatchmakingNetworkConfigServiceFromEnv({
      MATCHMAKING_TURN_URLS: 'turn:turn.example.net:3478',
      MATCHMAKING_TURN_SHARED_SECRET: 'too-short',
    }),
    /at least 16 characters/,
  );
});
