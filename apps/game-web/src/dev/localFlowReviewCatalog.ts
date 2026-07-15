export const LOCAL_FLOW_REVIEW_ENDPOINT = '/__gravity-well/local-flow-reviews';
export const LOCAL_FLOW_REVIEW_CATALOG_SCHEMA = 'gw.local-flow-review-catalog.v2';

export type LocalFlowReviewStatus = 'blocked' | 'watch' | 'representative';

export interface LocalFlowReviewCase {
  id: string;
  kind: string;
  status: LocalFlowReviewStatus;
  summary: string;
  label: string;
  p1: string;
  p2: string;
  difficulty: string;
  gameNumber: number;
  roundNumber: number;
  setSeed: number;
  roundSeed: number;
  focusFrame: number;
  endFrame: number | null;
  frames: number;
}

export interface LocalFlowReviewCatalog {
  schemaVersion: typeof LOCAL_FLOW_REVIEW_CATALOG_SCHEMA;
  generatedAt: string;
  reportSchemaVersion: string;
  cases: LocalFlowReviewCase[];
}

export type LocalFlowReviewCatalogParseResult =
  | { ok: true; catalog: LocalFlowReviewCatalog }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isReviewStatus(value: unknown): value is LocalFlowReviewStatus {
  return value === 'blocked' || value === 'watch' || value === 'representative';
}

function isSafeReplayId(value: string): boolean {
  if (!value.startsWith('local-flow-review-replays/') || !value.endsWith('-replay.json')) {
    return false;
  }
  if (value.includes('\\')) {
    return false;
  }
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function parseCase(value: unknown, index: number): LocalFlowReviewCase | string {
  if (!isRecord(value)) {
    return `cases[${index}] must be an object.`;
  }
  const stringFields = ['id', 'kind', 'summary', 'label', 'p1', 'p2', 'difficulty'] as const;
  for (const field of stringFields) {
    if (!isNonEmptyString(value[field])) {
      return `cases[${index}].${field} must be a non-empty string.`;
    }
  }
  if (!isSafeReplayId(value.id as string)) {
    return `cases[${index}].id is not a safe local flow-review replay path.`;
  }
  if (!isReviewStatus(value.status)) {
    return `cases[${index}].status must be blocked, watch, or representative.`;
  }
  const integerFields = [
    'gameNumber',
    'roundNumber',
    'setSeed',
    'roundSeed',
    'focusFrame',
    'frames',
  ] as const;
  for (const field of integerFields) {
    if (!isNonNegativeInteger(value[field])) {
      return `cases[${index}].${field} must be a non-negative integer.`;
    }
  }
  if (value.endFrame !== null && !isNonNegativeInteger(value.endFrame)) {
    return `cases[${index}].endFrame must be null or a non-negative integer.`;
  }
  if ((value.gameNumber as number) < 1 || (value.roundNumber as number) < 1 || (value.frames as number) < 1) {
    return `cases[${index}] game, round, and frame counts must be positive.`;
  }
  if ((value.focusFrame as number) >= (value.frames as number)) {
    return `cases[${index}].focusFrame must be inside the replay.`;
  }
  if (typeof value.endFrame === 'number' && value.endFrame < (value.focusFrame as number)) {
    return `cases[${index}].endFrame cannot precede focusFrame.`;
  }

  return {
    id: value.id as string,
    kind: value.kind as string,
    status: value.status,
    summary: value.summary as string,
    label: value.label as string,
    p1: value.p1 as string,
    p2: value.p2 as string,
    difficulty: value.difficulty as string,
    gameNumber: value.gameNumber as number,
    roundNumber: value.roundNumber as number,
    setSeed: value.setSeed as number,
    roundSeed: value.roundSeed as number,
    focusFrame: value.focusFrame as number,
    endFrame: value.endFrame as number | null,
    frames: value.frames as number,
  };
}

export function parseLocalFlowReviewCatalog(raw: unknown): LocalFlowReviewCatalogParseResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Local flow-review catalog must be an object.' };
  }
  if (raw.schemaVersion !== LOCAL_FLOW_REVIEW_CATALOG_SCHEMA) {
    return { ok: false, error: `Unsupported local flow-review catalog schema: ${String(raw.schemaVersion)}.` };
  }
  if (!isNonEmptyString(raw.generatedAt) || Number.isNaN(Date.parse(raw.generatedAt))) {
    return { ok: false, error: 'Local flow-review catalog generatedAt must be an ISO timestamp.' };
  }
  if (!isNonEmptyString(raw.reportSchemaVersion)) {
    return { ok: false, error: 'Local flow-review catalog reportSchemaVersion is required.' };
  }
  if (!Array.isArray(raw.cases)) {
    return { ok: false, error: 'Local flow-review catalog cases must be an array.' };
  }

  const cases: LocalFlowReviewCase[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < raw.cases.length; index += 1) {
    const parsed = parseCase(raw.cases[index], index);
    if (typeof parsed === 'string') {
      return { ok: false, error: parsed };
    }
    if (ids.has(parsed.id)) {
      return { ok: false, error: `Duplicate local flow-review case id: ${parsed.id}.` };
    }
    ids.add(parsed.id);
    cases.push(parsed);
  }

  return {
    ok: true,
    catalog: {
      schemaVersion: LOCAL_FLOW_REVIEW_CATALOG_SCHEMA,
      generatedAt: raw.generatedAt,
      reportSchemaVersion: raw.reportSchemaVersion,
      cases,
    },
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const value = await response.json() as { error?: unknown; hint?: unknown };
    const error = isNonEmptyString(value.error) ? value.error : `Request failed (${response.status}).`;
    return isNonEmptyString(value.hint) ? `${error} ${value.hint}` : error;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export async function fetchLocalFlowReviewCatalog(): Promise<LocalFlowReviewCatalog> {
  const response = await fetch(LOCAL_FLOW_REVIEW_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const parsed = parseLocalFlowReviewCatalog(await response.json());
  if (parsed.ok === false) {
    throw new Error(parsed.error);
  }
  return parsed.catalog;
}

export async function fetchLocalFlowReviewReplay(id: string): Promise<unknown> {
  if (!isSafeReplayId(id)) {
    throw new Error('Local flow-review replay id is invalid.');
  }
  const response = await fetch(
    `${LOCAL_FLOW_REVIEW_ENDPOINT}/replay?id=${encodeURIComponent(id)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return await response.json() as unknown;
}
