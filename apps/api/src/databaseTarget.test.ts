import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalDatabaseTarget,
  assertSmokeDatabaseTarget,
  classifyDatabaseTarget,
} from './databaseTarget';

test('classifies loopback and local container database hosts', () => {
  assert.equal(classifyDatabaseTarget('postgres://postgres:postgres@localhost:5432/gravity_well'), 'local');
  assert.equal(classifyDatabaseTarget('postgres://postgres:postgres@127.12.4.9:5432/gravity_well'), 'local');
  assert.equal(classifyDatabaseTarget('postgres://postgres:postgres@[::1]:5432/gravity_well'), 'local');
  assert.equal(classifyDatabaseTarget('postgres://postgres:postgres@postgres:5432/gravity_well'), 'local');
});

test('classifies hosted and malformed database targets conservatively', () => {
  assert.equal(
    classifyDatabaseTarget('postgresql://user:secret@ep-example.eu-west-2.aws.neon.tech/gravity_well'),
    'remote',
  );
  assert.equal(classifyDatabaseTarget('not-a-postgres-url'), 'unknown');
});

test('requires an explicit staging identity as well as opt-in for a remote target', () => {
  const remote = 'postgresql://user:secret@ep-example.eu-west-2.aws.neon.tech/gravity_well';
  assert.throws(
    () => assertLocalDatabaseTarget(remote, 'Ranked smoke'),
    /requires a local PostgreSQL target/,
  );
  assert.throws(
    () => assertLocalDatabaseTarget(remote, 'Ranked smoke', true, ''),
    /identify itself as canary or staging/,
  );
  assert.doesNotThrow(() => assertLocalDatabaseTarget(remote, 'Ranked smoke', true, 'canary'));
  assert.doesNotThrow(() => assertLocalDatabaseTarget(remote, 'Ranked smoke', true, 'STAGING'));
});

test('remote smoke opt-in never permits production or an unknown target', () => {
  assert.throws(
    () => assertSmokeDatabaseTarget('remote', 'Ranked smoke', {
      allowRemote: true,
      deploymentEnvironment: 'production',
    }),
    /never permits production/,
  );
  assert.throws(
    () => assertSmokeDatabaseTarget('unknown', 'Ranked smoke', {
      allowRemote: true,
      deploymentEnvironment: 'canary',
    }),
    /requires a local PostgreSQL target/,
  );
});
