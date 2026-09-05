import { CHARACTER_BY_ID, type CharacterId } from '../sim/characters';
import {
  fingerprintCharacterBalanceOverrides,
  resolveCharacterBalanceConfig,
  type CharacterBalanceOverrides,
} from '../sim/characterBalance';

export interface TrainingFrameDataModel {
  title: string;
  hint: string;
  rows: string[];
  fingerprint: string;
}

function describeCharacterMoveRows(characterId: CharacterId, playerLabel: 'P1' | 'P2', overrides?: CharacterBalanceOverrides): string[] {
  const character = CHARACTER_BY_ID[characterId];
  const { moves } = resolveCharacterBalanceConfig(characterId, overrides);
  return [
    `${playerLabel} ${character.displayName}`,
    `Launch: ${moves.launch.startupFrames}f startup, ${moves.launch.activeFrames}f active, ${moves.launch.recoveryOnHitFrames}f hit recover, ${moves.launch.recoveryOnWhiffFrames}f whiff recover`,
    `Dunk: ${moves.dunk.startupFrames}f startup, ${moves.dunk.activeFrames}f active, ${moves.dunk.recoveryOnHitFrames}f hit recover, ${moves.dunk.recoveryOnWhiffFrames}f whiff recover`,
    `Parry: ${moves.parry.startupFrames}f startup, ${moves.parry.activeFrames}f active, ${moves.parry.recoveryFrames}f recover`,
    `Break: ${moves.break.startupFrames}f startup, ${moves.break.activeFrames}f active, ${moves.break.recoveryFrames}f recover`,
    `Special: ${moves.special.timing.startupFrames}f startup, ${moves.special.timing.activeFrames}f active, ${moves.special.timing.recoveryFrames}f recover`,
  ];
}

export function buildTrainingFrameDataModel(
  p1CharacterId: CharacterId,
  p2CharacterId: CharacterId,
  activeOverrides?: CharacterBalanceOverrides,
): TrainingFrameDataModel {
  const fingerprint = fingerprintCharacterBalanceOverrides(activeOverrides);
  return {
    title: 'Training Frame Data',
    hint: `Toggle: F1 keyboard or View/Back controller | Active tuning: ${fingerprint}`,
    fingerprint,
    rows: [
      ...describeCharacterMoveRows(p1CharacterId, 'P1', activeOverrides),
      ...describeCharacterMoveRows(p2CharacterId, 'P2', activeOverrides),
    ],
  };
}
