import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomService } from './roomService';

const HOST_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const GUEST_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT = '33333333-3333-4333-8333-333333333333';

test('create room generates server-side room code and host participant', () => {
  const rooms = createRoomService();
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
  });

  assert.equal(room.roomCode.length, 6);
  assert.match(room.roomCode, /^[A-Z0-9]+$/);
  assert.equal(room.status, 'open');
  assert.equal(room.hostAccountId, HOST_ACCOUNT);
  assert.equal(room.participants.length, 1);
  assert.equal(room.participants[0].accountId, HOST_ACCOUNT);
  assert.equal(room.participants[0].role, 'player');
});

test('room expires after idle timeout', () => {
  let nowMs = 1_000_000;
  const rooms = createRoomService({
    idleTimeoutSeconds: 2,
    now: () => nowMs,
  });
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
  });
  nowMs += 3_000;
  const roomState = rooms.getRoomForAccount(room.roomCode, HOST_ACCOUNT);
  assert.ok(roomState);
  assert.equal(roomState.status, 'closed');
  assert.equal(roomState.closedReason, 'idle_timeout');
});

test('non-host cannot start, close, or update room settings', () => {
  const rooms = createRoomService();
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
  });

  const startDenied = rooms.startRoomSession(room.roomCode, OTHER_ACCOUNT);
  assert.equal(startDenied.ok, false);
  if (startDenied.ok) {
    throw new Error('Expected host-only start control');
  }
  assert.equal(startDenied.error.code, 'forbidden');

  const closeDenied = rooms.closeRoom(room.roomCode, OTHER_ACCOUNT);
  assert.equal(closeDenied.ok, false);
  if (closeDenied.ok) {
    throw new Error('Expected host-only close control');
  }
  assert.equal(closeDenied.error.code, 'forbidden');

  const settingsDenied = rooms.updateRoomSettings({
    roomCode: room.roomCode,
    accountId: OTHER_ACCOUNT,
    locked: true,
  });
  assert.equal(settingsDenied.ok, false);
  if (settingsDenied.ok) {
    throw new Error('Expected host-only settings control');
  }
  assert.equal(settingsDenied.error.code, 'forbidden');
});

test('join by code validates region and build version compatibility', () => {
  const rooms = createRoomService();
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
    requiredRegion: 'us-east',
    requiredBuildVersion: '0.1.0',
  });

  const wrongRegion = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    platform: 'web',
    region: 'eu-west',
    buildVersion: '0.1.0',
  });
  assert.equal(wrongRegion.ok, false);
  if (wrongRegion.ok) {
    throw new Error('Expected join region mismatch');
  }
  assert.equal(wrongRegion.error.code, 'region_mismatch');

  const wrongVersion = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    platform: 'web',
    region: 'us-east',
    buildVersion: '0.2.0',
  });
  assert.equal(wrongVersion.ok, false);
  if (wrongVersion.ok) {
    throw new Error('Expected join version mismatch');
  }
  assert.equal(wrongVersion.error.code, 'version_mismatch');

  const accepted = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    platform: 'web',
    region: 'us-east',
    buildVersion: '0.1.0',
  });
  assert.equal(accepted.ok, true);
});

test('host lock and spectator allowance control join behaviour', () => {
  const rooms = createRoomService({
    maxSpectators: 2,
  });
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
    allowSpectators: false,
  });

  const spectatorDenied = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    platform: 'web',
    role: 'spectator',
  });
  assert.equal(spectatorDenied.ok, false);
  if (spectatorDenied.ok) {
    throw new Error('Expected spectator join denial');
  }
  assert.equal(spectatorDenied.error.code, 'spectators_disabled');

  const unlockSpectators = rooms.updateRoomSettings({
    roomCode: room.roomCode,
    accountId: HOST_ACCOUNT,
    allowSpectators: true,
  });
  assert.equal(unlockSpectators.ok, true);

  const spectatorAccepted = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    platform: 'web',
    role: 'spectator',
  });
  assert.equal(spectatorAccepted.ok, true);

  const lockRoom = rooms.updateRoomSettings({
    roomCode: room.roomCode,
    accountId: HOST_ACCOUNT,
    locked: true,
  });
  assert.equal(lockRoom.ok, true);

  const joinDeniedByLock = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: OTHER_ACCOUNT,
    platform: 'steam',
    role: 'player',
  });
  assert.equal(joinDeniedByLock.ok, false);
  if (joinDeniedByLock.ok) {
    throw new Error('Expected lock join denial');
  }
  assert.equal(joinDeniedByLock.error.code, 'room_locked');
});

