import type { CombatReadabilityCueId, CombatVfxPreset, VfxFlashShape } from './types';

function outline(shape: VfxFlashShape, color: string, opacity: number, radius = 3): CombatVfxPreset {
  return {
    flash: {
      shape, color, radius, thickness: 0.15, alignToDirection: shape === 'arc' || shape === 'chevron',
      lifetimeSeconds: 0.22, startScale: 1, endScale: 1.15, startOpacity: opacity, endOpacity: 0,
    },
  };
}

// One hollow, local silhouette per cue. No textures, particle clouds, or rhythmic flashing.
export const COMBAT_READABILITY_PRESETS: Record<CombatReadabilityCueId, CombatVfxPreset> = {
  launch_startup: outline('chevron', '#ffc247', 0.72),
  launched_vulnerable: outline('brackets', '#ff9b7a', 0.76, 3.4),
  attack_recovery: outline('brackets', '#a8b4ca', 0.42),
  attack_whiff: outline('broken_ring', '#a8b4ca', 0.62),
  parry_attempt: outline('arc', '#a9fff0', 0.38),
  parry_success: {
    ...outline('diamond', '#a9fff0', 0.82, 3.4),
    sound: { waveform: 'sine', frequencyHz: 880, durationSeconds: 0.07, gain: 0.02 },
  },
  break_spent: {
    ...outline('broken_ring', '#ff6262', 0.7, 3.4),
    sound: { waveform: 'triangle', frequencyHz: 740, durationSeconds: 0.07, gain: 0.022 },
  },
  break_ready: outline('ticks', '#e1f4ff', 0.64),
};

export const COMBAT_READABILITY_PRIORITY: Record<CombatReadabilityCueId, number> = {
  launch_startup: 1, parry_attempt: 1, attack_recovery: 1,
  attack_whiff: 2, break_spent: 2,
  launched_vulnerable: 3, parry_success: 3, break_ready: 3,
};

export const COMBAT_READABILITY_LEGEND: readonly { cue: CombatReadabilityCueId; label: string; path: string }[] = [
  { cue: 'launch_startup', label: 'Launch wind-up', path: 'M1 -3 L4 0 L1 3' },
  { cue: 'launched_vulnerable', label: 'Launched / vulnerable', path: 'M-2 -3 H-4 V3 H-2 M2 -3 H4 V3 H2' },
  { cue: 'attack_recovery', label: 'Attack recovery', path: 'M-2 -3 H-4 V3 H-2 M2 -3 H4 V3 H2' },
  { cue: 'attack_whiff', label: 'Missed attack', path: 'M-3 -1 A3 3 0 0 1 -1 -3 M1 -3 A3 3 0 0 1 3 -1 M3 1 A3 3 0 0 1 1 3 M-1 3 A3 3 0 0 1 -3 1' },
  { cue: 'parry_attempt', label: 'Guard attempt', path: 'M2 -3 Q5 0 2 3' },
  { cue: 'parry_success', label: 'Parry confirmed', path: 'M0 -4 L4 0 L0 4 L-4 0 Z' },
  { cue: 'break_spent', label: 'Break spent', path: 'M-3 -1 A3 3 0 0 1 -1 -3 M1 -3 A3 3 0 0 1 3 -1 M3 1 A3 3 0 0 1 1 3 M-1 3 A3 3 0 0 1 -3 1' },
  { cue: 'break_ready', label: 'Break recovery ended', path: 'M-3 -2 V2 M3 -2 V2' },
];
