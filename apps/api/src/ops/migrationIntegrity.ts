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

export interface VerifiedMigrationHistory {
  migrationHead: string;
  migrationCount: number;
}

export interface MigrationIntegrityOptions {
  allowAppliedSuffix?: boolean;
}

export function computeMigrationChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function validateMigrationIntegrity(
  files: readonly MigrationFileRecord[],
  applied: readonly AppliedMigrationRecord[],
  options: MigrationIntegrityOptions = {},
): MigrationIntegrityResult {
  const filesByName = new Map(files.map((file) => [file.filename, file]));
  const seenApplied = new Set<string>();
  const checksumsToBackfill: MigrationFileRecord[] = [];
  if (options.allowAppliedSuffix && applied.length > files.length) {
    for (let index = 0; index < files.length; index += 1) {
      if (applied[index]?.filename !== files[index]?.filename) {
        throw new Error('Applied migrations are not a forward-compatible suffix of this release.');
      }
    }
  }
  for (let index = 0; index < applied.length; index += 1) {
    const record = applied[index];
    if (seenApplied.has(record.filename)) {
      throw new Error(`Migration history contains duplicate filename ${record.filename}.`);
    }
    seenApplied.add(record.filename);
    const file = filesByName.get(record.filename);
    if (!file) {
      if (options.allowAppliedSuffix && index >= files.length && record.checksum !== null) {
        continue;
      }
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

export function verifyMigrationHistoryMatchesRelease(
  files: readonly MigrationFileRecord[],
  applied: readonly AppliedMigrationRecord[],
  options: MigrationIntegrityOptions = {},
): VerifiedMigrationHistory {
  if (files.length === 0) {
    throw new Error('This release contains no migration files.');
  }
  const fileNames = new Set<string>();
  for (const file of files) {
    if (fileNames.has(file.filename)) {
      throw new Error(`Release migration manifest contains duplicate filename ${file.filename}.`);
    }
    fileNames.add(file.filename);
  }

  const integrity = validateMigrationIntegrity(files, applied, options);
  if (integrity.checksumsToBackfill.length > 0) {
    throw new Error('Applied migration history contains legacy rows without release checksums.');
  }
  if (applied.length < files.length || (!options.allowAppliedSuffix && applied.length !== files.length)) {
    const appliedNames = new Set(applied.map((record) => record.filename));
    const missing = files.find((file) => !appliedNames.has(file.filename));
    throw new Error(
      missing
        ? `Release migration ${missing.filename} has not been applied.`
        : 'Applied migration history does not exactly match this release.',
    );
  }

  return {
    migrationHead: applied.at(-1)?.filename ?? files.at(-1)!.filename,
    migrationCount: applied.length,
  };
}
