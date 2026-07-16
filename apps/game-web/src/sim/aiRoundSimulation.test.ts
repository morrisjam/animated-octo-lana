import { describe, expect, test } from 'vitest';
import { createAiController, createDefaultAiBehaviorTuning, tickAiController } from './ai';
import { deriveStableAiSeed, deriveStableSetSeed } from './aiBalanceGate';
import { sanitiseCharacterBalanceOverrides } from './characterBalance';
import { createDefaultTuning } from './tuning';
import { findFirstChecksumMismatch, runReplay, validateReplayPayload } from './replay';
import { createAiRoundReplay, simulateAiRound } from './aiRoundSimulation';
import { createInitialState, createStateSnapshot, step, type SimulationActionStart } from './sim';
import type {
  FrameInput,
  GameState,
  PlayerFrameInput,
  PlayerId,
  PlayerState,
} from './types';

const BASE_OPTIONS = {
  p1: 'vanguard',
  p2: 'duelist',
  difficulty: 'veteran' as const,
  setSeed: 0x1234abcd,
  roundIndex: 1,
  maxFrames: 240,
};

function mirrorPlayerInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    ...input,
    moveX: -input.moveX,
    moveY: -input.moveY,
  };
}

function mirrorFrameInput(input: FrameInput): FrameInput {
  return {
    p1: mirrorPlayerInput(input.p2),
    p2: mirrorPlayerInput(input.p1),
  };
}

function swapWinner(winner: PlayerId | null): PlayerId | null {
  if (winner === null) {
    return null;
  }
  return winner === 'P1' ? 'P2' : 'P1';
}

function playerInputsApproximatelyEqual(first: PlayerFrameInput, second: PlayerFrameInput): boolean {
  return Math.abs(first.moveX - second.moveX) <= 1e-9
    && Math.abs(first.moveY - second.moveY) <= 1e-9
    && first.boost === second.boost
    && first.superBoost === second.superBoost
    && first.special === second.special
    && first.launch === second.launch
    && first.dunk === second.dunk
    && first.parry === second.parry
    && first.breakLaunch === second.breakLaunch;
}

function frameInputsApproximatelyEqual(first: FrameInput, second: FrameInput | undefined): boolean {
  return second !== undefined
    && playerInputsApproximatelyEqual(first.p1, second.p1)
    && playerInputsApproximatelyEqual(first.p2, second.p2);
}

function mirrorPlayerId(playerId: PlayerId | null): PlayerId | null {
  return playerId === null ? null : swapWinner(playerId);
}

function mirrorPlayerState(player: PlayerState, playerId: PlayerId): PlayerState {
  return {
    ...player,
    id: playerId,
    pos: { x: -player.pos.x, y: -player.pos.y },
    vel: { x: -player.vel.x, y: -player.vel.y },
    boostDir: { x: -player.boostDir.x, y: -player.boostDir.y },
    superDir: { x: -player.superDir.x, y: -player.superDir.y },
    lastLaunchedBy: mirrorPlayerId(player.lastLaunchedBy),
    recoveryDir: { x: -player.recoveryDir.x, y: -player.recoveryDir.y },
    cool: { ...player.cool },
  };
}

function mirrorGameState(state: GameState): GameState {
  const source = createStateSnapshot(state);
  return {
    ...source,
    loadout: { P1: source.loadout.P2, P2: source.loadout.P1 },
    players: {
      P1: mirrorPlayerState(source.players.P2, 'P1'),
      P2: mirrorPlayerState(source.players.P1, 'P2'),
    },
    projectiles: source.projectiles.map((projectile) => ({
      ...projectile,
      ownerId: mirrorPlayerId(projectile.ownerId) as PlayerId,
      pos: { x: -projectile.pos.x, y: -projectile.pos.y },
      vel: { x: -projectile.vel.x, y: -projectile.vel.y },
    })),
    winner: mirrorPlayerId(source.winner),
  };
}

