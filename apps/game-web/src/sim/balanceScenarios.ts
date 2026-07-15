import type { GameState, PlayerState } from './types';

export const BALANCE_SCENARIO_SCHEMA_VERSION = 'gw.balance-scenario.v1';

export type BalanceScenarioId =
  | 'standard'
  | 'long_neutral'
  | 'close_pressure'
  | 'post_clash'
  | 'launch_break_decision'
  | 'control_return_pressure'
  | 'p1_control_return_pressure'
  | 'zero_fuel_chase';

export interface BalanceScenario {
  id: BalanceScenarioId;
  label: string;
  description: string;
}

export type BalanceScenarioPreset = BalanceScenario;

export const DEFAULT_BALANCE_SCENARIO_ID: BalanceScenarioId = 'standard';

export const BALANCE_SCENARIOS: readonly BalanceScenario[] = [
  {
    id: 'standard',
    label: 'Standard start',
    description: 'Use the normal match spawn and resources without changes.',
  },
  {
    id: 'long_neutral',
    label: 'Long neutral',
    description: 'Full-resource fighters orbit at long range with complete control.',
  },
  {
    id: 'close_pressure',
    label: 'Close pressure',
    description: 'Both fighters enter close range with inward momentum and partially spent resources.',
  },
  {
    id: 'post_clash',
    label: 'Post-clash reset',
    description: 'Both fighters recoil from a launch clash with a brief recovery window.',
  },
  {
    id: 'launch_break_decision',
    label: 'Launch-break decision',
    description: 'P2 is launched with one break remaining while P1 carries chase momentum.',
  },
  {
    id: 'control_return_pressure',
    label: 'Control return pressure',
    description: "P2 is about to regain control inside P1's committed chase pressure.",
  },
  {
    id: 'p1_control_return_pressure',
    label: 'Human control return pressure',
    description: "P1 is about to regain control inside P2's committed chase pressure.",
  },
  {
    id: 'zero_fuel_chase',
    label: 'Zero-fuel chase',
    description: 'P1 pursues a helpless, empty P2 with no launch breaks before a finish attempt.',
  },
];

export const BALANCE_SCENARIO_PRESETS = BALANCE_SCENARIOS;
export const BALANCE_SCENARIO_IDS: readonly BalanceScenarioId[] = BALANCE_SCENARIOS.map(
  (scenario) => scenario.id,
);
export const BALANCE_SCENARIO_BY_ID: Readonly<Record<BalanceScenarioId, BalanceScenario>> =
  Object.fromEntries(BALANCE_SCENARIOS.map((scenario) => [scenario.id, scenario])) as Record<
    BalanceScenarioId,
    BalanceScenario
  >;

const MAX_LAUNCH_BREAKS = 3;

function resetPlayerForScenario(player: PlayerState): void {
  player.pos = { x: 0, y: 0 };
  player.vel = { x: 0, y: 0 };
  player.boostActive = false;
  player.boostDir = { x: 0, y: 0 };
  player.boostHeldTime = 0;
  player.fuel = player.maxFuel;
  player.launchBreaks = MAX_LAUNCH_BREAKS;
  player.stunned = 0;
  player.helpless = 0;
  player.parry = 0;
  player.endLag = 0;
  player.chain = 0;
  player.chainTimer = 0;
  player.superBoost = 0;
  player.superDir = { x: 0, y: 0 };
  player.superTime = 0;
  player.superDistance = 0;
  player.superTurnPenalty = 0;
  player.didCommitAttackDuringSuperBoost = false;
  player.lastLaunchedBy = null;
  player.recovering = 0;
  player.recoveryDuration = 0;
  player.recoveryDir = { x: 0, y: 0 };
  player.launchFlash = 0;
  player.parryFlash = 0;
  player.specialFlash = 0;
  player.breakFlash = 0;
  player.dunkFlash = 0;
  player.launchStartup = 0;
  player.launchActive = 0;
  player.launchDidConnect = false;
  player.dunkStartup = 0;
  player.dunkActive = 0;
  player.dunkDidConnect = false;
  player.specialStartup = 0;
  player.specialActive = 0;
  player.specialDidResolve = false;
  player.cool = {
    special: 0,
    launch: 0,
    dunk: 0,
    boost: 0,
  };
}

function resetMatchForScenario(state: GameState): void {
  state.rngState = state.seed;
  state.projectiles.length = 0;
  state.winner = null;
  state.gameTime = 0;
  state.nextProjectileId = 1;
  resetPlayerForScenario(state.players.P1);
  resetPlayerForScenario(state.players.P2);
}

function setFuelFraction(player: PlayerState, fraction: number): void {
  player.fuel = Math.max(0, Math.min(player.maxFuel, player.maxFuel * fraction));
}

function applyLongNeutral(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -44, y: 0 };
  P2.pos = { x: 44, y: 0 };
  P1.vel = { x: 0, y: 8 };
  P2.vel = { x: 0, y: -8 };
}

