import { describe, expect, test } from 'vitest';
import {
  BALANCE_TEST_RECIPE_IDS,
  BALANCE_TEST_RECIPE_SCHEMA_VERSION,
  BALANCE_TEST_RECIPES,
  DEFAULT_BALANCE_TEST_RECIPE_ID,
  findBalanceTestRecipeForSetup,
  getBalanceTestRecipeSelectionId,
  getBalanceTestRecipeSetup,
  resolveBalanceTestRecipe,
  type BalanceTestRecipeId,
} from './balanceTestRecipes';

const EXPECTED_RECIPE_IDS: BalanceTestRecipeId[] = [
  'open_ai_mirror',
  'offense_vs_passive',
  'commitment_vs_defense',
  'launch_break_agency',
  'pursuit_vs_escape',
  'post_clash_reset',
  'post_control_agency',
  'human_post_control_agency',
  'zero_fuel_finish',
];

describe('Balance Lab test recipes', () => {
  test('exports a stable versioned registry with one designer question per probe', () => {
    expect(BALANCE_TEST_RECIPE_SCHEMA_VERSION).toBe('gw.balance-test-recipe.v1');
    expect(BALANCE_TEST_RECIPE_IDS).toEqual(EXPECTED_RECIPE_IDS);
    expect(BALANCE_TEST_RECIPES.map((recipe) => recipe.id)).toEqual(EXPECTED_RECIPE_IDS);
    for (const recipe of BALANCE_TEST_RECIPES) {
      expect(recipe.label.length).toBeGreaterThan(0);
      expect(recipe.description.length).toBeGreaterThan(0);
      expect(recipe.designerQuestion.endsWith('?')).toBe(true);
      expect(recipe.suggestedDurationSeconds).toBeGreaterThanOrEqual(10);
    }
  });

  test('falls back to the open AI mirror for invalid recipe ids', () => {
    const fallback = resolveBalanceTestRecipe(DEFAULT_BALANCE_TEST_RECIPE_ID);
    expect(resolveBalanceTestRecipe(undefined)).toBe(fallback);
    expect(resolveBalanceTestRecipe('missing')).toBe(fallback);
    expect(resolveBalanceTestRecipe('custom')).toBe(fallback);
  });

  test.each(BALANCE_TEST_RECIPES)('round-trips $id through its scenario and roles', (recipe) => {
    expect(findBalanceTestRecipeForSetup(recipe.scenarioId, recipe.roles)).toBe(recipe);
    expect(getBalanceTestRecipeSelectionId(recipe.scenarioId, recipe.roles)).toBe(recipe.id);
    expect(getBalanceTestRecipeSetup(recipe.id)).toEqual({
      scenarioId: recipe.scenarioId,
      roles: recipe.roles,
    });
  });

  test('labels manual combinations as custom instead of guessing a probe', () => {
    expect(getBalanceTestRecipeSelectionId('launch_break_decision', {
      P1: 'passive',
      P2: 'evasive',
    })).toBe('custom');
  });

  test('returns detached role objects so a staged edit cannot mutate the registry', () => {
    const setup = getBalanceTestRecipeSetup('offense_vs_passive');
    setup.roles.P2 = 'adaptive';
    expect(resolveBalanceTestRecipe('offense_vs_passive').roles.P2).toBe('passive');
  });
});
