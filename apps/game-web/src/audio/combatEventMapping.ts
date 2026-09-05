import type { AudioEventType } from '../view/audio/types';
import type { CombatVfxEventType } from '../view/vfx/types';

export const COMBAT_AUDIO_EVENTS = {
  boost: 'combat.boost',
  super_boost: 'combat.super_boost',
  launch: 'combat.launch',
  clash: 'combat.clash',
  parry: 'combat.parry',
  special: 'combat.special',
  break: 'combat.break',
  projectile: 'combat.projectile',
  dunk: 'combat.dunk',
} as const satisfies Record<CombatVfxEventType, AudioEventType>;

export function toCombatAudioEventType(type: CombatVfxEventType): AudioEventType {
  return COMBAT_AUDIO_EVENTS[type];
}
