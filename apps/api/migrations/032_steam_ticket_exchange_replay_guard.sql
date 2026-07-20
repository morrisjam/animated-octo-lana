CREATE TABLE IF NOT EXISTS steam_ticket_exchanges (
  ticket_digest CHAR(64) PRIMARY KEY CHECK (ticket_digest ~ '^[0-9a-f]{64}$'),
  steam_user_id TEXT NOT NULL CHECK (steam_user_id ~ '^\d{5,20}$'),
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  exchanged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS steam_ticket_exchanges_user_time_idx
  ON steam_ticket_exchanges(steam_user_id, exchanged_at DESC);

COMMENT ON TABLE steam_ticket_exchanges IS
  'Durable one-use claims for accepted GetAuthTicketForWebApi tickets. Only SHA-256 ticket fingerprints are retained.';
