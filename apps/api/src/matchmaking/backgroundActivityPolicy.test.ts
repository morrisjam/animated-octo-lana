import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunMatchmakingCheckpoint } from './backgroundActivityPolicy';

test('suppresses idle matchmaking checkpoints without suppressing resident work', () => {
  assert.equal(shouldRunMatchmakingCheckpoint({ tickets: [], sessions: [] }, 0), false);
  assert.equal(shouldRunMatchmakingCheckpoint({ tickets: [{}], sessions: [] }, 0), true);
  assert.equal(shouldRunMatchmakingCheckpoint({ tickets: [], sessions: [{}] }, 0), true);
  assert.equal(shouldRunMatchmakingCheckpoint({ tickets: [], sessions: [] }, 1), true);
  assert.equal(shouldRunMatchmakingCheckpoint({ tickets: [], sessions: [] }, 0, true), true);
});
