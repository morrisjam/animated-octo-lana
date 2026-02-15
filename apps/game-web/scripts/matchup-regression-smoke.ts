import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  buildMatchupSmokeExpectedBaseline,
  compareMatchupSmokeAgainstBaseline,
  runMatchupSmokeSuite,
  type MatchupSmokeExpectedBaseline,
} from '../src/sim/matchupRegression';

interface CliOptions {
  profileIds?: string[];
  expectedPath: string;
  reportPath: string;
  writeExpected: boolean;
}

interface MatchupSmokeScriptReport {
  generatedAt: string;
  pass: boolean;
  semanticPass: boolean;
  baselinePass: boolean;
  issues: string[];
  expectedPath: string;
  reportPath: string;
  profileIds: string[];
  fixtureIds: string[];
  results: ReturnType<typeof runMatchupSmokeSuite>['results'];
}

const DEFAULT_EXPECTED_PATH = 'smoke/matchup-regression.expected.json';
const DEFAULT_REPORT_PATH = 'build-artifacts/matchup-regression-smoke-report.json';

function resolvePath(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return join(process.cwd(), path);
}

function parseProfiles(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw.trim().toLowerCase() === 'all') {
    return undefined;
  }
  const profiles = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return profiles.length > 0 ? profiles : undefined;
}

function parseArgs(argv: string[]): CliOptions {
  let profileIds: string[] | undefined;
  let expectedPath = DEFAULT_EXPECTED_PATH;
  let reportPath = DEFAULT_REPORT_PATH;
  let writeExpected = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profiles') {
      profileIds = parseProfiles(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--expected') {
      expectedPath = argv[i + 1] ?? expectedPath;
      i += 1;
      continue;
    }
    if (arg === '--report') {
      reportPath = argv[i + 1] ?? reportPath;
      i += 1;
      continue;
    }
    if (arg === '--write-expected') {
      writeExpected = true;
      continue;
    }
  }

  return {
    profileIds,
    expectedPath,
    reportPath,
    writeExpected,
  };
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function readExpectedBaseline(path: string): MatchupSmokeExpectedBaseline {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as MatchupSmokeExpectedBaseline;
}

function run(): void {
  const cli = parseArgs(process.argv.slice(2));
  const expectedPath = resolvePath(cli.expectedPath);
  const reportPath = resolvePath(cli.reportPath);
  const suite = runMatchupSmokeSuite(cli.profileIds);
  const generatedBaseline = buildMatchupSmokeExpectedBaseline(suite);

  let baselinePass = false;
  const issues: string[] = [];

  if (cli.writeExpected) {
    writeJson(expectedPath, generatedBaseline);
    baselinePass = true;
    console.info(`[matchup-smoke] baseline written ${expectedPath}`);
  } else {
    const expected = readExpectedBaseline(expectedPath);
    const comparison = compareMatchupSmokeAgainstBaseline(suite, expected);
    baselinePass = comparison.pass;
    issues.push(...comparison.issues);
  }

  if (!suite.pass) {
    for (const result of suite.results) {
      if (!result.semanticPass) {
        issues.push(`semantic check failed ${result.profileId}/${result.fixtureId}: ${result.semanticMessage}`);
      }
    }
  }

  const report: MatchupSmokeScriptReport = {
    generatedAt: suite.generatedAt,
    pass: suite.pass && baselinePass,
    semanticPass: suite.pass,
    baselinePass,
    issues,
    expectedPath,
    reportPath,
    profileIds: suite.profileIds,
    fixtureIds: suite.fixtureIds,
    results: suite.results,
  };

  writeJson(reportPath, report);
  console.info(`[matchup-smoke] report written ${reportPath}`);
  for (const result of suite.results) {
    console.info(
      `[matchup-smoke] ${result.profileId}/${result.fixtureId} checksum=${result.finalChecksum} semantic=${result.semanticPass ? 'ok' : 'fail'}`,
    );
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`[matchup-smoke] ${issue}`);
    }
  }

  if (!report.pass) {
    process.exitCode = 1;
  }
}

try {
  run();
} catch (error) {
  console.error('[matchup-smoke] run failed');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}
