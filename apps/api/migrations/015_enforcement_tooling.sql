CREATE TABLE IF NOT EXISTS enforcement_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_identity TEXT NOT NULL,
  source_alert_id UUID NULL REFERENCES ranked_anomaly_alerts(alert_id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('warning', 'suspension', 'ban')),
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_by TEXT NULL,
  revoked_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (action_type = 'suspension' AND ends_at IS NOT NULL AND ends_at > starts_at)
    OR (action_type IN ('warning', 'ban') AND ends_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS enforcement_actions_target_idx
  ON enforcement_actions(target_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS enforcement_actions_type_idx
  ON enforcement_actions(action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS enforcement_actions_active_idx
  ON enforcement_actions(target_account_id, action_type, starts_at DESC, ends_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS enforcement_appeals (
  appeal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES enforcement_actions(action_id) ON DELETE CASCADE,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  submitted_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'accepted', 'rejected')),
  player_note TEXT NULL,
  reviewer_note TEXT NULL,
  reviewed_by TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (action_id, submitted_by_account_id)
);

CREATE INDEX IF NOT EXISTS enforcement_appeals_status_idx
  ON enforcement_appeals(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS enforcement_appeals_target_idx
  ON enforcement_appeals(target_account_id, updated_at DESC);
