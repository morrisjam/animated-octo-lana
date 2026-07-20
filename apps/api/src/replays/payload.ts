import { createHash } from 'node:crypto';

export const REPLAY_PAYLOAD_VERSION = 1;
export const ONLINE_MATCH_REPLAY_SCHEMA_VERSION = 'gw.online-match-replay.v1';
export const REPLAY_INTEGRITY_SCHEMA_VERSION = 'gw.replay-integrity.v1';
export const REPLAY_CANONICAL_DIGEST_ALGORITHM = 'SHA-256';

export interface ReplayStageIdentity {
  id: string;
  version?: string;
  fingerprint?: string;
}

export interface ReplayOnlineMatchIdentity {
  schemaVersion: typeof ONLINE_MATCH_REPLAY_SCHEMA_VERSION;
  sessionId: string;
  matchId: string;
  balanceProfileId: string;
  tuningFingerprint: string;
  characterRegistryFingerprint: string;
  characterPackageVersions: { P1: string; P2: string };
  stage: ReplayStageIdentity;
}

export interface ReplayPayloadHeader {
  payloadVersion: number;
  rulesetVersion: string;
  simBuildHash: string;
  seed?: number;
  loadout?: { P1: string; P2: string };
  fixedDt?: number;
  advanceRngPerFrame?: boolean;
  rules?: { allowDunkWin: boolean };
  balanceTuning?: Record<string, number>;
  characterBalanceOverrides?: Record<string, unknown>;
  onlineMatch?: ReplayOnlineMatchIdentity;
}

export interface ReplayCanonicalRound {
  round?: number;
  label?: string;
  epoch?: number;
  seed?: number;
  startFrame: number;
  endFrame?: number;
  initialChecksum?: number;
  finalChecksum?: number;
  winner?: 'P1' | 'P2';
}

export interface ReplayPayloadIntegrity {
  schemaVersion: typeof REPLAY_INTEGRITY_SCHEMA_VERSION;
  algorithm: typeof REPLAY_CANONICAL_DIGEST_ALGORITHM;
  digest: string;
}

export interface ReplayPayload {
  header: ReplayPayloadHeader;
  inputTimeline: unknown[];
  rounds?: ReplayCanonicalRound[];
  expectedChecksums?: number[];
  integrity?: ReplayPayloadIntegrity;
}

export type ReplayPayloadValidationErrorCode =
  | 'invalid_payload'
  | 'missing_header'
  | 'unsupported_payload_version'
  | 'invalid_header'
  | 'missing_input_timeline'
  | 'invalid_input_timeline'
  | 'invalid_expected_checksums'
  | 'invalid_rounds'
  | 'invalid_online_identity'
  | 'invalid_integrity';

export type ReplayPayloadValidationResult =
  | { ok: true; payload: ReplayPayload }
  | {
      ok: false;
      errorCode: ReplayPayloadValidationErrorCode;
      errorMessage: string;
    };

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

const ZERO_DEFAULT_TUNING_KEYS = [
  'postControlCounterLaunchClashGraceSeconds',
  'combatBoostReacquireDelaySeconds',
  'committedLocomotionInputAuthority',
  'ordinaryBoostAccelerationSeconds',
] as const;

