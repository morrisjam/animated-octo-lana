import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(currentDir, '..');
loadEnv({ path: path.resolve(apiRoot, '../../.env') });
const databaseUrl = String(
  process.env.LOCAL_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well',
).trim();

assertLocalDatabaseTarget(databaseUrl, 'Local API startup');

const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'development',
  AUTH_SESSION_SECRET:
    process.env.AUTH_SESSION_SECRET?.trim() || randomBytes(48).toString('base64url'),
  AUTH_RATE_LIMIT_SECRET:
    process.env.AUTH_RATE_LIMIT_SECRET?.trim() || randomBytes(48).toString('base64url'),
};

function runEntry(entry: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: apiRoot,
      env: childEnv,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function run(): Promise<void> {
  const migrationCode = await runEntry('scripts/migrate.ts');
  if (migrationCode !== 0) {
    throw new Error(`Local migrations failed with exit code ${migrationCode}.`);
  }
  const serverCode = await runEntry('src/server.ts');
  if (serverCode !== 0) {
    throw new Error(`Local API exited with code ${serverCode}.`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
