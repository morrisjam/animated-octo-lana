import type { PlayerFrameInput, PlayerId } from '../sim/types';
import type { InputTimelineBuffer, TimelineInputEntry } from '../net/inputTimeline';

export interface InputHistoryRow {
  frame: number;
  text: string;
  source: TimelineInputEntry['source'];
}

export interface InputHistoryView {
  P1: InputHistoryRow[];
  P2: InputHistoryRow[];
}

function formatDirection(input: PlayerFrameInput): string | null {
  const x = Math.sign(input.moveX);
  const y = Math.sign(input.moveY);
  if (x === 0 && y === 0) {
    return null;
  }
  if (x === 0 && y < 0) {
    return 'U';
  }
  if (x === 0 && y > 0) {
    return 'D';
  }
  if (x < 0 && y === 0) {
    return 'L';
  }
  if (x > 0 && y === 0) {
    return 'R';
  }
  if (x < 0 && y < 0) {
    return 'UL';
  }
  if (x > 0 && y < 0) {
    return 'UR';
  }
  if (x < 0 && y > 0) {
    return 'DL';
  }
  return 'DR';
}

function formatButtons(input: PlayerFrameInput): string[] {
  const buttons: string[] = [];
  if (input.boost) {
    buttons.push('B');
  }
  if (input.superBoost) {
    buttons.push('SB');
  }
  if (input.special) {
    buttons.push('SP');
  }
  if (input.launch) {
    buttons.push('L');
  }
  if (input.dunk) {
    buttons.push('Dk');
  }
  if (input.parry) {
    buttons.push('P');
  }
  if (input.breakLaunch) {
    buttons.push('Br');
  }
  return buttons;
}

function formatInput(input: PlayerFrameInput): string {
  const parts: string[] = [];
  const direction = formatDirection(input);
  if (direction) {
    parts.push(direction);
  }
  const buttons = formatButtons(input);
  if (buttons.length > 0) {
    parts.push(buttons.join('+'));
  }
  return parts.join(' ') || 'Idle';
}

function buildRowsForPlayer(
  timeline: InputTimelineBuffer,
  playerId: PlayerId,
  limit: number,
): InputHistoryRow[] {
  const rows: InputHistoryRow[] = [];
  for (const frame of timeline.getRecentFrames(limit * 3)) {
    const entry = playerId === 'P1' ? frame.p1 : frame.p2;
    if (!entry) {
      continue;
    }
    rows.push({
      frame: frame.frame,
      text: formatInput(entry.input),
      source: entry.source,
    });
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

export function buildInputHistoryView(timeline: InputTimelineBuffer, limit = 10): InputHistoryView {
  return {
    P1: buildRowsForPlayer(timeline, 'P1', limit),
    P2: buildRowsForPlayer(timeline, 'P2', limit),
  };
}
