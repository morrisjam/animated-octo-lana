import {
  cloneRendererCapabilitySummary,
  type RendererCapabilitySummary,
} from './capabilities';
import {
  sanitisePerformanceSample,
  type PerformanceSample,
} from '../view/performance/samples';

export const CRASH_BUNDLE_SCHEMA_VERSION = 'gw.crash-bundle.v1' as const;
export const CRASH_SETTINGS_SCHEMA_VERSION = 'gw.crash-settings.v1' as const;
export const MAX_CRASH_BUNDLE_ACCEPTED_INPUTS = 240;
export const MAX_CRASH_BUNDLE_EVENTS = 160;
export const MAX_CRASH_BUNDLE_PERFORMANCE_SAMPLES = 120;

export const CRASH_INPUT_ACTIONS = [
  'boost',
  'super_boost',
  'special',
  'launch',
  'dunk',
  'parry',
  'launch_break',
] as const;
export type CrashInputAction = (typeof CRASH_INPUT_ACTIONS)[number];

export const CRASH_EVENT_TYPES = [
  'match_started',
  'round_started',
  'action_accepted',
  'combat_hit',
  'launch_clash',
  'parry_resolved',
  'launch_break_resolved',
  'projectile_spawned',
  'projectile_resolved',
  'dunk_resolved',
  'round_ended',
  'match_ended',
  'rollback_applied',
  'checksum_mismatch',
  'renderer_context_lost',
  'renderer_context_restored',
  'visibility_hidden',
  'visibility_visible',
  'performance_tier_changed',
  'resolution_scale_changed',
  'fault_detected',
] as const;
export type CrashEventType = (typeof CRASH_EVENT_TYPES)[number];

export type CrashInputSource = 'human' | 'ai' | 'remote' | 'replay' | 'unknown';
export type CrashPlayerId = 'P1' | 'P2';
export type CrashFailureCategory =
  | 'simulation'
  | 'renderer'
  | 'audio'
  | 'input'
  | 'network'
  | 'storage'
  | 'platform'
  | 'unknown';
export type CrashFailurePhase =
  | 'boot'
  | 'menu'
  | 'match_setup'
  | 'playing'
  | 'results'
  | 'suspend'
  | 'resume'
  | 'shutdown'
  | 'unknown';

export interface CrashBundleReleaseIdentityInput {
  buildId: unknown;
  rulesetVersion: unknown;
  balanceProfileId: unknown;
  tuningFingerprint: unknown;
  characterBalanceFingerprint: unknown;
  characterRegistryFingerprint: unknown;
}

export interface CrashBundleReleaseIdentity {
  buildId: string;
  rulesetVersion: string;
  balanceProfileId: string;
  tuningFingerprint: string;
  characterBalanceFingerprint: string;
  characterRegistryFingerprint: string;
}

export interface CrashBundleFailure {
  category: CrashFailureCategory;
  phase: CrashFailurePhase;
  code: string;
  recoverable: boolean;
}

export interface CrashBundleAcceptedInput {
  frame: number;
  player: CrashPlayerId;
  action: CrashInputAction;
  source: CrashInputSource;
}

export interface CrashBundleEvent {
  type: CrashEventType;
  frame: number | null;
  player: CrashPlayerId | null;
  count: number | null;
  checksum: number | null;
}

export interface CrashBundleReplayReference {
  payloadVersion: number | null;
  integrityAlgorithm: 'SHA-256' | 'FNV-1A-32' | 'none';
  integrityDigest: string | null;
  frameCount: number | null;
  lastRecordedFrame: number | null;
}

export interface CrashBundleChecksumReference {
  frame: number;
  actual: number;
  expected: number | null;
}

export interface SanitisedCrashSettings {
  schemaVersion: typeof CRASH_SETTINGS_SCHEMA_VERSION;
  mode: 'endless' | 'best_of_3' | 'arcade' | 'training' | 'balance_sparring' | 'cpu_vs_cpu' | 'unknown';
  menuThemeId: string | null;
  stageAtmosphereId: string | null;
  loadout: {
    P1: string | null;
    P2: string | null;
  };
  aiDifficulty: 'rookie' | 'cadet' | 'veteran' | 'ace' | 'unknown';
  arcade: {
    continues: number | null;
    retryEnabled: boolean | null;
  };
  audio: {
    masterVolume: number | null;
    musicVolume: number | null;
    sfxVolume: number | null;
    voiceVolume: number | null;
    voiceDuckingEnabled: boolean | null;
    dynamicRangeMode: 'wide' | 'reduced' | 'unknown';
    subtitlesEnabled: boolean | null;
  };
  graphics: {
    performanceTier: 'performance' | 'balanced' | 'quality' | 'custom' | 'unknown';
    adaptiveResolutionEnabled: boolean | null;
  };
  accessibility: {
    reducedMotion: boolean | null;
    screenShakeStrength: number | null;
    photosensitivityMode: boolean | null;
    colorVisionMode: 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'monochrome' | 'unknown';
  };
}

