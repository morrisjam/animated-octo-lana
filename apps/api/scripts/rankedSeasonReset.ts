import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { resolveRankedSeasonDurationDays, runRankedSeasonReset } from '../src/ranked/seasonService';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, '../../../.env') });

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for ranked season reset.');
  }

  const pool = new Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runRankedSeasonReset(
        client,
        new Date(),
        resolveRankedSeasonDurationDays(process.env),
      );
      await client.query('COMMIT');
      console.log(JSON.stringify(result));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
