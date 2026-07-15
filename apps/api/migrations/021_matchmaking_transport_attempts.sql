ALTER TABLE matchmaking_session_signals
  ADD COLUMN IF NOT EXISTS transport_attempt_id UUID;

-- Signals from pre-attempt builds cannot be attributed safely after rollout.
DELETE FROM matchmaking_session_signals
WHERE transport_attempt_id IS NULL;

DROP INDEX IF EXISTS matchmaking_session_signals_recipient_poll_idx;

CREATE INDEX IF NOT EXISTS matchmaking_session_signals_recipient_attempt_poll_idx
  ON matchmaking_session_signals(
    recipient_account_id,
    session_id,
    transport_attempt_id,
    signal_id
  );

COMMENT ON COLUMN matchmaking_session_signals.transport_attempt_id IS
  'Server-issued connection-attempt identity used to reject stale WebRTC negotiation messages. Nullable during the previous-build rollback window.';
