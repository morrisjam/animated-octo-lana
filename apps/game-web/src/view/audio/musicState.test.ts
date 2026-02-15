import { describe, expect, test } from 'vitest';
import { createMusicStateController } from './musicState';

describe('adaptive music state controller', () => {
  test('switches states deterministically and emits state-change callbacks once', () => {
    const events: string[] = [];
    const controller = createMusicStateController({
      fadeSeconds: 0.3,
      gainByState: {
        menu: 0.55,
        neutral: 0.72,
        launch: 0.9,
        end: 0.6,
      },
      initialState: 'menu',
      initialTimeSeconds: 0,
      onStateChanged: (state) => {
        events.push(state);
      },
    });

    expect(controller.getState()).toBe('menu');
    controller.setState('menu', 0.2);
    expect(events).toEqual([]);

    controller.setState('neutral', 1);
    controller.setState('launch', 2);
    controller.setState('end', 3);
    expect(events).toEqual(['neutral', 'launch', 'end']);
  });

  test('applies fade interpolation between state gains', () => {
    const controller = createMusicStateController({
      fadeSeconds: 0.5,
      gainByState: {
        menu: 0.5,
        neutral: 0.8,
        launch: 1,
        end: 0.65,
      },
      initialState: 'menu',
      initialTimeSeconds: 0,
    });

    controller.setState('launch', 10);
    const gainAtStart = controller.tick(10);
    const gainAtHalf = controller.tick(10.25);
    const gainAtEnd = controller.tick(10.5);

    expect(gainAtStart).toBeCloseTo(0.5, 4);
    expect(gainAtHalf).toBeCloseTo(0.75, 4);
    expect(gainAtEnd).toBeCloseTo(1, 4);
  });
});