const GAME_TUNING_KEYS = [
  'chainWindowSeconds',
  'playerMoveAccel',
  'playerVelocityDamping',
  'actionRecoveryControlMultiplier',
  'committedLocomotionInputAuthority',
  'combatBoostReacquireDelaySeconds',
  'helplessVelocityDamping',
  'helplessReleaseSpeedRatio',
  'boostHoldSpeed',
  'ordinaryBoostAccelerationSeconds',
  'superBoostHoldSpeed',
  'superBoostSteerLerp',
  'superBoostVelocityBlend',
  'superBoostWaveAmplitude',
  'superBoostFuelMultiplier',
  'launchBasePower',
  'launchChainBonus',
  'launchInputInfluence',
  'launchHelplessSeconds',
  'startupClashGraceSeconds',
  'postControlCounterLaunchClashGraceSeconds',
  'launchClashSeparationPadding',
  'launchClashRecoilMultiplier',
  'closeRangeSeparationPadding',
  'closeRangeSeparationImpulse',
  'closeRangeCommitSeparationMultiplier',
  'defensiveResetDistance',
  'defensiveResetImpulse',
  'launchBreakResetMultiplier',
  'naturalRecoveryResetMultiplier',
  'dunkRecoveryDurationSeconds',
  'dunkRecoveryMoveSpeed',
  'dunkRecoveryFuelFraction',
] as const;

function hasSupportedGameTuningKeys(value: Record<string, unknown>): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => GAME_TUNING_KEYS.includes(key as typeof GAME_TUNING_KEYS[number]))
    && GAME_TUNING_KEYS.every((key) => (
      actualKeys.includes(key) || ZERO_DEFAULT_TUNING_KEYS.includes(
        key as typeof ZERO_DEFAULT_TUNING_KEYS[number],
      )
    ));
}

function fail(
  errorCode: ReplayPayloadValidationErrorCode,
  errorMessage: string,
): ReplayPayloadValidationResult {
  return { ok: false, errorCode, errorMessage };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isUnsigned32BitInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 0xffffffff;
}

function cloneJsonValue(
  value: unknown,
  ancestors: Set<object>,
  depth = 0,
): unknown {
  if (depth > 128) {
    throw new Error('Replay payload JSON nesting exceeds 128 levels.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Replay payload numbers must be finite.');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`Replay payload cannot contain ${typeof value} values.`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new Error('Replay payload must contain only JSON objects and arrays.');
  }
  if (ancestors.has(value)) {
    throw new Error('Replay payload cannot contain circular references.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('Replay payload cannot contain symbol properties.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneJsonValue(entry, ancestors, depth + 1));
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      cloneJsonValue(entry, ancestors, depth + 1),
    ]));
  } finally {
    ancestors.delete(value);
  }
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

