import { loadCharacterPackagesFromContent } from './characterPackageLoader';
import {
  assertCharacterPresentationCoverage,
  buildCharacterPresentationAssetEntries,
  loadCharacterPresentationsFromContent,
} from './characterPresentationLoader';

export const CHARACTER_PRESENTATIONS = loadCharacterPresentationsFromContent();

assertCharacterPresentationCoverage(loadCharacterPackagesFromContent(), CHARACTER_PRESENTATIONS);

export const CHARACTER_PRESENTATION_BY_CHARACTER_ID = new Map(
  CHARACTER_PRESENTATIONS.map((presentation) => [presentation.characterId, presentation]),
);

export const CHARACTER_PRESENTATION_BY_ANIMATION_SET_ID = new Map(
  CHARACTER_PRESENTATIONS.map((presentation) => [presentation.animationSet.id, presentation]),
);

export const CHARACTER_PRESENTATION_ASSET_ENTRIES = buildCharacterPresentationAssetEntries(
  CHARACTER_PRESENTATIONS,
);
