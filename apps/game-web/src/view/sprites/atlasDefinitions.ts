import {
  REQUIRED_CHARACTER_PRESENTATION_STATES,
  type CharacterPresentationAtlas,
  type CharacterPresentationStateKey,
  type SpriteAnimationClip,
} from '../../content/characterPresentationSchema';
import { CHARACTER_PRESENTATIONS } from '../../content/characterPresentationRegistry';
import type { PlayerRenderSnapshot } from '../../sim/types';

export type SpriteClipId = string;
export type { SpriteAnimationClip };

export interface SpriteAtlasSheet {
  id: string;
  textureUrl: string;
  columns: number;
  rows: number;
  atlasWidthPixels: number;
  atlasHeightPixels: number;
  frameWidthPixels: number;
  frameHeightPixels: number;
  marginPixels: number;
  spacingPixels: number;
  worldWidth: number;
  worldHeight: number;
  anchorX: number;
  anchorY: number;
}

export interface SpriteAnimationSet {
  id: string;
  defaultSheetId: string;
  sheets: Record<string, SpriteAtlasSheet>;
  clips: Record<SpriteClipId, SpriteAnimationClip>;
  stateClips: Partial<Record<CharacterPresentationStateKey, SpriteClipId>>;
}

export interface SpriteFrameSelection {
  clipId: SpriteClipId;
  clip: SpriteAnimationClip;
  sheetId: string;
  sheet: SpriteAtlasSheet;
  frameIndex: number;
  frame: number;
}

function toSpriteAtlasSheet(atlas: CharacterPresentationAtlas): SpriteAtlasSheet {
  return {
    id: atlas.id,
    textureUrl: atlas.src,
    columns: atlas.columns,
    rows: atlas.rows,
    atlasWidthPixels: atlas.widthPixels,
    atlasHeightPixels: atlas.heightPixels,
    frameWidthPixels: atlas.frameWidthPixels,
    frameHeightPixels: atlas.frameHeightPixels,
    marginPixels: atlas.marginPixels,
    spacingPixels: atlas.spacingPixels,
    worldWidth: atlas.worldWidth,
    worldHeight: atlas.worldHeight,
    anchorX: atlas.anchorX,
    anchorY: atlas.anchorY,
  };
}

const SPRITE_ANIMATION_SETS = CHARACTER_PRESENTATIONS.map(({ animationSet }) => ({
  id: animationSet.id,
  defaultSheetId: animationSet.atlas.id,
  sheets: Object.fromEntries(
    Object.values(animationSet.sheets).map((sheet) => [sheet.id, toSpriteAtlasSheet(sheet)]),
  ),
  clips: animationSet.clips,
  stateClips: animationSet.stateClips,
} satisfies SpriteAnimationSet));

const SPRITE_ANIMATION_SET_BY_ID = new Map(
  SPRITE_ANIMATION_SETS.map((animationSet) => [animationSet.id, animationSet]),
);

export function resolveSpriteAnimationSet(animationSetId: string): SpriteAnimationSet | null {
  return SPRITE_ANIMATION_SET_BY_ID.get(animationSetId) ?? null;
}

export function resolveSpriteClip(
  animationSet: SpriteAnimationSet,
  snapshot: PlayerRenderSnapshot,
): SpriteClipId {
  const state = `${snapshot.presentationAction}.${snapshot.presentationPhase}` as CharacterPresentationStateKey;
  return animationSet.stateClips[state]
    ?? animationSet.stateClips['idle.none']
    ?? 'idle';
}

export function resolveSpriteSheet(
  animationSet: SpriteAnimationSet,
  sheetId: string,
): SpriteAtlasSheet | null {
  return animationSet.sheets[sheetId] ?? null;
}

export function resolveSpriteClipSheet(
  animationSet: SpriteAnimationSet,
  clipId: SpriteClipId,
): SpriteAtlasSheet | null {
  const clip = animationSet.clips[clipId];
  return clip ? resolveSpriteSheet(animationSet, clip.sheetId) : null;
}

