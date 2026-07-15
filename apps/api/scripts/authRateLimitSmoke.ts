import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import {
  createAuthRateLimiter,
  type AuthRateLimitDecision,
} from '../src/auth/authRateLimit';
import { db } from '../src/db';
import { assertSafeDatabaseSmokeTarget } from './smokeTargetGuard';

const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the authentication rate-limit smoke.');
}
assertSafeDatabaseSmokeTarget(databaseUrl, 'Authentication rate-limit smoke');

const limiter = createAuthRateLimiter({
  database: db,
  secret: 'gravity-well-local-auth-rate-limit-smoke-secret-v1',
});
const suffix = randomUUID().replaceAll('-', '');
const sequentialScope = `smoke_sequential_${suffix}`;
const concurrentScope = `smoke_concurrent_${suffix}`;
const multiScope = `smoke_multi_${suffix}`;
const pruneScope = `smoke_prune_${suffix}`;
const subject = `subject-${suffix}`;

try {
  const sequential: AuthRateLimitDecision[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sequential.push((await limiter.consume([{
      scope: sequentialScope,
      subject,
      maxAttempts: 2,
      windowSeconds: 60,
    }]))[0]);
  }
  assert.deepEqual(sequential.map((decision) => decision?.allowed), [true, true, false]);
  assert.deepEqual(sequential.map((decision) => decision?.attemptCount), [1, 2, 3]);
  assert.ok((sequential[2]?.retryAfterSeconds ?? 0) > 0);

  const concurrent = await Promise.all(
    Array.from({ length: 8 }, async () => (
      await limiter.consume([{
        scope: concurrentScope,
        subject,
        maxAttempts: 3,
        windowSeconds: 60,
      }])
    )[0]),
  );
  assert.equal(concurrent.filter((decision) => decision?.allowed).length, 3);
  assert.equal(concurrent.filter((decision) => !decision?.allowed).length, 5);
  assert.deepEqual(
    concurrent.map((decision) => decision?.attemptCount).sort((left, right) => (left ?? 0) - (right ?? 0)),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );

  const multi = await limiter.consume([
    { scope: multiScope, subject: `${subject}-source`, maxAttempts: 10, windowSeconds: 60 },
    { scope: `${multiScope}_principal`, subject, maxAttempts: 10, windowSeconds: 60 },
  ]);
  assert.equal(multi.length, 2);
  assert.equal(multi.every((decision) => decision.allowed), true);

  await limiter.clear(sequentialScope, subject);
  const afterClear = (await limiter.consume([{
    scope: sequentialScope,
    subject,
    maxAttempts: 2,
    windowSeconds: 60,
  }]))[0];
  assert.equal(afterClear?.allowed, true);
  assert.equal(afterClear?.attemptCount, 1);

  await limiter.consume([{
    scope: pruneScope,
    subject,
    maxAttempts: 2,
    windowSeconds: 1,
  }]);
  await db.query(
    `UPDATE auth_rate_limit_buckets
     SET window_started_at = NOW() - INTERVAL '2 seconds', updated_at = NOW() - INTERVAL '2 seconds'
     WHERE scope = $1`,
    [pruneScope],
  );
  assert.ok(await limiter.pruneExpired(100) >= 1);
  const pruned = await db.query(
    'SELECT 1 FROM auth_rate_limit_buckets WHERE scope = $1',
    [pruneScope],
  );
  assert.equal(pruned.rowCount, 0);

  console.info('[auth-rate-limit-smoke] sequential boundary, concurrent atomicity, multi-bucket consume, clear, and expiry pruning passed');
} finally {
  await Promise.all([
    limiter.clear(sequentialScope, subject),
    limiter.clear(concurrentScope, subject),
    limiter.clear(multiScope, `${subject}-source`),
    limiter.clear(`${multiScope}_principal`, subject),
    limiter.clear(pruneScope, subject),
  ]).catch(() => undefined);
  await db.end();
}
