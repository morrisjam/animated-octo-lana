import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRankedAnomalies } from './anomalyDetection';

test('detects impossible cadence anomalies', () => {
  const alerts = detectRankedAnomalies({
    occurredAtIso: '2026-02-14T12:00:10.000Z',
    previousMatchAtIso: '2026-02-14T12:00:00.000Z',
    ratingDelta: 8,
    mrDelta: null,
    minMatchIntervalSeconds: 30,
    ratingJumpThreshold: 50,
    mrJumpThreshold: 70,
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'impossible_cadence');
});

test('detects rating and mr jump anomalies together', () => {
  const alerts = detectRankedAnomalies({
    occurredAtIso: '2026-02-14T12:15:00.000Z',
    previousMatchAtIso: '2026-02-14T12:00:00.000Z',
    ratingDelta: 75,
    mrDelta: 90,
    minMatchIntervalSeconds: 30,
    ratingJumpThreshold: 50,
    mrJumpThreshold: 70,
  });

  assert.equal(alerts.length, 2);
  assert.ok(alerts.some((alert) => alert.type === 'rating_jump'));
  assert.ok(alerts.some((alert) => alert.type === 'mr_jump'));
});

test('returns no alerts for normal cadence and deltas', () => {
  const alerts = detectRankedAnomalies({
    occurredAtIso: '2026-02-14T12:30:00.000Z',
    previousMatchAtIso: '2026-02-14T12:00:00.000Z',
    ratingDelta: 12,
    mrDelta: 8,
    minMatchIntervalSeconds: 30,
    ratingJumpThreshold: 50,
    mrJumpThreshold: 70,
  });

  assert.equal(alerts.length, 0);
});
