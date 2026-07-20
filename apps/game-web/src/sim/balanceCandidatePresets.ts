import {
  createDefaultAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
} from './ai';
import {
  cloneCharacterBalanceOverrides,
  createCharacterBalanceConfig,
  sanitiseCharacterBalanceConfig,
  type CharacterBalanceConfig,
  type CharacterBalanceOverrides,
} from './characterBalance';
import type { CharacterId } from './characters';
import { sanitiseTuning } from './tuning';
import type { GameTuning } from './types';

export const BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION = 'gw.balance-candidate-preset.v1';

export const BALANCE_CANDIDATE_PRESET_IDS = [
  'launch_break_agency_v1',
  'post_control_reposition_v1',
  'ordinary_boost_acceleration_v1',
] as const;

export type BalanceCandidatePresetId = (typeof BALANCE_CANDIDATE_PRESET_IDS)[number];

export interface BalanceCandidatePresetRule {
  scope: 'global' | 'character' | 'ai';
  characterId: CharacterId | null;
  path: string;
  baselineValue: number;
  candidateValue: number;
  label: string;
}

export interface BalanceCandidatePreset {
  schemaVersion: typeof BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION;
  id: BalanceCandidatePresetId;
  label: string;
  description: string;
  designerQuestion: string;
  evidence: string;
  status: 'human_review';
  rules: readonly BalanceCandidatePresetRule[];
}

export interface AppliedBalanceCandidatePreset {
  preset: BalanceCandidatePreset;
  tuning: GameTuning;
  characterBalanceOverrides: CharacterBalanceOverrides;
  aiBehaviorTuning: AiBehaviorTuning;
}

export const BALANCE_CANDIDATE_PRESETS: readonly BalanceCandidatePreset[] = [
  {
    schemaVersion: BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION,
    id: 'launch_break_agency_v1',
    label: 'Launch-break agency V1',
    description: 'Shorten the returning fighter lockout after spending a scarce launch break, without changing reset distance, impulse, AI policy, or attack timing.',
    designerQuestion: 'Does a launch break now create one readable defensive choice without becoming an immediate free counter-rush?',
    evidence: 'A mirrored 12-set Veteran screen reduced severe Chase samples from 10 to 2 with no timeouts. Shared pressure did not improve, so human review is required before promotion.',
    status: 'human_review',
    rules: [
      {
        scope: 'character',
        characterId: 'vanguard',
        path: 'moves.break.recoveryFrames',
        baselineValue: 18,
        candidateValue: 6,
        label: 'Vanguard launch-break recovery: 18f -> 6f',
      },
      {
        scope: 'character',
        characterId: 'duelist',
        path: 'moves.break.recoveryFrames',
        baselineValue: 28,
        candidateValue: 10,
        label: 'Duelist launch-break recovery: 28f -> 10f',
      },
    ],
  },
  {
    schemaVersion: BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION,
    id: 'post_control_reposition_v1',
    label: 'Post-control reposition V1',
    description: 'Give a fighter one weighted orbit-or-retreat choice after regaining control, without delaying ordinary neutral or suppressing an immediate defensive response.',
    designerQuestion: 'Does the returning fighter create readable space and a new decision without turning the match passive?',
    evidence: 'The cancellation-safe flow-v18 screen reduced Blocked Commitment from 14/102 to 2/100 and Blocked Chase from 16/102 to 8/100, but issue ratios remained 70% and 92% and Veteran Vanguard converted 0/7 finish starts. Use this only for direct human comparison, not promotion.',
    status: 'human_review',
    rules: [
      {
        scope: 'ai',
        characterId: null,
        path: 'repositionWeightScale',
        baselineValue: 0,
        candidateValue: 1,
        label: 'Post-control reposition weight: 0 -> 1',
      },
    ],
  },
  {
    schemaVersion: BALANCE_CANDIDATE_PRESET_SCHEMA_VERSION,
    id: 'ordinary_boost_acceleration_v1',
    label: 'Ordinary Boost startup V1',
    description: 'Ramp free ordinary Boost to full speed over 0.12 seconds while preserving its committed direction and sustained speed.',
    designerQuestion: 'Does the added startup read create punishable misses and spacing choices without making pursuit feel sluggish?',
    evidence: 'A fixed-seed 144-round Cadet/Veteran screen reduced Blocked Commitment from 18 to 6, Blocked Chase from 26 to 18, and Blocked Separation from 2 to 0. The strict v24 report still fails: shared-agency saturation dominates Commitment and all 144 Chase rounds remain flagged. It created 50 avoided Boost lines versus none at baseline, so retain it only for human feel testing rather than promotion.',
    status: 'human_review',
    rules: [
      {
        scope: 'global',
        characterId: null,
        path: 'ordinaryBoostAccelerationSeconds',
        baselineValue: 0,
        candidateValue: 0.12,
        label: 'Ordinary Boost startup: instant -> 0.12s',
      },
    ],
  },
];

