ALTER TABLE matchmaking_session_access
  ADD COLUMN IF NOT EXISTS signal_access_expires_at TIMESTAMPTZ;

UPDATE matchmaking_session_access
SET signal_access_expires_at = session_expires_at
WHERE signal_access_expires_at IS NULL;

-- backward-compatible-exception: alter_column_set_not_null Existing rows are backfilled before enforcement.
ALTER TABLE matchmaking_session_access
  ALTER COLUMN signal_access_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS matchmaking_session_access_signal_expiry_idx
  ON matchmaking_session_access(snapshot_key, signal_access_expires_at, session_id);

COMMENT ON COLUMN matchmaking_session_access.signal_access_expires_at IS
  'Earliest session or participant reconnect deadline after which lock-free signaling access fails closed.';
