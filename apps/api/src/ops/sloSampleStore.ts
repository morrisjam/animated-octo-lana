export interface SloSampleDatabase {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
}

export interface SloRequestSample {
  method: string;
  route: string;
  statusCode: number;
  latencyMs: number;
}

export interface SloSampleRetentionConfig {
  retentionDays: number;
  maxRows: number;
  cleanupIntervalMs: number;
  cleanupEverySamples: number;
  cleanupBatchSize: number;
  maxCleanupBatchesPerRun: number;
}

export interface RecordedSloSample {
  sampleId: string;
  cleanupDue: boolean;
}

export interface SloSamplePruneResult {
  acquired: boolean;
  highWatermarkSampleId: string | null;
  deleted: number;
}

export interface SloSampleCleanupResult {
  acquired: boolean;
  batches: number;
  deleted: number;
}

const SLO_SAMPLE_CLEANUP_LOCK_KEY = 1_196_905_292; // ASCII "GWSL".
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_ROWS = 250_000;
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 300;
const DEFAULT_CLEANUP_EVERY_SAMPLES = 100;
const DEFAULT_CLEANUP_BATCH_SIZE = 1_000;
const DEFAULT_MAX_CLEANUP_BATCHES_PER_RUN = 10;

function resolveBoundedInteger(
  envName: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${envName} must be an integer between ${minimum} and ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${envName} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function resolveSloSampleRetentionConfig(
  env: Record<string, string | undefined>,
): SloSampleRetentionConfig {
  return {
    retentionDays: resolveBoundedInteger(
      'SLO_SAMPLE_RETENTION_DAYS',
      env.SLO_SAMPLE_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      1,
      365,
    ),
    maxRows: resolveBoundedInteger(
      'SLO_SAMPLE_MAX_ROWS',
      env.SLO_SAMPLE_MAX_ROWS,
      DEFAULT_MAX_ROWS,
      1_000,
      5_000_000,
    ),
    cleanupIntervalMs: resolveBoundedInteger(
      'SLO_SAMPLE_CLEANUP_INTERVAL_SECONDS',
      env.SLO_SAMPLE_CLEANUP_INTERVAL_SECONDS,
      DEFAULT_CLEANUP_INTERVAL_SECONDS,
      60,
      86_400,
    ) * 1_000,
    cleanupEverySamples: DEFAULT_CLEANUP_EVERY_SAMPLES,
    cleanupBatchSize: DEFAULT_CLEANUP_BATCH_SIZE,
    maxCleanupBatchesPerRun: DEFAULT_MAX_CLEANUP_BATCHES_PER_RUN,
  };
}

export class SloSampleStore {
  public constructor(
    private readonly database: SloSampleDatabase,
    public readonly config: SloSampleRetentionConfig,
  ) {}

  public async record(sample: SloRequestSample): Promise<RecordedSloSample> {
    const result = await this.database.query<{ sample_id: string }>(
      `
        INSERT INTO service_slo_request_samples(method, route, status_code, latency_ms)
        VALUES ($1, $2, $3, $4)
        RETURNING sample_id::text AS sample_id
      `,
      [sample.method, sample.route, sample.statusCode, sample.latencyMs],
    );
    const sampleId = String(result.rows[0]?.sample_id ?? '');
    if (!/^\d+$/.test(sampleId)) {
      throw new Error('SLO sample insert did not return a valid sample id.');
    }
    return {
      sampleId,
      // The database sequence is shared, so every instance observes the same cadence.
      cleanupDue: BigInt(sampleId) % BigInt(this.config.cleanupEverySamples) === 0n,
    };
  }

  public async pruneBatch(): Promise<SloSamplePruneResult> {
    const result = await this.database.query<{
      acquired: boolean;
      high_watermark_sample_id: string | null;
      deleted_count: number | string;
    }>(
      `
        WITH cleanup_lock AS MATERIALIZED (
          SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired
        ),
        high_watermark AS MATERIALIZED (
          SELECT MAX(samples.sample_id) AS sample_id
          FROM service_slo_request_samples samples
          CROSS JOIN cleanup_lock
          WHERE cleanup_lock.acquired
        ),
        delete_candidates AS MATERIALIZED (
          SELECT samples.sample_id
          FROM service_slo_request_samples samples
          CROSS JOIN cleanup_lock
          CROSS JOIN high_watermark
          WHERE cleanup_lock.acquired
            AND (
              samples.sampled_at < NOW() - make_interval(days => $2::integer)
              OR samples.sample_id <= high_watermark.sample_id - $3::bigint
            )
          ORDER BY samples.sample_id ASC
          LIMIT $4
        ),
        deleted AS (
          DELETE FROM service_slo_request_samples samples
          USING delete_candidates
          WHERE samples.sample_id = delete_candidates.sample_id
          RETURNING samples.sample_id
        )
        SELECT
          cleanup_lock.acquired,
          high_watermark.sample_id::text AS high_watermark_sample_id,
          COUNT(deleted.sample_id)::integer AS deleted_count
        FROM cleanup_lock
        LEFT JOIN high_watermark ON TRUE
        LEFT JOIN deleted ON TRUE
        GROUP BY cleanup_lock.acquired, high_watermark.sample_id
      `,
      [
        SLO_SAMPLE_CLEANUP_LOCK_KEY,
        this.config.retentionDays,
        this.config.maxRows,
        this.config.cleanupBatchSize,
      ],
    );
    const row = result.rows[0];
    return {
      acquired: row?.acquired === true,
      highWatermarkSampleId: row?.high_watermark_sample_id ?? null,
      deleted: Math.max(0, Number(row?.deleted_count ?? 0)),
    };
  }

  public async pruneBounded(): Promise<SloSampleCleanupResult> {
    let acquired = false;
    let batches = 0;
    let deleted = 0;
    for (let index = 0; index < this.config.maxCleanupBatchesPerRun; index += 1) {
      const result = await this.pruneBatch();
      if (!result.acquired) {
        break;
      }
      acquired = true;
      batches += 1;
      deleted += result.deleted;
      if (result.deleted < this.config.cleanupBatchSize) {
        break;
      }
    }
    return { acquired, batches, deleted };
  }
}

export function createSloSampleStore(
  database: SloSampleDatabase,
  config: SloSampleRetentionConfig,
): SloSampleStore {
  return new SloSampleStore(database, config);
}