const PRESET_BY_ID = Object.fromEntries(
  BALANCE_CANDIDATE_PRESETS.map((preset) => [preset.id, preset]),
) as Record<BalanceCandidatePresetId, BalanceCandidatePreset>;

export function resolveBalanceCandidatePreset(value: unknown): BalanceCandidatePreset {
  return typeof value === 'string' && BALANCE_CANDIDATE_PRESET_IDS.includes(value as BalanceCandidatePresetId)
    ? PRESET_BY_ID[value as BalanceCandidatePresetId]
    : PRESET_BY_ID[BALANCE_CANDIDATE_PRESET_IDS[0]];
}

function setExistingNumericPath(target: object, path: string, value: number): boolean {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0 || !Number.isFinite(value)) {
    return false;
  }

  let cursor = target as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return false;
    }
    cursor = next as Record<string, unknown>;
  }

  const finalSegment = segments[segments.length - 1];
  if (typeof cursor[finalSegment] !== 'number') {
    return false;
  }
  cursor[finalSegment] = value;
  return true;
}

function applyCharacterRule(
  overrides: CharacterBalanceOverrides,
  rule: BalanceCandidatePresetRule,
): void {
  if (!rule.characterId) {
    throw new Error(`Character candidate rule "${rule.path}" is missing a character id.`);
  }
  const current = overrides[rule.characterId]
    ?? createCharacterBalanceConfig(rule.characterId);
  const config = structuredClone(current) as CharacterBalanceConfig;
  if (!setExistingNumericPath(config, rule.path, rule.candidateValue)) {
    throw new Error(`Candidate rule path "${rule.path}" is not a numeric character rule.`);
  }
  overrides[rule.characterId] = sanitiseCharacterBalanceConfig(rule.characterId, config);
}

export function applyBalanceCandidatePreset(
  presetValue: unknown,
  tuningValue: Partial<GameTuning>,
  characterOverridesValue: CharacterBalanceOverrides = {},
  aiBehaviorValue: Partial<AiBehaviorTuning> = createDefaultAiBehaviorTuning(),
): AppliedBalanceCandidatePreset {
  const preset = resolveBalanceCandidatePreset(presetValue);
  let tuning = sanitiseTuning(tuningValue);
  const characterBalanceOverrides = cloneCharacterBalanceOverrides(characterOverridesValue);
  let aiBehaviorTuning = sanitiseAiBehaviorTuning(aiBehaviorValue);

  for (const rule of preset.rules) {
    if (rule.scope === 'character') {
      applyCharacterRule(characterBalanceOverrides, rule);
      continue;
    }

    if (rule.scope === 'global') {
      const candidate = structuredClone(tuning) as unknown as Record<string, unknown>;
      if (!setExistingNumericPath(candidate, rule.path, rule.candidateValue)) {
        throw new Error(`Candidate rule path "${rule.path}" is not a numeric global rule.`);
      }
      tuning = sanitiseTuning(candidate as unknown as Partial<GameTuning>);
      continue;
    }

    const candidate = structuredClone(aiBehaviorTuning) as unknown as Record<string, unknown>;
    if (!setExistingNumericPath(candidate, rule.path, rule.candidateValue)) {
      throw new Error(`Candidate rule path "${rule.path}" is not a numeric AI rule.`);
    }
    aiBehaviorTuning = sanitiseAiBehaviorTuning(candidate as unknown as Partial<AiBehaviorTuning>);
  }

  return {
    preset,
    tuning,
    characterBalanceOverrides,
    aiBehaviorTuning,
  };
}
