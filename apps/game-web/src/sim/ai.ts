import { nextRngState, rngStateToUnitFloat, sanitiseSeed } from './rng';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId } from './types';

export type AiDifficultyId = 'rookie' | 'cadet' | 'veteran' | 'ace';

export interface AiDifficultyProfile {
  id: AiDifficultyId;
  label: string;
  reactionDelayFrames: number;
  errorRate: number;
  riskAppetite: number;
  approachDistance: number;
  actionWeights: {
    launch: number;
    special: number;
    dunk: number;
    parry: number;
  };
}

export const AI_DIFFICULTY_ORDER: AiDifficultyId[] = ['rookie', 'cadet', 'veteran', 'ace'];

export const AI_DIFFICULTY_PROFILES: Record<AiDifficultyId, AiDifficultyProfile> = {
  rookie: {
    id: 'rookie',
    label: 'Rookie',
    reactionDelayFrames: 18,
    errorRate: 0.28,
    riskAppetite: 0.28,
    approachDistance: 10.8,
    actionWeights: {
      launch: 0.7,
      special: 0.55,
      dunk: 0.6,
      parry: 0.45,
    },
  },
  cadet: {
    id: 'cadet',
    label: 'Cadet',
    reactionDelayFrames: 13,
    errorRate: 0.18,
    riskAppetite: 0.46,
    approachDistance: 9.8,
    actionWeights: {
      launch: 0.9,
      special: 0.8,
      dunk: 0.78,
      parry: 0.72,
    },
  },
  veteran: {
    id: 'veteran',
    label: 'Veteran',
    reactionDelayFrames: 9,
    errorRate: 0.1,
    riskAppetite: 0.62,
    approachDistance: 9,
    actionWeights: {
      launch: 1.15,
      special: 1.02,
      dunk: 0.92,
      parry: 0.95,
    },
  },
  ace: {
    id: 'ace',
    label: 'Ace',
    reactionDelayFrames: 6,
    errorRate: 0.04,
    riskAppetite: 0.8,
    approachDistance: 8.4,
    actionWeights: {
      launch: 1.35,
      special: 1.2,
      dunk: 1.05,
      parry: 1.2,
    },
  },
};

export const DEFAULT_AI_DIFFICULTY: AiDifficultyId = 'cadet';

export interface CreateAiControllerOptions {
  seed?: number;
  profileId?: AiDifficultyId;
}

export interface AiControllerState {
  rngState: number;
  decisionLockFrames: number;
  reactionFramesRemaining: number;
  profileId: AiDifficultyId;
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

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function resolveDifficulty(profileId: AiDifficultyId | undefined): AiDifficultyProfile {
  if (!profileId) {
    return AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY];
  }
  return AI_DIFFICULTY_PROFILES[profileId] ?? AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY];
}

export function listAiDifficultyProfiles(): AiDifficultyProfile[] {
  return AI_DIFFICULTY_ORDER.map((id) => AI_DIFFICULTY_PROFILES[id]);
}

export function createAiController(seedOrOptions?: number | CreateAiControllerOptions): AiControllerState {
  const options = typeof seedOrOptions === 'number'
    ? { seed: seedOrOptions }
    : (seedOrOptions ?? {});
  const profile = resolveDifficulty(options.profileId);
  return {
    rngState: sanitiseSeed(options.seed),
    decisionLockFrames: 0,
    reactionFramesRemaining: profile.reactionDelayFrames,
    profileId: profile.id,
  };
}

