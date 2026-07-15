import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveLivenessResolutionTimeoutMs } from './authoritativeForfeitSmokeTiming';

test('explicit disconnect budget covers reconnect grace plus scheduler cushion', () => {
  assert.equal(deriveLivenessResolutionTimeoutMs({
    configuredMinimumMs: 2_000,
    heartbeatTimeoutSeconds: 0,
    reconnectGraceSeconds: 20,
  }), 25_000);
});

test('double-silence budget covers heartbeat timeout and reconnect grace', () => {
  assert.equal(deriveLivenessResolutionTimeoutMs({
    configuredMinimumMs: 30_000,
    heartbeatTimeoutSeconds: 30,
    reconnectGraceSeconds: 20,
  }), 55_000);
});

test('operator minimum remains authoritative when it is longer than the schedule', () => {
  assert.equal(deriveLivenessResolutionTimeoutMs({
    configuredMinimumMs: 90_000,
    heartbeatTimeoutSeconds: 30,
    reconnectGraceSeconds: 20,
  }), 90_000);
});

test('invalid schedule values fail instead of creating an unbounded smoke', () => {
  assert.throws(() => deriveLivenessResolutionTimeoutMs({
    configuredMinimumMs: 30_000,
    heartbeatTimeoutSeconds: Number.NaN,
    reconnectGraceSeconds: 20,
  }), /heartbeatTimeoutSeconds/);
});
