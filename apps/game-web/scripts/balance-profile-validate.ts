import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BALANCE_PROFILE_IDS,
  BALANCE_PROFILES,
  DEFAULT_BALANCE_PROFILE_ID,
} from '../src/sim/balanceProfiles';

interface BalanceProfileValidationIssue {
  profileId: string;
  message: string;
}

interface BalanceProfileValidationReport {
  generatedAt: string;
  profileCount: number;
  profileIds: string[];
  defaultProfileId: string;
  valid: boolean;
  issues: BalanceProfileValidationIssue[];
}

function writeReport(report: BalanceProfileValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'balance-profile-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function validate(): BalanceProfileValidationReport {
  const issues: BalanceProfileValidationIssue[] = [];
  const seen = new Set<string>();

  for (const profile of BALANCE_PROFILES) {
    if (seen.has(profile.id)) {
      issues.push({
        profileId: profile.id,
        message: 'duplicate profile id.',
      });
      continue;
    }
    seen.add(profile.id);

    if (profile.id.trim().length === 0) {
      issues.push({
        profileId: profile.id,
        message: 'profile id must not be empty.',
      });
    }
    if (profile.label.trim().length === 0) {
      issues.push({
        profileId: profile.id,
        message: 'label must not be empty.',
      });
    }
    if (profile.description.trim().length === 0) {
      issues.push({
        profileId: profile.id,
        message: 'description must not be empty.',
      });
    }

    for (const [key, value] of Object.entries(profile.tuning)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({
          profileId: profile.id,
          message: `tuning.${key} must be a finite number.`,
        });
      }
    }
  }

  if (!BALANCE_PROFILE_IDS.includes(DEFAULT_BALANCE_PROFILE_ID)) {
    issues.push({
      profileId: DEFAULT_BALANCE_PROFILE_ID,
      message: 'default profile id is missing from registry.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    profileCount: BALANCE_PROFILES.length,
    profileIds: [...BALANCE_PROFILE_IDS],
    defaultProfileId: DEFAULT_BALANCE_PROFILE_ID,
    valid: issues.length === 0,
    issues,
  };
}

const report = validate();
const reportPath = writeReport(report);
console.info(`[balance-profile] report written ${reportPath}`);
for (const profile of BALANCE_PROFILES) {
  console.info(`[balance-profile] ${profile.id}: ${profile.label}`);
}
if (!report.valid) {
  for (const issue of report.issues) {
    console.error(`[balance-profile] invalid ${issue.profileId}: ${issue.message}`);
  }
  process.exitCode = 1;
}
