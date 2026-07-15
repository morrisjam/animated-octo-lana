CREATE TABLE IF NOT EXISTS matchmaking_session_signals (
  signal_id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL
    CHECK (CHAR_LENGTH(client_message_id) BETWEEN 1 AND 128),
  signal_type TEXT NOT NULL
    CHECK (signal_type IN ('offer', 'answer', 'ice_candidate', 'end_of_candidates')),
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT matchmaking_session_signals_distinct_accounts_check
    CHECK (sender_account_id <> recipient_account_id),
  CONSTRAINT matchmaking_session_signals_idempotency_key
    UNIQUE (session_id, sender_account_id, client_message_id),
  CONSTRAINT matchmaking_session_signals_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS matchmaking_session_signals_recipient_poll_idx
  ON matchmaking_session_signals(recipient_account_id, session_id, signal_id);

CREATE INDEX IF NOT EXISTS matchmaking_session_signals_sender_idx
  ON matchmaking_session_signals(sender_account_id);

CREATE INDEX IF NOT EXISTS matchmaking_session_signals_expiry_idx
  ON matchmaking_session_signals(expires_at, signal_id);

COMMENT ON TABLE matchmaking_session_signals IS
  'Low-volume WebRTC negotiation mailbox; gameplay frames must not be stored here.';
