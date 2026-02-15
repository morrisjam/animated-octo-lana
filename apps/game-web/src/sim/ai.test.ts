import { describe, expect, test } from 'vitest';
import { buildFrameInputWithAi, createAiController, tickAiController } from './ai';
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
  test('AI emits standard PlayerFrameInput shape for deterministic sim use', () => {
    const state = createInitialState({ seed: 77 });
    const controller = createAiController(77);
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
      let controller = createAiController(1337);
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
});

