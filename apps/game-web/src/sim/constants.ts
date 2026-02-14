import type { PlayerId, PlayersById } from './types';

export const PLAYER_IDS: PlayerId[] = ['P1', 'P2'];

export const OPPONENT_BY_ID: PlayersById<PlayerId> = {
  P1: 'P2',
  P2: 'P1',
};

export const ARENA_RADIUS = 72;
export const ARENA_WRAP_RADIUS = ARENA_RADIUS + 4;
export const PROJECTILE_CULL_RADIUS = ARENA_RADIUS + 10;
export const CHAIN_WINDOW_SECONDS = 1.25;
export const PLAYER_MOVE_ACCEL = 140;
export const PLAYER_VELOCITY_DAMPING = 0.9;
export const HELPLESS_VELOCITY_DAMPING = 0.996;
export const MAX_FUEL = 300;
export const BOOST_HOLD_SPEED = 72;
export const SUPER_BOOST_HOLD_SPEED = 76;
export const SUPER_BOOST_STEER_LERP = 1;
export const SUPER_BOOST_VELOCITY_BLEND = 1;
export const SUPER_BOOST_WAVE_AMPLITUDE = 0;
export const SUPER_BOOST_FUEL_MULTIPLIER = 0.8;
export const LAUNCH_BASE_POWER = 126;
export const LAUNCH_CHAIN_BONUS = 34;
export const LAUNCH_INPUT_INFLUENCE = 0.06;
export const LAUNCH_HELPLESS_SECONDS = 11.16;
export const DUNK_RECOVERY_DURATION_SECONDS = 1.05;
export const DUNK_RECOVERY_MOVE_SPEED = 42;
export const DUNK_RECOVERY_ARC_DEPTH = 10;
export const DUNK_RECOVERY_MIN_SCALE = 0.62;

export const PARRY_FLASH_SECONDS = 0.2;
export const SPECIAL_FLASH_SECONDS = 0.16;
export const LAUNCH_FLASH_SECONDS = 0.24;
export const BREAK_FLASH_SECONDS = 0.28;
export const DUNK_FLASH_SECONDS = 0.24;
export const DUNK_RECOVERY_FUEL_FRACTION = 0.2;

export const STATUS_TEXT = {
  neutral: 'Neutral state - orbit, bait, and look for launch into dunk.',
  launch: 'Launch state active - intercept or spend a launch break.',
};