function findFirstStateDifference(
  first: unknown,
  second: unknown,
  path = 'state',
): string | null {
  if (typeof first === 'number' && typeof second === 'number') {
    return Math.abs(first - second) <= 1e-12
      ? null
      : `${path}: ${first} !== ${second}`;
  }
  if (first === second) {
    return null;
  }
  if (Array.isArray(first) && Array.isArray(second)) {
    if (first.length !== second.length) {
      return `${path}.length: ${first.length} !== ${second.length}`;
    }
    for (let index = 0; index < first.length; index += 1) {
      const difference = findFirstStateDifference(first[index], second[index], `${path}[${index}]`);
      if (difference) {
        return difference;
      }
    }
    return null;
  }
  if (first && second && typeof first === 'object' && typeof second === 'object') {
    const firstRecord = first as Record<string, unknown>;
    const secondRecord = second as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(firstRecord), ...Object.keys(secondRecord)])].sort();
    for (const key of keys) {
      const difference = findFirstStateDifference(
        firstRecord[key],
        secondRecord[key],
        `${path}.${key}`,
      );
      if (difference) {
        return difference;
      }
    }
    return null;
  }
  return `${path}: ${String(first)} !== ${String(second)}`;
}

describe('AI round simulation', () => {
  test('repeats the same round deterministically', () => {
    const first = simulateAiRound(BASE_OPTIONS);
    const second = simulateAiRound(BASE_OPTIONS);

    expect(second.winner).toBe(first.winner);
    expect(second.framesSimulated).toBe(first.framesSimulated);
    expect(second.telemetry).toEqual(first.telemetry);
  });

  test('applies custom behavior tuning deterministically without changing the default path', () => {
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      engagementDistanceScale: 2,
      neutralHoldFrames: 30,
    };
    const options = {
      ...BASE_OPTIONS,
      maxFrames: 600,
      captureReplay: true,
      behaviorTuning,
    };

    const first = simulateAiRound(options);
    const second = simulateAiRound(options);
    const defaultRound = simulateAiRound({
      ...BASE_OPTIONS,
      maxFrames: 600,
      captureReplay: true,
    });

    expect(second.inputTimeline).toEqual(first.inputTimeline);
    expect(second.telemetry).toEqual(first.telemetry);
    expect(first.inputTimeline).not.toEqual(defaultRound.inputTimeline);
  });

  test('runs complementary commitment roles deterministically when explicitly enabled', () => {
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      errorRateScale: 0,
      commitmentObserveFrames: 20,
      commitmentPressFrames: 30,
      commitmentResetFrames: 12,
    };
    const options = {
      ...BASE_OPTIONS,
      maxFrames: 900,
      captureReplay: true,
      behaviorTuning,
    };

    const first = simulateAiRound(options);
    const second = simulateAiRound(options);
    const movementIntents = new Set(
      first.aiDecisionTrace?.events.map((event) => event.decision.movementIntent) ?? [],
    );

    expect(second.inputTimeline).toEqual(first.inputTimeline);
    expect(second.telemetry).toEqual(first.telemetry);
    expect(second.aiDecisionTrace).toEqual(first.aiDecisionTrace);
    expect(movementIntents).toContain('commitment_press');
    expect(movementIntents).toContain('commitment_observe');
  });

  test.each([
    ['default', createDefaultAiBehaviorTuning()],
    ['post-control defense candidate', {
      ...createDefaultAiBehaviorTuning(),
      postRecoveryDefenseFrames: 12,
      postRecoveryDefensiveSpecialChance: 0.5,
      postRecoveryThreatParryChance: 1,
    }],
  ] as const)('keeps character AI streams mirrored across seats for %s tuning', (_, behaviorTuning) => {
    const direct = simulateAiRound({
      ...BASE_OPTIONS,
      roundIndex: 0,
      maxFrames: 3_600,
      captureReplay: true,
      behaviorTuning,
    });
    const reversed = simulateAiRound({
      ...BASE_OPTIONS,
      p1: BASE_OPTIONS.p2,
      p2: BASE_OPTIONS.p1,
      roundIndex: 0,
      maxFrames: 3_600,
      captureReplay: true,
      behaviorTuning,
    });
    const expectedReversedTimeline = direct.inputTimeline?.map(mirrorFrameInput) ?? [];
    const firstInputDivergence = reversed.inputTimeline?.findIndex((input, frame) => (
      !frameInputsApproximatelyEqual(input, expectedReversedTimeline[frame])
    )) ?? -1;

    if (firstInputDivergence >= 0) {
      expect(
        reversed.inputTimeline?.[firstInputDivergence],
        `first mirrored AI input divergence at frame ${firstInputDivergence}`,
      ).toEqual(expectedReversedTimeline[firstInputDivergence]);
    }
    expect(reversed.framesSimulated).toBe(direct.framesSimulated);
    expect(reversed.winner).toBe(swapWinner(direct.winner));
  });

  test('keeps the full AI-driven simulation state mirrored through combat', () => {
    const setSeed = 44_521_056;
    const roundIndex = 4;
    const direct = createInitialState({
      seed: setSeed,
      loadout: { P1: BASE_OPTIONS.p1, P2: BASE_OPTIONS.p2 },
    });
    const reversed = mirrorGameState(direct);
    let directP1 = createAiController({
      seed: deriveStableAiSeed(setSeed, BASE_OPTIONS.difficulty, BASE_OPTIONS.p1, roundIndex),
      profileId: BASE_OPTIONS.difficulty,
    });
    let directP2 = createAiController({
      seed: deriveStableAiSeed(setSeed, BASE_OPTIONS.difficulty, BASE_OPTIONS.p2, roundIndex),
      profileId: BASE_OPTIONS.difficulty,
    });
    let reversedP1 = createAiController({
      seed: deriveStableAiSeed(setSeed, BASE_OPTIONS.difficulty, BASE_OPTIONS.p2, roundIndex),
      profileId: BASE_OPTIONS.difficulty,
    });
    let reversedP2 = createAiController({
      seed: deriveStableAiSeed(setSeed, BASE_OPTIONS.difficulty, BASE_OPTIONS.p1, roundIndex),
      profileId: BASE_OPTIONS.difficulty,
    });
    const recentActions: string[] = [];

    for (let frame = 0; frame < 4_200; frame += 1) {
      const directP1Tick = tickAiController(direct, 'P1', directP1);
      const directP2Tick = tickAiController(direct, 'P2', directP2);
      const reversedP1Tick = tickAiController(reversed, 'P1', reversedP1);
      const reversedP2Tick = tickAiController(reversed, 'P2', reversedP2);
      directP1 = directP1Tick.next;
      directP2 = directP2Tick.next;
      reversedP1 = reversedP1Tick.next;
      reversedP2 = reversedP2Tick.next;
      const directInput = { p1: directP1Tick.input, p2: directP2Tick.input };
      const reversedInput = { p1: reversedP1Tick.input, p2: reversedP2Tick.input };
      const accepted: SimulationActionStart[] = [];
      step(direct, directInput, 1 / 60, {
        onActionStart: (event) => accepted.push(event),
      });
      step(reversed, reversedInput, 1 / 60);
      recentActions.push(...accepted.map((event) => `${frame}:${event.playerId}:${event.action}`));
      recentActions.splice(0, Math.max(0, recentActions.length - 12));

      const difference = findFirstStateDifference(direct, mirrorGameState(reversed));
      expect(
        difference,
        `first mirrored state divergence at frame ${frame}; recent actions: ${recentActions.join(', ')}`,
      ).toBeNull();
    }
  });

  test('keeps all batch scenario seeds mirrored across seats', () => {
    for (let gameIndex = 0; gameIndex < 12; gameIndex += 1) {
      const setSeed = deriveStableSetSeed(
        0x10293847,
        BASE_OPTIONS.difficulty,
        BASE_OPTIONS.p1,
        BASE_OPTIONS.p2,
        gameIndex,
      );
      for (let roundIndex = 0; roundIndex < 5; roundIndex += 1) {
        const direct = simulateAiRound({
          ...BASE_OPTIONS,
          setSeed,
          roundIndex,
          maxFrames: 5_400,
        });
        const reversed = simulateAiRound({
          ...BASE_OPTIONS,
          p1: BASE_OPTIONS.p2,
          p2: BASE_OPTIONS.p1,
          setSeed,
          roundIndex,
          maxFrames: 5_400,
        });

        expect(
          reversed.framesSimulated,
          `frame count diverged for game ${gameIndex + 1}, round ${roundIndex + 1}, seed ${setSeed}`,
        ).toBe(direct.framesSimulated);
        expect(
          reversed.winner,
          `winner diverged for game ${gameIndex + 1}, round ${roundIndex + 1}, seed ${setSeed}`,
        ).toBe(swapWinner(direct.winner));
      }
    }
  }, 15_000);

  test('exports an exact checksum-verified replay with local balance context', () => {
    const tuning = {
      ...createDefaultTuning(),
      closeRangeSeparationImpulse: 31,
    };
    const behaviorTuning = {
      ...createDefaultAiBehaviorTuning(),
      engagementDistanceScale: 1.17,
    };
    const characterBalanceOverrides = sanitiseCharacterBalanceOverrides({
      vanguard: {
        stats: { fuelCapacityMultiplier: 1.23 },
      },
    });
    const result = createAiRoundReplay({
      ...BASE_OPTIONS,
      tuning,
      behaviorTuning,
      characterBalanceOverrides,
      recoveryPolicyId: 'evasive',
      clashPolicyId: 'spacing',
      pursuitPolicyId: 'neutral_hold',
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'test-ai-round',
      reviewFocus: {
        source: 'unit-test',
        label: 'Pressure loop',
        focusFrame: 90,
        endFrame: 130,
      },
    });
    const validation = validateReplayPayload(result.payload);

    expect(validation.ok).toBe(true);
    if (validation.ok === false) {
      throw new Error(validation.error.message);
    }
    expect(validation.payload.header.balanceTuning?.closeRangeSeparationImpulse).toBe(31);
    expect(validation.payload.header.characterBalanceOverrides?.vanguard?.stats.fuelCapacityMultiplier).toBe(1.23);
    expect(validation.payload.header.localAi).toEqual({
      schemaVersion: 'gw.local-ai-replay.v1',
      profileId: BASE_OPTIONS.difficulty,
      matchSeed: BASE_OPTIONS.setSeed >>> 0,
      roundSeed: result.simulation.roundSeed,
      roundIndex: BASE_OPTIONS.roundIndex,
      controllerSeeds: {
        P1: deriveStableAiSeed(
          BASE_OPTIONS.setSeed,
          BASE_OPTIONS.difficulty,
          BASE_OPTIONS.p1,
          BASE_OPTIONS.roundIndex,
        ),
        P2: deriveStableAiSeed(
          BASE_OPTIONS.setSeed,
          BASE_OPTIONS.difficulty,
          BASE_OPTIONS.p2,
          BASE_OPTIONS.roundIndex,
        ),
      },
      controllerRoles: { P1: 'adaptive', P2: 'adaptive' },
      behaviorTuning,
      recoveryPolicyId: 'evasive',
      clashPolicyId: 'spacing',
      pursuitPolicyId: 'neutral_hold',
    });
    expect(validation.payload.header.reviewFocus).toEqual({
      schemaVersion: 'gw.replay-focus.v1',
      source: 'unit-test',
      label: 'Pressure loop',
      focusFrame: 90,
      endFrame: 130,
    });

    const replayResult = runReplay(validation.payload);
    expect(findFirstChecksumMismatch(
      replayResult.checksums,
      validation.payload.expectedChecksums ?? [],
    )).toBeNull();
  });

  test('captures deterministic batch decision traces on the emitted input frame', () => {
    const options = {
      ...BASE_OPTIONS,
      maxFrames: 900,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'test-ai-provenance',
      reviewFocus: {
        source: 'unit-test',
        label: 'Batch provenance',
        focusFrame: 0,
      },
    };
    const first = createAiRoundReplay(options);
    const second = createAiRoundReplay(options);

    expect(first.payload.aiDecisionTrace?.events.length).toBeGreaterThan(0);
    expect(second.payload.aiDecisionTrace).toEqual(first.payload.aiDecisionTrace);
    expect(second.simulation.expectedChecksums).toEqual(first.simulation.expectedChecksums);

    const actionEvent = first.payload.aiDecisionTrace?.events.find(
      (event) => event.decision.selectedAction !== null,
    );
    expect(actionEvent).toBeDefined();
    if (!actionEvent?.decision.selectedAction) {
      throw new Error('Expected a selected AI action in the batch trace');
    }
    const frameInput = first.payload.inputTimeline[actionEvent.frame];
    const playerInput = actionEvent.playerId === 'P1' ? frameInput.p1 : frameInput.p2;
    const inputKey = actionEvent.decision.selectedAction === 'launch_break'
      ? 'breakLaunch'
      : actionEvent.decision.selectedAction;
    expect(playerInput?.[inputKey]).toBe(true);

    const validation = validateReplayPayload(first.payload);
    expect(validation.ok).toBe(true);
    if (validation.ok === false) {
      throw new Error(validation.error.message);
    }
    expect(findFirstChecksumMismatch(
      runReplay(validation.payload).checksums,
      validation.payload.expectedChecksums ?? [],
    )).toBeNull();
  });
});
