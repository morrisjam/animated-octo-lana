import {
  createDefaultAiControllerRoles,
  sanitiseAiControllerRoles,
  type AiControllerRoles,
} from './aiControllerRoles';
import {
  DEFAULT_BALANCE_SCENARIO_ID,
  resolveBalanceScenario,
  type BalanceScenarioId,
} from './balanceScenarios';

export const BALANCE_TEST_RECIPE_SCHEMA_VERSION = 'gw.balance-test-recipe.v1';

export const BALANCE_TEST_RECIPE_IDS = [
  'open_ai_mirror',
  'offense_vs_passive',
  'commitment_vs_defense',
  'shared_commitment_cadence',
  'launch_break_agency',
  'pursuit_vs_escape',
  'post_clash_reset',
  'post_control_agency',
  'human_post_control_agency',
  'zero_fuel_finish',
] as const;

export type BalanceTestRecipeId = (typeof BALANCE_TEST_RECIPE_IDS)[number];
export type BalanceTestRecipeSelectionId = BalanceTestRecipeId | 'custom';

export interface BalanceTestRecipe {
  id: BalanceTestRecipeId;
  label: string;
  description: string;
  designerQuestion: string;
  suggestedDurationSeconds: number;
  scenarioId: BalanceScenarioId;
  roles: AiControllerRoles;
}

export const DEFAULT_BALANCE_TEST_RECIPE_ID: BalanceTestRecipeId = 'open_ai_mirror';

export const BALANCE_TEST_RECIPES: readonly BalanceTestRecipe[] = [
  {
    id: 'open_ai_mirror',
    label: 'Open AI mirror',
    description: 'Run both full controllers from the standard spawn.',
    designerQuestion: 'Does the complete loop create readable neutral, commitments, resets, chases, and finishes without collapsing into contact?',
    suggestedDurationSeconds: 45,
    scenarioId: DEFAULT_BALANCE_SCENARIO_ID,
    roles: createDefaultAiControllerRoles(),
  },
  {
    id: 'offense_vs_passive',
    label: 'Offense vs passive',
    description: 'Place adaptive P1 in close pressure against a neutral target that never launch-breaks.',
    designerQuestion: 'Do P1 attacks create readable impact, separation, chase, and finish opportunities without relying on the defender to move?',
    suggestedDurationSeconds: 20,
    scenarioId: 'close_pressure',
    roles: { P1: 'adaptive', P2: 'passive' },
  },
  {
    id: 'commitment_vs_defense',
    label: 'Commitment vs defense',
    description: 'Place adaptive P1 in close pressure against a stationary defender that parries and launch-breaks.',
    designerQuestion: 'Are commitments readable and punishable, and do defensive successes create a meaningful reset instead of immediate contact?',
    suggestedDurationSeconds: 25,
    scenarioId: 'close_pressure',
    roles: { P1: 'adaptive', P2: 'defensive' },
  },
  {
    id: 'shared_commitment_cadence',
    label: 'Shared commitment cadence',
    description: 'Place both fighters in close pressure with complete kits; AI vs AI uses two adaptive controllers while Balance Sparring leaves P1 human.',
    designerQuestion: 'Do two fully active fighters create a readable attack, answer, and reset cadence instead of continuously overlapping commitments?',
    suggestedDurationSeconds: 25,
    scenarioId: 'close_pressure',
    roles: createDefaultAiControllerRoles(),
  },
  {
    id: 'launch_break_agency',
    label: 'Launch-break agency',
    description: 'Start defensive P2 already launched with one break available while adaptive P1 is committed to the chase.',
    designerQuestion: 'Does spending the launch break create one readable defensive decision before P1 can re-establish pressure?',
    suggestedDurationSeconds: 20,
    scenarioId: 'launch_break_decision',
    roles: { P1: 'adaptive', P2: 'defensive' },
  },
  {
    id: 'pursuit_vs_escape',
    label: 'Pursuit vs escape',
    description: 'Start at long range with adaptive P1 chasing an escape-focused P2.',
    designerQuestion: 'Can P1 earn a catch while P2 creates visible mid-range and long-range windows without permanently stalling the round?',
    suggestedDurationSeconds: 30,
    scenarioId: 'long_neutral',
    roles: { P1: 'adaptive', P2: 'evasive' },
  },
  {
    id: 'post_clash_reset',
    label: 'Post-clash reset',
    description: 'Start both adaptive controllers in deterministic clash recoil and recovery.',
    designerQuestion: 'Does clash separation survive long enough to create a fresh decision, or does held pursuit immediately recreate the same exchange?',
    suggestedDurationSeconds: 20,
    scenarioId: 'post_clash',
    roles: createDefaultAiControllerRoles(),
  },
  {
    id: 'post_control_agency',
    label: 'Post-control agency',
    description: 'Start P2 at the instant of natural control return inside P1 committed chase pressure.',
    designerQuestion: 'Can P2 create a visible, durable decision window before P1 re-launches, without turning the exchange into a free escape?',
    suggestedDurationSeconds: 20,
    scenarioId: 'control_return_pressure',
    roles: createDefaultAiControllerRoles(),
  },
  {
    id: 'human_post_control_agency',
    label: 'Human recovery agency',
    description: 'Start human P1 at the instant of natural control return inside P2 committed chase pressure.',
    designerQuestion: 'Can you create a visible, durable decision window before P2 re-launches, without receiving a free escape?',
    suggestedDurationSeconds: 20,
    scenarioId: 'p1_control_return_pressure',
    roles: createDefaultAiControllerRoles(),
  },
  {
    id: 'zero_fuel_finish',
    label: 'Zero-fuel finish',
    description: 'Give adaptive P1 a chase against a helpless, empty passive P2 with no launch breaks.',
    designerQuestion: 'Does the advantage advance cleanly from chase to dunk attempt and round finish, with readable timing and motion?',
    suggestedDurationSeconds: 15,
    scenarioId: 'zero_fuel_chase',
    roles: { P1: 'adaptive', P2: 'passive' },
  },
];