export function resolveSpriteFrameIndex(
  clip: SpriteAnimationClip,
  elapsedSeconds: number,
  phase = 0,
): number {
  const rawIndex = Math.max(0, Math.floor((Math.max(0, elapsedSeconds) + phase) * clip.fps));
  return clip.loop
    ? rawIndex % clip.frames.length
    : Math.min(rawIndex, clip.frames.length - 1);
}

export function resolveSpriteFrame(
  animationSet: SpriteAnimationSet,
  clipId: SpriteClipId,
  elapsedSeconds: number,
  phase = 0,
): number {
  const clip = animationSet.clips[clipId];
  if (!clip) {
    return 0;
  }
  return clip.frames[resolveSpriteFrameIndex(clip, elapsedSeconds, phase)];
}

export function resolveSpriteFrameSelection(
  animationSet: SpriteAnimationSet,
  clipId: SpriteClipId,
  elapsedSeconds: number,
  phase = 0,
): SpriteFrameSelection | null {
  const clip = animationSet.clips[clipId];
  if (!clip) {
    return null;
  }
  const sheet = resolveSpriteSheet(animationSet, clip.sheetId);
  if (!sheet) {
    return null;
  }
  const frameIndex = resolveSpriteFrameIndex(clip, elapsedSeconds, phase);
  return {
    clipId,
    clip,
    sheetId: clip.sheetId,
    sheet,
    frameIndex,
    frame: clip.frames[frameIndex],
  };
}

export function validateSpriteAnimationSet(animationSet: SpriteAnimationSet): string[] {
  const issues: string[] = [];
  if (!animationSet.sheets[animationSet.defaultSheetId]) {
    issues.push('defaultSheetId must reference a declared sprite sheet');
  }
  for (const sheet of Object.values(animationSet.sheets)) {
    const frameCount = sheet.columns * sheet.rows;
    if (sheet.columns < 1 || sheet.rows < 1) {
      issues.push(`${sheet.id} must contain at least one row and column`);
    }
    const requiredWidth = sheet.marginPixels * 2
      + sheet.columns * sheet.frameWidthPixels
      + Math.max(0, sheet.columns - 1) * sheet.spacingPixels;
    const requiredHeight = sheet.marginPixels * 2
      + sheet.rows * sheet.frameHeightPixels
      + Math.max(0, sheet.rows - 1) * sheet.spacingPixels;
    if (requiredWidth > sheet.atlasWidthPixels || requiredHeight > sheet.atlasHeightPixels) {
      issues.push(`${sheet.id} frame layout exceeds declared image dimensions`);
    }
    if (frameCount < 1) {
      issues.push(`${sheet.id} must contain at least one frame`);
    }
  }
  for (const [clipId, clip] of Object.entries(animationSet.clips)) {
    if (clip.frames.length === 0) {
      issues.push(`${clipId} must contain at least one frame`);
      continue;
    }
    if (clip.fps <= 0) {
      issues.push(`${clipId}.fps must be greater than zero`);
    }
    const sheet = animationSet.sheets[clip.sheetId];
    if (!sheet) {
      issues.push(`${clipId}.sheetId must reference a declared sprite sheet`);
      continue;
    }
    const frameCount = sheet.columns * sheet.rows;
    for (const frame of clip.frames) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
        issues.push(`${clipId} frame ${frame} is outside ${sheet.id} bounds 0-${frameCount - 1}`);
      }
    }
  }
  for (const state of REQUIRED_CHARACTER_PRESENTATION_STATES) {
    const clipId = animationSet.stateClips[state];
    if (!clipId || !animationSet.clips[clipId]) {
      issues.push(`${state} must reference a declared clip`);
    }
  }
  return issues;
}

export function getSpriteAnimationSets(): SpriteAnimationSet[] {
  return [...SPRITE_ANIMATION_SETS];
}
