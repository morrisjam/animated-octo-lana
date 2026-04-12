import { describe, expect, test } from 'vitest';
import { createInputTimelineBuffer } from '../net/inputTimeline';
import type { PlayerFrameInput } from '../sim/types';
import { buildInputHistoryView } from './inputHistory';

function neutralInput(): PlayerFrameInput {
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

describe('input history view', () => {
  test('formats recent inputs newest first for both players', () => {
    const timeline = createInputTimelineBuffer();
    timeline.setLocalInput(3, 'P1', { ...neutralInput(), moveX: 1, special: true });
    timeline.setLocalInput(4, 'P1', { ...neutralInput(), parry: true });
    timeline.setLocalInput(5, 'P2', { ...neutralInput(), moveY: -1, launch: true });

    const history = buildInputHistoryView(timeline, 2);

    expect(history.P1[0]).toMatchObject({ frame: 4, text: 'P' });
    expect(history.P1[1]).toMatchObject({ frame: 3, text: 'R SP' });
    expect(history.P2[0]).toMatchObject({ frame: 5, text: 'U L' });
  });
});
