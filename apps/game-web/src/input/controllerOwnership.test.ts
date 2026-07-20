import { describe, expect, test } from 'vitest';
import { ControllerOwnership } from './controllerOwnership';

describe('active controller ownership', () => {
  test('uses activity to hand menu ownership between connected controllers', () => {
    const ownership = new ControllerOwnership();
    ownership.connect(2);
    ownership.connect(0);

    expect(ownership.getState().activeControllerIndex).toBe(2);
    expect(ownership.recordActivity(0)).toBe(true);
    expect(ownership.getState().activeControllerIndex).toBe(0);
    expect(ownership.recordActivity(7)).toBe(false);
  });

  test('claims player slots without assigning one controller twice', () => {
    const ownership = new ControllerOwnership();
    ownership.connect(0);
    ownership.connect(1);

    expect(ownership.claimAvailablePlayer(0)).toBe('P1');
    expect(ownership.claimAvailablePlayer(1, 'P2')).toBe('P2');
    const reassignment = ownership.assign('P1', 1);

    expect(reassignment).toMatchObject({ assigned: true, displacedPlayer: 'P2' });
    expect(ownership.getState().assignments).toEqual({ P1: 1, P2: null });
  });

  test('reports lost players and selects a connected fallback after disconnection', () => {
    const ownership = new ControllerOwnership();
    ownership.connect(4);
    ownership.connect(7);
    ownership.assign('P1', 4);
    ownership.assign('P2', 7);
    ownership.recordActivity(4);

    const loss = ownership.disconnect(4);

    expect(loss).toEqual({
      controllerIndex: 4,
      lostPlayers: ['P1'],
      activeControllerIndex: 7,
    });
    expect(ownership.getState().assignments).toEqual({ P1: null, P2: 7 });
  });

  test('notifies listeners when an existing assignment reclaims active ownership', () => {
    const ownership = new ControllerOwnership();
    ownership.connect(0);
    ownership.connect(1);
    ownership.assign('P1', 0);
    ownership.assign('P2', 1);
    let latestActive = ownership.getState().activeControllerIndex;
    ownership.subscribe((state) => {
      latestActive = state.activeControllerIndex;
    });

    ownership.assign('P1', 0);

    expect(latestActive).toBe(0);
  });
});
