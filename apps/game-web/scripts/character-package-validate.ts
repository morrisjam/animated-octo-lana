import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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

function walkFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.toLowerCase().endsWith('.character.package.json')) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function writeReport(report: ValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'character-package-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function readJson(path: string): unknown {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

const rootDirArg = parseDirArg(process.argv.slice(2));
const absoluteRoot = join(process.cwd(), rootDirArg);
const packageFiles = walkFiles(absoluteRoot);
const validPackages: ValidPackageResult[] = [];
const invalidPackages: InvalidPackageResult[] = [];

if (packageFiles.length === 0) {
  console.error(`[character-package] no package files found under ${rootDirArg}`);
}

for (const file of packageFiles) {
  const fileLabel = relative(process.cwd(), file).replace(/\\/g, '/');
  try {
    const json = readJson(file);
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
