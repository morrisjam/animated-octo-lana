import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMigrationChecksum,
  validateMigrationIntegrity,
} from './migrationIntegrity';

test('computes stable SHA-256 migration checksums', () => {
  assert.equal(
    computeMigrationChecksum('SELECT 1;'),
    '17db4fd369edb9244b9f91d9aeed145c3d04ad8ba6e95d06247f07a63527d11a',
  );
});

test('rejects modified or missing applied migrations', () => {
  const files = [{ filename: '001.sql', checksum: 'current' }];
  assert.throws(
    () => validateMigrationIntegrity(files, [{ filename: '001.sql', checksum: 'old' }]),
    /checksum does not match/,
  );
  assert.throws(
    () => validateMigrationIntegrity(files, [{ filename: '000.sql', checksum: 'legacy' }]),
    /missing from this release/,
  );
});

test('identifies legacy migration rows that need a one-time checksum backfill', () => {
  const files = [{ filename: '001.sql', checksum: 'current' }];
  assert.deepEqual(
    validateMigrationIntegrity(files, [{ filename: '001.sql', checksum: null }]),
    { checksumsToBackfill: files },
  );
});
