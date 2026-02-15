import { findFirstChecksumMismatch, runReplay, type ReplayPayload } from './replay';

export interface ReplayCheckReport {
  ok: boolean;
  frameCount: number;
  finalChecksum: number | null;
  expectedFrameCount: number | null;
  firstDivergentFrame: number | null;
  expectedChecksumAtDivergence: number | null;
  actualChecksumAtDivergence: number | null;
}

export interface ReplayCheckResult {
  checksums: number[];
  report: ReplayCheckReport;
}

export function normaliseExpectedChecksums(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => Number(value));
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { checksums?: unknown[] }).checksums)) {
    return ((raw as { checksums: unknown[] }).checksums).map((value) => Number(value));
  }
  throw new Error('Expected checksum file must be an array or an object with a "checksums" array.');
}

export function runReplayWithChecksums(
  payload: ReplayPayload,
  expectedChecksums?: number[],
): ReplayCheckResult {
  const checksums = runReplay(payload).checksums;
  const finalChecksum = checksums.length > 0 ? checksums[checksums.length - 1] : null;

  if (!expectedChecksums) {
    return {
      checksums,
      report: {
        ok: true,
        frameCount: checksums.length,
        finalChecksum,
        expectedFrameCount: null,
        firstDivergentFrame: null,
        expectedChecksumAtDivergence: null,
        actualChecksumAtDivergence: null,
      },
    };
  }

  const mismatch = findFirstChecksumMismatch(checksums, expectedChecksums);
  if (!mismatch) {
    return {
      checksums,
      report: {
        ok: true,
        frameCount: checksums.length,
        finalChecksum,
        expectedFrameCount: expectedChecksums.length,
        firstDivergentFrame: null,
        expectedChecksumAtDivergence: null,
        actualChecksumAtDivergence: null,
      },
    };
  }

  return {
    checksums,
    report: {
      ok: false,
      frameCount: checksums.length,
      finalChecksum,
      expectedFrameCount: expectedChecksums.length,
      firstDivergentFrame: mismatch.frame,
      expectedChecksumAtDivergence: mismatch.expected,
      actualChecksumAtDivergence: mismatch.actual,
    },
  };
}
