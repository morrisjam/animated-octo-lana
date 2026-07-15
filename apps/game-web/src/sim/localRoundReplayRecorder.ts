import type { CharacterId } from './characters';
import type { AiDecisionTrace } from './ai';
import { createAiDecisionTelemetryTracker } from './aiDecisionTelemetry';
import {
  BALANCE_SCENARIO_SCHEMA_VERSION,
  type BalanceScenarioId,
} from './balanceScenarios';
import { cloneCharacterBalanceOverrides, type CharacterBalanceOverrides } from './characterBalance';
import { computeStateChecksum } from './checksum';
import {
  cloneReplayLocalAiProvenance,
  createReplayAiDecisionTrace,
  REPLAY_PAYLOAD_VERSION,
  type ReplayLocalAiProvenance,
  type ReplayPayload,
} from './replay';
import type { FrameInput, GameRules, GameState, GameTuning, PlayerId, PlayersById } from './types';

export interface LocalRoundReplayRecorderOptions {
  rulesetVersion: string;
  simBuildHash: string;
  roundNumber: number;
  seed: number;
  loadout: PlayersById<CharacterId>;
  fixedDt: number;
  rules: GameRules;
  tuning: GameTuning;
  characterBalanceOverrides: CharacterBalanceOverrides;
  startingSituationId?: BalanceScenarioId;
  sourceLabel: string;
  localAiProvenance?: ReplayLocalAiProvenance;
}

function cloneFrameInput(input: FrameInput): FrameInput {
  return {
    p1: { ...input.p1 },
    p2: { ...input.p2 },
  };
}

export class LocalRoundReplayRecorder {
  private readonly inputTimeline: FrameInput[] = [];
  private readonly expectedChecksums: number[] = [];
  private readonly aiDecisionTelemetry = createAiDecisionTelemetryTracker({
    maxEvents: Number.MAX_SAFE_INTEGER,
  });
  private readonly localAiProvenance: ReplayLocalAiProvenance | undefined;

  public constructor(private readonly options: LocalRoundReplayRecorderOptions) {
    this.localAiProvenance = options.localAiProvenance
      ? cloneReplayLocalAiProvenance(options.localAiProvenance)
      : undefined;
  }

  public get frameCount(): number {
    return this.inputTimeline.length;
  }

  public recordFrame(
    input: FrameInput,
    state: GameState,
    aiDecisions: Partial<Record<PlayerId, AiDecisionTrace>> = {},
  ): void {
    this.aiDecisionTelemetry.recordFrame(this.inputTimeline.length, aiDecisions);
    this.inputTimeline.push(cloneFrameInput(input));
    this.expectedChecksums.push(computeStateChecksum(state));
  }

  public buildPayload(): ReplayPayload | null {
    if (this.inputTimeline.length === 0) {
      return null;
    }

    const finalFrame = this.inputTimeline.length - 1;
    const aiDecisionTrace = createReplayAiDecisionTrace(
      this.aiDecisionTelemetry.toSummary().events,
    );
    return {
      header: {
        payloadVersion: REPLAY_PAYLOAD_VERSION,
        rulesetVersion: this.options.rulesetVersion,
        simBuildHash: this.options.simBuildHash,
        seed: this.options.seed,
        loadout: { ...this.options.loadout },
        fixedDt: this.options.fixedDt,
        advanceRngPerFrame: false,
        rules: { ...this.options.rules },
        balanceTuning: { ...this.options.tuning },
        characterBalanceOverrides: cloneCharacterBalanceOverrides(
          this.options.characterBalanceOverrides,
        ),
        startingSituation: this.options.startingSituationId
          ? {
              schemaVersion: BALANCE_SCENARIO_SCHEMA_VERSION,
              id: this.options.startingSituationId,
            }
          : undefined,
        reviewFocus: {
          schemaVersion: 'gw.replay-focus.v1',
          source: 'live-ai-round',
          label: this.options.sourceLabel,
          focusFrame: 0,
          endFrame: finalFrame,
        },
        ...(this.localAiProvenance
          ? { localAi: cloneReplayLocalAiProvenance(this.localAiProvenance) }
          : {}),
      },
      inputTimeline: this.inputTimeline.map(cloneFrameInput),
      rounds: [{
        round: this.options.roundNumber,
        label: `Round ${this.options.roundNumber}`,
        startFrame: 0,
        endFrame: finalFrame,
      }],
      expectedChecksums: [...this.expectedChecksums],
      ...(aiDecisionTrace ? { aiDecisionTrace } : {}),
    };
  }
}
