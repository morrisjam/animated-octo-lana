import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceInviteService } from './presenceInviteService';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_C = '33333333-3333-4333-8333-333333333333';

test('presence updates expose privacy-safe activity fields and expire by TTL', () => {
  let nowMs = 1_000_000;
  const service = createPresenceInviteService({
    now: () => nowMs,
    presenceTtlMs: 5_000,
  });

  const update = service.setPresence(ACCOUNT_A, 'online', {
    type: 'room',
    roomCode: 'ab12cd',
  });
  assert.equal(update.ok, true);
  if (!update.ok) {
    throw new Error('Expected presence update to succeed');
  }
  assert.equal(update.presence.activity.type, 'room');
  if (update.presence.activity.type !== 'room') {
    throw new Error('Expected room activity');
  }
  assert.equal(update.presence.activity.inRoom, true);

  const listed = service.listPresence([ACCOUNT_A]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'online');

  nowMs += 5_100;
  assert.equal(service.getPresence(ACCOUNT_A), null);
});

test('presence updates are rate limited per account window', () => {
  let nowMs = 2_000_000;
  const service = createPresenceInviteService({
    now: () => nowMs,
    presenceRateWindowMs: 1_000,
    maxPresenceUpdatesPerWindow: 2,
  });

  assert.equal(service.setPresence(ACCOUNT_A, 'online', { type: 'home' }).ok, true);
  assert.equal(service.setPresence(ACCOUNT_A, 'away', { type: 'match' }).ok, true);

  const limited = service.setPresence(ACCOUNT_A, 'online', { type: 'queue', queueType: 'ranked' });
  assert.equal(limited.ok, false);
  if (limited.ok) {
    throw new Error('Expected presence rate limit to trigger');
  }
  assert.equal(limited.code, 'rate_limited');

  nowMs += 1_001;
  const retry = service.setPresence(ACCOUNT_A, 'online', { type: 'home' });
  assert.equal(retry.ok, true);
});

test('room invite payload includes room code and web plus steam deep links', () => {
  const service = createPresenceInviteService({
    webInviteBaseUrl: 'https://play.gravitywell.space',
    steamAppId: '123456',
    idGenerator: () => 'invite-room',
  });

  const result = service.sendInvite({
    fromAccountId: ACCOUNT_A,
    toAccountId: ACCOUNT_B,
    context: {
      type: 'room',
      roomCode: 'gw42',
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error('Expected room invite to succeed');
  }
  assert.equal(result.invite.context.type, 'room');
  if (result.invite.context.type !== 'room') {
    throw new Error('Expected room invite context');
  }
  assert.equal(result.invite.context.roomCode, 'GW42');
  assert.equal(result.invite.payload.roomCode, 'GW42');
  assert.equal(result.invite.payload.deepLinks.web, 'https://play.gravitywell.space/?room=GW42');
  assert.equal(result.invite.payload.deepLinks.steam, 'steam://run/123456//+join_room GW42');
});

test('queue invite payload includes queue link and invite send is rate limited', () => {
  const service = createPresenceInviteService({
    webInviteBaseUrl: 'https://play.gravitywell.space',
    steamAppId: '789',
    inviteRateWindowMs: 60_000,
    maxInvitesPerWindow: 1,
    idGenerator: () => 'invite-queue',
  });

  const first = service.sendInvite({
    fromAccountId: ACCOUNT_A,
    toAccountId: ACCOUNT_B,
    context: {
      type: 'queue',
      queueType: 'unranked',
    },
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    throw new Error('Expected queue invite to succeed');
  }
  assert.equal(first.invite.payload.queueType, 'unranked');
  assert.equal(first.invite.payload.deepLinks.web, 'https://play.gravitywell.space/?queue=unranked');
  assert.equal(first.invite.payload.deepLinks.steam, 'steam://run/789//+join_queue unranked');

  const limited = service.sendInvite({
    fromAccountId: ACCOUNT_A,
    toAccountId: ACCOUNT_C,
    context: {
      type: 'queue',
      queueType: 'ranked',
    },
  });
  assert.equal(limited.ok, false);
  if (limited.ok) {
    throw new Error('Expected invite rate limit to trigger');
  }
  assert.equal(limited.code, 'rate_limited');
});

test('invites can be listed, cancelled by sender or target, and expire', () => {
  let nowMs = 3_000_000;
  let inviteIndex = 0;
  const service = createPresenceInviteService({
    now: () => nowMs,
    inviteTtlMs: 200,
    idGenerator: () => `invite-${inviteIndex += 1}`,
  });

  const sent = service.sendInvite({
    fromAccountId: ACCOUNT_A,
    toAccountId: ACCOUNT_B,
    context: {
      type: 'room',
      roomCode: 'ABCD',
    },
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) {
    throw new Error('Expected invite send success');
  }

  const inviteId = sent.invite.inviteId;
  assert.equal(service.listInvitesForTarget(ACCOUNT_B).length, 1);
  assert.equal(service.cancelInvite(inviteId, ACCOUNT_C), false);
  assert.equal(service.cancelInvite(inviteId, ACCOUNT_B), true);
  assert.equal(service.listInvitesForTarget(ACCOUNT_B).length, 0);

  const sentTwo = service.sendInvite({
    fromAccountId: ACCOUNT_A,
    toAccountId: ACCOUNT_B,
    context: {
      type: 'queue',
      queueType: 'ranked',
    },
  });
  assert.equal(sentTwo.ok, true);
  if (!sentTwo.ok) {
    throw new Error('Expected second invite send success');
  }

  nowMs += 250;
  assert.equal(service.listInvitesForTarget(ACCOUNT_B).length, 0);
});
