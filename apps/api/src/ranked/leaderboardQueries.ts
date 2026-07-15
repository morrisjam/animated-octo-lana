export const ARCHIVED_MASTER_LEADERBOARD_TOTAL_SQL = `
  SELECT COUNT(*) AS count
  FROM ranked_master_season_standings s
  WHERE s.season_id = $1
    AND ($2::text IS NULL OR s.region = $2)
`;

export const ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL = `
  SELECT
    s.rank_position,
    s.account_id,
    p.display_name,
    s.region,
    s.mr_points,
    s.matches_played,
    s.wins,
    s.losses,
    s.draws,
    s.forfeits,
    s.entered_at,
    s.captured_at
  FROM ranked_master_season_standings s
  LEFT JOIN profiles p ON p.account_id = s.account_id
  WHERE s.season_id = $1
    AND ($2::text IS NULL OR s.region = $2)
  ORDER BY s.rank_position ASC, s.account_id ASC
  LIMIT $3 OFFSET $4
`;
