import {
  createDefaultAiBehaviorTuning,
  sanitiseAiBehaviorTuning,
  type AiBehaviorTuning,
} from './ai';
import {
  createDefaultAiControllerRoles,
  sanitiseAiControllerRoles,
  type AiControllerRoles,
} from './aiControllerRoles';
import {
  cloneCharacterBalanceOverrides,
  type CharacterBalanceOverrides,
} from './characterBalance';
import { fingerprintGameTuning, sanitiseTuning } from './tuning';
import type { GameTuning } from './types';

export type BalanceLabSampleStopReason = 'target_reached' | 'round_finished_early';

export interface BalanceLabSampleStopDecision {
  shouldStop: boolean;
  reason: BalanceLabSampleStopReason | null;
  completedFrames: number;
  targetFrames: number;
  progressRatio: number;
}

export function isLocalBalanceLabMode(mode: string): boolean {
  return mode === 'training' || mode === 'cpu_vs_cpu' || mode === 'balance_sparring';
}

export function isLocalAiTuningMode(mode: string): boolean {
  return mode === 'cpu_vs_cpu' || mode === 'balance_sparring';
}

export function evaluateBalanceLabSampleStop(
  targetFrames: number | null,
  completedFrames: number,
  roundFinished: boolean,
): BalanceLabSampleStopDecision {
  const safeCompletedFrames = Math.max(0, Math.floor(completedFrames));
  const safeTargetFrames = targetFrames === null || !Number.isFinite(targetFrames)
    ? 0
    : Math.max(0, Math.floor(targetFrames));
  if (safeTargetFrames <= 0) {
    return {
      shouldStop: false,
      reason: null,
      completedFrames: safeCompletedFrames,
      targetFrames: 0,
      progressRatio: 0,
    };
  }
  const targetReached = safeCompletedFrames >= safeTargetFrames;
  return {
    shouldStop: targetReached || roundFinished,
    reason: targetReached
      ? 'target_reached'
      : roundFinished
        ? 'round_finished_early'
        : null,
    completedFrames: safeCompletedFrames,
    targetFrames: safeTargetFrames,
    progressRatio: Math.round(Math.min(1, safeCompletedFrames / safeTargetFrames) * 1_000) / 1_000,
  };
}

export function fingerprintBalanceTuning(tuning: GameTuning): string {
  return fingerprintGameTuning(tuning);
}

export function selectLocalCharacterBalanceOverrides(
  mode: string,
  onlineMatchActive: boolean,
  overrides: CharacterBalanceOverrides | undefined,
): CharacterBalanceOverrides {
  if (onlineMatchActive || !isLocalBalanceLabMode(mode)) {
    return {};
  }
  return cloneCharacterBalanceOverrides(overrides);
}

export function selectLocalBalanceTuning(
  mode: string,
  onlineMatchActive: boolean,
  configuredTuning: GameTuning,
  localDraft: GameTuning,
): GameTuning {
  const selected = !onlineMatchActive && isLocalBalanceLabMode(mode)
    ? localDraft
    : configuredTuning;
  return sanitiseTuning(selected);
}

export function selectLocalAiBehaviorTuning(
  mode: string,
  onlineMatchActive: boolean,
  localDraft: AiBehaviorTuning,
): AiBehaviorTuning {
  return !onlineMatchActive && isLocalAiTuningMode(mode)
    ? sanitiseAiBehaviorTuning(localDraft)
    : createDefaultAiBehaviorTuning();
}

export function selectLocalAiControllerRoles(
  mode: string,
  onlineMatchActive: boolean,
  localDraft: AiControllerRoles,
): AiControllerRoles {
  if (onlineMatchActive || !isLocalAiTuningMode(mode)) {
    return createDefaultAiControllerRoles();
  }
  const roles = sanitiseAiControllerRoles(localDraft);
  return mode === 'balance_sparring'
    ? { ...roles, P1: 'adaptive' }
    : roles;
}
