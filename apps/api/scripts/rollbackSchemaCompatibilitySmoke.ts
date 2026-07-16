import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';
import { findMigrationCompatibilityExceptions } from '../src/ops/migrationCompatibility';
import {
  ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
  type RollbackSchemaCompatibilityExceptionEvidence,
  type RollbackSchemaCompatibilityPhase,
  type RollbackSchemaCompatibilityPhaseName,
  type RollbackSchemaCompatibilityProbeEvidence,
  type RollbackSchemaCompatibilityReport,
  type RollbackSchemaIdentity,
  isExactGitSha,
  validateRollbackSchemaCompatibilityReport,
} from '../src/ops/rollbackSchemaCompatibility';
import { createRollbackProbeServerEnvironment } from '../src/ops/rollbackProbeContract';
import { runRollbackApiCompatibilityProbe } from './rollbackApiCompatibilityProbe';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, '../../..');
const apiWorkspaceRoot = path.join(repositoryRoot, 'apps/api');
const defaultArtifactDir = path.join(
  repositoryRoot,
  'apps/api/build-artifacts/rollback-schema-compatibility',
);
const MAX_LOG_BYTES = 500_000;

interface Options {
  rollbackSha: string;
  candidateSha: string | null;
  reportPath: string;
  requireCleanCandidate: boolean;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ManagedApi {
  child: ChildProcessByStdio<null, Readable, Readable>;
  stdout: string;
  stderr: string;
}

interface MigrationIdentityWithFiles extends RollbackSchemaIdentity {
  files: string[];
}

function parseOptions(args: string[]): Options {
  let rollbackSha = String(process.env.ROLLBACK_COMPAT_ROLLBACK_SHA ?? '').trim();
  let candidateSha: string | null = String(
    process.env.ROLLBACK_COMPAT_CANDIDATE_SHA ?? '',
  ).trim() || null;
  let reportPath = String(process.env.ROLLBACK_COMPAT_REPORT_PATH ?? '').trim()
    || path.join(defaultArtifactDir, 'report.json');
  let requireCleanCandidate = ['1', 'true'].includes(
    String(process.env.ROLLBACK_COMPAT_REQUIRE_CLEAN_CANDIDATE ?? '').trim().toLowerCase(),
  );
  if (args[0] && !args[0].startsWith('--')) {
    rollbackSha = args[0];
    if (args[1]) {
      reportPath = args[1];
    }
    if (args.length > 2) {
      throw new Error('Positional usage accepts only rollback SHA and optional report path.');
    }
    args = [];
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--require-clean-candidate') {
      requireCleanCandidate = true;
      continue;
    }
    const value = args[index + 1];
    if (!value) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === '--rollback-sha') {
      rollbackSha = value;
    } else if (argument === '--candidate-sha') {
      candidateSha = value;
    } else if (argument === '--report') {
      reportPath = path.resolve(repositoryRoot, value);
    } else {
      throw new Error(`Unsupported rollback compatibility option: ${argument}.`);
    }
    index += 1;
  }
  if (!isExactGitSha(rollbackSha)) {
    throw new Error('--rollback-sha must be an exact 40-character Git commit.');
  }
  if (candidateSha && !isExactGitSha(candidateSha)) {
    throw new Error('--candidate-sha must be an exact 40-character Git commit.');
  }
  return {
    rollbackSha: rollbackSha.toLowerCase(),
    candidateSha: candidateSha?.toLowerCase() ?? null,
    reportPath: path.resolve(repositoryRoot, reportPath),
    requireCleanCandidate,
  };
}

function appendLog(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length <= MAX_LOG_BYTES ? next : next.slice(-MAX_LOG_BYTES);
}

function tail(value: string, maxLength = 8_000): string {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function redact(value: string, secrets: string[] = []): string {
  let redacted = value.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted-database-url]');
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join('[redacted]');
    }
  }
  return redacted;
}

function runCommand(
  label: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; echo?: boolean } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLog(stdout, chunk);
      if (options.echo !== false) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLog(stderr, chunk);
      if (options.echo !== false) {
        process.stderr.write(chunk);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label} could not start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = timedOut
        ? `timed out after ${timeoutMs}ms`
        : `exited with code ${String(code)}${signal ? ` (${signal})` : ''}`;
      reject(new Error(`${label} ${reason}.\n${tail(stderr || stdout)}`));
    });
  });
}

