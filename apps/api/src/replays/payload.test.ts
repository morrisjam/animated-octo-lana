import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReplayPayloadForArchive } from './payload';

test('validates replay payload with versioned header', () => {
  const validation = validateReplayPayloadForArchive({
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
      seed: 1,
    },
    inputTimeline: [{ p1: { moveX: 1 }, p2: { moveX: -1 } }],
  });

  assert.equal(validation.ok, true);
  if (!validation.ok) {
    throw new Error('Expected valid replay payload');
  }
  assert.equal(validation.payload.header.payloadVersion, 1);
});

test('returns explicit unsupported version error', () => {
  const validation = validateReplayPayloadForArchive({
    header: {
      payloadVersion: 999,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
    },
    inputTimeline: [],
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.errorCode, 'unsupported_payload_version');
});
