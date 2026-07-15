import type { CharacterId } from '../../sim/characters';
import type { PlayerId, Vec2 } from '../../sim/types';

export type CombatVfxEventType = 'boost' | 'launch' | 'clash' | 'parry' | 'special' | 'break' | 'projectile' | 'dunk';

export interface CombatVfxEvent {
  type: CombatVfxEventType;
  playerId: PlayerId;
  characterId: CharacterId;
  position: Vec2;
  direction: Vec2;
  projectileVisualId?: string;
}

export interface VfxParticlePreset {
  color: string;
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