export interface CrashBundlePerformanceSnapshot {
  tierId: 'performance' | 'balanced' | 'quality' | 'custom' | 'unknown';
  adaptiveResolutionEnabled: boolean;
  reducedMotion: boolean;
  pixelRatio: number;
  samples: PerformanceSample[];
}

export interface CrashBundle {
  schemaVersion: typeof CRASH_BUNDLE_SCHEMA_VERSION;
  capturedAt: string;
  identity: CrashBundleReleaseIdentity;
  failure: CrashBundleFailure;
  settings: SanitisedCrashSettings;
  recentAcceptedInputs: CrashBundleAcceptedInput[];
  recentEvents: CrashBundleEvent[];
  replay: CrashBundleReplayReference | null;
  checksum: CrashBundleChecksumReference | null;
  capabilities: RendererCapabilitySummary;
  performance: CrashBundlePerformanceSnapshot;
}

export interface BuildCrashBundleInput {
  capturedAt?: Date | string | number;
  identity: CrashBundleReleaseIdentityInput;
  failure?: unknown;
  settings?: unknown;
  recentAcceptedInputs?: readonly unknown[];
  recentEvents?: readonly unknown[];
  replay?: unknown;
  checksum?: unknown;
  capabilities: RendererCapabilitySummary;
  performance?: unknown;
}

const INPUT_ACTIONS = new Set<string>(CRASH_INPUT_ACTIONS);
const EVENT_TYPES = new Set<string>(CRASH_EVENT_TYPES);
const INPUT_SOURCES = new Set<CrashInputSource>(['human', 'ai', 'remote', 'replay', 'unknown']);
const FAILURE_CATEGORIES = new Set<CrashFailureCategory>([
  'simulation', 'renderer', 'audio', 'input', 'network', 'storage', 'platform', 'unknown',
]);
const FAILURE_PHASES = new Set<CrashFailurePhase>([
  'boot', 'menu', 'match_setup', 'playing', 'results', 'suspend', 'resume', 'shutdown', 'unknown',
]);
const GAME_MODES = new Set<SanitisedCrashSettings['mode']>([
  'endless', 'best_of_3', 'arcade', 'training', 'balance_sparring', 'cpu_vs_cpu', 'unknown',
]);
const AI_DIFFICULTIES = new Set<SanitisedCrashSettings['aiDifficulty']>([
  'rookie', 'cadet', 'veteran', 'ace', 'unknown',
]);
const PERFORMANCE_TIERS = new Set<SanitisedCrashSettings['graphics']['performanceTier']>([
  'performance', 'balanced', 'quality', 'custom', 'unknown',
]);
const COLOR_VISION_MODES = new Set<SanitisedCrashSettings['accessibility']['colorVisionMode']>([
  'default', 'deuteranopia', 'protanopia', 'tritanopia', 'monochrome', 'unknown',
]);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PATTERN = /\b(?:https?|wss?):\/\//i;
const IPV4_PATTERN = /(?:^|[^\d])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^\d])/;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/;
const FORBIDDEN_KEY_NAMES = new Set([
  'accesstoken',
  'accountid',
  'accountids',
  'authtoken',
  'authorization',
  'bearertoken',
  'email',
  'hostname',
  'ipaddress',
  'localaddress',
  'log',
  'logs',
  'message',
  'networkaddress',
  'password',
  'refreshtoken',
  'remoteaddress',
  'sessionid',
  'stack',
  'stacktrace',
  'ticketid',
  'token',
  'url',
  'useragent',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nullableUnitNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Number(clamp(parsed, 0, 1).toFixed(3));
}

function boundedInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return Math.round(clamp(parsed, 0, maximum));
}

function uint32(value: unknown): number | null {
  const parsed = boundedInteger(value, 0xffff_ffff);
  return parsed === null ? null : parsed >>> 0;
}

function containsSensitiveString(value: string): boolean {
  return EMAIL_PATTERN.test(value)
    || URL_PATTERN.test(value)
    || IPV4_PATTERN.test(value)
    || JWT_PATTERN.test(value)
    || /\bbearer\s+[A-Za-z0-9._~-]+/i.test(value);
}

function safeIdentifier(value: unknown, fieldName: string, maximumLength = 160): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (
    !parsed
    || parsed.length > maximumLength
    || !SAFE_IDENTIFIER_PATTERN.test(parsed)
    || containsSensitiveString(parsed)
  ) {
    throw new Error(`${fieldName} must be a privacy-safe identifier of at most ${maximumLength} characters.`);
  }
  return parsed;
}

