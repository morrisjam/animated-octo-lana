import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ASSET_MANIFEST } from '../src/view/assets/defaultManifest';
import {
  buildAssetBudgetReport,
  DEFAULT_ASSET_BUDGET_LIMITS,
  type AssetBudgetReport,
} from '../src/view/assets/budget';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function printReport(report: AssetBudgetReport): void {
  console.info('[asset-budget] textureBytes', `${formatBytes(report.usage.textureBytes)} / ${formatBytes(report.limits.textureBytes)}`);
  console.info('[asset-budget] meshTriangles', `${report.usage.meshTriangles} / ${report.limits.meshTriangles}`);
  console.info('[asset-budget] vfxEmitters', `${report.usage.vfxEmitters} / ${report.limits.vfxEmitters}`);
  if (report.violations.length === 0) {
    console.info('[asset-budget] pass');
    return;
  }
  for (const violation of report.violations) {
    console.error(
      '[asset-budget] violation',
      `${violation.metric}: usage=${violation.usage}, limit=${violation.limit}, overBy=${violation.overBy}`,
    );
  }
}

function writeReport(report: AssetBudgetReport): void {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'asset-budget-report.json');
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      report,
    }, null, 2)}\n`,
    'utf8',
  );
  console.info('[asset-budget] report written', outputPath);
}

const report = buildAssetBudgetReport(DEFAULT_ASSET_MANIFEST, DEFAULT_ASSET_BUDGET_LIMITS);
printReport(report);
writeReport(report);

if (!report.pass) {
  process.exitCode = 1;
}

