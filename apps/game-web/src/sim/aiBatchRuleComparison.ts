import { CHARACTER_IDS } from './characters';
import {
  sanitiseCharacterBalanceOverrides,
  type CharacterBalanceOverrides,
} from './characterBalance';
import {
  createDefaultAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
} from './ai';
import {
  buildBalanceLabRuleChanges,
  type BalanceLabRuleChange,
} from './balanceLab';
import { fingerprintDeterministicValue } from './fingerprint';
import {
  createDefaultTuning,
  createGameTuningFingerprintInput,
  sanitiseTuning,
} from './tuning';
import type { GameTuning } from './types';

export const AI_BATCH_RULE_SNAPSHOT_SCHEMA_VERSION = 'gw.ai-batch-rule-snapshot.v1' as const;

const MIGRATABLE_AI_BEHAVIOR_TUNING_SCHEMAS = new Set([
  'gw.ai-behavior-tuning.v5',
  'gw.ai-behavior-tuning.v6',
  'gw.ai-behavior-tuning.v7',
  'gw.ai-behavior-tuning.v8',
  'gw.ai-behavior-tuning.v9',
  'gw.ai-behavior-tuning.v10',
  'gw.ai-behavior-tuning.v11',
  'gw.ai-behavior-tuning.v12',
  'gw.ai-behavior-tuning.v13',
  'gw.ai-behavior-tuning.v14',
]);

export interface AiBatchRuleSnapshot {
  schemaVersion: typeof AI_BATCH_RULE_SNAPSHOT_SCHEMA_VERSION;
  fingerprint: string;
  tuning: GameTuning;
  characterBalanceOverrides: CharacterBalanceOverrides;
  aiBehaviorTuning: AiBehaviorTuning;
}

export interface AiBatchRuleComparison {
  policy: 'single_variable' | 'explicit_multi_variable';
  changes: BalanceLabRuleChange[];
}

function fingerprintSnapshotRules(
  tuning: GameTuning,
  characterBalanceOverrides: CharacterBalanceOverrides,
  aiBehaviorTuning: AiBehaviorTuning,
): string {
  return fingerprintDeterministicValue({
    schemaVersion: AI_BATCH_RULE_SNAPSHOT_SCHEMA_VERSION,
    tuning: createGameTuningFingerprintInput(tuning),
    characterBalanceOverrides,
    aiBehaviorTuning,
  });
}

function fingerprintStoredSnapshotRules(
  tuning: GameTuning,
  characterBalanceOverrides: CharacterBalanceOverrides,
  aiBehaviorTuning: Record<string, unknown>,
): string {
  return fingerprintDeterministicValue({
    schemaVersion: AI_BATCH_RULE_SNAPSHOT_SCHEMA_VERSION,
    tuning: createGameTuningFingerprintInput(sanitiseTuning(tuning)),
    characterBalanceOverrides: sanitiseCharacterBalanceOverrides(
      characterBalanceOverrides,
    ),
    aiBehaviorTuning,
  });
}

export function createAiBatchRuleSnapshot(
  tuning: GameTuning = createDefaultTuning(),
  characterBalanceOverrides: CharacterBalanceOverrides = {},
  aiBehaviorTuning: AiBehaviorTuning = createDefaultAiBehaviorTuning(),
): AiBatchRuleSnapshot {
  const sanitisedTuning = sanitiseTuning(tuning);
  const sanitisedCharacterOverrides = sanitiseCharacterBalanceOverrides(
    characterBalanceOverrides,
  );
  const sanitisedAiBehavior = sanitiseAiBehaviorTuning(aiBehaviorTuning);
  return {
    schemaVersion: AI_BATCH_RULE_SNAPSHOT_SCHEMA_VERSION,
    fingerprint: fingerprintSnapshotRules(
      sanitisedTuning,
      sanitisedCharacterOverrides,
      sanitisedAiBehavior,
    ),
    tuning: sanitisedTuning,
    characterBalanceOverrides: sanitisedCharacterOverrides,
    aiBehaviorTuning: sanitisedAiBehavior,
  };
}

export function parseAiBatchRuleSnapshot(value: unknown): AiBatchRuleSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== AI_BATCH_RULE_SNAPSHOT_SCHEMA_VERSION
    || typeof record.fingerprint !== 'string'
    || !record.tuning
    || typeof record.tuning !== 'object'
    || Array.isArray(record.tuning)
    || !record.characterBalanceOverrides
    || typeof record.characterBalanceOverrides !== 'object'
    || Array.isArray(record.characterBalanceOverrides)
    || !record.aiBehaviorTuning
    || typeof record.aiBehaviorTuning !== 'object'
    || Array.isArray(record.aiBehaviorTuning)
  ) {
    return null;
  }

  const snapshot = createAiBatchRuleSnapshot(
    record.tuning as GameTuning,
    record.characterBalanceOverrides as CharacterBalanceOverrides,
    record.aiBehaviorTuning as AiBehaviorTuning,
  );
  if (snapshot.fingerprint === record.fingerprint) {
    return snapshot;
  }

  const storedAiBehavior = record.aiBehaviorTuning as Record<string, unknown>;
  const storedAiBehaviorSchema = storedAiBehavior.schemaVersion;
  const historicalFingerprintMatches = typeof storedAiBehaviorSchema === 'string'
    && MIGRATABLE_AI_BEHAVIOR_TUNING_SCHEMAS.has(storedAiBehaviorSchema)
    && fingerprintStoredSnapshotRules(
      record.tuning as GameTuning,
      record.characterBalanceOverrides as CharacterBalanceOverrides,
      storedAiBehavior,
    ) === record.fingerprint;
  return historicalFingerprintMatches ? snapshot : null;
}

export function compareAiBatchRuleSnapshots(
  baseline: AiBatchRuleSnapshot,
  candidate: AiBatchRuleSnapshot,
  options: { allowMultipleRuleChanges?: boolean } = {},
): AiBatchRuleComparison {
  const changes = buildBalanceLabRuleChanges(
    baseline.tuning,
    candidate.tuning,
    baseline.characterBalanceOverrides,
    candidate.characterBalanceOverrides,
    CHARACTER_IDS,
    baseline.aiBehaviorTuning,
    candidate.aiBehaviorTuning,
  );

  if (changes.length === 0) {
    throw new Error(
      'AI batch comparison has no effective rule change. Generate a baseline without --compare-report or change exactly one rule.',
    );
  }
  if (changes.length > 1 && !options.allowMultipleRuleChanges) {
    const paths = changes
      .slice(0, 5)
      .map((change) => `${change.scope}${change.characterId ? `.${change.characterId}` : ''}.${change.path}`)
      .join(', ');
    const remainder = changes.length > 5 ? `, and ${changes.length - 5} more` : '';
    throw new Error(
      `AI batch comparison changed ${changes.length} effective rules (${paths}${remainder}). Split the draft into one-variable candidates or pass --allow-multi-rule-comparison to acknowledge the full change set.`,
    );
  }

  return {
    policy: changes.length === 1 ? 'single_variable' : 'explicit_multi_variable',
    changes,
  };
}
