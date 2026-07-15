CREATE TABLE IF NOT EXISTS auth_rate_limit_buckets (
  scope TEXT NOT NULL,
  subject_hash CHAR(64) NOT NULL,
  max_attempts INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, subject_hash),
  CONSTRAINT auth_rate_limit_scope_length_check
    CHECK (char_length(scope) BETWEEN 1 AND 64),
  CONSTRAINT auth_rate_limit_subject_hash_check
    CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_rate_limit_max_attempts_check
    CHECK (max_attempts BETWEEN 1 AND 10000),
  CONSTRAINT auth_rate_limit_window_seconds_check
    CHECK (window_seconds BETWEEN 1 AND 604800),
  CONSTRAINT auth_rate_limit_attempt_count_check
    CHECK (attempt_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_buckets_updated_at
  ON auth_rate_limit_buckets(updated_at);