function optionalIdentifier(value: unknown, maximumLength = 96): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  try {
    return safeIdentifier(value, 'Diagnostic setting identifier', maximumLength);
  } catch {
    return null;
  }
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

function parseCapturedAt(value: Date | string | number | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Crash bundle capturedAt must be a valid date.');
  }
  return date.toISOString();
}

function sanitiseIdentity(input: CrashBundleReleaseIdentityInput): CrashBundleReleaseIdentity {
  return {
    buildId: safeIdentifier(input.buildId, 'Crash bundle buildId'),
    rulesetVersion: safeIdentifier(input.rulesetVersion, 'Crash bundle rulesetVersion'),
    balanceProfileId: safeIdentifier(input.balanceProfileId, 'Crash bundle balanceProfileId'),
    tuningFingerprint: safeIdentifier(input.tuningFingerprint, 'Crash bundle tuningFingerprint'),
    characterBalanceFingerprint: safeIdentifier(
      input.characterBalanceFingerprint,
      'Crash bundle characterBalanceFingerprint',
    ),
    characterRegistryFingerprint: safeIdentifier(
      input.characterRegistryFingerprint,
      'Crash bundle characterRegistryFingerprint',
    ),
  };
}

function sanitiseFailure(value: unknown): CrashBundleFailure {
  const source = isRecord(value) ? value : {};
  return {
    category: enumValue(source.category, FAILURE_CATEGORIES, 'unknown'),
    phase: enumValue(source.phase, FAILURE_PHASES, 'unknown'),
    code: optionalIdentifier(source.code, 80) ?? 'unclassified',
    recoverable: source.recoverable === true,
  };
}

export function sanitiseCrashSettings(value: unknown): SanitisedCrashSettings {
  const root = isRecord(value) ? value : {};
  const loadout = isRecord(root.loadout) ? root.loadout : {};
  const arcade = isRecord(root.arcade) ? root.arcade : {};
  const audio = isRecord(root.audio) ? root.audio : {};
  const graphics = isRecord(root.graphics) ? root.graphics : {};
  const accessibility = isRecord(root.accessibility) ? root.accessibility : {};
  const continues = boundedInteger(arcade.continues, 99);
  const dynamicRangeMode = audio.dynamicRangeMode === 'wide' || audio.dynamicRangeMode === 'reduced'
    ? audio.dynamicRangeMode
    : 'unknown';

  return {
    schemaVersion: CRASH_SETTINGS_SCHEMA_VERSION,
    mode: enumValue(root.mode, GAME_MODES, 'unknown'),
    menuThemeId: optionalIdentifier(root.menuThemeId),
    stageAtmosphereId: optionalIdentifier(root.stageAtmosphereId),
    loadout: {
      P1: optionalIdentifier(loadout.P1),
      P2: optionalIdentifier(loadout.P2),
    },
    aiDifficulty: enumValue(root.aiDifficulty, AI_DIFFICULTIES, 'unknown'),
    arcade: {
      continues,
      retryEnabled: nullableBoolean(arcade.retryEnabled),
    },
    audio: {
      masterVolume: nullableUnitNumber(audio.masterVolume),
      musicVolume: nullableUnitNumber(audio.musicVolume),
      sfxVolume: nullableUnitNumber(audio.sfxVolume),
      voiceVolume: nullableUnitNumber(audio.voiceVolume),
      voiceDuckingEnabled: nullableBoolean(audio.voiceDuckingEnabled),
      dynamicRangeMode,
      subtitlesEnabled: nullableBoolean(audio.subtitlesEnabled),
    },
    graphics: {
      performanceTier: enumValue(graphics.performanceTier, PERFORMANCE_TIERS, 'unknown'),
      adaptiveResolutionEnabled: nullableBoolean(graphics.adaptiveResolutionEnabled),
    },
    accessibility: {
      reducedMotion: nullableBoolean(accessibility.reducedMotion),
      screenShakeStrength: nullableUnitNumber(accessibility.screenShakeStrength),
      photosensitivityMode: nullableBoolean(accessibility.photosensitivityMode),
      colorVisionMode: enumValue(accessibility.colorVisionMode, COLOR_VISION_MODES, 'unknown'),
    },
  };
}

function parseAcceptedInput(value: unknown): CrashBundleAcceptedInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const frame = boundedInteger(value.frame, 0x7fff_ffff);
  if (
    frame === null
    || (value.player !== 'P1' && value.player !== 'P2')
    || typeof value.action !== 'string'
    || !INPUT_ACTIONS.has(value.action)
  ) {
    return null;
  }
  return {
    frame,
    player: value.player,
    action: value.action as CrashInputAction,
    source: enumValue(value.source, INPUT_SOURCES, 'unknown'),
  };
}

