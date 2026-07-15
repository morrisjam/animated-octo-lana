const MAX_POSTGRES_APPLICATION_NAME_BYTES = 63;
const APPLICATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface DatabaseBackendReplacementSummary {
  previousBackendCount: number;
  recoveredBackendCount: number;
  survivingPreviousBackendCount: number;
  replacementBackendCount: number;
  replaced: boolean;
}

export function parseDatabaseApplicationName(value: string | undefined): string {
  const normalized = String(value ?? '').trim();
  if (
    normalized.length === 0
    || Buffer.byteLength(normalized, 'utf8') > MAX_POSTGRES_APPLICATION_NAME_BYTES
    || !APPLICATION_NAME_PATTERN.test(normalized)
  ) {
    throw new Error(
      'Database interruption target application name must be 1-63 ASCII letters, numbers, dots, underscores, colons, or hyphens.',
    );
  }
  return normalized;
}

function uniquePositiveBackendIds(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

export function summarizeDatabaseBackendReplacement(
  previousBackendIds: number[],
  recoveredBackendIds: number[],
): DatabaseBackendReplacementSummary {
  const previous = uniquePositiveBackendIds(previousBackendIds);
  const recovered = uniquePositiveBackendIds(recoveredBackendIds);
  const previousSet = new Set(previous);
  const survivingPreviousBackendCount = recovered.filter((pid) => previousSet.has(pid)).length;
  const replacementBackendCount = recovered.length - survivingPreviousBackendCount;

  return {
    previousBackendCount: previous.length,
    recoveredBackendCount: recovered.length,
    survivingPreviousBackendCount,
    replacementBackendCount,
    replaced: previous.length > 0
      && recovered.length > 0
      && survivingPreviousBackendCount === 0
      && replacementBackendCount > 0,
  };
}
