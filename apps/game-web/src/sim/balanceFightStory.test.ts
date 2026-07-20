import { describe, expect, test } from 'vitest';
import {
  BALANCE_LAB_LOOP_STAGE_IDS,
  buildBalanceLabFightStory,
  type BalanceLabExchangeReview,
  type BalanceLabFlowModel,
  type BalanceLabLoopStage,
  type BalanceLabLoopStageId,
  type BalanceLabLoopStageReasonId,
  type BalanceLabLoopStageStatus,
  type BalanceLabSharedAgencyFlow,
} from './balanceLab';

type FightStorySource = Pick<
  BalanceLabFlowModel,
  | 'elapsedSeconds'
  | 'contactRatio'
  | 'pressureBandRatio'
  | 'launchClashes'
  | 'neutralResets'
  | 'sharedAgency'
  | 'exchanges'
  | 'ordinaryBoostCounterplay'
  | 'loopStages'
>;

const LABELS: Record<BalanceLabLoopStageId, string> = {
  neutral: 'Neutral',
  commitment: 'Commitment',
  exchange: 'Exchange',
  separation: 'Separation',
  chase: 'Chase',
  finish: 'Finish',
};

function createStages(
  statuses: Partial<Record<BalanceLabLoopStageId, BalanceLabLoopStageStatus>> = {},
  reasons: Partial<Record<BalanceLabLoopStageId, BalanceLabLoopStageReasonId>> = {},
): BalanceLabLoopStage[] {
  return BALANCE_LAB_LOOP_STAGE_IDS.map((id) => ({
    id,
    label: LABELS[id],
    status: statuses[id] ?? 'observed',
    reasonId: reasons[id],
    detail: `${LABELS[id]} evidence detail.`,
  }));
}

function createExchange(resolved: boolean, createdReset: boolean): BalanceLabExchangeReview {
  return { resolved, createdReset } as BalanceLabExchangeReview;
}

function createSharedAgency(): BalanceLabSharedAgencyFlow {
  return {
    controlFrames: 1500,
    controlSeconds: 25,
    controlRatio: 0.833,
    controlContactFrames: 150,
    controlContactRatio: 0.1,
    controlPressureFrames: 750,
    controlPressureRatio: 0.5,
    actionReadyFrames: 900,
    actionReadySeconds: 15,
    actionReadyRatio: 0.5,
    actionReadyShareOfControlFrames: 0.6,
    contactFrames: 90,
    contactRatio: 0.1,
    contactEpisodes: 3,
    p90ContactEpisodeSeconds: 0.3,
    maximumContactEpisodeSeconds: 0.4,
    pressureFrames: 450,
    pressureRatio: 0.5,
    neutralFrames: 450,
    neutralRatio: 0.5,
    neutralEpisodes: 3,
    averageNeutralEpisodeSeconds: 1.5,
    p90NeutralEpisodeSeconds: 2,
    maximumNeutralEpisodeSeconds: 2,
    sustainedNeutralWindowSeconds: 4.5,
    sustainedNeutralWindows: 3,
    sustainedWindowThresholdSeconds: 0.75,
  };
}

function createSource(overrides: Partial<FightStorySource> = {}): FightStorySource {
  return {
    elapsedSeconds: 30,
    contactRatio: 0.18,
    pressureBandRatio: 0.52,
    launchClashes: 0,
    neutralResets: 2,
    sharedAgency: createSharedAgency(),
    exchanges: [
      createExchange(true, true),
      createExchange(false, false),
    ],
    ordinaryBoostCounterplay: null,
    loopStages: createStages(),
    ...overrides,
  };
}