function fingerprintDeterministicValue(value: unknown): string {
  const canonical = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function fingerprintGameTuning(tuning: Record<string, unknown>): string {
  const fingerprintInput = { ...tuning };
  for (const key of ZERO_DEFAULT_TUNING_KEYS) {
    if (fingerprintInput[key] === 0) {
      delete fingerprintInput[key];
    }
  }
  return fingerprintDeterministicValue(fingerprintInput);
}

export function computeReplayCanonicalDigestForArchive(payload: ReplayPayload): string {
  const { integrity: _integrity, ...canonicalPayload } = payload;
  return createHash('sha256').update(canonicalJson(canonicalPayload)).digest('hex');
}

function validateOptionalLegacyHeaderFields(header: Record<string, unknown>): string | null {
  if (header.seed !== undefined && !isUnsigned32BitInteger(header.seed)) {
    return 'Replay header seed must be an unsigned 32-bit integer when provided.';
  }
  if (
    header.fixedDt !== undefined
    && (typeof header.fixedDt !== 'number' || !Number.isFinite(header.fixedDt) || header.fixedDt <= 0)
  ) {
    return 'Replay header fixedDt must be a positive finite number when provided.';
  }
  if (header.advanceRngPerFrame !== undefined && typeof header.advanceRngPerFrame !== 'boolean') {
    return 'Replay header advanceRngPerFrame must be boolean when provided.';
  }
  if (header.loadout !== undefined) {
    if (!isObjectRecord(header.loadout)) {
      return 'Replay header loadout must be an object when provided.';
    }
    for (const playerId of ['P1', 'P2'] as const) {
      if (header.loadout[playerId] !== undefined && !isNonEmptyTrimmedString(header.loadout[playerId])) {
        return `Replay header loadout ${playerId} must be a non-empty trimmed string.`;
      }
    }
  }
  if (
    header.rules !== undefined
    && (!isObjectRecord(header.rules) || typeof header.rules.allowDunkWin !== 'boolean')
  ) {
    return 'Replay header rules must include boolean allowDunkWin when provided.';
  }
  if (header.balanceTuning !== undefined) {
    if (
      !isObjectRecord(header.balanceTuning)
      || Object.values(header.balanceTuning).some((value) => (
        typeof value !== 'number' || !Number.isFinite(value)
      ))
    ) {
      return 'Replay header balanceTuning must contain only finite numeric values.';
    }
  }
  if (header.characterBalanceOverrides !== undefined && !isObjectRecord(header.characterBalanceOverrides)) {
    return 'Replay header characterBalanceOverrides must be an object when provided.';
  }
  return null;
}

function validateCanonicalPlayerInput(value: unknown): boolean {
  if (!isObjectRecord(value) || !hasExactKeys(value, PLAYER_INPUT_KEYS)) {
    return false;
  }
  if (
    typeof value.moveX !== 'number'
    || !Number.isFinite(value.moveX)
    || value.moveX < -1
    || value.moveX > 1
    || typeof value.moveY !== 'number'
    || !Number.isFinite(value.moveY)
    || value.moveY < -1
    || value.moveY > 1
  ) {
    return false;
  }
  return PLAYER_INPUT_KEYS.slice(2).every((key) => typeof value[key] === 'boolean');
}

function validateCanonicalInputTimeline(inputTimeline: unknown[]): boolean {
  return inputTimeline.length > 0 && inputTimeline.every((frame) => (
    isObjectRecord(frame)
    && hasExactKeys(frame, ['p1', 'p2'])
    && validateCanonicalPlayerInput(frame.p1)
    && validateCanonicalPlayerInput(frame.p2)
  ));
}

function validateStageIdentity(value: unknown): value is ReplayStageIdentity {
  if (!isObjectRecord(value)) {
    return false;
  }
  return Object.keys(value).every((key) => key === 'id' || key === 'version' || key === 'fingerprint')
    && isNonEmptyTrimmedString(value.id)
    && (value.version === undefined || isNonEmptyTrimmedString(value.version))
    && (value.fingerprint === undefined || isNonEmptyTrimmedString(value.fingerprint));
}

function validateOnlineIdentity(
  header: Record<string, unknown>,
): header is Record<string, unknown> & { onlineMatch: ReplayOnlineMatchIdentity } {
  const identity = header.onlineMatch;
  if (
    !isObjectRecord(identity)
    || !hasExactKeys(identity, [
      'schemaVersion',
      'sessionId',
      'matchId',
      'balanceProfileId',
      'tuningFingerprint',
      'characterRegistryFingerprint',
      'characterPackageVersions',
      'stage',
    ])
    || identity.schemaVersion !== ONLINE_MATCH_REPLAY_SCHEMA_VERSION
    || !isNonEmptyTrimmedString(identity.sessionId)
    || !isNonEmptyTrimmedString(identity.matchId)
    || !isNonEmptyTrimmedString(identity.balanceProfileId)
    || !isNonEmptyTrimmedString(identity.tuningFingerprint)
    || !isNonEmptyTrimmedString(identity.characterRegistryFingerprint)
    || !isObjectRecord(identity.characterPackageVersions)
    || !hasExactKeys(identity.characterPackageVersions, ['P1', 'P2'])
    || !isNonEmptyTrimmedString(identity.characterPackageVersions.P1)
    || !isNonEmptyTrimmedString(identity.characterPackageVersions.P2)
    || !validateStageIdentity(identity.stage)
  ) {
    return false;
  }
  return isObjectRecord(header.balanceTuning)
    && hasSupportedGameTuningKeys(header.balanceTuning)
    && Object.values(header.balanceTuning).every((value) => (
      typeof value === 'number' && Number.isFinite(value)
    ))
    && identity.tuningFingerprint === fingerprintGameTuning(header.balanceTuning);
}

function validateCanonicalHeader(header: Record<string, unknown>): string | null {
  if (
    !isUnsigned32BitInteger(header.seed)
    || !isObjectRecord(header.loadout)
    || !hasExactKeys(header.loadout, ['P1', 'P2'])
    || !isNonEmptyTrimmedString(header.loadout.P1)
    || !isNonEmptyTrimmedString(header.loadout.P2)
    || typeof header.fixedDt !== 'number'
    || !Number.isFinite(header.fixedDt)
    || header.fixedDt <= 0
    || typeof header.advanceRngPerFrame !== 'boolean'
    || !isObjectRecord(header.rules)
    || !hasExactKeys(header.rules, ['allowDunkWin'])
    || typeof header.rules.allowDunkWin !== 'boolean'
    || !isObjectRecord(header.characterBalanceOverrides)
  ) {
    return 'Canonical online replay headers require exact seed, loadout, timestep, rules, tuning, and character balance snapshots.';
  }
  if (!validateOnlineIdentity(header)) {
    return 'Replay onlineMatch identity is malformed or inconsistent with balanceTuning.';
  }
  return null;
}

function validateCanonicalRounds(
  rounds: unknown,
  inputFrameCount: number,
  expectedChecksums: number[] | undefined,
  seed: number,
): string | null {
  if (
    !Array.isArray(rounds)
    || rounds.length === 0
    || inputFrameCount === 0
    || !expectedChecksums
    || expectedChecksums.length !== inputFrameCount
  ) {
    return 'Canonical online replays require non-empty rounds and one checksum per input frame.';
  }

  let expectedStartFrame = 0;
  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    if (
      !isObjectRecord(round)
      || !Object.keys(round).every((key) => [
        'round',
        'label',
        'epoch',
        'seed',
        'startFrame',
        'endFrame',
        'initialChecksum',
        'finalChecksum',
        'winner',
      ].includes(key))
      || round.round !== index + 1
      || round.epoch !== index
      || round.seed !== seed
      || round.startFrame !== expectedStartFrame
      || !Number.isSafeInteger(round.endFrame)
      || Number(round.endFrame) < expectedStartFrame
      || Number(round.endFrame) >= inputFrameCount
      || !isUnsigned32BitInteger(round.initialChecksum)
      || !isUnsigned32BitInteger(round.finalChecksum)
      || round.finalChecksum !== expectedChecksums[Number(round.endFrame)]
      || !isNonEmptyTrimmedString(round.label)
      || (round.winner !== undefined && round.winner !== 'P1' && round.winner !== 'P2')
    ) {
      return `Canonical online replay round ${index + 1} has malformed or inconsistent boundaries.`;
    }
    expectedStartFrame = Number(round.endFrame) + 1;
  }
  return expectedStartFrame === inputFrameCount
    ? null
    : 'Canonical online replay rounds must cover the complete input timeline without gaps.';
}

