import { describe, expect, test } from 'vitest';
import type { PlayerRenderSnapshot } from '../../sim/types';
import {
  getSpriteAnimationSets,
  resolveSpriteAnimationSet,
  resolveSpriteClip,
  resolveSpriteFrame,
  validateSpriteAnimationSet,
} from './atlasDefinitions';

function makeSnapshot(overrides: Partial<PlayerRenderSnapshot> = {}): PlayerRenderSnapshot {
  return {
    id: 'P1',
    characterId: 'vanguard',
    pos: { x: 0, y: 0 },
    maxFuel: 100,
    fuel: 100,
    launchBreaks: 3,
    boostActive: false,
    superBoost: 0,
    helpless: 0,
    parry: 0,
    launchFlash: 0,
    parryFlash: 0,
    specialFlash: 0,
    breakFlash: 0,
    dunkFlash: 0,
    recovering: 0,
    recoveryProgress: 0,
    presentationAction: 'idle',
    presentationPhase: 'none',
    ...overrides,
  };
}

describe('sprite animation sets', () => {
  test('defines bounded clips for both packaged alpha characters', () => {
    const sets = getSpriteAnimationSets();
    expect(sets.map((set) => set.id).sort()).toEqual([
      'character_duelist_animset',
      'character_vanguard_animset',
    ]);
    for (const set of sets) {
      expect(validateSpriteAnimationSet(set)).toEqual([]);
      expect(set.textureUrl).toMatch(/^\/assets\/characters\/.+-alpha-atlas\.svg\?v=1$/);
    }
  });

  test('selects combat clips by priority and advances looping frames deterministically', () => {
    const set = resolveSpriteAnimationSet('character_vanguard_animset');
    expect(set).not.toBeNull();
    expect(resolveSpriteClip(set!, makeSnapshot({ presentationAction: 'boost', presentationPhase: 'sustain' }))).toBe('boost');
    expect(resolveSpriteClip(set!, makeSnapshot({ presentationAction: 'launch', presentationPhase: 'startup' }))).toBe('launch_startup');
    expect(resolveSpriteClip(set!, makeSnapshot({ presentationAction: 'launch', presentationPhase: 'active' }))).toBe('launch_active');
    expect(resolveSpriteClip(set!, makeSnapshot({ presentationAction: 'helpless', presentationPhase: 'sustain' }))).toBe('helpless');
    expect(resolveSpriteClip(set!, makeSnapshot({ presentationAction: 'recover', presentationPhase: 'recovery' }))).toBe('recover');
    expect(resolveSpriteFrame(set!, 'idle', 0)).toBe(0);
    expect(resolveSpriteFrame(set!, 'idle', 0.34)).toBe(1);
    expect(resolveSpriteFrame(set!, 'idle', 0.67)).toBe(0);
  });
});
