import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectivityTelemetryStore } from './connectivityTelemetry';

test('tracks direct vs relay counts by region', () => {
  const store = createConnectivityTelemetryStore();
  store.record({
    accountId: '11111111-1111-4111-8111-111111111111',
    queueType: 'ranked',
    region: 'us-east',
    connectionPath: 'direct',
    transport: 'webrtc',
  });
  store.record({
    accountId: '22222222-2222-4222-8222-222222222222',
    queueType: 'ranked',
    region: 'us-east',
    connectionPath: 'relay',
    transport: 'webrtc',
  });
  store.record({
    accountId: '33333333-3333-4333-8333-333333333333',
    queueType: 'unranked',
    region: 'eu-west',
    connectionPath: 'relay',
    transport: 'steam_sockets',
  });

  const summary = store.getSummary();
  assert.equal(summary.totalEvents, 3);
  assert.equal(summary.directCount, 1);
  assert.equal(summary.relayCount, 2);
  assert.equal(summary.byRegion['us-east'].total, 2);
  assert.equal(summary.byRegion['us-east'].direct, 1);
  assert.equal(summary.byRegion['us-east'].relay, 1);
  assert.equal(summary.byRegion['eu-west'].relay, 1);
});

test('drops old telemetry outside retention window', () => {
  let nowMs = 1_000_000;
  const store = createConnectivityTelemetryStore({
    retentionMs: 500,
    now: () => nowMs,
  });

  store.record({
    accountId: '11111111-1111-4111-8111-111111111111',
    queueType: 'ranked',
    region: 'us-west',
    connectionPath: 'direct',
    transport: 'webrtc',
  });
  nowMs += 750;
  store.record({
    accountId: '22222222-2222-4222-8222-222222222222',
    queueType: 'ranked',
    region: 'us-west',
    connectionPath: 'relay',
    transport: 'webrtc',
  });

  const summary = store.getSummary();
  assert.equal(summary.totalEvents, 1);
  assert.equal(summary.directCount, 0);
  assert.equal(summary.relayCount, 1);
});
