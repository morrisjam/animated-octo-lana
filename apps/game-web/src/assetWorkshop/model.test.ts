import { describe, expect, test } from 'vitest';
import { CHARACTER_PRESENTATIONS } from '../content/characterPresentationRegistry';
import { resolveSpriteClipSheet } from '../view/sprites/atlasDefinitions';
import {
  buildAssetWorkshopCatalog,
  formatWorkshopLabel,
  stepWorkshopFrame,
} from './model';

describe('Asset Workshop model', () => {
  test('discovers every packaged presentation and exposes every clip', () => {
    const catalog = buildAssetWorkshopCatalog();

    expect(catalog.map((entry) => entry.characterId)).toEqual(
      CHARACTER_PRESENTATIONS.map((entry) => entry.characterId).sort(),
    );
    for (const character of catalog) {
      expect(character.clipIds).toEqual(Object.keys(character.animationSet.clips).sort());
      for (const clipId of character.clipIds) {
        expect(resolveSpriteClipSheet(character.animationSet, clipId)).not.toBeNull();
      }
    }
  });

  test('wraps manual frame stepping in both directions', () => {
    expect(stepWorkshopFrame(0, -1, 4)).toBe(3);
    expect(stepWorkshopFrame(3, 1, 4)).toBe(0);
    expect(stepWorkshopFrame(0, 1, 1)).toBe(0);
  });

  test('formats manifest ids for artist-facing controls', () => {
    expect(formatWorkshopLabel('launch_startup')).toBe('Launch Startup');
    expect(formatWorkshopLabel('super-boost')).toBe('Super Boost');
  });
});
