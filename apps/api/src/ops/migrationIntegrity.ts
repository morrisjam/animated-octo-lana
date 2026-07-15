import { createHash } from 'node:crypto';

export interface MigrationFileRecord {
  filename: string;
  checksum: string;
}

export interface AppliedMigrationRecord {
  filename: string;
  checksum: string | null;
}

export interface MigrationIntegrityResult {
  checksumsToBackfill: MigrationFileRecord[];
}

export function computeMigrationChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function validateMigrationIntegrity(
  files: readonly MigrationFileRecord[],
  applied: readonly AppliedMigrationRecord[],
): MigrationIntegrityResult {
  const filesByName = new Map(files.map((file) => [file.filename, file]));
  const seenApplied = new Set<string>();
  const checksumsToBackfill: MigrationFileRecord[] = [];
  for (const record of applied) {
    if (seenApplied.has(record.filename)) {
      throw new Error(`Migration history contains duplicate filename ${record.filename}.`);
    }
    seenApplied.add(record.filename);
    const file = filesByName.get(record.filename);
    if (!file) {
      throw new Error(`Applied migration ${record.filename} is missing from this release.`);
    }
    if (record.checksum === null) {
      checksumsToBackfill.push(file);
      continue;
    }
    if (record.checksum !== file.checksum) {
      throw new Error(`Applied migration ${record.filename} checksum does not match this release.`);
    }
  }
  return { checksumsToBackfill };
}
