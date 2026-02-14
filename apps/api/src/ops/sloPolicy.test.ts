import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSloSummary, evaluateSloAlerts } from './sloPolicy';

test('deriveSloSummary computes percentages with rounding', () => {
  const summary = deriveSloSummary(1000, 995, 5, 342.6);
  assert.equal(summary.availabilityPercent, 99.5);
  assert.equal(summary.errorRatePercent, 0.5);
  assert.equal(summary.latencyP95Ms, 343);
});

test('evaluateSloAlerts emits no alerts when all targets pass', () => {
  const summary = deriveSloSummary(1000, 998, 2, 290);
  const alerts = evaluateSloAlerts(summary, {
    availabilityPercent: 99.5,
    errorRatePercent: 1,
    latencyP95Ms: 350,
  });
  assert.equal(alerts.length, 0);
});

test('evaluateSloAlerts emits all configured breach alerts', () => {
  const summary = deriveSloSummary(1000, 980, 20, 500);
  const alerts = evaluateSloAlerts(summary, {
    availabilityPercent: 99.5,
    errorRatePercent: 1,
    latencyP95Ms: 350,
  });
  assert.equal(alerts.length, 3);
  assert.ok(alerts.some((alert) => alert.code === 'availability_breach'));
  assert.ok(alerts.some((alert) => alert.code === 'error_rate_breach'));
  assert.ok(alerts.some((alert) => alert.code === 'latency_p95_breach'));
});
