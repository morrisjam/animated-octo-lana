import { describe, expect, test } from 'vitest';
import {
  appendArcadeRunHistoryEntry,
  areArcadeRunHistoriesEqual,
  computeArcadeBestRecords,
  createEmptyArcadeRunHistory,
  mergeArcadeRunHistories,
  sanitiseArcadeRunHistory,
  type ArcadeRunHistoryEntry,
} from './arcadeHistory';

function makeEntry(id: string, overrides: Partial<ArcadeRunHistoryEntry> = {}): ArcadeRunHistoryEntry {
  return {
    id,
    completedAt: '2026-02-15T01:00:00.000Z',
    playerCharacterId: 'vanguard',
    aiDifficulty: 'cadet',
    outcome: 'completed',
    completionSeconds: 360,
    stagesCleared: 4,
    totalStages: 4,
    continuesUsed: 1,
    retriesUsed: 0,
    ...overrides,
  };
}

describe('arcade run history', () => {
  test('sanitises invalid payloads safely', () => {
    const history = sanitiseArcadeRunHistory({
      entries: [
        makeEntry('ok-1'),
        { nope: true },
        makeEntry('ok-2', { playerCharacterId: 'ace', aiDifficulty: 'veteran' }),
      ],
    });
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0].id).toBe('ok-1');
  });

  test('append and merge dedupe by id and preserve newest-first order', () => {
    const base = createEmptyArcadeRunHistory();
    const first = appendArcadeRunHistoryEntry(base, makeEntry('run-1', { completedAt: '2026-02-15T01:00:00.000Z' }));
    const second = appendArcadeRunHistoryEntry(first, makeEntry('run-2', { completedAt: '2026-02-15T02:00:00.000Z' }));
    const merged = mergeArcadeRunHistories(
      second,
      sanitiseArcadeRunHistory({ entries: [makeEntry('run-2', { completedAt: '2026-02-15T02:00:00.000Z' })] }),
    );
    expect(merged.entries.map((entry) => entry.id)).toEqual(['run-2', 'run-1']);
    expect(areArcadeRunHistoriesEqual(merged, merged)).toBe(true);
  });

  test('computes best completion records per character and difficulty', () => {
    const history = sanitiseArcadeRunHistory({
      entries: [
        makeEntry('a', { playerCharacterId: 'vanguard', aiDifficulty: 'cadet', completionSeconds: 320 }),
        makeEntry('b', { playerCharacterId: 'vanguard', aiDifficulty: 'cadet', completionSeconds: 280 }),
        makeEntry('c', { playerCharacterId: 'ace', aiDifficulty: 'veteran', completionSeconds: 410 }),
        makeEntry('d', { playerCharacterId: 'ace', aiDifficulty: 'veteran', completionSeconds: 500, outcome: 'failed' }),
      ],
    });
    const best = computeArcadeBestRecords(history);
    expect(best).toHaveLength(2);
    const vanguardCadet = best.find((row) => row.playerCharacterId === 'vanguard' && row.aiDifficulty === 'cadet');
    expect(vanguardCadet?.completionSeconds).toBe(280);
  });
});
