CREATE INDEX IF NOT EXISTS replays_search_newest_idx
  ON replays(started_at DESC, replay_id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS replays_search_queue_patch_started_idx
  ON replays(queue_type, patch_version, started_at DESC, replay_id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS replay_participants_search_account_character_idx
  ON replay_participants(account_id, character_id, replay_id DESC);

CREATE INDEX IF NOT EXISTS replay_participants_search_account_side_idx
  ON replay_participants(account_id, side, replay_id DESC);
