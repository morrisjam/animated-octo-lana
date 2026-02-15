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

  test('difficulty profile changes aggression and error output', () => {
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

    expect(ace.actions).toBeGreaterThan(rookie.actions);
    expect(ace.movementEnergy).toBeGreaterThan(rookie.movementEnergy);
  });
});
