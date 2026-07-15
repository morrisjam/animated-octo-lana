import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAuthRateLimiter,
  type AuthRateLimitDatabase,
  type AuthRateLimitRule,
} from '../auth/authRateLimit';

const SECRET = 'ranked-proof-rate-limit-test-secret-with-32-plus-characters';
const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';
const SESSION_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface CapturedCall {
  text: string;
  values?: unknown[];
}

interface BucketState {
  attemptCount: number;
  maxAttempts: number;
  windowSeconds: number;
}

class DeterministicRateLimitDatabase implements AuthRateLimitDatabase {
  public readonly calls: CapturedCall[] = [];

  private readonly buckets = new Map<string, BucketState>();

  public async query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }> {
    this.calls.push({ text, values });
    const [scopes, subjectHashes, maxAttempts, windowSeconds] = values as [
      string[],
      string[],
      number[],
      number[],
    ];
    const rows = scopes.map((scope, index) => {
      const key = `${scope}:${subjectHashes[index]}`;
      const previous = this.buckets.get(key);
      const policyChanged = previous
        && (previous.maxAttempts !== maxAttempts[index]
          || previous.windowSeconds !== windowSeconds[index]);
      const attemptCount = !previous || policyChanged ? 1 : previous.attemptCount + 1;
      this.buckets.set(key, {
        attemptCount,
        maxAttempts: maxAttempts[index],
        windowSeconds: windowSeconds[index],
      });
      const allowed = attemptCount <= maxAttempts[index];
      return {
        rule_index: index + 1,
        scope,
        attempt_count: attemptCount,
        max_attempts: maxAttempts[index],
        allowed,
        retry_after_seconds: allowed ? 0 : windowSeconds[index],
      };
    });
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

function rankedProofRules(accountId: string, sessionId: string): AuthRateLimitRule[] {
  return [
    {
      scope: 'ranked_proof_account_session',
      subject: `${accountId}:${sessionId}`,
      maxAttempts: 4,
      windowSeconds: 10 * 60,
    },
    {
      scope: 'ranked_proof_account_hour',
      subject: accountId,
      maxAttempts: 20,
      windowSeconds: 60 * 60,
    },
  ];
}

test('ranked proof session attempts are atomic and isolated per participant', async () => {
  const database = new DeterministicRateLimitDatabase();
  const limiter = createAuthRateLimiter({ database, secret: SECRET });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const decisions = await limiter.consume(rankedProofRules(ACCOUNT_1, SESSION_1));
    assert.deepEqual(decisions.map(({ allowed }) => allowed), [true, true]);
  }
  const exhausted = await limiter.consume(rankedProofRules(ACCOUNT_1, SESSION_1));
  assert.deepEqual(exhausted.map(({ allowed }) => allowed), [false, true]);

  const peer = await limiter.consume(rankedProofRules(ACCOUNT_2, SESSION_1));
  assert.deepEqual(peer.map(({ allowed }) => allowed), [true, true]);
  assert.equal(database.calls.length, 6);
  assert.ok(database.calls.every((call) => (call.values?.[0] as string[]).length === 2));

  const serializedValues = JSON.stringify(database.calls.map(({ values }) => values));
  assert.equal(serializedValues.includes(ACCOUNT_1), false);
  assert.equal(serializedValues.includes(ACCOUNT_2), false);
  assert.equal(serializedValues.includes(SESSION_1), false);
  const exhaustedHashes = database.calls[4]?.values?.[1] as string[];
  const peerHashes = database.calls[5]?.values?.[1] as string[];
  assert.notEqual(exhaustedHashes[0], peerHashes[0]);
  assert.notEqual(exhaustedHashes[1], peerHashes[1]);
});

test('ranked proof account-hour attempts remain bounded across sessions', async () => {
  const database = new DeterministicRateLimitDatabase();
  const limiter = createAuthRateLimiter({ database, secret: SECRET });

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const decisions = await limiter.consume(rankedProofRules(ACCOUNT_1, `session-${attempt}`));
    assert.deepEqual(decisions.map(({ allowed }) => allowed), [true, true]);
  }
  const exhausted = await limiter.consume(rankedProofRules(ACCOUNT_1, 'session-21'));
  assert.deepEqual(exhausted.map(({ allowed }) => allowed), [true, false]);

  const firstHashes = database.calls[0]?.values?.[1] as string[];
  const lastHashes = database.calls[20]?.values?.[1] as string[];
  assert.notEqual(firstHashes[0], lastHashes[0]);
  assert.equal(firstHashes[1], lastHashes[1]);
});

test('ranked result route limits only validated unsettled submissions before proof replay', () => {
  const serverPath = fileURLToPath(new URL('../server.ts', import.meta.url));
  const serverSource = readFileSync(serverPath, 'utf8');
  assert.match(
    serverSource,
    /accountSession:\s*resolveAuthRateLimitPolicy\('RANKED_PROOF_RATE_LIMIT_ACCOUNT_SESSION', 4, 10 \* 60\)/,
  );
  assert.match(
    serverSource,
    /accountHour:\s*resolveAuthRateLimitPolicy\('RANKED_PROOF_RATE_LIMIT_ACCOUNT_HOUR', 20, 60 \* 60\)/,
  );
  const routeStart = serverSource.indexOf("app.post('/ranked/results'");
  const routeEnd = serverSource.indexOf("app.get('/ranked/results/:sessionId'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'ranked result route source was not found');
  const routeSource = serverSource.slice(routeStart, routeEnd);

  const sessionValidation = routeSource.indexOf('matchmakingQueueService.validateSessionToken');
  const duplicateCheck = routeSource.indexOf('const existingAccountSubmission');
  const participantValidation = routeSource.indexOf('if (!p1Participant || !p2Participant)');
  const limiter = routeSource.indexOf('await enforceRankedProofRateLimits');
  const proofReplay = routeSource.indexOf('await verifyRankedMatchProof');
  const settlement = routeSource.indexOf("await client.query('BEGIN')");
  assert.ok(sessionValidation >= 0 && sessionValidation < duplicateCheck);
  assert.ok(duplicateCheck < participantValidation);
  assert.ok(participantValidation < limiter);
  assert.ok(limiter < proofReplay);
  assert.ok(proofReplay < settlement);
  assert.match(
    routeSource,
    /enforceRankedProofRateLimits\(\s*request,\s*reply,\s*accountId,\s*body\.sessionId,\s*\)/,
  );

  const limiterStart = serverSource.indexOf('async function enforceRankedProofRateLimits');
  const limiterEnd = serverSource.indexOf('function secretMatches', limiterStart);
  assert.ok(limiterStart >= 0 && limiterEnd > limiterStart, 'ranked proof limiter source was not found');
  const limiterSource = serverSource.slice(limiterStart, limiterEnd);
  assert.match(limiterSource, /'ranked_proof_account_session',\s*`\$\{accountId\}:\$\{sessionId\}`/);
  assert.match(limiterSource, /'ranked_proof_account_hour',\s*accountId/);
  assert.match(limiterSource, /reply\.header\('Retry-After', String\(retryAfterSeconds\)\)/);
  assert.match(limiterSource, /reply\.code\(429\)/);
  assert.match(limiterSource, /code: 'ranked_proof_rate_limited'/);
  assert.match(limiterSource, /reply\.code\(503\)/);
});