async function gitOutput(args: string[]): Promise<string> {
  const result = await runCommand('Git', 'git', args, { echo: false, timeoutMs: 30_000 });
  return result.stdout.trim();
}

async function collectMigrationIdentity(migrationsDir: string, sha: string): Promise<MigrationIdentityWithFiles> {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDir}.`);
  }
  const digest = createHash('sha256');
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file));
    digest.update(file);
    digest.update('\0');
    digest.update(sql);
    digest.update('\0');
  }
  return {
    sha,
    migrationHead: files.at(-1) as string,
    migrationCount: files.length,
    migrationDigest: digest.digest('hex'),
    files,
  };
}

async function collectCompatibilityExceptions(
  migrationsDir: string,
  files: string[],
): Promise<RollbackSchemaCompatibilityExceptionEvidence[]> {
  const evidence: RollbackSchemaCompatibilityExceptionEvidence[] = [];
  for (const migration of files) {
    const sql = await readFile(path.join(migrationsDir, migration), 'utf8');
    for (const exception of findMigrationCompatibilityExceptions(sql)) {
      evidence.push({ migration, ...exception });
    }
  }
  return evidence;
}

async function canConnect(databaseUrl: string): Promise<boolean> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1_000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function ensureLocalPostgres(adminUrl: string): Promise<boolean> {
  if (await canConnect(adminUrl)) {
    return false;
  }
  if (process.env.ROLLBACK_COMPAT_MANAGE_POSTGRES === '0') {
    throw new Error('Local PostgreSQL is unavailable and automatic Docker startup is disabled.');
  }
  let postgresWasRunning = false;
  try {
    const state = await runCommand(
      'Docker Compose state check',
      'docker',
      ['compose', 'ps', '--status', 'running', '--services'],
      { echo: false, timeoutMs: 15_000 },
    );
    postgresWasRunning = state.stdout.split(/\r?\n/).map((line) => line.trim()).includes('postgres');
  } catch {
    postgresWasRunning = false;
  }
  await runCommand('Local PostgreSQL startup', 'docker', ['compose', 'up', '-d', 'postgres'], {
    timeoutMs: 90_000,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await canConnect(adminUrl)) {
      return !postgresWasRunning;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local PostgreSQL did not become ready within 30 seconds.');
}

function createDatabaseUrls(baseUrl: string, databaseName: string): { adminUrl: string; databaseUrl: string } {
  const parsed = new URL(baseUrl);
  const admin = new URL(parsed);
  admin.pathname = '/postgres';
  const database = new URL(parsed);
  database.pathname = `/${databaseName}`;
  return { adminUrl: admin.toString(), databaseUrl: database.toString() };
}

async function createIsolatedDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await pool.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await pool.end();
  }
}

async function dropIsolatedDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await pool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await pool.end();
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback API port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function startRollbackApi(
  snapshotRoot: string,
  databaseUrl: string,
  port: number,
  phase: 'before' | 'after',
): ManagedApi {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(snapshotRoot, 'apps/api/src/server.ts')],
    {
      cwd: snapshotRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(port),
        NODE_ENV: 'test',
        RELEASE_SHA: process.env.ROLLBACK_SHA,
        DEPLOYMENT_DATABASE_ID: 'local',
        DEPLOYMENT_ENVIRONMENT: 'test',
        AUTH_SESSION_SECRET: 'rollback-compat-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
        AUTH_RATE_LIMIT_SECRET: `rollback-compat-rate-${phase}-0123456789-abcdefghijklmnopqrstuvwxyz`,
        ALLOW_INSECURE_ACCOUNT_HEADER: 'true',
        MATCHMAKING_ACCESS_MODE: 'open',
        MATCHMAKING_MAX_RESIDENT_TICKETS: '64',
        MATCHMAKING_RUNTIME_NAMESPACE: `rollback-compat-${phase}-${process.pid}`,
        MATCHMAKING_SNAPSHOT_INTERVAL_MS: '60000',
        MATCHMAKING_STUN_URLS: '',
        MATCHMAKING_TURN_URLS: '',
        ...createRollbackProbeServerEnvironment(),
        REPLAY_BLOB_PROVIDER: 'local',
        REPLAY_BLOB_DIR: path.join(snapshotRoot, 'data', `rollback-compat-replays-${phase}`),
        API_CORS_ORIGINS: `http://127.0.0.1:${port}`,
        PGAPPNAME: `gravity-well-rollback-compat-${phase}-${process.pid}`,
        SLO_ADMIN_KEY: 'rollback-compat-ops-key-0123456789',
        RANKED_ANOMALY_ADMIN_KEY: 'rollback-compat-anomaly-key-0123456789',
        ENFORCEMENT_ADMIN_KEY: 'rollback-compat-enforcement-key-0123456789',
        RANKED_SEASON_RESET_ADMIN_KEY: 'rollback-compat-season-key-0123456789',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const managed: ManagedApi = { child, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk: Buffer) => {
    managed.stdout = appendLog(managed.stdout, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    managed.stderr = appendLog(managed.stderr, chunk);
  });
  return managed;
}

