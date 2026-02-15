import { describe, expect, test } from 'vitest';
import { DEFAULT_AUDIO_SETTINGS, sanitiseAudioSettings } from './settings';

describe('audio settings sanitisation', () => {
  test('clamps volume ranges and keeps supported flags', () => {
    const sanitised = sanitiseAudioSettings({
      masterVolume: 1.5,
      musicVolume: -0.2,
      sfxVolume: 0.66,
      voiceVolume: 0.2,
      voiceDuckingEnabled: true,
      dynamicRangeMode: 'reduced',
      subtitlesEnabled: false,
    });

    expect(sanitised.masterVolume).toBe(1);
    expect(sanitised.musicVolume).toBe(0);
    expect(sanitised.sfxVolume).toBe(0.66);
    expect(sanitised.voiceVolume).toBe(0.2);
    expect(sanitised.voiceDuckingEnabled).toBe(true);
    expect(sanitised.dynamicRangeMode).toBe('reduced');
    expect(sanitised.subtitlesEnabled).toBe(false);
  });

  test('falls back to defaults for invalid payloads', () => {
    const sanitised = sanitiseAudioSettings({
      masterVolume: 'bad',
      dynamicRangeMode: 'nope',
      subtitlesEnabled: 'bad',
    });

    expect(sanitised).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

