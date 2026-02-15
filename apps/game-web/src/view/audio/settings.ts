export type DynamicRangeMode = 'wide' | 'reduced';

export interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  voiceDuckingEnabled: boolean;
  dynamicRangeMode: DynamicRangeMode;
  subtitlesEnabled: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 1,
  musicVolume: 0.7,
  sfxVolume: 0.85,
  voiceVolume: 0.9,
  voiceDuckingEnabled: true,
  dynamicRangeMode: 'wide',
  subtitlesEnabled: true,
};

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }
  return fallback;
}

function coerceDynamicRange(value: unknown, fallback: DynamicRangeMode): DynamicRangeMode {
  if (value === 'wide' || value === 'reduced') {
    return value;
  }
  return fallback;
}

export function sanitiseAudioSettings(value: unknown): AudioSettings {
  const root = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};

  return {
    masterVolume: clampVolume(root.masterVolume, DEFAULT_AUDIO_SETTINGS.masterVolume),
    musicVolume: clampVolume(root.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
    sfxVolume: clampVolume(root.sfxVolume, DEFAULT_AUDIO_SETTINGS.sfxVolume),
    voiceVolume: clampVolume(root.voiceVolume, DEFAULT_AUDIO_SETTINGS.voiceVolume),
    voiceDuckingEnabled: coerceBoolean(root.voiceDuckingEnabled, DEFAULT_AUDIO_SETTINGS.voiceDuckingEnabled),
    dynamicRangeMode: coerceDynamicRange(root.dynamicRangeMode, DEFAULT_AUDIO_SETTINGS.dynamicRangeMode),
    subtitlesEnabled: coerceBoolean(root.subtitlesEnabled, DEFAULT_AUDIO_SETTINGS.subtitlesEnabled),
  };
}

