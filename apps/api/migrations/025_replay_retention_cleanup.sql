CREATE INDEX IF NOT EXISTS replays_retention_expiry_idx
  ON replays(retention_until ASC, replay_id ASC);
