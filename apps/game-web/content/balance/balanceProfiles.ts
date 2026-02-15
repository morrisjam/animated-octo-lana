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
];
