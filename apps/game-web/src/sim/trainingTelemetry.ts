import {
  resolveCharacterRulesFingerprint,
} from './characterBalance';
import {
  CHARACTER_PACKAGE_VERSION_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
} from './characters';
import { fingerprintDeterministicValue } from './fingerprint';
import { fingerprintGameTuning } from './tuning';
import type { FrameInput, GameState, PlayerId } from './types';

const LEGACY_TRAINING_TELEMETRY_SCHEMA_VERSION = 'gw.training-telemetry.v2';
const LEGACY_UNATTRIBUTED_IDENTITY = 'legacy-unattributed';

export const TRAINING_TELEMETRY_SCHEMA_VERSION = 'gw.training-telemetry.v3';

export type TrainingRoundEndReason = 'manual_restart' | 'round_win' | 'mode_exit';

export interface TrainingTelemetryScenarioIdentity {
  fingerprint: string;
  label: string;
  sampleId: string;
  descriptor?: Record<string, unknown>;
}

export interface TrainingTelemetryTrackerOptions {
  balanceProfileId: string;
  rulesetVersion: string;
  playerCharacterId: string;
  opponentCharacterId: string;
  scenarioIdentity?: TrainingTelemetryScenarioIdentity | null;
}

export interface TrainingTelemetryCharacterIdentity {
  characterId: string;
  packageVersion: string;
}

export interface TrainingTelemetryRunIdentity {
  balanceProfileId: string;
  rulesetVersion: string;
  tuningFingerprint: string;
  scenario: TrainingTelemetryScenarioIdentity | null;
  characterRegistryFingerprint: string;
  characterRulesFingerprint: string;
  characters: {
    player: TrainingTelemetryCharacterIdentity;
    opponent: TrainingTelemetryCharacterIdentity;
  };
}

export interface TrainingTelemetryMetrics {
  roundsStarted: number;
  roundsCompleted: number;
  roundsWon: number;
  manualRestarts: number;
  modeExits: number;
  totalRoundSeconds: number;
  averageRoundSeconds: number;
  framesSimulated: number;
  input: {
    launchPresses: number;
    specialPresses: number;
    dunkPresses: number;
    parryPresses: number;
    boostFrames: number;
    superBoostFrames: number;
  };
  outcomes: {
    launchHits: number;
    dunkHits: number;
    specialResolves: number;
    launchHitRate: number;
    dunkHitRate: number;
    specialResolveRate: number;
  };
  resources: {
    fuelLost: number;
    fuelRestored: number;
  };
  peaks: {
    maxChain: number;
  };
}

export interface TrainingTelemetryRunSummary extends TrainingTelemetryMetrics {
  runId: string;
  startedAt: string;
  identity: TrainingTelemetryRunIdentity;
}

export interface TrainingTelemetrySummary extends TrainingTelemetryMetrics {
  schemaVersion: typeof TRAINING_TELEMETRY_SCHEMA_VERSION;
  sessionId: string;
  startedAt: string;
  exportedAt: string;
  runId: string | null;
  runIdentity: TrainingTelemetryRunIdentity | null;
  runs: TrainingTelemetryRunSummary[];
  balanceProfileId: string;
  rulesetVersion: string;
  playerCharacterId: string;
  opponentCharacterId: string;
}

interface TrackedInputState {
  launch: boolean;
  special: boolean;
  dunk: boolean;
  parry: boolean;
}

interface TrackedPlayerState {
  fuel: number;
  helpless: number;
  lastLaunchedBy: PlayerId | null;
  dunkDidConnect: boolean;
  specialDidResolve: boolean;
  chain: number;
}

interface TrackedState {
  p1: TrackedPlayerState;
  p2: TrackedPlayerState;
}

let trainingTelemetrySessionCounter = 0;

