import { resolveBalanceProfile } from './balanceProfiles';
import {
  cloneCharacterBalanceOverrides,
  type CharacterBalanceOverrides,
} from './characterBalance';
import {
  CHARACTER_BY_ID,
  CHARACTER_PACKAGE_VERSION_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
  type CharacterId,
} from './characters';
import { computeStateChecksum } from './checksum';
import { fingerprintDeterministicValue } from './fingerprint';
import {
  ONLINE_MATCH_REPLAY_SCHEMA_VERSION,
  REPLAY_CANONICAL_DIGEST_ALGORITHM,
  REPLAY_INTEGRITY_SCHEMA_VERSION,
  REPLAY_PAYLOAD_VERSION,
  type ReplayPayload,
  type ReplayRoundDescriptor,
  type ReplayStageIdentity,
} from './replay';
import { createInitialState, createStateSnapshot, nextDeterministicRandom, step } from './sim';
import type {
  FrameInput,
  GameRules,
  GameState,
  GameTuning,
  PlayerFrameInput,
  PlayerId,
  PlayersById,
} from './types';

export type AuthoritativeReplayInputSource = 'local' | 'remote_authoritative';

export interface SynchronizedAuthoritativePlayerInput {
  input: PlayerFrameInput;
  source: AuthoritativeReplayInputSource;
}

export interface SynchronizedAuthoritativeReplayFrame {
  epoch: number;
  frame: number;
  confirmedThrough: number;
  checksum: number;
  players: PlayersById<SynchronizedAuthoritativePlayerInput>;
}

export interface SynchronizedReplayFrameLimitInput {
  contiguousRemoteFrame: number;
  peerConfirmedThrough: number;
  currentFrame: number;
  winningFrame: number | null;
}

export function resolveSynchronizedReplayFrameLimit(
  input: SynchronizedReplayFrameLimitInput,
): number {
  return Math.min(
    input.contiguousRemoteFrame,
    input.peerConfirmedThrough,
    input.currentFrame - 1,
    input.winningFrame ?? Number.POSITIVE_INFINITY,
  );
}

export interface OnlineMatchReplayRecorderOptions {
  sessionId: string;
  matchId: string;
  localPlayerId: PlayerId;
  rulesetVersion: string;
  simBuildHash: string;
  balanceProfileId: string;
  seed: number;
  loadout: PlayersById<CharacterId>;
  fixedDt: number;
  rules: GameRules;
  tuning: GameTuning;
  characterBalanceOverrides?: CharacterBalanceOverrides;
  stage: ReplayStageIdentity;
  advanceRngPerFrame?: boolean;
  characterPackageVersions?: PlayersById<string>;
  characterRegistryFingerprint?: string;
}

interface PendingRound {
  epoch: number;
  startFrame: number;
  initialChecksum: number;
  state: GameState;
  frameCount: number;
  lastChecksum: number | null;
}

const PLAYER_INPUT_KEYS = [
  'moveX',
  'moveY',
  'boost',
  'superBoost',
  'special',
  'launch',
  'dunk',
  'parry',
  'breakLaunch',
] as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function requireTrimmedString(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${description} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireUnsigned32BitInteger(value: unknown, description: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 0xffffffff
  ) {
    throw new Error(`${description} must be an unsigned 32-bit integer.`);
  }
  return value;
}

