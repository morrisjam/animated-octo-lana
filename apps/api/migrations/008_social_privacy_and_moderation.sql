CREATE TABLE IF NOT EXISTS social_privacy_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  presence_visibility TEXT NOT NULL DEFAULT 'friends' CHECK (presence_visibility IN ('friends', 'private')),
  invite_permissions TEXT NOT NULL DEFAULT 'friends' CHECK (invite_permissions IN ('friends', 'none')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS social_moderation_controls (
  owner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_account_id, target_account_id),
  CHECK (owner_account_id <> target_account_id)
);

CREATE INDEX IF NOT EXISTS social_moderation_controls_owner_idx
  ON social_moderation_controls(owner_account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS social_moderation_controls_target_idx
  ON social_moderation_controls(target_account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_moderation_events (
  event_id BIGSERIAL PRIMARY KEY,
  actor_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  target_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'mute',
      'unmute',
      'block',
      'unblock',
      'privacy_updated',
      'friend_request_blocked',
      'invite_blocked'
    )
  ),
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_moderation_events_actor_idx
  ON social_moderation_events(actor_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS social_moderation_events_target_idx
  ON social_moderation_events(target_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS social_moderation_events_action_idx
  ON social_moderation_events(action, created_at DESC);
