import { describe, expect, test } from 'vitest';
import { rebindGamepad, rebindKeyboard } from './bindingEditor';
import { buildInputBindingLegend } from './bindingLegend';
import { InputBindingStore, createDefaultInputBindingProfile } from './bindings';

describe('input binding HUD legend', () => {
  test('formats defaults and reflects remapped keyboard and split controller profiles', () => {
    const store = new InputBindingStore(null);
    rebindKeyboard(store, 'P1', 'boost', 'KeyQ');
    rebindGamepad(store, 'P2', 'boost', 5);

    const legend = buildInputBindingLegend(store.getProfile());

    expect(legend.p1Keyboard).toContain('Q boost');
    expect(legend.p2Keyboard).toContain('I/J/K/L move');
    expect(legend.gamepad).toContain('P1 pad:');
    expect(legend.gamepad).toContain('P2 pad:');
    expect(legend.mouse).toContain('Left Click launch');
  });

  test('uses one controller line while both player profiles match', () => {
    const legend = buildInputBindingLegend(createDefaultInputBindingProfile());
    expect(legend.gamepad).toContain('Controllers: Left stick or D-pad move');
    expect(legend.gamepad).not.toContain('P2 pad:');
  });
});
