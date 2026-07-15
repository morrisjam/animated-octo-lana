import { describe, expect, test } from 'vitest';
import {
  COMBAT_VFX_EVENT_BINDINGS,
  COMBAT_VFX_PRESET_LIBRARY,
  resolveCombatVfxPreset,
  resolveCombatVfxPresetId,
} from './presets';
import type { CombatVfxEvent } from './types';

function makeEvent(type: CombatVfxEvent['type'], characterId: CombatVfxEvent['characterId']): CombatVfxEvent {
  return {
    type,
    playerId: 'P1',
    characterId,
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
  };
}

describe('combat VFX presets', () => {
  test('binds every combat event to a data-driven preset id', () => {
    const eventTypes = Object.keys(COMBAT_VFX_EVENT_BINDINGS) as Array<keyof typeof COMBAT_VFX_EVENT_BINDINGS>;
    for (const eventType of eventTypes) {
      const presetId = COMBAT_VFX_EVENT_BINDINGS[eventType];
      expect(typeof presetId).toBe('string');
      expect(COMBAT_VFX_PRESET_LIBRARY[presetId]).toBeTruthy();
    }
  });

  test('supports launch preset overrides per character VFX profile', () => {
    const baseEvent = makeEvent('launch', 'vanguard');
    const overrideEvent = makeEvent('launch', 'ace');
    const basePresetId = resolveCombatVfxPresetId(baseEvent);
    const overridePresetId = resolveCombatVfxPresetId(overrideEvent);

    expect(basePresetId).toBe('launch_strike');
    expect(overridePresetId).toBe('launch_arcane');
  });

  test('uses package-selected special silhouettes for Vanguard and Duelist', () => {
    const vanguardPreset = resolveCombatVfxPreset(makeEvent('special', 'vanguard'));
    const duelistPreset = resolveCombatVfxPreset(makeEvent('special', 'duelist'));

    expect(resolveCombatVfxPresetId(makeEvent('special', 'vanguard'))).toBe('special_vanguard_bastion');
    expect(resolveCombatVfxPresetId(makeEvent('special', 'duelist'))).toBe('special_duelist_pressure_dash');
    expect(vanguardPreset?.flash?.radius).toBeGreaterThan(4);
    expect(vanguardPreset?.trail).toBeUndefined();
    expect(duelistPreset?.trail?.length).toBeGreaterThan(10);
    expect(duelistPreset?.particles?.driftAlongDirection).toBeGreaterThan(10);
  });

  test('combat presets expose particles, trail, flash, and sound cues for readable state changes', () => {
    const events: CombatVfxEvent[] = [
      makeEvent('boost', 'vanguard'),
      makeEvent('launch', 'duelist'),
      makeEvent('clash', 'ace'),
      makeEvent('parry', 'ace'),
      makeEvent('special', 'ace'),
      makeEvent('break', 'duelist'),
      makeEvent('projectile', 'warden'),
      makeEvent('dunk', 'vanguard'),
    ];
    for (const event of events) {
      const preset = resolveCombatVfxPreset(event);
      expect(preset?.particles).toBeTruthy();
      expect(preset?.trail).toBeTruthy();
      expect(preset?.flash).toBeTruthy();
      expect(preset?.sound).toBeTruthy();
    }
  });
});

