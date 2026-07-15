import { createHmac } from 'node:crypto';

export interface AuthRateLimitDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount?: number | null }>;
}

export interface AuthRateLimitRule {
  scope: string;
  subject: string;
  maxAttempts: number;
  windowSeconds: number;
}

export interface AuthRateLimitDecision {
  scope: string;
  allowed: boolean;
  attemptCount: number;
  maxAttempts: number;
  retryAfterSeconds: number;
}

export interface AuthRateLimiterOptions {
  database: AuthRateLimitDatabase;
  secret: string;
}

interface AuthRateLimitRow extends Record<string, unknown> {
  rule_index: number | string;
  scope: string;
  attempt_count: number | string;
  max_attempts: number | string;
  allowed: boolean;
  retry_after_seconds: number | string;
}

const SCOPE_REGEX = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const MAX_RULES_PER_REQUEST = 8;
const MAX_ATTEMPTS = 10_000;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PRUNE_LIMIT = 1_000;

function requireInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function numberFromRow(value: number | string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Authentication rate-limit query returned an invalid ${name}.`);
  }
  return parsed;
}

export class AuthRateLimiter {
  private readonly database: AuthRateLimitDatabase;

  private readonly secret: string;

  public constructor(options: AuthRateLimiterOptions) {
    if (options.secret.trim().length < 32) {
      throw new Error('Authentication rate-limit secret must contain at least 32 characters.');
    }
    this.database = options.database;
    this.secret = options.secret;
  }

  public async consume(rules: AuthRateLimitRule[]): Promise<AuthRateLimitDecision[]> {
    if (rules.length === 0) {
      return [];
    }
    if (rules.length > MAX_RULES_PER_REQUEST) {
      throw new Error(`Authentication rate-limit requests support at most ${MAX_RULES_PER_REQUEST} rules.`);
    }

    const scopes: string[] = [];
    const subjectHashes: string[] = [];
    const maxAttempts: number[] = [];
    const windowSeconds: number[] = [];
    const uniqueKeys = new Set<string>();

    for (const rule of rules) {
      const scope = rule.scope.trim();
      const subject = rule.subject.trim();
      if (!SCOPE_REGEX.test(scope)) {
        throw new Error('Authentication rate-limit scope is invalid.');
      }
      if (!subject) {
        throw new Error('Authentication rate-limit subject is required.');
      }
      const subjectHash = this.hashSubject(scope, subject);
      const uniqueKey = `${scope}:${subjectHash}`;
      if (uniqueKeys.has(uniqueKey)) {
        throw new Error(`Authentication rate-limit request repeats scope ${scope}.`);
      }
      uniqueKeys.add(uniqueKey);
      scopes.push(scope);
      subjectHashes.push(subjectHash);
      maxAttempts.push(requireInteger(rule.maxAttempts, 'maxAttempts', 1, MAX_ATTEMPTS));
      windowSeconds.push(requireInteger(rule.windowSeconds, 'windowSeconds', 1, MAX_WINDOW_SECONDS));
    }

    const result = await this.database.query<AuthRateLimitRow>(
      `
      WITH requested AS (
        SELECT
          scope,
          subject_hash,
          max_attempts,
          window_seconds,
          ordinality::INTEGER AS rule_index
        FROM UNNEST(
          $1::TEXT[],
          $2::TEXT[],
          $3::INTEGER[],
          $4::INTEGER[]
        ) WITH ORDINALITY AS input(scope, subject_hash, max_attempts, window_seconds, ordinality)
      ), consumed AS (
        INSERT INTO auth_rate_limit_buckets(
          scope,
          subject_hash,
          max_attempts,
          window_seconds,
          window_started_at,
          attempt_count,
          updated_at
        )
        SELECT scope, subject_hash, max_attempts, window_seconds, NOW(), 1, NOW()
        FROM requested
        ON CONFLICT (scope, subject_hash)
        DO UPDATE SET
          attempt_count = CASE
            WHEN auth_rate_limit_buckets.max_attempts <> EXCLUDED.max_attempts
              OR auth_rate_limit_buckets.window_seconds <> EXCLUDED.window_seconds
              OR auth_rate_limit_buckets.window_started_at
                + make_interval(secs => auth_rate_limit_buckets.window_seconds) <= NOW()
            THEN 1
            ELSE auth_rate_limit_buckets.attempt_count + 1
          END,
          window_started_at = CASE
            WHEN auth_rate_limit_buckets.max_attempts <> EXCLUDED.max_attempts
              OR auth_rate_limit_buckets.window_seconds <> EXCLUDED.window_seconds
              OR auth_rate_limit_buckets.window_started_at
                + make_interval(secs => auth_rate_limit_buckets.window_seconds) <= NOW()
            THEN NOW()
            ELSE auth_rate_limit_buckets.window_started_at
          END,
          max_attempts = EXCLUDED.max_attempts,
          window_seconds = EXCLUDED.window_seconds,
          updated_at = NOW()
        RETURNING scope, subject_hash, attempt_count, max_attempts, window_seconds, window_started_at
      )
      SELECT
        requested.rule_index,
        consumed.scope,
        consumed.attempt_count,
        consumed.max_attempts,
        consumed.attempt_count <= consumed.max_attempts AS allowed,
        CASE
          WHEN consumed.attempt_count <= consumed.max_attempts THEN 0
          ELSE GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM (
              consumed.window_started_at
                + make_interval(secs => consumed.window_seconds)
                - NOW()
            )))::INTEGER
          )
        END AS retry_after_seconds
      FROM consumed
      JOIN requested
        ON requested.scope = consumed.scope
        AND requested.subject_hash = consumed.subject_hash
      ORDER BY requested.rule_index
      `,
      [scopes, subjectHashes, maxAttempts, windowSeconds],
    );

    if (result.rows.length !== rules.length) {
      throw new Error('Authentication rate-limit query returned an incomplete decision set.');
    }

    return result.rows.map((row, index) => {
      const ruleIndex = numberFromRow(row.rule_index, 'rule index');
      if (ruleIndex !== index + 1 || row.scope !== scopes[index]) {
        throw new Error('Authentication rate-limit query returned decisions out of order.');
      }
      return {
        scope: row.scope,
        allowed: row.allowed === true,
        attemptCount: numberFromRow(row.attempt_count, 'attempt count'),
        maxAttempts: numberFromRow(row.max_attempts, 'maximum attempt count'),
        retryAfterSeconds: numberFromRow(row.retry_after_seconds, 'retry-after duration'),
      };
    });
  }

  public async clear(scopeValue: string, subjectValue: string): Promise<void> {
    const scope = scopeValue.trim();
    const subject = subjectValue.trim();
    if (!SCOPE_REGEX.test(scope) || !subject) {
      throw new Error('Authentication rate-limit scope and subject are required to clear a bucket.');
    }
    await this.database.query(
      'DELETE FROM auth_rate_limit_buckets WHERE scope = $1 AND subject_hash = $2',
      [scope, this.hashSubject(scope, subject)],
    );
  }

  public async pruneExpired(limitValue = DEFAULT_PRUNE_LIMIT): Promise<number> {
    const limit = requireInteger(limitValue, 'prune limit', 1, 10_000);
    const result = await this.database.query(
      `
      WITH expired AS (
        SELECT scope, subject_hash
        FROM auth_rate_limit_buckets
        WHERE window_started_at + make_interval(secs => window_seconds) <= NOW()
        ORDER BY updated_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM auth_rate_limit_buckets AS bucket
      USING expired
      WHERE bucket.scope = expired.scope
        AND bucket.subject_hash = expired.subject_hash
      `,
      [limit],
    );
    return result.rowCount ?? 0;
  }

  private hashSubject(scope: string, subject: string): string {
    return createHmac('sha256', this.secret)
      .update('gravity-well-auth-rate-limit-v1\0')
      .update(scope)
      .update('\0')
      .update(subject)
      .digest('hex');
  }
}

export function createAuthRateLimiter(options: AuthRateLimiterOptions): AuthRateLimiter {
  return new AuthRateLimiter(options);
}
