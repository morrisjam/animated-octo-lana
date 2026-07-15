CREATE TABLE IF NOT EXISTS matchmaking_runtime_fences (
  snapshot_key TEXT PRIMARY KEY
    CHECK (CHAR_LENGTH(snapshot_key) BETWEEN 1 AND 96),
  fence_token BIGINT NOT NULL
    CHECK (fence_token > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE matchmaking_runtime_fences IS
  'Monotonic writer generations for fencing matchmaking snapshots after advisory-lock lease loss.';

COMMENT ON COLUMN matchmaking_runtime_fences.fence_token IS
  'Incremented on every successful runtime lease acquisition; only the current generation may persist state.';
