CREATE TABLE IF NOT EXISTS friend_requests (
  request_id BIGSERIAL PRIMARY KEY,
  requester_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'blocked')),
  actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ NULL,
  CHECK (requester_account_id <> target_account_id)
);

CREATE INDEX IF NOT EXISTS friend_requests_requester_status_idx
  ON friend_requests(requester_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS friend_requests_target_status_idx
  ON friend_requests(target_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS friend_requests_pair_status_idx
  ON friend_requests(requester_account_id, target_account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  account_id_low UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_id_high UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_request_id BIGINT NULL REFERENCES friend_requests(request_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id_low, account_id_high),
  CHECK (account_id_low <> account_id_high)
);

CREATE INDEX IF NOT EXISTS friendships_low_idx
  ON friendships(account_id_low, created_at DESC);
CREATE INDEX IF NOT EXISTS friendships_high_idx
  ON friendships(account_id_high, created_at DESC);
