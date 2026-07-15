import { computeStateChecksum } from '../sim/checksum';
import { createInitialState, step } from '../sim/sim';
import type { CharacterId } from '../sim/characters';
import type { FrameInput, PlayerFrameInput, PlayerId, PlayersById } from '../sim/types';
import {
  OnlineInputPump,
  type OnlineFrameTransport,
  type OnlineInputPumpDiagnostics,
} from '../net/onlineInputPump';
import { applyPendingRemoteInputs } from '../net/onlineRemoteInputBuffer';
import {
  RollbackSession,
  type RollbackDiagnosticsSnapshot,
} from '../net/rollbackSession';

export const WEBRTC_ROLLBACK_SMOKE_FRAMES = 120;
export const WEBRTC_ROLLBACK_SMOKE_DELAY_FRAMES = 12;
export const WEBRTC_ROLLBACK_SMOKE_EPOCH = 1;
const WEBRTC_ROLLBACK_SMOKE_SEED = 20_260_714;
const FIXED_DT = 1 / 60;

export interface WebRtcRollbackScenarioOptions {
  transports: PlayersById<OnlineFrameTransport>;
  accountIds: PlayersById<string>;
  loadout: PlayersById<CharacterId>;
  frameCount?: number;
  deliveryIntervalFrames?: number;
  epoch?: number;
  settleTransport?: () => Promise<void>;
  paceThroughFrame?: (throughFrame: number) => Promise<void>;
}

export interface WebRtcRollbackPeerReport {
  checksum: number;
  predictedAdvanceFrames: number;
  acceptedRemoteFrames: number;
  rollbackApplications: number;
  synchronized: boolean;
  rollback: RollbackDiagnosticsSnapshot;
  pump: OnlineInputPumpDiagnostics;
}

export interface WebRtcRollbackScenarioReport {
  schemaVersion: 'gw.webrtc-rollback-smoke.v2';
  continuousSimulation: true;
  frameCount: number;
  deliveryIntervalFrames: number;
  epoch: number;
  canonicalChecksum: number;
  canonicalConvergence: boolean;
  peers: PlayersById<WebRtcRollbackPeerReport>;
}

function createNeutralInput(): PlayerFrameInput {
  return {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function createPlayerInput(frame: number, playerId: PlayerId): PlayerFrameInput {
  const input = createNeutralInput();
  const side = playerId === 'P1' ? 1 : -1;
  const phase = Math.floor(frame / 10) % 4;
  const actionFrame = frame % WEBRTC_ROLLBACK_SMOKE_FRAMES;
  input.moveX = side * ([1, 0.35, -0.7, 0.6][phase] ?? 0);
  input.moveY = side * ([-0.55, 0.75, 0.2, -0.7][(phase + (playerId === 'P1' ? 0 : 1)) % 4] ?? 0);
  input.boost = playerId === 'P1'
    ? frame % 36 >= 6 && frame % 36 < 12
    : frame % 40 >= 11 && frame % 40 < 17;
  input.launch = playerId === 'P1'
    ? actionFrame === 20 || actionFrame === 68
    : actionFrame === 27 || actionFrame === 74;
  input.special = playerId === 'P1' ? actionFrame === 42 : actionFrame === 48;
  input.parry = playerId === 'P1' ? actionFrame === 54 : actionFrame === 61;
  return input;
}

export function createWebRtcRollbackSmokeInput(frame: number): FrameInput {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`frame must be a non-negative integer. Received: ${frame}`);
  }
  return {
    p1: createPlayerInput(frame, 'P1'),
    p2: createPlayerInput(frame, 'P2'),
  };
}

