import { describe, expect, test } from 'vitest';
import { CHARACTER_BY_ID } from '../sim/characters';
import { createCharacterBalanceConfig, sanitiseCharacterBalanceOverrides } from '../sim/characterBalance';
import { buildTrainingFrameDataModel } from './trainingFrameData';

describe('training frame data model', () => {
  test('displays applied and imported overrides and resets to packaged timing', () => {
    const original = buildTrainingFrameDataModel('vanguard', 'duelist');
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.launch.startupFrames = 60;
    const applied = buildTrainingFrameDataModel('vanguard', 'duelist', { vanguard });
    expect(applied.rows[1]).toContain('60f startup');
    expect(applied.fingerprint).not.toBe(original.fingerprint);
    expect(applied.hint).toContain(applied.fingerprint);
    const imported = sanitiseCharacterBalanceOverrides(JSON.parse(JSON.stringify({ vanguard })));
    expect(buildTrainingFrameDataModel('vanguard', 'duelist', imported)).toEqual(applied);
    expect(buildTrainingFrameDataModel('vanguard', 'duelist', {})).toEqual(original);
    expect(CHARACTER_BY_ID.vanguard.moves.launch.startupFrames).not.toBe(60);
  });
  test('includes overlay title, hint, and both player move timing rows', () => {
    const model = buildTrainingFrameDataModel('vanguard', 'duelist');
    expect(model.title).toBe('Training Frame Data');
    expect(model.hint.toLowerCase()).toContain('f1');
    expect(model.hint.toLowerCase()).toContain('controller');
    expect(model.rows.some((row) => row.startsWith('P1 Vanguard'))).toBe(true);
    expect(model.rows.some((row) => row.startsWith('P2 Duelist'))).toBe(true);
    expect(model.rows.some((row) => row.startsWith('Launch:'))).toBe(true);
    expect(model.rows.some((row) => row.startsWith('Dunk:'))).toBe(true);
    expect(model.rows.some((row) => row.startsWith('Parry:'))).toBe(true);
    expect(model.rows.some((row) => row.startsWith('Break:'))).toBe(true);
    expect(model.rows.some((row) => row.startsWith('Special:'))).toBe(true);
  });

  test('reads startup and active timing values from character move registry data', () => {
    const p1Moves = CHARACTER_BY_ID.vanguard.moves;
    const p2Moves = CHARACTER_BY_ID.ace.moves;
    const model = buildTrainingFrameDataModel('vanguard', 'ace');
    const launchRow = model.rows.find((row) => row.startsWith('Launch:'));
    const specialRows = model.rows.filter((row) => row.startsWith('Special:'));

    expect(launchRow).toContain(`${p1Moves.launch.startupFrames}f startup`);
    expect(launchRow).toContain(`${p1Moves.launch.activeFrames}f active`);
    expect(specialRows[1]).toContain(`${p2Moves.special.timing.startupFrames}f startup`);
    expect(specialRows[1]).toContain(`${p2Moves.special.timing.activeFrames}f active`);
  });
});
