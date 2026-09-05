import type { BalanceLabRuleChange } from './balanceLab';
import { applyBalanceScenario } from './balanceScenarios';
import { createInitialState, nextDeterministicRandom, step } from './sim';
import type { PlayerFrameInput, PlayerId } from './types';
import {
  findFirstChecksumMismatch,
  runReplay,
  validateReplayPayload,
  type ReplayPayload,
  type ReplayReviewFocus,
} from './replay';

export const BALANCE_REPLAY_COMPARISON_SCHEMA_VERSION = 'gw.balance-replay-comparison.v1';

export type BalanceReplayVariant = 'baseline' | 'candidate';

export interface BalanceReplaySample {
  payload: ReplayPayload;
  focus: ReplayReviewFocus;
}

export interface BalanceReplayComparison {
  schemaVersion: typeof BALANCE_REPLAY_COMPARISON_SCHEMA_VERSION;
  baseline: BalanceReplaySample;
  candidate: BalanceReplaySample | null;
  ruleChanges: BalanceLabRuleChange[];
}

export interface SelectedBalanceReplaySample extends BalanceReplaySample {
  variant: BalanceReplayVariant;
  frameIndex: number;
}

export interface BalanceReplayComparisonDescription {
  mode: 'baseline_only' | 'repeatability' | 'single_change';
  label: string;
}

export interface BalanceReplayOutcome {
  winner: PlayerId | null;
  finishFrame: number | null;
  finishSeconds: number | null;
}

const replayOutcomes = new WeakMap<ReplayPayload, BalanceReplayOutcome>();

function outcomePlayerInput(input?: Partial<PlayerFrameInput> & { shot?: boolean }): PlayerFrameInput {
  return {
    moveX: Number.isFinite(input?.moveX) ? Number(input.moveX) : 0,
    moveY: Number.isFinite(input?.moveY) ? Number(input.moveY) : 0,
    boost: Boolean(input?.boost),
    superBoost: Boolean(input?.superBoost),
    special: Boolean(input?.special || input?.shot),
    launch: Boolean(input?.launch),
    dunk: Boolean(input?.dunk),
    parry: Boolean(input?.parry),
    breakLaunch: Boolean(input?.breakLaunch),
  };
}

export function getBalanceReplayOutcome(payload: ReplayPayload): BalanceReplayOutcome {
  const cached = replayOutcomes.get(payload);
  if (cached) return cached;
  const header = payload.header;
  const fixedDt = Number.isFinite(header.fixedDt) && header.fixedDt! > 0 ? header.fixedDt! : 1 / 60;
  // Mirror replay initialization without pulling the full review/telemetry UI into the bundle.
  const finalRound = header.onlineMatch ? payload.rounds?.at(-1) : undefined;
  const state = createInitialState({
    seed: finalRound?.seed ?? header.seed,
    loadout: header.loadout,
    rules: header.rules,
    characterBalanceOverrides: header.characterBalanceOverrides,
  });
  if (header.balanceTuning) state.tuning = { ...header.balanceTuning };
  if (header.startingSituation) applyBalanceScenario(state, header.startingSituation.id);
  let finishFrame: number | null = null;
  const endFrame = finalRound?.endFrame ?? payload.inputTimeline.length - 1;
  for (let frame = finalRound?.startFrame ?? 0; frame <= endFrame; frame += 1) {
    const input = payload.inputTimeline[frame];
    step(state, { p1: outcomePlayerInput(input?.p1), p2: outcomePlayerInput(input?.p2) }, fixedDt);
    if (header.advanceRngPerFrame) nextDeterministicRandom(state);
    if (state.winner !== null) {
      finishFrame = frame;
      break;
    }
  }
  const outcome: BalanceReplayOutcome = {
    winner: state.winner,
    finishFrame,
    finishSeconds: finishFrame === null ? null : (finishFrame + 1) * fixedDt,
  };
  replayOutcomes.set(payload, outcome);
  return outcome;
}

