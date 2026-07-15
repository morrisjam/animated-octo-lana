import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSloSampleStore,
  resolveSloSampleRetentionConfig,
  type SloSampleDatabase,
} from './sloSampleStore';

test('resolves bounded retention defaults and documented overrides', () => {
  assert.deepEqual(resolveSloSampleRetentionConfig({}), {
    retentionDays: 14,
    maxRows: 250_000,
    cleanupIntervalMs: 300_000,
    cleanupEverySamples: 100,
    cleanupBatchSize: 1_000,
    maxCleanupBatchesPerRun: 10,
  });
  assert.deepEqual(resolveSloSampleRetentionConfig({
    SLO_SAMPLE_RETENTION_DAYS: '30',
    SLO_SAMPLE_MAX_ROWS: '500000',
    SLO_SAMPLE_CLEANUP_INTERVAL_SECONDS: '900',
  }), {
    retentionDays: 30,
    maxRows: 500_000,
    cleanupIntervalMs: 900_000,
    cleanupEverySamples: 100,
    cleanupBatchSize: 1_000,
    maxCleanupBatchesPerRun: 10,
  });
});

test('rejects malformed or unsafe retention settings instead of silently disabling the cap', () => {
  assert.throws(
    () => resolveSloSampleRetentionConfig({ SLO_SAMPLE_RETENTION_DAYS: '0' }),
    /SLO_SAMPLE_RETENTION_DAYS must be an integer between 1 and 365/,
  );
  assert.throws(
    () => resolveSloSampleRetentionConfig({ SLO_SAMPLE_MAX_ROWS: 'unlimited' }),
    /SLO_SAMPLE_MAX_ROWS must be an integer between 1000 and 5000000/,
  );
  assert.throws(
    () => resolveSloSampleRetentionConfig({ SLO_SAMPLE_CLEANUP_INTERVAL_SECONDS: '30' }),
    /SLO_SAMPLE_CLEANUP_INTERVAL_SECONDS must be an integer between 60 and 86400/,
  );
});

test('records samples and derives cleanup cadence from the database-wide id', async () => {
  let nextSampleId = 99n;
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const database: SloSampleDatabase = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      calls.push({ text, values });
      const sampleId = nextSampleId;
      nextSampleId += 1n;
      return { rowCount: 1, rows: [{ sample_id: sampleId.toString() }] as T[] };
    },
  };
  const config = resolveSloSampleRetentionConfig({});
  const firstInstance = createSloSampleStore(database, config);
  const secondInstance = createSloSampleStore(database, config);

  const first = await firstInstance.record({
    method: 'GET',
    route: '/health',
    statusCode: 200,
    latencyMs: 12,
  });
  const second = await secondInstance.record({
    method: 'POST',
    route: '/matchmaking/queue',
    statusCode: 201,
    latencyMs: 34,
  });

  assert.deepEqual(first, { sampleId: '99', cleanupDue: false });
  assert.deepEqual(second, { sampleId: '100', cleanupDue: true });
  assert.deepEqual(calls.map((call) => call.values), [
    ['GET', '/health', 200, 12],
    ['POST', '/matchmaking/queue', 201, 34],
  ]);
  assert.match(calls[0].text, /RETURNING sample_id::text AS sample_id/);
});

test('prunes age and id-window overflow in one locked bounded database operation', async () => {
  let capturedSql = '';
  let capturedValues: readonly unknown[] = [];
  const database: SloSampleDatabase = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      capturedSql = text;
      capturedValues = values;
      return {
        rowCount: 1,
        rows: [{
          acquired: true,
          high_watermark_sample_id: '300000',
          deleted_count: 1000,
        }] as T[],
      };
    },
  };
  const store = createSloSampleStore(database, resolveSloSampleRetentionConfig({}));

  assert.deepEqual(await store.pruneBatch(), {
    acquired: true,
    highWatermarkSampleId: '300000',
    deleted: 1000,
  });
  assert.match(capturedSql, /pg_try_advisory_xact_lock/);
  assert.match(capturedSql, /samples\.sampled_at < NOW\(\) - make_interval/);
  assert.match(capturedSql, /samples\.sample_id <= high_watermark\.sample_id - \$3::bigint/);
  assert.match(capturedSql, /LIMIT \$4/);
  assert.deepEqual(capturedValues, [1_196_905_292, 14, 250_000, 1_000]);
});

test('bounded cleanup stops when another instance owns the lock', async () => {
  let queryCount = 0;
  const database: SloSampleDatabase = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>() {
      queryCount += 1;
      return {
        rowCount: 1,
        rows: [{ acquired: false, high_watermark_sample_id: null, deleted_count: 0 }] as T[],
      };
    },
  };
  const store = createSloSampleStore(database, resolveSloSampleRetentionConfig({}));

  assert.deepEqual(await store.pruneBounded(), { acquired: false, batches: 0, deleted: 0 });
  assert.equal(queryCount, 1);
});

test('bounded cleanup drains only the configured number of fixed-size batches', async () => {
  let queryCount = 0;
  const database: SloSampleDatabase = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>() {
      queryCount += 1;
      return {
        rowCount: 1,
        rows: [{ acquired: true, high_watermark_sample_id: '999999', deleted_count: 1000 }] as T[],
      };
    },
  };
  const store = createSloSampleStore(database, resolveSloSampleRetentionConfig({}));

  assert.deepEqual(await store.pruneBounded(), { acquired: true, batches: 10, deleted: 10_000 });
  assert.equal(queryCount, 10);
});
