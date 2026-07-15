import assert from 'node:assert/strict';
import test from 'node:test';
import { requestUsesMatchmakingRuntime } from './runtimeRoutePolicy';

test('keeps signaling publish and poll outside the global runtime lease', () => {
  assert.equal(
    requestUsesMatchmakingRuntime('/matchmaking/sessions/session-id/signals'),
    false,
  );
  assert.equal(
    requestUsesMatchmakingRuntime(
      '/matchmaking/sessions/session-id/signals?transportAttemptId=attempt&afterSignalId=0',
    ),
    false,
  );
});

test('continues to coordinate stateful matchmaking and ranked result routes', () => {
  assert.equal(requestUsesMatchmakingRuntime('/matchmaking/queue/join'), true);
  assert.equal(
    requestUsesMatchmakingRuntime('/matchmaking/sessions/session-id/transport-attempts'),
    true,
  );
  assert.equal(
    requestUsesMatchmakingRuntime('/matchmaking/sessions/session-id/signals/extra'),
    true,
  );
  assert.equal(requestUsesMatchmakingRuntime('/ranked/results/session-id'), true);
  assert.equal(requestUsesMatchmakingRuntime('/health'), false);
});
