import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveSessionFrameRelay } from './liveSessionFrameRelay';

const SESSION_ID = 'session-1';
const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';

test('returns only peer frames newer than requested frame', () => {
  const relay = createLiveSessionFrameRelay();

  relay.submitFrames({
    sessionId: SESSION_ID,
    accountId: ACCOUNT_1,
    frames: [
      {
        frame: 0,
        input: {
          moveX: 1,
          moveY: 0,
          boost: false,
          superBoost: false,
          special: false,
          launch: false,
          dunk: false,
          parry: false,
          breakLaunch: false,
        },
      },
      {
        frame: 2,
        input: {
          moveX: 0,
          moveY: -1,
          boost: true,
          superBoost: false,
          special: false,
          launch: false,
          dunk: false,
          parry: false,
          breakLaunch: false,
        },
      },
    ],
  });

  relay.submitFrames({
    sessionId: SESSION_ID,
    accountId: ACCOUNT_2,
    frames: [
      {
        frame: 1,
        input: {
          moveX: -1,
          moveY: 0,
          boost: false,
          superBoost: false,
          special: false,
          launch: true,
          dunk: false,
          parry: false,
          breakLaunch: false,
        },
      },
    ],
  });

  const response = relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 0, 0);
  assert.equal(response.frames.length, 1);
  assert.equal(response.frames[0]?.frame, 2);
  assert.equal(response.frames[0]?.accountId, ACCOUNT_1);
  assert.equal(response.frames[0]?.input.boost, true);
});

test('prunes old frames when account history exceeds limit', () => {
  const relay = createLiveSessionFrameRelay({ maxFramesPerAccount: 3 });

  for (let frame = 0; frame < 5; frame += 1) {
    relay.submitFrames({
      sessionId: SESSION_ID,
      accountId: ACCOUNT_1,
      frames: [{
        frame,
        input: {
          moveX: frame,
          moveY: 0,
          boost: false,
          superBoost: false,
          special: false,
          launch: false,
          dunk: false,
          parry: false,
          breakLaunch: false,
        },
      }],
    });
  }

  const response = relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 0, -1);
  assert.deepEqual(response.frames.map((frame) => frame.frame), [2, 3, 4]);
});

test('clears all buffered frames when a session resolves', () => {
  const relay = createLiveSessionFrameRelay();
  relay.submitFrames({
    sessionId: SESSION_ID,
    accountId: ACCOUNT_1,
    frames: [{
      frame: 12,
      input: {
        moveX: 1,
        moveY: 0,
        boost: false,
        superBoost: false,
        special: false,
        launch: false,
        dunk: false,
        parry: false,
        breakLaunch: false,
      },
    }],
  });

  relay.clearSession(SESSION_ID);

  assert.deepEqual(relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 0, -1), {
    frames: [],
    peerConfirmedThrough: -1,
  });
});

test('isolates repeated frame ids by round epoch', () => {
  const relay = createLiveSessionFrameRelay();
  relay.submitFrames({
    sessionId: SESSION_ID,
    accountId: ACCOUNT_1,
    frames: [0, 1].map((epoch) => ({
      epoch,
      frame: 0,
      input: {
        moveX: epoch === 0 ? -1 : 1,
        moveY: 0,
        boost: false,
        superBoost: false,
        special: false,
        launch: false,
        dunk: false,
        parry: false,
        breakLaunch: false,
      },
    })),
  });

  const firstRound = relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 0, -1);
  const secondRound = relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 1, -1);
  assert.equal(firstRound.frames[0]?.input.moveX, -1);
  assert.equal(secondRound.frames[0]?.input.moveX, 1);
  assert.equal(firstRound.frames[0]?.epoch, 0);
  assert.equal(secondRound.frames[0]?.epoch, 1);
});

test('reports only the peer confirmation for the requested epoch', () => {
  const relay = createLiveSessionFrameRelay();
  assert.equal(relay.confirmPeerFrames(SESSION_ID, ACCOUNT_1, 0, 8), 8);
  assert.equal(relay.confirmPeerFrames(SESSION_ID, ACCOUNT_1, 0, 6), 8);
  assert.equal(relay.confirmPeerFrames(SESSION_ID, ACCOUNT_1, 1, 2), 2);

  assert.equal(relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 0, -1).peerConfirmedThrough, 8);
  assert.equal(relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 1, -1).peerConfirmedThrough, 2);
  assert.equal(relay.getPeerFrames(SESSION_ID, ACCOUNT_1, 0, -1).peerConfirmedThrough, -1);
});
