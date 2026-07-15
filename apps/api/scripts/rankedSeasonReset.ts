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
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const result = await runRankedSeasonReset(
        client,
        new Date(),
        resolveRankedSeasonDurationDays(process.env),
      );
      if (result.status === 'locked') {
        throw new Error('Ranked season reset is already in progress; retry this job.');
      }
      await client.query('COMMIT');
      transactionOpen = false;
      console.log(JSON.stringify(result));
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the reset error if the connection also fails during rollback.
        }
      }
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
