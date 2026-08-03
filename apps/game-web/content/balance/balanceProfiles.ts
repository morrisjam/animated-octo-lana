import type { GameTuning } from '../../src/sim/types';

export interface BalanceProfileDefinition {
  id: string;
  label: string;
  description: string;
  tuning: Partial<GameTuning>;
}

export const BALANCE_PROFILE_DEFINITIONS: BalanceProfileDefinition[] = [
  {
    id: 'mobility_focus_v1',
    label: 'Mobility Focus V1',
    description: 'Faster movement and boost flow for mobility-heavy prototyping.',
    tuning: {
      playerMoveAccel: 58,
      boostHoldSpeed: 40,
      superBoostHoldSpeed: 52,
      superBoostSteerLerp: 0.26,
      chainWindowSeconds: 1.7,
      launchInputInfluence: 0.3,
    },
  },
  {
    id: 'control_focus_v1',
    label: 'Control Focus V1',
    description: 'Longer control windows and slightly slower traversal for neutral testing.',
    tuning: {
      playerMoveAccel: 42,
      boostHoldSpeed: 32,
      superBoostHoldSpeed: 44,
      chainWindowSeconds: 2.1,
      launchHelplessSeconds: 1.5,
      launchBasePower: 68,
      superBoostFuelMultiplier: 1.2,
    },
  },
  {
    id: 'well_hazard_v1',
    label: 'Well Hazard V1',
    description: 'Experimental: the well swallows helpless fighters, its corona drains fuel, and empty tanks launch further.',
    tuning: {
      wellCoreRadius: 12,
      wellCoronaRadius: 34,
      wellCoronaDrainPerSecond: 6,
      wellHelplessPull: 30,
      launchMissingFuelPowerScale: 0.5,
    },
  },
];
