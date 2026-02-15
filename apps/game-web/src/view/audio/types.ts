import type { PlayerId } from '../../sim/types';

export type AudioBusId = 'master' | 'music' | 'sfx' | 'voice';

export type AudioEventType =
  | 'combat.boost'
  | 'combat.launch'
  | 'combat.parry'
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

export interface AudioEvent {
  type: AudioEventType;
  playerId?: PlayerId;
  pan?: number;
  cueOverride?: AudioToneCue;
}

export interface AudioRoute {
  bus: AudioBusId;
  cue?: AudioToneCue;
}

export type AudioRouteTable = Partial<Record<AudioEventType, AudioRoute>>;

export interface AudioDiagnostics {
  emittedEvents: number;
  routedEvents: number;
  missingRoutes: number;
  lastMissingType: AudioEventType | null;
}
