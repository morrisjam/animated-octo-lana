import { CHARACTER_BY_ID } from './characters';
import { ARENA_RADIUS } from './constants';
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
    breakLaunch: number;
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
      breakLaunch: 0.55,
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
      breakLaunch: 0.76,
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
      breakLaunch: 0.94,
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
      breakLaunch: 1.08,
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
  maneuverFramesRemaining: number;
  strafeSign: -1 | 1;
}

export interface AiTickResult {
  input: PlayerFrameInput;
  next: AiControllerState;
}

interface ProjectileThreatSummary {
  friendlyProjectileCount: number;
  incomingProjectileDistance: number;
  incomingDirX: number;
  incomingDirY: number;
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

function getCharacterMoves(player: GameState['players']['P1']) {
  return CHARACTER_BY_ID[player.characterId].moves;
}

function nextAiRoll(rngState: number): { rngState: number; roll: number } {
  const nextState = nextRngState(rngState);
  return {
    rngState: nextState,
    roll: rngStateToUnitFloat(nextState),
  };
}

function summariseProjectileThreat(
  state: GameState,
  playerId: PlayerId,
  player: GameState['players']['P1'],
): ProjectileThreatSummary {
  let friendlyProjectileCount = 0;
  let incomingProjectileDistance = Number.POSITIVE_INFINITY;
  let incomingDirX = 0;
  let incomingDirY = 0;

  for (const projectile of state.projectiles) {
    if (projectile.ownerId === playerId) {
      friendlyProjectileCount += 1;
      continue;
    }

    const dx = player.pos.x - projectile.pos.x;
    const dy = player.pos.y - projectile.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= incomingProjectileDistance) {
      continue;
    }

    incomingProjectileDistance = distance;
    const velocityLength = Math.hypot(projectile.vel.x, projectile.vel.y);
    if (velocityLength > 0.001) {
      incomingDirX = projectile.vel.x / velocityLength;
      incomingDirY = projectile.vel.y / velocityLength;
    } else if (distance > 0.001) {
      incomingDirX = -dx / distance;
      incomingDirY = -dy / distance;
    } else {
      incomingDirX = 0;
      incomingDirY = 0;
    }
  }

  return {
    friendlyProjectileCount,
    incomingProjectileDistance,
    incomingDirX,
    incomingDirY,
  };
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
    maneuverFramesRemaining: 0,
    strafeSign: 1,
  };
}

