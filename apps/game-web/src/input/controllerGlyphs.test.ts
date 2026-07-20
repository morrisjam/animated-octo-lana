import { describe, expect, test } from 'vitest';
import { createDefaultInputBindingProfile } from './bindings';
import {
  buildGamepadActionGlyphs,
  detectGamepadFamily,
  resolveGamepadButtonGlyph,
} from './controllerGlyphs';

describe('controller family detection', () => {
  test.each([
    ['Xbox Wireless Controller (Vendor: 045e Product: 0b13)', 'xbox'],
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation'],
    ['Nintendo Switch Pro Controller (Vendor: 057e Product: 2009)', 'nintendo'],
    ['8BitDo Ultimate Wireless Controller', 'generic'],
  ] as const)('detects %s as %s', (id, expected) => {
    expect(detectGamepadFamily(id)).toBe(expected);
  });
});

describe('controller glyph labels', () => {
  test('uses family-specific standard-layout labels', () => {
    expect(resolveGamepadButtonGlyph(0, 'xbox')).toMatchObject({
      label: 'A',
      accessibleLabel: 'Xbox A button',
    });
    expect(resolveGamepadButtonGlyph(0, 'playstation').label).toBe('Cross');
    expect(resolveGamepadButtonGlyph(0, 'nintendo').label).toBe('B');
    expect(resolveGamepadButtonGlyph(0, 'generic').label).toBe('Button 0');
    expect(resolveGamepadButtonGlyph(null, 'xbox').label).toBe('Unbound');
  });

  test('builds action labels from the current remapped player profile', () => {
    const bindings = createDefaultInputBindingProfile().gamepad.P1;
    bindings.launch = 0;
    bindings.breakLaunch = 3;

    const glyphs = buildGamepadActionGlyphs(bindings, 'playstation');

    expect(glyphs.launch.label).toBe('Cross');
    expect(glyphs.breakLaunch.label).toBe('Triangle');
  });
});