async function waitForRollbackApi(api: ManagedApi, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null) {
      throw new Error(`Rollback API exited during startup.\n${tail(api.stderr || api.stdout)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while the local API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Rollback API did not become healthy.\n${tail(api.stderr || api.stdout)}`);
}

async function stopManagedApi(api: ManagedApi | null): Promise<void> {
  if (!api || api.child.exitCode !== null) {
    return;
  }
  api.child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => api.child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (api.child.exitCode === null) {
    api.child.kill('SIGKILL');
  }
}

async function runMigrations(workspaceRoot: string, databaseUrl: string, label: string): Promise<void> {
  await runMigrationsFromSnapshot(workspaceRoot, workspaceRoot, databaseUrl, label);
}

async function runMigrationsFromSnapshot(
  runtimeWorkspaceRoot: string,
  migrationWorkspaceRoot: string,
  databaseUrl: string,
  label: string,
): Promise<void> {
  await runCommand(
    label,
    process.execPath,
    ['--import', 'tsx', path.join(runtimeWorkspaceRoot, 'scripts/migrate.ts')],
    {
      cwd: migrationWorkspaceRoot,
      env: { DATABASE_URL: databaseUrl },
      timeoutMs: 120_000,
    },
  );
}

async function assertAppliedMigrationChain(databaseUrl: string, expectedFiles: string[]): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename',
    );
    const actualFiles = result.rows.map((row) => row.filename);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
        `Applied migration chain differs from candidate files. Expected ${expectedFiles.length}, got ${actualFiles.length}.`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function recordPhase<T>(
  phases: RollbackSchemaCompatibilityPhase[],
  name: RollbackSchemaCompatibilityPhaseName,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await action();
    phases.push({ name, status: 'passed', durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    phases.push({
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: redact(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const checkedOutCandidateSha = (await gitOutput(['rev-parse', 'HEAD'])).toLowerCase();
  if (!isExactGitSha(checkedOutCandidateSha)) {
    throw new Error('Current checkout does not resolve to an exact Git commit.');
  }
  if (options.candidateSha && checkedOutCandidateSha !== options.candidateSha) {
    throw new Error(
      `Candidate checkout mismatch: expected ${options.candidateSha}, got ${checkedOutCandidateSha}.`,
    );
  }
  if (checkedOutCandidateSha === options.rollbackSha) {
    throw new Error('Rollback SHA must differ from the candidate SHA.');
  }
  await gitOutput(['cat-file', '-e', `${options.rollbackSha}^{commit}`]);
  try {
    await gitOutput(['merge-base', '--is-ancestor', options.rollbackSha, checkedOutCandidateSha]);
  } catch {
    throw new Error('Rollback SHA must be an ancestor of the candidate SHA.');
  }
  const candidateDirty = (await gitOutput(['status', '--porcelain', '--untracked-files=all'])).length > 0;
  if (options.requireCleanCandidate && candidateDirty) {
    throw new Error('Rollback compatibility release evidence requires a clean candidate checkout.');
  }

  const runId = `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const rollbackSnapshotRoot = path.join(defaultArtifactDir, `rollback-snapshot-${runId}`);
  const rollbackArchivePath = path.join(defaultArtifactDir, `rollback-snapshot-${runId}.tar`);
  const candidateSnapshotRoot = path.join(defaultArtifactDir, `candidate-snapshot-${runId}`);
  const candidateArchivePath = path.join(defaultArtifactDir, `candidate-snapshot-${runId}.tar`);
  const candidateSnapshotApiRoot = path.join(candidateSnapshotRoot, 'apps/api');

  const phases: RollbackSchemaCompatibilityPhase[] = [];
  let beforeUpgrade: RollbackSchemaCompatibilityProbeEvidence | null = null;
  let afterUpgrade: RollbackSchemaCompatibilityProbeEvidence | null = null;
  let failure: string | null = null;
  let postgresStartedByRunner = false;
  let databaseCreated = false;
  let api: ManagedApi | null = null;
  let candidate: RollbackSchemaCompatibilityReport['candidate'] = {
    sha: checkedOutCandidateSha,
    dirty: candidateDirty,
    migrationHead: 'unavailable',
    migrationCount: 0,
    migrationDigest: '0'.repeat(64),
  };
  let rollback: RollbackSchemaIdentity = {
    sha: options.rollbackSha,
    migrationHead: 'unavailable',
    migrationCount: 0,
    migrationDigest: '0'.repeat(64),
  };
  let compatibilityExceptions: RollbackSchemaCompatibilityExceptionEvidence[] = [];
  const baseDatabaseUrl = String(
    process.env.ROLLBACK_COMPAT_DATABASE_URL
      ?? process.env.LOCAL_DATABASE_URL
      ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
  ).trim();
  assertLocalDatabaseTarget(baseDatabaseUrl, 'Rollback schema compatibility smoke');
  const databaseName = `gw_rollback_compat_${process.pid}_${randomBytes(4).toString('hex')}`;
  const { adminUrl, databaseUrl } = createDatabaseUrls(baseDatabaseUrl, databaseName);
  assertLocalDatabaseTarget(adminUrl, 'Rollback schema compatibility admin connection');
  assertLocalDatabaseTarget(databaseUrl, 'Rollback schema compatibility isolated database');

  try {
    await mkdir(defaultArtifactDir, { recursive: true });
    await mkdir(path.dirname(options.reportPath), { recursive: true });
    await mkdir(rollbackSnapshotRoot, { recursive: true });
    await mkdir(candidateSnapshotRoot, { recursive: true });
    await runCommand(
      'Rollback source archive',
      'git',
      ['archive', '--format=tar', `--output=${rollbackArchivePath}`, options.rollbackSha],
      { echo: false, timeoutMs: 60_000 },
    );
    await runCommand(
      'Rollback source extraction',
      'tar',
      ['-xf', rollbackArchivePath, '-C', rollbackSnapshotRoot],
      { echo: false, timeoutMs: 60_000 },
    );
    await runCommand(
      'Candidate migration archive',
      'git',
      [
        'archive',
        '--format=tar',
        `--output=${candidateArchivePath}`,
        checkedOutCandidateSha,
        'apps/api/migrations',
      ],
      { echo: false, timeoutMs: 60_000 },
    );
    await runCommand(
      'Candidate migration extraction',
      'tar',
      ['-xf', candidateArchivePath, '-C', candidateSnapshotRoot],
      { echo: false, timeoutMs: 60_000 },
    );

    const candidateIdentityWithFiles = await collectMigrationIdentity(
      path.join(candidateSnapshotApiRoot, 'migrations'),
      checkedOutCandidateSha,
    );
    const rollbackIdentityWithFiles = await collectMigrationIdentity(
      path.join(rollbackSnapshotRoot, 'apps/api/migrations'),
      options.rollbackSha,
    );
    compatibilityExceptions = await collectCompatibilityExceptions(
      path.join(candidateSnapshotApiRoot, 'migrations'),
      candidateIdentityWithFiles.files,
    );
    candidate = {
      sha: checkedOutCandidateSha,
      dirty: candidateDirty,
      migrationHead: candidateIdentityWithFiles.migrationHead,
      migrationCount: candidateIdentityWithFiles.migrationCount,
      migrationDigest: candidateIdentityWithFiles.migrationDigest,
    };
    rollback = {
      sha: options.rollbackSha,
      migrationHead: rollbackIdentityWithFiles.migrationHead,
      migrationCount: rollbackIdentityWithFiles.migrationCount,
      migrationDigest: rollbackIdentityWithFiles.migrationDigest,
    };

    postgresStartedByRunner = await ensureLocalPostgres(adminUrl);
    await createIsolatedDatabase(adminUrl, databaseName);
    databaseCreated = true;

    await recordPhase(phases, 'rollback_migrations', async () => {
      await runMigrations(
        path.join(rollbackSnapshotRoot, 'apps/api'),
        databaseUrl,
        'Rollback migrations',
      );
      await assertAppliedMigrationChain(databaseUrl, rollbackIdentityWithFiles.files);
    });

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    process.env.ROLLBACK_SHA = options.rollbackSha;
    await recordPhase(phases, 'rollback_pre_upgrade_probe', async () => {
      api = startRollbackApi(rollbackSnapshotRoot, databaseUrl, port, 'before');
      await waitForRollbackApi(api, baseUrl);
      beforeUpgrade = await runRollbackApiCompatibilityProbe(baseUrl, 'before', {
        internallyManagedLoopback: true,
      });
      await stopManagedApi(api);
      api = null;
    });

    await recordPhase(phases, 'candidate_migrations', async () => {
      await runMigrationsFromSnapshot(
        apiWorkspaceRoot,
        candidateSnapshotApiRoot,
        databaseUrl,
        'Candidate migrations',
      );
      await assertAppliedMigrationChain(databaseUrl, candidateIdentityWithFiles.files);
    });

    await recordPhase(phases, 'rollback_post_upgrade_probe', async () => {
      api = startRollbackApi(rollbackSnapshotRoot, databaseUrl, port, 'after');
      await waitForRollbackApi(api, baseUrl);
      afterUpgrade = await runRollbackApiCompatibilityProbe(baseUrl, 'after', {
        internallyManagedLoopback: true,
      });
      await stopManagedApi(api);
      api = null;
    });
  } catch (error) {
    failure = redact(error instanceof Error ? error.message : String(error), [databaseUrl, adminUrl]);
  } finally {
    const recordCleanupFailure = (label: string, error: unknown): void => {
      const message = `${label} cleanup failed: ${redact(
        error instanceof Error ? error.message : String(error),
        [databaseUrl, adminUrl],
      )}`;
      failure = failure ? `${failure}; ${message}` : message;
    };
    await stopManagedApi(api).catch(() => undefined);
    if (databaseCreated) {
      await dropIsolatedDatabase(adminUrl, databaseName).catch((error) => {
        recordCleanupFailure('Database', error);
      });
    }
    if (postgresStartedByRunner) {
      await runCommand('Local PostgreSQL cleanup', 'docker', ['compose', 'stop', 'postgres'], {
        echo: false,
        timeoutMs: 60_000,
      }).catch((error) => {
        recordCleanupFailure('PostgreSQL', error);
      });
    }
    for (const [label, target, recursive] of [
      ['Rollback snapshot', rollbackSnapshotRoot, true],
      ['Rollback archive', rollbackArchivePath, false],
      ['Candidate snapshot', candidateSnapshotRoot, true],
      ['Candidate archive', candidateArchivePath, false],
    ] as const) {
      await rm(target, { recursive, force: true }).catch((error) => {
        recordCleanupFailure(label, error);
      });
    }
  }

  const report: RollbackSchemaCompatibilityReport = {
    schemaVersion: ROLLBACK_SCHEMA_COMPATIBILITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: failure === null,
    localOnly: true,
    hostedServicesContacted: false,
    runtimeDependenciesSource: 'candidate_install',
    candidate,
    rollback,
    compatibilityExceptions,
    phases,
    probes: { beforeUpgrade, afterUpgrade },
    failure,
  };
  if (report.ok) {
    const validationErrors = validateRollbackSchemaCompatibilityReport(report, {
      candidateSha: checkedOutCandidateSha,
      rollbackSha: options.rollbackSha,
      requireCleanCandidate: options.requireCleanCandidate,
    });
    if (validationErrors.length > 0) {
      report.ok = false;
      report.failure = `Evidence validation failed: ${validationErrors.join('; ')}`;
    }
  }
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `[rollback-schema] ${report.ok ? 'PASSED' : 'FAILED'} candidate=${candidate.sha} rollback=${rollback.sha} exceptions=${compatibilityExceptions.length}`,
  );
  console.log(`[rollback-schema] report written ${options.reportPath}`);
  if (!report.ok) {
    throw new Error(report.failure ?? 'Rollback schema compatibility smoke failed.');
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
