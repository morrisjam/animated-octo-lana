CREATE TABLE IF NOT EXISTS ranked_league_progression (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  league_tier TEXT NULL CHECK (league_tier IN ('Iron', 'Bronze', 'Silver', 'Gold', 'Platinum')),
  league_points INTEGER NULL CHECK (league_points >= 0 AND league_points < 100),
  calibration_matches_required INTEGER NOT NULL DEFAULT 5 CHECK (calibration_matches_required > 0),
  calibration_matches_played INTEGER NOT NULL DEFAULT 0 CHECK (calibration_matches_played >= 0),
  placed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (league_tier IS NULL AND league_points IS NULL AND placed_at IS NULL)
    OR (league_tier IS NOT NULL AND league_points IS NOT NULL)
  )
);

ALTER TABLE ranked_match_rating_deltas
  ADD COLUMN IF NOT EXISTS pre_league_tier TEXT NULL CHECK (pre_league_tier IN ('Iron', 'Bronze', 'Silver', 'Gold', 'Platinum')),
  ADD COLUMN IF NOT EXISTS post_league_tier TEXT NULL CHECK (post_league_tier IN ('Iron', 'Bronze', 'Silver', 'Gold', 'Platinum')),
  ADD COLUMN IF NOT EXISTS pre_league_points INTEGER NULL CHECK (pre_league_points >= 0 AND pre_league_points < 100),
  ADD COLUMN IF NOT EXISTS post_league_points INTEGER NULL CHECK (post_league_points >= 0 AND post_league_points < 100);

ALTER TABLE ranked_season_standings
  ADD COLUMN IF NOT EXISTS league_tier TEXT NULL CHECK (league_tier IN ('Iron', 'Bronze', 'Silver', 'Gold', 'Platinum')),
  ADD COLUMN IF NOT EXISTS league_points INTEGER NULL CHECK (league_points >= 0 AND league_points < 100),
  ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ranked_league_progression_tier_idx
  ON ranked_league_progression(league_tier, league_points DESC, updated_at DESC);
