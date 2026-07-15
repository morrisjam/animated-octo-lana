import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { parse } from 'dotenv';
import { auditAlphaProviderConfig } from '../src/ops/alphaProviderConfig';

function readArg(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1]?.trim() || null : null;
}

function readPositionalArgs(argv: string[]): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(['--provider-env', '--env-file', '--report']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (flagsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('--') && arg.trim()) {
      values.push(arg.trim());
    }
  }
  return values;
}

function run(): void {
  const argv = process.argv.slice(2);
  const invocationDirectory = process.env.INIT_CWD?.trim() || process.cwd();
  const resolveInputPath = (path: string): string => resolve(invocationDirectory, path);
  const positionalArgs = readPositionalArgs(argv);
  const envFile = readArg(argv, '--provider-env')
    ?? readArg(argv, '--env-file')
    ?? positionalArgs[0]
    ?? null;
  const reportPath = readArg(argv, '--report') ?? positionalArgs[1] ?? null;
  const fileEnvironment = envFile
    ? parse(readFileSync(resolveInputPath(envFile), 'utf8'))
    : {};
  const report = auditAlphaProviderConfig({
    ...process.env,
    ...fileEnvironment,
  });

  for (const check of report.checks) {
    console.log(`[alpha-config] ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  }
  console.log(
    `[alpha-config] ${report.ready ? 'READY' : 'BLOCKED'} blockers=${report.blockers} warnings=${report.warnings}`,
  );
  if (reportPath) {
    const resolvedReportPath = resolveInputPath(reportPath);
    mkdirSync(dirname(resolvedReportPath), { recursive: true });
    writeFileSync(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[alpha-config] report written ${resolvedReportPath}`);
  }
  if (!report.ready) {
    process.exitCode = 1;
  }
}

run();
