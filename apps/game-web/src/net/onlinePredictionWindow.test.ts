import { describe, expect, test } from 'vitest';
import { canAdvanceOnlineSimulation, MAX_ONLINE_PREDICTION_FRAMES } from './onlinePredictionWindow';
import { RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES } from '../sim/rankedInputCommitment';

describe('online prediction window', () => {
  test('stops before speculation exceeds the input commitment rollback guard', () => {
    expect(MAX_ONLINE_PREDICTION_FRAMES).toBe(RANKED_INPUT_COMMITMENT_ROLLBACK_GUARD_FRAMES - 1);
    for (let frame = 0; frame < 119; frame += 1) expect(canAdvanceOnlineSimulation(frame, -1)).toBe(true);
    expect(canAdvanceOnlineSimulation(119, -1)).toBe(false);
    expect(canAdvanceOnlineSimulation(120, -1)).toBe(false);
    expect(canAdvanceOnlineSimulation(5349, 4694)).toBe(false);
  });

  test('resumes when confirmations advance without requiring another local input', () => {
    expect(canAdvanceOnlineSimulation(120, -1)).toBe(false);
    expect(canAdvanceOnlineSimulation(120, 119)).toBe(true);
    expect(canAdvanceOnlineSimulation(238, 119)).toBe(true);
    expect(canAdvanceOnlineSimulation(239, 119)).toBe(false);
    expect(canAdvanceOnlineSimulation(240, 120)).toBe(false);
    expect(canAdvanceOnlineSimulation(240, 119)).toBe(false);
    expect(canAdvanceOnlineSimulation(240, 239)).toBe(true);
    expect(canAdvanceOnlineSimulation(0, -1)).toBe(true);
  });

  test('fails closed for malformed frame counters', () => {
    for (const frame of [-1, NaN, Infinity, 0.5]) expect(canAdvanceOnlineSimulation(frame, -1)).toBe(false);
    for (const confirmed of [-2, NaN, Infinity, 0.5]) expect(canAdvanceOnlineSimulation(0, confirmed)).toBe(false);
  });
});
