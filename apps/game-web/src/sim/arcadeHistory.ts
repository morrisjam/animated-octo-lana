import type { AiDifficultyId } from './ai';
import type { CharacterId } from './characters';

export type ArcadeRunOutcome = 'completed' | 'failed';

export interface ArcadeRunHistoryEntry {
  id: string;
  completedAt: string;
  playerCharacterId: CharacterId;
  aiDifficulty: AiDifficultyId;
  outcome: ArcadeRunOutcome;
  completionSeconds: number;
  stagesCleared: number;
  totalStages: number;
  continuesUsed: number;
  retriesUsed: number;
}

export interface ArcadeRunHistory {
  version: 1;
  entries: ArcadeRunHistoryEntry[];
}

export interface ArcadeBestRecord {
  playerCharacterId: CharacterId;
  aiDifficulty: AiDifficultyId;
  completionSeconds: number;
  completedAt: string;
  runId: string;
}

const CHARACTER_IDS: CharacterId[] = ['vanguard', 'duelist', 'ace', 'warden'];
const AI_DIFFICULTY_IDS: AiDifficultyId[] = ['rookie', 'cadet', 'veteran', 'ace'];

function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && CHARACTER_IDS.includes(value as CharacterId);
}

function isAiDifficultyId(value: unknown): value is AiDifficultyId {
  return typeof value === 'string' && AI_DIFFICULTY_IDS.includes(value as AiDifficultyId);
}

function clampInteger(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseDateToMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitiseEntry(value: unknown): ArcadeRunHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.trim().length === 0) {
    return null;
  }
  if (typeof row.completedAt !== 'string' || !Number.isFinite(Date.parse(row.completedAt))) {
    return null;
  }
  if (!isCharacterId(row.playerCharacterId)) {
    return null;
  }
  if (!isAiDifficultyId(row.aiDifficulty)) {
    return null;
  }
  const outcome = row.outcome === 'completed' ? 'completed' : row.outcome === 'failed' ? 'failed' : null;
  if (!outcome) {
    return null;
  }
  const completionSeconds = Number(row.completionSeconds);
  if (!Number.isFinite(completionSeconds) || completionSeconds < 0) {
    return null;
  }

  return {
    id: row.id,
    completedAt: row.completedAt,
    playerCharacterId: row.playerCharacterId,
    aiDifficulty: row.aiDifficulty,
    outcome,
    completionSeconds,
    stagesCleared: clampInteger(row.stagesCleared, 0, 999),
    totalStages: clampInteger(row.totalStages, 1, 999),
    continuesUsed: clampInteger(row.continuesUsed, 0, 99),
    retriesUsed: clampInteger(row.retriesUsed, 0, 99),
  };
}

function sortNewestFirst(entries: ArcadeRunHistoryEntry[]): ArcadeRunHistoryEntry[] {
  return [...entries].sort((left, right) => parseDateToMs(right.completedAt) - parseDateToMs(left.completedAt));
}

export function createEmptyArcadeRunHistory(): ArcadeRunHistory {
  return {
    version: 1,
    entries: [],
  };
}

export function sanitiseArcadeRunHistory(raw: unknown): ArcadeRunHistory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createEmptyArcadeRunHistory();
  }
  const payload = raw as { entries?: unknown };
  if (!Array.isArray(payload.entries)) {
    return createEmptyArcadeRunHistory();
  }

  const deduped = new Map<string, ArcadeRunHistoryEntry>();
  for (const item of payload.entries) {
    const entry = sanitiseEntry(item);
    if (!entry) {
      continue;
    }
    deduped.set(entry.id, entry);
  }
  return {
    version: 1,
    entries: sortNewestFirst([...deduped.values()]),
  };
}

export function appendArcadeRunHistoryEntry(
  history: ArcadeRunHistory,
  entry: ArcadeRunHistoryEntry,
  maxEntries = 60,
): ArcadeRunHistory {
  const next = sanitiseArcadeRunHistory(history);
  const byId = new Map(next.entries.map((item) => [item.id, item]));
  byId.set(entry.id, entry);
  const sorted = sortNewestFirst([...byId.values()]).slice(0, Math.max(1, maxEntries));
  return {
    version: 1,
    entries: sorted,
  };
}

export function mergeArcadeRunHistories(
  left: ArcadeRunHistory,
  right: ArcadeRunHistory,
  maxEntries = 60,
): ArcadeRunHistory {
  const merged = new Map<string, ArcadeRunHistoryEntry>();
  for (const entry of sanitiseArcadeRunHistory(left).entries) {
    merged.set(entry.id, entry);
  }
  for (const entry of sanitiseArcadeRunHistory(right).entries) {
    merged.set(entry.id, entry);
  }
  return {
    version: 1,
    entries: sortNewestFirst([...merged.values()]).slice(0, Math.max(1, maxEntries)),
  };
}

export function areArcadeRunHistoriesEqual(left: ArcadeRunHistory, right: ArcadeRunHistory): boolean {
  const leftEntries = sanitiseArcadeRunHistory(left).entries;
  const rightEntries = sanitiseArcadeRunHistory(right).entries;
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let i = 0; i < leftEntries.length; i += 1) {
    const a = leftEntries[i];
    const b = rightEntries[i];
    if (
      a.id !== b.id
      || a.completedAt !== b.completedAt
      || a.playerCharacterId !== b.playerCharacterId
      || a.aiDifficulty !== b.aiDifficulty
      || a.outcome !== b.outcome
      || a.completionSeconds !== b.completionSeconds
      || a.stagesCleared !== b.stagesCleared
      || a.totalStages !== b.totalStages
      || a.continuesUsed !== b.continuesUsed
      || a.retriesUsed !== b.retriesUsed
    ) {
      return false;
    }
  }
  return true;
}

export function computeArcadeBestRecords(history: ArcadeRunHistory): ArcadeBestRecord[] {
  const bestByKey = new Map<string, ArcadeBestRecord>();
  for (const entry of sanitiseArcadeRunHistory(history).entries) {
    if (entry.outcome !== 'completed') {
      continue;
    }
    const key = `${entry.playerCharacterId}:${entry.aiDifficulty}`;
    const existing = bestByKey.get(key);
    if (!existing || entry.completionSeconds < existing.completionSeconds) {
      bestByKey.set(key, {
        playerCharacterId: entry.playerCharacterId,
        aiDifficulty: entry.aiDifficulty,
        completionSeconds: entry.completionSeconds,
        completedAt: entry.completedAt,
        runId: entry.id,
      });
    }
  }
  return [...bestByKey.values()].sort((left, right) => left.completionSeconds - right.completionSeconds);
}
