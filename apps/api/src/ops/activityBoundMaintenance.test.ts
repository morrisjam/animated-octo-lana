import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActivityBoundMaintenanceScheduler,
  isInfrastructureProbe,
  shouldTriggerDatabaseMaintenance,
} from './activityBoundMaintenance';

test('classifies infrastructure probes as database-maintenance neutral', () => {
  assert.equal(isInfrastructureProbe('/health'), true);
  assert.equal(isInfrastructureProbe('/health/?provider=render'), true);
  assert.equal(isInfrastructureProbe('/readyz'), true);
  assert.equal(isInfrastructureProbe('/accounts'), false);
  assert.equal(shouldTriggerDatabaseMaintenance('GET', '/health'), false);
  assert.equal(shouldTriggerDatabaseMaintenance('GET', '/readyz'), false);
  assert.equal(shouldTriggerDatabaseMaintenance('OPTIONS', '/accounts'), false);
  assert.equal(shouldTriggerDatabaseMaintenance('POST', '/matchmaking/queue/join'), true);
});
test('runs due maintenance only in response to real activity', async () => {
  let nowMs = 1_000;
  const runs: string[] = [];
  const scheduler = new ActivityBoundMaintenanceScheduler([
    { id: 'fast', intervalMs: 100, run: async () => { runs.push('fast'); } },
    { id: 'slow', intervalMs: 500, run: async () => { runs.push('slow'); } },
  ], { now: () => nowMs });

  nowMs = 1_099;
  await scheduler.notifyActivity();
  assert.deepEqual(runs, []);

  // Merely advancing time cannot execute a task because the scheduler owns no timer.
  nowMs = 1_500;
  assert.deepEqual(runs, []);
  await scheduler.notifyActivity();
  assert.deepEqual(runs, ['fast', 'slow']);

  await scheduler.notifyActivity();
  assert.deepEqual(runs, ['fast', 'slow']);
  nowMs = 1_600;
  await scheduler.notifyActivity();
  assert.deepEqual(runs, ['fast', 'slow', 'fast']);
});

test('isolates a failed maintenance task and keeps its bounded cadence', async () => {
  let nowMs = 0;
  const runs: string[] = [];
  const failures: string[] = [];
  const scheduler = new ActivityBoundMaintenanceScheduler([
    {
      id: 'fails',
      intervalMs: 100,
      run: async () => {
        runs.push('fails');
        throw new Error('offline');
      },
    },
    { id: 'continues', intervalMs: 100, run: async () => { runs.push('continues'); } },
  ], {
    now: () => nowMs,
    onError: ({ taskId }) => failures.push(taskId),
  });

  nowMs = 100;
  await scheduler.notifyActivity();
  assert.deepEqual(runs, ['fails', 'continues']);
  assert.deepEqual(failures, ['fails']);
  assert.equal(scheduler.nextEligibleAt('fails'), 200);
});
