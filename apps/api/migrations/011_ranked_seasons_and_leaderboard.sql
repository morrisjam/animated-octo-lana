CREATE TABLE IF NOT EXISTS ranked_seasons (
  season_id TEXT PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS ranked_seasons_state_window_idx
  ON ranked_seasons(state, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS ranked_season_standings (
  season_id TEXT NOT NULL REFERENCES ranked_seasons(season_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  region TEXT NOT NULL DEFAULT 'global',
  rank_position INTEGER NOT NULL CHECK (rank_position > 0),
  rating INTEGER NOT NULL CHECK (rating > 0),
  matches_played INTEGER NOT NULL CHECK (matches_played >= 0),
  wins INTEGER NOT NULL CHECK (wins >= 0),
  losses INTEGER NOT NULL CHECK (losses >= 0),
  draws INTEGER NOT NULL CHECK (draws >= 0),
  forfeits INTEGER NOT NULL CHECK (forfeits >= 0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season_id, account_id)
);

CREATE INDEX IF NOT EXISTS ranked_season_standings_rank_idx
  ON ranked_season_standings(season_id, region, rank_position, account_id);

CREATE TABLE IF NOT EXISTS ranked_season_reset_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_season_id TEXT NOT NULL REFERENCES ranked_seasons(season_id) ON DELETE RESTRICT,
  next_season_id TEXT NOT NULL REFERENCES ranked_seasons(season_id) ON DELETE RESTRICT,
  snapshot_count INTEGER NOT NULL CHECK (snapshot_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

ALTER TABLE ranked_matches
  ADD COLUMN IF NOT EXISTS season_id TEXT NULL REFERENCES ranked_seasons(season_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ranked_matches_season_idx
  ON ranked_matches(season_id, created_at DESC);
