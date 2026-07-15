import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  findMigrationCompatibilityExceptions,
  findMigrationCompatibilityViolations,
} from '../src/ops/migrationCompatibility';

interface Violation {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

async function run(): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const violations: Violation[] = [];
  const exceptions: Array<{ file: string; line: number; pattern: string; reason: string }> = [];
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    violations.push(...findMigrationCompatibilityViolations(sql).map((violation) => ({
      file,
      ...violation,
    })));
    exceptions.push(...findMigrationCompatibilityExceptions(sql).map((exception) => ({
      file,
      ...exception,
    })));
  }

  if (violations.length > 0) {
    console.error('Migration backward-compatibility check failed.');
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} [${violation.pattern}] ${violation.text}`);
    }
    console.error(
      'If an expand-contract exception is intentional, name and document it, for example "-- backward-compatible-exception: drop_column reason".',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Migration backward-compatibility check passed (${files.length} files scanned).`);
  for (const exception of exceptions) {
    console.log(
      `- runtime proof required: ${exception.file}:${exception.line} [${exception.pattern}] ${exception.reason}`,
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
