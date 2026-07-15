import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT,
  DEFAULT_REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT,
  evaluateReplayIngestQuota,
  resolveReplayIngestQuotaPolicy,
} from './ingestPolicy';

test('resolves bounded replay archive quotas', () => {
  assert.deepEqual(resolveReplayIngestQuotaPolicy({}), {
    maxActiveArchivesPerAccount: DEFAULT_REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT,
    maxActiveBytesPerAccount: DEFAULT_REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT,
  });
  assert.deepEqual(resolveReplayIngestQuotaPolicy({
    REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT: '25',
    REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT: '10485760',
  }), {
    maxActiveArchivesPerAccount: 25,
    maxActiveBytesPerAccount: 10_485_760,
  });
  assert.throws(
    () => resolveReplayIngestQuotaPolicy({ REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT: '0' }),
    /REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT/,
  );
});

test('rejects count and byte quota overruns independently', () => {
  const policy = {
    maxActiveArchivesPerAccount: 2,
    maxActiveBytesPerAccount: 100,
  };
  assert.deepEqual(evaluateReplayIngestQuota({
    activeArchives: 1,
    activeCompressedBytes: 40,
    incomingEstimatedBytes: 50,
  }, policy), { allowed: true });
  assert.equal(evaluateReplayIngestQuota({
    activeArchives: 2,
    activeCompressedBytes: 0,
    incomingEstimatedBytes: 1,
  }, policy).allowed, false);
  const bytes = evaluateReplayIngestQuota({
    activeArchives: 1,
    activeCompressedBytes: 60,
    incomingEstimatedBytes: 41,
  }, policy);
  assert.deepEqual(bytes, {
    allowed: false,
    code: 'archive_bytes_quota',
    error: 'Replay storage quota reached (100 bytes).',
  });
});
