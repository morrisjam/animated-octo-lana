import { resolveCharacterBalanceConfig } from './characterBalance';
import { framesToSeconds } from './moveData';
import { createStateSnapshot, step } from './sim';
import type { GameState, PlayerFrameInput, PlayerId } from './types';

export const MAX_FINISH_FORECAST_FRAMES = 120;

const idle = (): PlayerFrameInput => ({
  moveX: 0, moveY: 0, boost: false, superBoost: false,
  launch: false, special: false, dunk: false, parry: false, breakLaunch: false,
});

export function finishChaseInput(
  state: GameState,
  playerId: PlayerId,
  canStartSuperBoost: boolean,
): PlayerFrameInput {
  const player = state.players[playerId];
  const target = state.players[playerId === 'P1' ? 'P2' : 'P1'];
  const moves = resolveCharacterBalanceConfig(player.characterId, state.characterBalanceOverrides).moves;
  const distance = Math.hypot(target.pos.x - player.pos.x, target.pos.y - player.pos.y);
  const lead = Math.min(0.65, Math.max(0.08, distance / 110,
    player.dunkStartup > 0 ? player.dunkStartup + 0.08 : 0));
  const dx = target.pos.x + target.vel.x * lead - player.pos.x;
  const dy = target.pos.y + target.vel.y * lead - player.pos.y;
  const length = Math.hypot(dx, dy);
  const center = Math.hypot(player.pos.x, player.pos.y);
  const input = idle();
  input.moveX = (length > 0.001 ? dx / length : 0) * 0.96
    - (center > 0.001 ? player.pos.x / center : 0) * 0.08;
  input.moveY = (length > 0.001 ? dy / length : 0) * 0.96
    - (center > 0.001 ? player.pos.y / center : 0) * 0.08;
  input.moveX = Math.max(-1, Math.min(1, input.moveX));
  input.moveY = Math.max(-1, Math.min(1, input.moveY));
  input.boost = distance > moves.dunk.hitRange + 1.5 && player.fuel > player.maxFuel * 0.03;
  input.superBoost = distance > moves.dunk.hitRange + 3 && player.fuel > player.maxFuel * 0.12
    && (player.superBoost > 0 || canStartSuperBoost);
  if (input.superBoost) input.boost = false;
  return input;
}

/** Forecast the authored window against an immediate launch on control return. */
export function canInterceptFinish(
  state: GameState,
  playerId: PlayerId,
  firstInput: PlayerFrameInput,
): boolean {
  const targetId = playerId === 'P1' ? 'P2' : 'P1';
  const moves = resolveCharacterBalanceConfig(
    state.players[playerId].characterId, state.characterBalanceOverrides,
  ).moves;
  // Bound live decision cost even for experimental, very long authored moves.
  // Never approve contact outside the simulated horizon.
  if (moves.dunk.startupFrames >= MAX_FINISH_FORECAST_FRAMES) return false;
  const horizon = Math.min(MAX_FINISH_FORECAST_FRAMES,
    moves.dunk.startupFrames + moves.dunk.activeFrames + 1);
  const forecast = createStateSnapshot(state);
  const counter = resolveCharacterBalanceConfig(
    state.players[targetId].characterId, state.characterBalanceOverrides,
  ).moves.launch;
  const opponentInput = idle();
  let releasedFrames = 0;
  // The start tick precedes startup advancement; contact starts the following tick.
  for (let frame = 0; frame < horizon; frame += 1) {
    const input = frame === 0 ? { ...firstInput, dunk: true }
      : finishChaseInput(forecast, playerId, false);
    const attacker = forecast.players[playerId];
    const target = forecast.players[targetId];
    if (releasedFrames > 0 || (target.helpless <= 0 && target.stunned <= 0 && target.recovering <= 0
      && target.endLag <= 0 && target.cool.launch <= 0
      && target.launchStartup <= 0 && target.launchActive <= 0
      && target.specialStartup <= 0 && target.specialActive <= 0
      && target.dunkStartup <= 0 && target.dunkActive <= 0)) {
      if (releasedFrames++ > counter.startupFrames) return false;
      opponentInput.launch = true;
      // A release is not itself a whiff, but it removes the guaranteed opening.
      // Test the fastest counter-launch rather than assuming an idle opponent.
      const dx = attacker.pos.x - target.pos.x;
      const dy = attacker.pos.y - target.pos.y;
      const distance = Math.hypot(dx, dy);
      opponentInput.moveX = distance > 0.001 ? dx / distance : 0;
      opponentInput.moveY = distance > 0.001 ? dy / distance : 0;
    }
    const wasActive = attacker.dunkActive > 0;
    const previousRecovery = target.recovering;
    step(forecast, playerId === 'P1'
      ? { p1: input, p2: opponentInput } : { p1: opponentInput, p2: input }, framesToSeconds(1));
    if (wasActive && (forecast.winner === playerId
      || (target.recovering > previousRecovery && attacker.dunkActive <= 0))) {
      return true;
    }
    if (forecast.winner
      || attacker.helpless > 0 || attacker.stunned > 0 || attacker.recovering > 0) return false;
  }
  return false;
}
