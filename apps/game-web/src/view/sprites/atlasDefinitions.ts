import {
  REQUIRED_CHARACTER_PRESENTATION_STATES,
  type CharacterPresentationStateKey,
  type SpriteAnimationClip,
} from '../../content/characterPresentationSchema';
import { CHARACTER_PRESENTATIONS } from '../../content/characterPresentationRegistry';
import type { PlayerRenderSnapshot } from '../../sim/types';

export type SpriteClipId = string;
export type { SpriteAnimationClip };

export interface SpriteAnimationSet {
  id: string;
  assetId: string;
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
  clips: Record<SpriteClipId, SpriteAnimationClip>;
  stateClips: Partial<Record<CharacterPresentationStateKey, SpriteClipId>>;
}

const SPRITE_ANIMATION_SETS = CHARACTER_PRESENTATIONS.map(({ animationSet }) => ({
  id: animationSet.id,
  assetId: animationSet.atlas.id,
  textureUrl: animationSet.atlas.src,
  columns: animationSet.atlas.columns,
  rows: animationSet.atlas.rows,
  atlasWidthPixels: animationSet.atlas.widthPixels,
  atlasHeightPixels: animationSet.atlas.heightPixels,
  frameWidthPixels: animationSet.atlas.frameWidthPixels,
  frameHeightPixels: animationSet.atlas.frameHeightPixels,
  marginPixels: animationSet.atlas.marginPixels,
  spacingPixels: animationSet.atlas.spacingPixels,
  worldWidth: animationSet.atlas.worldWidth,
  worldHeight: animationSet.atlas.worldHeight,
  anchorX: animationSet.atlas.anchorX,
  anchorY: animationSet.atlas.anchorY,
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
  const rawIndex = Math.max(0, Math.floor((Math.max(0, elapsedSeconds) + phase) * clip.fps));
  const frameIndex = clip.loop
    ? rawIndex % clip.frames.length
    : Math.min(rawIndex, clip.frames.length - 1);
  return clip.frames[frameIndex];
}

export function validateSpriteAnimationSet(animationSet: SpriteAnimationSet): string[] {
  const issues: string[] = [];
  const frameCount = animationSet.columns * animationSet.rows;
  if (animationSet.columns < 1 || animationSet.rows < 1) {
    issues.push('atlas dimensions must contain at least one row and column');
  }
  const requiredWidth = animationSet.marginPixels * 2
    + animationSet.columns * animationSet.frameWidthPixels
    + Math.max(0, animationSet.columns - 1) * animationSet.spacingPixels;
  const requiredHeight = animationSet.marginPixels * 2
    + animationSet.rows * animationSet.frameHeightPixels
    + Math.max(0, animationSet.rows - 1) * animationSet.spacingPixels;
  if (requiredWidth > animationSet.atlasWidthPixels || requiredHeight > animationSet.atlasHeightPixels) {
    issues.push('atlas frame layout exceeds declared image dimensions');
  }
  for (const [clipId, clip] of Object.entries(animationSet.clips)) {
    if (clip.frames.length === 0) {
      issues.push(`${clipId} must contain at least one frame`);
      continue;
    }
    if (clip.fps <= 0) {
      issues.push(`${clipId}.fps must be greater than zero`);
    }
    for (const frame of clip.frames) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
        issues.push(`${clipId} frame ${frame} is outside atlas bounds 0-${frameCount - 1}`);
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
