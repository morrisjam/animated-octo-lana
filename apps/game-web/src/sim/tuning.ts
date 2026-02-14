import {
  BOOST_HOLD_SPEED,
  CHAIN_WINDOW_SECONDS,
  DUNK_RECOVERY_DURATION_SECONDS,
  DUNK_RECOVERY_FUEL_FRACTION,
  DUNK_RECOVERY_MOVE_SPEED,
  HELPLESS_VELOCITY_DAMPING,
  LAUNCH_BASE_POWER,
  LAUNCH_CHAIN_BONUS,
  LAUNCH_HELPLESS_SECONDS,
  LAUNCH_INPUT_INFLUENCE,
  PLAYER_MOVE_ACCEL,
  PLAYER_VELOCITY_DAMPING,
  SUPER_BOOST_FUEL_MULTIPLIER,
  SUPER_BOOST_HOLD_SPEED,
  SUPER_BOOST_STEER_LERP,
  SUPER_BOOST_VELOCITY_BLEND,
  SUPER_BOOST_WAVE_AMPLITUDE,
} from './constants';
import type { GameTuning } from './types';

export function createDefaultTuning(): GameTuning {
  return {
    chainWindowSeconds: CHAIN_WINDOW_SECONDS,
    playerMoveAccel: PLAYER_MOVE_ACCEL,
    playerVelocityDamping: PLAYER_VELOCITY_DAMPING,
    helplessVelocityDamping: HELPLESS_VELOCITY_DAMPING,
    boostHoldSpeed: BOOST_HOLD_SPEED,
    superBoostHoldSpeed: SUPER_BOOST_HOLD_SPEED,
    superBoostSteerLerp: SUPER_BOOST_STEER_LERP,
    superBoostVelocityBlend: SUPER_BOOST_VELOCITY_BLEND,
    superBoostWaveAmplitude: SUPER_BOOST_WAVE_AMPLITUDE,
    superBoostFuelMultiplier: SUPER_BOOST_FUEL_MULTIPLIER,
    launchBasePower: LAUNCH_BASE_POWER,
    launchChainBonus: LAUNCH_CHAIN_BONUS,
    launchInputInfluence: LAUNCH_INPUT_INFLUENCE,
    launchHelplessSeconds: LAUNCH_HELPLESS_SECONDS,
    dunkRecoveryDurationSeconds: DUNK_RECOVERY_DURATION_SECONDS,
    dunkRecoveryMoveSpeed: DUNK_RECOVERY_MOVE_SPEED,
    dunkRecoveryFuelFraction: DUNK_RECOVERY_FUEL_FRACTION,
  };
}

export function sanitiseTuning(tuning: GameTuning): GameTuning {
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  return {
    chainWindowSeconds: clamp(tuning.chainWindowSeconds, 0.1, 6),
    playerMoveAccel: clamp(tuning.playerMoveAccel, 1, 400),
    playerVelocityDamping: clamp(tuning.playerVelocityDamping, 0.5, 0.9995),
    helplessVelocityDamping: clamp(tuning.helplessVelocityDamping, 0.5, 0.9999),
    boostHoldSpeed: clamp(tuning.boostHoldSpeed, 1, 300),
    superBoostHoldSpeed: clamp(tuning.superBoostHoldSpeed, 1, 300),
    superBoostSteerLerp: clamp(tuning.superBoostSteerLerp, 0.01, 1),
    superBoostVelocityBlend: clamp(tuning.superBoostVelocityBlend, 0.01, 1),
    superBoostWaveAmplitude: clamp(tuning.superBoostWaveAmplitude, 0, 30),
    superBoostFuelMultiplier: clamp(tuning.superBoostFuelMultiplier, 0.01, 3),
    launchBasePower: clamp(tuning.launchBasePower, 1, 400),
    launchChainBonus: clamp(tuning.launchChainBonus, 0, 100),
    launchInputInfluence: clamp(tuning.launchInputInfluence, 0, 1),
    launchHelplessSeconds: clamp(tuning.launchHelplessSeconds, 0.1, 60),
    dunkRecoveryDurationSeconds: clamp(tuning.dunkRecoveryDurationSeconds, 0.1, 8),
    dunkRecoveryMoveSpeed: clamp(tuning.dunkRecoveryMoveSpeed, 1, 300),
    dunkRecoveryFuelFraction: clamp(tuning.dunkRecoveryFuelFraction, 0, 1),
  };
}
