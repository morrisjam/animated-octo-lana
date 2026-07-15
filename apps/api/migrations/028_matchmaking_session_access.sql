CREATE TABLE IF NOT EXISTS matchmaking_session_access (
  snapshot_key TEXT NOT NULL
    CHECK (CHAR_LENGTH(snapshot_key) BETWEEN 1 AND 96),
  session_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_token_hash BYTEA NOT NULL
    CHECK (OCTET_LENGTH(session_token_hash) = 32),
  session_token_expires_at TIMESTAMPTZ NOT NULL,
  transport_attempt_id UUID NOT NULL,
  session_status TEXT NOT NULL
    CHECK (session_status IN ('active', 'resolved')),
  session_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_key, session_id, account_id),
  CONSTRAINT matchmaking_session_access_distinct_accounts_check
    CHECK (account_id <> peer_account_id)
);

CREATE INDEX IF NOT EXISTS matchmaking_session_access_expiry_idx
  ON matchmaking_session_access(snapshot_key, session_expires_at, session_id);

COMMENT ON TABLE matchmaking_session_access IS
  'Indexed hashed projection of durable matchmaking session credentials for lock-free signaling authorization.';

COMMENT ON COLUMN matchmaking_session_access.session_token_hash IS
  'SHA-256 digest of the high-entropy per-participant session token; plaintext credentials are never projected here.';
