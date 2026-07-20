export const ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION = 'gw.rollback-schema-compatibility.v2' as const;

export type RollbackSchemaCompatibilityPhaseName =
  | 'rollback_dependencies'
  | 'rollback_migrations'
  | 'rollback_pre_upgrade_probe'
  | 'candidate_migrations'
  | 'rollback_post_upgrade_migrations'
  | 'rollback_post_upgrade_probe';

export interface RollbackSchemaCompatibilityPhase {
  name: RollbackSchemaCompatibilityPhaseName;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

export interface RollbackSchemaIdentity {
  sha: string;
  dirty?: boolean;
  migrationHead: string;
  migrationCount: number;
  migrationDigest: string;
}

export interface RollbackSchemaCompatibilityExceptionEvidence {
  migration: string;
  line: number;
  pattern: string;
  reason: string;
}

export interface RollbackSchemaCompatibilityProbeEvidence {
  accountsCreated: number;
  profilesWritten: number;
  rankedTicketsCreated: number;
  matchedSessionObserved: boolean;
}

export interface RollbackSchemaCompatibilityReport {
  schemaVersion: typeof ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION;
  generatedAt: string;
  ok: boolean;
  localOnly: true;
  hostedServicesContacted: false;
  runtimeDependenciesSource: 'rollback_install';
  candidate: RollbackSchemaIdentity & { dirty: boolean };
  rollback: RollbackSchemaIdentity;
  compatibilityExceptions: RollbackSchemaCompatibilityExceptionEvidence[];
  phases: RollbackSchemaCompatibilityPhase[];
  probes: {
    beforeUpgrade: RollbackSchemaCompatibilityProbeEvidence | null;
    afterUpgrade: RollbackSchemaCompatibilityProbeEvidence | null;
  };
  failure: string | null;
}

export interface RollbackSchemaCompatibilityExpectation {
  candidateSha: string;
  rollbackSha: string;
  requireCleanCandidate?: boolean;
}

const SHA_REGEX = /^[0-9a-f]{40}$/i;
const DIGEST_REGEX = /^[0-9a-f]{64}$/i;
const REQUIRED_PHASES: RollbackSchemaCompatibilityPhaseName[] = [
  'rollback_dependencies',
  'rollback_migrations',
  'rollback_pre_upgrade_probe',
  'candidate_migrations',
  'rollback_post_upgrade_migrations',
  'rollback_post_upgrade_probe',
];

export function isExactGitSha(value: string): boolean {
  return SHA_REGEX.test(value.trim());
}

export function validateRollbackSchemaCompatibilityReport(
  report: RollbackSchemaCompatibilityReport,
  expectation: RollbackSchemaCompatibilityExpectation,
): string[] {
  const errors: string[] = [];
  if (report.schemaVersion !== ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION}`);
  }
  if (!report.ok || report.failure !== null) {
    errors.push('report must record a successful compatibility run');
  }
  if (report.localOnly !== true || report.hostedServicesContacted !== false) {
    errors.push('report must prove local-only execution without hosted services');
  }
  if (report.runtimeDependenciesSource !== 'rollback_install') {
    errors.push('runtime dependency source must be the rollback install');
  }
  if (report.candidate.sha.toLowerCase() !== expectation.candidateSha.toLowerCase()) {
    errors.push('candidate SHA does not match the expected release');
  }
  if (report.rollback.sha.toLowerCase() !== expectation.rollbackSha.toLowerCase()) {
    errors.push('rollback SHA does not match the expected release');
  }
  if (expectation.requireCleanCandidate && report.candidate.dirty) {
    errors.push('candidate checkout must be clean');
  }
  for (const [label, identity] of [
    ['candidate', report.candidate],
    ['rollback', report.rollback],
  ] as const) {
    if (!isExactGitSha(identity.sha)) {
      errors.push(`${label} SHA is not an exact 40-character commit`);
    }
    if (!identity.migrationHead || identity.migrationCount < 1) {
      errors.push(`${label} migration identity is incomplete`);
    }
    if (!DIGEST_REGEX.test(identity.migrationDigest)) {
      errors.push(`${label} migration digest is invalid`);
    }
  }
  if (report.candidate.migrationCount < report.rollback.migrationCount) {
    errors.push('candidate migration chain is shorter than the rollback chain');
  }
  for (const requiredPhase of REQUIRED_PHASES) {
    const matches = report.phases.filter((phase) => phase.name === requiredPhase);
    if (matches.length !== 1 || matches[0].status !== 'passed') {
      errors.push(`${requiredPhase} must appear exactly once and pass`);
    }
  }
  if (!report.probes.beforeUpgrade || !report.probes.afterUpgrade) {
    errors.push('both pre-upgrade and post-upgrade rollback probes are required');
  } else {
    for (const [label, probe] of [
      ['beforeUpgrade', report.probes.beforeUpgrade],
      ['afterUpgrade', report.probes.afterUpgrade],
    ] as const) {
      if (
        probe.accountsCreated < 2
        || probe.profilesWritten < 2
        || probe.rankedTicketsCreated < 2
        || !probe.matchedSessionObserved
      ) {
        errors.push(`${label} did not exercise the required account, profile, and ranked paths`);
      }
    }
  }
  return errors;
}