function applyClosePressure(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -5, y: 0 };
  P2.pos = { x: 5, y: 0 };
  P1.vel = { x: 16, y: 0 };
  P2.vel = { x: -16, y: 0 };
  setFuelFraction(P1, 0.75);
  setFuelFraction(P2, 0.75);
  P1.launchBreaks = 2;
  P2.launchBreaks = 2;
}

function applyPostClash(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -12, y: 0 };
  P2.pos = { x: 12, y: 0 };
  P1.vel = { x: -42, y: 0 };
  P2.vel = { x: 42, y: 0 };
  setFuelFraction(P1, 0.65);
  setFuelFraction(P2, 0.65);
  P1.launchBreaks = 2;
  P2.launchBreaks = 2;
  P1.endLag = 0.35;
  P2.endLag = 0.35;
  P1.cool.launch = 0.35;
  P2.cool.launch = 0.35;
  P1.launchFlash = 0.2;
  P2.launchFlash = 0.2;
}

function applyLaunchBreakDecision(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -14, y: -2 };
  P2.pos = { x: 18, y: 2 };
  P1.vel = { x: 38, y: 4 };
  P2.vel = { x: 92, y: 12 };
  setFuelFraction(P1, 0.6);
  setFuelFraction(P2, 0.35);
  P1.launchBreaks = 2;
  P2.launchBreaks = 1;
  P1.chain = 1;
  P1.chainTimer = 0.8;
  P1.endLag = 0.2;
  P1.cool.launch = 0.2;
  P1.launchFlash = 0.2;
  P2.launchFlash = 0.2;
  P2.helpless = 3.5;
  P2.lastLaunchedBy = 'P1';
}

function applyControlReturnPressure(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -4, y: 0 };
  P2.pos = { x: 4, y: 0 };
  P1.vel = { x: 10, y: 0 };
  P2.vel = { x: 4, y: 0 };
  setFuelFraction(P1, 0.6);
  setFuelFraction(P2, 0.45);
  P1.launchBreaks = 2;
  P2.launchBreaks = 1;
  P1.chain = 1;
  P1.chainTimer = 0.8;
  P1.launchStartup = 4 / 60;
  P2.helpless = 1 / 60;
  P2.lastLaunchedBy = 'P1';
}

function applyP1ControlReturnPressure(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -4, y: 0 };
  P2.pos = { x: 4, y: 0 };
  P1.vel = { x: -4, y: 0 };
  P2.vel = { x: -10, y: 0 };
  setFuelFraction(P1, 0.45);
  setFuelFraction(P2, 0.6);
  P1.launchBreaks = 1;
  P2.launchBreaks = 2;
  P2.chain = 1;
  P2.chainTimer = 0.8;
  P2.launchStartup = 4 / 60;
  P1.helpless = 1 / 60;
  P1.lastLaunchedBy = 'P2';
}

function applyZeroFuelChase(state: GameState): void {
  const { P1, P2 } = state.players;
  P1.pos = { x: -8, y: -4 };
  P2.pos = { x: 20, y: 4 };
  P1.vel = { x: 64, y: 10 };
  P2.vel = { x: 72, y: 12 };
  setFuelFraction(P1, 0.5);
  P2.fuel = 0;
  P1.launchBreaks = 1;
  P2.launchBreaks = 0;
  P1.chain = 1;
  P1.chainTimer = 0.8;
  P1.launchFlash = 0.2;
  P2.launchFlash = 0.2;
  P2.helpless = 4;
  P2.lastLaunchedBy = 'P1';
}

export function resolveBalanceScenario(id: unknown): BalanceScenario {
  if (typeof id !== 'string') {
    return BALANCE_SCENARIO_BY_ID[DEFAULT_BALANCE_SCENARIO_ID];
  }
  const normalisedId = id.trim() as BalanceScenarioId;
  if (Object.prototype.hasOwnProperty.call(BALANCE_SCENARIO_BY_ID, normalisedId)) {
    return BALANCE_SCENARIO_BY_ID[normalisedId];
  }
  return BALANCE_SCENARIO_BY_ID[DEFAULT_BALANCE_SCENARIO_ID];
}

export function applyBalanceScenario(state: GameState, id: unknown): GameState {
  const scenario = resolveBalanceScenario(id);
  if (scenario.id === 'standard') {
    return state;
  }

  resetMatchForScenario(state);
  switch (scenario.id) {
    case 'long_neutral':
      applyLongNeutral(state);
      break;
    case 'close_pressure':
      applyClosePressure(state);
      break;
    case 'post_clash':
      applyPostClash(state);
      break;
    case 'launch_break_decision':
      applyLaunchBreakDecision(state);
      break;
    case 'control_return_pressure':
      applyControlReturnPressure(state);
      break;
    case 'p1_control_return_pressure':
      applyP1ControlReturnPressure(state);
      break;
    case 'zero_fuel_chase':
      applyZeroFuelChase(state);
      break;
  }
  return state;
}
