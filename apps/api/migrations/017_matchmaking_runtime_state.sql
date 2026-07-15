CREATE TABLE IF NOT EXISTS matchmaking_runtime_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  snapshot_version INTEGER NOT NULL CHECK (snapshot_version > 0),
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
