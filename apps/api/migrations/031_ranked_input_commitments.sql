ALTER TABLE matchmaking_session_access
  ADD COLUMN IF NOT EXISTS player_side TEXT
  CHECK (player_side IN ('P1', 'P2'));

COMMENT ON COLUMN matchmaking_session_access.player_side IS
  'Server-assigned deterministic player side. Nullable only during the previous-release rollback window.';

CREATE TABLE IF NOT EXISTS ranked_input_commitments (
  session_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  player_side TEXT NOT NULL CHECK (player_side IN ('P1', 'P2')),
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 2047),
  epoch INTEGER NOT NULL CHECK (epoch BETWEEN 0 AND 2),
  start_frame INTEGER NOT NULL CHECK (start_frame >= 0),
  end_frame INTEGER NOT NULL CHECK (
    end_frame >= start_frame
    AND end_frame - start_frame + 1 <= 120
  ),
  round_final BOOLEAN NOT NULL,
  chunk_digest CHAR(64) NOT NULL CHECK (chunk_digest ~ '^[0-9a-f]{64}$'),
  previous_chain_digest CHAR(64) CHECK (previous_chain_digest ~ '^[0-9a-f]{64}$'),
  chain_digest CHAR(64) NOT NULL CHECK (chain_digest ~ '^[0-9a-f]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, account_id, sequence),
  CONSTRAINT ranked_input_commitments_initial_chain_check CHECK (
    (sequence = 0 AND previous_chain_digest IS NULL)
    OR (sequence > 0 AND previous_chain_digest IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ranked_input_commitments_session_idx
  ON ranked_input_commitments(session_id, account_id, sequence);

CREATE INDEX IF NOT EXISTS ranked_input_commitments_received_idx
  ON ranked_input_commitments(received_at, session_id);

COMMENT ON TABLE ranked_input_commitments IS
  'Low-volume server-observed hash chain over each ranked participant own authoritative inputs; raw gameplay frames remain peer-to-peer.';

ALTER TABLE ranked_match_proofs
  ADD COLUMN IF NOT EXISTS input_attestation_json JSONB;

COMMENT ON COLUMN ranked_match_proofs.input_attestation_json IS
  'Final gw.ranked-input-attestation.v1 evidence proving both participant commitment chains cover the verified proof.';
