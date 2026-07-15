import { config as loadEnv } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  computeMigrationChecksum,
  validateMigrationIntegrity,
} from '../src/ops/migrationIntegrity';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, '../../../.env') });

async function ensureSchemaMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT NULL');
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for migrations.');
  }

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const migrationFiles = await Promise.all(files.map(async (filename) => {
    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    return { filename, sql, checksum: computeMigrationChecksum(sql) };
  }));

  const pool = new Pool({ connectionString });
  try {
    await ensureSchemaMigrationsTable(pool);
    const applied = await pool.query<{ filename: string; checksum: string | null }>(
      'SELECT filename, checksum FROM schema_migrations ORDER BY filename',
    );
    const integrity = validateMigrationIntegrity(migrationFiles, applied.rows);
    for (const migration of integrity.checksumsToBackfill) {
      await pool.query(
        'UPDATE schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL',
        [migration.filename, migration.checksum],
      );
      console.log(`Backfilled migration checksum: ${migration.filename}`);
    }
    const appliedNames = new Set(applied.rows.map((record) => record.filename));
    for (const migration of migrationFiles) {
      if (appliedNames.has(migration.filename)) {
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)',
          [migration.filename, migration.checksum],
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${migration.filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
