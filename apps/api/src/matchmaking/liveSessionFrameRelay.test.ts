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

  const response = relay.getPeerFrames(SESSION_ID, ACCOUNT_2, 0);
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

  const response = relay.getPeerFrames(SESSION_ID, ACCOUNT_2, -1);
  assert.deepEqual(response.frames.map((frame) => frame.frame), [2, 3, 4]);
});
