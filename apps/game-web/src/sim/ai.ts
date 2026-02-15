import { nextRngState, rngStateToUnitFloat, sanitiseSeed } from './rng';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId } from './types';

export interface AiControllerState {
  rngState: number;
  decisionLockFrames: number;
}

export interface AiTickResult {
  input: PlayerFrameInput;
  next: AiControllerState;
}

function createNeutralInput(): PlayerFrameInput {
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

function clampAxis(value: number): number {
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
}

function toOpponent(playerId: PlayerId): PlayerId {
  return playerId === 'P1' ? 'P2' : 'P1';
}

export function createAiController(seed: number | undefined): AiControllerState {
  return {
    rngState: sanitiseSeed(seed),
    decisionLockFrames: 0,
  };
}

export function tickAiController(state: GameState, playerId: PlayerId, controller: AiControllerState): AiTickResult {
  const player = state.players[playerId];
  const opponent = state.players[toOpponent(playerId)];
  let rngState = controller.rngState;
  let decisionLockFrames = Math.max(0, controller.decisionLockFrames - 1);
  const input = createNeutralInput();

  const deltaX = opponent.pos.x - player.pos.x;
  const deltaY = opponent.pos.y - player.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const dirX = distance > 0.001 ? deltaX / distance : 0;
  const dirY = distance > 0.001 ? deltaY / distance : 0;

  if (distance > 12) {
    input.moveX = clampAxis(dirX);
    input.moveY = clampAxis(dirY);
    input.boost = player.fuel > player.maxFuel * 0.18;
  } else if (distance > 6) {
    input.moveX = clampAxis(dirX * 0.7 - dirY * 0.3);
    input.moveY = clampAxis(dirY * 0.7 + dirX * 0.3);
  } else {
    input.moveX = clampAxis(-dirY);
    input.moveY = clampAxis(dirX);
  }

  if (player.helpless > 0 && player.launchBreaks > 0) {
    input.breakLaunch = true;
  }

  if (opponent.helpless > 0 && player.cool.dunk <= 0 && distance < 8.5) {
    input.dunk = true;
  }

  if (decisionLockFrames <= 0) {
    rngState = nextRngState(rngState);
    const attackRoll = rngStateToUnitFloat(rngState);
    if (player.cool.launch <= 0 && player.endLag <= 0 && distance < 9.2 && attackRoll > 0.78) {
      input.launch = true;
      decisionLockFrames = 6;
    } else if (player.cool.special <= 0 && player.endLag <= 0 && attackRoll > 0.67) {
      input.special = true;
      decisionLockFrames = 4;
    }
  }

  if (opponent.launchActive > 0 || opponent.dunkActive > 0) {
    rngState = nextRngState(rngState);
    const parryRoll = rngStateToUnitFloat(rngState);
    if (player.parry <= 0 && player.endLag <= 0 && parryRoll > 0.52) {
      input.parry = true;
    }
  }

  return {
    input,
    next: {
      rngState,
      decisionLockFrames,
    },
  };
}

export function buildFrameInputWithAi(
  localInput: PlayerFrameInput,
  aiInput: PlayerFrameInput,
  aiPlayerId: PlayerId,
): FrameInput {
  if (aiPlayerId === 'P1') {
    return {
      p1: aiInput,
      p2: localInput,
    };
  }
  return {
    p1: localInput,
    p2: aiInput,
  };
}

