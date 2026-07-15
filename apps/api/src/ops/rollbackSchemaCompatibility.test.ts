import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
  type RollbackSchemaCompatibilityReport,
  isExactGitSha,
  validateRollbackSchemaCompatibilityReport,
} from './rollbackSchemaCompatibility';

const CANDIDATE_SHA = 'a'.repeat(40);
const ROLLBACK_SHA = 'b'.repeat(40);
const MIGRATION_DIGEST = 'c'.repeat(64);

function createReport(): RollbackSchemaCompatibilityReport {
  return {
    schemaVersion: ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    generatedAt: '2026-07-15T12:00:00.000Z',
    ok: true,
    localOnly: true,
    hostedServicesContacted: false,
    runtimeDependenciesSource: 'candidate_install',
    candidate: {
      sha: CANDIDATE_SHA,
      dirty: false,
      migrationHead: '002_expand.sql',
      migrationCount: 2,
      migrationDigest: MIGRATION_DIGEST,
    },
    rollback: {
      sha: ROLLBACK_SHA,
      migrationHead: '001_initial.sql',
      migrationCount: 1,
      migrationDigest: MIGRATION_DIGEST,
    },
    compatibilityExceptions: [],
    phases: [
      { name: 'rollback_migrations', status: 'passed', durationMs: 10 },
      { name: 'rollback_pre_upgrade_probe', status: 'passed', durationMs: 20 },
      { name: 'candidate_migrations', status: 'passed', durationMs: 30 },
      { name: 'rollback_post_upgrade_probe', status: 'passed', durationMs: 20 },
    ],
    probes: {
      beforeUpgrade: {
        accountsCreated: 2,
        profilesWritten: 2,
        rankedTicketsCreated: 2,
        matchedSessionObserved: true,
      },
      afterUpgrade: {
        accountsCreated: 2,
        profilesWritten: 2,
        rankedTicketsCreated: 2,
        matchedSessionObserved: true,
      },
    },
    failure: null,
  };
}

test('accepts exact clean local evidence for the requested release pair', () => {
  assert.deepEqual(validateRollbackSchemaCompatibilityReport(createReport(), {
    candidateSha: CANDIDATE_SHA,
    rollbackSha: ROLLBACK_SHA,
    requireCleanCandidate: true,
  }), []);
});

test('rejects stale, dirty, or incomplete rollback evidence', () => {
  const report = createReport();
  report.candidate.dirty = true;
  report.rollback.sha = 'd'.repeat(40);
  report.phases = report.phases.filter((phase) => phase.name !== 'rollback_post_upgrade_probe');
  report.probes.afterUpgrade = null;

  assert.deepEqual(validateRollbackSchemaCompatibilityReport(report, {
    candidateSha: CANDIDATE_SHA,
    rollbackSha: ROLLBACK_SHA,
    requireCleanCandidate: true,
  }), [
    'rollback SHA does not match the expected release',
    'candidate checkout must be clean',
    'rollback_post_upgrade_probe must appear exactly once and pass',
    'both pre-upgrade and post-upgrade rollback probes are required',
  ]);
});

test('requires exact commit identifiers', () => {
  assert.equal(isExactGitSha(CANDIDATE_SHA), true);
  assert.equal(isExactGitSha('abc123'), false);
});