function parseEvent(value: unknown): CrashBundleEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !EVENT_TYPES.has(value.type)) {
    return null;
  }
  return {
    type: value.type as CrashEventType,
    frame: boundedInteger(value.frame, 0x7fff_ffff),
    player: value.player === 'P1' || value.player === 'P2' ? value.player : null,
    count: boundedInteger(value.count, 1_000_000),
    checksum: uint32(value.checksum),
  };
}

function collectLatest<T>(
  values: readonly unknown[] | undefined,
  limit: number,
  parse: (value: unknown) => T | null,
): T[] {
  const result: T[] = [];
  const source = values ?? [];
  for (let index = source.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const parsed = parse(source[index]);
    if (parsed) {
      result.push(parsed);
    }
  }
  return result.reverse();
}

function sanitiseReplay(value: unknown): CrashBundleReplayReference | null {
  if (!isRecord(value)) {
    return null;
  }
  const integrityAlgorithm = value.integrityAlgorithm === 'SHA-256' || value.integrityAlgorithm === 'FNV-1A-32'
    ? value.integrityAlgorithm
    : 'none';
  const integrityDigest = integrityAlgorithm === 'none'
    ? null
    : optionalIdentifier(value.integrityDigest, 160);
  return {
    payloadVersion: boundedInteger(value.payloadVersion, 10_000),
    integrityAlgorithm: integrityDigest ? integrityAlgorithm : 'none',
    integrityDigest,
    frameCount: boundedInteger(value.frameCount, 100_000_000),
    lastRecordedFrame: boundedInteger(value.lastRecordedFrame, 100_000_000),
  };
}

function sanitiseChecksum(value: unknown): CrashBundleChecksumReference | null {
  if (!isRecord(value)) {
    return null;
  }
  const frame = boundedInteger(value.frame, 100_000_000);
  const actual = uint32(value.actual);
  if (frame === null || actual === null) {
    return null;
  }
  return {
    frame,
    actual,
    expected: uint32(value.expected),
  };
}

function sanitisePerformance(value: unknown): CrashBundlePerformanceSnapshot {
  const source = isRecord(value) ? value : {};
  const rawSamples = Array.isArray(source.samples) ? source.samples : [];
  const samples = collectLatest(
    rawSamples,
    MAX_CRASH_BUNDLE_PERFORMANCE_SAMPLES,
    (sample) => isRecord(sample) ? sanitisePerformanceSample(sample) : null,
  );
  const pixelRatio = finiteNumber(source.pixelRatio);
  return {
    tierId: enumValue(source.tierId, PERFORMANCE_TIERS, 'unknown'),
    adaptiveResolutionEnabled: source.adaptiveResolutionEnabled === true,
    reducedMotion: source.reducedMotion === true,
    pixelRatio: Number(clamp(pixelRatio ?? 1, 0.25, 4).toFixed(3)),
    samples,
  };
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function assertCrashBundlePrivacySafe(value: unknown): void {
  const visit = (entry: unknown, path: string): void => {
    if (typeof entry === 'string') {
      if (containsSensitiveString(entry)) {
        throw new Error(`Crash bundle contains a sensitive string at ${path}.`);
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(entry)) {
      return;
    }
    for (const [key, child] of Object.entries(entry)) {
      if (FORBIDDEN_KEY_NAMES.has(normaliseKey(key))) {
        throw new Error(`Crash bundle contains forbidden field ${path}.${key}.`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, '$');
}

export function buildCrashBundle(input: BuildCrashBundleInput): CrashBundle {
  const bundle: CrashBundle = {
    schemaVersion: CRASH_BUNDLE_SCHEMA_VERSION,
    capturedAt: parseCapturedAt(input.capturedAt),
    identity: sanitiseIdentity(input.identity),
    failure: sanitiseFailure(input.failure),
    settings: sanitiseCrashSettings(input.settings),
    recentAcceptedInputs: collectLatest(
      input.recentAcceptedInputs,
      MAX_CRASH_BUNDLE_ACCEPTED_INPUTS,
      parseAcceptedInput,
    ),
    recentEvents: collectLatest(input.recentEvents, MAX_CRASH_BUNDLE_EVENTS, parseEvent),
    replay: sanitiseReplay(input.replay),
    checksum: sanitiseChecksum(input.checksum),
    capabilities: cloneRendererCapabilitySummary(input.capabilities),
    performance: sanitisePerformance(input.performance),
  };
  assertCrashBundlePrivacySafe(bundle);
  return bundle;
}
