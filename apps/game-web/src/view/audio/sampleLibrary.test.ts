import { describe, expect, test } from 'vitest';
import {
  createAudioSampleLibraryIndex,
  orderAudioSampleSources,
  selectAudioSampleVariant,
} from './sampleLibrary';
import type { AudioSampleDefinitionV1, AudioSampleLibrary } from './types';

const SAMPLE: AudioSampleDefinitionV1 = {
  id: 'combat_launch',
  variants: [
    {
      id: 'light',
      sources: [{ src: '/audio/launch-light.ogg', mimeType: 'audio/ogg; codecs=opus' }],
    },
    {
      id: 'heavy',
      sources: [{ src: '/audio/launch-heavy.mp3', mimeType: 'audio/mpeg' }],
    },
  ],
};

describe('audio sample library', () => {
  test('indexes valid schema-v1 definitions and selects only the requested variant', () => {
    const library: AudioSampleLibrary = {
      schemaVersion: 1,
      samples: [SAMPLE],
    };

    const index = createAudioSampleLibraryIndex(library);

    expect(index.get('combat_launch')).toBe(SAMPLE);
    expect(selectAudioSampleVariant(SAMPLE)?.id).toBe('light');
    expect(selectAudioSampleVariant(SAMPLE, 'heavy')?.id).toBe('heavy');
    expect(selectAudioSampleVariant(SAMPLE, 'missing')).toBeNull();
  });

  test('rejects unsupported schemas, duplicate variants, and non-audio sources', () => {
    expect(() => createAudioSampleLibraryIndex({
      schemaVersion: 2,
      samples: [],
    } as unknown as AudioSampleLibrary)).toThrow('Unsupported sample library schema');

    expect(() => createAudioSampleLibraryIndex({
      schemaVersion: 1,
      samples: [{
        id: 'bad',
        variants: [SAMPLE.variants[0]!, SAMPLE.variants[0]!],
      }],
    })).toThrow('Duplicate variant id');

    expect(() => createAudioSampleLibraryIndex({
      schemaVersion: 1,
      samples: [{
        id: 'bad',
        variants: [{
          id: 'default',
          sources: [{ src: '/not-audio.txt', mimeType: 'text/plain' }],
        }],
      }],
    })).toThrow('must start with "audio/"');
  });

  test('prefers browser-supported formats while preserving every fallback source', () => {
    const sources = [
      { src: '/clip.wav', mimeType: 'audio/wav' },
      { src: '/clip.mp3', mimeType: 'audio/mpeg' },
      { src: '/clip.ogg', mimeType: 'audio/ogg; codecs=opus' },
    ];

    const ordered = orderAudioSampleSources(sources, (mimeType) => {
      if (mimeType === 'audio/mpeg') {
        return 'probably';
      }
      if (mimeType.startsWith('audio/ogg')) {
        return 'maybe';
      }
      return '';
    });

    expect(ordered.map((source) => source.src)).toEqual([
      '/clip.mp3',
      '/clip.ogg',
      '/clip.wav',
    ]);
  });
});
