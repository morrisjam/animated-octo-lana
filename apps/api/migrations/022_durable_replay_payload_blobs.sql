CREATE TABLE IF NOT EXISTS replay_payload_blobs (
  storage_key TEXT PRIMARY KEY,
  payload_gzip BYTEA NOT NULL,
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes > 0),
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE replay_payload_blobs IS
  'Durable compressed replay payloads for controlled alpha deployments without external object storage.';
