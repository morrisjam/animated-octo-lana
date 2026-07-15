import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  inspectProductionBundle,
  type ProductionBundleBudgetReport,
} from '../src/build/productionBundleBudget';

interface CliOptions {
  distDirectory: string;
  reportPath: string;
  buildProfile: string;
}

function parseArgs(argv: string[]): CliOptions {
  let distDirectory = 'dist';
  let reportPath = 'build-artifacts/production-bundle-budget.json';
  let buildProfile = 'production';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dist' && argv[index + 1]) {
      distDirectory = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--report' && argv[index + 1]) {
      reportPath = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--profile' && argv[index + 1]) {
      buildProfile = argv[index + 1];
      index += 1;
    }
  }
  return {
    distDirectory: resolve(distDirectory),
    reportPath: resolve(reportPath),
    buildProfile: buildProfile.trim() || 'production',
  };
}

function printReport(report: ProductionBundleBudgetReport): void {
  console.log(`Production bundle budget (${report.buildProfile}): ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(
    `Initial JS ${report.totals.initialJavaScriptBytes} bytes / `
    + `${report.totals.initialJavaScriptGzipBytes} gzip bytes; `
    + `entry ${report.totals.entryChunkBytes} bytes; `
    + `largest ${report.totals.largestJavaScriptChunkBytes} bytes.`,
  );
  for (const check of report.checks) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  try {
    const report = await inspectProductionBundle(
      options.distDirectory,
      undefined,
      options.buildProfile,
    );
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    printReport(report);
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
