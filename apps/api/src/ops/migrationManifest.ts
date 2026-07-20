import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeMigrationChecksum,
  type MigrationFileRecord,
} from './migrationIntegrity';

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
);

export async function loadMigrationFileManifest(
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<MigrationFileRecord[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  return await Promise.all(filenames.map(async (filename) => {
    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    return {
      filename,
      checksum: computeMigrationChecksum(sql),
    };
  }));
}
