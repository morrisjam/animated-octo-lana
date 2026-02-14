CREATE TABLE IF NOT EXISTS ranked_anomaly_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('impossible_cadence', 'rating_jump', 'mr_jump')),
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'false_positive', 'confirmed')),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES ranked_matches(match_id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by TEXT NULL,
  review_note TEXT NULL
);

CREATE INDEX IF NOT EXISTS ranked_anomaly_alerts_status_idx
  ON ranked_anomaly_alerts(status, detected_at DESC);

CREATE INDEX IF NOT EXISTS ranked_anomaly_alerts_account_idx
  ON ranked_anomaly_alerts(account_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS ranked_anomaly_alerts_match_idx
  ON ranked_anomaly_alerts(match_id, detected_at DESC);