export function tickAiController(state: GameState, playerId: PlayerId, controller: AiControllerState): AiTickResult {
  const player = state.players[playerId];
  const opponent = state.players[toOpponent(playerId)];
  const profile = resolveDifficulty(controller.profileId);
  let rngState = controller.rngState;
  let decisionLockFrames = Math.max(0, controller.decisionLockFrames - 1);
  let reactionFramesRemaining = Math.max(0, controller.reactionFramesRemaining - 1);
  const input = createNeutralInput();

  const deltaX = opponent.pos.x - player.pos.x;
  const deltaY = opponent.pos.y - player.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const dirX = distance > 0.001 ? deltaX / distance : 0;
  const dirY = distance > 0.001 ? deltaY / distance : 0;
  const pressureDistance = profile.approachDistance;

  if (distance > pressureDistance + 2.2) {
    input.moveX = clampAxis(dirX);
    input.moveY = clampAxis(dirY);
    input.boost = player.fuel > player.maxFuel * (0.18 - profile.riskAppetite * 0.1);
  } else if (distance > pressureDistance * 0.58) {
    input.moveX = clampAxis(dirX * 0.7 - dirY * 0.3);
    input.moveY = clampAxis(dirY * 0.7 + dirX * 0.3);
  } else {
    input.moveX = clampAxis(-dirY);
    input.moveY = clampAxis(dirX);
  }

  rngState = nextRngState(rngState);
  const mistakeRoll = rngStateToUnitFloat(rngState);
  const shouldMakeMistake = mistakeRoll < profile.errorRate;
  if (shouldMakeMistake) {
    rngState = nextRngState(rngState);
    const driftRoll = rngStateToUnitFloat(rngState);
    const drift = driftRoll < 0.5 ? -1 : 1;
    input.moveX = clampAxis(input.moveX * 0.3 + drift * 0.7);
    input.moveY = clampAxis(input.moveY * 0.3 - drift * 0.25);
    input.boost = false;
  }

  if (player.helpless > 0 && player.launchBreaks > 0) {
    input.breakLaunch = true;
  }

  if (opponent.helpless > 0 && player.cool.dunk <= 0 && distance < 8.5) {
    input.dunk = true;
  }

  const opponentThreatening = opponent.launchStartup > 0
    || opponent.launchActive > 0
    || opponent.dunkStartup > 0
    || opponent.dunkActive > 0
    || opponent.specialActive > 0;

  if (!shouldMakeMistake && decisionLockFrames <= 0 && reactionFramesRemaining <= 0 && player.endLag <= 0) {
    const launchReady = player.cool.launch <= 0 && distance < pressureDistance + profile.riskAppetite * 1.4;
    const specialReady = player.cool.special <= 0;
    const dunkReady = player.cool.dunk <= 0 && opponent.helpless > 0 && distance < 9.2;
    const parryReady = player.parry <= 0 && opponentThreatening;

    const distancePressure = clamp01(1 - distance / (pressureDistance + 4));
    const launchWeight = launchReady ? profile.actionWeights.launch * (0.45 + distancePressure + profile.riskAppetite * 0.25) : 0;
    const specialWeight = specialReady ? profile.actionWeights.special * (0.35 + (1 - distancePressure) * 0.65) : 0;
    const dunkWeight = dunkReady ? profile.actionWeights.dunk * (0.8 + profile.riskAppetite * 0.4) : 0;
    const parryWeight = parryReady ? profile.actionWeights.parry * (0.75 + (1 - profile.riskAppetite) * 0.45) : 0;
    const totalWeight = launchWeight + specialWeight + dunkWeight + parryWeight;

    if (totalWeight > 0) {
      rngState = nextRngState(rngState);
      let pick = rngStateToUnitFloat(rngState) * totalWeight;
      if (pick < launchWeight) {
        input.launch = true;
      } else {
        pick -= launchWeight;
        if (pick < specialWeight) {
          input.special = true;
        } else {
          pick -= specialWeight;
          if (pick < dunkWeight) {
            input.dunk = true;
          } else if (parryWeight > 0) {
            input.parry = true;
          }
        }
      }
      decisionLockFrames = Math.max(2, Math.round(3 + (1 - profile.riskAppetite) * 5));
      reactionFramesRemaining = profile.reactionDelayFrames;
    }
  }

  if (!shouldMakeMistake && opponentThreatening && player.parry <= 0 && player.endLag <= 0) {
    rngState = nextRngState(rngState);
    const parryRoll = rngStateToUnitFloat(rngState);
    if (parryRoll > 1 - clamp01(profile.actionWeights.parry * 0.45)) {
      input.parry = true;
    }
  }

  return {
    input,
    next: {
      rngState,
      decisionLockFrames,
      reactionFramesRemaining,
      profileId: profile.id,
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
