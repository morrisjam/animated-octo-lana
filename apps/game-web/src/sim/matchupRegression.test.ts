import { describe, expect, test } from 'vitest';
import {
  buildMatchupSmokeExpectedBaseline,
  compareMatchupSmokeAgainstBaseline,
  runMatchupSmokeSuite,
} from './matchupRegression';

describe('matchup regression smoke suite', () => {
  test('runs semantic checks for all fixtures and profiles', () => {
    const suite = runMatchupSmokeSuite();
    expect(suite.results.length).toBeGreaterThan(0);
    expect(suite.pass).toBe(true);
    for (const result of suite.results) {
      expect(result.semanticPass).toBe(true);
    }
  });

  test('is deterministic for checksum baseline', () => {
    const suiteA = runMatchupSmokeSuite();
    const suiteB = runMatchupSmokeSuite();

    const baseline = buildMatchupSmokeExpectedBaseline(suiteA);
    const comparison = compareMatchupSmokeAgainstBaseline(suiteB, baseline);
    expect(comparison.pass).toBe(true);
    expect(comparison.issues).toEqual([]);
  });
});