export function describeBalanceReplayTiming(comparison: BalanceReplayComparison): string {
  const baseline = comparison.baseline.payload;
  const candidate = comparison.candidate?.payload;
  if (!candidate) return 'Baseline captured; candidate not yet available.';
  const sharedFrames = Math.min(baseline.inputTimeline.length, candidate.inputTimeline.length);
  const a = getBalanceReplayOutcome(baseline);
  const b = getBalanceReplayOutcome(candidate);
  const outcomeLabel = (outcome: BalanceReplayOutcome): string => outcome.winner
    ? `${outcome.winner} won at F${outcome.finishFrame} (${outcome.finishSeconds!.toFixed(2)}s)`
    : 'unfinished at capture';
  const delta = a.finishSeconds !== null && b.finishSeconds !== null
    ? ` Finish delta (candidate - baseline): ${(b.finishSeconds - a.finishSeconds).toFixed(2)}s.`
    : ' Finish delta unavailable until both runs finish.';
  return `Common interval: F0-F${sharedFrames - 1} (${sharedFrames} frames). Baseline: ${outcomeLabel(a)}. Candidate: ${outcomeLabel(b)}.${delta}`;
}

function cloneVerifiedReplay(payloadRaw: unknown, label: string): ReplayPayload {
  const validation = validateReplayPayload(payloadRaw);
  if (validation.ok === false) {
    throw new Error(`${label} replay is invalid: ${validation.error.message}`);
  }
  const payload = validation.payload;
  if (payload.inputTimeline.length === 0) {
    throw new Error(`${label} replay must contain at least one input frame.`);
  }
  if (!payload.expectedChecksums || payload.expectedChecksums.length !== payload.inputTimeline.length) {
    throw new Error(`${label} replay must contain one deterministic checksum per input frame.`);
  }
  const mismatch = findFirstChecksumMismatch(
    runReplay(payload).checksums,
    payload.expectedChecksums,
  );
  if (mismatch) {
    throw new Error(`${label} replay checksum mismatch at frame ${mismatch.frame}.`);
  }
  return payload;
}

function normaliseFocus(
  focus: ReplayReviewFocus | undefined,
  totalFrames: number,
  fallbackLabel: string,
): ReplayReviewFocus {
  const finalFrame = Math.max(0, totalFrames - 1);
  const focusFrame = Math.max(0, Math.min(finalFrame, Math.floor(focus?.focusFrame ?? 0)));
  const requestedEnd = focus?.endFrame ?? focusFrame;
  const endFrame = Math.max(
    focusFrame,
    Math.min(finalFrame, Math.floor(Number.isFinite(requestedEnd) ? requestedEnd : focusFrame)),
  );
  return {
    schemaVersion: 'gw.replay-focus.v1',
    source: focus?.source?.trim() || 'balance_lab_incident',
    label: focus?.label?.trim() || fallbackLabel,
    focusFrame,
    endFrame,
  };
}

function stableIdentity(payload: ReplayPayload): string {
  const localAi = payload.header.localAi;
  return JSON.stringify({
    payloadVersion: payload.header.payloadVersion,
    // Local Balance Lab drafts append +custom_local to the same base ruleset.
    rulesetVersion: payload.header.rulesetVersion.split('+', 1)[0],
    simBuildHash: payload.header.simBuildHash,
    seed: payload.header.seed ?? null,
    loadout: payload.header.loadout ?? null,
    fixedDt: payload.header.fixedDt ?? null,
    advanceRngPerFrame: payload.header.advanceRngPerFrame ?? false,
    startingSituation: payload.header.startingSituation ?? null,
    localAi: localAi
      ? {
          schemaVersion: localAi.schemaVersion,
          profileId: localAi.profileId,
          matchSeed: localAi.matchSeed,
          roundSeed: localAi.roundSeed,
          roundIndex: localAi.roundIndex,
          controllerSeeds: localAi.controllerSeeds,
          controllerRoles: localAi.controllerRoles,
          recoveryPolicyId: localAi.recoveryPolicyId,
          clashPolicyId: localAi.clashPolicyId,
          pursuitPolicyId: localAi.pursuitPolicyId,
        }
      : null,
    rounds: payload.rounds?.map((round) => ({
      round: round.round ?? null,
      epoch: round.epoch ?? null,
      seed: round.seed ?? null,
      startFrame: round.startFrame,
      // The final boundary is an outcome, not part of the controlled setup.
      endFrame: round === payload.rounds?.at(-1) ? null : round.endFrame ?? null,
    })) ?? null,
  });
}

