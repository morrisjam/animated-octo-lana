import { describe, expect, test } from 'vitest';
import { runRollbackNetworkSoak } from './rollbackNetworkSoak';

describe('rollback network soak', () => {
  test('matches the canonical simulation without impairment', () => {
    const report = runRollbackNetworkSoak({
      profile: {
        id: 'unit-clean',
        frames: 240,
        seed: 101,
        baseLatencyFrames: 0,
        jitterFrames: 0,
        packetLossRate: 0,
        reorderRate: 0,
        duplicateRate: 0,
        sendIntervalFrames: 1,
        retryIntervalFrames: 1,
      },
      thresholds: {
        maxRollbackDepthFrames: 0,
        maxP95RollbackDepthFrames: 0,
        maxFrameRecoveryAgeFrames: 0,
      },
      generatedAt: '2026-07-13T00:00:00.000Z',
    });

    expect(report.passed).toBe(true);
    expect(report.canonicalConvergence).toBe(true);
    expect(report.clients.P1.predictedAdvanceFrames).toBe(0);
    expect(report.clients.P2.predictedAdvanceFrames).toBe(0);
    expect(report.clients.P1.rollbackDepthFrames.count).toBe(0);
    expect(report.clients.P2.rollbackDepthFrames.count).toBe(0);
  });

  test('recovers and converges through deterministic loss, jitter, and reordering', () => {
    const report = runRollbackNetworkSoak({
      profile: {
        id: 'unit-adverse',
        frames: 900,
        seed: 2026,
        maxHistoryFrames: 240,
        maxDrainFrames: 240,
      },
      thresholds: {
        maxRollbackDepthFrames: 60,
        maxP95RollbackDepthFrames: 40,
        maxFrameRecoveryAgeFrames: 120,
      },
      generatedAt: '2026-07-13T00:00:00.000Z',
    });

    expect(report.failures).toEqual([]);
    expect(report.canonicalConvergence).toBe(true);
    expect(report.links.P1_to_P2.droppedPackets + report.links.P2_to_P1.droppedPackets).toBeGreaterThan(0);
    expect(report.links.P1_to_P2.reorderedPackets + report.links.P2_to_P1.reorderedPackets).toBeGreaterThan(0);
    expect(report.clients.P1.rollbackDepthFrames.count).toBeGreaterThan(0);
    expect(report.clients.P2.rollbackDepthFrames.count).toBeGreaterThan(0);
  });

  test('reports a failed gate when the configured rollback budget is too strict', () => {
    const report = runRollbackNetworkSoak({
      profile: {
        id: 'unit-strict-gate',
        frames: 180,
        seed: 303,
        baseLatencyFrames: 5,
        jitterFrames: 0,
        packetLossRate: 0,
        reorderRate: 0,
        duplicateRate: 0,
      },
      thresholds: {
        maxRollbackDepthFrames: 0,
        maxP95RollbackDepthFrames: 0,
      },
      generatedAt: '2026-07-13T00:00:00.000Z',
    });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.includes('rollback depth'))).toBe(true);
  });
});
