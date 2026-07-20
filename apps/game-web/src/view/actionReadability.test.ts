import { describe, expect, test } from 'vitest';
import type { PlayerRenderSnapshot } from '../sim/types';
import {
  ACTION_READABILITY_BY_ID,
  ACTION_READABILITY_DEFINITIONS,
  ACTION_READABILITY_IDS,
  resolvePlayerActionReadability,
  resolvePlayerActivityReadability,
} from './actionReadability';

function makePlayer(overrides: Partial<PlayerRenderSnapshot> = {}): PlayerRenderSnapshot {
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

describe('action readability', () => {
  test('exports one stable color definition for every action', () => {
    expect(ACTION_READABILITY_DEFINITIONS.map((definition) => definition.id)).toEqual(
      ACTION_READABILITY_IDS,
    );
    expect(new Set(ACTION_READABILITY_DEFINITIONS.map((definition) => definition.color)).size)
      .toBe(ACTION_READABILITY_IDS.length);
    for (const id of ACTION_READABILITY_IDS) {
      expect(ACTION_READABILITY_BY_ID[id].label.length).toBeGreaterThan(0);
    }
  });

  test.each([
    ['boost', makePlayer({ boostActive: true, presentationAction: 'boost', presentationPhase: 'sustain' })],
    ['super_boost', makePlayer({ boostActive: true, superBoost: 1, presentationAction: 'boost', presentationPhase: 'sustain' })],
    ['special', makePlayer({ presentationAction: 'special', presentationPhase: 'startup' })],
    ['launch', makePlayer({ presentationAction: 'launch', presentationPhase: 'active' })],
    ['dunk', makePlayer({ presentationAction: 'dunk', presentationPhase: 'startup' })],
    ['parry', makePlayer({ parry: 0.1, presentationAction: 'parry', presentationPhase: 'active' })],
    ['launch_break', makePlayer({ breakFlash: 0.2, presentationAction: 'break', presentationPhase: 'active' })],
  ] as const)('resolves accepted %s state', (expected, player) => {
    expect(resolvePlayerActionReadability(player)?.definition.id).toBe(expected);
  });

  test('does not label a launched victim as the player who performed Launch', () => {
    const victim = makePlayer({
      helpless: 0.8,
      launchFlash: 0.2,
      presentationAction: 'helpless',
      presentationPhase: 'sustain',
    });

    expect(resolvePlayerActionReadability(victim)).toBeNull();
    expect(resolvePlayerActivityReadability(victim)).toMatchObject({
      id: 'helpless',
      label: 'Launched',
    });
  });

  test('prefers the current accepted action over a stale transient flash', () => {
    const player = makePlayer({
      breakFlash: 0.08,
      presentationAction: 'launch',
      presentationPhase: 'startup',
    });

    expect(resolvePlayerActionReadability(player)?.definition.id).toBe('launch');
  });

  test('reports action phase and distinguishes recovery from idle', () => {
    expect(resolvePlayerActivityReadability(makePlayer({
      presentationAction: 'launch',
      presentationPhase: 'startup',
    })).label).toBe('Launch / STARTUP');
    expect(resolvePlayerActivityReadability(makePlayer({
      recovering: 0.3,
      presentationAction: 'recover',
      presentationPhase: 'recovery',
    })).id).toBe('recover');
    expect(resolvePlayerActivityReadability(makePlayer()).id).toBe('idle');
  });
});
