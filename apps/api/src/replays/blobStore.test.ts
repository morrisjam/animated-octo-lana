import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  createReplayBlobStoreFromEnv,
  LocalReplayBlobStore,
  PostgresReplayBlobStore,
} from './blobStore';

test('local replay blob store round-trips payload and deletes blobs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gw-replay-'));
  const store = new LocalReplayBlobStore({ rootDirectory: tempDir });
  const replayId = '11111111-1111-4111-8111-111111111111';
  const payload = {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
    },
    inputTimeline: [{ p1: { moveX: 1 }, p2: { moveX: -1 } }],
  };

  const putResult = await store.putReplayPayload(replayId, payload);
  assert.equal(store.provider, 'local');
  assert.equal(store.durable, false);
  assert.equal(putResult.storageKey, `${replayId}.json.gz`);
  assert.ok(putResult.compressedBytes > 0);
  assert.ok(putResult.sha256.length > 0);

  const storedPayload = await store.getReplayPayload(putResult.storageKey);
  assert.deepEqual(storedPayload, payload);

  await store.deleteReplayPayload(putResult.storageKey);
  await rm(tempDir, { recursive: true, force: true });
});

test('postgres replay blob store round-trips compressed payloads durably', async () => {
  let stored: Buffer | null = null;
  const queries: string[] = [];
  const database = {
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (sql.includes('INSERT INTO replay_payload_blobs')) {
        stored = values?.[1] as Buffer;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT payload_gzip')) {
        return { rows: stored ? [{ payload_gzip: stored }] : [], rowCount: stored ? 1 : 0 };
      }
      if (sql.includes('DELETE FROM replay_payload_blobs')) {
        stored = null;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pick<Pool, 'query'>;
  const store = new PostgresReplayBlobStore({ database });
  const replayId = '22222222-2222-4222-8222-222222222222';
  const payload = {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'alpha-test',
    },
    inputTimeline: [{ p1: { launch: true }, p2: { parry: true } }],
  };

  const putResult = await store.putReplayPayload(replayId, payload);
  assert.equal(store.provider, 'postgres');
  assert.equal(store.durable, true);
  assert.equal(putResult.storageKey, `${replayId}.json.gz`);
  assert.ok(Buffer.isBuffer(stored));
  assert.deepEqual(await store.getReplayPayload(putResult.storageKey), payload);

  await store.deleteReplayPayload(putResult.storageKey);
  await assert.rejects(
    () => store.getReplayPayload(putResult.storageKey),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );
  assert.equal(queries.length, 4);
});

test('postgres provider fails closed without a database dependency', () => {
  assert.throws(
    () => createReplayBlobStoreFromEnv({ REPLAY_BLOB_PROVIDER: 'postgres' }),
    /requires a database connection/,
  );
});
