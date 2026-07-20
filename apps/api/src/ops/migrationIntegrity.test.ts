import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMigrationChecksum,
  validateMigrationIntegrity,
  verifyMigrationHistoryMatchesRelease,
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

test('readiness requires an exact applied filename and checksum manifest', () => {
  const files = [
    { filename: '001.sql', checksum: 'first' },
    { filename: '002.sql', checksum: 'second' },
  ];
  assert.deepEqual(
    verifyMigrationHistoryMatchesRelease(files, [
      { filename: '001.sql', checksum: 'first' },
      { filename: '002.sql', checksum: 'second' },
    ]),
    { migrationHead: '002.sql', migrationCount: 2 },
  );
  assert.throws(
    () => verifyMigrationHistoryMatchesRelease(files, [
      { filename: '001.sql', checksum: 'first' },
    ]),
    /002\.sql has not been applied/,
  );
  assert.throws(
    () => verifyMigrationHistoryMatchesRelease(files, [
      { filename: '001.sql', checksum: null },
      { filename: '002.sql', checksum: 'second' },
    ]),
    /legacy rows/,
  );
  assert.throws(
    () => verifyMigrationHistoryMatchesRelease([
      ...files,
      { filename: '002.sql', checksum: 'duplicate' },
    ], []),
    /duplicate filename/,
  );
  assert.throws(
    () => verifyMigrationHistoryMatchesRelease([], []),
    /no migration files/,
  );
});

test('forward-compatible mode accepts only a checksummed suffix after the exact release prefix', () => {
  const files = [
    { filename: '001.sql', checksum: 'one' },
    { filename: '002.sql', checksum: 'two' },
  ];
  const applied = [
    { filename: '001.sql', checksum: 'one' },
    { filename: '002.sql', checksum: 'two' },
    { filename: '003.sql', checksum: 'three' },
  ];

  assert.throws(
    () => verifyMigrationHistoryMatchesRelease(files, applied),
    /missing from this release/,
  );
  assert.deepEqual(
    verifyMigrationHistoryMatchesRelease(files, applied, { allowAppliedSuffix: true }),
    { migrationHead: '003.sql', migrationCount: 3 },
  );
  assert.throws(
    () => verifyMigrationHistoryMatchesRelease(files, [
      { filename: '001.sql', checksum: 'one' },
      { filename: '001-extra.sql', checksum: 'extra' },
      { filename: '002.sql', checksum: 'two' },
    ], { allowAppliedSuffix: true }),
    /forward-compatible suffix/,
  );
  assert.throws(
    () => verifyMigrationHistoryMatchesRelease(files, [
      ...applied.slice(0, 2),
      { filename: '003.sql', checksum: null },
    ], { allowAppliedSuffix: true }),
    /missing from this release/,
  );
});
