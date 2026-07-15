import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthRateLimiter, type AuthRateLimitDatabase } from './authRateLimit';

const SECRET = 'auth-rate-limit-test-secret-with-more-than-32-characters';

class CapturingDatabase implements AuthRateLimitDatabase {
  public calls: Array<{ text: string; values?: unknown[] }> = [];

  public rows: Array<Record<string, unknown>> = [];

  public async query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }> {
    this.calls.push({ text, values });
    return { rows: this.rows as Row[], rowCount: this.rows.length };
  }
}

test('hashes raw subjects and maps ordered database decisions', async () => {
  const database = new CapturingDatabase();
  database.rows = [
    {
      rule_index: 1,
      scope: 'web_signin_source',
      attempt_count: 4,
      max_attempts: 60,
      allowed: true,
      retry_after_seconds: 0,
    },
    {
      rule_index: 2,
      scope: 'web_signin_principal',
      attempt_count: '9',
      max_attempts: '8',
      allowed: false,
      retry_after_seconds: '731',
    },
  ];
  const limiter = createAuthRateLimiter({ database, secret: SECRET });

  const decisions = await limiter.consume([
    { scope: 'web_signin_source', subject: '127.0.0.1', maxAttempts: 60, windowSeconds: 900 },
    { scope: 'web_signin_principal', subject: 'player@example.com', maxAttempts: 8, windowSeconds: 900 },
  ]);

  assert.deepEqual(decisions, [
    {
      scope: 'web_signin_source',
      allowed: true,
      attemptCount: 4,
      maxAttempts: 60,
      retryAfterSeconds: 0,
    },
    {
      scope: 'web_signin_principal',
      allowed: false,
      attemptCount: 9,
      maxAttempts: 8,
      retryAfterSeconds: 731,
    },
  ]);
  const serializedValues = JSON.stringify(database.calls[0]?.values);
  assert.equal(serializedValues.includes('127.0.0.1'), false);
  assert.equal(serializedValues.includes('player@example.com'), false);
  assert.match(serializedValues, /[0-9a-f]{64}/);
});

test('rejects duplicate buckets before issuing a cardinality-breaking upsert', async () => {
  const database = new CapturingDatabase();
  const limiter = createAuthRateLimiter({ database, secret: SECRET });
  await assert.rejects(
    limiter.consume([
      { scope: 'steam_exchange_ticket', subject: 'ticket', maxAttempts: 3, windowSeconds: 300 },
      { scope: 'steam_exchange_ticket', subject: 'ticket', maxAttempts: 3, windowSeconds: 300 },
    ]),
    /repeats scope/,
  );
  assert.equal(database.calls.length, 0);
});

test('clears a pseudonymized bucket without storing its raw subject', async () => {
  const database = new CapturingDatabase();
  const limiter = createAuthRateLimiter({ database, secret: SECRET });
  await limiter.clear('web_signin_principal', 'player@example.com');
  assert.equal(database.calls.length, 1);
  assert.deepEqual(database.calls[0]?.values?.[0], 'web_signin_principal');
  assert.match(String(database.calls[0]?.values?.[1]), /^[0-9a-f]{64}$/);
  assert.notEqual(database.calls[0]?.values?.[1], 'player@example.com');
});

test('prunes expired buckets in a bounded lock-safe batch', async () => {
  const database = new CapturingDatabase();
  database.rows = [{}];
  const limiter = createAuthRateLimiter({ database, secret: SECRET });

  assert.equal(await limiter.pruneExpired(250), 1);
  assert.deepEqual(database.calls[0]?.values, [250]);
  assert.match(database.calls[0]?.text ?? '', /FOR UPDATE SKIP LOCKED/);
  assert.match(database.calls[0]?.text ?? '', /LIMIT \$1/);
  await assert.rejects(limiter.pruneExpired(0), /prune limit/);
});

test('fails closed on invalid policy and secret configuration', async () => {
  const database = new CapturingDatabase();
  assert.throws(
    () => createAuthRateLimiter({ database, secret: 'short' }),
    /at least 32 characters/,
  );
  const limiter = createAuthRateLimiter({ database, secret: SECRET });
  await assert.rejects(
    limiter.consume([
      { scope: 'INVALID SCOPE', subject: 'subject', maxAttempts: 1, windowSeconds: 60 },
    ]),
    /scope is invalid/,
  );
  await assert.rejects(
    limiter.consume([
      { scope: 'web_signin_source', subject: 'subject', maxAttempts: 0, windowSeconds: 60 },
    ]),
    /maxAttempts/,
  );
});
