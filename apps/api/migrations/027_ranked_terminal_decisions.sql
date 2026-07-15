CREATE TABLE IF NOT EXISTS ranked_terminal_decisions (
  session_id UUID PRIMARY KEY,
  decision_type TEXT NOT NULL
    CHECK (decision_type IN ('forfeit', 'no_contest')),
  participant_p1_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  participant_p2_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  winner_account_id UUID NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  forfeiting_account_id UUID NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'settled', 'superseded')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token UUID NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error TEXT NULL,
  settled_match_id UUID NULL REFERENCES ranked_matches(match_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ranked_terminal_decisions_distinct_participants_check
    CHECK (participant_p1_account_id <> participant_p2_account_id),
  CONSTRAINT ranked_terminal_decisions_reason_check
    CHECK (
      reason = BTRIM(reason)
      AND OCTET_LENGTH(reason) BETWEEN 1 AND 256
      AND (
        (decision_type = 'forfeit' AND reason IN ('reconnect_timeout', 'peer_left'))
        OR
        (decision_type = 'no_contest' AND reason IN ('reconnect_timeout', 'session_expired'))
      )
    ),
  CONSTRAINT ranked_terminal_decisions_shape_check
    CHECK (
      (
        decision_type = 'forfeit'
        AND winner_account_id IS NOT NULL
        AND forfeiting_account_id IS NOT NULL
        AND (
          (
            winner_account_id = participant_p1_account_id
            AND forfeiting_account_id = participant_p2_account_id
          )
          OR
          (
            winner_account_id = participant_p2_account_id
            AND forfeiting_account_id = participant_p1_account_id
          )
        )
      )
      OR
      (
        decision_type = 'no_contest'
        AND winner_account_id IS NULL
        AND forfeiting_account_id IS NULL
      )
    ),
  CONSTRAINT ranked_terminal_decisions_lease_state_check
    CHECK (
      (
        status = 'processing'
        AND claim_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
      OR
      (
        status <> 'processing'
        AND claim_token IS NULL
        AND lease_expires_at IS NULL
      )
    ),
  CONSTRAINT ranked_terminal_decisions_attempt_state_check
    CHECK (status = 'pending' OR attempt_count > 0),
  CONSTRAINT ranked_terminal_decisions_retry_time_check
    CHECK (next_attempt_at >= due_at),
  CONSTRAINT ranked_terminal_decisions_last_error_check
    CHECK (last_error IS NULL OR OCTET_LENGTH(last_error) <= 2048),
  CONSTRAINT ranked_terminal_decisions_settled_match_state_check
    CHECK (settled_match_id IS NULL OR status IN ('settled', 'superseded'))
);

CREATE INDEX IF NOT EXISTS ranked_terminal_decisions_pending_work_idx
  ON ranked_terminal_decisions(
    (
      CASE
        WHEN status = 'processing' THEN lease_expires_at
        ELSE GREATEST(due_at, next_attempt_at)
      END
    ),
    decided_at,
    session_id
  )
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION reject_ranked_terminal_decision_identity_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.session_id,
    NEW.decision_type,
    NEW.participant_p1_account_id,
    NEW.participant_p2_account_id,
    NEW.winner_account_id,
    NEW.forfeiting_account_id,
    NEW.reason,
    NEW.due_at,
    NEW.decided_at
  ) IS DISTINCT FROM ROW(
    OLD.session_id,
    OLD.decision_type,
    OLD.participant_p1_account_id,
    OLD.participant_p2_account_id,
    OLD.winner_account_id,
    OLD.forfeiting_account_id,
    OLD.reason,
    OLD.due_at,
    OLD.decided_at
  ) THEN
    RAISE EXCEPTION 'ranked terminal decision identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'ranked_terminal_decisions_immutable_identity_trigger'
      AND tgrelid = 'ranked_terminal_decisions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER ranked_terminal_decisions_immutable_identity_trigger
      BEFORE UPDATE ON ranked_terminal_decisions
      FOR EACH ROW
      EXECUTE FUNCTION reject_ranked_terminal_decision_identity_update();
  END IF;
END;
$$;

COMMENT ON TABLE ranked_terminal_decisions IS
  'Durable immutable ranked forfeit and no-contest decisions with bounded settlement leasing.';
