import { describe, expect, test } from 'vitest';
import {
  BALANCE_LAB_LOOP_STAGE_IDS,
  buildBalanceLabFightStory,
  type BalanceLabExchangeReview,
  type BalanceLabFlowModel,
  type BalanceLabLoopStage,
  type BalanceLabLoopStageId,
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
): BalanceLabLoopStage[] {
  return BALANCE_LAB_LOOP_STAGE_IDS.map((id) => ({
    id,
    label: LABELS[id],
    status: statuses[id] ?? 'observed',
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
    loopStages: createStages(),
    ...overrides,
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

  test('reports progression without inventing a probe when no stage is flagged', () => {
    const story = buildBalanceLabFightStory(createSource());

    expect(story.status).toBe('progressing');
    expect(story.focusStageId).toBeNull();
    expect(story.suggestedRecipeId).toBeNull();
    expect(story.finding).toContain('3 shared action-ready windows');
  });
});
