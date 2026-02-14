CREATE TABLE IF NOT EXISTS ranked_master_ratings (
  season_id TEXT NOT NULL REFERENCES ranked_seasons(season_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mr_points INTEGER NOT NULL CHECK (mr_points >= 0),
  matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  forfeits INTEGER NOT NULL DEFAULT 0 CHECK (forfeits >= 0),
  entered_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season_id, account_id)
);

CREATE INDEX IF NOT EXISTS ranked_master_ratings_rank_idx
  ON ranked_master_ratings(season_id, mr_points DESC, wins DESC, matches_played DESC, account_id);

CREATE TABLE IF NOT EXISTS ranked_master_season_standings (
  season_id TEXT NOT NULL REFERENCES ranked_seasons(season_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rank_position INTEGER NOT NULL CHECK (rank_position > 0),
  mr_points INTEGER NOT NULL CHECK (mr_points >= 0),
  matches_played INTEGER NOT NULL CHECK (matches_played >= 0),
  wins INTEGER NOT NULL CHECK (wins >= 0),
  losses INTEGER NOT NULL CHECK (losses >= 0),
  draws INTEGER NOT NULL CHECK (draws >= 0),
  forfeits INTEGER NOT NULL CHECK (forfeits >= 0),
  entered_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season_id, account_id)
);

CREATE INDEX IF NOT EXISTS ranked_master_season_standings_rank_idx
  ON ranked_master_season_standings(season_id, rank_position, account_id);

ALTER TABLE ranked_match_rating_deltas
  ADD COLUMN IF NOT EXISTS pre_mr_points INTEGER NULL CHECK (pre_mr_points >= 0),
  ADD COLUMN IF NOT EXISTS post_mr_points INTEGER NULL CHECK (post_mr_points >= 0);

ALTER TABLE ranked_season_standings
  ADD COLUMN IF NOT EXISTS mr_points INTEGER NULL CHECK (mr_points >= 0);

ALTER TABLE ranked_season_reset_runs
  ADD COLUMN IF NOT EXISTS master_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (master_snapshot_count >= 0);
