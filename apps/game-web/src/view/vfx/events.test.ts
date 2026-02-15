import { describe, expect, test } from 'vitest';
import type { PlayerId, RenderSnapshot } from '../../sim/types';
import { extractCombatVfxEvents } from './events';

function makeSnapshot(gameTime: number): RenderSnapshot {
  return {
    gameTime,
    winner: null,
    statusText: 'Neutral',
    players: {
      P1: {
        id: 'P1',
        characterId: 'vanguard',
        pos: { x: -20, y: 0 },
        maxFuel: 100,
        fuel: 100,
        launchBreaks: 3,
        helpless: 0,
        parry: 0,
        launchFlash: 0,
        parryFlash: 0,
        specialFlash: 0,
        breakFlash: 0,
        dunkFlash: 0,
        recovering: 0,
        recoveryProgress: 0,
      },
      P2: {
        id: 'P2',
        characterId: 'ace',
        pos: { x: 20, y: 0 },
        maxFuel: 100,
        fuel: 100,
        launchBreaks: 3,
        helpless: 0,
        parry: 0,
        launchFlash: 0,
        parryFlash: 0,
        specialFlash: 0,
        breakFlash: 0,
        dunkFlash: 0,
        recovering: 0,
        recoveryProgress: 0,
      },
    },
    projectiles: [],
  };
}

function findEvent(events: ReturnType<typeof extractCombatVfxEvents>, type: string, playerId: PlayerId) {
  return events.find((event) => event.type === type && event.playerId === playerId);
}

describe('combat VFX event extraction', () => {
  test('extracts launch, parry, dunk, and projectile spawn events from snapshot deltas', () => {
    const previous = makeSnapshot(1);
    const current = makeSnapshot(1 + 1 / 60);
    current.players.P1.launchFlash = 0.22;
    current.players.P1.dunkFlash = 0.18;
    current.players.P2.parryFlash = 0.15;
    current.projectiles.push({
      id: 10,
      ownerId: 'P1',
      visualId: 'character_vanguard_projectile',
      pos: { x: -15, y: 2 },
    });

    const events = extractCombatVfxEvents(previous, current);

    expect(findEvent(events, 'launch', 'P1')).toBeTruthy();
    expect(findEvent(events, 'dunk', 'P1')).toBeTruthy();
    expect(findEvent(events, 'parry', 'P2')).toBeTruthy();
    const projectileEvent = findEvent(events, 'projectile', 'P1');
    expect(projectileEvent).toBeTruthy();
    expect(projectileEvent?.projectileVisualId).toBe('character_vanguard_projectile');
  });

  test('extracts boost events from fuel spend and movement bursts', () => {
    const previous = makeSnapshot(2);
    const current = makeSnapshot(2 + 1 / 60);
    current.players.P1.pos = { x: -17.4, y: 0.2 };
    current.players.P1.fuel = 99.75;

    const events = extractCombatVfxEvents(previous, current);

    const boost = findEvent(events, 'boost', 'P1');
    expect(boost).toBeTruthy();
    expect(boost?.direction.x).toBeGreaterThan(0);
  });

  test('drops event extraction when timeline rewinds', () => {
    const previous = makeSnapshot(5);
    const current = makeSnapshot(4.9);
    current.players.P1.launchFlash = 0.2;
    current.players.P2.parryFlash = 0.2;

    const events = extractCombatVfxEvents(previous, current);
    expect(events).toEqual([]);
  });
});

