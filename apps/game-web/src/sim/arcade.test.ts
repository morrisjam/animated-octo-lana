import { describe, expect, test } from 'vitest';
import {
  applyArcadeLossAction,
  createArcadeRun,
  getCurrentArcadeStage,
  resolveArcadeMatch,
} from './arcade';

describe('arcade run flow', () => {
  test('progresses stage-by-stage and ends with completion summary on final encounter clear', () => {
    let run = createArcadeRun({ startedAtMs: 1000 });

    for (let stageIndex = 0; stageIndex < run.stages.length - 1; stageIndex += 1) {
      const resolution = resolveArcadeMatch(run, 'P1', 2, 0, 1500 + stageIndex * 1000);
      expect(resolution.type).toBe('advance_stage');
      if (resolution.type === 'advance_stage') {
        run = resolution.state;
        expect(run.stageIndex).toBe(stageIndex + 1);
      }
    }

    const finalResolution = resolveArcadeMatch(run, 'P1', 2, 1, 8000);
    expect(finalResolution.type).toBe('run_complete');
    if (finalResolution.type === 'run_complete') {
      expect(finalResolution.summary.outcome).toBe('completed');
      expect(finalResolution.summary.stagesCleared).toBe(run.stages.length);
      expect(finalResolution.summary.totalStages).toBe(run.stages.length);
    }
  });

  test('exposes continue and retry actions on stage loss when configured', () => {
    let run = createArcadeRun({
      startedAtMs: 1000,
      rules: {
        roundsToWin: 2,
        maxContinues: 2,
        allowContinueAfterLoss: true,
        allowRetryStage: true,
      },
    });
    const initialStage = getCurrentArcadeStage(run);

    const loss = resolveArcadeMatch(run, 'P2', 0, 2, 1800);
    expect(loss.type).toBe('stage_loss');
    if (loss.type === 'stage_loss') {
      expect(loss.allowedActions).toEqual(['continue', 'retry_stage']);
      run = applyArcadeLossAction(loss.state, 'continue', 2000);
    }
    expect(run.continuesUsed).toBe(1);
    expect(run.stageIndex).toBe(0);
    expect(getCurrentArcadeStage(run).id).toBe(initialStage.id);

    const secondLoss = resolveArcadeMatch(run, 'P2', 1, 2, 2600);
    expect(secondLoss.type).toBe('stage_loss');
    if (secondLoss.type === 'stage_loss') {
      run = applyArcadeLossAction(secondLoss.state, 'retry_stage', 2800);
    }
    expect(run.retriesUsed).toBe(1);
    expect(getCurrentArcadeStage(run).id).toBe(initialStage.id);
  });

  test('fails run when no continue or retry action is available', () => {
    const run = createArcadeRun({
      startedAtMs: 1000,
      rules: {
        roundsToWin: 2,
        maxContinues: 0,
        allowContinueAfterLoss: false,
        allowRetryStage: false,
      },
    });
    const loss = resolveArcadeMatch(run, 'P2', 0, 2, 2200);
    expect(loss.type).toBe('run_failed');
    if (loss.type === 'run_failed') {
      expect(loss.summary.outcome).toBe('failed');
      expect(loss.summary.stagesCleared).toBe(0);
    }
  });
});
