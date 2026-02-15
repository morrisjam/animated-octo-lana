import {
  BALANCE_PROFILE_BY_ID,
  BALANCE_PROFILE_IDS,
  DEFAULT_BALANCE_PROFILE_ID,
  type BalanceProfile,
} from './balanceProfiles';
import type { GameTuning } from './types';

export interface BalancePatchFieldDiff {
  field: keyof GameTuning;
  before: number;
  after: number;
  delta: number;
  deltaPercent: number | null;
}

export interface BalancePatchTargetDiff {
  profileId: string;
  profileLabel: string;
  profileDescription: string;
  fieldDiffs: BalancePatchFieldDiff[];
}

export interface BalancePatchNotesReport {
  generatedAt: string;
  baseProfileId: string;
  baseProfileLabel: string;
  baseProfileDescription: string;
  targets: BalancePatchTargetDiff[];
}

export interface BuildBalancePatchNotesOptions {
  baseProfileId?: string;
  targetProfileIds?: string[];
  includeUnchanged?: boolean;
  generatedAt?: string;
}

function resolveProfileOrThrow(profileId: string): BalanceProfile {
  const profile = BALANCE_PROFILE_BY_ID[profileId];
  if (!profile) {
    throw new Error(`Unknown balance profile id "${profileId}".`);
  }
  return profile;
}

function normaliseProfileIds(ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) {
    return [];
  }
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
}

function resolveTargetIds(baseProfileId: string, targetIds: string[] | undefined): string[] {
  const normalised = normaliseProfileIds(targetIds);
  if (normalised.length === 0) {
    return BALANCE_PROFILE_IDS.filter((id) => id !== baseProfileId);
  }
  for (const id of normalised) {
    if (!BALANCE_PROFILE_BY_ID[id]) {
      throw new Error(`Unknown balance profile id "${id}".`);
    }
  }
  return normalised;
}

function getTuningFields(base: GameTuning, target: GameTuning): Array<keyof GameTuning> {
  const baseFields = Object.keys(base) as Array<keyof GameTuning>;
  const seen = new Set<string>(baseFields);
  const targetOnlyFields = (Object.keys(target) as Array<keyof GameTuning>)
    .filter((field) => !seen.has(field))
    .sort();
  return [...baseFields, ...targetOnlyFields];
}

function computeDeltaPercent(before: number, delta: number): number | null {
  if (before === 0) {
    return null;
  }
  return (delta / before) * 100;
}

function buildTargetDiff(
  baseProfile: BalanceProfile,
  targetProfile: BalanceProfile,
  includeUnchanged: boolean,
): BalancePatchTargetDiff {
  const fieldDiffs: BalancePatchFieldDiff[] = [];
  const fields = getTuningFields(baseProfile.tuning, targetProfile.tuning);
  for (const field of fields) {
    const before = baseProfile.tuning[field];
    const after = targetProfile.tuning[field];
    const delta = after - before;
    if (!includeUnchanged && delta === 0) {
      continue;
    }
    fieldDiffs.push({
      field,
      before,
      after,
      delta,
      deltaPercent: computeDeltaPercent(before, delta),
    });
  }

  return {
    profileId: targetProfile.id,
    profileLabel: targetProfile.label,
    profileDescription: targetProfile.description,
    fieldDiffs,
  };
}

export function buildBalancePatchNotesReport(options: BuildBalancePatchNotesOptions = {}): BalancePatchNotesReport {
  const baseProfileId = options.baseProfileId?.trim() || DEFAULT_BALANCE_PROFILE_ID;
  const includeUnchanged = options.includeUnchanged ?? false;
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const baseProfile = resolveProfileOrThrow(baseProfileId);
  const targetIds = resolveTargetIds(baseProfile.id, options.targetProfileIds);
  const targets = targetIds.map((targetId) => {
    const targetProfile = resolveProfileOrThrow(targetId);
    return buildTargetDiff(baseProfile, targetProfile, includeUnchanged);
  });

  return {
    generatedAt,
    baseProfileId: baseProfile.id,
    baseProfileLabel: baseProfile.label,
    baseProfileDescription: baseProfile.description,
    targets,
  };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function formatSigned(value: number): string {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }
  if (value < 0) {
    return `-${formatNumber(Math.abs(value))}`;
  }
  return '0';
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  const fixed = value.toFixed(2);
  if (value > 0) {
    return `+${fixed}%`;
  }
  if (value < 0) {
    return `${fixed}%`;
  }
  return '0.00%';
}

export function formatBalancePatchNotesMarkdown(report: BalancePatchNotesReport): string {
  const lines: string[] = [
    '# Balance Patch Notes Diff',
    '',
    `Generated: ${report.generatedAt}`,
    `Base profile: ${report.baseProfileId} (${report.baseProfileLabel})`,
    '',
    '## Summary',
  ];

  if (report.targets.length === 0) {
    lines.push('- No target profiles selected.');
  } else {
    for (const target of report.targets) {
      lines.push(`- ${target.profileId}: ${target.fieldDiffs.length} changed field(s)`);
    }
  }

  for (const target of report.targets) {
    lines.push('');
    lines.push(`## ${report.baseProfileId} -> ${target.profileId}`);
    lines.push('');
    lines.push(target.profileDescription);
    lines.push('');
    if (target.fieldDiffs.length === 0) {
      lines.push('No tuning field changes.');
      continue;
    }
    lines.push('| Field | Before | After | Delta | Delta % |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const diff of target.fieldDiffs) {
      lines.push(
        `| ${diff.field} | ${formatNumber(diff.before)} | ${formatNumber(diff.after)} | ${formatSigned(diff.delta)} | ${formatPercent(diff.deltaPercent)} |`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}
