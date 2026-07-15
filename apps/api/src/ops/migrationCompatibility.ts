export interface MigrationCompatibilityViolation {
  line: number;
  pattern: string;
  text: string;
}

export interface MigrationCompatibilityException {
  line: number;
  pattern: string;
  reason: string;
}

const BLOCKED_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'drop_table', regex: /\bdrop\s+table\b/i },
  { name: 'drop_column', regex: /\bdrop\s+column\b/i },
  { name: 'truncate_table', regex: /\btruncate\s+(?:table\s+)?\w+/i },
  { name: 'alter_column_type', regex: /\balter\s+table\b[\s\S]*?\balter\s+column\b[\s\S]*?\btype\b/i },
  { name: 'alter_column_set_not_null', regex: /\balter\s+table\b[\s\S]*?\balter\s+column\b[\s\S]*?\bset\s+not\s+null\b/i },
];

const BLOCKED_PATTERN_NAMES = new Set(BLOCKED_PATTERNS.map((pattern) => pattern.name));
const EXCEPTION_REGEX = /^[\t ]*--[\t ]*backward-compatible-exception:[\t ]*([a-z_]+)[\t ]+(.+?)[\t ]*$/gim;

function stripCommentsPreservingLines(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '))
    .replace(/--[^\r\n]*/g, (comment) => ' '.repeat(comment.length));
}

function lineAtOffset(value: string, offset: number): number {
  return value.slice(0, offset).split(/\r?\n/).length;
}

export function findMigrationCompatibilityExceptions(
  sql: string,
): MigrationCompatibilityException[] {
  const exceptions: MigrationCompatibilityException[] = [];
  for (const match of sql.matchAll(EXCEPTION_REGEX)) {
    const pattern = match[1];
    const reason = match[2].trim();
    if (!BLOCKED_PATTERN_NAMES.has(pattern) || reason.length < 8) {
      continue;
    }
    exceptions.push({
      line: lineAtOffset(sql, match.index),
      pattern,
      reason,
    });
  }
  return exceptions;
}

export function findMigrationCompatibilityViolations(
  sql: string,
): MigrationCompatibilityViolation[] {
  const exceptions = new Set(
    findMigrationCompatibilityExceptions(sql).map((exception) => exception.pattern),
  );

  const uncommented = stripCommentsPreservingLines(sql);
  const violations: MigrationCompatibilityViolation[] = [];
  let statementStart = 0;
  for (const statement of uncommented.split(';')) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (exceptions.has(pattern.name)) {
        continue;
      }
      const match = pattern.regex.exec(statement);
      if (!match) {
        continue;
      }
      violations.push({
        line: lineAtOffset(uncommented, statementStart + match.index),
        pattern: pattern.name,
        text: statement.trim().replace(/\s+/g, ' ').slice(0, 240),
      });
    }
    statementStart += statement.length + 1;
  }
  return violations;
}
