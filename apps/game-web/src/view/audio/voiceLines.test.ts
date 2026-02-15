import { describe, expect, test } from 'vitest';
import { createVoiceCalloutSystem } from './voiceLines';
import type { AudioEvent } from './types';

describe('voice line and callout system', () => {
  test('emits locale-aware callouts with fallback and cooldown gating', () => {
    const emitted: AudioEvent[] = [];
    const system = createVoiceCalloutSystem({
      locale: 'en-AU',
      emitAudioEvent: (event) => {
        emitted.push(event);
      },
      minGlobalGapSeconds: 0.5,
    });

    const first = system.trigger({
      playerId: 'P1',
      characterId: 'vanguard',
      event: 'round_start',
      timeSeconds: 1,
    });
    const blockedByGlobalGap = system.trigger({
      playerId: 'P2',
      characterId: 'duelist',
      event: 'round_start',
      timeSeconds: 1.2,
    });
    const second = system.trigger({
      playerId: 'P2',
      characterId: 'duelist',
      event: 'round_start',
      timeSeconds: 2.1,
    });

    expect(first?.lineId).toContain('round_start');
    expect(blockedByGlobalGap).toBeNull();
    expect(second?.lineId).toContain('round_start');
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.type).toBe('voice.callout');
    expect(emitted[1]?.type).toBe('voice.callout');
  });

  test('supports locale switching and ignores unknown voice profile events safely', () => {
    const emitted: AudioEvent[] = [];
    const system = createVoiceCalloutSystem({
      locale: 'fr-FR',
      emitAudioEvent: (event) => {
        emitted.push(event);
      },
      minGlobalGapSeconds: 0,
    });

    const aceFrench = system.trigger({
      playerId: 'P1',
      characterId: 'ace',
      event: 'parry_success',
      timeSeconds: 5,
    });
    system.setLocale('de-DE');
    const wardenFallback = system.trigger({
      playerId: 'P2',
      characterId: 'warden',
      event: 'parry_success',
      timeSeconds: 8,
    });

    expect(aceFrench).toBeTruthy();
    expect(wardenFallback).toBeTruthy();
    expect(emitted).toHaveLength(2);
  });
});