export function tickAiController(state: GameState, playerId: PlayerId, controller: AiControllerState): AiTickResult {
  const player = state.players[playerId];
  const opponent = state.players[toOpponent(playerId)];
  const profile = resolveDifficulty(controller.profileId);
  const playerMoves = getCharacterMoves(player);
  const opponentMoves = getCharacterMoves(opponent);
  const specialMove = playerMoves.special;
  let rngState = controller.rngState;
  let decisionLockFrames = Math.max(0, controller.decisionLockFrames - 1);
  let reactionFramesRemaining = Math.max(0, controller.reactionFramesRemaining - 1);
  let maneuverFramesRemaining = Math.max(0, controller.maneuverFramesRemaining - 1);
  let strafeSign = controller.strafeSign;
  const input = createNeutralInput();

  const deltaX = opponent.pos.x - player.pos.x;
  const deltaY = opponent.pos.y - player.pos.y;
  const distance = Math.hypot(deltaX, deltaY);
  const dirX = distance > 0.001 ? deltaX / distance : 0;
  const dirY = distance > 0.001 ? deltaY / distance : 0;
  const tangentX = -dirY * strafeSign;
  const tangentY = dirX * strafeSign;
  const centerDistance = Math.hypot(player.pos.x, player.pos.y);
  const toCenterX = centerDistance > 0.001 ? -player.pos.x / centerDistance : 0;
  const toCenterY = centerDistance > 0.001 ? -player.pos.y / centerDistance : 0;
  const pressureDistance = profile.approachDistance;
  const projectileThreat = summariseProjectileThreat(state, playerId, player);
  const hasIncomingProjectile = Number.isFinite(projectileThreat.incomingProjectileDistance);
  const incomingProjectileClose = hasIncomingProjectile && projectileThreat.incomingProjectileDistance < 16;
  const incomingProjectileUrgent = hasIncomingProjectile && projectileThreat.incomingProjectileDistance < 9;
  const friendlyProjectileCount = projectileThreat.friendlyProjectileCount;
  const lowFuel = player.fuel < player.maxFuel * (0.22 + (1 - profile.riskAppetite) * 0.08);
  const opponentOpen = opponent.endLag > 0
    || opponent.stunned > 0
    || opponent.recovering > 0
    || opponent.helpless > 0
    || opponent.launchStartup > 0
    || opponent.dunkStartup > 0
    || opponent.specialStartup > 0;
  const opponentCommittedAttack = opponent.launchStartup > 0
    || opponent.launchActive > 0
    || opponent.dunkStartup > 0
    || opponent.dunkActive > 0
    || opponent.specialStartup > 0
    || opponent.specialActive > 0;
  const opponentThreatening = opponentCommittedAttack && distance < Math.max(10, opponentMoves.dunk.hitRange + 2.5);
  const boundaryRisk = centerDistance > ARENA_RADIUS * 0.72;
  const dunkThreat = opponent.helpless <= 0
    && opponent.cool.dunk <= 0
    && distance < opponentMoves.dunk.hitRange + 3.5;
  const projectileLane = specialMove.behaviorId === 'special.projectile.v1'
    && distance > 10
    && distance < specialMove.size.range * 0.82;

  if (maneuverFramesRemaining <= 0) {
    const maneuverRoll = nextAiRoll(rngState);
    rngState = maneuverRoll.rngState;
    strafeSign = maneuverRoll.roll < 0.5 ? -1 : 1;
    maneuverFramesRemaining = Math.round(18 + (1 - profile.errorRate) * 18 + maneuverRoll.roll * 12);
  }

  if (incomingProjectileClose) {
    input.moveX = clampAxis(-projectileThreat.incomingDirY * strafeSign + toCenterX * 0.55);
    input.moveY = clampAxis(projectileThreat.incomingDirX * strafeSign + toCenterY * 0.55);
    input.boost = incomingProjectileUrgent && player.fuel > player.maxFuel * 0.08;
  } else if (opponent.helpless > 0 || opponent.recovering > 0) {
    input.moveX = clampAxis(dirX * 0.92 + toCenterX * 0.15);
    input.moveY = clampAxis(dirY * 0.92 + toCenterY * 0.15);
    input.boost = distance > opponentMoves.dunk.hitRange + 2 && player.fuel > player.maxFuel * 0.1;
    input.superBoost = distance > opponentMoves.dunk.hitRange + 7
      && player.fuel > player.maxFuel * 0.34
      && !lowFuel;
  } else if (lowFuel && distance < pressureDistance + 4.5) {
    input.moveX = clampAxis(-dirX * 0.82 + tangentX * 0.45 + toCenterX * 0.3);
    input.moveY = clampAxis(-dirY * 0.82 + tangentY * 0.45 + toCenterY * 0.3);
    input.boost = player.fuel > player.maxFuel * 0.07;
  } else if (specialMove.behaviorId === 'special.projectile.v1' && friendlyProjectileCount > 0) {
    input.moveX = clampAxis(-dirX * 0.28 + tangentX * 0.82 + toCenterX * 0.25);
    input.moveY = clampAxis(-dirY * 0.28 + tangentY * 0.82 + toCenterY * 0.25);
  } else if (distance > pressureDistance + 5.5) {
    input.moveX = clampAxis(dirX * 0.92 + tangentX * 0.16);
    input.moveY = clampAxis(dirY * 0.92 + tangentY * 0.16);
    input.boost = player.fuel > player.maxFuel * (0.12 - profile.riskAppetite * 0.05);
    input.superBoost = distance > pressureDistance + 11
      && player.fuel > player.maxFuel * 0.3
      && !lowFuel
      && (profile.riskAppetite > 0.55 || opponentOpen);
  } else if (distance > pressureDistance * 0.64) {
    input.moveX = clampAxis(dirX * 0.55 + tangentX * 0.6 + toCenterX * 0.15);
    input.moveY = clampAxis(dirY * 0.55 + tangentY * 0.6 + toCenterY * 0.15);
  } else {
    const closeRangeRetreat = specialMove.behaviorId === 'special.projectile.v1' || lowFuel || opponent.parry > 0;
    const closeRangeBias = closeRangeRetreat ? -0.42 : 0.1;
    input.moveX = clampAxis(dirX * closeRangeBias + tangentX * 0.92 + toCenterX * 0.22);
    input.moveY = clampAxis(dirY * closeRangeBias + tangentY * 0.92 + toCenterY * 0.22);
  }

  const mistakeSample = nextAiRoll(rngState);
  rngState = mistakeSample.rngState;
  const shouldMakeMistake = mistakeSample.roll < profile.errorRate;
  if (shouldMakeMistake) {
    const driftSample = nextAiRoll(rngState);
    rngState = driftSample.rngState;
    const drift = driftSample.roll < 0.5 ? -1 : 1;
    input.moveX = clampAxis(input.moveX * 0.3 + drift * 0.7);
    input.moveY = clampAxis(input.moveY * 0.3 - drift * 0.25);
    input.boost = false;
    input.superBoost = false;
  }

  if (player.helpless > 0 && player.launchBreaks > 0) {
    const lateHelplessWindow = player.helpless < 2.6 - profile.riskAppetite * 0.8;
    const urgentBreak = boundaryRisk || dunkThreat || lateHelplessWindow;
    if (urgentBreak) {
      const breakRoll = nextAiRoll(rngState);
      rngState = breakRoll.rngState;
      if (breakRoll.roll < clamp01(profile.actionWeights.breakLaunch * (boundaryRisk ? 1 : 0.82))) {
        input.breakLaunch = true;
      }
    }
  }

  if (opponent.helpless > 0 && player.cool.dunk <= 0 && distance < playerMoves.dunk.hitRange + 0.6) {
    input.dunk = true;
  }

  if (!shouldMakeMistake && decisionLockFrames <= 0 && reactionFramesRemaining <= 0 && player.endLag <= 0) {
    const launchReady = player.cool.launch <= 0
      && distance < pressureDistance + profile.riskAppetite * 1.4
      && opponent.parry <= 0
      && !incomingProjectileUrgent;
    const specialReady = player.cool.special <= 0;
    const dunkReady = player.cool.dunk <= 0 && opponent.helpless > 0 && distance < playerMoves.dunk.hitRange + 0.8;
    const parryReady = player.parry <= 0 && (opponentThreatening || incomingProjectileUrgent);

    if (parryReady && incomingProjectileUrgent && specialMove.behaviorId !== 'special.block_guard.v1') {
      input.parry = true;
      decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 3));
      reactionFramesRemaining = profile.reactionDelayFrames;
    } else {
      const distancePressure = clamp01(1 - distance / (pressureDistance + 4));
      const launchWeight = launchReady
        ? profile.actionWeights.launch
          * (0.28 + distancePressure + profile.riskAppetite * 0.22)
          * (opponentOpen ? 1.18 : 1)
        : 0;

      let specialWeight = 0;
      if (specialReady) {
        switch (specialMove.behaviorId) {
          case 'special.projectile.v1':
            specialWeight = profile.actionWeights.special
              * (projectileLane ? 1.15 : 0.2)
              * (friendlyProjectileCount === 0 ? 1 : 0.18)
              * (incomingProjectileClose ? 0.25 : 1);
            break;
          case 'special.movement_dash.v1':
            specialWeight = profile.actionWeights.special
              * ((distance > 7 && distance < specialMove.size.range + 4) ? 0.82 : 0.18)
              * (opponentOpen ? 1.35 : 1)
              * (lowFuel ? 0.45 : 1);
            break;
          case 'special.block_guard.v1':
            specialWeight = profile.actionWeights.special
              * ((opponentThreatening || incomingProjectileClose || distance < pressureDistance * 0.9) ? 1.28 : 0.16);
            break;
          case 'special.command_grab.v1':
            specialWeight = profile.actionWeights.special
              * ((distance < specialMove.size.range) ? 1.1 : 0.1)
              * (opponentOpen ? 1.25 : 0.7);
            break;
          default:
            specialWeight = 0;
            break;
        }
      }

      const dunkWeight = dunkReady
        ? profile.actionWeights.dunk * (0.9 + profile.riskAppetite * 0.45)
        : 0;
      const parryWeight = parryReady
        ? profile.actionWeights.parry
          * ((incomingProjectileUrgent || opponentThreatening) ? 1.2 : 0.65)
          * (specialMove.behaviorId === 'special.block_guard.v1' ? 0.7 : 1)
        : 0;
      const totalWeight = launchWeight + specialWeight + dunkWeight + parryWeight;

      if (totalWeight > 0) {
        const pickSample = nextAiRoll(rngState);
        rngState = pickSample.rngState;
        let pick = pickSample.roll * totalWeight;
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
        decisionLockFrames = Math.max(2, Math.round(2 + (1 - profile.riskAppetite) * 4));
        reactionFramesRemaining = profile.reactionDelayFrames;
      }
    }
  }

  if (!shouldMakeMistake && opponentThreatening && player.parry <= 0 && player.endLag <= 0) {
    const parrySample = nextAiRoll(rngState);
    rngState = parrySample.rngState;
    const parryRoll = parrySample.roll;
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
      maneuverFramesRemaining,
      strafeSign,
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
