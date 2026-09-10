import { RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES } from '../sim/rankedInputCommitment';

// Reserve one frame for the gap between receipt and canonical archival.
export const MAX_ONLINE_PREDICTION_FRAMES = RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES - 1;

export function canAdvanceOnlineSimulation(frame: number, mutuallyConfirmedThrough: number): boolean {
  if (!Number.isSafeInteger(frame) || frame < 0
    || !Number.isSafeInteger(mutuallyConfirmedThrough) || mutuallyConfirmedThrough < -1) return false;
  return frame - (mutuallyConfirmedThrough + 1) < MAX_ONLINE_PREDICTION_FRAMES;
}
