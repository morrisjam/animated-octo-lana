CREATE TABLE IF NOT EXISTS ranked_player_ratings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1200 CHECK (rating > 0),
  matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  forfeits INTEGER NOT NULL DEFAULT 0 CHECK (forfeits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranked_matches (
  match_id UUID PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,
  queue_type TEXT NOT NULL CHECK (queue_type = 'ranked'),
  outcome TEXT NOT NULL CHECK (outcome IN ('p1_win', 'p2_win', 'draw', 'forfeit')),
  winner_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  processed_submission_id UUID NOT NULL REFERENCES ranked_result_submissions(submission_id) ON DELETE RESTRICT,
  participant_p1_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  participant_p2_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranked_match_rating_deltas (
  id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES ranked_matches(match_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('P1', 'P2')),
  pre_rating INTEGER NOT NULL CHECK (pre_rating > 0),
  post_rating INTEGER NOT NULL CHECK (post_rating > 0),
  rating_delta INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw', 'forfeit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, account_id)
);

CREATE INDEX IF NOT EXISTS ranked_match_rating_deltas_account_idx
  ON ranked_match_rating_deltas(account_id, created_at DESC);
