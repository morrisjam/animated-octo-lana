import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverNodeCharacterPackageFiles } from '../src/content/characterPackageLoader';
import {
  CharacterPackageValidationError,
  parseCharacterPackage,
} from '../src/content/characterPackageSchema';

interface ValidPackageResult {
  file: string;
  id: string;
  schemaVersion: string;
}

interface InvalidPackageResult {
  file: string;
  issues: Array<{ path: string; message: string }>;
}

interface ValidationReport {
  generatedAt: string;
  rootDir: string;
  filesScanned: number;
  validCount: number;
  invalidCount: number;
  validPackages: ValidPackageResult[];
  invalidPackages: InvalidPackageResult[];
}

function parseDirArg(argv: string[]): string {
  const index = argv.findIndex((value) => value === '--dir');
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return 'content/characters';
}

function writeReport(report: ValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'character-package-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function readJson(path: URL): unknown {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

const rootDirArg = parseDirArg(process.argv.slice(2));
const absoluteRoot = resolve(process.cwd(), rootDirArg);
let packageFiles;
try {
  packageFiles = discoverNodeCharacterPackageFiles({
    rootUrl: pathToFileURL(`${absoluteRoot}${sep}`),
    sourceRoot: rootDirArg,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : '[character-package] package discovery failed.');
  packageFiles = [];
}
const validPackages: ValidPackageResult[] = [];
const invalidPackages: InvalidPackageResult[] = [];

if (packageFiles.length === 0) {
  console.error(`[character-package] no package files found under ${rootDirArg}`);
}

for (const file of packageFiles) {
  const fileLabel = file.source;
  try {
    const json = readJson(file.url);
    const parsed = parseCharacterPackage(json);
    validPackages.push({
      file: fileLabel,
      id: parsed.id,
      schemaVersion: parsed.schemaVersion,
    });
    console.info(`[character-package] ok ${fileLabel} (${parsed.id})`);
  } catch (error) {
    if (error instanceof CharacterPackageValidationError) {
      invalidPackages.push({
        file: fileLabel,
        issues: error.issues,
      });
      console.error(`[character-package] invalid ${fileLabel}`);
      for (const issue of error.issues) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
      continue;
    }
    invalidPackages.push({
      file: fileLabel,
      issues: [{
        path: '$',
        message: error instanceof Error ? error.message : 'Unexpected validation error.',
      }],
    });
    console.error(`[character-package] invalid ${fileLabel}`);
    console.error(`  - $: ${error instanceof Error ? error.message : 'Unexpected validation error.'}`);
  }
}

const report: ValidationReport = {
  generatedAt: new Date().toISOString(),
  rootDir: rootDirArg.replace(/\\/g, '/'),
  filesScanned: packageFiles.length,
  validCount: validPackages.length,
  invalidCount: invalidPackages.length,
  validPackages,
  invalidPackages,
};

const reportPath = writeReport(report);
console.info(`[character-package] report written ${reportPath}`);

if (invalidPackages.length > 0 || packageFiles.length === 0) {
  process.exitCode = 1;
}