function clonePlayerInput(input: PlayerFrameInput): PlayerFrameInput {
  if (!isObjectRecord(input) || !hasExactKeys(input, PLAYER_INPUT_KEYS)) {
    throw new Error('Authoritative replay player input has an invalid shape.');
  }
  if (
    typeof input.moveX !== 'number'
    || !Number.isFinite(input.moveX)
    || input.moveX < -1
    || input.moveX > 1
    || typeof input.moveY !== 'number'
    || !Number.isFinite(input.moveY)
    || input.moveY < -1
    || input.moveY > 1
  ) {
    throw new Error('Authoritative replay movement axes must be finite values from -1 to 1.');
  }
  for (const action of PLAYER_INPUT_KEYS.slice(2)) {
    if (typeof input[action] !== 'boolean') {
      throw new Error(`Authoritative replay input ${action} must be boolean.`);
    }
  }
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

function cloneFrameInput(players: SynchronizedAuthoritativeReplayFrame['players']): FrameInput {
  return {
    p1: clonePlayerInput(players.P1.input),
    p2: clonePlayerInput(players.P2.input),
  };
}

function cloneStageIdentity(stage: ReplayStageIdentity): ReplayStageIdentity {
  if (!isObjectRecord(stage)) {
    throw new Error('Replay stage identity must be an object.');
  }
  const keys = Object.keys(stage);
  if (!keys.every((key) => key === 'id' || key === 'version' || key === 'fingerprint')) {
    throw new Error('Replay stage identity contains unsupported fields.');
  }
  const id = requireTrimmedString(stage.id, 'Replay stage id');
  const version = stage.version === undefined
    ? undefined
    : requireTrimmedString(stage.version, 'Replay stage version');
  const fingerprint = stage.fingerprint === undefined
    ? undefined
    : requireTrimmedString(stage.fingerprint, 'Replay stage fingerprint');
  return {
    id,
    ...(version ? { version } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical replay payloads cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isObjectRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, entryValue]) => (
      `${JSON.stringify(key)}:${canonicalJson(entryValue)}`
    )).join(',')}}`;
  }
  throw new Error(`Canonical replay payloads cannot contain ${typeof value} values.`);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function digestOnlineMatchReplayPayload(payload: ReplayPayload): Promise<string> {
  const { integrity: _integrity, ...canonicalPayload } = payload;
  return await sha256Hex(canonicalJson(canonicalPayload));
}

export async function verifyOnlineMatchReplayDigest(payload: ReplayPayload): Promise<boolean> {
  return payload.integrity?.schemaVersion === REPLAY_INTEGRITY_SCHEMA_VERSION
    && payload.integrity.algorithm === REPLAY_CANONICAL_DIGEST_ALGORITHM
    && payload.integrity.digest === await digestOnlineMatchReplayPayload(payload);
}

export class OnlineMatchReplayRecorder {
  private readonly options: Omit<OnlineMatchReplayRecorderOptions, 'characterBalanceOverrides'> & {
    characterBalanceOverrides: CharacterBalanceOverrides;
    characterPackageVersions: PlayersById<string>;
    characterRegistryFingerprint: string;
    advanceRngPerFrame: boolean;
  };

  private readonly inputTimeline: FrameInput[] = [];

  private readonly expectedChecksums: number[] = [];

  private readonly rounds: ReplayRoundDescriptor[] = [];

  private pendingRound: PendingRound | null = null;

  public constructor(options: OnlineMatchReplayRecorderOptions) {
    const sessionId = requireTrimmedString(options.sessionId, 'Replay sessionId');
    const matchId = requireTrimmedString(options.matchId, 'Replay matchId');
    const rulesetVersion = requireTrimmedString(options.rulesetVersion, 'Replay rulesetVersion');
    const simBuildHash = requireTrimmedString(options.simBuildHash, 'Replay simBuildHash');
    const balanceProfileId = requireTrimmedString(
      options.balanceProfileId,
      'Replay balanceProfileId',
    );
    if (options.localPlayerId !== 'P1' && options.localPlayerId !== 'P2') {
      throw new Error('Replay localPlayerId must be P1 or P2.');
    }
    const seed = requireUnsigned32BitInteger(options.seed, 'Replay seed');
    if (typeof options.fixedDt !== 'number' || !Number.isFinite(options.fixedDt) || options.fixedDt <= 0) {
      throw new Error('Replay fixedDt must be a positive finite number.');
    }
    if (
      !isObjectRecord(options.loadout)
      || !hasExactKeys(options.loadout, ['P1', 'P2'])
      || !CHARACTER_BY_ID[options.loadout.P1]
      || !CHARACTER_BY_ID[options.loadout.P2]
    ) {
      throw new Error('Replay loadout must contain supported P1 and P2 characters.');
    }
    if (
      !isObjectRecord(options.rules)
      || !hasExactKeys(options.rules, ['allowDunkWin'])
      || typeof options.rules.allowDunkWin !== 'boolean'
    ) {
      throw new Error('Replay rules must contain the exact allowDunkWin value.');
    }
    if (!isObjectRecord(options.tuning)) {
      throw new Error('Replay tuning must be a complete object.');
    }
    const profile = resolveBalanceProfile(balanceProfileId);
    const tuningFingerprint = fingerprintDeterministicValue(options.tuning);
    if (
      profile.id !== balanceProfileId
      || tuningFingerprint !== fingerprintDeterministicValue(profile.tuning)
    ) {
      throw new Error(`Replay tuning does not match balance profile ${balanceProfileId}.`);
    }

    const characterPackageVersions = options.characterPackageVersions ?? {
      P1: CHARACTER_PACKAGE_VERSION_BY_ID[options.loadout.P1],
      P2: CHARACTER_PACKAGE_VERSION_BY_ID[options.loadout.P2],
    };
    for (const playerId of ['P1', 'P2'] as const) {
      const expectedVersion = CHARACTER_PACKAGE_VERSION_BY_ID[options.loadout[playerId]];
      if (
        !expectedVersion
        || characterPackageVersions[playerId] !== expectedVersion
        || !isNonEmptyString(characterPackageVersions[playerId])
      ) {
        throw new Error(`Replay ${playerId} character package version does not match the runtime registry.`);
      }
    }
    const characterRegistryFingerprint = options.characterRegistryFingerprint
      ?? CHARACTER_REGISTRY_FINGERPRINT;
    if (characterRegistryFingerprint !== CHARACTER_REGISTRY_FINGERPRINT) {
      throw new Error('Replay character registry fingerprint does not match the runtime registry.');
    }

    this.options = {
      ...options,
      sessionId,
      matchId,
      rulesetVersion,
      simBuildHash,
      balanceProfileId,
      seed,
      loadout: { ...options.loadout },
      fixedDt: options.fixedDt,
      rules: { ...options.rules },
      tuning: { ...options.tuning },
      characterBalanceOverrides: cloneCharacterBalanceOverrides(
        options.characterBalanceOverrides ?? {},
      ),
      stage: cloneStageIdentity(options.stage),
      advanceRngPerFrame: options.advanceRngPerFrame ?? false,
      characterPackageVersions: { ...characterPackageVersions },
      characterRegistryFingerprint,
    };
  }

  public get frameCount(): number {
    return this.inputTimeline.length;
  }

  public get roundCount(): number {
    return this.rounds.length;
  }

  public get currentRoundFrameCount(): number {
    return this.pendingRound?.frameCount ?? 0;
  }

  public startRound(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || epoch !== this.rounds.length) {
      throw new Error(`Replay epoch ${epoch} is invalid; expected ${this.rounds.length}.`);
    }
    if (this.pendingRound) {
      throw new Error(`Replay epoch ${this.pendingRound.epoch} has not been finalized.`);
    }
    const state = this.createRoundState();
    this.pendingRound = {
      epoch,
      startFrame: this.inputTimeline.length,
      initialChecksum: computeStateChecksum(state),
      state,
      frameCount: 0,
      lastChecksum: null,
    };
  }

  public recordSynchronizedFrame(frameRecord: SynchronizedAuthoritativeReplayFrame): void {
    if (
      !isObjectRecord(frameRecord)
      || !hasExactKeys(frameRecord, [
        'epoch',
        'frame',
        'confirmedThrough',
        'checksum',
        'players',
      ])
    ) {
      throw new Error('Synchronized authoritative replay frame has an invalid shape.');
    }
    const round = this.pendingRound;
    if (!round || frameRecord.epoch !== round.epoch) {
      throw new Error(`Replay frame targets inactive epoch ${frameRecord.epoch}.`);
    }
    if (!Number.isSafeInteger(frameRecord.frame) || frameRecord.frame !== round.frameCount) {
      throw new Error(`Replay epoch ${round.epoch} expected frame ${round.frameCount}.`);
    }
    if (
      !Number.isSafeInteger(frameRecord.confirmedThrough)
      || frameRecord.confirmedThrough < frameRecord.frame
    ) {
      throw new Error(`Replay frame ${frameRecord.frame} is not peer-confirmed.`);
    }
    const checksum = requireUnsigned32BitInteger(
      frameRecord.checksum,
      `Replay epoch ${round.epoch}, frame ${frameRecord.frame} checksum`,
    );
    if (!isObjectRecord(frameRecord.players) || !hasExactKeys(frameRecord.players, ['P1', 'P2'])) {
      throw new Error('Replay frame must contain P1 and P2 authoritative inputs.');
    }
    for (const playerId of ['P1', 'P2'] as const) {
      const player = frameRecord.players[playerId];
      if (!isObjectRecord(player) || !hasExactKeys(player, ['input', 'source'])) {
        throw new Error(`Replay ${playerId} frame input has an invalid provenance shape.`);
      }
      const expectedSource = playerId === this.options.localPlayerId
        ? 'local'
        : 'remote_authoritative';
      if (player.source !== expectedSource) {
        throw new Error(
          `Replay ${playerId} input must be ${expectedSource}; predicted inputs cannot be persisted.`,
        );
      }
    }
    if (round.state.winner) {
      throw new Error(`Replay epoch ${round.epoch} cannot continue after a winning state.`);
    }

    const input = cloneFrameInput(frameRecord.players);
    const nextState = createStateSnapshot(round.state);
    step(nextState, input, this.options.fixedDt);
    if (this.options.advanceRngPerFrame) {
      nextDeterministicRandom(nextState);
    }
    const replayedChecksum = computeStateChecksum(nextState);
    if (replayedChecksum !== checksum) {
      throw new Error(
        `Replay epoch ${round.epoch}, frame ${frameRecord.frame} checksum mismatch: expected ${checksum}, replayed ${replayedChecksum}.`,
      );
    }

    this.inputTimeline.push(input);
    this.expectedChecksums.push(checksum);
    round.state = nextState;
    round.frameCount += 1;
    round.lastChecksum = checksum;
  }

  public finalizeRound(
    epoch: number,
    finalFrame: number,
    winner: PlayerId | null = this.pendingRound?.state.winner ?? null,
  ): ReplayRoundDescriptor {
    const round = this.pendingRound;
    if (!round || round.epoch !== epoch) {
      throw new Error(`Replay cannot finalize inactive epoch ${epoch}.`);
    }
    if (round.frameCount === 0 || round.lastChecksum === null) {
      throw new Error(`Replay epoch ${epoch} has no synchronized authoritative frames.`);
    }
    if (!Number.isSafeInteger(finalFrame) || finalFrame !== round.frameCount - 1) {
      throw new Error(`Replay epoch ${epoch} final frame must be ${round.frameCount - 1}.`);
    }
    if (winner !== round.state.winner) {
      throw new Error(`Replay epoch ${epoch} winner does not match the replayed state.`);
    }

    const descriptor: ReplayRoundDescriptor = {
      round: epoch + 1,
      label: `Round ${epoch + 1}`,
      epoch,
      seed: this.options.seed,
      startFrame: round.startFrame,
      endFrame: round.startFrame + finalFrame,
      initialChecksum: round.initialChecksum,
      finalChecksum: round.lastChecksum,
      ...(winner ? { winner } : {}),
    };
    this.rounds.push(descriptor);
    this.pendingRound = null;
    return { ...descriptor };
  }

  public async buildPayload(): Promise<ReplayPayload> {
    if (this.pendingRound) {
      throw new Error(`Replay epoch ${this.pendingRound.epoch} has not been finalized.`);
    }
    if (this.rounds.length === 0) {
      throw new Error('Replay requires at least one finalized round.');
    }

    const payload: ReplayPayload = {
      header: {
        payloadVersion: REPLAY_PAYLOAD_VERSION,
        rulesetVersion: this.options.rulesetVersion,
        simBuildHash: this.options.simBuildHash,
        seed: this.options.seed,
        loadout: { ...this.options.loadout },
        fixedDt: this.options.fixedDt,
        advanceRngPerFrame: this.options.advanceRngPerFrame,
        rules: { ...this.options.rules },
        balanceTuning: { ...this.options.tuning },
        characterBalanceOverrides: cloneCharacterBalanceOverrides(
          this.options.characterBalanceOverrides,
        ),
        onlineMatch: {
          schemaVersion: ONLINE_MATCH_REPLAY_SCHEMA_VERSION,
          sessionId: this.options.sessionId,
          matchId: this.options.matchId,
          balanceProfileId: this.options.balanceProfileId,
          tuningFingerprint: fingerprintDeterministicValue(this.options.tuning),
          characterRegistryFingerprint: this.options.characterRegistryFingerprint,
          characterPackageVersions: { ...this.options.characterPackageVersions },
          stage: { ...this.options.stage },
        },
      },
      inputTimeline: this.inputTimeline.map((input) => ({
        p1: { ...input.p1 },
        p2: { ...input.p2 },
      })),
      rounds: this.rounds.map((round) => ({ ...round })),
      expectedChecksums: [...this.expectedChecksums],
    };
    const digest = await digestOnlineMatchReplayPayload(payload);
    return {
      ...payload,
      integrity: {
        schemaVersion: REPLAY_INTEGRITY_SCHEMA_VERSION,
        algorithm: REPLAY_CANONICAL_DIGEST_ALGORITHM,
        digest,
      },
    };
  }

  private createRoundState(): GameState {
    const state = createInitialState({
      seed: this.options.seed,
      loadout: this.options.loadout,
      rules: this.options.rules,
      characterBalanceOverrides: this.options.characterBalanceOverrides,
    });
    state.tuning = { ...this.options.tuning };
    return state;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
