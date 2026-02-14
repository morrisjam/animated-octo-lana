CREATE TABLE IF NOT EXISTS replays (
  replay_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL UNIQUE,
  queue_type TEXT NOT NULL,
  match_type TEXT NOT NULL,
  region TEXT NOT NULL,
  patch_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  sim_build_hash TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  winner_account_id UUID NULL REFERENCES accounts(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes > 0),
  sha256 TEXT NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ NULL,
  delete_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS replays_started_at_idx ON replays(started_at DESC);
CREATE INDEX IF NOT EXISTS replays_queue_type_started_at_idx ON replays(queue_type, started_at DESC);
CREATE INDEX IF NOT EXISTS replays_ruleset_started_at_idx ON replays(ruleset_version, started_at DESC);

CREATE TABLE IF NOT EXISTS replay_participants (
  id BIGSERIAL PRIMARY KEY,
  replay_id UUID NOT NULL REFERENCES replays(replay_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  side TEXT NOT NULL CHECK (side IN ('P1', 'P2')),
  character_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw', 'forfeit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (replay_id, account_id),
  UNIQUE (replay_id, side)
);

CREATE INDEX IF NOT EXISTS replay_participants_account_idx ON replay_participants(account_id, replay_id DESC);

CREATE TABLE IF NOT EXISTS replay_deletion_events (
  id BIGSERIAL PRIMARY KEY,
  replay_id UUID NOT NULL REFERENCES replays(replay_id) ON DELETE CASCADE,
  actor_account_id UUID NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS replay_deletion_events_replay_id_idx ON replay_deletion_events(replay_id, created_at DESC);
