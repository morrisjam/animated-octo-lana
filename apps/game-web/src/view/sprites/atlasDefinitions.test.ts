import { describe, expect, test } from 'vitest';
import type { PlayerRenderSnapshot } from '../../sim/types';
import {
  getSpriteAnimationSets,
  resolveSpriteAnimationSet,
  resolveSpriteClip,
  resolveSpriteClipSheet,
  resolveSpriteElapsedSeconds,
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
    expect(resolveSpriteClip(set!, makeSnapshot({ presentationAction: 'recover', presentationPhase: 'recovery' }))).toBe('attack_recovery');
    // Only victim recovery can use crumple/get-up imagery.
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

  test('keeps decorative seat offsets out of every combat clip, including looping guards', () => {
    for (const set of getSpriteAnimationSets()) {
      for (const [state, clipId] of Object.entries(set.stateClips)) {
        if (state === 'idle.none' || state === 'boost.sustain') continue;
        for (const elapsed of [0, 0.05, 0.13, 0.25, 1]) {
          expect(resolveSpriteFrameSelection(set, clipId!, elapsed, 0.13))
            .toEqual(resolveSpriteFrameSelection(set, clipId!, elapsed, 0));
          expect(resolveSpriteFrame(set, clipId!, elapsed, 0.13))
            .toBe(resolveSpriteFrame(set, clipId!, elapsed, 0));
        }
      }
    }
    const set = resolveSpriteAnimationSet('character_vanguard_animset')!;
    expect(resolveSpriteFrame(set, 'launch_startup', 0, 0.13)).toBe(12);
    expect(resolveSpriteFrame(set, 'idle', 0, 0.13)).toBe(1);
  });

  test('uses safe upright placeholders for ordinary recovery and inactive parry startup', () => {
    for (const set of getSpriteAnimationSets()) {
      for (const presentationAction of ['attack_recovery', 'parry'] as const) {
        const snapshot = makeSnapshot({ presentationAction,
          presentationPhase: presentationAction === 'parry' ? 'startup' : 'recovery' });
        const clipId = resolveSpriteClip(set, snapshot);
        expect(set.clips[clipId].frames).toEqual([0]);
        expect(set.clips[clipId].loop).toBe(false);
        const legacySet = structuredClone(set);
        delete legacySet.stateClips['attack_recovery.recovery'];
        delete legacySet.stateClips['parry.startup'];
        expect(resolveSpriteClip(legacySet, snapshot)).toBe('idle');
      }
    }
  });

  test('seeks within crumple/get-up recovery segments without renderer history', () => {
    const set = resolveSpriteAnimationSet('character_vanguard_animset')!;
    for (const useMetadata of [false, true]) {
      for (const progress of [0, 0.2, 0.449, 0.45, 0.7, 0.9]) {
        const snapshot = makeSnapshot({ presentationAction: 'recover', presentationPhase: 'recovery',
          recovering: 2 * (1 - progress), recoveryProgress: progress,
          ...(useMetadata ? { presentationElapsedSeconds: progress * 2 } : {}) });
        const clipId = resolveSpriteClip(set, snapshot);
        const elapsed = resolveSpriteElapsedSeconds(set, snapshot, clipId, 999);
        expect(clipId).toBe(progress < 0.45 ? 'dunked' : 'recover');
        expect(elapsed).toBeCloseTo(progress < 0.45 ? progress * 2 : (progress - 0.45) * 2);
      }
    }
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
