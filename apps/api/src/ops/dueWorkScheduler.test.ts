import assert from 'node:assert/strict';
import test from 'node:test';
import { DueWorkScheduler } from './dueWorkScheduler';

test('sleeps with no due work and wakes once at the reported deadline', async () => {
  let nowMs = 1_000;
  let timerCallback: (() => void) | null = null;
  let timerDelayMs: number | null = null;
  let runs = 0;
  const scheduler = new DueWorkScheduler({
    now: () => nowMs,
    retryDelayMs: 250,
    run: async () => {
      runs += 1;
      return runs === 1 ? 5_000 : null;
    },
    setTimer: (callback, delayMs) => {
      timerCallback = callback;
      timerDelayMs = delayMs;
      return { id: 1 };
    },
    clearTimer: () => {
      timerCallback = null;
    },
  });

  await scheduler.runNow();
  assert.equal(runs, 1);
  assert.equal(scheduler.scheduledAt(), 5_000);
  assert.equal(timerDelayMs, 4_000);

  nowMs = 5_000;
  const callback = timerCallback as (() => void) | null;
  assert.ok(callback);
  callback();
  await Promise.resolve();
  await scheduler.whenIdle();
  assert.equal(runs, 2);
  assert.equal(scheduler.scheduledAt(), null);
});
test('coalesces an immediate request during work and retries failures at a bounded deadline', async () => {
  let nowMs = 10_000;
  let resolveFirst: ((value: number | null) => void) | null = null;
  let scheduledDelayMs: number | null = null;
  const failures: string[] = [];
  let runs = 0;
  const scheduler = new DueWorkScheduler({
    now: () => nowMs,
    retryDelayMs: 500,
    run: async () => {
      runs += 1;
      if (runs === 1) {
        return await new Promise<number | null>((resolve) => { resolveFirst = resolve; });
      }
      throw new Error('database unavailable');
    },
    setTimer: (_callback, delayMs) => {
      scheduledDelayMs = delayMs;
      return { id: 2 };
    },
    clearTimer: () => undefined,
    onError: (error) => failures.push((error as Error).message),
  });

  const first = scheduler.runNow();
  const coalesced = scheduler.runNow();
  assert.equal(first, coalesced);
  const completeFirst = resolveFirst as ((value: number | null) => void) | null;
  assert.ok(completeFirst);
  completeFirst(20_000);
  await first;

  assert.equal(runs, 2);
  assert.deepEqual(failures, ['database unavailable']);
  assert.equal(scheduler.scheduledAt(), 10_500);
  assert.equal(scheduledDelayMs, 500);
});
