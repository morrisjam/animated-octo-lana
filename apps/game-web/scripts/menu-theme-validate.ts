import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MENU_THEME_IDS,
  MENU_THEMES,
} from '../src/view/menuThemes';

interface MenuThemeValidationIssue {
  themeId: string;
  message: string;
}

interface MenuThemeValidationReport {
  generatedAt: string;
  themeCount: number;
  themeIds: string[];
  valid: boolean;
  issues: MenuThemeValidationIssue[];
}

function writeReport(report: MenuThemeValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'menu-theme-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function validate(): MenuThemeValidationReport {
  const issues: MenuThemeValidationIssue[] = [];
  const seen = new Set<string>();

  for (const theme of MENU_THEMES) {
    if (seen.has(theme.id)) {
      issues.push({
        themeId: theme.id,
        message: 'duplicate theme id.',
      });
      continue;
    }
    seen.add(theme.id);

    if (theme.id.trim().length === 0) {
      issues.push({
        themeId: theme.id,
        message: 'theme id must not be empty.',
      });
    }
    if (theme.label.trim().length === 0) {
      issues.push({
        themeId: theme.id,
        message: 'label must not be empty.',
      });
    }
    if (theme.description.trim().length === 0) {
      issues.push({
        themeId: theme.id,
        message: 'description must not be empty.',
      });
    }

    for (const [token, value] of Object.entries(theme.tokens)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push({
          themeId: theme.id,
          message: `tokens.${token} must be a non-empty string.`,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    themeCount: MENU_THEMES.length,
    themeIds: [...MENU_THEME_IDS],
    valid: issues.length === 0,
    issues,
  };
}

const report = validate();
const reportPath = writeReport(report);
console.info(`[menu-theme] report written ${reportPath}`);
for (const theme of MENU_THEMES) {
  console.info(`[menu-theme] ${theme.id}: ${theme.label}`);
}

if (!report.valid) {
  for (const issue of report.issues) {
    console.error(`[menu-theme] invalid ${issue.themeId}: ${issue.message}`);
  }
  process.exitCode = 1;
}
