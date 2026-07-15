import type { PlayerRenderSnapshot } from '../../sim/types';

export const SPRITE_CLIP_IDS = [
  'idle',
  'boost',
  'launch',
  'parry',
  'break',
  'special',
  'dunk',
  'helpless',
  'recover',
] as const;

export type SpriteClipId = (typeof SPRITE_CLIP_IDS)[number];

export interface SpriteAnimationClip {
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface SpriteAnimationSet {
  id: string;
  textureUrl: string;
  columns: number;
  rows: number;
  worldWidth: number;
  worldHeight: number;
  clips: Record<SpriteClipId, SpriteAnimationClip>;
}

function createClips(): Record<SpriteClipId, SpriteAnimationClip> {
  return {
    idle: { frames: [0, 1], fps: 3, loop: true },
    boost: { frames: [1, 2], fps: 9, loop: true },
    launch: { frames: [3], fps: 1, loop: false },
    parry: { frames: [4], fps: 1, loop: false },
    break: { frames: [4], fps: 1, loop: false },
    special: { frames: [5], fps: 1, loop: false },
    dunk: { frames: [6], fps: 1, loop: false },
    helpless: { frames: [7], fps: 1, loop: false },
    recover: { frames: [7], fps: 1, loop: false },
  };
}

const SPRITE_ANIMATION_SETS: Record<string, SpriteAnimationSet> = {
  character_vanguard_animset: {
    id: 'character_vanguard_animset',
    textureUrl: new URL('./vanguard-alpha-atlas.svg', import.meta.url).href,
    columns: 4,
    rows: 2,
    worldWidth: 7.4,
    worldHeight: 7.4,
    clips: createClips(),
  },
  character_duelist_animset: {
    id: 'character_duelist_animset',
    textureUrl: new URL('./duelist-alpha-atlas.svg', import.meta.url).href,
    columns: 4,
    rows: 2,
    worldWidth: 6.5,
    worldHeight: 7.2,
    clips: createClips(),
  },
};

export function resolveSpriteAnimationSet(animationSetId: string): SpriteAnimationSet | null {
  return SPRITE_ANIMATION_SETS[animationSetId] ?? null;
}

export function resolveSpriteClip(snapshot: PlayerRenderSnapshot): SpriteClipId {
  return snapshot.presentationAction;
}

export function resolveSpriteFrame(
  animationSet: SpriteAnimationSet,
  clipId: SpriteClipId,
  elapsedSeconds: number,
  phase = 0,
): number {
  const clip = animationSet.clips[clipId];
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
  for (const clipId of SPRITE_CLIP_IDS) {
    const clip = animationSet.clips[clipId];
    if (!clip || clip.frames.length === 0) {
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
  return issues;
}

export function getSpriteAnimationSets(): SpriteAnimationSet[] {
  return Object.values(SPRITE_ANIMATION_SETS);
}
