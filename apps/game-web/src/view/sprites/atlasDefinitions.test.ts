import { describe, expect, test } from 'vitest';
import type { PlayerRenderSnapshot } from '../../sim/types';
import {
  getSpriteAnimationSets,
  resolveSpriteAnimationSet,
  resolveSpriteClip,
  resolveSpriteClipSheet,
  resolveSpriteFrame,
  resolveSpriteFrameSelection,
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
      expect(Object.values(set.sheets).every(
        (sheet) => /^\/assets\/characters\/[^?#]+\?v=\d+$/.test(sheet.textureUrl),
      )).toBe(true);
      expect(Object.values(set.clips).every((clip) => Boolean(set.sheets[clip.sheetId]))).toBe(true);
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
    // Early dunk recovery prefers the crumple clip; late recovery and plain
    // end-lag (recovering === 0) stay on the shared recover clip.
    expect(resolveSpriteClip(set!, makeSnapshot({
      presentationAction: 'recover',
      presentationPhase: 'recovery',
      recovering: 1.2,
      recoveryProgress: 0.2,
    }))).toBe('dunked');
    expect(resolveSpriteClip(set!, makeSnapshot({
      presentationAction: 'recover',
      presentationPhase: 'recovery',
      recovering: 0.6,
      recoveryProgress: 0.7,
    }))).toBe('recover');
    expect(resolveSpriteFrame(set!, 'idle', 0)).toBe(0);
    expect(resolveSpriteFrame(set!, 'idle', 0.34)).toBe(2);
    expect(resolveSpriteFrame(set!, 'idle', 0.67)).toBe(5);
  });

  test('resolves frames and layout from the sheet selected by each clip', () => {
    const source = resolveSpriteAnimationSet('character_vanguard_animset');
    expect(source).not.toBeNull();
    const set = structuredClone(source!);
    const primary = set.sheets[set.defaultSheetId];
    set.sheets.combat_sheet = {
      ...primary,
      id: 'combat_sheet',
      textureUrl: '/assets/characters/vanguard/combat-sheet.png?v=1',
      columns: 1,
      rows: 2,
      atlasWidthPixels: primary.frameWidthPixels,
      atlasHeightPixels: primary.frameHeightPixels * 2,
      worldWidth: 8,
      anchorY: 0.2,
    };
    set.clips.launch_active = {
      frames: [0, 1],
      fps: 8,
      loop: false,
      sheetId: 'combat_sheet',
    };

    expect(validateSpriteAnimationSet(set)).toEqual([]);
    expect(resolveSpriteClipSheet(set, 'launch_active')).toMatchObject({
      id: 'combat_sheet',
      worldWidth: 8,
      anchorY: 0.2,
    });
    expect(resolveSpriteFrameSelection(set, 'launch_active', 0.13)).toMatchObject({
      sheetId: 'combat_sheet',
      frameIndex: 1,
      frame: 1,
    });
  });
});
