import { describe, expect, it } from 'vitest';
import { createAiController, tickAiController } from './ai';
import {
  createDefaultAiControllerRoles,
  fingerprintAiControllerRoles,
  sanitiseAiControllerRoles,
  tickAiControllerWithRole,
} from './aiControllerRoles';
import { createInitialState } from './sim';

describe('AI controller roles', () => {
  it('preserves the adaptive controller input and labels its trace', () => {
    const state = createInitialState({ seed: 101 });
    const controller = createAiController({ seed: 202, profileId: 'veteran' });
    const expected = tickAiController(state, 'P1', controller);
    const actual = tickAiControllerWithRole(state, 'P1', controller, 'adaptive');

    expect(actual.input).toEqual(expected.input);
    expect(actual.next).toEqual(expected.next);
    expect(actual.decision.controllerRoleId).toBe('adaptive');
  });

  it('keeps a passive dummy neutral and preserves launch breaks', () => {
    const state = createInitialState({ seed: 102 });
    state.players.P2.helpless = 2;
    state.players.P2.launchBreaks = 2;
    const tick = tickAiControllerWithRole(
      state,
      'P2',
      createAiController({ seed: 203, profileId: 'ace' }),
      'passive',
    );

    expect(tick.input).toEqual({
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    });
    expect(tick.decision).toMatchObject({
      controllerRoleId: 'passive',
      movementIntent: 'uncontrolled',
      selectedAction: null,
      selectedReason: 'scripted_wait_for_control',
    });
  });

  it('makes the defense dummy parry commitments and launch-break helpless state', () => {
    const state = createInitialState({ seed: 103 });
    state.players.P1.pos = { x: -4, y: 0 };
    state.players.P2.pos = { x: 4, y: 0 };
    state.players.P1.launchStartup = 0.1;
    const controller = createAiController({ seed: 204, profileId: 'cadet' });
    const parryTick = tickAiControllerWithRole(state, 'P2', controller, 'defensive');

    expect(parryTick.input.parry).toBe(true);
    expect(parryTick.decision).toMatchObject({
      controllerRoleId: 'defensive',
      selectedAction: 'parry',
      selectedReason: 'scripted_defensive_parry',
    });

    state.players.P2.helpless = 2;
    state.players.P2.launchBreaks = 1;
    const breakTick = tickAiControllerWithRole(
      state,
      'P2',
      createAiController({ seed: 205, profileId: 'cadet' }),
      'defensive',
    );
    expect(breakTick.input.breakLaunch).toBe(true);
    expect(breakTick.decision.selectedAction).toBe('launch_break');
  });

  it('makes the escape dummy retreat and spend fuel under close pressure', () => {
    const state = createInitialState({ seed: 104 });
    state.players.P1.pos = { x: -4, y: 0 };
    state.players.P2.pos = { x: 4, y: 0 };
    const tick = tickAiControllerWithRole(
      state,
      'P2',
      createAiController({ seed: 206, profileId: 'rookie' }),
      'evasive',
    );

    expect(tick.input.moveX).toBeGreaterThan(0);
    expect(tick.input.superBoost).toBe(true);
    expect(tick.decision).toMatchObject({
      controllerRoleId: 'evasive',
      movementIntent: 'scripted_evade',
      selectedAction: null,
      selectedReason: 'scripted_escape_super_boost',
    });
  });

  it('sanitises and fingerprints role pairs deterministically', () => {
    expect(createDefaultAiControllerRoles()).toEqual({ P1: 'adaptive', P2: 'adaptive' });
    expect(sanitiseAiControllerRoles({ P1: 'evasive', P2: 'not-a-role' })).toEqual({
      P1: 'evasive',
      P2: 'adaptive',
    });
    expect(fingerprintAiControllerRoles({ P1: 'adaptive', P2: 'passive' })).toBe(
      fingerprintAiControllerRoles({ P2: 'passive', P1: 'adaptive' }),
    );
  });
});
