export type MusicState = 'menu' | 'neutral' | 'launch' | 'end';

export interface MusicStateControllerOptions {
  fadeSeconds: number;
  gainByState: Record<MusicState, number>;
  onStateChanged?: (state: MusicState) => void;
  initialState?: MusicState;
  initialTimeSeconds?: number;
}

export interface MusicStateController {
  getState(): MusicState;
  setState(nextState: MusicState, nowSeconds: number): void;
  tick(nowSeconds: number): number;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function createMusicStateController(options: MusicStateControllerOptions): MusicStateController {
  const fadeSeconds = Math.max(0.01, options.fadeSeconds);
  let currentState: MusicState = options.initialState ?? 'menu';
  let fromGain = clamp01(options.gainByState[currentState] ?? 0.7);
  let targetGain = fromGain;
  let transitionStartSeconds = options.initialTimeSeconds ?? 0;

  return {
    getState(): MusicState {
      return currentState;
    },
    setState(nextState: MusicState, nowSeconds: number): void {
      if (nextState === currentState) {
        return;
      }
      const nowGain = this.tick(nowSeconds);
      currentState = nextState;
      fromGain = nowGain;
      targetGain = clamp01(options.gainByState[nextState] ?? 0.7);
      transitionStartSeconds = nowSeconds;
      options.onStateChanged?.(nextState);
    },
    tick(nowSeconds: number): number {
      const elapsed = Math.max(0, nowSeconds - transitionStartSeconds);
      const alpha = clamp01(elapsed / fadeSeconds);
      return fromGain + (targetGain - fromGain) * alpha;
    },
  };
}

