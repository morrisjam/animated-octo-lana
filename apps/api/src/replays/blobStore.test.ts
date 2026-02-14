import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalReplayBlobStore } from './blobStore';

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
  assert.equal(putResult.storageKey, `${replayId}.json.gz`);
  assert.ok(putResult.compressedBytes > 0);
  assert.ok(putResult.sha256.length > 0);

  const storedPayload = await store.getReplayPayload(putResult.storageKey);
  assert.deepEqual(storedPayload, payload);

  await store.deleteReplayPayload(putResult.storageKey);
  await rm(tempDir, { recursive: true, force: true });
});
