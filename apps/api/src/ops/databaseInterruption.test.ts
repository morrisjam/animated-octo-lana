import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDatabaseApplicationName,
  summarizeDatabaseBackendReplacement,
} from './databaseInterruption';

test('accepts a bounded PostgreSQL application name for an isolated target', () => {
  assert.equal(
    parseDatabaseApplicationName(' gravity-well:ci_api-1 '),
    'gravity-well:ci_api-1',
  );
});

test('rejects absent, unsafe, and server-truncated application names', () => {
  assert.throws(() => parseDatabaseApplicationName(undefined), /must be 1-63 ASCII/);
  assert.throws(() => parseDatabaseApplicationName('gravity well api'), /must be 1-63 ASCII/);
  assert.throws(() => parseDatabaseApplicationName(`a${'b'.repeat(63)}`), /must be 1-63 ASCII/);
});

test('requires every previous backend to be replaced by a new backend', () => {
  assert.deepEqual(
    summarizeDatabaseBackendReplacement([41, 42], [51, 52]),
    {
      previousBackendCount: 2,
      recoveredBackendCount: 2,
      survivingPreviousBackendCount: 0,
      replacementBackendCount: 2,
      replaced: true,
    },
  );
  assert.equal(summarizeDatabaseBackendReplacement([41, 42], [42, 51]).replaced, false);
  assert.equal(summarizeDatabaseBackendReplacement([], [51]).replaced, false);
  assert.equal(summarizeDatabaseBackendReplacement([41], []).replaced, false);
});
