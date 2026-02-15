import { describe, expect, test } from 'vitest';
import { BALANCE_PROFILE_BY_ID } from './balanceProfiles';
import { buildBalancePatchNotesReport, formatBalancePatchNotesMarkdown } from './balancePatchNotes';

describe('balance patch notes', () => {
  test('builds field-level diffs for explicit target profiles', () => {
    const report = buildBalancePatchNotesReport({
      baseProfileId: 'default',
      targetProfileIds: ['mobility_focus_v1'],
      generatedAt: '2026-02-15T00:00:00.000Z',
    });

    expect(report.baseProfileId).toBe('default');
    expect(report.targets).toHaveLength(1);
    expect(report.targets[0].profileId).toBe('mobility_focus_v1');

    const moveAccelDiff = report.targets[0].fieldDiffs.find((diff) => diff.field === 'playerMoveAccel');
    expect(moveAccelDiff).toBeDefined();
    expect(moveAccelDiff?.before).toBe(BALANCE_PROFILE_BY_ID.default.tuning.playerMoveAccel);
    expect(moveAccelDiff?.after).toBe(BALANCE_PROFILE_BY_ID.mobility_focus_v1.tuning.playerMoveAccel);
    expect(moveAccelDiff?.delta).toBeCloseTo(
      BALANCE_PROFILE_BY_ID.mobility_focus_v1.tuning.playerMoveAccel - BALANCE_PROFILE_BY_ID.default.tuning.playerMoveAccel,
    );
  });

  test('supports includeUnchanged to emit full tuning tables', () => {
    const changedOnly = buildBalancePatchNotesReport({
      baseProfileId: 'default',
      targetProfileIds: ['control_focus_v1'],
    });
    const withUnchanged = buildBalancePatchNotesReport({
      baseProfileId: 'default',
      targetProfileIds: ['control_focus_v1'],
      includeUnchanged: true,
    });

    expect(withUnchanged.targets[0].fieldDiffs.length).toBeGreaterThan(changedOnly.targets[0].fieldDiffs.length);
    expect(withUnchanged.targets[0].fieldDiffs.length).toBe(Object.keys(BALANCE_PROFILE_BY_ID.default.tuning).length);
  });

  test('formats markdown with signed field deltas', () => {
    const report = buildBalancePatchNotesReport({
      baseProfileId: 'default',
      targetProfileIds: ['control_focus_v1'],
      generatedAt: '2026-02-15T00:00:00.000Z',
    });
    const markdown = formatBalancePatchNotesMarkdown(report);

    expect(markdown).toContain('# Balance Patch Notes Diff');
    expect(markdown).toContain('## default -> control_focus_v1');
    expect(markdown).toContain('| playerMoveAccel |');
    const moveAccelDelta = BALANCE_PROFILE_BY_ID.control_focus_v1.tuning.playerMoveAccel - BALANCE_PROFILE_BY_ID.default.tuning.playerMoveAccel;
    expect(markdown).toContain(`| ${moveAccelDelta} |`);
  });
});