function createOrdinaryBoostFlow(
  opportunities: number,
): NonNullable<BalanceLabFlowModel['ordinaryBoostCounterplay']> {
  const createPlayer = () => ({
    opportunities: 0,
    completedOpportunities: 0,
    firstResponses: 0,
    targetSuperBoostResponses: 0,
    firstResponseActions: {
      boost: 0,
      super_boost: 0,
      special: 0,
      launch: 0,
      dunk: 0,
      parry: 0,
      launch_break: 0,
      none: 0,
    },
    outcomes: {
      combat_conversion: 0,
      contact: 0,
      clean_pass: 0,
      avoided_and_opened: 0,
      avoided_but_closed: 0,
      avoided_stable: 0,
      superseded_by_super_boost: 0,
      booster_interrupted: 0,
      round_end: 0,
      sample_end: 0,
    },
    responseCoverageRatio: 0,
    superBoostResponseRatio: 0,
    averageFirstResponseSeconds: null,
    averageAvailableReactionSeconds: null,
    averageStartDistance: null,
  });
  const p1 = createPlayer();
  p1.opportunities = opportunities;
  p1.completedOpportunities = opportunities;
  p1.firstResponses = Math.max(0, opportunities - 1);
  p1.targetSuperBoostResponses = opportunities >= 3 ? 1 : 0;
  p1.outcomes.contact = opportunities > 0 ? 1 : 0;
  p1.outcomes.combat_conversion = opportunities > 1 ? 1 : 0;
  return {
    opportunities,
    players: { P1: p1, P2: createPlayer() },
  };
}

describe('Balance Lab fight story', () => {
  test('waits for a meaningful sample before suggesting a mechanic', () => {
    const story = buildBalanceLabFightStory(createSource({ elapsedSeconds: 9.99 }));

    expect(story.status).toBe('maturing');
    expect(story.suggestedRecipeId).toBeNull();
    expect(story.overview).toContain('1 of 2 exchanges');
  });

  test('prioritises a blocked transition over an earlier watch', () => {
    const story = buildBalanceLabFightStory(createSource({
      loopStages: createStages({ neutral: 'watch', chase: 'blocked' }),
    }));

    expect(story).toMatchObject({
      status: 'blocked',
      headline: 'Chase is blocked',
      focusStageId: 'chase',
      suggestedRecipeId: 'post_control_agency',
    });
    expect(story.finding).toBe('Chase evidence detail.');
  });

  test('uses the deterministic clash probe for a separation issue with clashes', () => {
    const story = buildBalanceLabFightStory(createSource({
      launchClashes: 3,
      loopStages: createStages({ separation: 'watch' }),
    }));

    expect(story.focusStageId).toBe('separation');
    expect(story.suggestedRecipeId).toBe('post_clash_reset');
  });

  test('routes shared-agency commitment saturation to the two-controller cadence probe', () => {
    const story = buildBalanceLabFightStory(createSource({
      loopStages: createStages(
        { commitment: 'blocked' },
        { commitment: 'commitment.shared_agency_saturation' },
      ),
    }));

    expect(story.focusStageId).toBe('commitment');
    expect(story.suggestedRecipeId).toBe('shared_commitment_cadence');
    expect(story.suggestedReason).toContain('both complete controllers');
  });

  test('reports progression without inventing a probe when no stage is flagged', () => {
    const story = buildBalanceLabFightStory(createSource());

    expect(story.status).toBe('progressing');
    expect(story.focusStageId).toBeNull();
    expect(story.suggestedRecipeId).toBeNull();
    expect(story.finding).toContain('3 shared action-ready windows');
  });

  test('adds one ordinary-Boost read sentence only after three opportunities', () => {
    const immature = buildBalanceLabFightStory(createSource({
      ordinaryBoostCounterplay: createOrdinaryBoostFlow(2),
    }));
    const mature = buildBalanceLabFightStory(createSource({
      ordinaryBoostCounterplay: createOrdinaryBoostFlow(3),
    }));

    expect(immature.overview).not.toContain('Ordinary Boost reads');
    expect(mature.overview).toContain(
      'Ordinary Boost reads: 2/3 answered; 1 contacts, 1 combat conversions, and 1 paid Super Boost responses.',
    );
  });
});
