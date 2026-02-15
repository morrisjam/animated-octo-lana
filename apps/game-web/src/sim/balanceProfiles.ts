import {
  BALANCE_PROFILE_DEFINITIONS,
  type BalanceProfileDefinition,
} from '../../content/balance/balanceProfiles';
import { createDefaultTuning, sanitiseTuning } from './tuning';
import type { GameTuning } from './types';

export interface BalanceProfile {
  id: string;
  label: string;
  description: string;
  tuning: GameTuning;
}

export const DEFAULT_BALANCE_PROFILE_ID = 'default';

function mergeTuning(base: GameTuning, override: Partial<GameTuning>): GameTuning {
  return {
    ...base,
    ...override,
  };
}

function toBalanceProfile(baseTuning: GameTuning, definition: BalanceProfileDefinition): BalanceProfile {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    tuning: sanitiseTuning(mergeTuning(baseTuning, definition.tuning)),
  };
}

function buildBalanceProfiles(): BalanceProfile[] {
  const defaultTuning = createDefaultTuning();
  const profiles: BalanceProfile[] = [{
    id: DEFAULT_BALANCE_PROFILE_ID,
    label: 'Default',
    description: 'Baseline gameplay tuning from simulation defaults.',
    tuning: { ...defaultTuning },
  }];

  for (const definition of BALANCE_PROFILE_DEFINITIONS) {
    profiles.push(toBalanceProfile(defaultTuning, definition));
  }

  return profiles;
}

export const BALANCE_PROFILES: BalanceProfile[] = buildBalanceProfiles();
export const BALANCE_PROFILE_IDS: string[] = BALANCE_PROFILES.map((profile) => profile.id);
export const BALANCE_PROFILE_BY_ID: Record<string, BalanceProfile> = Object.fromEntries(
  BALANCE_PROFILES.map((profile) => [profile.id, profile]),
);

export function resolveBalanceProfile(profileId: string | undefined | null): BalanceProfile {
  if (!profileId) {
    return BALANCE_PROFILE_BY_ID[DEFAULT_BALANCE_PROFILE_ID];
  }
  const trimmed = profileId.trim();
  if (!trimmed) {
    return BALANCE_PROFILE_BY_ID[DEFAULT_BALANCE_PROFILE_ID];
  }
  return BALANCE_PROFILE_BY_ID[trimmed] ?? BALANCE_PROFILE_BY_ID[DEFAULT_BALANCE_PROFILE_ID];
}
