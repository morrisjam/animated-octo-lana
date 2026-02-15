import { CHARACTER_BY_ID } from '../../sim/characters';
import type { CombatVfxEvent, CombatVfxEventType, CombatVfxPresetMap } from './types';

export const COMBAT_VFX_PRESET_LIBRARY: CombatVfxPresetMap = {
  boost_core: {
    particles: {
      color: '#7bc2ff',
      lifetimeSeconds: 0.2,
      startScale: 1.1,
      endScale: 3.2,
      startOpacity: 0.72,
      endOpacity: 0.05,
      driftAlongDirection: 10,
      driftVertical: 0.5,
    },
    trail: {
      color: '#5dafff',
      width: 0.5,
      length: 5.6,
      lifetimeSeconds: 0.16,
      startOpacity: 0.52,
      endOpacity: 0.03,
    },
    flash: {
      color: '#8fd2ff',
      radius: 1.8,
      thickness: 0.13,
      lifetimeSeconds: 0.16,
      startScale: 0.95,
      endScale: 1.9,
      startOpacity: 0.6,
      endOpacity: 0.06,
    },
    sound: {
      waveform: 'sawtooth',
      frequencyHz: 260,
      durationSeconds: 0.09,
      gain: 0.018,
    },
  },
  launch_strike: {
    particles: {
      color: '#ffd06b',
      lifetimeSeconds: 0.28,
      startScale: 1.8,
      endScale: 4.2,
      startOpacity: 0.8,
      endOpacity: 0.08,
      driftAlongDirection: 4.2,
      driftVertical: 1.2,
    },
    trail: {
      color: '#ffc86a',
      width: 0.42,
      length: 4.6,
      lifetimeSeconds: 0.2,
      startOpacity: 0.55,
      endOpacity: 0.08,
    },
    flash: {
      color: '#ffce7a',
      radius: 2.7,
      thickness: 0.2,
      lifetimeSeconds: 0.22,
      startScale: 1,
      endScale: 2.15,
      startOpacity: 0.86,
      endOpacity: 0.07,
    },
    sound: {
      waveform: 'triangle',
      frequencyHz: 380,
      durationSeconds: 0.12,
      gain: 0.026,
    },
  },
  launch_arcane: {
    particles: {
      color: '#b4a0ff',
      lifetimeSeconds: 0.32,
      startScale: 2,
      endScale: 4.8,
      startOpacity: 0.84,
      endOpacity: 0.1,
      driftAlongDirection: 3.2,
      driftVertical: 1.4,
    },
    trail: {
      color: '#9b87ff',
      width: 0.48,
      length: 5,
      lifetimeSeconds: 0.24,
      startOpacity: 0.58,
      endOpacity: 0.09,
    },
    flash: {
      color: '#c3afff',
      radius: 3,
      thickness: 0.18,
      lifetimeSeconds: 0.25,
      startScale: 1,
      endScale: 2.3,
      startOpacity: 0.86,
      endOpacity: 0.08,
    },
    sound: {
      waveform: 'square',
      frequencyHz: 340,
      durationSeconds: 0.13,
      gain: 0.024,
    },
  },
  parry_guard: {
    particles: {
      color: '#b7fff5',
      lifetimeSeconds: 0.24,
      startScale: 1.4,
      endScale: 3.7,
      startOpacity: 0.72,
      endOpacity: 0.06,
      driftAlongDirection: 0,
      driftVertical: 0.9,
    },
    trail: {
      color: '#a6fff2',
      width: 0.35,
      length: 3.2,
      lifetimeSeconds: 0.16,
      startOpacity: 0.46,
      endOpacity: 0.04,
    },
    flash: {
      color: '#cbfff7',
      radius: 2.35,
      thickness: 0.16,
      lifetimeSeconds: 0.2,
      startScale: 1,
      endScale: 2,
      startOpacity: 0.8,
      endOpacity: 0.05,
    },
    sound: {
      waveform: 'triangle',
      frequencyHz: 530,
      durationSeconds: 0.1,
      gain: 0.02,
    },
  },
  projectile_cast: {
    particles: {
      color: '#7ad1ff',
      lifetimeSeconds: 0.2,
      startScale: 1.1,
      endScale: 2.6,
      startOpacity: 0.66,
      endOpacity: 0.05,
      driftAlongDirection: 2,
      driftVertical: 0.5,
    },
    trail: {
      color: '#6ebdfd',
      width: 0.3,
      length: 4.4,
      lifetimeSeconds: 0.26,
      startOpacity: 0.5,
      endOpacity: 0.06,
    },
    flash: {
      color: '#a5e0ff',
      radius: 1.6,
      thickness: 0.12,
      lifetimeSeconds: 0.16,
      startScale: 1,
      endScale: 1.7,
      startOpacity: 0.58,
      endOpacity: 0.04,
    },
    sound: {
      waveform: 'sine',
      frequencyHz: 450,
      durationSeconds: 0.09,
      gain: 0.018,
    },
  },
  dunk_impact: {
    particles: {
      color: '#8cffbf',
      lifetimeSeconds: 0.28,
      startScale: 2,
      endScale: 4.5,
      startOpacity: 0.85,
      endOpacity: 0.08,
      driftAlongDirection: 2.2,
      driftVertical: 1.3,
    },
    trail: {
      color: '#81f8b7',
      width: 0.44,
      length: 4.9,
      lifetimeSeconds: 0.2,
      startOpacity: 0.56,
      endOpacity: 0.07,
    },
    flash: {
      color: '#b5ffd2',
      radius: 2.85,
      thickness: 0.2,
      lifetimeSeconds: 0.24,
      startScale: 1,
      endScale: 2.2,
      startOpacity: 0.84,
      endOpacity: 0.08,
    },
    sound: {
      waveform: 'triangle',
      frequencyHz: 240,
      durationSeconds: 0.12,
      gain: 0.028,
    },
  },
};

export const COMBAT_VFX_EVENT_BINDINGS: Record<CombatVfxEventType, string> = {
  boost: 'boost_core',
  launch: 'launch_strike',
  parry: 'parry_guard',
  projectile: 'projectile_cast',
  dunk: 'dunk_impact',
};

export const CHARACTER_VFX_EVENT_OVERRIDES: Record<string, Partial<Record<CombatVfxEventType, string>>> = {
  character_ace_vfx: {
    launch: 'launch_arcane',
  },
};

export function resolveCombatVfxPresetId(event: CombatVfxEvent): string {
  const profileId = CHARACTER_BY_ID[event.characterId]?.visuals.vfxProfileId;
  const profileOverride = profileId ? CHARACTER_VFX_EVENT_OVERRIDES[profileId]?.[event.type] : undefined;
  return profileOverride ?? COMBAT_VFX_EVENT_BINDINGS[event.type];
}

export function resolveCombatVfxPreset(event: CombatVfxEvent) {
  const presetId = resolveCombatVfxPresetId(event);
  return COMBAT_VFX_PRESET_LIBRARY[presetId] ?? COMBAT_VFX_PRESET_LIBRARY[COMBAT_VFX_EVENT_BINDINGS[event.type]];
}

