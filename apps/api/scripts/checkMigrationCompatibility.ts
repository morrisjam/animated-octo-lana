import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface Violation {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

const BLOCKED_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'drop_table', regex: /\bdrop\s+table\b/i },
  { name: 'drop_column', regex: /\bdrop\s+column\b/i },
  { name: 'truncate_table', regex: /\btruncate\s+table\b/i },
  { name: 'alter_column_type', regex: /\balter\s+table\b.*\balter\s+column\b.*\btype\b/i },
  { name: 'alter_column_set_not_null', regex: /\balter\s+table\b.*\balter\s+column\b.*\bset\s+not\s+null\b/i },
];

async function run(): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const violations: Violation[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const allowException = sql.toLowerCase().includes('-- backward-compatible-exception:');
    if (allowException) {
      continue;
    }
    const lines = sql.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.regex.test(line)) {
          violations.push({
            file,
            line: i + 1,
            pattern: pattern.name,
            text: line.trim(),
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('Migration backward-compatibility check failed.');
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} [${violation.pattern}] ${violation.text}`);
    }
    console.error(
      'If a breaking migration is intentional, add a comment like "-- backward-compatible-exception: reason".',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Migration backward-compatibility check passed (${files.length} files scanned).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
