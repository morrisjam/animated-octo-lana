import { computeStateChecksum } from '../sim/checksum';
import { createInitialState, step } from '../sim/sim';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId } from '../sim/types';
import { applyPendingRemoteInputs } from './onlineRemoteInputBuffer';
import { RollbackSession, type RollbackDiagnosticsSnapshot } from './rollbackSession';

export interface NetworkImpairmentProfile {
  id: string;
  frames: number;
  seed: number;
  fixedDt: number;
  baseLatencyFrames: number;
  jitterFrames: number;
  packetLossRate: number;
  reorderRate: number;
  reorderExtraDelayFrames: number;
  duplicateRate: number;
  sendIntervalFrames: number;
  retryIntervalFrames: number;
  maxBatchFrames: number;
  maxDrainFrames: number;
  maxHistoryFrames: number;
}

export interface RollbackSoakThresholds {
  requireCanonicalConvergence: boolean;
  maxUnrecoveredFrames: number;
  maxRollbackDepthFrames: number;
  maxP95RollbackDepthFrames: number;
  maxFrameRecoveryAgeFrames: number;
}

export interface RollbackDepthSummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface ImpairedLinkReport {
  direction: 'P1_to_P2' | 'P2_to_P1';
  packetAttempts: number;
  deliveredPackets: number;
  droppedPackets: number;
  reorderedPackets: number;
  duplicatePackets: number;
  duplicateFrames: number;
  deliveredFrames: number;
  retriedFrames: number;
  unrecoveredFrames: number;
  maxFrameRecoveryAgeFrames: number;
}

export interface RollbackClientSoakReport {
  localPlayerId: PlayerId;
  checksum: number;
  predictedAdvanceFrames: number;
  correctionEvents: number;
  rollbackDepthFrames: RollbackDepthSummary;
  diagnostics: RollbackDiagnosticsSnapshot;
}

export interface RollbackNetworkSoakReport {
  schema: 'gw.rollback-network-soak.v1';
  generatedAt: string;
  profile: NetworkImpairmentProfile;
  thresholds: RollbackSoakThresholds;
  canonicalChecksum: number;
  clients: {
    P1: RollbackClientSoakReport;
    P2: RollbackClientSoakReport;
  };
  links: {
    P1_to_P2: ImpairedLinkReport;
    P2_to_P1: ImpairedLinkReport;
  };
  drainFramesUsed: number;
  pendingRemoteFrames: number;
  canonicalConvergence: boolean;
  passed: boolean;
  failures: string[];
}

export const DEFAULT_LOCAL_ALPHA_PROFILE: NetworkImpairmentProfile = {
  id: 'local-alpha-adverse-v1',
  frames: 3_600,
  seed: 20_260_713,
  fixedDt: 1 / 60,
  baseLatencyFrames: 6,
  jitterFrames: 4,
  packetLossRate: 0.05,
  reorderRate: 0.12,
  reorderExtraDelayFrames: 10,
  duplicateRate: 0.02,
  sendIntervalFrames: 3,
  retryIntervalFrames: 8,
  maxBatchFrames: 12,
  maxDrainFrames: 600,
  maxHistoryFrames: 600,
};

export const DEFAULT_LOCAL_ALPHA_THRESHOLDS: RollbackSoakThresholds = {
  requireCanonicalConvergence: true,
  maxUnrecoveredFrames: 0,
  maxRollbackDepthFrames: 45,
  maxP95RollbackDepthFrames: 24,
  maxFrameRecoveryAgeFrames: 90,
};

interface QueuedFrame {
  frame: number;
  input: PlayerFrameInput;
  firstQueuedAt: number;
  lastAttemptAt: number | null;
  attempts: number;
}

interface ScheduledPacket {
  sequence: number;
  deliverAt: number;
  duplicate: boolean;
  entries: Array<{ frame: number; input: PlayerFrameInput }>;
}

interface MutableLinkStats {
  packetAttempts: number;
  deliveredPackets: number;
  droppedPackets: number;
  reorderedPackets: number;
  duplicatePackets: number;
  duplicateFrames: number;
  deliveredFrames: number;
  retriedFrames: number;
  maxFrameRecoveryAgeFrames: number;
}