function inputForPlayer(input: FrameInput, playerId: PlayerId): PlayerFrameInput {
  return playerId === 'P1' ? input.p1 : input.p2;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer. Received: ${resolved}`);
  }
  return resolved;
}

export async function runWebRtcRollbackScenario(
  options: WebRtcRollbackScenarioOptions,
): Promise<WebRtcRollbackScenarioReport> {
  if (!options.accountIds.P1 || !options.accountIds.P2 || options.accountIds.P1 === options.accountIds.P2) {
    throw new Error('Rollback smoke requires two distinct account ids.');
  }
  const frameCount = positiveInteger(options.frameCount, WEBRTC_ROLLBACK_SMOKE_FRAMES, 'frameCount');
  const deliveryIntervalFrames = positiveInteger(
    options.deliveryIntervalFrames,
    WEBRTC_ROLLBACK_SMOKE_DELAY_FRAMES,
    'deliveryIntervalFrames',
  );
  const epoch = options.epoch ?? WEBRTC_ROLLBACK_SMOKE_EPOCH;
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error(`epoch must be a non-negative integer. Received: ${epoch}`);
  }
  const settleTransport = options.settleTransport ?? (() => Promise.resolve());
  const initialState = createInitialState({
    seed: WEBRTC_ROLLBACK_SMOKE_SEED,
    loadout: options.loadout,
    rules: { allowDunkWin: false },
  });
  const canonicalState = createInitialState({
    seed: WEBRTC_ROLLBACK_SMOKE_SEED,
    loadout: options.loadout,
    rules: { allowDunkWin: false },
  });
  const sessions: PlayersById<RollbackSession> = {
    P1: new RollbackSession({
      initialState,
      localPlayerId: 'P1',
      fixedDt: FIXED_DT,
      maxHistoryFrames: Math.max(600, deliveryIntervalFrames * 4),
    }),
    P2: new RollbackSession({
      initialState,
      localPlayerId: 'P2',
      fixedDt: FIXED_DT,
      maxHistoryFrames: Math.max(600, deliveryIntervalFrames * 4),
    }),
  };
  const pumps: PlayersById<OnlineInputPump> = {
    P1: new OnlineInputPump({
      epoch,
      remoteAccountId: options.accountIds.P2,
      transport: options.transports.P1,
      maxUploadBatchFrames: deliveryIntervalFrames,
    }),
    P2: new OnlineInputPump({
      epoch,
      remoteAccountId: options.accountIds.P1,
      transport: options.transports.P2,
      maxUploadBatchFrames: deliveryIntervalFrames,
    }),
  };
  const predictedAdvanceFrames: PlayersById<number> = { P1: 0, P2: 0 };
  const acceptedRemoteFrames: PlayersById<number> = { P1: 0, P2: 0 };
  const rollbackApplications: PlayersById<number> = { P1: 0, P2: 0 };

  const exchangeThrough = async (throughFrame: number): Promise<void> => {
    await Promise.all([pumps.P1.flushOutgoing(), pumps.P2.flushOutgoing()]);
    await Promise.all([pumps.P1.pollIncoming(), pumps.P2.pollIncoming()]);
    for (const playerId of ['P1', 'P2'] as const) {
      const applied = applyPendingRemoteInputs(
        pumps[playerId].getPendingRemoteInputs(),
        sessions[playerId],
        throughFrame,
      );
      acceptedRemoteFrames[playerId] += applied.appliedFrames.length;
      if (applied.rollbackFrames > 0) {
        rollbackApplications[playerId] += 1;
      }
      if (
        applied.duplicateFrames.length > 0
        || applied.conflictingFrames.length > 0
        || applied.tooLateFrames.length > 0
      ) {
        throw new Error(`Rollback smoke received invalid ${playerId} authoritative-frame classifications.`);
      }
    }
  };

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameInput = createWebRtcRollbackSmokeInput(frame);
    step(canonicalState, frameInput, FIXED_DT);
    for (const playerId of ['P1', 'P2'] as const) {
      const localInput = inputForPlayer(frameInput, playerId);
      pumps[playerId].enqueueLocalInput(frame, localInput);
      const advanced = sessions[playerId].advanceFrame({ localInput });
      if (advanced.usedPrediction) {
        predictedAdvanceFrames[playerId] += 1;
      }
    }
    if ((frame + 1) % deliveryIntervalFrames === 0 || frame === frameCount - 1) {
      await options.paceThroughFrame?.(frame);
      await exchangeThrough(frame);
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (pumps.P1.getOutboundFrameCount() === 0 && pumps.P2.getOutboundFrameCount() === 0) {
      break;
    }
    await exchangeThrough(frameCount - 1);
  }
  if (pumps.P1.getOutboundFrameCount() > 0 || pumps.P2.getOutboundFrameCount() > 0) {
    throw new Error('Rollback smoke left outbound frames unacknowledged.');
  }

  await Promise.all([pumps.P1.flushConfirmation(), pumps.P2.flushConfirmation()]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await settleTransport();
    await Promise.all([pumps.P1.pollIncoming(), pumps.P2.pollIncoming()]);
    if (
      pumps.P1.isSynchronizedThrough(frameCount - 1)
      && pumps.P2.isSynchronizedThrough(frameCount - 1)
    ) {
      break;
    }
  }

  const canonicalChecksum = computeStateChecksum(canonicalState);
  const peerChecksums: PlayersById<number> = {
    P1: computeStateChecksum(sessions.P1.getStateSnapshot()),
    P2: computeStateChecksum(sessions.P2.getStateSnapshot()),
  };
  const reportPeers = {} as PlayersById<WebRtcRollbackPeerReport>;
  for (const playerId of ['P1', 'P2'] as const) {
    const rollback = sessions[playerId].getDiagnosticsSnapshot();
    const pump = pumps[playerId].getDiagnostics();
    const synchronized = pumps[playerId].isSynchronizedThrough(frameCount - 1);
    if (acceptedRemoteFrames[playerId] !== frameCount) {
      throw new Error(
        `${playerId} accepted ${acceptedRemoteFrames[playerId]}/${frameCount} remote frames.`,
      );
    }
    if (
      rollback.totalRollbacks <= 0
      || rollback.maxRollbackDepth < deliveryIntervalFrames
      || rollback.correctionEvents.length <= 0
    ) {
      throw new Error(`${playerId} did not prove delayed-input rollback correction.`);
    }
    if (
      rollback.conflictingAuthoritativeFrames > 0
      || rollback.tooLateAuthoritativeFrames > 0
      || pump.uploadFailures > 0
      || pump.pollFailures > 0
      || pump.confirmationFailures > 0
    ) {
      throw new Error(`${playerId} reported a rollback or transport protocol failure.`);
    }
    if (!synchronized) {
      throw new Error(`${playerId} did not synchronize through frame ${frameCount - 1}.`);
    }
    reportPeers[playerId] = {
      checksum: peerChecksums[playerId],
      predictedAdvanceFrames: predictedAdvanceFrames[playerId],
      acceptedRemoteFrames: acceptedRemoteFrames[playerId],
      rollbackApplications: rollbackApplications[playerId],
      synchronized,
      rollback,
      pump,
    };
  }

  const canonicalConvergence = peerChecksums.P1 === canonicalChecksum
    && peerChecksums.P2 === canonicalChecksum;
  if (!canonicalConvergence) {
    throw new Error(
      `Rollback checksums diverged: canonical=${canonicalChecksum}, P1=${peerChecksums.P1}, P2=${peerChecksums.P2}.`,
    );
  }

  return {
    schemaVersion: 'gw.webrtc-rollback-smoke.v2',
    continuousSimulation: true,
    frameCount,
    deliveryIntervalFrames,
    epoch,
    canonicalChecksum,
    canonicalConvergence,
    peers: reportPeers,
  };
}
