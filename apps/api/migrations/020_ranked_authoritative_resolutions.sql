CREATE TABLE IF NOT EXISTS ranked_authoritative_resolutions (
  resolution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE,
  match_id UUID NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN ('reconnect_timeout', 'peer_left')),
  forfeiting_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  winner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  participant_p1_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  participant_p2_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'settled', 'superseded')),
  resolved_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (forfeiting_account_id <> winner_account_id),
  CHECK (participant_p1_account_id <> participant_p2_account_id),
  CHECK (forfeiting_account_id IN (participant_p1_account_id, participant_p2_account_id)),
  CHECK (winner_account_id IN (participant_p1_account_id, participant_p2_account_id))
);

CREATE INDEX IF NOT EXISTS ranked_authoritative_resolutions_status_idx
  ON ranked_authoritative_resolutions(status, resolved_at ASC);

ALTER TABLE ranked_matches
  ALTER COLUMN processed_submission_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS authoritative_resolution_id UUID NULL
    REFERENCES ranked_authoritative_resolutions(resolution_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS settlement_source TEXT NOT NULL DEFAULT 'player_consensus'
    CHECK (settlement_source IN ('player_consensus', 'server_authoritative'));

ALTER TABLE ranked_matches
  ADD CONSTRAINT ranked_matches_exactly_one_settlement_source_check
  CHECK (
    (settlement_source = 'player_consensus'
      AND processed_submission_id IS NOT NULL
      AND authoritative_resolution_id IS NULL)
    OR
    (settlement_source = 'server_authoritative'
      AND processed_submission_id IS NULL
      AND authoritative_resolution_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE ranked_matches
  VALIDATE CONSTRAINT ranked_matches_exactly_one_settlement_source_check;
