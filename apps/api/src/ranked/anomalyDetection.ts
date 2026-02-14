export type RankedAnomalyType = 'impossible_cadence' | 'rating_jump' | 'mr_jump';
export type RankedAnomalySeverity = 'high' | 'medium';

export interface RankedAnomalyAlertDraft {
  type: RankedAnomalyType;
  severity: RankedAnomalySeverity;
  message: string;
  metadata: Record<string, unknown>;
}

export interface DetectRankedAnomaliesArgs {
  occurredAtIso: string;
  previousMatchAtIso: string | null;
  ratingDelta: number;
  mrDelta: number | null;
  minMatchIntervalSeconds: number;
  ratingJumpThreshold: number;
  mrJumpThreshold: number;
}

function toTimestampMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function detectRankedAnomalies(args: DetectRankedAnomaliesArgs): RankedAnomalyAlertDraft[] {
  const alerts: RankedAnomalyAlertDraft[] = [];
  const currentMs = toTimestampMs(args.occurredAtIso);
  const previousMs = toTimestampMs(args.previousMatchAtIso);
  if (currentMs !== null && previousMs !== null) {
    const elapsedSeconds = Math.max(0, Math.floor((currentMs - previousMs) / 1000));
    if (elapsedSeconds < args.minMatchIntervalSeconds) {
      alerts.push({
        type: 'impossible_cadence',
        severity: 'high',
        message: `Ranked match cadence too fast (${elapsedSeconds}s between matches).`,
        metadata: {
          elapsedSeconds,
          minMatchIntervalSeconds: args.minMatchIntervalSeconds,
          previousMatchAt: args.previousMatchAtIso,
        },
      });
    }
  }

  if (Math.abs(args.ratingDelta) >= args.ratingJumpThreshold) {
    alerts.push({
      type: 'rating_jump',
      severity: 'medium',
      message: `Rating delta ${args.ratingDelta} exceeded threshold ${args.ratingJumpThreshold}.`,
      metadata: {
        ratingDelta: args.ratingDelta,
        threshold: args.ratingJumpThreshold,
      },
    });
  }

  if (args.mrDelta !== null && Math.abs(args.mrDelta) >= args.mrJumpThreshold) {
    alerts.push({
      type: 'mr_jump',
      severity: 'medium',
      message: `MR delta ${args.mrDelta} exceeded threshold ${args.mrJumpThreshold}.`,
      metadata: {
        mrDelta: args.mrDelta,
        threshold: args.mrJumpThreshold,
      },
    });
  }

  return alerts;
}