function toTrackedState(state: GameState): TrackedState {
  return {
    p1: {
      fuel: state.players.P1.fuel,
      helpless: state.players.P1.helpless,
      lastLaunchedBy: state.players.P1.lastLaunchedBy,
      dunkDidConnect: state.players.P1.dunkDidConnect,
      specialDidResolve: state.players.P1.specialDidResolve,
      chain: state.players.P1.chain,
    },
    p2: {
      fuel: state.players.P2.fuel,
      helpless: state.players.P2.helpless,
      lastLaunchedBy: state.players.P2.lastLaunchedBy,
      dunkDidConnect: state.players.P2.dunkDidConnect,
      specialDidResolve: state.players.P2.specialDidResolve,
      chain: state.players.P2.chain,
    },
  };
}

function createSessionId(): string {
  const counter = (trainingTelemetrySessionCounter += 1).toString(36).padStart(2, '0');
  return `training-${Date.now().toString(36)}-${counter}`;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function cloneScenarioIdentity(
  scenario: TrainingTelemetryScenarioIdentity | null | undefined,
): TrainingTelemetryScenarioIdentity | null {
  if (!scenario) {
    return null;
  }
  return {
    fingerprint: scenario.fingerprint,
    label: scenario.label,
    sampleId: scenario.sampleId,
    ...(scenario.descriptor ? { descriptor: structuredClone(scenario.descriptor) } : {}),
  };
}

function cloneRunIdentity(identity: TrainingTelemetryRunIdentity): TrainingTelemetryRunIdentity {
  return {
    ...identity,
    scenario: cloneScenarioIdentity(identity.scenario),
    characters: {
      player: { ...identity.characters.player },
      opponent: { ...identity.characters.opponent },
    },
  };
}

function emptyMetrics(): TrainingTelemetryMetrics {
  return {
    roundsStarted: 0,
    roundsCompleted: 0,
    roundsWon: 0,
    manualRestarts: 0,
    modeExits: 0,
    totalRoundSeconds: 0,
    averageRoundSeconds: 0,
    framesSimulated: 0,
    input: {
      launchPresses: 0,
      specialPresses: 0,
      dunkPresses: 0,
      parryPresses: 0,
      boostFrames: 0,
      superBoostFrames: 0,
    },
    outcomes: {
      launchHits: 0,
      dunkHits: 0,
      specialResolves: 0,
      launchHitRate: 0,
      dunkHitRate: 0,
      specialResolveRate: 0,
    },
    resources: {
      fuelLost: 0,
      fuelRestored: 0,
    },
    peaks: {
      maxChain: 0,
    },
  };
}

function cloneMetrics(metrics: TrainingTelemetryMetrics): TrainingTelemetryMetrics {
  return {
    ...metrics,
    input: { ...metrics.input },
    outcomes: { ...metrics.outcomes },
    resources: { ...metrics.resources },
    peaks: { ...metrics.peaks },
  };
}

export class TrainingTelemetryIdentityChangedError extends Error {
  public readonly expected: TrainingTelemetryRunIdentity;
  public readonly actual: TrainingTelemetryRunIdentity;

  public constructor(
    expected: TrainingTelemetryRunIdentity,
    actual: TrainingTelemetryRunIdentity,
  ) {
    super('Training telemetry run identity changed during an active round. Restart the round before recording the new configuration.');
    this.name = 'TrainingTelemetryIdentityChangedError';
    this.expected = cloneRunIdentity(expected);
    this.actual = cloneRunIdentity(actual);
  }
}

export class TrainingTelemetryTracker {
  private readonly sessionId: string;
  private readonly startedAt: string;
  private balanceProfileId: string;
  private rulesetVersion: string;
  private playerCharacterId: string;
  private opponentCharacterId: string;
  private scenarioIdentity: TrainingTelemetryScenarioIdentity | null;

  private readonly completedRuns: TrainingTelemetryRunSummary[] = [];
  private currentRunId: string | null = null;
  private currentRunStartedAt: string | null = null;
  private currentRunIdentity: TrainingTelemetryRunIdentity | null = null;
  private currentRunIdentityFingerprint: string | null = null;
  private runSequence = 0;

  private roundsStarted = 0;
  private roundsCompleted = 0;
  private roundsWon = 0;
  private manualRestarts = 0;
  private modeExits = 0;
  private totalRoundSeconds = 0;
  private currentRoundSeconds = 0;
  private framesSimulated = 0;

  private launchPresses = 0;
  private specialPresses = 0;
  private dunkPresses = 0;
  private parryPresses = 0;
  private boostFrames = 0;
  private superBoostFrames = 0;

  private launchHits = 0;
  private dunkHits = 0;
  private specialResolves = 0;
  private fuelLost = 0;
  private fuelRestored = 0;
  private maxChain = 0;

  private roundActive = false;
  private previousInput: TrackedInputState | null = null;
  private previousState: TrackedState | null = null;

  public constructor(options: TrainingTelemetryTrackerOptions) {
    this.sessionId = createSessionId();
    this.startedAt = new Date().toISOString();
    this.balanceProfileId = options.balanceProfileId;
    this.rulesetVersion = options.rulesetVersion;
    this.playerCharacterId = options.playerCharacterId;
    this.opponentCharacterId = options.opponentCharacterId;
    this.scenarioIdentity = cloneScenarioIdentity(options.scenarioIdentity);
  }

  public updateMetadata(options: Partial<TrainingTelemetryTrackerOptions>): void {
    if (options.balanceProfileId !== undefined) {
      this.balanceProfileId = options.balanceProfileId;
    }
    if (options.rulesetVersion !== undefined) {
      this.rulesetVersion = options.rulesetVersion;
    }
    if (options.playerCharacterId !== undefined) {
      this.playerCharacterId = options.playerCharacterId;
    }
    if (options.opponentCharacterId !== undefined) {
      this.opponentCharacterId = options.opponentCharacterId;
    }
    if (options.scenarioIdentity !== undefined) {
      this.scenarioIdentity = cloneScenarioIdentity(options.scenarioIdentity);
    }
  }

  public startRound(state: GameState): void {
    if (this.roundActive) {
      throw new Error('Cannot start a training telemetry round while another round is active.');
    }

    const identity = this.buildRunIdentity(state, {
      balanceProfileId: this.balanceProfileId,
      rulesetVersion: this.rulesetVersion,
      scenario: this.scenarioIdentity,
    });
    const identityFingerprint = fingerprintDeterministicValue(identity);
    if (identityFingerprint !== this.currentRunIdentityFingerprint) {
      this.archiveCurrentRun();
      this.resetRunMetrics();
      this.runSequence += 1;
      this.currentRunId = `${this.sessionId}-run-${this.runSequence.toString().padStart(2, '0')}`;
      this.currentRunStartedAt = new Date().toISOString();
      this.currentRunIdentity = identity;
      this.currentRunIdentityFingerprint = identityFingerprint;
    }

    this.roundsStarted += 1;
    this.currentRoundSeconds = 0;
    this.roundActive = true;
    this.previousInput = null;
    this.previousState = toTrackedState(state);
    this.maxChain = Math.max(this.maxChain, state.players.P1.chain);
  }

  public recordFrame(frameInput: FrameInput, state: GameState, dt: number): void {
    if (!this.roundActive || !this.currentRunIdentity) {
      return;
    }

    const actualIdentity = this.buildRunIdentity(state, {
      balanceProfileId: this.currentRunIdentity.balanceProfileId,
      rulesetVersion: this.currentRunIdentity.rulesetVersion,
      scenario: this.currentRunIdentity.scenario,
    });
    if (fingerprintDeterministicValue(actualIdentity) !== this.currentRunIdentityFingerprint) {
      throw new TrainingTelemetryIdentityChangedError(this.currentRunIdentity, actualIdentity);
    }

    this.framesSimulated += 1;
    this.currentRoundSeconds += Math.max(0, dt);

    const currentInput: TrackedInputState = {
      launch: frameInput.p1.launch,
      special: frameInput.p1.special,
      dunk: frameInput.p1.dunk,
      parry: frameInput.p1.parry,
    };
    const previousInput = this.previousInput;
    if (currentInput.launch && (!previousInput || !previousInput.launch)) {
      this.launchPresses += 1;
    }
    if (currentInput.special && (!previousInput || !previousInput.special)) {
      this.specialPresses += 1;
    }
    if (currentInput.dunk && (!previousInput || !previousInput.dunk)) {
      this.dunkPresses += 1;
    }
    if (currentInput.parry && (!previousInput || !previousInput.parry)) {
      this.parryPresses += 1;
    }
    this.previousInput = currentInput;

    if (frameInput.p1.boost) {
      this.boostFrames += 1;
    }
    if (frameInput.p1.superBoost) {
      this.superBoostFrames += 1;
    }

    const currentState = toTrackedState(state);
    const previousState = this.previousState;
    if (previousState) {
      const fuelDelta = previousState.p1.fuel - currentState.p1.fuel;
      if (fuelDelta > 0) {
        this.fuelLost += fuelDelta;
      } else if (fuelDelta < 0) {
        this.fuelRestored += -fuelDelta;
      }
      if (
        currentState.p1.chain > previousState.p1.chain
        && currentState.p2.lastLaunchedBy === 'P1'
      ) {
        this.launchHits += 1;
      }
      if (!previousState.p1.dunkDidConnect && currentState.p1.dunkDidConnect) {
        this.dunkHits += 1;
      }
      if (!previousState.p1.specialDidResolve && currentState.p1.specialDidResolve) {
        this.specialResolves += 1;
      }
    }

    this.maxChain = Math.max(this.maxChain, currentState.p1.chain);
    this.previousState = currentState;
  }

  public endRound(reason: TrainingRoundEndReason): void {
    if (!this.roundActive) {
      return;
    }
    this.roundActive = false;
    this.roundsCompleted += 1;
    this.totalRoundSeconds += this.currentRoundSeconds;
    this.currentRoundSeconds = 0;
    if (reason === 'round_win') {
      this.roundsWon += 1;
    } else if (reason === 'manual_restart') {
      this.manualRestarts += 1;
    } else if (reason === 'mode_exit') {
      this.modeExits += 1;
    }
    this.previousInput = null;
    this.previousState = null;
  }

  public toSummary(nowIso = new Date().toISOString()): TrainingTelemetrySummary {
    const currentRun = this.buildCurrentRunSummary();
    const runs = [
      ...this.completedRuns.map(cloneRunSummary),
      ...(currentRun ? [currentRun] : []),
    ];
    const latestRun = runs.at(-1) ?? null;
    const metrics = latestRun ? cloneMetrics(latestRun) : emptyMetrics();
    const identity = latestRun ? cloneRunIdentity(latestRun.identity) : null;

    return {
      schemaVersion: TRAINING_TELEMETRY_SCHEMA_VERSION,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      exportedAt: nowIso,
      runId: latestRun?.runId ?? null,
      runIdentity: identity,
      runs,
      balanceProfileId: identity?.balanceProfileId ?? this.balanceProfileId,
      rulesetVersion: identity?.rulesetVersion ?? this.rulesetVersion,
      playerCharacterId: identity?.characters.player.characterId ?? this.playerCharacterId,
      opponentCharacterId: identity?.characters.opponent.characterId ?? this.opponentCharacterId,
      ...metrics,
    };
  }

  private buildRunIdentity(
    state: GameState,
    metadata: {
      balanceProfileId: string;
      rulesetVersion: string;
      scenario: TrainingTelemetryScenarioIdentity | null;
    },
  ): TrainingTelemetryRunIdentity {
    const playerCharacterId = state.players.P1.characterId;
    const opponentCharacterId = state.players.P2.characterId;
    return {
      balanceProfileId: metadata.balanceProfileId,
      rulesetVersion: metadata.rulesetVersion,
      tuningFingerprint: fingerprintGameTuning(state.tuning),
      scenario: cloneScenarioIdentity(metadata.scenario),
      characterRegistryFingerprint: CHARACTER_REGISTRY_FINGERPRINT,
      characterRulesFingerprint: resolveCharacterRulesFingerprint(
        CHARACTER_REGISTRY_FINGERPRINT,
        state.characterBalanceOverrides,
      ),
      characters: {
        player: {
          characterId: playerCharacterId,
          packageVersion: CHARACTER_PACKAGE_VERSION_BY_ID[playerCharacterId] ?? 'unknown',
        },
        opponent: {
          characterId: opponentCharacterId,
          packageVersion: CHARACTER_PACKAGE_VERSION_BY_ID[opponentCharacterId] ?? 'unknown',
        },
      },
    };
  }

  private buildMetrics(): TrainingTelemetryMetrics {
    const averageRoundSeconds = this.roundsCompleted > 0
      ? this.totalRoundSeconds / this.roundsCompleted
      : 0;
    return {
      roundsStarted: this.roundsStarted,
      roundsCompleted: this.roundsCompleted,
      roundsWon: this.roundsWon,
      manualRestarts: this.manualRestarts,
      modeExits: this.modeExits,
      totalRoundSeconds: round(this.totalRoundSeconds),
      averageRoundSeconds: round(averageRoundSeconds),
      framesSimulated: this.framesSimulated,
      input: {
        launchPresses: this.launchPresses,
        specialPresses: this.specialPresses,
        dunkPresses: this.dunkPresses,
        parryPresses: this.parryPresses,
        boostFrames: this.boostFrames,
        superBoostFrames: this.superBoostFrames,
      },
      outcomes: {
        launchHits: this.launchHits,
        dunkHits: this.dunkHits,
        specialResolves: this.specialResolves,
        launchHitRate: this.launchPresses > 0 ? round(this.launchHits / this.launchPresses) : 0,
        dunkHitRate: this.dunkPresses > 0 ? round(this.dunkHits / this.dunkPresses) : 0,
        specialResolveRate: this.specialPresses > 0 ? round(this.specialResolves / this.specialPresses) : 0,
      },
      resources: {
        fuelLost: round(this.fuelLost),
        fuelRestored: round(this.fuelRestored),
      },
      peaks: {
        maxChain: this.maxChain,
      },
    };
  }

  private buildCurrentRunSummary(): TrainingTelemetryRunSummary | null {
    if (!this.currentRunId || !this.currentRunStartedAt || !this.currentRunIdentity) {
      return null;
    }
    return {
      runId: this.currentRunId,
      startedAt: this.currentRunStartedAt,
      identity: cloneRunIdentity(this.currentRunIdentity),
      ...this.buildMetrics(),
    };
  }

  private archiveCurrentRun(): void {
    const currentRun = this.buildCurrentRunSummary();
    if (currentRun) {
      this.completedRuns.push(currentRun);
    }
  }

  private resetRunMetrics(): void {
    this.roundsStarted = 0;
    this.roundsCompleted = 0;
    this.roundsWon = 0;
    this.manualRestarts = 0;
    this.modeExits = 0;
    this.totalRoundSeconds = 0;
    this.currentRoundSeconds = 0;
    this.framesSimulated = 0;
    this.launchPresses = 0;
    this.specialPresses = 0;
    this.dunkPresses = 0;
    this.parryPresses = 0;
    this.boostFrames = 0;
    this.superBoostFrames = 0;
    this.launchHits = 0;
    this.dunkHits = 0;
    this.specialResolves = 0;
    this.fuelLost = 0;
    this.fuelRestored = 0;
    this.maxChain = 0;
    this.previousInput = null;
    this.previousState = null;
  }
}

function cloneRunSummary(run: TrainingTelemetryRunSummary): TrainingTelemetryRunSummary {
  return {
    runId: run.runId,
    startedAt: run.startedAt,
    identity: cloneRunIdentity(run.identity),
    ...cloneMetrics(run),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown> | null, key: string, fallback: string): string {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readNumber(record: Record<string, unknown> | null, key: string, fallback = 0): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseScenarioIdentity(value: unknown): TrainingTelemetryScenarioIdentity | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const fingerprint = readString(record, 'fingerprint', '');
  const label = readString(record, 'label', '');
  const sampleId = readString(record, 'sampleId', '');
  if (!fingerprint || !label || !sampleId) {
    return null;
  }
  const descriptor = asRecord(record.descriptor);
  return {
    fingerprint,
    label,
    sampleId,
    ...(descriptor ? { descriptor: structuredClone(descriptor) } : {}),
  };
}

function parseMetrics(value: unknown): TrainingTelemetryMetrics {
  const record = asRecord(value);
  const input = asRecord(record?.input);
  const outcomes = asRecord(record?.outcomes);
  const resources = asRecord(record?.resources);
  const peaks = asRecord(record?.peaks);
  const launchPresses = readNumber(input, 'launchPresses');
  const specialPresses = readNumber(input, 'specialPresses');
  const dunkPresses = readNumber(input, 'dunkPresses');
  const launchHits = readNumber(outcomes, 'launchHits');
  const dunkHits = readNumber(outcomes, 'dunkHits');
  const specialResolves = readNumber(outcomes, 'specialResolves');
  const roundsCompleted = readNumber(record, 'roundsCompleted');
  const totalRoundSeconds = readNumber(record, 'totalRoundSeconds');
  return {
    roundsStarted: readNumber(record, 'roundsStarted'),
    roundsCompleted,
    roundsWon: readNumber(record, 'roundsWon'),
    manualRestarts: readNumber(record, 'manualRestarts'),
    modeExits: readNumber(record, 'modeExits'),
    totalRoundSeconds,
    averageRoundSeconds: readNumber(
      record,
      'averageRoundSeconds',
      roundsCompleted > 0 ? round(totalRoundSeconds / roundsCompleted) : 0,
    ),
    framesSimulated: readNumber(record, 'framesSimulated'),
    input: {
      launchPresses,
      specialPresses,
      dunkPresses,
      parryPresses: readNumber(input, 'parryPresses'),
      boostFrames: readNumber(input, 'boostFrames'),
      superBoostFrames: readNumber(input, 'superBoostFrames'),
    },
    outcomes: {
      launchHits,
      dunkHits,
      specialResolves,
      launchHitRate: readNumber(
        outcomes,
        'launchHitRate',
        launchPresses > 0 ? round(launchHits / launchPresses) : 0,
      ),
      dunkHitRate: readNumber(
        outcomes,
        'dunkHitRate',
        dunkPresses > 0 ? round(dunkHits / dunkPresses) : 0,
      ),
      specialResolveRate: readNumber(
        outcomes,
        'specialResolveRate',
        specialPresses > 0 ? round(specialResolves / specialPresses) : 0,
      ),
    },
    resources: {
      fuelLost: readNumber(resources, 'fuelLost', readNumber(resources, 'fuelSpent')),
      fuelRestored: readNumber(resources, 'fuelRestored'),
    },
    peaks: {
      maxChain: readNumber(peaks, 'maxChain'),
    },
  };
}

function parseCharacterIdentity(
  value: unknown,
  fallbackCharacterId: string,
): TrainingTelemetryCharacterIdentity {
  const record = asRecord(value);
  return {
    characterId: readString(record, 'characterId', fallbackCharacterId),
    packageVersion: readString(record, 'packageVersion', 'unknown'),
  };
}

function parseRunIdentity(
  value: unknown,
  summary: Record<string, unknown>,
  envelope: Record<string, unknown>,
): TrainingTelemetryRunIdentity {
  const record = asRecord(value);
  const characters = asRecord(record?.characters);
  const playerCharacterId = readString(summary, 'playerCharacterId', 'unknown');
  const opponentCharacterId = readString(summary, 'opponentCharacterId', 'unknown');
  const legacyCharacterFingerprint = readString(envelope, 'characterBalanceFingerprint', '');
  return {
    balanceProfileId: readString(
      record,
      'balanceProfileId',
      readString(summary, 'balanceProfileId', 'unknown'),
    ),
    rulesetVersion: readString(
      record,
      'rulesetVersion',
      readString(summary, 'rulesetVersion', 'unknown'),
    ),
    tuningFingerprint: readString(
      record,
      'tuningFingerprint',
      readString(summary, 'tuningFingerprint', readString(envelope, 'tuningFingerprint', LEGACY_UNATTRIBUTED_IDENTITY)),
    ),
    scenario: parseScenarioIdentity(record?.scenario ?? summary.scenario ?? envelope.scenario),
    characterRegistryFingerprint: readString(
      record,
      'characterRegistryFingerprint',
      LEGACY_UNATTRIBUTED_IDENTITY,
    ),
    characterRulesFingerprint: readString(
      record,
      'characterRulesFingerprint',
      legacyCharacterFingerprint
        ? `legacy:${legacyCharacterFingerprint}`
        : LEGACY_UNATTRIBUTED_IDENTITY,
    ),
    characters: {
      player: parseCharacterIdentity(characters?.player, playerCharacterId),
      opponent: parseCharacterIdentity(characters?.opponent, opponentCharacterId),
    },
  };
}

function parseRunSummary(
  value: unknown,
  index: number,
  summary: Record<string, unknown>,
  envelope: Record<string, unknown>,
  sessionId: string,
  sessionStartedAt: string,
): TrainingTelemetryRunSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    runId: readString(record, 'runId', `${sessionId}-run-${(index + 1).toString().padStart(2, '0')}`),
    startedAt: readString(record, 'startedAt', sessionStartedAt),
    identity: parseRunIdentity(record.identity, summary, envelope),
    ...parseMetrics(record),
  };
}

