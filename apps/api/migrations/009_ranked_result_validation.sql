CREATE TABLE IF NOT EXISTS ranked_result_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  match_id UUID NOT NULL,
  queue_type TEXT NOT NULL CHECK (queue_type = 'ranked'),
  submitted_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_participants UUID[] NOT NULL,
  submitted_participants UUID[] NOT NULL,
  winner_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('p1_win', 'p2_win', 'draw', 'forfeit')),
  valid_session_token BOOLEAN NOT NULL DEFAULT TRUE,
  suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  suspicious_reasons TEXT[] NOT NULL DEFAULT '{}'::text[],
  review_status TEXT NOT NULL DEFAULT 'none' CHECK (review_status IN ('none', 'pending', 'resolved')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, submitted_by_account_id)
);

CREATE INDEX IF NOT EXISTS ranked_result_submissions_session_idx
  ON ranked_result_submissions(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ranked_result_submissions_review_idx
  ON ranked_result_submissions(review_status, created_at DESC);
