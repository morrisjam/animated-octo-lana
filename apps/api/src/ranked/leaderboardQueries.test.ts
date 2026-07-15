import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL,
  ARCHIVED_MASTER_LEADERBOARD_TOTAL_SQL,
} from './leaderboardQueries';

test('archived Master leaderboards filter and report the snapshotted region', () => {
  assert.match(ARCHIVED_MASTER_LEADERBOARD_TOTAL_SQL, /s\.region = \$2/);
  assert.match(ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL, /s\.region = \$2/);
  assert.match(ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL, /s\.region,/);
  assert.doesNotMatch(ARCHIVED_MASTER_LEADERBOARD_TOTAL_SQL, /settings_json/);
  assert.doesNotMatch(ARCHIVED_MASTER_LEADERBOARD_PAGE_SQL, /settings_json/);
});
