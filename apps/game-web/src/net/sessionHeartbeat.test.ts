import { expect, test } from 'vitest';
import {
  SessionHeartbeatLoop,
  SessionHeartbeatTimeoutError,
} from './sessionHeartbeat';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('heartbeat loop pulses immediately and never overlaps requests', async () => {
  let scheduled: (() => void) | null = null;
  let cleared = false;
  let calls = 0;
  const first = deferred();
  const loop = new SessionHeartbeatLoop({
    intervalMs: 5_000,
    heartbeat: async () => {
      calls += 1;
      if (calls === 1) {
        await first.promise;
      }
    },
    setIntervalFn: (callback) => {
      scheduled = callback;
      return 'timer';
    },
    clearIntervalFn: (timer) => {
      expect(timer).toBe('timer');
      cleared = true;
    },
  });

  loop.start();
  expect(calls).toBe(1);
  expect(scheduled).not.toBeNull();
  (scheduled as () => void)();
  expect(calls).toBe(1);
  first.resolve();
  await first.promise;
  await flushAsync();
  (scheduled as () => void)();
  await flushAsync();
  expect(calls).toBe(2);

  loop.stop();
  expect(cleared).toBe(true);
  expect(loop.isRunning()).toBe(false);
});

test('heartbeat loop reports failures and continues with later pulses', async () => {
  let scheduled: (() => void) | null = null;
  const errors: unknown[] = [];
  let calls = 0;
  const failure = new Error('temporary outage');
  const loop = new SessionHeartbeatLoop({
    intervalMs: 5_000,
    heartbeat: async () => {
      calls += 1;
      if (calls === 1) {
        throw failure;
      }
    },
    onError: (error) => errors.push(error),
    setIntervalFn: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearIntervalFn: () => undefined,
  });

  loop.start();
  await flushAsync();
  expect(errors).toEqual([failure]);
  expect(scheduled).not.toBeNull();
  (scheduled as () => void)();
  await flushAsync();
  expect(calls).toBe(2);
  loop.stop();
  expect(await loop.pulse()).toBe(false);
});

test('heartbeat loop bounds a never-settling pulse and aborts its request signal', async () => {
  let scheduled: (() => void) | null = null;
  let deadline: (() => void) | null = null;
  const errors: unknown[] = [];
  const signals: AbortSignal[] = [];
  const neverSettles = deferred();
  let calls = 0;
  const loop = new SessionHeartbeatLoop({
    intervalMs: 5_000,
    timeoutMs: 250,
    heartbeat: async (signal) => {
      signals.push(signal as AbortSignal);
      calls += 1;
      if (calls === 1) {
        await neverSettles.promise;
      }
    },
    onError: (error) => errors.push(error),
    setIntervalFn: (callback) => {
      scheduled = callback;
      return 'interval';
    },
    clearIntervalFn: () => undefined,
    setTimeoutFn: (callback, timeoutMs) => {
      expect(timeoutMs).toBe(250);
      deadline = callback;
      return `deadline-${calls + 1}`;
    },
    clearTimeoutFn: () => undefined,
  });

  loop.start();
  expect(calls).toBe(1);
  expect(signals[0]?.aborted).toBe(false);

  (deadline as () => void)();
  await flushAsync();

  expect(signals[0]?.aborted).toBe(true);
  expect(signals[0]?.reason).toBeInstanceOf(SessionHeartbeatTimeoutError);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(SessionHeartbeatTimeoutError);
  expect((errors[0] as SessionHeartbeatTimeoutError).timeoutMs).toBe(250);

  (scheduled as () => void)();
  await flushAsync();
  expect(calls).toBe(2);
  expect(signals[1]?.aborted).toBe(false);

  loop.stop();
  neverSettles.resolve();
});

test('stop and immediate restart detach stale work without clearing the new pulse', async () => {
  const scheduled: Array<() => void> = [];
  const errors: unknown[] = [];
  const signals: AbortSignal[] = [];
  const stale = deferred();
  const restarted = deferred();
  let calls = 0;
  const loop = new SessionHeartbeatLoop({
    intervalMs: 5_000,
    timeoutMs: 30_000,
    heartbeat: async (signal) => {
      signals.push(signal as AbortSignal);
      calls += 1;
      if (calls === 1) {
        await stale.promise;
      } else if (calls === 2) {
        await restarted.promise;
      }
    },
    onError: (error) => errors.push(error),
    setIntervalFn: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearIntervalFn: () => undefined,
  });

  loop.start();
  const staleInterval = scheduled[0] as () => void;
  expect(calls).toBe(1);

  loop.stop();
  expect(signals[0]?.aborted).toBe(true);
  loop.start();
  const restartedInterval = scheduled[1] as () => void;
  expect(calls).toBe(2);
  expect(signals[1]?.aborted).toBe(false);

  stale.reject(new Error('late stale failure'));
  await stale.promise.catch(() => undefined);
  await flushAsync();
  restartedInterval();
  expect(calls).toBe(2);

  restarted.resolve();
  await restarted.promise;
  await flushAsync();
  staleInterval();
  await flushAsync();
  expect(calls).toBe(2);

  restartedInterval();
  await flushAsync();
  expect(calls).toBe(3);
  expect(errors).toEqual([]);
  loop.stop();
});
