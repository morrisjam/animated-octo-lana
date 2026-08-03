import { describe, expect, test } from 'vitest';
import { resolveVisualAlphaStageTarget } from './visualAlphaStageTarget';

describe('visual alpha stage target', () => {
  test('uses the online-alpha stage by default', () => {
    expect(resolveVisualAlphaStageTarget(undefined)).toEqual({
      stageId: 'wormhole_luminous_v8_candidate',
      modelId: null,
      override: false,
    });
  });

  test('derives the model identity for a registered candidate override', () => {
    expect(resolveVisualAlphaStageTarget(' wormhole_funnel_v6_candidate ')).toEqual({
      stageId: 'wormhole_funnel_v6_candidate',
      modelId: 'wormhole_arena_funnel_v3',
      override: true,
    });
    expect(resolveVisualAlphaStageTarget('wormhole_rift_v7_candidate')).toEqual({
      stageId: 'wormhole_rift_v7_candidate',
      modelId: 'wormhole_arena_rift_v4',
      override: true,
    });
  });

  test('rejects unknown stages and resolves presets without an authored model', () => {
    expect(() => resolveVisualAlphaStageTarget('missing-stage')).toThrow(/not registered/);
    expect(resolveVisualAlphaStageTarget('default')).toEqual({
      stageId: 'default',
      modelId: null,
      override: true,
    });
  });
});
