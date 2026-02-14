import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRankedSeasonDurationDays, runRankedSeasonReset } from './seasonService';

test('resolveRankedSeasonDurationDays falls back to default when env is missing', () => {
  assert.equal(resolveRankedSeasonDurationDays({} as NodeJS.ProcessEnv), 90);
});

test('resolveRankedSeasonDurationDays uses explicit positive integer env value', () => {
  assert.equal(resolveRankedSeasonDurationDays({
    RANKED_SEASON_DURATION_DAYS: '45',
  } as NodeJS.ProcessEnv), 45);
});

test('runRankedSeasonReset returns locked when advisory lock cannot be acquired', async () => {
  const result = await runRankedSeasonReset(
    {
      async query(): Promise<{ rows: unknown[]; rowCount: number | null }> {
        return {
          rows: [{ locked: false }],
          rowCount: 1,
        };
      },
    },
    new Date('2026-02-14T00:00:00.000Z'),
    90,
  );
  assert.deepEqual(result, { status: 'locked' });
});

test('runRankedSeasonReset no-ops when there is no expired active season', async () => {
  let callCount = 0;
  const result = await runRankedSeasonReset(
    {
      async query(): Promise<{ rows: unknown[]; rowCount: number | null }> {
        callCount += 1;
        if (callCount === 1) {
          return {
            rows: [{ locked: true }],
            rowCount: 1,
          };
        }
        return {
          rows: [],
          rowCount: 0,
        };
      },
    },
    new Date('2026-02-14T00:00:00.000Z'),
    90,
  );
  assert.deepEqual(result, { status: 'no_expired_season' });
});
