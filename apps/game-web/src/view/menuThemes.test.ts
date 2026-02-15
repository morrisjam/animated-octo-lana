import { describe, expect, test } from 'vitest';
import {
  applyMenuTheme,
  DEFAULT_MENU_THEME_ID,
  MENU_THEME_IDS,
  resolveMenuTheme,
} from './menuThemes';

describe('menu theme registry', () => {
  test('includes default and resolves unknown ids to default', () => {
    expect(MENU_THEME_IDS.includes(DEFAULT_MENU_THEME_ID)).toBe(true);
    expect(resolveMenuTheme(undefined).id).toBe(DEFAULT_MENU_THEME_ID);
    expect(resolveMenuTheme('').id).toBe(DEFAULT_MENU_THEME_ID);
    expect(resolveMenuTheme('missing-theme').id).toBe(DEFAULT_MENU_THEME_ID);
  });

  test('applies CSS variable tokens to target style object', () => {
    const writes = new Map<string, string>();
    const styleTarget = {
      setProperty: (key: string, value: string) => {
        writes.set(key, value);
      },
    };
    const theme = resolveMenuTheme('solar_flare_v1');
    applyMenuTheme(theme, styleTarget);

    expect(writes.get('--bg')).toBe(theme.tokens.bg);
    expect(writes.get('--ui-menu-backdrop-start')).toBe(theme.tokens.menuBackdropStart);
    expect(writes.get('--ui-button-active-bg')).toBe(theme.tokens.buttonActiveBg);
    expect(writes.get('--ui-font-family')).toBe(theme.tokens.fontFamily);
  });
});
