import type { PlayerId } from '../../sim/types';

export type AudioBusId = 'master' | 'music' | 'sfx' | 'voice';

export const AUDIO_SAMPLE_LIBRARY_SCHEMA_VERSION = 1 as const;

export type AudioEventType =
  | 'combat.boost'
  | 'combat.super_boost'
  | 'combat.launch'
  | 'combat.clash'
  | 'combat.parry'
  | 'combat.special'
  | 'combat.break'
  | 'combat.projectile'
  | 'combat.dunk'
  | 'music.menu'
  | 'music.match'
  | 'music.neutral'
  | 'music.launch'
  | 'music.end'
  | 'voice.round_start'
  | 'voice.callout';

export interface AudioToneCue {
  waveform: OscillatorType;
  frequencyHz: number;
  durationSeconds: number;
  gain: number;
}

export interface AudioSampleSourceV1 {
  src: string;
  mimeType: string;
}

export interface AudioSampleVariantV1 {
  id: string;
  sources: readonly AudioSampleSourceV1[];
}

export type AudioSampleOverflowPolicy = 'drop-new' | 'steal-oldest';

export interface AudioSampleDefinitionV1 {
  id: string;
  variants: readonly AudioSampleVariantV1[];
  maxConcurrent?: number;
  overflowPolicy?: AudioSampleOverflowPolicy;
}

export interface AudioSampleLibraryV1 {
  schemaVersion: typeof AUDIO_SAMPLE_LIBRARY_SCHEMA_VERSION;
  samples: readonly AudioSampleDefinitionV1[];
}

export type AudioSampleLibrary = AudioSampleLibraryV1;

export interface AudioSampleCue {
  sampleId: string;
  defaultVariantId?: string;
  gain?: number;
  playbackRate?: number;
}

export interface AudioEvent {
  type: AudioEventType;
  playerId?: PlayerId;
  pan?: number;
  cueOverride?: AudioToneCue;
  sampleVariantId?: string;
}

export interface AudioRoute {
  bus: AudioBusId;
  cue?: AudioToneCue;
  sample?: AudioSampleCue;
}

export type AudioRouteTable = Partial<Record<AudioEventType, AudioRoute>>;

export interface AudioDiagnostics {
  emittedEvents: number;
  routedEvents: number;
  missingRoutes: number;
  lastMissingType: AudioEventType | null;
  sampledPlays: number;
  tonePlays: number;
  sampleFallbacks: number;
  sampleConcurrencyDrops: number;
  sampleLoadFailures: number;
  unlockAttempts: number;
  unlockSuccesses: number;
}

export type AudioSinkDiagnostics = Pick<
  AudioDiagnostics,
  | 'sampledPlays'
  | 'tonePlays'
  | 'sampleFallbacks'
  | 'sampleConcurrencyDrops'
  | 'sampleLoadFailures'
  | 'unlockAttempts'
  | 'unlockSuccesses'
>;

export interface AudioSamplePreloadFailure {
  sampleId: string;
  variantId: string | null;
  reason: string;
}

export interface AudioSamplePreloadResult {
  requestedSampleIds: string[];
  loadedVariants: number;
  failures: AudioSamplePreloadFailure[];
}
