import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  buildBalancePatchNotesReport,
  formatBalancePatchNotesMarkdown,
  type BuildBalancePatchNotesOptions,
} from '../src/sim/balancePatchNotes';

interface CliOptions {
  baseProfileId?: string;
  targetProfileIds?: string[];
  includeUnchanged: boolean;
  markdownPath: string;
  reportPath: string;
}

const DEFAULT_MARKDOWN_PATH = 'build-artifacts/balance-patch-notes.md';
const DEFAULT_REPORT_PATH = 'build-artifacts/balance-patch-notes-report.json';

function parseTargetProfileIds(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw.trim().toLowerCase() === 'all') {
    return undefined;
  }
  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return ids.length > 0 ? ids : undefined;
}

function parseArgs(argv: string[]): CliOptions {
  let baseProfileId: string | undefined;
  let targetProfileIds: string[] | undefined;
  let includeUnchanged = false;
  let markdownPath = DEFAULT_MARKDOWN_PATH;
  let reportPath = DEFAULT_REPORT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      baseProfileId = argv[index + 1] ?? baseProfileId;
      index += 1;
      continue;
    }
    if (arg === '--profiles') {
      targetProfileIds = parseTargetProfileIds(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--include-unchanged') {
      includeUnchanged = true;
      continue;
    }
    if (arg === '--out') {
      markdownPath = argv[index + 1] ?? markdownPath;
      index += 1;
      continue;
    }
    if (arg === '--report') {
      reportPath = argv[index + 1] ?? reportPath;
      index += 1;
      continue;
    }
  }

  return {
    baseProfileId,
    targetProfileIds,
    includeUnchanged,
    markdownPath,
    reportPath,
  };
}

function resolveOutputPath(rawPath: string): string {
  if (isAbsolute(rawPath)) {
    return rawPath;
  }
  return join(process.cwd(), rawPath);
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function run(): void {
  const cli = parseArgs(process.argv.slice(2));
  const options: BuildBalancePatchNotesOptions = {
    baseProfileId: cli.baseProfileId,
    targetProfileIds: cli.targetProfileIds,
    includeUnchanged: cli.includeUnchanged,
  };

  const report = buildBalancePatchNotesReport(options);
  const markdown = formatBalancePatchNotesMarkdown(report);
  const markdownPath = resolveOutputPath(cli.markdownPath);
  const reportPath = resolveOutputPath(cli.reportPath);

  writeOutput(markdownPath, markdown);
  writeOutput(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.info(`[balance-patch-notes] markdown written ${markdownPath}`);
  console.info(`[balance-patch-notes] report written ${reportPath}`);
  for (const target of report.targets) {
    console.info(`[balance-patch-notes] ${report.baseProfileId} -> ${target.profileId}: ${target.fieldDiffs.length} changed field(s)`);
  }
}

try {
  run();
} catch (error) {
  console.error('[balance-patch-notes] generation failed');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}
