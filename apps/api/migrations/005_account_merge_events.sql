CREATE TABLE IF NOT EXISTS account_merge_events (
  id BIGSERIAL PRIMARY KEY,
  source_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'steam_link_merge',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_account_id <> target_account_id)
);

CREATE INDEX IF NOT EXISTS account_merge_events_source_idx
  ON account_merge_events(source_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_merge_events_target_idx
  ON account_merge_events(target_account_id, created_at DESC);
