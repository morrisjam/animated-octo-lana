import { describe, expect, test } from 'vitest';
import {
  ControllerNavigationList,
  ControllerNavigationRepeater,
  resolveControllerNavigationSample,
  type ControllerNavigationAction,
  type ControllerNavigationGamepad,
  type ControllerNavigationSample,
  type ControllerNavigationTarget,
} from './navigation';

function gamepad(pressedButtons: number[] = [], axes = [0, 0]): ControllerNavigationGamepad {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressedButtons.includes(index),
      value: pressedButtons.includes(index) ? 1 : 0,
    })),
  };
}

function sample(...actions: ControllerNavigationAction[]): ControllerNavigationSample {
  return {
    up: actions.includes('up'),
    down: actions.includes('down'),
    left: actions.includes('left'),
    right: actions.includes('right'),
    confirm: actions.includes('confirm'),
    back: actions.includes('back'),
    page_previous: actions.includes('page_previous'),
    page_next: actions.includes('page_next'),
  };
}

describe('controller navigation sampling', () => {
  test('uses standard face-button conventions for each controller family', () => {
    expect(resolveControllerNavigationSample(gamepad([0]), 'xbox').confirm).toBe(true);
    expect(resolveControllerNavigationSample(gamepad([0]), 'playstation').confirm).toBe(true);
    expect(resolveControllerNavigationSample(gamepad([1]), 'nintendo').confirm).toBe(true);
    expect(resolveControllerNavigationSample(gamepad([0]), 'nintendo').back).toBe(true);
  });

  test('reads D-pad and stick movement with a menu deadzone', () => {
    expect(resolveControllerNavigationSample(gamepad([12]), 'generic').up).toBe(true);
    expect(resolveControllerNavigationSample(gamepad([], [0.7, 0.1]), 'generic').right).toBe(true);
    expect(resolveControllerNavigationSample(gamepad([], [0.2, 0.2]), 'generic').right).toBe(false);
  });
});

describe('controller navigation repeat', () => {
  test('edge-triggers actions and repeats only directional holds', () => {
    const repeater = new ControllerNavigationRepeater({ initialDelayMs: 300, repeatIntervalMs: 100 });

    expect(repeater.poll(sample('down', 'confirm'), 0)).toEqual(['down', 'confirm']);
    expect(repeater.poll(sample('down', 'confirm'), 250)).toEqual([]);
    expect(repeater.poll(sample('down', 'confirm'), 300)).toEqual(['down']);
    expect(repeater.poll(sample('down', 'confirm'), 400)).toEqual(['down']);
    expect(repeater.poll(sample(), 410)).toEqual([]);
    expect(repeater.poll(sample('confirm'), 420)).toEqual(['confirm']);
  });
});

describe('controller navigation list', () => {
  test('skips unavailable targets and supports focus, activation, adjustment, and back', () => {
    const events: string[] = [];
    const target = (id: string, disabled = false): ControllerNavigationTarget => ({
      id,
      disabled,
      focus: () => events.push(`focus:${id}`),
      activate: () => events.push(`activate:${id}`),
    });
    const list = new ControllerNavigationList(
      [target('play'), target('locked', true), target('settings')],
      {
        onBack: () => events.push('back'),
        onHorizontalAdjust: (direction, item) => events.push(`${direction}:${item.id}`),
      },
    );

    expect(list.focusSelected()).toBe(true);
    expect(list.handle('down')).toBe(true);
    expect(list.handle('confirm')).toBe(true);
    expect(list.handle('left')).toBe(true);
    expect(list.handle('back')).toBe(true);
    expect(events).toEqual([
      'focus:play',
      'focus:settings',
      'activate:settings',
      'left:settings',
      'back',
    ]);
  });
});