function validateIntegrity(value: unknown, payload: ReplayPayload): string | null {
  if (
    !isObjectRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'algorithm', 'digest'])
    || value.schemaVersion !== REPLAY_INTEGRITY_SCHEMA_VERSION
    || value.algorithm !== REPLAY_CANONICAL_DIGEST_ALGORITHM
    || typeof value.digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.digest)
  ) {
    return 'Replay integrity must contain a supported canonical SHA-256 digest.';
  }
  return value.digest === computeReplayCanonicalDigestForArchive(payload)
    ? null
    : 'Replay canonical digest does not match the complete payload.';
}

export function validateReplayPayloadForArchive(rawPayload: unknown): ReplayPayloadValidationResult {
  let payload: ReplayPayload;
  try {
    payload = cloneJsonValue(rawPayload, new Set()) as ReplayPayload;
  } catch (error) {
    return fail(
      'invalid_payload',
      error instanceof Error ? error.message : 'Replay payload must be valid JSON.',
    );
  }

  if (!isObjectRecord(payload)) {
    return fail('invalid_payload', 'Replay payload must be a JSON object.');
  }
  if (!isObjectRecord(payload.header)) {
    return fail('missing_header', 'Replay payload is missing a valid header object.');
  }

  const header = payload.header as unknown as Record<string, unknown>;
  if (typeof header.payloadVersion !== 'number' || !Number.isSafeInteger(header.payloadVersion)) {
    return fail('invalid_header', 'Replay header payloadVersion must be an integer.');
  }
  if (header.payloadVersion !== REPLAY_PAYLOAD_VERSION) {
    return fail(
      'unsupported_payload_version',
      `Replay payloadVersion ${header.payloadVersion} is unsupported. Expected ${REPLAY_PAYLOAD_VERSION}.`,
    );
  }
  if (!isNonEmptyTrimmedString(header.rulesetVersion)) {
    return fail('invalid_header', 'Replay header rulesetVersion is required and must be trimmed.');
  }
  if (!isNonEmptyTrimmedString(header.simBuildHash)) {
    return fail('invalid_header', 'Replay header simBuildHash is required and must be trimmed.');
  }
  const optionalHeaderError = validateOptionalLegacyHeaderFields(header);
  if (optionalHeaderError) {
    return fail('invalid_header', optionalHeaderError);
  }
  if (!Array.isArray(payload.inputTimeline)) {
    return fail('missing_input_timeline', 'Replay payload must include inputTimeline array.');
  }

  if (payload.expectedChecksums !== undefined) {
    if (
      !Array.isArray(payload.expectedChecksums)
      || payload.expectedChecksums.some((value) => !isUnsigned32BitInteger(value))
    ) {
      return fail(
        'invalid_expected_checksums',
        'Replay expectedChecksums must contain unsigned 32-bit integers.',
      );
    }
  }

  if (payload.rounds !== undefined) {
    if (!Array.isArray(payload.rounds) || payload.rounds.some((round) => !isObjectRecord(round))) {
      return fail('invalid_rounds', 'Replay rounds must be an array of objects when provided.');
    }
    for (const [index, round] of payload.rounds.entries()) {
      const record = round as unknown as Record<string, unknown>;
      if (
        !Number.isSafeInteger(record.startFrame)
        || Number(record.startFrame) < 0
        || (record.endFrame !== undefined && (
          !Number.isSafeInteger(record.endFrame)
          || Number(record.endFrame) < Number(record.startFrame)
        ))
      ) {
        return fail('invalid_rounds', `Replay round ${index + 1} has invalid frame boundaries.`);
      }
    }
  }

  const hasOnlineIdentity = header.onlineMatch !== undefined;
  const hasIntegrity = payload.integrity !== undefined;
  if (hasOnlineIdentity !== hasIntegrity) {
    return fail(
      'invalid_integrity',
      'Canonical online replay identity and integrity must be provided together.',
    );
  }
  if (hasOnlineIdentity) {
    const canonicalHeaderError = validateCanonicalHeader(header);
    if (canonicalHeaderError) {
      return fail('invalid_online_identity', canonicalHeaderError);
    }
    if (!validateCanonicalInputTimeline(payload.inputTimeline)) {
      return fail(
        'invalid_input_timeline',
        'Canonical online replay frames require complete authoritative P1 and P2 inputs.',
      );
    }
    const roundError = validateCanonicalRounds(
      payload.rounds,
      payload.inputTimeline.length,
      payload.expectedChecksums,
      header.seed as number,
    );
    if (roundError) {
      return fail('invalid_rounds', roundError);
    }
    const integrityError = validateIntegrity(payload.integrity, payload);
    if (integrityError) {
      return fail('invalid_integrity', integrityError);
    }
  }

  return { ok: true, payload };
}
