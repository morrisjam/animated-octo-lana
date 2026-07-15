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
