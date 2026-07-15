ALTER TABLE ranked_master_season_standings
  ADD COLUMN IF NOT EXISTS region TEXT NULL;

UPDATE ranked_master_season_standings AS standings
SET region = COALESCE(
  NULLIF(LOWER(TRIM(profile.settings_json->>'region')), ''),
  'global'
)
FROM profiles AS profile
WHERE profile.account_id = standings.account_id
  AND standings.region IS NULL;

UPDATE ranked_master_season_standings
SET region = 'global'
WHERE region IS NULL;

ALTER TABLE ranked_master_season_standings
  ALTER COLUMN region SET DEFAULT 'global';

-- backward-compatible-exception: alter_column_set_not_null Backfill and default make legacy inserts safe before enforcement.
ALTER TABLE ranked_master_season_standings
  ALTER COLUMN region SET NOT NULL;

CREATE INDEX IF NOT EXISTS ranked_master_season_standings_region_rank_idx
  ON ranked_master_season_standings(season_id, region, rank_position, account_id);
