import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { classifyDatabaseTarget } from '../src/databaseTarget';
import {
  parseDatabaseApplicationName,
  summarizeDatabaseBackendReplacement,
  type DatabaseBackendReplacementSummary,
} from '../src/ops/databaseInterruption';
import {
  assertSafeDatabaseSmokeTarget,
  assertSafeSmokeTarget,
} from './smokeTargetGuard';

interface ApiHealth {
  ok?: boolean;
  databaseTarget?: 'local' | 'remote' | 'unknown';
  releaseSha?: string;
  matchmakingRuntimeNamespace?: string;
}

interface ApiReadiness extends ApiHealth {
  migrationHead?: string | null;
}

interface BackendRow {
  pid: number;
}

interface TerminatedBackendRow extends BackendRow {
  terminated: boolean;
}

interface JsonResponse<T> {
  status: number;
  body: T | null;
  error: string | null;
}

interface ReadinessRecovery {
  attempts: number;
  transientFailures: number;
  durationMs: number;
  readiness: ApiReadiness;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, '../../..');
const operation = 'Database interruption smoke';

function parsePositiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function requestJson<T>(url: string, timeoutMs: number): Promise<JsonResponse<T>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body: T | null = null;
    try {
      body = JSON.parse(text) as T;
    } catch {
      // A non-JSON response is retained as a failed health attempt.
    }
    return { status: response.status, body, error: null };
  } catch (error) {
    return {
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireHealthyResponse<T extends ApiHealth>(
  response: JsonResponse<T>,
  label: string,
): T {
  if (response.status !== 200 || response.body?.ok !== true) {
    throw new Error(
      `${label} failed: status=${response.status}${response.error ? ` error=${response.error}` : ''}.`,
    );
  }
  return response.body;
}

async function readTargetBackends(pool: Pool, applicationName: string): Promise<number[]> {
  const result = await pool.query<BackendRow>(
    `
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = $1
        AND backend_type = 'client backend'
        AND pid <> pg_backend_pid()
      ORDER BY pid
    `,
    [applicationName],
  );
  return result.rows.map(({ pid }) => Number(pid));
}

async function terminateTargetBackends(
  pool: Pool,
  applicationName: string,
): Promise<TerminatedBackendRow[]> {
  const result = await pool.query<TerminatedBackendRow>(
    `
      SELECT pid::int AS pid, pg_terminate_backend(pid) AS terminated
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = $1
        AND backend_type = 'client backend'
        AND pid <> pg_backend_pid()
      ORDER BY pid
    `,
    [applicationName],
  );
  return result.rows.map((row) => ({ pid: Number(row.pid), terminated: row.terminated === true }));
}

async function waitForReadiness(
  readyUrl: string,
  recoveryTimeoutMs: number,
  requestTimeoutMs: number,
): Promise<ReadinessRecovery> {
  const startedAt = Date.now();
  const deadline = startedAt + recoveryTimeoutMs;
  let attempts = 0;
  let transientFailures = 0;
  let lastResponse: JsonResponse<ApiReadiness> | null = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    lastResponse = await requestJson<ApiReadiness>(readyUrl, requestTimeoutMs);
    if (lastResponse.status === 200 && lastResponse.body?.ok === true) {
      return {
        attempts,
        transientFailures,
        durationMs: Date.now() - startedAt,
        readiness: lastResponse.body,
      };
    }
    transientFailures += 1;
    await sleep(100);
  }

  throw new Error(
    `API readiness did not recover within ${recoveryTimeoutMs}ms; last status=${lastResponse?.status ?? 0}`
      + `${lastResponse?.error ? ` error=${lastResponse.error}` : ''}.`,
  );
}

async function waitForBackendReplacement(
  pool: Pool,
  applicationName: string,
  previousBackendIds: number[],
  recoveryTimeoutMs: number,
): Promise<DatabaseBackendReplacementSummary> {
  const deadline = Date.now() + recoveryTimeoutMs;
  let summary = summarizeDatabaseBackendReplacement(previousBackendIds, []);
  while (Date.now() <= deadline) {
    summary = summarizeDatabaseBackendReplacement(
      previousBackendIds,
      await readTargetBackends(pool, applicationName),
    );
    if (summary.replaced) {
      return summary;
    }
    await sleep(100);
  }
  throw new Error(`API database backends were not fully replaced: ${JSON.stringify(summary)}.`);
}

function assertStableApiIdentity(before: ApiHealth, after: ApiHealth): void {
  if (
    before.releaseSha !== after.releaseSha
    || before.matchmakingRuntimeNamespace !== after.matchmakingRuntimeNamespace
  ) {
    throw new Error('API health identity changed during the database interruption drill.');
  }
}

async function run(): Promise<void> {
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  assertSafeDatabaseSmokeTarget(databaseUrl, operation);
  const databaseTarget = classifyDatabaseTarget(databaseUrl);
  const baseUrl = String(process.env.API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('API_BASE_URL is required.');
  }
  const targetApplicationName = parseDatabaseApplicationName(
    process.env.DATABASE_INTERRUPTION_TARGET_APP_NAME,
  );
  const controllerApplicationName = parseDatabaseApplicationName(
    `gw-db-interruption-controller-${process.pid}`,
  );
  if (controllerApplicationName === targetApplicationName) {
    throw new Error('Database interruption controller and target application names must differ.');
  }
  const recoveryTimeoutMs = parsePositiveInteger(
    'DATABASE_INTERRUPTION_RECOVERY_TIMEOUT_MS',
    15_000,
    120_000,
  );
  const requestTimeoutMs = parsePositiveInteger(
    'DATABASE_INTERRUPTION_REQUEST_TIMEOUT_MS',
    2_000,
    30_000,
  );
  const reportPath = path.resolve(
    repositoryRoot,
    process.env.DATABASE_INTERRUPTION_SMOKE_REPORT_PATH
      ?? 'apps/api/build-artifacts/database-interruption-smoke-report.json',
  );

  await assertSafeSmokeTarget(baseUrl, operation);
  const healthBefore = requireHealthyResponse(
    await requestJson<ApiHealth>(`${baseUrl}/health`, requestTimeoutMs),
    'Pre-interruption health',
  );
  if (healthBefore.databaseTarget !== databaseTarget) {
    throw new Error(
      `API and controller database targets differ: api=${healthBefore.databaseTarget ?? 'missing'} controller=${databaseTarget}.`,
    );
  }
  const readinessBefore = requireHealthyResponse(
    await requestJson<ApiReadiness>(`${baseUrl}/readyz`, requestTimeoutMs),
    'Pre-interruption readiness',
  );

  const controller = new Pool({
    connectionString: databaseUrl,
    application_name: controllerApplicationName,
    max: 1,
  });
  try {
    await sleep(150);
    const previousBackendIds = await readTargetBackends(controller, targetApplicationName);
    if (previousBackendIds.length === 0) {
      throw new Error(
        `No PostgreSQL backends were found for target application "${targetApplicationName}".`,
      );
    }

    const terminated = await terminateTargetBackends(controller, targetApplicationName);
    if (
      terminated.length !== previousBackendIds.length
      || terminated.some(({ terminated: didTerminate }) => !didTerminate)
    ) {
      throw new Error(
        `PostgreSQL did not terminate every isolated target backend: ${JSON.stringify({
          expected: previousBackendIds.length,
          terminated: terminated.filter((row) => row.terminated).length,
        })}.`,
      );
    }

    const recovery = await waitForReadiness(
      `${baseUrl}/readyz`,
      recoveryTimeoutMs,
      requestTimeoutMs,
    );
    const replacement = await waitForBackendReplacement(
      controller,
      targetApplicationName,
      previousBackendIds,
      recoveryTimeoutMs,
    );
    const healthAfter = requireHealthyResponse(
      await requestJson<ApiHealth>(`${baseUrl}/health`, requestTimeoutMs),
      'Post-interruption health',
    );
    assertStableApiIdentity(healthBefore, healthAfter);
    if (recovery.readiness.migrationHead !== readinessBefore.migrationHead) {
      throw new Error('Migration head changed during the database interruption drill.');
    }

    const report = {
      schemaVersion: 'gw.database-interruption-smoke.v1',
      generatedAt: new Date().toISOString(),
      ok: true,
      localOnly: databaseTarget === 'local',
      hostedServicesContacted: databaseTarget !== 'local',
      databaseTarget,
      apiBaseUrl: baseUrl,
      targetApplicationName,
      migrationHead: recovery.readiness.migrationHead ?? null,
      terminatedBackendCount: terminated.length,
      replacement,
      readiness: {
        attempts: recovery.attempts,
        transientFailures: recovery.transientFailures,
        recoveryMs: recovery.durationMs,
      },
      apiIdentityStable: true,
    };
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } finally {
    await controller.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
