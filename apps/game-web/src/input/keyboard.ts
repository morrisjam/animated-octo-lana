import type { FrameInput, PlayerFrameInput, PlayersById } from '../sim/types';
import { createEmptyFrameInput } from './frame';

interface PlayerKeyMap {
  up: string;
  down: string;
  left: string;
  right: string;
  boost: string;
  superBoost: string;
  special: string;
  launch: string;
  dunk: string;
  parry: string;
  breakLaunch: string;
}

const KEY_MAP: PlayersById<PlayerKeyMap> = {
  P1: {
    up: 'w',
    down: 's',
    left: 'a',
    right: 'd',
    boost: 'f',
    superBoost: 'g',
    special: 'r',
    launch: 't',
    dunk: 'y',
    parry: 'h',
    breakLaunch: 'v',
  },
  P2: {
    up: 'i',
    down: 'k',
    left: 'j',
    right: 'l',
    boost: 'o',
    superBoost: 'p',
    special: '[',
    launch: ']',
    dunk: '\\',
    parry: '\'',
    breakLaunch: ';',
  },
};

export class KeyboardInput {
  private keys = new Set<string>();
  private readonly frameInput = createEmptyFrameInput();

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    if (!key) {
      return;
    }
    this.keys.add(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    if (!key) {
      return;
    }
    this.keys.delete(key);
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private isDown(key: string): boolean {
    return this.keys.has(key);
  }

  private writePlayerInput(map: PlayerKeyMap, output: PlayerFrameInput): void {
    const left = this.isDown(map.left);
    const right = this.isDown(map.right);
    const up = this.isDown(map.up);
    const down = this.isDown(map.down);

    output.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    output.moveY = (up ? 1 : 0) - (down ? 1 : 0);
    output.boost = this.isDown(map.boost);
    output.superBoost = this.isDown(map.superBoost);
    output.special = this.isDown(map.special);
    output.launch = this.isDown(map.launch);
    output.dunk = this.isDown(map.dunk);
    output.parry = this.isDown(map.parry);
    output.breakLaunch = this.isDown(map.breakLaunch);
  }

  getFrameInput(): FrameInput {
    this.writePlayerInput(KEY_MAP.P1, this.frameInput.p1);
    this.writePlayerInput(KEY_MAP.P2, this.frameInput.p2);
    return this.frameInput;
  }
}

export function createKeyboardInput(): KeyboardInput {
  return new KeyboardInput();
}
