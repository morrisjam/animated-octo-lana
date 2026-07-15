import { sanitiseSeed } from './rng';
import type { PlayerId } from './types';

const AI_SEED_SALT: Record<PlayerId, number> = {
  P1: 0x517cc1b7,
  P2: 0x9e3779b9,
};

function sanitiseRoundIndex(roundIndex: number): number {
  if (!Number.isFinite(roundIndex)) {
    return 0;
  }
  return Math.max(0, Math.floor(roundIndex));
}

export function deriveOfflineRoundSeed(matchSeed: number, roundIndex: number): number {
  const baseSeed = sanitiseSeed(matchSeed);
  return sanitiseSeed((baseSeed + sanitiseRoundIndex(roundIndex)) >>> 0);
}

export function deriveOfflineAiSeed(roundSeed: number, playerId: PlayerId): number {
  return sanitiseSeed((sanitiseSeed(roundSeed) ^ AI_SEED_SALT[playerId]) >>> 0);
}
