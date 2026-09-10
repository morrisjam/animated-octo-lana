import type { CharacterId } from '../../sim/characters';
import type { PlayerId, Vec2 } from '../../sim/types';

export type CombatVfxEventType =
  | 'boost'
  | 'super_boost'
  | 'launch'
  | 'clash'
  | 'parry'
  | 'special'
  | 'break'
  | 'projectile'
  | 'dunk';

export interface CombatVfxEvent {
  type: CombatVfxEventType;
  playerId: PlayerId;
  characterId: CharacterId;
  position: Vec2;
  direction: Vec2;
  projectileVisualId?: string;
  readabilityCue?: CombatReadabilityCueId;
}

export type CombatReadabilityCueId = 'launch_startup' | 'launched_vulnerable'
  | 'attack_recovery' | 'attack_whiff' | 'parry_attempt' | 'parry_success'
  | 'break_spent' | 'break_ready';

export type VfxFlashShape = 'ring' | 'arc' | 'chevron' | 'brackets' | 'diamond' | 'broken_ring' | 'ticks';

export interface VfxParticlePreset {
  color: string;
  textureId?: string;
  flipbook?: {
    columns: number;
    rows: number;
    frameCount: number;
    framesPerSecond: number;
    loop?: boolean;
  };
  lifetimeSeconds: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  endOpacity: number;
  driftAlongDirection: number;
  driftVertical: number;
}

export interface VfxTrailPreset {
  color: string;
  width: number;
  length: number;
  lifetimeSeconds: number;
  startOpacity: number;
  endOpacity: number;
}

export interface VfxFlashPreset {
  color: string;
  shape?: VfxFlashShape;
  alignToDirection?: boolean;
  radius: number;
  thickness: number;
  lifetimeSeconds: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  endOpacity: number;
}

export interface VfxSoundCuePreset {
  waveform: OscillatorType;
  frequencyHz: number;
  durationSeconds: number;
  gain: number;
}

export interface CombatVfxPreset {
  particles?: VfxParticlePreset;
  trail?: VfxTrailPreset;
  flash?: VfxFlashPreset;
  sound?: VfxSoundCuePreset;
}

export type CombatVfxPresetMap = Record<string, CombatVfxPreset>;

