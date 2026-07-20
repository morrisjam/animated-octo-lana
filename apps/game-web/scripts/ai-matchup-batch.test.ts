import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createDefaultAiBehaviorTuning } from '../src/sim/ai';
import { createBalanceLabDraft } from '../src/sim/balanceLab';
import { createDefaultTuning } from '../src/sim/tuning';

const GAME_WEB_DIR = fileURLToPath(new URL('../', import.meta.url));
const BATCH_SCRIPT = fileURLToPath(new URL('./ai-matchup-batch.ts', import.meta.url));
const THRESHOLDS_PATH = fileURLToPath(
  new URL('../content/balance/ai-regression-thresholds.json', import.meta.url),
);

function runInvalidBatch(args: string[]) {
  const outputDir = mkdtempSync(join(tmpdir(), 'gw-ai-batch-validation-'));
  try {
    return spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        BATCH_SCRIPT,
        ...args,
        '--thresholds',
        THRESHOLDS_PATH,
        '--output-dir',
        outputDir,
      ],
      {
        cwd: GAME_WEB_DIR,
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function runBatch(outputDir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', BATCH_SCRIPT, ...args, '--output-dir', outputDir],
    {
      cwd: GAME_WEB_DIR,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

describe('ai-matchup-batch selection validation', () => {
  test.each([
    {
      name: 'a one-character roster',
      args: ['--characters', 'vanguard'],
      expectedError: 'AI batch selection generated zero directed pairings',
    },
    {
      name: 'an empty character roster',
      args: ['--characters', ','],
      expectedError: '--characters must select at least one registered character id',
    },
    {
      name: 'an unknown character in the roster',
      args: ['--characters', 'vanguard,unknown-character'],
      expectedError: 'Unknown --characters id(s): "unknown-character"',
    },
    {
      name: 'an unknown difficulty in the matrix',
      args: ['--difficulty', 'veteran,nightmare', '--characters', 'vanguard'],
      expectedError: 'Unknown --difficulty id(s): "nightmare"',
    },
    {
      name: 'an unknown direct character selection',
      args: ['--p1', 'vanguard', '--p2', 'unknown-character'],
      expectedError: 'Unknown --p2 character id "unknown-character"',
    },
  ])('rejects $name before simulation', ({ args, expectedError }) => {
    const result = runInvalidBatch(args);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain(expectedError);
    expect(output).not.toContain('[ai-batch] balance gate passed');
  });

  test('emits v24 loop-reason and ordinary-Boost telemetry while keeping historical fallback explicit', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'gw-ai-batch-v24-'));
    try {
      const scenarioArgs = [
        '--games', '1',
        '--max-round-seconds', '1',
        '--difficulty', 'veteran',
        '--p1', 'vanguard',
        '--p2', 'duelist',
      ];
      const baseline = runBatch(outputDir, [
        ...scenarioArgs,
        '--report-name', 'baseline',
      ]);
      expect(baseline.error).toBeUndefined();
      expect(`${baseline.stdout}\n${baseline.stderr}`).toContain('[ai-batch] json written');
      expect(baseline.status).toBe(0);

      const baselinePath = join(outputDir, 'baseline.json');
      const baselineReport = JSON.parse(readFileSync(baselinePath, 'utf8')) as any;
      expect(baselineReport.schemaVersion).toBe('gw.ai-matchup-batch.v24');
      expect(baselineReport.simulation).toMatchObject({
        roundsToWin: 2,
        maximumRoundsPerSet: 3,
        roundSampling: 'fixed_rounds_v1',
      });
      expect(baselineReport.summaries[0]).toMatchObject({
        averageRoundsPerSet: 3,
        telemetry: {
          rounds: 3,
          schemaVersion: 'gw.match-telemetry-aggregate.v10',
          matchTelemetrySchemaVersion: 'gw.match-telemetry.v10',
          ordinaryBoostCounterplay: {
            P1: { opportunities: expect.any(Number) },
            P2: { opportunities: expect.any(Number) },
          },
        },
        flow: {
          rounds: 3,
          loopStages: {
            commitment: { issueReasons: [] },
            chase: { issueReasons: [] },
          },
          ordinaryBoostCounterplay: {
            P1: { opportunitiesPerRound: expect.any(Number) },
            P2: { opportunitiesPerRound: expect.any(Number) },
          },
        },
      });
      for (const playerId of ['P1', 'P2'] as const) {
        expect(baselineReport.summaries[0].flow.players[playerId]).toMatchObject({
          postControlChaseLockWindows: 0,
          postControlChaseLockWindowsPerRound: 0,
          postControlChaseLockFrames: 0,
          postControlChaseLockSecondsPerRound: 0,
          postControlBoostSuppressionFrames: 0,
          postControlBoostSuppressionSecondsPerRound: 0,
          postControlDashSuppressionFrames: 0,
          postControlDashSuppressionSecondsPerRound: 0,
          postControlChaseLockConsumptions: 0,
          postControlChaseLockConsumptionsPerRound: 0,
          postControlRepeatDashWindows: 0,
          postControlRepeatDashWindowsPerRound: 0,
          postControlRepeatDashWeightFrames: 0,
          postControlRepeatDashWeightSecondsPerRound: 0,
          postControlRepeatDashConsumptions: 0,
          postControlRepeatDashConsumptionsPerRound: 0,
          postControlRepeatDashSelections: 0,
          postControlRepeatDashSelectionsPerRound: 0,
          controlReturnCausal: {
            windows: 0,
            averageControlGrantedDistance: null,
            averageMaximumDistance: null,
            returnedPlayerClosingDistance: 0,
            opponentClosingDistance: 0,
            returnedPlayerClosingShare: null,
            roles: {
              returner: {
                dominantMovementIntents: { approach: 0, unobserved: 0 },
                firstAcceptedActions: { launch: 0, none: 0 },
              },
              opponent: {
                dominantMovementIntents: { approach: 0, unobserved: 0 },
                firstAcceptedActions: { launch: 0, none: 0 },
              },
            },
          },
        });
      }

      const candidateDraftPath = join(outputDir, 'candidate.json');
      writeFileSync(candidateDraftPath, `${JSON.stringify(createBalanceLabDraft(
        'Six-frame chase-lock compatibility probe',
        createDefaultTuning(),
        {},
        '2026-07-16T00:00:00.000Z',
        {
          ...createDefaultAiBehaviorTuning(),
          postControlChaseLockFrames: 6,
        },
      ), null, 2)}\n`);

      const currentComparison = runBatch(outputDir, [
        ...scenarioArgs,
        '--draft', candidateDraftPath,
        '--compare-report', baselinePath,
        '--report-name', 'candidate-v24-comparison',
      ]);
      expect(currentComparison.error).toBeUndefined();
      expect(currentComparison.status).toBe(0);
      const currentComparisonReport = JSON.parse(readFileSync(
        join(outputDir, 'candidate-v24-comparison.json'),
        'utf8',
      )) as any;
      expect(currentComparisonReport.comparison.deltas[0]).toMatchObject({
        p1PostControlRepeatDashWindowsPerRound: 0,
        p2PostControlRepeatDashWindowsPerRound: 0,
        p1PostControlRepeatDashWeightSecondsPerRound: 0,
        p2PostControlRepeatDashWeightSecondsPerRound: 0,
        p1PostControlRepeatDashConsumptionsPerRound: 0,
        p2PostControlRepeatDashConsumptionsPerRound: 0,
        p1PostControlRepeatDashSelectionsPerRound: 0,
        p2PostControlRepeatDashSelectionsPerRound: 0,
      });
      expect(readFileSync(join(outputDir, 'candidate-v24-comparison.md'), 'utf8'))
        .toContain('### Post-Control Repeat Dash Deltas');
      expect(readFileSync(join(outputDir, 'candidate-v24-comparison.md'), 'utf8'))
        .toContain('### Ordinary Boost Counterplay');

      const previousReport = structuredClone(baselineReport);
      previousReport.schemaVersion = 'gw.ai-matchup-batch.v22';
      for (const summary of previousReport.summaries) {
        summary.telemetry.schemaVersion = 'gw.match-telemetry-aggregate.v9';
        summary.telemetry.matchTelemetrySchemaVersion = 'gw.match-telemetry.v9';
        delete summary.telemetry.ordinaryBoostCounterplay;
        delete summary.flow.ordinaryBoostCounterplay;
      }
      const previousPath = join(outputDir, 'historical-v22.json');
      writeFileSync(previousPath, `${JSON.stringify(previousReport, null, 2)}\n`);
      const previousComparison = runBatch(outputDir, [
        ...scenarioArgs,
        '--draft', candidateDraftPath,
        '--compare-report', previousPath,
        '--report-name', 'candidate-v22-comparison',
      ]);
      expect(previousComparison.error).toBeUndefined();
      expect(previousComparison.status).toBe(0);

      const historicalReport = structuredClone(baselineReport);
      historicalReport.schemaVersion = 'gw.ai-matchup-batch.v18';
      for (const playerId of ['P1', 'P2'] as const) {
        const player = historicalReport.summaries[0].flow.players[playerId];
        for (const key of [
          'postControlChaseLockWindows',
          'postControlChaseLockWindowsPerRound',
          'postControlChaseLockFrames',
          'postControlChaseLockSecondsPerRound',
          'postControlBoostSuppressionFrames',
          'postControlBoostSuppressionSecondsPerRound',
          'postControlDashSuppressionFrames',
          'postControlDashSuppressionSecondsPerRound',
          'postControlChaseLockConsumptions',
          'postControlChaseLockConsumptionsPerRound',
          'postControlRepeatDashWindows',
          'postControlRepeatDashWindowsPerRound',
          'postControlRepeatDashWeightFrames',
          'postControlRepeatDashWeightSecondsPerRound',
          'postControlRepeatDashConsumptions',
          'postControlRepeatDashConsumptionsPerRound',
          'postControlRepeatDashSelections',
          'postControlRepeatDashSelectionsPerRound',
        ]) {
          delete player[key];
        }
      }
      const historicalPath = join(outputDir, 'historical-v18.json');
      writeFileSync(historicalPath, `${JSON.stringify(historicalReport, null, 2)}\n`);

      const comparison = runBatch(outputDir, [
        ...scenarioArgs,
        '--draft', candidateDraftPath,
        '--compare-report', historicalPath,
        '--report-name', 'candidate-v18-comparison',
      ]);
      expect(comparison.error).toBeUndefined();
      expect(`${comparison.stdout}\n${comparison.stderr}`).toContain('single_variable');
      expect(comparison.status).toBe(0);
      const comparisonReport = JSON.parse(readFileSync(
        join(outputDir, 'candidate-v18-comparison.json'),
        'utf8',
      )) as any;
      expect(comparisonReport.comparison.deltas[0]).toMatchObject({
        p1PostControlChaseLockWindowsPerRound: null,
        p2PostControlChaseLockWindowsPerRound: null,
        p1PostControlBoostSuppressionSecondsPerRound: null,
        p2PostControlBoostSuppressionSecondsPerRound: null,
        p1PostControlRepeatDashWindowsPerRound: null,
        p2PostControlRepeatDashWindowsPerRound: null,
        p1PostControlRepeatDashWeightSecondsPerRound: null,
        p2PostControlRepeatDashWeightSecondsPerRound: null,
        p1PostControlRepeatDashConsumptionsPerRound: null,
        p2PostControlRepeatDashConsumptionsPerRound: null,
        p1PostControlRepeatDashSelectionsPerRound: null,
        p2PostControlRepeatDashSelectionsPerRound: null,
        p1ReturnerClosingSharePoints: null,
        p2ReturnerClosingSharePoints: null,
        p1SustainedExitRatioPoints: null,
        p2SustainedExitRatioPoints: null,
        p1ControlReturnResetRatioPoints: null,
        p2ControlReturnResetRatioPoints: null,
      });
      expect(readFileSync(join(outputDir, 'candidate-v18-comparison.md'), 'utf8'))
        .toContain('N/A means the baseline predates decision-flow v4 counters.');
      expect(readFileSync(join(outputDir, 'candidate-v18-comparison.md'), 'utf8'))
        .toContain('N/A means the baseline predates decision-flow v5 counters.');

      const malformedCases = [
        {
          name: 'missing-fixed-round-sampling',
          mutate: (report: any) => {
            delete report.simulation.roundSampling;
          },
        },
        {
          name: 'outcome-dependent-round-limit',
          mutate: (report: any) => {
            report.simulation.maximumRoundsPerSet = 5;
          },
        },
        {
          name: 'incomplete-fixed-round-membership',
          mutate: (report: any) => {
            report.summaries[0].averageRoundsPerSet = 2;
          },
        },
        {
          name: 'missing-field',
          mutate: (report: any) => {
            delete report.summaries[0].flow.players.P1.postControlChaseLockFrames;
          },
        },
        {
          name: 'negative-frame-count',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.postControlChaseLockFrames = -1;
          },
        },
        {
          name: 'fractional-window-count',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.postControlChaseLockWindows = 0.5;
          },
        },
        {
          name: 'inconsistent-derived-duration',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.postControlChaseLockSecondsPerRound = 0.01;
          },
        },
        {
          name: 'missing-repeat-dash-field',
          mutate: (report: any) => {
            delete report.summaries[0].flow.players.P1.postControlRepeatDashSelections;
          },
        },
        {
          name: 'repeat-dash-consumption-exceeds-windows',
          mutate: (report: any) => {
            const player = report.summaries[0].flow.players.P1;
            player.postControlRepeatDashConsumptions = 1;
            player.postControlRepeatDashConsumptionsPerRound = 0.33;
          },
        },
        {
          name: 'repeat-dash-selection-exceeds-consumptions',
          mutate: (report: any) => {
            const player = report.summaries[0].flow.players.P1;
            player.postControlRepeatDashWindows = 1;
            player.postControlRepeatDashWindowsPerRound = 0.33;
            player.postControlRepeatDashWeightFrames = 1;
            player.postControlRepeatDashWeightSecondsPerRound = 0.01;
            player.postControlRepeatDashSelections = 1;
            player.postControlRepeatDashSelectionsPerRound = 0.33;
          },
        },
        {
          name: 'repeat-dash-selection-without-weight-frame',
          mutate: (report: any) => {
            const player = report.summaries[0].flow.players.P1;
            player.postControlRepeatDashWindows = 1;
            player.postControlRepeatDashWindowsPerRound = 0.33;
            player.postControlRepeatDashConsumptions = 1;
            player.postControlRepeatDashConsumptionsPerRound = 0.33;
            player.postControlRepeatDashSelections = 1;
            player.postControlRepeatDashSelectionsPerRound = 0.33;
          },
        },
        {
          name: 'repeat-dash-weight-frame-without-window',
          mutate: (report: any) => {
            const player = report.summaries[0].flow.players.P1;
            player.postControlRepeatDashWeightFrames = 1;
            player.postControlRepeatDashWeightSecondsPerRound = 0.01;
          },
        },
        {
          name: 'inconsistent-repeat-dash-weight-duration',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.postControlRepeatDashWeightSecondsPerRound = 0.01;
          },
        },
        {
          name: 'missing-ordinary-boost-counterplay',
          mutate: (report: any) => {
            delete report.summaries[0].flow.ordinaryBoostCounterplay;
          },
        },
        {
          name: 'incomplete-ordinary-boost-action-histogram',
          mutate: (report: any) => {
            delete report.summaries[0].flow.ordinaryBoostCounterplay.P1
              .firstResponseActions.none;
          },
        },
        {
          name: 'ordinary-boost-outcome-total-mismatch',
          mutate: (report: any) => {
            report.summaries[0].flow.ordinaryBoostCounterplay.P1
              .outcomes.contact += 1;
          },
        },
        {
          name: 'ordinary-boost-telemetry-mismatch',
          mutate: (report: any) => {
            report.summaries[0].flow.ordinaryBoostCounterplay.P1
              .opportunitiesPerRound += 1;
          },
        },
        {
          name: 'missing-control-return-causality',
          mutate: (report: any) => {
            delete report.summaries[0].flow.players.P1.controlReturnCausal;
          },
        },
        {
          name: 'inconsistent-control-return-outcomes',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.controlReturnCausal.outcomes.sustained_exit = 1;
          },
        },
        {
          name: 'inconsistent-control-return-closure-counts',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.controlReturnCausal.returnedPlayerClosedMore = 1;
          },
        },
        {
          name: 'inconsistent-control-return-closure-share',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.controlReturnCausal.returnedPlayerClosingShare = 0.5;
          },
        },
        {
          name: 'wrong-match-telemetry-provenance',
          mutate: (report: any) => {
            report.summaries[0].telemetry.matchTelemetrySchemaVersion = 'gw.match-telemetry.v8';
          },
        },
        {
          name: 'inconsistent-control-return-grant-counts',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.controlReturnCausal.safeAtGrant = 1;
          },
        },
        {
          name: 'inconsistent-control-return-distance-total',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.controlReturnCausal.maximumDistanceTotal = 1;
          },
        },
        {
          name: 'missing-control-return-role-category',
          mutate: (report: any) => {
            delete report.summaries[0].flow.players.P1.controlReturnCausal
              .roles.returner.dominantMovementIntents.approach;
          },
        },
        {
          name: 'inconsistent-control-return-role-total',
          mutate: (report: any) => {
            report.summaries[0].flow.players.P1.controlReturnCausal
              .roles.opponent.firstAcceptedActions.none = 1;
          },
        },
      ];
      for (const malformedCase of malformedCases) {
        const malformedReport = structuredClone(baselineReport);
        malformedCase.mutate(malformedReport);
        const malformedPath = join(outputDir, `malformed-v23-${malformedCase.name}.json`);
        writeFileSync(malformedPath, `${JSON.stringify(malformedReport, null, 2)}\n`);
        const malformedComparison = runBatch(outputDir, [
          ...scenarioArgs,
          '--draft', candidateDraftPath,
          '--compare-report', malformedPath,
          '--report-name', `malformed-comparison-${malformedCase.name}`,
        ]);
        expect(malformedComparison.status, malformedCase.name).not.toBe(0);
        expect(`${malformedComparison.stdout}\n${malformedComparison.stderr}`)
          .toContain('not a compatible AI matchup batch report');
      }
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 90_000);
});
