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
import { fingerprintDeterministicValue } from './fingerprint';
import type { GameTuning } from './types';

const DEFAULT_HELPLESS_RELEASE_SPEED_RATIO = 0.38;
const DEFAULT_LAUNCH_CLASH_SEPARATION_PADDING = 11.2;
const DEFAULT_LAUNCH_CLASH_RECOIL_MULTIPLIER = 0.58;
const DEFAULT_CLOSE_RANGE_SEPARATION_PADDING = 4.2;
const DEFAULT_CLOSE_RANGE_SEPARATION_IMPULSE = 10;
const DEFAULT_DEFENSIVE_RESET_DISTANCE = 26;
const DEFAULT_DEFENSIVE_RESET_IMPULSE = 14;
const DEFAULT_LAUNCH_BREAK_RESET_MULTIPLIER = 1.1;

export function createDefaultTuning(): GameTuning {
  return {
    chainWindowSeconds: CHAIN_WINDOW_SECONDS,
    playerMoveAccel: PLAYER_MOVE_ACCEL,
    playerVelocityDamping: PLAYER_VELOCITY_DAMPING,
    actionRecoveryControlMultiplier: 1,
    combatBoostReacquireDelaySeconds: 0,
    helplessVelocityDamping: HELPLESS_VELOCITY_DAMPING,
    helplessReleaseSpeedRatio: DEFAULT_HELPLESS_RELEASE_SPEED_RATIO,
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
    startupClashGraceSeconds: 0,
    postControlCounterLaunchClashGraceSeconds: 0,
    launchClashSeparationPadding: DEFAULT_LAUNCH_CLASH_SEPARATION_PADDING,
    launchClashRecoilMultiplier: DEFAULT_LAUNCH_CLASH_RECOIL_MULTIPLIER,
    closeRangeSeparationPadding: DEFAULT_CLOSE_RANGE_SEPARATION_PADDING,
    closeRangeSeparationImpulse: DEFAULT_CLOSE_RANGE_SEPARATION_IMPULSE,
    closeRangeCommitSeparationMultiplier: 0,
    defensiveResetDistance: DEFAULT_DEFENSIVE_RESET_DISTANCE,
    defensiveResetImpulse: DEFAULT_DEFENSIVE_RESET_IMPULSE,
    launchBreakResetMultiplier: DEFAULT_LAUNCH_BREAK_RESET_MULTIPLIER,
    naturalRecoveryResetMultiplier: 0,
    dunkRecoveryDurationSeconds: DUNK_RECOVERY_DURATION_SECONDS,
    dunkRecoveryMoveSpeed: DUNK_RECOVERY_MOVE_SPEED,
    dunkRecoveryFuelFraction: DUNK_RECOVERY_FUEL_FRACTION,
  };
}

export function sanitiseTuning(tuning: Partial<GameTuning>): GameTuning {
  const defaults = createDefaultTuning();
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  const finiteOrDefault = (value: number | undefined, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  );
  const value = (key: keyof GameTuning): number => finiteOrDefault(tuning[key], defaults[key]);
  return {
    chainWindowSeconds: clamp(value('chainWindowSeconds'), 0.1, 6),
    playerMoveAccel: clamp(value('playerMoveAccel'), 1, 400),
    playerVelocityDamping: clamp(value('playerVelocityDamping'), 0.5, 0.9995),
    actionRecoveryControlMultiplier: clamp(value('actionRecoveryControlMultiplier'), 0, 1),
    combatBoostReacquireDelaySeconds: clamp(value('combatBoostReacquireDelaySeconds'), 0, 1),
    helplessVelocityDamping: clamp(value('helplessVelocityDamping'), 0.5, 0.9999),
    helplessReleaseSpeedRatio: clamp(value('helplessReleaseSpeedRatio'), 0.05, 2),
    boostHoldSpeed: clamp(value('boostHoldSpeed'), 1, 300),
    superBoostHoldSpeed: clamp(value('superBoostHoldSpeed'), 1, 300),
    superBoostSteerLerp: clamp(value('superBoostSteerLerp'), 0.01, 1),
    superBoostVelocityBlend: clamp(value('superBoostVelocityBlend'), 0.01, 1),
    superBoostWaveAmplitude: clamp(value('superBoostWaveAmplitude'), 0, 30),
    superBoostFuelMultiplier: clamp(value('superBoostFuelMultiplier'), 0.01, 3),
    launchBasePower: clamp(value('launchBasePower'), 1, 400),
    launchChainBonus: clamp(value('launchChainBonus'), 0, 100),
    launchInputInfluence: clamp(value('launchInputInfluence'), 0, 1),
    launchHelplessSeconds: clamp(value('launchHelplessSeconds'), 0.1, 60),
    startupClashGraceSeconds: clamp(value('startupClashGraceSeconds'), 0, 0.25),
    postControlCounterLaunchClashGraceSeconds: clamp(
      value('postControlCounterLaunchClashGraceSeconds'),
      0,
      0.1,
    ),
    launchClashSeparationPadding: clamp(value('launchClashSeparationPadding'), 0, 40),
    launchClashRecoilMultiplier: clamp(value('launchClashRecoilMultiplier'), 0, 2),
    closeRangeSeparationPadding: clamp(value('closeRangeSeparationPadding'), 0, 30),
    closeRangeSeparationImpulse: clamp(value('closeRangeSeparationImpulse'), 0, 100),
    closeRangeCommitSeparationMultiplier: clamp(value('closeRangeCommitSeparationMultiplier'), 0, 1),
    defensiveResetDistance: clamp(value('defensiveResetDistance'), 0, 50),
    defensiveResetImpulse: clamp(value('defensiveResetImpulse'), 0, 150),
    launchBreakResetMultiplier: clamp(value('launchBreakResetMultiplier'), 0, 2),
    naturalRecoveryResetMultiplier: clamp(value('naturalRecoveryResetMultiplier'), 0, 2),
    dunkRecoveryDurationSeconds: clamp(value('dunkRecoveryDurationSeconds'), 0.1, 8),
    dunkRecoveryMoveSpeed: clamp(value('dunkRecoveryMoveSpeed'), 1, 300),
    dunkRecoveryFuelFraction: clamp(value('dunkRecoveryFuelFraction'), 0, 1),
  };
}

export function createGameTuningFingerprintInput(tuning: GameTuning): Partial<GameTuning> {
  const fingerprintInput: Partial<GameTuning> = { ...tuning };
  if (fingerprintInput.postControlCounterLaunchClashGraceSeconds === 0) {
    delete fingerprintInput.postControlCounterLaunchClashGraceSeconds;
  }
  if (fingerprintInput.combatBoostReacquireDelaySeconds === 0) {
    delete fingerprintInput.combatBoostReacquireDelaySeconds;
  }
  return fingerprintInput;
}

export function fingerprintGameTuning(tuning: GameTuning): string {
  return fingerprintDeterministicValue(createGameTuningFingerprintInput(tuning));
}
