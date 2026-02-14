CREATE TABLE IF NOT EXISTS web_auth_credentials (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  email_normalised TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_auth_credentials_email_idx ON web_auth_credentials(email_normalised);

CREATE TABLE IF NOT EXISTS account_auth_events (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('signup', 'signin', 'upgrade', 'signup_failed', 'signin_failed')),
  email_normalised TEXT NOT NULL,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_auth_events_account_idx ON account_auth_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_auth_events_email_idx ON account_auth_events(email_normalised, created_at DESC);
