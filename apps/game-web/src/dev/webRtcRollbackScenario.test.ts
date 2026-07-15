import { describe, expect, test } from 'vitest';
import type {
  OnlineFrameEnvelope,
  OnlineFrameSubmission,
  OnlineFrameTransport,
} from '../net/onlineInputPump';
import {
  WEBRTC_ROLLBACK_SMOKE_DELAY_FRAMES,
  WEBRTC_ROLLBACK_SMOKE_FRAMES,
  createWebRtcRollbackSmokeInput,
  runWebRtcRollbackScenario,
} from './webRtcRollbackScenario';

class PairedMemoryTransport implements OnlineFrameTransport {
  private peer: PairedMemoryTransport | null = null;

  private readonly receivedFrames: OnlineFrameEnvelope[] = [];

  private readonly peerConfirmations = new Map<number, number>();

  public constructor(private readonly localAccountId: string) {}

  public connect(peer: PairedMemoryTransport): void {
    this.peer = peer;
  }

  public async submitFrames(frames: OnlineFrameSubmission[]): Promise<{ acceptedFrames: number }> {
    if (!this.peer) {
      throw new Error('Memory transport is not connected.');
    }
    for (const frame of frames) {
      this.peer.receivedFrames.push({
        ...frame,
        accountId: this.localAccountId,
        receivedAt: '2026-07-14T00:00:00.000Z',
      });
    }
    return { acceptedFrames: frames.length };
  }

  public async pollFrames(
    epoch: number,
    sinceFrame: number,
  ): Promise<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough: number }> {
    return {
      frames: this.receivedFrames
        .filter((frame) => frame.epoch === epoch && frame.frame > sinceFrame)
        .sort((first, second) => first.frame - second.frame),
      peerConfirmedThrough: this.peerConfirmations.get(epoch) ?? -1,
    };
  }

  public async confirmFrames(
    epoch: number,
    confirmedThrough: number,
  ): Promise<{ confirmedThrough: number }> {
    if (!this.peer) {
      throw new Error('Memory transport is not connected.');
    }
    this.peer.peerConfirmations.set(
      epoch,
      Math.max(this.peer.peerConfirmations.get(epoch) ?? -1, confirmedThrough),
    );
    return { confirmedThrough };
  }
}

describe('real-transport rollback smoke scenario', () => {
  test('forces late-input corrections and converges both peers to canonical state', async () => {
    const accountIds = {
      P1: '11111111-1111-4111-8111-111111111111',
      P2: '22222222-2222-4222-8222-222222222222',
    } as const;
    const transportP1 = new PairedMemoryTransport(accountIds.P1);
    const transportP2 = new PairedMemoryTransport(accountIds.P2);
    transportP1.connect(transportP2);
    transportP2.connect(transportP1);

    const report = await runWebRtcRollbackScenario({
      transports: { P1: transportP1, P2: transportP2 },
      accountIds,
      loadout: { P1: 'vanguard', P2: 'duelist' },
    });

    expect(report.schemaVersion).toBe('gw.webrtc-rollback-smoke.v2');
    expect(report.continuousSimulation).toBe(true);
    expect(report.frameCount).toBe(WEBRTC_ROLLBACK_SMOKE_FRAMES);
    expect(report.deliveryIntervalFrames).toBe(WEBRTC_ROLLBACK_SMOKE_DELAY_FRAMES);
    expect(report.canonicalConvergence).toBe(true);
    expect(report.peers.P1.checksum).toBe(report.canonicalChecksum);
    expect(report.peers.P2.checksum).toBe(report.canonicalChecksum);
    for (const peer of [report.peers.P1, report.peers.P2]) {
      expect(peer.acceptedRemoteFrames).toBe(WEBRTC_ROLLBACK_SMOKE_FRAMES);
      expect(peer.predictedAdvanceFrames).toBe(WEBRTC_ROLLBACK_SMOKE_FRAMES);
      expect(peer.rollback.totalRollbacks).toBeGreaterThan(0);
      expect(peer.rollback.maxRollbackDepth).toBeGreaterThanOrEqual(WEBRTC_ROLLBACK_SMOKE_DELAY_FRAMES);
      expect(peer.rollback.correctionEvents.length).toBeGreaterThan(0);
      expect(peer.pump.contiguousRemoteFrame).toBe(WEBRTC_ROLLBACK_SMOKE_FRAMES - 1);
      expect(peer.pump.peerConfirmedThrough).toBe(WEBRTC_ROLLBACK_SMOKE_FRAMES - 1);
      expect(peer.synchronized).toBe(true);
    }
  });

  test('uses bounded deterministic inputs and rejects invalid frame ids', () => {
    expect(createWebRtcRollbackSmokeInput(42)).toEqual(createWebRtcRollbackSmokeInput(42));
    expect(createWebRtcRollbackSmokeInput(140).p1.launch).toBe(true);
    expect(createWebRtcRollbackSmokeInput(147).p2.launch).toBe(true);
    expect(() => createWebRtcRollbackSmokeInput(-1)).toThrow('frame must be a non-negative integer');
  });

  test('paces only completed delivery windows for a real-time soak', async () => {
    const accountIds = {
      P1: '11111111-1111-4111-8111-111111111111',
      P2: '22222222-2222-4222-8222-222222222222',
    } as const;
    const transportP1 = new PairedMemoryTransport(accountIds.P1);
    const transportP2 = new PairedMemoryTransport(accountIds.P2);
    transportP1.connect(transportP2);
    transportP2.connect(transportP1);
    const pacedThrough: number[] = [];

    const report = await runWebRtcRollbackScenario({
      transports: { P1: transportP1, P2: transportP2 },
      accountIds,
      loadout: { P1: 'vanguard', P2: 'duelist' },
      frameCount: 25,
      deliveryIntervalFrames: 10,
      paceThroughFrame: async (throughFrame) => {
        pacedThrough.push(throughFrame);
      },
    });

    expect(pacedThrough).toEqual([9, 19, 24]);
    expect(report.canonicalConvergence).toBe(true);
  });
});