const RECIPE_BY_ID = Object.fromEntries(
  BALANCE_TEST_RECIPES.map((recipe) => [recipe.id, recipe]),
) as Record<BalanceTestRecipeId, BalanceTestRecipe>;

export function resolveBalanceTestRecipe(value: unknown): BalanceTestRecipe {
  return typeof value === 'string' && BALANCE_TEST_RECIPE_IDS.includes(value as BalanceTestRecipeId)
    ? RECIPE_BY_ID[value as BalanceTestRecipeId]
    : RECIPE_BY_ID[DEFAULT_BALANCE_TEST_RECIPE_ID];
}

export function findBalanceTestRecipeForSetup(
  scenarioValue: unknown,
  rolesValue: unknown,
): BalanceTestRecipe | null {
  const scenarioId = resolveBalanceScenario(scenarioValue).id;
  const roles = sanitiseAiControllerRoles(rolesValue);
  return BALANCE_TEST_RECIPES.find((recipe) => (
    recipe.scenarioId === scenarioId
    && recipe.roles.P1 === roles.P1
    && recipe.roles.P2 === roles.P2
  )) ?? null;
}

export function getBalanceTestRecipeSelectionId(
  scenarioValue: unknown,
  rolesValue: unknown,
): BalanceTestRecipeSelectionId {
  return findBalanceTestRecipeForSetup(scenarioValue, rolesValue)?.id ?? 'custom';
}

export function getBalanceTestRecipeSetup(recipeValue: unknown): {
  scenarioId: BalanceScenarioId;
  roles: AiControllerRoles;
} {
  const recipe = resolveBalanceTestRecipe(recipeValue);
  return {
    scenarioId: recipe.scenarioId,
    roles: sanitiseAiControllerRoles(recipe.roles),
  };
}
