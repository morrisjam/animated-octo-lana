CREATE TABLE IF NOT EXISTS ranked_match_proofs (
  proof_digest TEXT PRIMARY KEY,
  session_id UUID NOT NULL,
  match_id UUID NOT NULL,
  schema_version INTEGER NOT NULL,
  simulator_version TEXT NOT NULL,
  build_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  balance_profile_id TEXT NOT NULL,
  derived_outcome TEXT NOT NULL CHECK (derived_outcome IN ('p1_win', 'p2_win')),
  winner_side TEXT NOT NULL CHECK (winner_side IN ('P1', 'P2')),
  round_count INTEGER NOT NULL CHECK (round_count BETWEEN 2 AND 3),
  frame_count INTEGER NOT NULL CHECK (frame_count > 0),
  payload_json JSONB NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, proof_digest)
);

CREATE INDEX IF NOT EXISTS ranked_match_proofs_session_idx
  ON ranked_match_proofs(session_id, verified_at DESC);

ALTER TABLE ranked_result_submissions
  ADD COLUMN IF NOT EXISTS proof_digest TEXT NULL REFERENCES ranked_match_proofs(proof_digest),
  ADD COLUMN IF NOT EXISTS proof_verification_status TEXT NOT NULL DEFAULT 'legacy_unverified'
    CHECK (proof_verification_status IN ('legacy_unverified', 'verified')),
  ADD COLUMN IF NOT EXISTS derived_outcome TEXT NULL
    CHECK (derived_outcome IS NULL OR derived_outcome IN ('p1_win', 'p2_win'));

CREATE INDEX IF NOT EXISTS ranked_result_submissions_proof_idx
  ON ranked_result_submissions(proof_digest, created_at DESC);
