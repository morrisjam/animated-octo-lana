import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findMigrationCompatibilityExceptions,
  findMigrationCompatibilityViolations,
} from './migrationCompatibility';

test('detects multiline destructive migration statements', () => {
  const violations = findMigrationCompatibilityViolations(`
    ALTER TABLE accounts
      ALTER COLUMN status
      TYPE VARCHAR(32);
    ALTER TABLE profiles
      DROP COLUMN settings_json;
  `);
  assert.deepEqual(violations.map((violation) => violation.pattern), [
    'alter_column_type',
    'drop_column',
  ]);
});

test('ignores blocked words inside SQL comments', () => {
  assert.deepEqual(findMigrationCompatibilityViolations(`
    -- DROP TABLE accounts;
    /* ALTER TABLE profiles ALTER COLUMN settings_json TYPE TEXT; */
    CREATE TABLE safe_table(id INTEGER);
  `), []);
});

test('requires a named documented exception and does not bypass other patterns', () => {
  const sql = `
    -- backward-compatible-exception: drop_column retained in the expand-contract release plan
    ALTER TABLE profiles DROP COLUMN settings_json;
    DROP TABLE obsolete_profiles;
  `;
  const violations = findMigrationCompatibilityViolations(sql);
  assert.deepEqual(violations.map((violation) => violation.pattern), ['drop_table']);
  assert.deepEqual(findMigrationCompatibilityExceptions(sql), [{
    line: 2,
    pattern: 'drop_column',
    reason: 'retained in the expand-contract release plan',
  }]);
});

test('does not report malformed compatibility exceptions as evidence', () => {
  assert.deepEqual(findMigrationCompatibilityExceptions(`
    -- backward-compatible-exception: unknown_pattern this is not a known rule
    -- backward-compatible-exception: drop_table short
  `), []);
});