function cloneRuleChanges(ruleChanges: readonly BalanceLabRuleChange[]): BalanceLabRuleChange[] {
  return ruleChanges.map((change) => ({ ...change }));
}

function formatRuleName(path: string): string {
  const leaf = path.split('.').at(-1) ?? path;
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.length > 0
    ? words.charAt(0).toUpperCase() + words.slice(1)
    : 'Rule';
}

function formatRuleValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export function describeBalanceReplayComparison(
  comparison: Pick<BalanceReplayComparison, 'candidate' | 'ruleChanges'>,
): BalanceReplayComparisonDescription {
  if (!comparison.candidate) {
    return {
      mode: 'baseline_only',
      label: 'Baseline captured; run the matched candidate to unlock A/B review.',
    };
  }
  const change = comparison.ruleChanges[0];
  if (!change) {
    return {
      mode: 'repeatability',
      label: 'Repeatability control: no effective rule change.',
    };
  }
  const scope = change.scope === 'character' && change.characterId
    ? `${change.characterId.charAt(0).toUpperCase()}${change.characterId.slice(1)} `
    : '';
  return {
    mode: 'single_change',
    label: `${scope}${formatRuleName(change.path)}: ${formatRuleValue(change.baselineValue)} -> ${formatRuleValue(change.candidateValue)}`,
  };
}

export function createBalanceReplayComparison(
  baselineRaw: unknown,
  focusOverride?: ReplayReviewFocus,
): BalanceReplayComparison {
  const baseline = cloneVerifiedReplay(baselineRaw, 'Baseline');
  return {
    schemaVersion: BALANCE_REPLAY_COMPARISON_SCHEMA_VERSION,
    baseline: {
      payload: baseline,
      focus: normaliseFocus(
        focusOverride ?? baseline.header.reviewFocus,
        baseline.inputTimeline.length,
        'Captured baseline sample',
      ),
    },
    candidate: null,
    ruleChanges: [],
  };
}

export function attachBalanceReplayCandidate(
  comparison: BalanceReplayComparison,
  candidateRaw: unknown,
  ruleChanges: readonly BalanceLabRuleChange[],
): BalanceReplayComparison {
  if (ruleChanges.length > 1) {
    throw new Error('Incident comparisons require zero changes for repeatability or exactly one effective rule change.');
  }
  const candidate = cloneVerifiedReplay(candidateRaw, 'Candidate');
  if (stableIdentity(candidate) !== stableIdentity(comparison.baseline.payload)) {
    throw new Error('Candidate replay must preserve the baseline base ruleset, build, seed, loadout, scenario, and round identity.');
  }
  const baselineFrames = comparison.baseline.payload.inputTimeline.length;
  const candidateFrames = candidate.inputTimeline.length;
  if (candidateFrames !== baselineFrames) {
    const shorter = candidateFrames < baselineFrames ? candidate : comparison.baseline.payload;
    if (getBalanceReplayOutcome(shorter).winner === null) {
      throw new Error('Unequal matched-sample frame counts require the shorter replay to reach a terminal outcome.');
    }
  }
  return {
    schemaVersion: BALANCE_REPLAY_COMPARISON_SCHEMA_VERSION,
    baseline: {
      payload: cloneVerifiedReplay(comparison.baseline.payload, 'Baseline'),
      focus: { ...comparison.baseline.focus },
    },
    candidate: {
      payload: candidate,
      focus: normaliseFocus(
        comparison.baseline.focus,
        candidate.inputTimeline.length,
        comparison.baseline.focus.label,
      ),
    },
    ruleChanges: cloneRuleChanges(ruleChanges),
  };
}

export function selectBalanceReplaySample(
  comparison: BalanceReplayComparison,
  variant: BalanceReplayVariant,
  requestedFrame = comparison.baseline.focus.focusFrame,
): SelectedBalanceReplaySample {
  const sample = variant === 'baseline' ? comparison.baseline : comparison.candidate;
  if (!sample) {
    throw new Error('Candidate replay is not available yet.');
  }
  const finalFrame = Math.max(0, sample.payload.inputTimeline.length - 1);
  return {
    variant,
    payload: sample.payload,
    focus: { ...sample.focus },
    frameIndex: Math.max(0, Math.min(finalFrame, Math.floor(requestedFrame))),
  };
}