/**
 * Normalises direct summaries and persisted export envelopes from v1/v2 into v3.
 * Legacy package identity stays explicitly unattributed rather than inheriting the
 * currently installed character package versions.
 */
export function parseTrainingTelemetrySummary(input: unknown): TrainingTelemetrySummary {
  const envelope = asRecord(input);
  if (!envelope) {
    throw new TypeError('Training telemetry must be an object.');
  }
  const nestedSummary = asRecord(envelope.summary);
  const summary = nestedSummary ?? envelope;
  const schemaVersion = summary.schemaVersion;
  const isCurrent = schemaVersion === TRAINING_TELEMETRY_SCHEMA_VERSION;
  const isLegacy = schemaVersion === undefined
    || schemaVersion === LEGACY_TRAINING_TELEMETRY_SCHEMA_VERSION;
  if (!isCurrent && !isLegacy) {
    throw new TypeError(`Unsupported training telemetry schema version: ${String(schemaVersion)}.`);
  }

  const exportedAt = readString(summary, 'exportedAt', readString(envelope, 'exportedAt', 'unknown'));
  const startedAt = readString(summary, 'startedAt', exportedAt);
  const sessionId = readString(summary, 'sessionId', 'legacy-training-session');
  const rawRuns = isCurrent && Array.isArray(summary.runs) ? summary.runs : [];
  const parsedRuns = rawRuns
    .map((run, index) => parseRunSummary(run, index, summary, envelope, sessionId, startedAt))
    .filter((run): run is TrainingTelemetryRunSummary => run !== null);

  if (parsedRuns.length === 0) {
    parsedRuns.push({
      runId: readString(summary, 'runId', `${sessionId}-run-01`),
      startedAt,
      identity: parseRunIdentity(summary.runIdentity, summary, envelope),
      ...parseMetrics(summary),
    });
  }

  const latestRun = parsedRuns.at(-1)!;
  const identity = cloneRunIdentity(latestRun.identity);
  return {
    schemaVersion: TRAINING_TELEMETRY_SCHEMA_VERSION,
    sessionId,
    startedAt,
    exportedAt,
    runId: latestRun.runId,
    runIdentity: identity,
    runs: parsedRuns.map(cloneRunSummary),
    balanceProfileId: identity.balanceProfileId,
    rulesetVersion: identity.rulesetVersion,
    playerCharacterId: identity.characters.player.characterId,
    opponentCharacterId: identity.characters.opponent.characterId,
    ...cloneMetrics(latestRun),
  };
}

export function createTrainingTelemetryTracker(options: TrainingTelemetryTrackerOptions): TrainingTelemetryTracker {
  return new TrainingTelemetryTracker(options);
}
