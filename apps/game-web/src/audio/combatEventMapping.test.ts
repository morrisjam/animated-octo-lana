import { describe, expect, test, vi } from 'vitest';
import { createAudioSystem } from '../view/audio/system';
import type { AudioEvent, AudioRoute } from '../view/audio/types';
import type { CombatVfxEventType } from '../view/vfx/types';
import { COMBAT_AUDIO_EVENTS, toCombatAudioEventType } from './combatEventMapping';

describe('combat audio routing', () => {
  test('preserves every combat action identity and provides an intentional default cue', () => {
    const play = vi.fn<(event: AudioEvent, route: AudioRoute) => void>();
    const audio = createAudioSystem({
      sink: { play, setBusVolume: vi.fn(), dispose: vi.fn() },
      missingEventPolicy: 'throw',
    });
    const actions = ['boost', 'super_boost', 'launch', 'clash', 'parry', 'special', 'break', 'projectile', 'dunk'] as const satisfies readonly CombatVfxEventType[];
    expect(Object.keys(COMBAT_AUDIO_EVENTS).sort()).toEqual([...actions].sort());
    for (const action of actions) {
      expect(toCombatAudioEventType(action)).toBe(`combat.${action}`);
      audio.emit({ type: toCombatAudioEventType(action), playerId: 'P2', pan: 0.5 });
    }
    expect(play).toHaveBeenCalledTimes(actions.length);
    expect(new Set(play.mock.calls.map(([, route]) => JSON.stringify(route.cue))).size).toBe(actions.length);
    for (const [event, route] of play.mock.calls) {
      expect(event).toMatchObject({ playerId: 'P2', pan: 0.5 });
      expect(route.bus).toBe('sfx');
      expect(route.cue?.durationSeconds).toBeGreaterThan(0);
    }
    expect(audio.getDiagnostics().missingRoutes).toBe(0);
    audio.dispose();
  });
});