test('character select and ready checks run per rematch, membership persists, and history records outcomes', () => {
  const rooms = createRoomService();
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
  });
  const joined = rooms.joinRoom({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    platform: 'steam',
    role: 'player',
  });
  assert.equal(joined.ok, true);

  const started = rooms.startRoomSession(room.roomCode, HOST_ACCOUNT);
  assert.equal(started.ok, true);
  if (!started.ok) {
    throw new Error('Expected room session start');
  }
  assert.equal(started.value.activeSession?.phase, 'character_select');
  assert.equal(started.value.activeSession?.rematchIndex, 1);
  assert.equal(started.value.history.length, 0);
  assert.equal(started.value.participants.filter((participant) => participant.role === 'player').length, 2);

  const hostSelect = rooms.setCharacterSelection({
    roomCode: room.roomCode,
    accountId: HOST_ACCOUNT,
    characterId: 'striker_alpha',
  });
  assert.equal(hostSelect.ok, true);
  if (!hostSelect.ok) {
    throw new Error('Expected host character select');
  }
  assert.equal(hostSelect.value.activeSession?.phase, 'character_select');

  const guestSelect = rooms.setCharacterSelection({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    characterId: 'bruiser_beta',
  });
  assert.equal(guestSelect.ok, true);
  if (!guestSelect.ok) {
    throw new Error('Expected guest character select');
  }
  assert.equal(guestSelect.value.activeSession?.phase, 'ready_check');

  const hostReady = rooms.setReadyState({
    roomCode: room.roomCode,
    accountId: HOST_ACCOUNT,
    ready: true,
  });
  assert.equal(hostReady.ok, true);
  if (!hostReady.ok) {
    throw new Error('Expected host ready');
  }
  assert.equal(hostReady.value.activeSession?.phase, 'ready_check');

  const guestReady = rooms.setReadyState({
    roomCode: room.roomCode,
    accountId: GUEST_ACCOUNT,
    ready: true,
  });
  assert.equal(guestReady.ok, true);
  if (!guestReady.ok) {
    throw new Error('Expected guest ready');
  }
  assert.equal(guestReady.value.activeSession?.phase, 'in_match');

  const outcome = rooms.recordMatchOutcome({
    roomCode: room.roomCode,
    accountId: HOST_ACCOUNT,
    outcome: 'win',
    winnerAccountId: GUEST_ACCOUNT,
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    throw new Error('Expected outcome recording');
  }
  assert.equal(outcome.value.activeSession?.phase, 'completed');
  assert.equal(outcome.value.history.length, 1);
  assert.equal(outcome.value.history[0].matchId, outcome.value.activeSession?.sessionId);
  assert.equal(outcome.value.history[0].winnerAccountId, GUEST_ACCOUNT);

  const rematch = rooms.startRematch(room.roomCode, HOST_ACCOUNT);
  assert.equal(rematch.ok, true);
  if (!rematch.ok) {
    throw new Error('Expected rematch start');
  }
  assert.equal(rematch.value.activeSession?.phase, 'character_select');
  assert.equal(rematch.value.activeSession?.rematchIndex, 2);
  assert.equal(rematch.value.history.length, 1);
  assert.equal(rematch.value.participants.filter((participant) => participant.role === 'player').length, 2);
  assert.equal(rematch.value.activeSession?.players.every((player) => player.characterId === null), true);
  assert.equal(rematch.value.activeSession?.players.every((player) => player.ready === false), true);
});

test('invite path supports web and steam flows', () => {
  const rooms = createRoomService({
    webInviteBaseUrl: 'https://gravitywell.example',
    steamAppId: '123456',
  });
  const room = rooms.createRoom({
    hostAccountId: HOST_ACCOUNT,
    hostPlatform: 'web',
  });

  const webInvite = rooms.getInvite(room.roomCode, HOST_ACCOUNT, 'web');
  assert.equal(webInvite.ok, true);
  if (!webInvite.ok) {
    throw new Error('Expected web invite to succeed');
  }
  assert.equal(webInvite.value.flow, 'web_friend');
  assert.equal(webInvite.value.inviteValue, `https://gravitywell.example/?room=${room.roomCode}`);

  const steamInvite = rooms.getInvite(room.roomCode, HOST_ACCOUNT, 'steam');
  assert.equal(steamInvite.ok, true);
  if (!steamInvite.ok) {
    throw new Error('Expected steam invite to succeed');
  }
  assert.equal(steamInvite.value.flow, 'steam_friend');
  assert.equal(steamInvite.value.inviteValue, `steam://run/123456//+join_room ${room.roomCode}`);
});
