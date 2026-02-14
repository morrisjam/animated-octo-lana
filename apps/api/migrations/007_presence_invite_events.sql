CREATE TABLE IF NOT EXISTS presence_invite_events (
  event_id BIGSERIAL PRIMARY KEY,
  account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  target_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'presence_updated',
      'presence_rate_limited',
      'invite_sent',
      'invite_cancelled',
      'invite_rate_limited',
      'invite_rejected'
    )
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS presence_invite_events_account_idx
  ON presence_invite_events(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS presence_invite_events_target_idx
  ON presence_invite_events(target_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS presence_invite_events_type_idx
  ON presence_invite_events(event_type, created_at DESC);
