import { describe, expect, test } from 'vitest';
import {
  AI_DIFFICULTY_ORDER,
  AI_DIFFICULTY_PROFILES,
  buildFrameInputWithAi,
  createAiController,
  tickAiController,
} from './ai';
import { createInitialState, step } from './sim';
import type { PlayerFrameInput } from './types';
import type { CharacterId } from './characters';

function createIdleInput(): PlayerFrameInput {
  return {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function runAiMirrorMatch(
  loadout: { P1: CharacterId; P2: CharacterId },
  frames: number,
  profileId: 'cadet' | 'veteran' | 'ace' = 'ace',
) {
  const state = createInitialState({ seed: 2026, loadout });
  let p1Controller = createAiController({ seed: 101, profileId });
  let p2Controller = createAiController({ seed: 202, profileId });
  const stats = {
    p1Specials: 0,
    p2Specials: 0,
    p1Parries: 0,
    p2Parries: 0,
    p1Breaks: 0,
    p2Breaks: 0,
    maxProjectilesSeen: 0,
  };

  for (let frame = 0; frame < frames; frame += 1) {
    const p1Tick = tickAiController(state, 'P1', p1Controller);
    const p2Tick = tickAiController(state, 'P2', p2Controller);
    p1Controller = p1Tick.next;
    p2Controller = p2Tick.next;

    if (p1Tick.input.special) {
      stats.p1Specials += 1;
    }
    if (p2Tick.input.special) {
      stats.p2Specials += 1;
    }
    if (p1Tick.input.parry) {
      stats.p1Parries += 1;
    }
    if (p2Tick.input.parry) {
      stats.p2Parries += 1;
    }
    if (p1Tick.input.breakLaunch) {
      stats.p1Breaks += 1;
    }
    if (p2Tick.input.breakLaunch) {
      stats.p2Breaks += 1;
    }

    step(
      state,
      {
        p1: p1Tick.input,
        p2: p2Tick.input,
      },
      1 / 60,
    );
    stats.maxProjectilesSeen = Math.max(stats.maxProjectilesSeen, state.projectiles.length);
  }

  return stats;
}

describe('sim AI behaviour framework', () => {
  test('exposes four data-driven difficulty profiles', () => {
    expect(AI_DIFFICULTY_ORDER).toEqual(['rookie', 'cadet', 'veteran', 'ace']);

    const rookie = AI_DIFFICULTY_PROFILES.rookie;
    const ace = AI_DIFFICULTY_PROFILES.ace;
    expect(rookie.reactionDelayFrames).toBeGreaterThan(ace.reactionDelayFrames);
    expect(rookie.errorRate).toBeGreaterThan(ace.errorRate);
    expect(rookie.riskAppetite).toBeLessThan(ace.riskAppetite);
  });

  test('AI emits standard PlayerFrameInput shape for deterministic sim use', () => {
    const state = createInitialState({ seed: 77 });
    const controller = createAiController({ seed: 77, profileId: 'cadet' });
    const tick = tickAiController(state, 'P2', controller);

    expect(typeof tick.input.moveX).toBe('number');
    expect(typeof tick.input.moveY).toBe('number');
    expect(typeof tick.input.launch).toBe('boolean');
    expect(typeof tick.input.parry).toBe('boolean');
    expect(typeof tick.input.breakLaunch).toBe('boolean');
    expect(typeof tick.next.rngState).toBe('number');
  });

  test('AI policy is deterministic under fixed seed and fixed-step simulation', () => {
    const runSimulation = () => {
      const state = createInitialState({ seed: 1337 });
      let controller = createAiController({ seed: 1337, profileId: 'veteran' });
      const launchFrames: number[] = [];
      const parryFrames: number[] = [];
      const specialFrames: number[] = [];
      for (let frame = 0; frame < 360; frame += 1) {
        const tick = tickAiController(state, 'P2', controller);
        controller = tick.next;
        if (tick.input.launch) {
          launchFrames.push(frame);
        }
        if (tick.input.parry) {
          parryFrames.push(frame);
        }
        if (tick.input.special) {
          specialFrames.push(frame);
        }
        const frameInput = buildFrameInputWithAi(createIdleInput(), tick.input, 'P2');
        step(state, frameInput, 1 / 60);
      }
      return {
        launchFrames,
        parryFrames,
        specialFrames,
        finalP2Fuel: state.players.P2.fuel,
        finalP1Fuel: state.players.P1.fuel,
      };
    };

    const first = runSimulation();
    const second = runSimulation();

    expect(first).toEqual(second);
  });

  test('difficulty profile changes movement and action cadence', () => {
    const runSimulation = (profileId: 'rookie' | 'ace') => {
      const state = createInitialState({ seed: 2026 });
      let controller = createAiController({ seed: 2026, profileId });
      let actions = 0;
      let movementEnergy = 0;
      for (let frame = 0; frame < 360; frame += 1) {
        const tick = tickAiController(state, 'P2', controller);
        controller = tick.next;
        if (tick.input.launch || tick.input.special || tick.input.dunk || tick.input.parry) {
          actions += 1;
        }
        movementEnergy += Math.abs(tick.input.moveX) + Math.abs(tick.input.moveY);
        const frameInput = buildFrameInputWithAi(createIdleInput(), tick.input, 'P2');
        step(state, frameInput, 1 / 60);
      }
      return { actions, movementEnergy };
    };

    const rookie = runSimulation('rookie');
    const ace = runSimulation('ace');

    expect(ace.actions).not.toBe(rookie.actions);
    expect(ace.movementEnergy).toBeGreaterThan(rookie.movementEnergy);
  });

  test('AI uses character-specific specials and defensive options in the default matchup', () => {
    const stats = runAiMirrorMatch({ P1: 'vanguard', P2: 'duelist' }, 900);

    expect(stats.p1Specials).toBeGreaterThan(0);
    expect(stats.p2Specials).toBeGreaterThan(0);
    expect(stats.p1Parries + stats.p2Parries + stats.p1Breaks + stats.p2Breaks).toBeGreaterThan(0);
  });

  test('projectile archetype AI actually creates projectile traffic', () => {
    const stats = runAiMirrorMatch({ P1: 'ace', P2: 'warden' }, 900);

    expect(stats.p1Specials + stats.p2Specials).toBeGreaterThan(0);
    expect(stats.maxProjectilesSeen).toBeGreaterThan(0);
  });

  test('AI spends launch breaks in urgent helpless situations', () => {
    const state = createInitialState({ seed: 44 });
    state.players.P2.helpless = 1.9;
    state.players.P2.launchBreaks = 2;
    state.players.P2.pos = { x: 61, y: 0 };
    state.players.P1.pos = { x: 67, y: 0 };
    const controller = createAiController({ seed: 44, profileId: 'ace' });

    const tick = tickAiController(state, 'P2', controller);

    expect(tick.input.breakLaunch).toBe(true);
  });
});
