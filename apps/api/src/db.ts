import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { classifyDatabaseTarget } from './databaseTarget';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, '../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set.');
}

export const databaseTarget = classifyDatabaseTarget(connectionString);

export const db = new Pool({
  connectionString,
});

db.on('error', (error) => {
  // pg removes the failed idle client; handling the event keeps the API alive so
  // the pool can establish a fresh connection after a transient DB interruption.
  console.error('[database] Idle pool connection failed; future queries will reconnect.', {
    code: typeof error.code === 'string' ? error.code : 'unknown',
    message: error.message,
  });
});