interface ClientRuntime {
  session: RollbackSession;
  pendingRemoteInputs: Map<number, PlayerFrameInput>;
  rollbackDepths: number[];
  predictedAdvanceFrames: number;
  correctionEvents: number;
}

function cloneInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    moveX: input.moveX,
    moveY: input.moveY,
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

function clampProbability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1. Received: ${value}`);
  }
  return value;
}

function validateNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer. Received: ${value}`);
  }
  return value;
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer. Received: ${value}`);
  }
  return value;
}

function validateProfile(profile: NetworkImpairmentProfile): NetworkImpairmentProfile {
  return {
    ...profile,
    frames: validatePositiveInteger(profile.frames, 'frames'),
    seed: validatePositiveInteger(profile.seed, 'seed'),
    fixedDt: Number.isFinite(profile.fixedDt) && profile.fixedDt > 0
      ? profile.fixedDt
      : (() => { throw new Error(`fixedDt must be positive. Received: ${profile.fixedDt}`); })(),
    baseLatencyFrames: validateNonNegativeInteger(profile.baseLatencyFrames, 'baseLatencyFrames'),
    jitterFrames: validateNonNegativeInteger(profile.jitterFrames, 'jitterFrames'),
    packetLossRate: clampProbability(profile.packetLossRate, 'packetLossRate'),
    reorderRate: clampProbability(profile.reorderRate, 'reorderRate'),
    reorderExtraDelayFrames: validateNonNegativeInteger(
      profile.reorderExtraDelayFrames,
      'reorderExtraDelayFrames',
    ),
    duplicateRate: clampProbability(profile.duplicateRate, 'duplicateRate'),
    sendIntervalFrames: validatePositiveInteger(profile.sendIntervalFrames, 'sendIntervalFrames'),
    retryIntervalFrames: validatePositiveInteger(profile.retryIntervalFrames, 'retryIntervalFrames'),
    maxBatchFrames: validatePositiveInteger(profile.maxBatchFrames, 'maxBatchFrames'),
    maxDrainFrames: validatePositiveInteger(profile.maxDrainFrames, 'maxDrainFrames'),
    maxHistoryFrames: validatePositiveInteger(profile.maxHistoryFrames, 'maxHistoryFrames'),
  };
}

class DeterministicRng {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  public nextUnit(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  public nextInteger(minInclusive: number, maxInclusive: number): number {
    const width = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(this.nextUnit() * width);
  }

  public chance(probability: number): boolean {
    return this.nextUnit() < probability;
  }
}

class ReliableImpairedLink {
  private readonly rng: DeterministicRng;

  private readonly outbox = new Map<number, QueuedFrame>();

  private readonly scheduledPackets: ScheduledPacket[] = [];

  private nextSequence = 1;

  private highestDeliveredSequence = 0;

  private readonly stats: MutableLinkStats = {
    packetAttempts: 0,
    deliveredPackets: 0,
    droppedPackets: 0,
    reorderedPackets: 0,
    duplicatePackets: 0,
    duplicateFrames: 0,
    deliveredFrames: 0,
    retriedFrames: 0,
    maxFrameRecoveryAgeFrames: 0,
  };

  public constructor(
    private readonly direction: ImpairedLinkReport['direction'],
    private readonly profile: NetworkImpairmentProfile,
    seed: number,
  ) {
    this.rng = new DeterministicRng(seed);
  }

  public enqueue(frame: number, input: PlayerFrameInput, nowFrame: number): void {
    if (this.outbox.has(frame)) {
      return;
    }
    this.outbox.set(frame, {
      frame,
      input: cloneInput(input),
      firstQueuedAt: nowFrame,
      lastAttemptAt: null,
      attempts: 0,
    });
  }

  public tick(
    nowFrame: number,
    receive: (entries: Array<{ frame: number; input: PlayerFrameInput }>) => void,
  ): void {
    if (nowFrame % this.profile.sendIntervalFrames === 0) {
      this.attemptSend(nowFrame);
    }
    this.deliverDuePackets(nowFrame, receive);
  }

  public getUnrecoveredFrameCount(): number {
    return this.outbox.size;
  }

  public getReport(): ImpairedLinkReport {
    return {
      direction: this.direction,
      ...this.stats,
      unrecoveredFrames: this.outbox.size,
    };
  }

  private attemptSend(nowFrame: number): void {
    const candidates = [...this.outbox.values()]
      .filter((entry) => (
        entry.lastAttemptAt === null
        || nowFrame - entry.lastAttemptAt >= this.profile.retryIntervalFrames
      ))
      .sort((a, b) => a.frame - b.frame)
      .slice(0, this.profile.maxBatchFrames);
    if (candidates.length === 0) {
      return;
    }

    this.stats.packetAttempts += 1;
    for (const entry of candidates) {
      if (entry.attempts > 0) {
        this.stats.retriedFrames += 1;
      }
      entry.attempts += 1;
      entry.lastAttemptAt = nowFrame;
    }

    if (this.rng.chance(this.profile.packetLossRate)) {
      this.stats.droppedPackets += 1;
      return;
    }

    const sequence = this.nextSequence++;
    const jitter = this.profile.jitterFrames === 0
      ? 0
      : this.rng.nextInteger(-this.profile.jitterFrames, this.profile.jitterFrames);
    const reorderDelay = this.rng.chance(this.profile.reorderRate)
      ? this.profile.reorderExtraDelayFrames
      : 0;
    const deliverAt = nowFrame + Math.max(0, this.profile.baseLatencyFrames + jitter + reorderDelay);
    const entries = candidates.map((entry) => ({ frame: entry.frame, input: cloneInput(entry.input) }));
    this.scheduledPackets.push({ sequence, deliverAt, duplicate: false, entries });

    if (this.rng.chance(this.profile.duplicateRate)) {
      this.stats.duplicatePackets += 1;
      this.scheduledPackets.push({
        sequence,
        deliverAt: deliverAt + 1 + this.rng.nextInteger(0, Math.max(1, this.profile.jitterFrames)),
        duplicate: true,
        entries: entries.map((entry) => ({ frame: entry.frame, input: cloneInput(entry.input) })),
      });
    }
  }

  private deliverDuePackets(
    nowFrame: number,
    receive: (entries: Array<{ frame: number; input: PlayerFrameInput }>) => void,
  ): void {
    const due = this.scheduledPackets
      .filter((packet) => packet.deliverAt <= nowFrame)
      .sort((a, b) => a.deliverAt - b.deliverAt || a.sequence - b.sequence);
    if (due.length === 0) {
      return;
    }
    const dueSet = new Set(due);
    for (let index = this.scheduledPackets.length - 1; index >= 0; index -= 1) {
      if (dueSet.has(this.scheduledPackets[index])) {
        this.scheduledPackets.splice(index, 1);
      }
    }

    for (const packet of due) {
      this.stats.deliveredPackets += 1;
      if (packet.sequence < this.highestDeliveredSequence) {
        this.stats.reorderedPackets += 1;
      }
      this.highestDeliveredSequence = Math.max(this.highestDeliveredSequence, packet.sequence);

      for (const entry of packet.entries) {
        const queued = this.outbox.get(entry.frame);
        if (!queued) {
          this.stats.duplicateFrames += 1;
          continue;
        }
        this.outbox.delete(entry.frame);
        this.stats.deliveredFrames += 1;
        this.stats.maxFrameRecoveryAgeFrames = Math.max(
          this.stats.maxFrameRecoveryAgeFrames,
          nowFrame - queued.firstQueuedAt,
        );
      }
      receive(packet.entries.map((entry) => ({ frame: entry.frame, input: cloneInput(entry.input) })));
    }
  }
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

export function createDeterministicSoakInput(
  seed: number,
  frame: number,
  playerId: PlayerId,
): PlayerFrameInput {
  const playerSalt = playerId === 'P1' ? 0x9e3779b9 : 0x85ebca6b;
  const movementPhase = Math.floor(frame / 18);
  const movementHash = mix32(seed ^ playerSalt ^ Math.imul(movementPhase + 1, 0x27d4eb2d));
  const directionIndex = movementHash % 9;
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [0, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const;
  const direction = directions[directionIndex] ?? directions[4];
  const offset = playerId === 'P1' ? 0 : 17;

  return {
    moveX: direction[0],
    moveY: direction[1],
    boost: (frame + offset) % 73 >= 51 && (frame + offset) % 73 < 61,
    superBoost: (frame + offset) % 137 === 19,
    special: (frame + offset) % 109 === 31,
    launch: (frame + offset) % 83 === 11,
    dunk: (frame + offset) % 149 === 47,
    parry: (frame + offset) % 67 === 23,
    breakLaunch: (frame + offset) % 127 === 53,
  };
}

function createSoakInitialState(seed: number): GameState {
  return createInitialState({
    seed,
    loadout: { P1: 'vanguard', P2: 'duelist' },
    rules: { allowDunkWin: false },
  });
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(ordered.length * quantile) - 1);
  return ordered[Math.min(index, ordered.length - 1)] ?? 0;
}

function summariseDepths(values: readonly number[]): RollbackDepthSummary {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

function receiveEntries(
  pending: Map<number, PlayerFrameInput>,
  entries: Array<{ frame: number; input: PlayerFrameInput }>,
): void {
  for (const entry of entries) {
    pending.set(entry.frame, cloneInput(entry.input));
  }
}

function applyReadyRemoteInputs(runtime: ClientRuntime, throughFrame: number): void {
  const result = applyPendingRemoteInputs(
    runtime.pendingRemoteInputs,
    runtime.session,
    throughFrame,
  );
  if (result.rollbackFrames > 0) {
    runtime.rollbackDepths.push(result.rollbackFrames);
  }
  runtime.correctionEvents += runtime.session.drainPendingCorrectionEvents().length;
}

function createClientRuntime(
  initialState: GameState,
  localPlayerId: PlayerId,
  profile: NetworkImpairmentProfile,
): ClientRuntime {
  return {
    session: new RollbackSession({
      initialState,
      localPlayerId,
      fixedDt: profile.fixedDt,
      maxHistoryFrames: profile.maxHistoryFrames,
    }),
    pendingRemoteInputs: new Map<number, PlayerFrameInput>(),
    rollbackDepths: [],
    predictedAdvanceFrames: 0,
    correctionEvents: 0,
  };
}

function buildClientReport(localPlayerId: PlayerId, runtime: ClientRuntime): RollbackClientSoakReport {
  return {
    localPlayerId,
    checksum: computeStateChecksum(runtime.session.getStateSnapshot()),
    predictedAdvanceFrames: runtime.predictedAdvanceFrames,
    correctionEvents: runtime.correctionEvents,
    rollbackDepthFrames: summariseDepths(runtime.rollbackDepths),
    diagnostics: runtime.session.getDiagnosticsSnapshot(),
  };
}

function evaluateReport(
  report: Omit<RollbackNetworkSoakReport, 'passed' | 'failures'>,
): string[] {
  const failures: string[] = [];
  const unrecoveredFrames = report.links.P1_to_P2.unrecoveredFrames
    + report.links.P2_to_P1.unrecoveredFrames
    + report.pendingRemoteFrames;
  if (report.thresholds.requireCanonicalConvergence && !report.canonicalConvergence) {
    failures.push('Both clients must converge to the canonical simulation checksum.');
  }
  if (unrecoveredFrames > report.thresholds.maxUnrecoveredFrames) {
    failures.push(
      `Unrecovered frame count ${unrecoveredFrames} exceeds ${report.thresholds.maxUnrecoveredFrames}.`,
    );
  }
  for (const client of [report.clients.P1, report.clients.P2]) {
    if (client.rollbackDepthFrames.max > report.thresholds.maxRollbackDepthFrames) {
      failures.push(
        `${client.localPlayerId} max rollback depth ${client.rollbackDepthFrames.max} exceeds ${report.thresholds.maxRollbackDepthFrames}.`,
      );
    }
    if (client.rollbackDepthFrames.p95 > report.thresholds.maxP95RollbackDepthFrames) {
      failures.push(
        `${client.localPlayerId} p95 rollback depth ${client.rollbackDepthFrames.p95} exceeds ${report.thresholds.maxP95RollbackDepthFrames}.`,
      );
    }
  }
  for (const link of [report.links.P1_to_P2, report.links.P2_to_P1]) {
    if (link.maxFrameRecoveryAgeFrames > report.thresholds.maxFrameRecoveryAgeFrames) {
      failures.push(
        `${link.direction} max frame recovery age ${link.maxFrameRecoveryAgeFrames} exceeds ${report.thresholds.maxFrameRecoveryAgeFrames}.`,
      );
    }
  }
  return failures;
}

export function runRollbackNetworkSoak(options?: {
  profile?: Partial<NetworkImpairmentProfile>;
  thresholds?: Partial<RollbackSoakThresholds>;
  generatedAt?: string;
}): RollbackNetworkSoakReport {
  const profile = validateProfile({
    ...DEFAULT_LOCAL_ALPHA_PROFILE,
    ...options?.profile,
  });
  const thresholds: RollbackSoakThresholds = {
    ...DEFAULT_LOCAL_ALPHA_THRESHOLDS,
    ...options?.thresholds,
  };

  const canonicalState = createSoakInitialState(profile.seed);
  const p1Runtime = createClientRuntime(createSoakInitialState(profile.seed), 'P1', profile);
  const p2Runtime = createClientRuntime(createSoakInitialState(profile.seed), 'P2', profile);
  const p1ToP2 = new ReliableImpairedLink('P1_to_P2', profile, profile.seed ^ 0xa341316c);
  const p2ToP1 = new ReliableImpairedLink('P2_to_P1', profile, profile.seed ^ 0xc8013ea4);

  for (let frame = 0; frame < profile.frames; frame += 1) {
    const p1Input = createDeterministicSoakInput(profile.seed, frame, 'P1');
    const p2Input = createDeterministicSoakInput(profile.seed, frame, 'P2');
    const canonicalInput: FrameInput = { p1: cloneInput(p1Input), p2: cloneInput(p2Input) };

    p1ToP2.enqueue(frame, p1Input, frame);
    p2ToP1.enqueue(frame, p2Input, frame);
    p1ToP2.tick(frame, (entries) => receiveEntries(p2Runtime.pendingRemoteInputs, entries));
    p2ToP1.tick(frame, (entries) => receiveEntries(p1Runtime.pendingRemoteInputs, entries));

    applyReadyRemoteInputs(p1Runtime, frame);
    applyReadyRemoteInputs(p2Runtime, frame);
    const p1Advance = p1Runtime.session.advanceFrame({ localInput: p1Input });
    const p2Advance = p2Runtime.session.advanceFrame({ localInput: p2Input });
    if (p1Advance.usedPrediction) {
      p1Runtime.predictedAdvanceFrames += 1;
    }
    if (p2Advance.usedPrediction) {
      p2Runtime.predictedAdvanceFrames += 1;
    }
    step(canonicalState, canonicalInput, profile.fixedDt);
  }

  let drainFramesUsed = 0;
  for (let offset = 0; offset < profile.maxDrainFrames; offset += 1) {
    const networkFrame = profile.frames + offset;
    p1ToP2.tick(networkFrame, (entries) => receiveEntries(p2Runtime.pendingRemoteInputs, entries));
    p2ToP1.tick(networkFrame, (entries) => receiveEntries(p1Runtime.pendingRemoteInputs, entries));
    applyReadyRemoteInputs(p1Runtime, profile.frames - 1);
    applyReadyRemoteInputs(p2Runtime, profile.frames - 1);
    drainFramesUsed = offset + 1;
    if (
      p1ToP2.getUnrecoveredFrameCount() === 0
      && p2ToP1.getUnrecoveredFrameCount() === 0
      && p1Runtime.pendingRemoteInputs.size === 0
      && p2Runtime.pendingRemoteInputs.size === 0
    ) {
      break;
    }
  }

  const p1Report = buildClientReport('P1', p1Runtime);
  const p2Report = buildClientReport('P2', p2Runtime);
  const canonicalChecksum = computeStateChecksum(canonicalState);
  const partialReport: Omit<RollbackNetworkSoakReport, 'passed' | 'failures'> = {
    schema: 'gw.rollback-network-soak.v1',
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    profile,
    thresholds,
    canonicalChecksum,
    clients: { P1: p1Report, P2: p2Report },
    links: {
      P1_to_P2: p1ToP2.getReport(),
      P2_to_P1: p2ToP1.getReport(),
    },
    drainFramesUsed,
    pendingRemoteFrames: p1Runtime.pendingRemoteInputs.size + p2Runtime.pendingRemoteInputs.size,
    canonicalConvergence: p1Report.checksum === canonicalChecksum
      && p2Report.checksum === canonicalChecksum,
  };
  const failures = evaluateReport(partialReport);
  return {
    ...partialReport,
    passed: failures.length === 0,
    failures,
  };
}
