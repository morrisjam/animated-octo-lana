-- Preserve the oldest row when earlier creation races left overlapping active seasons.
WITH overlapping_active_seasons AS (
  SELECT duplicate.season_id
  FROM ranked_seasons duplicate
  WHERE duplicate.state = 'active'
    AND EXISTS (
      SELECT 1
      FROM ranked_seasons keeper
      WHERE keeper.state = 'active'
        AND keeper.season_id <> duplicate.season_id
        AND tstzrange(keeper.starts_at, keeper.ends_at, '[)')
          && tstzrange(duplicate.starts_at, duplicate.ends_at, '[)')
        AND (keeper.created_at, keeper.season_id) < (duplicate.created_at, duplicate.season_id)
    )
)
UPDATE ranked_seasons
SET state = 'archived',
    archived_at = COALESCE(archived_at, NOW())
WHERE season_id IN (SELECT season_id FROM overlapping_active_seasons);

ALTER TABLE ranked_seasons
  ADD CONSTRAINT ranked_seasons_active_windows_exclude
  EXCLUDE USING gist (
    (tstzrange(starts_at, ends_at, '[)')) WITH &&
  )
  WHERE (state = 'active');
