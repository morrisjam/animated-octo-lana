import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneExpiredReplayArchives } from './retention';

test('deletes expired blobs before their cascading metadata rows', async () => {
  const calls: string[] = [];
  const database = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      if (text.includes('SELECT replay_id')) {
        assert.deepEqual(values, [50]);
        return {
          rowCount: 2,
          rows: [
            { replay_id: 'replay-1', storage_key: 'one.json.gz' },
            { replay_id: 'replay-2', storage_key: 'two.json.gz' },
          ] as T[],
        };
      }
      calls.push(`metadata:${String(values[0])}`);
      return { rowCount: 1, rows: [] as T[] };
    },
  };
  const result = await pruneExpiredReplayArchives(database, {
    async deleteReplayPayload(storageKey: string) {
      calls.push(`blob:${storageKey}`);
    },
  }, 50);
  assert.deepEqual(result, { selected: 2, deleted: 2 });
  assert.deepEqual(calls, [
    'blob:one.json.gz',
    'metadata:replay-1',
    'blob:two.json.gz',
    'metadata:replay-2',
  ]);
});

test('leaves metadata intact when blob deletion fails so cleanup can retry', async () => {
  let metadataDeleteCalled = false;
  const database = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string) {
      if (text.includes('SELECT replay_id')) {
        return {
          rowCount: 1,
          rows: [{ replay_id: 'replay-1', storage_key: 'one.json.gz' }] as T[],
        };
      }
      metadataDeleteCalled = true;
      return { rowCount: 1, rows: [] as T[] };
    },
  };
  await assert.rejects(
    () => pruneExpiredReplayArchives(database, {
      async deleteReplayPayload() {
        throw new Error('storage unavailable');
      },
    }),
    /storage unavailable/,
  );
  assert.equal(metadataDeleteCalled, false);
});
