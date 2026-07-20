import type { CharacterPresentationDefinition } from '../content/characterPresentationLoader';
import { CHARACTER_PRESENTATIONS } from '../content/characterPresentationRegistry';
import {
  resolveSpriteAnimationSet,
  resolveSpriteClipSheet,
  type SpriteAnimationSet,
  type SpriteClipId,
} from '../view/sprites/atlasDefinitions';

export interface AssetWorkshopCharacter {
  characterId: string;
  source: string;
  animationSet: SpriteAnimationSet;
  clipIds: SpriteClipId[];
}

export function buildAssetWorkshopCatalog(
  presentations: CharacterPresentationDefinition[] = CHARACTER_PRESENTATIONS,
): AssetWorkshopCharacter[] {
  return presentations.map((presentation) => {
    const animationSet = resolveSpriteAnimationSet(presentation.animationSet.id);
    if (!animationSet) {
      throw new Error(`Asset Workshop could not resolve animation set "${presentation.animationSet.id}".`);
    }
    const clipIds = Object.keys(animationSet.clips).sort((first, second) => first.localeCompare(second));
    for (const clipId of clipIds) {
      if (!resolveSpriteClipSheet(animationSet, clipId)) {
        throw new Error(`Asset Workshop clip "${clipId}" has no declared sprite sheet.`);
      }
    }
    return {
      characterId: presentation.characterId,
      source: presentation.source,
      animationSet,
      clipIds,
    };
  }).sort((first, second) => first.characterId.localeCompare(second.characterId));
}

export function stepWorkshopFrame(
  currentFrameIndex: number,
  direction: -1 | 1,
  frameCount: number,
): number {
  if (frameCount <= 1) {
    return 0;
  }
  return (currentFrameIndex + direction + frameCount) % frameCount;
}

export function formatWorkshopLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
