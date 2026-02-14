export type EnforcementActionType = 'warning' | 'suspension' | 'ban';
export type EnforcementActionState = 'active' | 'expired' | 'revoked' | 'scheduled' | 'non_blocking';

export interface EnforcementActionStateInput {
  actionType: EnforcementActionType;
  startsAtIso: string;
  endsAtIso: string | null;
  revokedAtIso: string | null;
  nowIso?: string;
}

function parseTimestampMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getEnforcementActionState(input: EnforcementActionStateInput): EnforcementActionState {
  if (input.actionType === 'warning') {
    return 'non_blocking';
  }
  if (input.revokedAtIso && parseTimestampMs(input.revokedAtIso) !== null) {
    return 'revoked';
  }
  const startsAtMs = parseTimestampMs(input.startsAtIso);
  if (startsAtMs === null) {
    return 'non_blocking';
  }
  const nowMs = parseTimestampMs(input.nowIso ?? new Date().toISOString()) ?? Date.now();
  if (nowMs < startsAtMs) {
    return 'scheduled';
  }
  if (input.actionType === 'ban') {
    return 'active';
  }
  const endsAtMs = parseTimestampMs(input.endsAtIso);
  if (endsAtMs === null) {
    return 'expired';
  }
  return nowMs >= endsAtMs ? 'expired' : 'active';
}

export function isBlockingEnforcementAction(input: EnforcementActionStateInput): boolean {
  return getEnforcementActionState(input) === 'active';
}
